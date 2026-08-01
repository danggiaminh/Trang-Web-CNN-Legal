use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Clone)]
pub struct Embedder {
    client: reqwest::Client,
    base_url: String,
    api_key: Option<String>,
    model: String,
    dim: usize,
}

#[derive(Serialize)]
struct EmbedReq<'a> {
    model: &'a str,
    input: &'a [String],
}

#[derive(Deserialize)]
struct EmbedResp {
    data: Vec<EmbedItem>,
}

#[derive(Deserialize)]
struct EmbedItem {
    embedding: Vec<f32>,
    #[serde(default)]
    index: usize,
}

impl Embedder {
    pub fn new(
        client: reqwest::Client,
        base_url: &str,
        api_key: Option<String>,
        model: &str,
        dim: usize,
    ) -> Self {
        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            model: model.to_string(),
            dim,
        }
    }

    pub fn dim(&self) -> usize {
        self.dim
    }

    pub async fn embed_batch(&self, inputs: &[String]) -> Result<Vec<Vec<f32>>> {
        if inputs.is_empty() {
            return Ok(vec![]);
        }
        let url = format!("{}/embeddings", self.base_url);
        let mut req = self.client.post(&url).json(&EmbedReq {
            model: &self.model,
            input: inputs,
        });
        if let Some(key) = &self.api_key {
            req = req.bearer_auth(key);
        }

        let resp = req.send().await.context("gọi embedding thất bại")?;
        if !resp.status().is_success() {

            bail!("embedding trả về HTTP {}", resp.status());
        }
        let mut parsed: EmbedResp = resp.json().await.context("parse embedding lỗi")?;

        parsed.data.sort_by_key(|d| d.index);

        let out: Vec<Vec<f32>> = parsed.data.into_iter().map(|d| d.embedding).collect();
        anyhow::ensure!(
            out.len() == inputs.len(),
            "số embedding ({}) không khớp số input ({})",
            out.len(),
            inputs.len()
        );
        if let Some(first) = out.first() {
            anyhow::ensure!(
                first.len() == self.dim,
                "model trả {} chiều nhưng EMBED_DIM={}",
                first.len(),
                self.dim
            );
        }
        Ok(out)
    }

    pub async fn embed_one(&self, input: &str) -> Result<Vec<f32>> {
        let mut v = self.embed_batch(&[input.to_string()]).await?;
        Ok(v.pop().unwrap_or_default())
    }
}
