use anyhow::{bail, Context, Result};
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Deserialize;
use std::path::Path;

const TARGET_CHARS: usize = 1800;
const MIN_CHARS: usize = 200;

#[derive(Debug, Deserialize)]
pub struct Frontmatter {
    pub title: String,
    pub slug: String,
    #[serde(default)]
    pub category: String,

    #[serde(alias = "updated_at", alias = "updatedAt", default)]
    pub updated_at: String,
}

#[derive(Debug)]
pub struct Chunk {
    pub section: String,
    pub content: String,
}

#[derive(Debug)]
pub struct ParsedArticle {
    pub front: Frontmatter,
    pub chunks: Vec<Chunk>,
}

fn split_frontmatter(raw: &str) -> Result<(String, &str)> {
    let raw = raw.trim_start_matches('\u{feff}');
    let rest = raw
        .strip_prefix("---")
        .context("thiếu frontmatter (không mở đầu bằng ---)")?;

    let end = rest
        .find("\n---")
        .context("thiếu dấu đóng frontmatter ---")?;
    let yaml = rest[..end].trim().to_string();
    let body = rest[end + 4..].trim_start_matches(['\r', '\n']);
    Ok((yaml, body))
}

pub fn parse_file(path: &Path) -> Result<ParsedArticle> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("không đọc được {}", path.display()))?;
    let (yaml, body) = split_frontmatter(&raw)?;
    let front: Frontmatter =
        serde_yaml::from_str(&yaml).with_context(|| format!("frontmatter lỗi ở {}", path.display()))?;

    if front.slug.trim().is_empty() {
        bail!("frontmatter thiếu slug ở {}", path.display());
    }

    let sections = extract_sections(body);
    let chunks = build_chunks(sections);
    Ok(ParsedArticle { front, chunks })
}

struct RawSection {
    heading: String,
    text: String,
}

fn extract_sections(markdown: &str) -> Vec<RawSection> {
    let parser = Parser::new_ext(markdown, Options::all());

    let mut sections: Vec<RawSection> = Vec::new();
    let mut cur = RawSection {
        heading: String::new(),
        text: String::new(),
    };
    let mut in_heading = false;
    let mut heading_buf = String::new();

    let flush = |sections: &mut Vec<RawSection>, cur: &mut RawSection| {
        if !cur.text.trim().is_empty() || !cur.heading.trim().is_empty() {
            sections.push(RawSection {
                heading: std::mem::take(&mut cur.heading),
                text: std::mem::take(&mut cur.text),
            });
        }
    };

    for ev in parser {
        match ev {
            Event::Start(Tag::Heading { level, .. }) => {
                if matches!(level, HeadingLevel::H1 | HeadingLevel::H2 | HeadingLevel::H3) {
                    flush(&mut sections, &mut cur);
                }
                in_heading = true;
                heading_buf.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                in_heading = false;
                cur.heading = heading_buf.trim().to_string();
            }
            Event::Text(t) | Event::Code(t) => {
                if in_heading {
                    heading_buf.push_str(&t);
                } else {
                    cur.text.push_str(&t);
                }
            }

            Event::End(TagEnd::Paragraph)
            | Event::End(TagEnd::Item)
            | Event::End(TagEnd::BlockQuote(_)) => {
                cur.text.push('\n');
            }
            Event::SoftBreak | Event::HardBreak => cur.text.push(' '),
            _ => {}
        }
    }
    flush(&mut sections, &mut cur);
    sections
}

fn build_chunks(sections: Vec<RawSection>) -> Vec<Chunk> {
    let mut out: Vec<Chunk> = Vec::new();

    for sec in sections {
        let heading = sec.heading.trim().to_string();
        let clean = normalize_ws(&sec.text);
        if clean.is_empty() {
            continue;
        }

        for piece in split_by_size(&clean, TARGET_CHARS) {

            let content = if heading.is_empty() {
                piece
            } else {
                format!("{heading}\n{piece}")
            };
            out.push(Chunk {
                section: heading.clone(),
                content,
            });
        }
    }

    merge_tiny(out)
}

fn normalize_ws(s: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    for line in s.split('\n') {
        let l = line.split_whitespace().collect::<Vec<_>>().join(" ");
        if !l.is_empty() {
            lines.push(l);
        }
    }
    lines.join("\n")
}

fn split_by_size(text: &str, target: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut buf = String::new();

    for para in text.split('\n') {
        if para.is_empty() {
            continue;
        }

        if para.chars().count() > target {
            if !buf.is_empty() {
                chunks.push(std::mem::take(&mut buf));
            }
            for sentence_group in split_sentences(para, target) {
                chunks.push(sentence_group);
            }
            continue;
        }
        if buf.chars().count() + para.chars().count() > target && !buf.is_empty() {
            chunks.push(std::mem::take(&mut buf));
        }
        if !buf.is_empty() {
            buf.push('\n');
        }
        buf.push_str(para);
    }
    if !buf.is_empty() {
        chunks.push(buf);
    }
    chunks
}

fn split_sentences(para: &str, target: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut cur = String::new();
    for ch in para.chars() {
        cur.push(ch);
        if matches!(ch, '.' | '!' | '?' | ';') {
            if buf.chars().count() + cur.chars().count() > target && !buf.is_empty() {
                out.push(std::mem::take(&mut buf));
            }
            buf.push_str(&cur);
            cur.clear();
        }
    }
    buf.push_str(&cur);
    if !buf.is_empty() {
        out.push(buf);
    }
    out
}

fn merge_tiny(chunks: Vec<Chunk>) -> Vec<Chunk> {
    let mut out: Vec<Chunk> = Vec::new();
    for c in chunks {
        if let Some(last) = out.last_mut() {
            if c.content.chars().count() < MIN_CHARS && last.section == c.section {
                last.content.push('\n');
                last.content.push_str(&c.content);
                continue;
            }
        }
        out.push(c);
    }
    out
}
