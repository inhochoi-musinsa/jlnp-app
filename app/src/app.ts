import { detectRuntimeMode, runtimeModeLabel } from "./runtime";
import { FONT_PX, SettingsStore, type UserSettings } from "./domain/settings";
import { DEFAULT_TARGET_LEVEL } from "../../shared/examSpec";
import { DEMO_ITEMS } from "./content/demoItems";
import { QuizShell } from "./ui/quiz";
import { renderHome, renderLearn, renderReport, renderSettings, type PageCtx } from "./ui/pages";
import { buildTabBar, tabFromHash } from "./ui/shell";
import { h } from "./ui/dom";

declare const __APP_VERSION__: string;
const SETTINGS_KEY = "jlpt.settings.hint";

export function applySettings(doc: Document, s: UserSettings): void {
  const r = doc.documentElement;
  r.style.setProperty("--fs", FONT_PX[s.fontScale] + "px");
  r.dataset.furigana = s.furiganaMode;
  r.dataset.theme = s.theme;
}

function loadHint(): unknown {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"); } catch { return null; }
}
function saveHint(s: UserSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable (file://, private mode) */ }
}

export function mount(root: HTMLElement, env: { protocol: string; hostname: string; hash: string }): { go: (hash: string) => void } {
  const mode = detectRuntimeMode(env.protocol, env.hostname);
  const settings = new SettingsStore(loadHint(), saveHint);
  applySettings(document, settings.get());
  let quiz: QuizShell | null = null;

  const ctx: PageCtx = {
    mode, settings, version: __APP_VERSION__, availableLevels: [DEFAULT_TARGET_LEVEL],
    startDemo: mode === "LOCALHOST_DEV" ? () => { location.hash = "#demo"; } : undefined,
  };

  const draw = () => {
    quiz?.destroy(); quiz = null;
    root.textContent = "";
    const route = tabFromHash(location.hash);
    if (route === "demo" && mode === "LOCALHOST_DEV") {
      const host = h("main", { class: "view-quiz" });
      root.append(host);
      quiz = new QuizShell(host, DEMO_ITEMS, { onExit: () => { location.hash = "#learn"; } });
      return;
    }
    const tab = route === "quiz" || route === "demo" ? "learn" : route;
    const banner = mode === "LOCAL_FILE" ? h("div", { class: "banner warn", role: "status" }, "로컬 모드: Google 연결이 되지 않으며 기록이 이 기기에 보존된다는 보장이 없습니다. 백업을 자주 내보내세요.") : null;
    const view = h("main", { class: "view" });
    if (banner) root.append(banner);
    root.append(view, buildTabBar(tab));
    ({ home: renderHome, learn: renderLearn, report: renderReport, settings: renderSettings }[tab] as (r: HTMLElement, c: PageCtx) => void)(view, ctx);
  };

  settings.subscribe((s, keys) => { applySettings(document, s); if (keys.includes("targetLevel")) draw(); });
  addEventListener("hashchange", draw);
  draw();
  return { go: (hash) => { location.hash = hash; } };
}

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) mount(root, { protocol: location.protocol, hostname: location.hostname, hash: location.hash });
}
export { runtimeModeLabel };
