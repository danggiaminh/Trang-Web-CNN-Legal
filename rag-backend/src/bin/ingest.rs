use anyhow::Result;
use clap::Parser;
use cnn_legal_rag::{
    chunk::parse_file,
    config::Config,
    db::{all_slugs, build_pool, delete_doc, init_schema},
    embed::Embedder,
    pipeline::{store_doc, IngestDoc, StoreOutcome},
};
use std::collections::HashSet;
use walkdir::WalkDir;


#[derive(Parser)]
#[command(about = "Ingest bài viết CNN Legal (.md cục bộ) vào vector store")]
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

    let pool = build_pool(&db_path)?;
    {
        let conn = pool.get()?;
        init_schema(&conn, cfg.embed_dim, true)?;
    }

    let mut seen: HashSet<String> = HashSet::new();
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

        let doc = IngestDoc::from_markdown(
            parsed.front.slug.clone(),
            parsed.front.title.clone(),
            parsed.front.category.clone(),
            parsed.front.url.clone(),
            parsed.front.updated_at.trim(),
            parsed.body,
        );
        seen.insert(doc.slug.clone());

        match store_doc(&pool, &embedder, cfg.embed_dim, &doc, args.force).await {
            Ok(StoreOutcome::Ingested { chunks }) => {
                n_ingested += 1;
                n_chunks += chunks;
                tracing::info!("ingested {}: {} chunk", doc.slug, chunks);
            }
            Ok(StoreOutcome::Skipped) => {
                n_skipped += 1;
                tracing::debug!("skip {} (không mới hơn)", doc.slug);
            }
            Ok(StoreOutcome::Empty) => {
                tracing::warn!("{}: không có chunk nào, bỏ qua", doc.slug);
            }
            Err(e) => {
                tracing::error!("lỗi ingest {}: {e:#}", doc.slug);
                return Err(e);
            }
        }
    }

    if args.prune {
        let conn = pool.get()?;
        for slug in all_slugs(&conn)? {
            if !seen.contains(&slug) {
                delete_doc(&conn, &slug)?;
                tracing::info!("prune {slug} (không còn file)");
            }
        }
    }

    tracing::info!("xong: {n_ingested} bài ingest ({n_chunks} chunk), {n_skipped} bỏ qua");
    Ok(())
}
