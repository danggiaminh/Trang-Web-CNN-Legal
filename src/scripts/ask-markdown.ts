/**
 * Bộ dựng Markdown cho câu trả lời của trợ lý.
 *
 * Tách ra khỏi AskBox.astro để test được: hàm safeUrl ở đây là rào chắn bảo mật
 * thật, không phải tiện tay. Từ khi bật tra cứu web, nội dung trang lạ đi thẳng
 * vào ngữ cảnh của model, nên một trang độc hoàn toàn có thể dụ nó nhả ra link
 * "javascript:..." và người đọc bấm phải.
 */

export const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/*
 * Chỉ nhận http(s), đường dẫn nội bộ và mailto. Đây KHÔNG phải cẩn thận thừa:
 * từ khi có tra cứu web, nội dung trang lạ đi thẳng vào ngữ cảnh của model,
 * nên một trang độc có thể dụ nó nhả ra "javascript:..." dưới dạng link.
 * escapeHtml phía trên đã xử lý & < > nhưng KHÔNG đụng tới dấu nháy, nên
 * phải tự rào nốt kẻo thoát khỏi thuộc tính href.
 */
export const safeUrl = (raw: string): string | null => {
  const url = raw.trim();
  if (!/^(https?:\/\/|\/|mailto:)/i.test(url)) return null;
  return url.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
};

export const inline = (s: string) => {
  // Rút link ra giữ tạm trước, để các phép thay in đậm/nghiêng bên dưới không
  // cắn vào bên trong href (một dấu * trong URL là đủ làm hỏng thẻ).
  const links: string[] = [];
  const stashed = s.replace(/\[([^\]\n]*)\]\(([^)\s]+)\)/g, (whole, text, url) => {
    const href = safeUrl(url);
    if (!href) return whole;
    const label = String(text).trim() || href;
    const ngoai = /^https?:/i.test(href);
    const attrs = ngoai ? ' target="_blank" rel="noopener noreferrer nofollow"' : "";
    links.push(`<a href="${href}"${attrs}>${label}</a>`);
    // Moc canh bang ky tu NUL: escapeHtml da chay nen text khong the chua no.
    return `\u0000${links.length - 1}\u0000`;
  });

  return stashed
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)] ?? "");
};

export const renderMarkdown = (raw: string) => {
  const lines = escapeHtml(raw).split("\n");
  const bullet = /^\s*[-*]\s+/;
  const ordered = /^\s*\d+\.\s+/;
  const heading = /^\s*#{1,3}\s+(.*)$/;
  let html = "";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (bullet.test(line)) {
      const items: string[] = [];
      while (i < lines.length && bullet.test(lines[i]))
        items.push("<li>" + inline(lines[i++].replace(bullet, "")) + "</li>");
      html += "<ul>" + items.join("") + "</ul>";
    } else if (ordered.test(line)) {
      const items: string[] = [];
      while (i < lines.length && ordered.test(lines[i]))
        items.push("<li>" + inline(lines[i++].replace(ordered, "")) + "</li>");
      html += "<ol>" + items.join("") + "</ol>";
    } else if (heading.test(line)) {
      html += '<p class="ask-h">' + inline(line.replace(heading, "$1")) + "</p>";
      i++;
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !bullet.test(lines[i]) &&
        !ordered.test(lines[i]) &&
        !heading.test(lines[i])
      )
        para.push(inline(lines[i++]));
      html += "<p>" + para.join("<br>") + "</p>";
    }
  }
  return html;
};
