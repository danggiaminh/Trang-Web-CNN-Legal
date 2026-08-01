use anyhow::{bail, Context, Result};
use pulldown_cmark::{Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use serde::Deserialize;
use std::path::Path;

const TARGET_CHARS: usize = 1800;
const MIN_CHARS: usize = 200;

pub const HEADING_SEP: &str = " › ";

#[derive(Debug, Deserialize)]
pub struct Frontmatter {
    pub title: String,
    pub slug: String,
    #[serde(default)]
    pub category: String,

    #[serde(default)]
    pub url: String,

    #[serde(alias = "updated_at", alias = "updatedAt", default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {


    pub heading_path: String,


    pub content: String,
}

#[derive(Debug)]
pub struct ParsedArticle {
    pub front: Frontmatter,
    pub body: String,
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
    let front: Frontmatter = serde_yaml::from_str(&yaml)
        .with_context(|| format!("frontmatter lỗi ở {}", path.display()))?;

    if front.slug.trim().is_empty() {
        bail!("frontmatter thiếu slug ở {}", path.display());
    }

    Ok(ParsedArticle {
        front,
        body: body.to_string(),
        chunks: chunks_from_markdown(body),
    })
}

pub fn chunks_from_markdown(markdown: &str) -> Vec<Chunk> {
    build_chunks(extract_sections(markdown))
}

struct RawSection {
    heading_path: String,
    text: String,
}


fn heading_rank(level: HeadingLevel) -> Option<u8> {
    match level {
        HeadingLevel::H1 => Some(1),
        HeadingLevel::H2 => Some(2),
        HeadingLevel::H3 => Some(3),
        _ => None,
    }
}

fn path_of(stack: &[(u8, String)]) -> String {
    stack
        .iter()
        .map(|(_, t)| t.as_str())
        .collect::<Vec<_>>()
        .join(HEADING_SEP)
}

fn extract_sections(markdown: &str) -> Vec<RawSection> {
    let parser = Parser::new_ext(markdown, Options::all());

    let mut sections: Vec<RawSection> = Vec::new();
    let mut stack: Vec<(u8, String)> = Vec::new();
    let mut cur = RawSection {
        heading_path: String::new(),
        text: String::new(),
    };
    let mut heading_rank_open: Option<u8> = None;
    let mut in_heading = false;
    let mut heading_buf = String::new();

    let flush = |sections: &mut Vec<RawSection>, cur: &mut RawSection| {
        if !cur.text.trim().is_empty() {
            sections.push(RawSection {
                heading_path: cur.heading_path.clone(),
                text: std::mem::take(&mut cur.text),
            });
        } else {
            cur.text.clear();
        }
    };

    for ev in parser {
        match ev {
            Event::Start(Tag::Heading { level, .. }) => {
                heading_rank_open = heading_rank(level);
                if heading_rank_open.is_some() {
                    flush(&mut sections, &mut cur);
                }
                in_heading = true;
                heading_buf.clear();
            }
            Event::End(TagEnd::Heading(_)) => {
                in_heading = false;
                let text = heading_buf.trim().to_string();
                match heading_rank_open.take() {
                    Some(rank) if !text.is_empty() => {


                        stack.retain(|(lv, _)| *lv < rank);
                        stack.push((rank, text));
                        cur.heading_path = path_of(&stack);
                    }

                    None if !text.is_empty() => {
                        cur.text.push_str(&text);
                        cur.text.push('\n');
                    }
                    _ => {}
                }
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
        let clean = normalize_ws(&sec.text);
        if clean.is_empty() {
            continue;
        }
        for piece in split_by_size(&clean, TARGET_CHARS) {
            out.push(Chunk {
                heading_path: sec.heading_path.clone(),
                content: piece,
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
            if c.content.chars().count() < MIN_CHARS && last.heading_path == c.heading_path {
                last.content.push('\n');
                last.content.push_str(&c.content);
                continue;
            }
        }
        out.push(c);
    }
    out
}


pub fn embed_text(title: &str, heading_path: &str, content: &str) -> String {
    let mut s = String::with_capacity(title.len() + heading_path.len() + content.len() + 2);
    if !title.is_empty() {
        s.push_str(title);
        s.push('\n');
    }
    if !heading_path.is_empty() {
        s.push_str(heading_path);
        s.push('\n');
    }
    s.push_str(content);
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn heading_path_giu_ca_cap_cha() {
        let md = "# Phần I\n\nMở đầu.\n\n## Mục A\n\nNội dung A.\n\n### Tiểu mục A1\n\nNội dung A1.\n\n## Mục B\n\nNội dung B.\n";
        let paths: Vec<&str> = chunks_from_markdown(md)
            .iter()
            .map(|c| c.heading_path.as_str())
            .map(|s| Box::leak(s.to_string().into_boxed_str()) as &str)
            .collect();
        assert_eq!(
            paths,
            vec![
                "Phần I",
                "Phần I › Mục A",
                "Phần I › Mục A › Tiểu mục A1",
                "Phần I › Mục B",
            ]
        );
    }


    #[test]
    fn cung_cap_thi_thay_the_khong_chong_them() {
        let md = "## A\n\nx.\n\n### A1\n\ny.\n\n### A2\n\nz.\n";
        let c = chunks_from_markdown(md);
        assert_eq!(c.last().unwrap().heading_path, "A › A2");
    }


    #[test]
    fn content_khong_chua_tieu_de() {
        let md = "## Thẩm quyền xét xử\n\nToà án nhân dân cấp tỉnh giải quyết.\n";
        let c = chunks_from_markdown(md);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].heading_path, "Thẩm quyền xét xử");
        assert!(
            !c[0].content.contains("Thẩm quyền xét xử"),
            "content phải sạch: {:?}",
            c[0].content
        );
    }

    #[test]
    fn embed_text_co_ngu_canh_con_ban_luu_thi_khong() {
        let t = embed_text("Án lệ 13/2017", "Mục A › A1", "khoản 2 quy định…");
        assert!(t.starts_with("Án lệ 13/2017\nMục A › A1\n"));
        assert!(t.ends_with("khoản 2 quy định…"));
    }

    #[test]
    fn h4_tro_xuong_khong_tao_muc_moi() {
        let md = "## A\n\nx.\n\n#### Ghi chú nhỏ\n\ny.\n";
        let c = chunks_from_markdown(md);
        assert!(c.iter().all(|x| x.heading_path == "A"), "{c:?}");
        assert!(
            c.iter().any(|x| x.content.contains("Ghi chú nhỏ")),
            "chữ của H4 không được mất"
        );
    }
}
