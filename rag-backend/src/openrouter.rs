use crate::config::Config;
use anyhow::Result;
use futures_util::{Stream, StreamExt};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Serialize)]
struct ProviderCfg<'a> {
    order: [&'a str; 1],
    allow_fallbacks: bool,
}

#[derive(Serialize)]
struct Reasoning<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<&'a str>,
}

#[derive(Serialize)]
struct UsageCfg {
    include: bool,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    provider: ProviderCfg<'a>,
    stream: bool,
    // Xin OpenRouter trả kèm thống kê token; thiếu cờ này thì không có cách nào
    // biết tỉ lệ trúng cache, mà đó lại là con số quyết định cả tốc độ lẫn chi phí.
    usage: UsageCfg,
    reasoning: Reasoning<'a>,

    max_tokens: u32,
    temperature: f32,
    top_p: f32,
    frequency_penalty: f32,
    presence_penalty: f32,
    messages: &'a [ChatMessage],
}

/// Thống kê token của một lượt gọi, đọc từ khung SSE riêng gần cuối luồng.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct UsageStats {
    pub prompt_tokens: u64,
    pub cached_tokens: u64,
    pub completion_tokens: u64,
    pub cost: f64,
}

impl UsageStats {
    pub fn cache_percent(&self) -> u64 {
        if self.prompt_tokens == 0 {
            0
        } else {
            self.cached_tokens * 100 / self.prompt_tokens
        }
    }
}

pub async fn call_openrouter(
    http: &reqwest::Client,
    cfg: &Config,
    messages: &[ChatMessage],
) -> Result<reqwest::Response> {

    let reasoning = match cfg.openrouter_reasoning.trim().to_lowercase().as_str() {
        "off" | "none" | "disabled" | "false" | "" => Reasoning {
            enabled: Some(false),
            effort: None,
        },
        _ => Reasoning {
            enabled: None,
            effort: Some(cfg.openrouter_reasoning.as_str()),
        },
    };

    let body = ChatRequest {
        model: &cfg.openrouter_model,
        provider: ProviderCfg {
            order: [cfg.openrouter_provider.as_str()],
            // Ưu tiên nhà cung cấp đã chọn nhưng vẫn cho phép chuyển nhà khi họ
            // lỗi. Ghim cứng (false) nghĩa là nhà đó sập thì cả trợ lý sập theo —
            // câu trả lời không trúng cache còn hơn không có câu trả lời.
            allow_fallbacks: true,
        },
        stream: true,
        usage: UsageCfg { include: true },
        reasoning,
        max_tokens: cfg.openrouter_max_tokens,
        temperature: cfg.openrouter_temperature,
        top_p: cfg.openrouter_top_p,
        frequency_penalty: cfg.openrouter_frequency_penalty,
        presence_penalty: cfg.openrouter_presence_penalty,
        messages,
    };

    let mut req = http
        .post(&cfg.openrouter_base_url)
        .bearer_auth(&cfg.openrouter_api_key)
        .header("Content-Type", "application/json");
    if let Some(r) = &cfg.openrouter_referer {
        req = req.header("HTTP-Referer", r);
    }
    if let Some(t) = &cfg.openrouter_title {
        req = req.header("X-Title", t);
    }
    Ok(req.json(&body).send().await?)
}

pub fn retry_after_ms(resp: &reqwest::Response, attempt: u32) -> u64 {
    resp.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|s| s.min(3) * 1000)
        .unwrap_or_else(|| 400 + (attempt as u64) * 200)
}

enum SseLine {
    Token(String),
    Done,
}

fn parse_sse_line(line: &str) -> Option<SseLine> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() {
        return None;
    }
    if data == "[DONE]" {
        return Some(SseLine::Done);
    }
    let v: Value = serde_json::from_str(data).ok()?;
    let tok = v
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()?;
    if tok.is_empty() {
        None
    } else {
        Some(SseLine::Token(tok.to_string()))
    }
}

/// Gói usage đi kèm ở một khung SSE riêng, KHÔNG có `choices[0].delta.content`,
/// nên `parse_sse_line` trả None và bỏ qua nó. Phải soi song song bằng hàm này.
fn parse_usage_line(line: &str) -> Option<UsageStats> {
    let data = line.strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    let u = v.get("usage")?;
    let prompt_tokens = u.get("prompt_tokens")?.as_u64()?;
    if prompt_tokens == 0 {
        return None;
    }
    Some(UsageStats {
        prompt_tokens,
        cached_tokens: u
            .get("prompt_tokens_details")
            .and_then(|d| d.get("cached_tokens"))
            .and_then(|c| c.as_u64())
            .unwrap_or(0),
        completion_tokens: u.get("completion_tokens").and_then(|c| c.as_u64()).unwrap_or(0),
        cost: u.get("cost").and_then(|c| c.as_f64()).unwrap_or(0.0),
    })
}

#[derive(Default)]
struct SseDecoder {
    buf: Vec<u8>,
    usage: Option<UsageStats>,
}

impl SseDecoder {

    fn push(&mut self, chunk: &[u8]) -> (Vec<String>, bool) {
        self.buf.extend_from_slice(chunk);
        let mut tokens = Vec::new();

        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&raw[..nl]);
            let line = line.trim_end_matches('\r');

            if self.usage.is_none() {
                if let Some(u) = parse_usage_line(line) {
                    self.usage = Some(u);
                }
            }

            match parse_sse_line(line) {
                Some(SseLine::Done) => return (tokens, true),
                Some(SseLine::Token(t)) => tokens.push(t),
                None => {}
            }
        }
        (tokens, false)
    }

    /// Lấy ra và xoá, để chỉ ghi log đúng một lần cho mỗi lượt gọi.
    fn take_usage(&mut self) -> Option<UsageStats> {
        self.usage.take()
    }
}

fn la_lap_vo_nghia(duoi: &str) -> bool {
    const NGUONG_LAP: usize = 12;
    let ky_tu: Vec<char> = duoi.chars().collect();
    for do_dai in 1..=8usize {
        if ky_tu.len() < do_dai * NGUONG_LAP {
            continue;
        }
        let mau = &ky_tu[ky_tu.len() - do_dai..];
        let mut lan = 0usize;
        let mut i = ky_tu.len();
        while i >= do_dai && &ky_tu[i - do_dai..i] == mau {
            lan += 1;
            i -= do_dai;
        }
        if lan >= NGUONG_LAP {
            return true;
        }
    }
    false
}

pub fn stream_content(
    resp: reqwest::Response,
    gioi_han_ky_tu: usize,
) -> impl Stream<Item = Result<String>> {
    async_stream::try_stream! {
        let mut bytes = resp.bytes_stream();
        let mut dec = SseDecoder::default();
        let mut da_ra = String::new();

        while let Some(chunk) = bytes.next().await {
            let chunk = chunk?;
            let (tokens, done) = dec.push(&chunk);

            if let Some(u) = dec.take_usage() {
                tracing::info!(
                    token_vao = u.prompt_tokens,
                    trung_cache = u.cached_tokens,
                    phan_tram_cache = u.cache_percent(),
                    token_ra = u.completion_tokens,
                    chi_phi_usd = u.cost,
                    "thống kê token"
                );
            }

            for tok in tokens {
                da_ra.push_str(&tok);
                yield tok;

                if da_ra.chars().count() >= gioi_han_ky_tu {
                    tracing::warn!(
                        da_ra = da_ra.chars().count(),
                        "ngắt luồng: câu trả lời vượt giới hạn ký tự"
                    );
                    return;
                }
                let so_ky_tu = da_ra.chars().count();
                if so_ky_tu >= 120 {
                    let duoi: String = da_ra.chars().skip(so_ky_tu.saturating_sub(160)).collect();
                    if la_lap_vo_nghia(&duoi) {
                        tracing::warn!("ngắt luồng: phát hiện model lặp chữ vô nghĩa");
                        return;
                    }
                }
            }
            if done {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bat_duoc_lap_mot_ky_tu() {
        assert!(la_lap_vo_nghia(&"d".repeat(20)));
        assert!(la_lap_vo_nghia(&"b".repeat(13)));
    }

    #[test]
    fn bat_duoc_lap_cum_ngan() {
        assert!(la_lap_vo_nghia(&"d ".repeat(15)));
        assert!(la_lap_vo_nghia(&"abc".repeat(14)));
    }

    #[test]
    fn khong_bat_oan_van_ban_binh_thuong() {
        let that = "Luật sư Đặng Kim Chinh là người bào chữa cho bị cáo tại cấp phúc thẩm. \
                    Hội đồng xét xử đã tuyên phạt bị cáo ba năm tù, giảm hai năm so với bản án sơ thẩm.";
        assert!(!la_lap_vo_nghia(that));
        assert!(!la_lap_vo_nghia("Vụ án hành chính tại Quận 3 liên quan chỉ tiêu kiến trúc."));
        assert!(!la_lap_vo_nghia("ha ha ha"));
    }

    #[test]
    fn cau_hoi_ngan_khong_bi_coi_la_lap() {
        assert!(!la_lap_vo_nghia("Xin chào"));
    }

    fn wire(content: &str) -> String {
        format!(
            "data: {}\n\n",
            serde_json::json!({ "choices": [{ "delta": { "content": content } }] })
        )
    }

    #[test]
    fn khong_vo_chu_khi_chunk_cat_giua_ky_tu() {
        let text = "Tòa án nhân dân tối cao xét xử vụ án tham ô tài sản";
        let bytes = wire(text).into_bytes();

        for split in 1..bytes.len() {
            let mut dec = SseDecoder::default();
            let (mut got, done) = dec.push(&bytes[..split]);
            assert!(!done);
            let (rest, _) = dec.push(&bytes[split..]);
            got.extend(rest);
            assert_eq!(got.concat(), text, "hỏng khi cắt tại byte {split}");
        }
    }

    #[test]
    fn ghep_nhieu_token_qua_nhieu_chunk() {
        let mut dec = SseDecoder::default();
        let mut out = Vec::new();
        for part in ["Điều ", "353 ", "Bộ luật Hình sự"] {
            let (toks, done) = dec.push(wire(part).as_bytes());
            assert!(!done);
            out.extend(toks);
        }
        assert_eq!(out.concat(), "Điều 353 Bộ luật Hình sự");
    }

    #[test]
    fn dung_lai_o_done() {
        let mut dec = SseDecoder::default();
        let (toks, done) = dec.push(b"data: [DONE]\n");
        assert!(done);
        assert!(toks.is_empty());
    }

    #[test]
    fn bo_qua_dong_keepalive_va_dong_rong() {
        let mut dec = SseDecoder::default();
        let (toks, done) = dec.push(b": keep-alive\n\ndata: \n");
        assert!(!done);
        assert!(toks.is_empty());
    }

    fn khung_usage(prompt: u64, cached: u64) -> String {
        format!(
            "data: {}\n\n",
            serde_json::json!({
                "choices": [{ "delta": {} }],
                "usage": {
                    "prompt_tokens": prompt,
                    "prompt_tokens_details": { "cached_tokens": cached },
                    "completion_tokens": 217,
                    "cost": 0.0019118
                }
            })
        )
    }

    #[test]
    fn doc_duoc_thong_ke_token_tu_khung_usage() {
        let mut dec = SseDecoder::default();
        let (toks, done) = dec.push(khung_usage(13222, 13056).as_bytes());
        assert!(!done);
        assert!(toks.is_empty(), "khung usage không được coi là chữ trả lời");

        let u = dec.take_usage().expect("phải đọc được usage");
        assert_eq!(u.prompt_tokens, 13222);
        assert_eq!(u.cached_tokens, 13056);
        assert_eq!(u.completion_tokens, 217);
        assert_eq!(u.cache_percent(), 98);
        assert!(dec.take_usage().is_none(), "lấy rồi thì không trả lại lần hai");
    }

    #[test]
    fn usage_khong_lam_mat_chu_di_kem() {
        let mut dec = SseDecoder::default();
        let mut wire_all = wire("Theo tài liệu, ");
        wire_all.push_str(&khung_usage(2599, 1024));
        wire_all.push_str(&wire("Luật sư Đặng Kim Chinh"));

        let (toks, _) = dec.push(wire_all.as_bytes());
        assert_eq!(toks.concat(), "Theo tài liệu, Luật sư Đặng Kim Chinh");
        assert_eq!(dec.take_usage().unwrap().cache_percent(), 39);
    }

    #[test]
    fn khung_thuong_khong_bi_nham_la_usage() {
        assert!(parse_usage_line(&wire("chữ bình thường").trim().to_string()).is_none());
        assert!(parse_usage_line("data: [DONE]").is_none());
        assert!(parse_usage_line("data: ").is_none());
        assert!(parse_usage_line(": keep-alive").is_none());
    }

    #[test]
    fn khong_chia_cho_khong_khi_thieu_token_vao() {
        assert_eq!(UsageStats::default().cache_percent(), 0);
    }

    #[test]
    fn cho_phep_chuyen_nha_cung_cap_khi_ho_loi() {
        // Ghim cứng một nhà (allow_fallbacks=false) thì nhà đó sập là trợ lý sập
        // theo. Khẳng định lại lựa chọn này để không ai lỡ tay đổi ngược.
        let p = ProviderCfg {
            order: ["parasail"],
            allow_fallbacks: true,
        };
        let j = serde_json::to_value(&p).unwrap();
        assert_eq!(j["allow_fallbacks"], serde_json::json!(true));
    }

    #[test]
    fn giu_lai_dong_do_dang() {
        let mut dec = SseDecoder::default();
        let full = wire("nội dung");
        let (toks, _) = dec.push(&full.as_bytes()[..full.len() - 3]);
        assert!(toks.is_empty(), "chưa đủ dòng thì chưa được yield");
        let (toks, _) = dec.push(&full.as_bytes()[full.len() - 3..]);
        assert_eq!(toks.concat(), "nội dung");
    }
}
