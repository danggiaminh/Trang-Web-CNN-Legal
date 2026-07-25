use crate::{
    db::{fetch_doc_chunks, search_knn, search_knn_in_doc, DocChunks, Pool, Retrieved},
    embed::Embedder,
    openrouter::ChatMessage,
    state::AppState,
    SYSTEM_PROMPT_TEMPLATE,
};
use anyhow::Result;

const DOC_CONTEXT_MAX_CHARS: usize = 8000;
const DOC_CONTEXT_MAX_CHARS_WHOLE: usize = 26000;


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
    format!(" {} ", spaced.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" "))
}

fn doc_budget(question: &str) -> usize {
    let q = normalized_words(question);


    if WHOLE_DOC_HINTS
        .iter()
        .any(|h| q.contains(&format!(" {h} ")))
    {
        DOC_CONTEXT_MAX_CHARS_WHOLE
    } else {
        DOC_CONTEXT_MAX_CHARS
    }
}

pub async fn build_rag_context(
    embedder: &Embedder,
    pool: &Pool,
    question: &str,
    top_k: usize,
    slug: Option<&str>,
) -> Result<(Vec<Retrieved>, Option<String>)> {


    let doc = match slug {
        Some(slug) => {
            let pool = pool.clone();
            let slug = slug.to_string();
            let budget = doc_budget(question);
            tokio::task::spawn_blocking(move || -> Result<DocChunks> {
                let conn = pool.get()?;
                fetch_doc_chunks(&conn, &slug, budget)
            })
            .await??
        }
        None => DocChunks::default(),
    };

    let current_title = doc.chunks.first().map(|c| c.title.clone());
    let doc_source = doc.chunks.first().map(|c| c.source.clone());


    if !doc.chunks.is_empty() && !doc.truncated {
        return Ok((doc.chunks, current_title));
    }


    let q_emb = embedder.embed_one(question).await?;

    let hits = {
        let pool = pool.clone();
        let slug = slug.map(str::to_string);
        let source = doc_source.clone();
        tokio::task::spawn_blocking(move || -> Result<Vec<Retrieved>> {
            let conn = pool.get()?;
            match (slug.as_deref(), source.as_deref()) {

                (Some(slug), Some(src)) => search_knn_in_doc(&conn, &q_emb, top_k, slug, src),

                _ => search_knn(&conn, &q_emb, top_k),
            }
        })
        .await??
    };

    let chunks = if doc.truncated {


        select_relevant(doc.chunks, hits, doc_budget(question))
    } else {
        let mut chunks = doc.chunks;
        for hit in hits {
            if !chunks.iter().any(|c| c.id == hit.id) {
                chunks.push(hit);
            }
        }
        chunks
    };

    Ok((chunks, current_title))
}


fn select_relevant(doc: Vec<Retrieved>, hits: Vec<Retrieved>, budget: usize) -> Vec<Retrieved> {
    let mut out: Vec<Retrieved> = doc.into_iter().take(1).collect();
    let mut used: usize = out.iter().map(|c| c.content.chars().count()).sum();

    for hit in hits {
        if out.iter().any(|c| c.id == hit.id) {
            continue;
        }
        let cost = hit.content.chars().count();
        if used + cost > budget {
            continue;
        }
        used += cost;
        out.push(hit);
    }

    out.sort_by_key(|c| c.id);
    out
}

fn render_chunks(chunks: &[Retrieved]) -> String {
    if chunks.is_empty() {
        return "(Không tìm thấy tài liệu liên quan trong dữ liệu hiện có.)".to_string();
    }
    let mut s = String::new();
    for (i, c) in chunks.iter().enumerate() {


        let src = match (c.url.trim(), c.section.as_str()) {
            ("", "") => c.title.clone(),
            ("", section) => format!("{} — {}", c.title, section),
            (link, "") => format!("{} ({link})", c.title),
            (link, section) => format!("{} — {} ({link})", c.title, section),
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
    Ok(build_prompt(
        question,
        &chunks,
        current_title.as_deref(),
        history,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(id: i64, title: &str, section: &str, content: &str, url: &str) -> Retrieved {
        Retrieved {
            id,
            source: "file".into(),
            title: title.into(),
            section: section.into(),
            content: content.into(),
            article_slug: "abc".into(),
            url: url.into(),
            distance: 0.0,
        }
    }

    #[test]
    fn ngan_sach_ca_bai_chi_bat_khi_khop_tron_tu() {
        assert_eq!(
            doc_budget("tóm tắt bài này giúp mình"),
            DOC_CONTEXT_MAX_CHARS_WHOLE
        );
        assert_eq!(doc_budget("Tóm Tắt?"), DOC_CONTEXT_MAX_CHARS_WHOLE);
        assert_eq!(doc_budget("bài này nói về gì?"), DOC_CONTEXT_MAX_CHARS_WHOLE);

        assert_eq!(doc_budget("trang tổng quan có gì"), DOC_CONTEXT_MAX_CHARS);
        assert_eq!(doc_budget("mức án bao nhiêu năm?"), DOC_CONTEXT_MAX_CHARS);
    }


    #[test]
    fn khong_bia_link_khi_thieu_url() {
        let out = render_chunks(&[chunk(1, "Vụ án X", "", "nội dung", "")]);
        assert!(!out.contains("/bai-viet/"), "không được đoán đường dẫn: {out}");
        assert!(out.contains("Vụ án X"));
    }

    #[test]
    fn dung_url_that_khi_co() {
        let out = render_chunks(&[chunk(1, "Vụ án X", "Mục 1", "nd", "/vu-an-tieu-bieu/x/")]);
        assert!(out.contains("/vu-an-tieu-bieu/x/"), "{out}");
    }


    #[test]
    fn ghi_chu_trang_dung_truoc_khoi_tai_lieu() {
        let msgs = build_prompt("hỏi gì đó", &[chunk(1, "Bài A", "", "nd", "")], Some("Bài A"), &[]);
        let system = &msgs[0].content;
        let ghi_chu = system.find("đang mở trang").expect("thiếu ghi chú trang");


        let tai_lieu = system
            .find("TÀI LIỆU THAM KHẢO:")
            .expect("thiếu tiêu đề khối tài liệu");
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
    fn chon_doan_lien_quan_va_giu_thu_tu_bai() {
        let doc = vec![
            chunk(1, "B", "", &"a".repeat(100), ""),
            chunk(2, "B", "", &"b".repeat(100), ""),
        ];
        let hits = vec![
            chunk(9, "B", "", &"i".repeat(100), ""),
            chunk(5, "B", "", &"e".repeat(100), ""),
        ];
        let ids: Vec<_> = select_relevant(doc, hits, 350).iter().map(|c| c.id).collect();
        assert_eq!(ids, vec![1, 5, 9], "chunk mở đầu + hit, xếp theo id");
    }

    #[test]
    fn chon_doan_lien_quan_ton_trong_ngan_sach() {
        let doc = vec![chunk(1, "B", "", &"a".repeat(100), "")];
        let hits = vec![
            chunk(5, "B", "", &"e".repeat(100), ""),
            chunk(9, "B", "", &"i".repeat(100), ""),
        ];
        assert_eq!(select_relevant(doc, hits, 250).len(), 2);
    }
}
