const processed = new Set<string>();

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
    const res = await fetch(url.href, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return;

    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = doc.querySelectorAll<HTMLImageElement>(
      'img[loading="eager"], img[fetchpriority="high"]'
    );

    imgs.forEach((img) => {
      const src = img.getAttribute("src");
      if (!src) return;
      try {
        const preloader = new Image();
        preloader.src = new URL(src, url.href).href;
      } catch {
        void 0;
      }
    });
  } catch {
    void 0;
  }
}

function onIntent(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const link = target.closest<HTMLAnchorElement>("a[href]");
  if (!link) return;

  const href = link.getAttribute("href");
  if (!href) return;
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
  if (link.target === "_blank") return;
  if (link.hasAttribute("download")) return;

  preloadPageImages(link.href);
}

document.addEventListener("pointerover", onIntent, { passive: true });
document.addEventListener("focusin", onIntent, { passive: true });
