export type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly activePrefixes?: readonly string[];
};

export const navigationItems: readonly NavigationItem[] = [
  {
    label: "Giới thiệu",
    href: "/tong-quan/",
  },
  {
    label: "Dịch vụ",
    href: "/dich-vu/",
  },
  {
    label: "Kinh nghiệm",
    href: "/kinh-nghiem/",
    activePrefixes: ["/vu-an-tieu-bieu/"],
  },
  {
    label: "Bài viết",
    href: "/bai-viet/",
  },
];
