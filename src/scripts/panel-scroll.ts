const panel = document.querySelector<HTMLElement>("main.site-panel");
const storageKey = `panel-scroll:${location.pathname}`;

if (panel) {
  const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const saved = sessionStorage.getItem(storageKey);

  if (navigation?.type === "back_forward" && saved !== null) {
    requestAnimationFrame(() => {
      panel.scrollTop = Number(saved);
    });
  }

  window.addEventListener("pagehide", () => {
    sessionStorage.setItem(storageKey, String(panel.scrollTop));
  });
}
