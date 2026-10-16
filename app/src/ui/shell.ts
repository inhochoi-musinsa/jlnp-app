import { h } from "./dom";

export const TABS = [
  { id: "home", label: "홈" },
  { id: "learn", label: "학습" },
  { id: "report", label: "리포트" },
  { id: "settings", label: "설정" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function tabFromHash(hash: string): TabId | "quiz" | "demo" {
  const id = hash.replace(/^#/, "");
  if (id === "quiz" || id === "demo") return id;
  return (TABS.find((t) => t.id === id)?.id ?? "home") as TabId;
}

export function buildTabBar(active: TabId): HTMLElement {
  return h("nav", { class: "tabbar", "aria-label": "주요 메뉴" },
    ...TABS.map((t) => h("a", { href: `#${t.id}`, class: t.id === active ? "tab active" : "tab", "aria-current": t.id === active ? "page" : null }, t.label)));
}
