export type NavigationItem = {
  readonly label: string;
  readonly href: string;
  readonly activePrefixes?: readonly string[];
};

export const navigationItems: readonly NavigationItem[] = [
  {
    label: "Tổng quan",
    href: "/tong-quan/",
  },
  {
    label: "Dịch vụ",
    href: "/dich-vu/",
  },
  {
    label: "Kinh nghiệm",
    href: "/bai-viet/",
    activePrefixes: ["/vu-an-tieu-bieu/"],
  },
];
