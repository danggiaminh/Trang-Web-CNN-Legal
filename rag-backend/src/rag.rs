use crate::{
    db::{doc_stats, fetch_doc_chunks, fetch_outline, search_hybrid, Pool, Retrieved, Scope},
    embed::Embedder,
    openrouter::ChatMessage,
    state::AppState,
    SYSTEM_PROMPT_TEMPLATE,
};
use anyhow::Result;

const SHORT_DOC_CHARS: usize = 3000;

const RETRIEVED_MAX_CHARS: usize = 5000;

const OUTLINE_SECTION_CHARS: usize = 450;
const OUTLINE_MAX_CHARS: usize = 6000;

const WHOLE_DOC_HINTS: &[&str] = &[
    "tóm tắt",
    "tóm lược",
    "tóm gọn",
    "khái quát",
    "nội dung chính",
    "ý chính",
    "điểm chính",
    "nói về gì",
    "viết về gì",
    "đại ý",
];

fn normalized_words(question: &str) -> String {
    let spaced: String = question
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { ' ' })
        .collect();
    format!(
        " {} ",
        spaced.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
    )
}

fn wants_whole_doc(question: &str) -> bool {
    let q = normalized_words(question);
    WHOLE_DOC_HINTS.iter().any(|h| q.contains(&format!(" {h} ")))
}

pub async fn build_rag_context(
    embedder: &Embedder,
    pool: &Pool,
    question: &str,
    top_k: usize,
    slug: Option<&str>,
) -> Result<(Vec<Retrieved>, Option<String>)> {

    let stats = match slug {
        Some(slug) => {
            let pool = pool.clone();
            let slug = slug.to_string();
            tokio::task::spawn_blocking(move || -> Result<Option<(String, usize)>> {
                let conn = pool.get()?;
                doc_stats(&conn, &slug)
            })
            .await??
        }
        None => None,
    };

    let Some((title, char_len)) = stats else {

        let q_emb = embedder.embed_one(question).await?;
        let pool = pool.clone();
        let q_text = question.to_string();
        let hits = tokio::task::spawn_blocking(move || -> Result<Vec<Retrieved>> {
            let conn = pool.get()?;
            search_hybrid(&conn, &q_emb, &q_text, top_k, Scope::All)
        })
        .await??;
        // search_hybrid chỉ cắt theo SỐ LƯỢNG (take(k)), không theo ký tự. Thiếu
        // within_budget ở đây thì nhánh "không mở bài nào" đi thẳng vào prompt
        // với top_k chunk nguyên vẹn — vượt xa ngân sách 5.000 ký tự, và thứ tự
        // chunk chạy theo điểm liên quan nên tiền tố prompt cũng đảo lung tung.
        // Nhánh có slug bên dưới vốn đã gọi within_budget; đây là chỗ bị sót.
        return Ok((within_budget(hits, RETRIEVED_MAX_CHARS), None));
    };

    if char_len <= SHORT_DOC_CHARS {
        let pool = pool.clone();
        let slug_owned = slug.unwrap_or_default().to_string();
        let doc = tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            fetch_doc_chunks(&conn, &slug_owned, usize::MAX)
        })
        .await??;
        return Ok((doc.chunks, Some(title)));
    }

    if wants_whole_doc(question) {
        let pool = pool.clone();
        let slug_owned = slug.unwrap_or_default().to_string();
        let outline = tokio::task::spawn_blocking(move || {
            let conn = pool.get()?;
            fetch_outline(
                &conn,
                &slug_owned,
                OUTLINE_SECTION_CHARS,
                OUTLINE_MAX_CHARS,
            )
        })
        .await??;
        if !outline.is_empty() {
            return Ok((outline, Some(title)));
        }
    }

    let q_emb = embedder.embed_one(question).await?;
    let pool = pool.clone();
    let q_text = question.to_string();
    let slug_owned = slug.unwrap_or_default().to_string();
    let hits = tokio::task::spawn_blocking(move || -> Result<Vec<Retrieved>> {
        let conn = pool.get()?;
        search_hybrid(&conn, &q_emb, &q_text, top_k, Scope::Doc(slug_owned))
    })
    .await??;

    Ok((within_budget(hits, RETRIEVED_MAX_CHARS), Some(title)))
}

fn within_budget(hits: Vec<Retrieved>, budget: usize) -> Vec<Retrieved> {
    let mut out: Vec<Retrieved> = Vec::new();
    let mut used = 0usize;
    for h in hits {
        let cost = h.content.chars().count();
        if used + cost > budget && !out.is_empty() {
            continue;
        }
        used += cost;
        out.push(h);
    }
    out.sort_by_key(|c| (c.slug.clone(), c.ord));
    out
}

fn render_chunks(chunks: &[Retrieved]) -> String {
    if chunks.is_empty() {
        return "(Không tìm thấy tài liệu liên quan trong dữ liệu hiện có.)".to_string();
    }
    let mut s = String::new();
    for (i, c) in chunks.iter().enumerate() {

        let src = match (c.url.trim(), c.heading_path.as_str()) {
            ("", "") => c.title.clone(),
            ("", path) => format!("{} — {}", c.title, path),
            (link, "") => format!("{} ({link})", c.title),
            (link, path) => format!("{} — {} ({link})", c.title, path),
        };
        s.push_str(&format!("[{}] Nguồn: {src}\n{}\n\n", i + 1, c.content.trim()));
    }
    s.trim_end().to_string()
}

fn current_page_note(title: &str) -> String {
    format!(
        "\nNgười dùng đang mở trang \"{title}\". Khi câu hỏi nhắc tới \"bài viết này\", \
         \"bài này\", \"vụ án này\" hoặc không nêu rõ tên, hãy hiểu là đang hỏi về \
         \"{title}\" và chỉ trả lời dựa trên phần tài liệu của đúng bài đó. \
         Chỉ dùng tài liệu của bài khác khi người dùng nêu đích danh tên bài đó.\n"
    )
}

pub fn build_prompt(
    question: &str,
    chunks: &[Retrieved],
    current_title: Option<&str>,
    history: &[(&'static str, String)],
) -> Vec<ChatMessage> {

    let system = SYSTEM_PROMPT_TEMPLATE
        .replace(
            "{{current_page}}",
            &current_title.map(current_page_note).unwrap_or_default(),
        )
        .replace("{{retrieved_chunks}}", &render_chunks(chunks));

    let mut messages = Vec::with_capacity(history.len() + 2);
    messages.push(ChatMessage {
        role: "system",
        content: system,
    });
    for (role, content) in history {
        messages.push(ChatMessage {
            role,
            content: content.clone(),
        });
    }
    messages.push(ChatMessage {
        role: "user",
        content: question.to_string(),
    });
    messages
}

pub async fn prepare_messages(
    state: &AppState,
    question: &str,
    slug: Option<&str>,
    history: &[(&'static str, String)],
) -> Result<Vec<ChatMessage>> {
    let (chunks, current_title) = build_rag_context(
        state.embedder(),
        state.pool(),
        question,
        state.config().top_k,
        slug,
    )
    .await?;

    let messages = build_prompt(question, &chunks, current_title.as_deref(), history);
    if let Some(sys) = messages.first() {
        tracing::debug!(
            chunks = chunks.len(),
            system_chars = sys.content.chars().count(),
            "ngữ cảnh đã dựng"
        );
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: i64, ord: i64, title: &str, path: &str, content: &str, url: &str) -> Retrieved {
        Retrieved {
            id,
            slug: "abc".into(),
            ord,
            title: title.into(),
            url: url.into(),
            heading_path: path.into(),
            content: content.into(),
            score: 1.0,
        }
    }

    #[test]
    fn nhan_dien_cau_tom_tat_theo_tron_tu() {
        assert!(wants_whole_doc("tóm tắt bài này giúp mình"));
        assert!(wants_whole_doc("Tóm Tắt?"));
        assert!(wants_whole_doc("bài này nói về gì?"));

        assert!(!wants_whole_doc("trang tổng quan có gì"));
        assert!(!wants_whole_doc("mức án bao nhiêu năm?"));
    }

    #[test]
    fn khong_bia_link_khi_thieu_url() {
        let out = render_chunks(&[chunk(1, 0, "Vụ án X", "", "nội dung", "")]);
        assert!(!out.contains("/bai-viet/"), "không được đoán đường dẫn: {out}");
        assert!(out.contains("Vụ án X"));
    }

    #[test]
    fn in_duong_dan_muc_dung_mot_lan() {
        let out = render_chunks(&[chunk(1, 0, "Bài", "Mục A › A1", "nội dung sạch", "/u/")]);
        assert_eq!(out.matches("Mục A › A1").count(), 1, "{out}");
        assert!(out.contains("/u/"));
    }

    #[test]
    fn ghi_chu_trang_dung_truoc_khoi_tai_lieu() {
        let msgs = build_prompt("hỏi", &[chunk(1, 0, "Bài A", "", "nd", "")], Some("Bài A"), &[]);
        let system = &msgs[0].content;
        let ghi_chu = system.find("đang mở trang").expect("thiếu ghi chú trang");

        let tai_lieu = system.find("TÀI LIỆU THAM KHẢO:").expect("thiếu tiêu đề khối");
        assert!(ghi_chu < tai_lieu, "ghi chú trang phải đứng trước tài liệu");
    }

    #[test]
    fn khong_de_lai_placeholder_khi_khong_mo_bai_nao() {
        let msgs = build_prompt("hỏi", &[], None, &[]);
        assert!(!msgs[0].content.contains("{{"), "còn placeholder chưa thay");
    }

    #[test]
    fn lich_su_xen_giua_system_va_cau_hoi() {
        let history = vec![
            ("user", "câu cũ".to_string()),
            ("assistant", "trả lời cũ".to_string()),
        ];
        let msgs = build_prompt("câu mới", &[], None, &history);
        let roles: Vec<_> = msgs.iter().map(|m| m.role).collect();
        assert_eq!(roles, vec!["system", "user", "assistant", "user"]);
        assert_eq!(msgs.last().unwrap().content, "câu mới");
    }

    #[test]
    fn ngan_sach_cat_bot_va_xep_lai_theo_thu_tu_bai() {
        let hits = vec![
            chunk(9, 5, "B", "", &"c".repeat(100), ""),
            chunk(1, 1, "B", "", &"a".repeat(100), ""),
            chunk(5, 9, "B", "", &"b".repeat(100), ""),
        ];
        let out = within_budget(hits, 250);
        assert_eq!(out.len(), 2, "phải tôn trọng ngân sách");
        assert!(out[0].ord < out[1].ord, "xếp theo thứ tự bài, không theo điểm");
    }
}
