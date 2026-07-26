use crate::{config::Config, db::Pool, embed::Embedder};
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState(pub Arc<Inner>);

pub struct Inner {
    pub config: Config,
    pub http: reqwest::Client,
    pub pool: Pool,
    pub embedder: Embedder,
}

impl AppState {
    pub fn config(&self) -> &Config {
        &self.0.config
    }
    pub fn http(&self) -> &reqwest::Client {
        &self.0.http
    }
    pub fn pool(&self) -> &Pool {
        &self.0.pool
    }
    pub fn embedder(&self) -> &Embedder {
        &self.0.embedder
    }
}
