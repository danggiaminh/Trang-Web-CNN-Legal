use anyhow::{Context, Result};
use clap::Parser;
use cnn_legal_rag::{
    chunk::parse_file,
    config::Config,
    db::{
        delete_article, init_schema, insert_chunks, last_source_updated_at, open_single,
        upsert_ingest_state, ChunkRow,
    },
    embed::Embedder,
};
use std::collections::HashSet;
use walkdir::WalkDir;

const EMBED_BATCH: usize = 64;

#[derive(Parser)]
#[command(about = "Ingest bài viết CNN Legal vào vector store")]
struct Args {

    #[arg(long)]
    force: bool,

    #[arg(long)]
    prune: bool,

    #[arg(long)]
    content_dir: Option<String>,

    #[arg(long)]
    db: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();
    let cfg = Config::from_env()?;
    let content_dir = args.content_dir.unwrap_or(cfg.content_dir.clone());
    let db_path = args.db.unwrap_or(cfg.db_path.clone());

    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()?;
    let embedder = Embedder::new(
        http,
        &cfg.embed_base_url,
        cfg.embed_api_key.clone(),
        &cfg.embed_model,
        cfg.embed_dim,
    );

    let mut conn = open_single(&db_path)?;
    init_schema(&conn, cfg.embed_dim)?;

    let now = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_default();

    let mut seen_slugs: HashSet<String> = HashSet::new();
    let (mut n_ingested, mut n_skipped, mut n_chunks) = (0usize, 0usize, 0usize);

    for entry in WalkDir::new(&content_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let is_md = matches!(
            path.extension().and_then(|s| s.to_str()),
            Some("md") | Some("mdx")
        );
        if !is_md {
            continue;
        }

        let parsed = match parse_file(path) {
            Ok(p) => p,
            Err(e) => {
                tracing::warn!("bỏ qua {} ({e})", path.display());
                continue;
            }
        };
        let slug = parsed.front.slug.clone();
        seen_slugs.insert(slug.clone());

        let new_ts = parsed.front.updated_at.trim();
        if !args.force && !new_ts.is_empty() {
            if let Some(old_ts) = last_source_updated_at(&conn, &slug)? {

                if old_ts.as_str() >= new_ts {
                    n_skipped += 1;
                    tracing::debug!("skip {slug} (không mới hơn)");
                    continue;
                }
            }
        }

        if parsed.chunks.is_empty() {
            tracing::warn!("{slug}: không có chunk nào, bỏ qua");
            continue;
        }

        let contents: Vec<String> = parsed.chunks.iter().map(|c| c.content.clone()).collect();
        let mut embeddings: Vec<Vec<f32>> = Vec::with_capacity(contents.len());
        for batch in contents.chunks(EMBED_BATCH) {
            let embs = embedder
                .embed_batch(batch)
                .await
                .with_context(|| format!("embed lỗi ở bài {slug}"))?;
            embeddings.extend(embs);
        }

        delete_article(&conn, &slug)?;
        let rows: Vec<ChunkRow> = parsed
            .chunks
            .iter()
            .zip(embeddings.iter())
            .map(|(c, emb)| ChunkRow {
                article_slug: &slug,
                title: &parsed.front.title,
                section: &c.section,
                content: &c.content,
                updated_at: new_ts,
                embedding: emb,
            })
            .collect();
        insert_chunks(&mut conn, &rows, cfg.embed_dim)?;
        upsert_ingest_state(&conn, &slug, new_ts, &now, rows.len())?;

        n_ingested += 1;
        n_chunks += rows.len();
        tracing::info!("ingested {slug}: {} chunk", rows.len());
    }

    if args.prune {
        let db_slugs: Vec<String> = {
            let mut stmt = conn.prepare("SELECT article_slug FROM ingest_state")?;
            let it = stmt.query_map([], |r| r.get::<_, String>(0))?;
            it.filter_map(|r| r.ok()).collect()
        };
        for slug in db_slugs {
            if !seen_slugs.contains(&slug) {
                delete_article(&conn, &slug)?;
                conn.execute("DELETE FROM ingest_state WHERE article_slug = ?1", [&slug])?;
                tracing::info!("prune {slug} (không còn file)");
            }
        }
    }

    tracing::info!(
        "xong: {n_ingested} bài ingest ({n_chunks} chunk), {n_skipped} bỏ qua"
    );
    Ok(())
}
