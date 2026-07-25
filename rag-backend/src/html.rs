

pub fn html_to_markdown(html: &str) -> String {
    let s = strip_block(html, "script");
    let s = strip_block(&s, "style");
    let s = strip_comments(&s);
    normalize(&tokens_to_markdown(&s))
}


fn strip_block(input: &str, tag: &str) -> String {
    let lower = input.to_lowercase();
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = String::with_capacity(input.len());
    let mut i = 0usize;
    while i < input.len() {
        if lower[i..].starts_with(&open) {
            if let Some(rel) = lower[i..].find(&close) {
                i += rel + close.len();
                continue;
            } else {
                break;
            }
        }
        let ch = input[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

fn strip_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("<!--") {
        out.push_str(&rest[..start]);
        rest = &rest[start + 4..];
        if let Some(end) = rest.find("-->") {
            rest = &rest[end + 3..];
        } else {
            rest = "";
        }
    }
    out.push_str(rest);
    out
}

fn tokens_to_markdown(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.char_indices().peekable();
    while let Some((idx, ch)) = chars.next() {
        if ch == '<' {

            let mut end = idx + 1;
            let bytes = input.as_bytes();
            while end < input.len() && bytes[end] != b'>' {
                end += 1;
            }
            let tag = &input[idx + 1..end.min(input.len())];
            out.push_str(&tag_marker(tag));

            while let Some(&(j, _)) = chars.peek() {
                if j <= end {
                    chars.next();
                } else {
                    break;
                }
            }
        } else {
            out.push(ch);
        }
    }
    decode_entities(&out)
}


fn tag_marker(tag: &str) -> String {
    let closing = tag.starts_with('/');
    let name: String = tag
        .trim_start_matches('/')
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();

    match name.as_str() {
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
            if closing {
                "\n\n".to_string()
            } else {
                let level = name[1..].parse::<usize>().unwrap_or(2);
                format!("\n\n{} ", "#".repeat(level))
            }
        }
        "p" | "div" | "section" | "article" | "ul" | "ol" | "blockquote" | "figure"
        | "table" | "header" | "footer" => "\n\n".to_string(),
        "li" => {
            if closing {
                String::new()
            } else {
                "\n- ".to_string()
            }
        }
        "br" => "\n".to_string(),
        "tr" => "\n".to_string(),
        "td" | "th" => {
            if closing {
                " ".to_string()
            } else {
                String::new()
            }
        }
        _ => String::new(),
    }
}

fn decode_entities(input: &str) -> String {
    if !input.contains('&') {
        return input.to_string();
    }
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];

        let semi = rest[..rest.len().min(12)].find(';');
        match semi {
            Some(pos) => {
                let ent = &rest[1..pos];
                out.push_str(&decode_one(ent));
                rest = &rest[pos + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn decode_one(ent: &str) -> String {
    if let Some(num) = ent.strip_prefix('#') {
        let code = if let Some(hex) = num.strip_prefix(['x', 'X']) {
            u32::from_str_radix(hex, 16).ok()
        } else {
            num.parse::<u32>().ok()
        };
        if let Some(c) = code.and_then(char::from_u32) {
            return c.to_string();
        }
        return format!("&{ent};");
    }
    match ent {
        "amp" => "&",
        "lt" => "<",
        "gt" => ">",
        "quot" => "\"",
        "apos" | "#39" => "'",
        "nbsp" => " ",
        "hellip" => "…",
        "mdash" => "—",
        "ndash" => "–",
        "lsquo" => "\u{2018}",
        "rsquo" => "\u{2019}",
        "ldquo" => "\u{201C}",
        "rdquo" => "\u{201D}",
        "laquo" => "«",
        "raquo" => "»",
        _ => return format!("&{ent};"),
    }
    .to_string()
}


fn normalize(input: &str) -> String {
    let mut lines: Vec<String> = Vec::new();
    let mut blank_run = 0usize;
    for raw in input.split('\n') {
        let line = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        if line.is_empty() {
            blank_run += 1;
            if blank_run <= 1 && !lines.is_empty() {
                lines.push(String::new());
            }
        } else {
            blank_run = 0;
            lines.push(line);
        }
    }
    while lines.last().map(|l| l.is_empty()).unwrap_or(false) {
        lines.pop();
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings_and_paragraphs() {
        let html = "<h2>Tiêu đề</h2><p>Đoạn một.</p><p>Đoạn hai.</p>";
        let md = html_to_markdown(html);
        assert!(md.contains("## Tiêu đề"), "md = {md:?}");
        assert!(md.contains("Đoạn một."));
        assert!(md.contains("Đoạn hai."));
    }

    #[test]
    fn lists_and_entities() {
        let html = "<ul><li>A &amp; B</li><li>C&#8217;s</li></ul>";
        let md = html_to_markdown(html);
        assert!(md.contains("- A & B"), "md = {md:?}");
        assert!(md.contains("- C\u{2019}s"), "md = {md:?}");
    }

    #[test]
    fn strips_scripts_styles_comments() {
        let html = "<p>Giữ</p><script>alert(1)</script><style>.x{}</style><!-- ẩn -->";
        let md = html_to_markdown(html);
        assert!(md.contains("Giữ"));
        assert!(!md.contains("alert"));
        assert!(!md.contains(".x{}"));
        assert!(!md.contains("ẩn"));
    }

    #[test]
    fn drops_inline_tags_keeps_text() {
        let html = r#"<p>Xem <a href="https://x.vn">liên kết</a> và <strong>đậm</strong>.</p>"#;
        let md = html_to_markdown(html);
        assert!(md.contains("Xem liên kết và đậm."), "md = {md:?}");
        assert!(!md.contains("href"));
    }
}
