import { detectRuntimeMode, runtimeModeLabel } from "./runtime";
import { FONT_PX, SettingsStore, type UserSettings } from "./domain/settings";
import { DEFAULT_TARGET_LEVEL, type Level } from "../../shared/examSpec";
import { DEMO_ITEMS } from "./content/demoItems";
import { QuizShell } from "./ui/quiz";
import { renderDiagIntro, renderDiagResult, renderHome, renderLearn, renderReport, renderSettings, type PageCtx } from "./ui/pages";
import { buildTabBar, tabFromHash, type TabId } from "./ui/shell";
import { h } from "./ui/dom";
import { AppStorage } from "./storage/session";
import { loadModel, type AppModel } from "./state";
import { ActiveTimer } from "./domain/activity";
import { toQuizItem } from "./domain/content";
import type { QuizEvent, QuizItem } from "./domain/quiz";
import { todayKey } from "./domain/target";

declare const __APP_VERSION__: string;
const SETTINGS_KEY = "jlpt.settings.hint";

export function applySettings(doc: Document, s: UserSettings): void {
  const r = doc.documentElement;
  r.style.setProperty("--fs", FONT_PX[s.fontScale] + "px");
  r.dataset.furigana = s.furiganaMode;
  r.dataset.theme = s.theme;
}

function loadHint(): unknown { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"); } catch { return null; } }
function saveHint(s: UserSettings): void { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable */ } }

type Route = TabId | "demo" | "diag" | "diag-run" | "diag-result" | "study";
const routeOf = (hash: string): Route => {
  const id = hash.replace(/^#/, "");
  if (id === "diag" || id === "diag-run" || id === "diag-result" || id === "study") return id;
  const t = tabFromHash(hash);
  return t === "quiz" ? "learn" : t;
};

export function mount(root: HTMLElement, env: { protocol: string; hostname: string }): void {
  const mode = detectRuntimeMode(env.protocol, env.hostname);
  const settings = new SettingsStore(loadHint(), saveHint);
  applySettings(document, settings.get());
  let quiz: QuizShell | null = null;
  let storage: AppStorage | undefined;
  let model: AppModel | null = null;
  let restoring = false;
  const clock = new ActiveTimer();
  let activity = "STUDY";

  const refresh = async () => { model = await loadModel(storage, settings.get()); draw(); };
  const go = (hash: string) => { if (location.hash === hash) draw(); else location.hash = hash; };

  const flushClock = (): void => {
    const seconds = Math.round(clock.take(Date.now()) / 1000);
    if (seconds >= 1 && storage) storage.record("STUDY_INTERVAL_COMPLETED", "study", { dayKey: todayKey(new Date(), settings.get().timezone), activity, seconds }).catch(() => {});
  };
  const rec = (type: Parameters<AppStorage["record"]>[0], entity: string, payload: unknown) => storage?.record(type, entity, payload).catch(() => {});

  const runQuiz = (host: HTMLElement, items: QuizItem[], o: { exposureType: "DIAGNOSTIC" | "PRACTICE"; activity: string; offset?: number; total?: number; onFinish: () => void; onExit: () => void }) => {
    activity = o.activity;
    clock.touch(Date.now());
    let qStart = 0;
    const onEvent = (e: QuizEvent) => {
      const it = items.find((x) => x.id === e.itemId);
      if (e.type === "QUESTION_PRESENTED") { qStart = clock.elapsed(Date.now()); rec("QUESTION_PRESENTED", e.itemId, { contentId: e.itemId, exposureType: o.exposureType, stimulusId: it?.stimulusId ?? null, order: e.order, contentVersion: 1 }); }
      else if (e.type === "QUESTION_SUBMITTED") rec("QUESTION_SUBMITTED", e.itemId, { contentId: e.itemId, selectedChoiceId: e.selectedChoiceId, isCorrect: e.isCorrect, order: e.order, exposureType: o.exposureType, elapsedActiveMs: Math.round(clock.elapsed(Date.now()) - qStart), contentVersion: 1 });
      else rec("ANSWER_REVEALED", e.itemId, { contentId: e.itemId });
    };
    return new QuizShell(host, items, { onEvent, progress: o.total ? { offset: o.offset ?? 0, total: o.total } : undefined, onExit: () => { flushClock(); o.onExit(); }, onFinish: () => { flushClock(); o.onFinish(); } });
  };

  const ctx: PageCtx = {
    mode, settings, version: __APP_VERSION__, availableLevels: [DEFAULT_TARGET_LEVEL],
    get model() { return model; }, get storage() { return storage; }, go,
    startDemo: mode === "LOCALHOST_DEV" ? () => { location.hash = "#demo"; } : undefined,
    setTarget: async (level: Level, year: number, month: number) => {
      settings.set({ targetLevel: level });
      await storage?.record("EXAM_TARGET_SELECTED", "exam", { level, year, month });
      await refresh();
    },
    confirmDate: async (year, month, date, url) => { await storage?.record("EXAM_NOTICE_VERIFIED", "exam", { year, month, confirmedExamDate: date, sourceUrl: url }); await refresh(); },
  };

  function draw(): void {
    quiz?.destroy(); quiz = null;
    root.textContent = "";
    const route = routeOf(location.hash);
    if (route === "demo" && mode === "LOCALHOST_DEV") {
      const host = h("main", { class: "view-quiz" });
      root.append(host);
      quiz = new QuizShell(host, DEMO_ITEMS, { onExit: () => go("#learn") });
      return;
    }
    if ((route === "diag-run" || route === "study") && model) {
      const host = h("main", { class: "view-quiz" });
      root.append(host);
      if (route === "diag-run") {
        const items = model.diag.remaining.map((d) => toQuizItem(d.record, model!.byId));
        if (!items.length) { go("#diag-result"); return; }
        if (model.diag.answered === 0) rec("DIAGNOSTIC_STARTED", "diagnostic", { total: model.diag.total });
        quiz = runQuiz(host, items, { exposureType: "DIAGNOSTIC", activity: "DIAGNOSTIC", offset: model.diag.answered, total: model.diag.total, onExit: () => { void refresh().then(() => go("#home")); }, onFinish: () => finishDiagnostic() });
      } else {
        const items = model.studyQuestions.map((r) => toQuizItem(r, model!.byId));
        if (!items.length) { go("#learn"); return; }
        quiz = runQuiz(host, items, { exposureType: "PRACTICE", activity: "STUDY", onExit: () => { void refresh().then(() => go("#home")); }, onFinish: () => { void refresh().then(() => go("#home")); } });
      }
      return;
    }
    const tab: TabId = route === "diag" || route === "diag-run" || route === "diag-result" ? "home" : route === "study" ? "learn" : (route as TabId);
    const banner = mode === "LOCAL_FILE" ? h("div", { class: "banner warn", role: "status" }, "로컬 모드: Google 연결이 되지 않으며 기록이 이 기기에 보존된다는 보장이 없습니다. 백업을 자주 내보내세요.") : null;
    const view = h("main", { class: "view" });
    if (banner) root.append(banner);
    root.append(view, buildTabBar(tab));
    if (route === "diag" && model) renderDiagIntro(view, ctx);
    else if (route === "diag-result" && model) renderDiagResult(view, ctx);
    else ({ home: renderHome, learn: renderLearn, report: renderReport, settings: renderSettings } as Record<string, (r: HTMLElement, c: PageCtx) => void>)[tab]!(view, ctx);
  }

  async function finishDiagnostic(): Promise<void> {
    await refresh();
    if (model?.diag.completed) {
      await storage?.record("DIAGNOSTIC_COMPLETED", "diagnostic", { scores: model.diag.scores, route: model.diag.routing.route, borderline: model.diag.routing.borderline, listening: "NOT_MEASURED" });
      await storage?.record("ROUTE_CHANGED", "route", { route: model.diag.routing.route, evidence: "PROVISIONAL" });
      await refresh();
    }
    go("#diag-result");
  }

  settings.subscribe((s, keys) => {
    applySettings(document, s);
    if (!restoring) storage?.record("SETTINGS_UPDATED", "settings", s).then(() => refresh()).catch(() => {});
    if (keys.includes("targetLevel")) void refresh();
  });
  addEventListener("hashchange", draw);
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => clock.touch(Date.now()), { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clock.pause(Date.now()); flushClock(); } });
  addEventListener("pagehide", () => { clock.pause(Date.now()); flushClock(); });

  draw();
  AppStorage.init().then(async (st) => {
    storage = st;
    const projected = await st.projectSettings();
    if (projected) { restoring = true; settings.set(projected); restoring = false; }
    await refresh();
  }).catch(() => { void refresh(); });
}

if (typeof document !== "undefined") {
  const root = document.getElementById("app");
  if (root) mount(root, { protocol: location.protocol, hostname: location.hostname });
}
export { runtimeModeLabel };
