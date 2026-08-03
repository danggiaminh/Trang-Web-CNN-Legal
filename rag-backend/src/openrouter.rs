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
struct ChatRequest<'a> {
    model: &'a str,
    provider: ProviderCfg<'a>,
    stream: bool,
    reasoning: Reasoning<'a>,

    max_tokens: u32,
    temperature: f32,
    top_p: f32,
    frequency_penalty: f32,
    presence_penalty: f32,
    messages: &'a [ChatMessage],
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
            allow_fallbacks: false,
        },
        stream: true,
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

#[derive(Default)]
struct SseDecoder {
    buf: Vec<u8>,
}

impl SseDecoder {

    fn push(&mut self, chunk: &[u8]) -> (Vec<String>, bool) {
        self.buf.extend_from_slice(chunk);
        let mut tokens = Vec::new();

        while let Some(nl) = self.buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = self.buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&raw[..nl]);
            match parse_sse_line(line.trim_end_matches('\r')) {
                Some(SseLine::Done) => return (tokens, true),
                Some(SseLine::Token(t)) => tokens.push(t),
                None => {}
            }
        }
        (tokens, false)
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
