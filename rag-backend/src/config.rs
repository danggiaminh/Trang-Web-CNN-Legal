use anyhow::{Context, Result};
use std::env;

#[derive(Clone)]
pub struct Config {

    pub openrouter_api_key: String,

    pub openrouter_base_url: String,
    pub openrouter_model: String,
    pub openrouter_provider: String,
    pub openrouter_referer: Option<String>,
    pub openrouter_title: Option<String>,

    pub openrouter_reasoning: String,

    pub embed_base_url: String,
    pub embed_api_key: Option<String>,
    pub embed_model: String,
    pub embed_dim: usize,

    pub db_path: String,
    pub content_dir: String,
    pub bind_addr: String,
    pub top_k: usize,
    pub rate_limit_per_second: u64,
    pub rate_limit_burst: u32,
}

impl Config {
    pub fn from_env() -> Result<Self> {

        let _ = dotenvy::dotenv();

        let req = |k: &str| env::var(k).with_context(|| format!("thiếu biến môi trường {k}"));
        let opt = |k: &str| env::var(k).ok().filter(|v| !v.is_empty());
        let with = |k: &str, d: &str| env::var(k).unwrap_or_else(|_| d.to_string());

        Ok(Self {
            openrouter_api_key: req("OPENROUTER_API_KEY")?,
            openrouter_base_url: with(
                "OPENROUTER_BASE_URL",
                "https://openrouter.ai/api/v1/chat/completions",
            ),
            openrouter_model: with("OPENROUTER_MODEL", "deepseek/deepseek-v4-flash"),
            openrouter_provider: with("OPENROUTER_PROVIDER", "parasail"),
            openrouter_referer: opt("OPENROUTER_REFERER"),
            openrouter_title: opt("OPENROUTER_TITLE"),
            openrouter_reasoning: with("OPENROUTER_REASONING", "off"),

            embed_base_url: with("EMBED_BASE_URL", "http://127.0.0.1:8080/v1"),
            embed_api_key: opt("EMBED_API_KEY"),
            embed_model: with("EMBED_MODEL", "bge-m3"),
            embed_dim: with("EMBED_DIM", "1024")
                .parse()
                .context("EMBED_DIM không phải số")?,

            db_path: with("DB_PATH", "./data/cnn_rag.db"),
            content_dir: with("CONTENT_DIR", "../src/content/articles"),
            bind_addr: with("BIND_ADDR", "127.0.0.1:8787"),
            top_k: with("RAG_TOP_K", "4").parse().unwrap_or(4),
            rate_limit_per_second: with("RATE_LIMIT_PER_SECOND", "1").parse().unwrap_or(1),
            rate_limit_burst: with("RATE_LIMIT_BURST", "6").parse().unwrap_or(6),
        })
    }
}

impl std::fmt::Debug for Config {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("openrouter_api_key", &"***redacted***")
            .field("openrouter_model", &self.openrouter_model)
            .field("openrouter_provider", &self.openrouter_provider)
            .field("embed_base_url", &self.embed_base_url)
            .field("embed_api_key", &self.embed_api_key.as_ref().map(|_| "***redacted***"))
            .field("embed_model", &self.embed_model)
            .field("embed_dim", &self.embed_dim)
            .field("db_path", &self.db_path)
            .field("content_dir", &self.content_dir)
            .field("bind_addr", &self.bind_addr)
            .field("top_k", &self.top_k)
            .finish()
    }
}
