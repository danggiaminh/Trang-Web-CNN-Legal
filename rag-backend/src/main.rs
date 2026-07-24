use std::sync::Arc;

use axum::{
    routing::{get, post},
    Router,
};
use cnn_legal_rag::{
    config::Config,
    db::{build_pool, init_schema},
    embed::Embedder,
    routes::{chat, health},
    state::{AppState, Inner},
};
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let cfg = Config::from_env()?;
    tracing::info!(config = ?cfg, "khởi động CNN Legal RAG");

    let http = reqwest::Client::builder()
        .pool_max_idle_per_host(16)
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let pool = build_pool(&cfg.db_path)?;
    {
        let conn = pool.get()?;
        init_schema(&conn, cfg.embed_dim)?;
    }

    let embedder = Embedder::new(
        http.clone(),
        &cfg.embed_base_url,
        cfg.embed_api_key.clone(),
        &cfg.embed_model,
        cfg.embed_dim,
    );

    let bind_addr = cfg.bind_addr.clone();
    let state = AppState(Arc::new(Inner {
        config: cfg.clone(),
        http,
        pool,
        embedder,
    }));

    let governor = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(cfg.rate_limit_per_second)
            .burst_size(cfg.rate_limit_burst)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("cấu hình governor không hợp lệ"),
    );

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/chat", post(chat))

        .layer(GovernorLayer { config: governor })
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("nghe tại http://{bind_addr}");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("nhận tín hiệu dừng, đóng service");
}
