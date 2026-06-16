export interface NavItem { label: string; href: string; icon: string; }

export const NAV_ITEMS: NavItem[] = [
  { label: "Teams", href: "/dashboard", icon: "Users" },
  { label: "Standups", href: "/standups", icon: "ListChecks" },
  { label: "Reports", href: "/reports", icon: "MessageSquare" },
  { label: "Settings", href: "/settings", icon: "Settings" },
];
