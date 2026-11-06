const processed = new Set<string>();
let dwellTimer: ReturnType<typeof setTimeout> | undefined;

async function preloadPageImages(rawHref: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawHref, location.href);
  } catch {
    return;
  }

  if (url.origin !== location.origin) return;
  if (url.pathname === location.pathname) return;
  if (processed.has(url.pathname)) return;
  processed.add(url.pathname);

  try {

    const res = await fetch(url.href, {
      cache: "force-cache",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;

    const html = await res.text();

    whenIdle(() => {
      const doc = new DOMParser().parseFromString(html, "text/html");
      const imgs = doc.querySelectorAll<HTMLImageElement>(
        'img[loading="eager"], img[fetchpriority="high"]'
      );

      // Tải đúng ứng viên mà trang đích sẽ dùng: <source> đầu tiên của <picture>
      // có media khớp khung nhìn hiện tại (AVIF), rồi srcset/sizes của chính ảnh;
      // chỉ rơi về src khi không có srcset. Bản cũ lấy src — tức bản rộng nhất —
      // nên rê chuột vào link "/" tải về 303 KB ảnh không bao giờ được hiển thị.
      imgs.forEach((img) => {
        const source =
          img.parentElement?.tagName === "PICTURE"
            ? [...img.parentElement.querySelectorAll("source[srcset]")].find((s) => {
                const media = s.getAttribute("media");
                return !media || matchMedia(media).matches;
              }) ?? null
            : null;
        const srcset = source?.getAttribute("srcset") ?? img.getAttribute("srcset");
        const sizes = source?.getAttribute("sizes") ?? img.getAttribute("sizes");
        const src = img.getAttribute("src");
        try {
          const preloader = new Image();
          if (sizes) preloader.sizes = sizes;
          if (srcset) preloader.srcset = srcset;
          else if (src) preloader.src = new URL(src, url.href).href;
        } catch {
          void 0;
        }
      });
    });
  } catch {
    void 0;
  }
}

function whenIdle(task: () => void): void {
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") ric(task, { timeout: 1000 });
  else setTimeout(task, 0);
}

function onIntent(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  // Chỉ chuột thật, hoặc focus bằng bàn phím (focusin không có pointerType nên xét :focus-visible).
  // pointerover của màn cảm ứng là lúc ngón tay bắt đầu cuộn trang; focus do chạm hay nhấp chuột
  // thì trang đã đang chuyển đi.
  if ((event as PointerEvent).pointerType !== "mouse" && !target.matches(":focus-visible")) return;

  // Link "#…", href rỗng, mailto:, tel: không cần lọc ở đây: preloadPageImages bỏ qua đường dẫn
  // trùng trang hiện tại và origin khác (mailto:/tel: có origin "null").
  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) return;
  if (link.target === "_blank") return;
  if (link.hasAttribute("download")) return;

  // Phải dừng ~90 ms trên link (prefetch của Astro chờ 80 ms): hết giờ mà chuột đã rời link hoặc
  // focus đã sang chỗ khác thì thôi, nên lướt chuột ngang hàng link hay Tab lướt qua không tải gì.
  // Xét lại lúc hết giờ thay cho nghe thêm pointerout/focusout: script nằm trong mọi trang.
  clearTimeout(dwellTimer);
  dwellTimer = setTimeout(() => link.matches(":hover,:focus-visible") && preloadPageImages(link.href), 90);
}

// Tiết kiệm dữ liệu hoặc mạng chậm (slow-2g, 2g, 3g) thì bỏ hẳn: một banner tải trước nặng hàng
// trăm KB cho trang chưa chắc được mở. Trình duyệt không có navigator.connection: test(undefined)
// so với chuỗi "undefined", không khớp.
const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } })
  .connection;
if (!connection?.saveData && !/[23]g/.test(connection?.effectiveType!)) {
  document.addEventListener("pointerover", onIntent);
  document.addEventListener("focusin", onIntent);
}
