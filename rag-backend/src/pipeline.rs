use crate::{
    chunk::{chunks_from_markdown, embed_text, Chunk},
    db::{last_updated_at, replace_doc, ChunkRow, DocMeta, Pool},
    embed::Embedder,
};
use anyhow::{bail, Result};

const EMBED_BATCH: usize = 64;

pub struct IngestDoc {
    pub slug: String,
    pub title: String,
    pub category: String,
    pub url: String,
    pub updated_at: String,

    pub markdown: String,
    pub chunks: Vec<Chunk>,
}

impl IngestDoc {
    pub fn from_markdown(
        slug: impl Into<String>,
        title: impl Into<String>,
        category: impl Into<String>,
        url: impl Into<String>,
        updated_at: impl Into<String>,
        markdown: impl Into<String>,
    ) -> Self {
        let markdown = markdown.into();
        let chunks = chunks_from_markdown(&markdown);
        Self {
            slug: slug.into(),
            title: title.into(),
            category: category.into(),
            url: url.into(),
            updated_at: updated_at.into(),
            markdown,
            chunks,
        }
    }
}

#[derive(Debug, PartialEq)]
pub enum StoreOutcome {
    Ingested { chunks: usize },
    Skipped,
    Empty,
}

fn should_skip(stored: &str, incoming: &str) -> bool {
    if is_timestamp(stored) && is_timestamp(incoming) {
        stored >= incoming
    } else {
        stored == incoming
    }
}

fn is_timestamp(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 10
        && b[..10].iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
}

fn rfc3339_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default()
}

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

    if !force && !doc.updated_at.trim().is_empty() {
        let pool = pool.clone();
        let slug = doc.slug.clone();
        let last = tokio::task::spawn_blocking(move || -> Result<Option<String>> {
            let conn = pool.get()?;
            last_updated_at(&conn, &slug)
        })
        .await??;
        if let Some(old) = last {
            if should_skip(&old, &doc.updated_at) {
                return Ok(StoreOutcome::Skipped);
            }
        }
    }

    if doc.chunks.is_empty() {
        return Ok(StoreOutcome::Empty);
    }

    let to_embed: Vec<String> = doc
        .chunks
        .iter()
        .map(|c| embed_text(&doc.title, &c.heading_path, &c.content))
        .collect();
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(to_embed.len());
    for batch in to_embed.chunks(EMBED_BATCH) {
        embeddings.extend(embedder.embed_batch(batch).await?);
    }

    let now = rfc3339_now();
    let n = doc.chunks.len();

    let pool = pool.clone();
    let slug = doc.slug.clone();
    let title = doc.title.clone();
    let url = doc.url.clone();
    let category = doc.category.clone();
    let updated_at = doc.updated_at.clone();
    let markdown = doc.markdown.clone();
    let headings: Vec<String> = doc.chunks.iter().map(|c| c.heading_path.clone()).collect();
    let contents: Vec<String> = doc.chunks.iter().map(|c| c.content.clone()).collect();

    tokio::task::spawn_blocking(move || -> Result<()> {
        let rows: Vec<ChunkRow> = headings
            .iter()
            .zip(contents.iter())
            .zip(embeddings.iter())
            .map(|((heading_path, content), embedding)| ChunkRow {
                heading_path,
                content,
                embedding,
            })
            .collect();
        let mut conn = pool.get()?;
        replace_doc(
            &mut conn,
            &DocMeta {
                slug: &slug,
                title: &title,
                url: &url,
                category: &category,
                updated_at: &updated_at,
                markdown: &markdown,
            },
            &now,
            &rows,
            embed_dim,
        )
    })
    .await??;

    Ok(StoreOutcome::Ingested { chunks: n })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moc_thoi_gian_bo_qua_ban_khong_moi_hon() {
        assert!(should_skip("2025-09-28T10:00:00Z", "2025-09-28T10:00:00Z"));
        assert!(should_skip("2025-09-28", "2025-01-01"));
        assert!(!should_skip("2025-01-01", "2025-09-28"), "bản mới phải vào");
    }

    #[test]
    fn van_tay_chi_bo_qua_khi_trung_khop() {
        assert!(should_skip("sha256:aaaa1111", "sha256:aaaa1111"));

        assert!(!should_skip("sha256:bbbb2222", "sha256:aaaa1111"));
        assert!(!should_skip("sha256:aaaa1111", "sha256:bbbb2222"));
    }

    #[test]
    fn doi_giua_hai_dang_thi_luon_nap_lai() {
        assert!(!should_skip("2025-09-28", "sha256:aaaa1111"));
        assert!(!should_skip("sha256:aaaa1111", "2025-09-28"));
    }

    #[test]
    fn nhan_dang_moc_thoi_gian() {
        assert!(is_timestamp("2025-09-28"));
        assert!(is_timestamp("2025-09-28T10:00:00Z"));
        assert!(!is_timestamp("sha256:aaaa1111"));
        assert!(!is_timestamp("2025-09"));
        assert!(!is_timestamp(""));
    }

    #[test]
    fn from_markdown_giu_ban_goc() {
        let md = "## Mục A\n\nNội dung.\n";
        let d = IngestDoc::from_markdown("s", "T", "", "/u/", "2025-01-01", md);
        assert_eq!(d.markdown, md, "bản gốc phải giữ nguyên để cắt lại về sau");
        assert_eq!(d.chunks.len(), 1);
        assert_eq!(d.chunks[0].heading_path, "Mục A");
    }
}
