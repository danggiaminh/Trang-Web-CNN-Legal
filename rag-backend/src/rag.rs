use crate::{
    db::{fetch_doc_chunks, search_knn, Pool, Retrieved},
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
    "tổng hợp",
    "tổng quan",
    "khái quát",
    "nội dung chính",
    "ý chính",
    "điểm chính",
    "nói về gì",
    "viết về gì",
    "đại ý",
];

fn doc_budget(question: &str) -> usize {
    let q = question.to_lowercase();
    if WHOLE_DOC_HINTS.iter().any(|h| q.contains(h)) {
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
    let q_emb = embedder.embed_one(question).await?;
    let conn = pool.get()?;

    let mut chunks = Vec::new();
    let mut current_title = None;

    if let Some(slug) = slug {
        let doc = fetch_doc_chunks(&conn, slug, doc_budget(question))?;
        if let Some(first) = doc.first() {
            current_title = Some(first.title.clone());
        }
        chunks.extend(doc);
    }

    for hit in search_knn(&conn, &q_emb, top_k)? {
        if !chunks.iter().any(|c| c.id == hit.id) {
            chunks.push(hit);
        }
    }

    Ok((chunks, current_title))
}

fn render_chunks(chunks: &[Retrieved]) -> String {
    if chunks.is_empty() {
        return "(Không tìm thấy tài liệu liên quan trong dữ liệu hiện có.)".to_string();
    }
    let mut s = String::new();
    for (i, c) in chunks.iter().enumerate() {
        let src = if c.section.is_empty() {
            format!("{} (/bai-viet/{})", c.title, c.article_slug)
        } else {
            format!("{} — {} (/bai-viet/{})", c.title, c.section, c.article_slug)
        };
        s.push_str(&format!("[{}] Nguồn: {src}\n{}\n\n", i + 1, c.content.trim()));
    }
    s.trim_end().to_string()
}

pub fn build_prompt(
    question: &str,
    chunks: &[Retrieved],
    current_title: Option<&str>,
) -> Vec<ChatMessage> {
    let mut system = SYSTEM_PROMPT_TEMPLATE.replace("{{retrieved_chunks}}", &render_chunks(chunks));
    if let Some(title) = current_title {
        system.push_str(&format!(
            "\n\nNgười dùng đang mở trang \"{title}\". Khi câu hỏi nhắc tới \"bài viết này\", \
             \"bài này\", \"vụ án này\" hoặc không nêu rõ tên, hãy hiểu là đang hỏi về \
             \"{title}\" và chỉ trả lời dựa trên phần tài liệu của đúng bài đó. \
             Chỉ dùng tài liệu của bài khác khi người dùng nêu đích danh tên bài đó."
        ));
    }
    vec![
        ChatMessage {
            role: "system",
            content: system,
        },
        ChatMessage {
            role: "user",

            content: question.to_string(),
        },
    ]
}

pub async fn prepare_messages(
    state: &AppState,
    question: &str,
    slug: Option<&str>,
) -> Result<Vec<ChatMessage>> {
    let (chunks, current_title) = build_rag_context(
        state.embedder(),
        state.pool(),
        question,
        state.config().top_k,
        slug,
    )
    .await?;
    Ok(build_prompt(question, &chunks, current_title.as_deref()))
}
