//! Lõi ingest DÙNG CHUNG cho mọi nguồn (file .md, WordPress, Ghost, ...).
//! Một `IngestDoc` chuẩn hoá đi vào; incremental theo `updated_at`; embed; ghi
//! đè bản cũ của đúng (source, slug). Idempotent: gọi lại nhiều lần cho cùng
//! nội dung sẽ thay thế sạch chứ không nhân đôi.

use crate::{
    chunk::{chunks_from_markdown, Chunk},
    db::{last_source_updated_at, replace_doc, ChunkRow, Pool},
    embed::Embedder,
    html::html_to_markdown,
};
use anyhow::{bail, Result};

const EMBED_BATCH: usize = 64;

/// Tài liệu chuẩn hoá để nạp vào kho, bất kể đến từ file hay CMS.
pub struct IngestDoc {
    /// "file" | "wordpress" | "ghost" | ... — để namespacing & xoá đúng nguồn.
    pub source: String,
    /// = slug trang trên website (AskBox truyền lên khi hỏi "bài này").
    pub slug: String,
    pub title: String,
    pub category: String,
    /// URL công khai của bài, dùng để trích dẫn nguồn cho người đọc.
    pub url: String,
    /// RFC3339 (hoặc chuỗi so sánh từ điển được). Rỗng = luôn ingest.
    pub updated_at: String,
    pub chunks: Vec<Chunk>,
}

impl IngestDoc {
    #[allow(clippy::too_many_arguments)]
    pub fn from_markdown(
        source: impl Into<String>,
        slug: impl Into<String>,
        title: impl Into<String>,
        category: impl Into<String>,
        url: impl Into<String>,
        updated_at: impl Into<String>,
        markdown: &str,
    ) -> Self {
        Self {
            source: source.into(),
            slug: slug.into(),
            title: title.into(),
            category: category.into(),
            url: url.into(),
            updated_at: updated_at.into(),
            chunks: chunks_from_markdown(markdown),
        }
    }

    /// Dựng doc từ HTML (nội dung bài do CMS gửi sang): HTML → Markdown → chunk.
    #[allow(clippy::too_many_arguments)]
    pub fn from_html(
        source: impl Into<String>,
        slug: impl Into<String>,
        title: impl Into<String>,
        category: impl Into<String>,
        url: impl Into<String>,
        updated_at: impl Into<String>,
        html: &str,
    ) -> Self {
        let md = html_to_markdown(html);
        Self::from_markdown(source, slug, title, category, url, updated_at, &md)
    }
}

#[derive(Debug, PartialEq)]
pub enum StoreOutcome {
    Ingested { chunks: usize },
    /// Bỏ qua vì bản trong kho đã mới bằng/hơn `updated_at` gửi lên.
    Skipped,
    /// Không tách được chunk nào (nội dung rỗng sau khi làm sạch).
    Empty,
}

fn rfc3339_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

/// Ingest một tài liệu. `force=true` bỏ qua kiểm tra incremental (ingest lại dù
/// không mới hơn). Không giữ kết nối DB nào xuyên qua `.await` (embed) để tránh
/// giữ pooled-connection khi chờ mạng.
pub async fn store_doc(
    pool: &Pool,
    embedder: &Embedder,
    embed_dim: usize,
    doc: &IngestDoc,
    force: bool,
) -> Result<StoreOutcome> {
    if doc.slug.trim().is_empty() {
        bail!("IngestDoc thiếu slug");
    }

    // 1) Incremental: nếu bản trong kho không cũ hơn -> bỏ qua.
    if !force && !doc.updated_at.trim().is_empty() {
        let conn = pool.get()?;
        if let Some(old) = last_source_updated_at(&conn, &doc.source, &doc.slug)? {
            if old.as_str() >= doc.updated_at.as_str() {
                return Ok(StoreOutcome::Skipped);
            }
        }
    }

    if doc.chunks.is_empty() {
        return Ok(StoreOutcome::Empty);
    }

    // 2) Embed (async, không giữ conn).
    let contents: Vec<String> = doc.chunks.iter().map(|c| c.content.clone()).collect();
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(contents.len());
    for batch in contents.chunks(EMBED_BATCH) {
        embeddings.extend(embedder.embed_batch(batch).await?);
    }

    // 3) Ghi (sync, MỘT transaction): xoá bản cũ + chèn mới + cập nhật state.
    let now = rfc3339_now();
    let rows: Vec<ChunkRow> = doc
        .chunks
        .iter()
        .zip(embeddings.iter())
        .map(|(c, emb)| ChunkRow {
            source: &doc.source,
            article_slug: &doc.slug,
            title: &doc.title,
            section: &c.section,
            content: &c.content,
            url: &doc.url,
            updated_at: &doc.updated_at,
            embedding: emb,
        })
        .collect();
    let n = rows.len();
    let mut conn = pool.get()?;
    replace_doc(
        &mut conn,
        &doc.source,
        &doc.slug,
        &doc.updated_at,
        &now,
        &rows,
        embed_dim,
    )?;

    Ok(StoreOutcome::Ingested { chunks: n })
}
