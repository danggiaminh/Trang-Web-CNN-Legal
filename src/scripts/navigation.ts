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

  // Ngăn kéo đóng thì inert: Tab, trình đọc màn hình và tìm trong trang không lọt vào nữa.
  // Mở thì đưa focus tới nút Đóng, đóng thì trả về nút Mở menu. preventScroll: lúc này ngăn
  // kéo còn nằm ngoài màn hình, focus mà cuộn theo thì nó bị kéo lệch khỏi chỗ.
  drawer.inert = !isOpen;
  (isOpen ? closeButton : menuButton)?.focus({ preventScroll: true });
};

menuButton?.addEventListener("click", () => setMenuState(true));
closeButton?.addEventListener("click", () => setMenuState(false));

drawerLinks.forEach((link) => {
  link.addEventListener("click", () => setMenuState(false));
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setMenuState(false);

  // Ngăn kéo mở phủ kín màn hình: Tab ở link cuối thì vòng về link đầu, Shift+Tab ở link đầu
  // thì về link cuối, để focus không lọt xuống trang nằm khuất sau ngăn kéo. Xét inert === false
  // (không phải !inert): trình duyệt chưa hỗ trợ inert thì link của ngăn kéo đóng vẫn nhận focus
  // và inert là undefined tới lần mở đầu, vòng lại ở đó thì Tab kẹt mãi trong ngăn kéo vô hình.
  const last = drawerLinks.length - 1;
  if (event.key === "Tab" && event.target === drawerLinks[event.shiftKey ? 0 : last] && drawer!.inert === false) {
    event.preventDefault();
    drawerLinks[event.shiftKey ? last : 0].focus();
  }
});
