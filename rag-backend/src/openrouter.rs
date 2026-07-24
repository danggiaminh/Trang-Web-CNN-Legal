use crate::config::Config;
use anyhow::Result;
use futures_util::{Stream, StreamExt};
use serde::Serialize;
use serde_json::Value;

#[derive(Serialize)]
pub struct ChatMessage {
    pub role: &'static str,
    pub content: String,
}

#[derive(Serialize)]
struct ProviderCfg<'a> {
    order: [&'a str; 1],
    allow_fallbacks: bool,
}

#[derive(Serialize)]
struct Reasoning<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    effort: Option<&'a str>,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    provider: ProviderCfg<'a>,
    stream: bool,
    reasoning: Reasoning<'a>,
    messages: &'a [ChatMessage],
}

pub async fn call_openrouter(
    http: &reqwest::Client,
    cfg: &Config,
    messages: &[ChatMessage],
) -> Result<reqwest::Response> {

    let reasoning = match cfg.openrouter_reasoning.trim().to_lowercase().as_str() {
        "off" | "none" | "disabled" | "false" | "" => Reasoning {
            enabled: Some(false),
            effort: None,
        },
        _ => Reasoning {
            enabled: None,
            effort: Some(cfg.openrouter_reasoning.as_str()),
        },
    };

    let body = ChatRequest {
        model: &cfg.openrouter_model,
        provider: ProviderCfg {
            order: [cfg.openrouter_provider.as_str()],
            allow_fallbacks: false,
        },
        stream: true,
        reasoning,
        messages,
    };

    let mut req = http
        .post(&cfg.openrouter_base_url)
        .bearer_auth(&cfg.openrouter_api_key)
        .header("Content-Type", "application/json");
    if let Some(r) = &cfg.openrouter_referer {
        req = req.header("HTTP-Referer", r);
    }
    if let Some(t) = &cfg.openrouter_title {
        req = req.header("X-Title", t);
    }
    Ok(req.json(&body).send().await?)
}

pub fn retry_after_ms(resp: &reqwest::Response, attempt: u32) -> u64 {
    resp.headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .map(|s| s.min(3) * 1000)
        .unwrap_or_else(|| 400 + (attempt as u64) * 200)
}

pub fn stream_content(
    resp: reqwest::Response,
) -> impl Stream<Item = Result<String>> {
    async_stream::try_stream! {
        let mut bytes = resp.bytes_stream();
        let mut buf = String::new();

        while let Some(chunk) = bytes.next().await {
            let chunk = chunk?;
            buf.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(nl) = buf.find('\n') {
                let line = buf[..nl].trim_end_matches('\r').to_string();
                buf.drain(..=nl);

                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data.is_empty() {
                    continue;
                }
                if data == "[DONE]" {
                    return;
                }
                if let Ok(v) = serde_json::from_str::<Value>(data) {
                    if let Some(tok) = v
                        .get("choices")
                        .and_then(|c| c.get(0))
                        .and_then(|c| c.get("delta"))
                        .and_then(|d| d.get("content"))
                        .and_then(|c| c.as_str())
                    {
                        if !tok.is_empty() {
                            yield tok.to_string();
                        }
                    }
                }
            }
        }
    }
}
