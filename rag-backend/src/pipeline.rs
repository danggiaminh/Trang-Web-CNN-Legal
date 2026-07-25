

use crate::{
    chunk::{chunks_from_markdown, Chunk},
    db::{last_source_updated_at, replace_doc, ChunkRow, Pool},
    embed::Embedder,
    html::html_to_markdown,
};
use anyhow::{bail, Result};

const EMBED_BATCH: usize = 64;


pub struct IngestDoc {

    pub source: String,

    pub slug: String,
    pub title: String,
    pub category: String,

    pub url: String,

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
        let source = doc.source.clone();
        let slug = doc.slug.clone();
        let last = tokio::task::spawn_blocking(move || -> Result<Option<String>> {
            let conn = pool.get()?;
            last_source_updated_at(&conn, &source, &slug)
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


    let contents: Vec<String> = doc.chunks.iter().map(|c| c.content.clone()).collect();
    let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(contents.len());
    for batch in contents.chunks(EMBED_BATCH) {
        embeddings.extend(embedder.embed_batch(batch).await?);
    }


    let now = rfc3339_now();
    let n = doc.chunks.len();

    let pool = pool.clone();
    let source = doc.source.clone();
    let slug = doc.slug.clone();
    let title = doc.title.clone();
    let url = doc.url.clone();
    let updated_at = doc.updated_at.clone();
    let sections: Vec<String> = doc.chunks.iter().map(|c| c.section.clone()).collect();

    tokio::task::spawn_blocking(move || -> Result<()> {
        let rows: Vec<ChunkRow> = sections
            .iter()
            .zip(contents.iter())
            .zip(embeddings.iter())
            .map(|((section, content), embedding)| ChunkRow {
                source: &source,
                article_slug: &slug,
                title: &title,
                section,
                content,
                url: &url,
                updated_at: &updated_at,
                embedding,
            })
            .collect();
        let mut conn = pool.get()?;
        replace_doc(
            &mut conn,
            &source,
            &slug,
            &updated_at,
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
        assert!(should_skip("2025-09-28", "2025-01-01"), "webhook đến trễ");
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
}
