const menuButton = document.querySelector<HTMLButtonElement>("[data-menu-button]");
const closeButton = document.querySelector<HTMLButtonElement>("[data-menu-close]");
const drawer = document.querySelector<HTMLElement>("[data-mobile-drawer]");
const drawerLinks = document.querySelectorAll<HTMLAnchorElement>("[data-mobile-drawer] a");

const DRAWER_TRANSITION_MS = 200;
let isDrawerAnimating = false;
let drawerUnlockTimeoutId: ReturnType<typeof setTimeout> | null = null;

const setMenuState = (isOpen: boolean) => {
  if (!menuButton || !drawer) return;
  if (isDrawerAnimating) return;

  const currentlyOpen = menuButton.getAttribute("aria-expanded") === "true";
  if (currentlyOpen === isOpen) return;

  isDrawerAnimating = true;

  const unlock = () => {
    isDrawerAnimating = false;
    if (drawerUnlockTimeoutId !== null) {
      clearTimeout(drawerUnlockTimeoutId);
      drawerUnlockTimeoutId = null;
    }
  };

  drawer.addEventListener(
    "transitionend",
    (event) => {
      if (event.target === drawer && event.propertyName === "transform") unlock();
    },
    { once: true }
  );
  drawerUnlockTimeoutId = setTimeout(unlock, DRAWER_TRANSITION_MS + 50);

  menuButton.setAttribute("aria-expanded", String(isOpen));
  drawer.classList.toggle("translate-x-full", !isOpen);
  drawer.classList.toggle("translate-x-0", isOpen);
  document.body.classList.toggle("nav-open", isOpen);
};

menuButton?.addEventListener("click", () => setMenuState(true));
closeButton?.addEventListener("click", () => setMenuState(false));

drawerLinks.forEach((link) => {
  link.addEventListener("click", () => setMenuState(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuState(false);
});
