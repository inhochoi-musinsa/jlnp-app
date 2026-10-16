import { detectRuntimeMode, runtimeModeLabel } from "./runtime";
import { FONT_PX, SettingsStore, type UserSettings } from "./domain/settings";
import { DEFAULT_TARGET_LEVEL, type Level } from "../../shared/examSpec";
import { DEMO_ITEMS } from "./content/demoItems";
import { QuizShell } from "./ui/quiz";
import { renderBrief, renderGrammarList, renderGrammarPoint, renderDiagIntro, renderDiagResult, renderHelp, renderHome, renderLearn, renderReport, renderSettings, type PageCtx } from "./ui/pages";
import { buildTabBar, tabFromHash, type TabId } from "./ui/shell";
import { h } from "./ui/dom";
import { AppStorage } from "./storage/session";
import { loadModel, type AppModel } from "./state";
import { ActiveTimer } from "./domain/activity";
import { toQuizItem } from "./domain/content";
import type { QuizEvent, QuizItem } from "./domain/quiz";
import { todayKey } from "./domain/target";
import { cardItemId, cardQuestion, parseCardItemId, linkedQuestions } from "./domain/cards";
import { kanaSession, parseKanaItemId } from "./domain/kana";
import { ConnectionManager } from "./google/connection";
import { requestAccessToken } from "./google/gis";
import { SEED_PACK } from "./content/seed";
import { planImport as planImportFn } from "./content/import";
import { exportPack as exportPackFn, packFileName } from "./content/export";
import { buildFlagsExport, buildProgress, FLAG_REASONS } from "./domain/progress";
import type { Kind } from "../../shared/schema";

declare const __APP_VERSION__: string;
declare const __GOOGLE_CLIENT_ID__: string;
const SETTINGS_KEY = "jlpt.settings.hint";

export function applySettings(doc: Document, s: UserSettings): void {
  const r = doc.documentElement;
  r.style.setProperty("--fs", FONT_PX[s.fontScale] + "px");
  r.dataset.furigana = s.furiganaMode;
  r.dataset.theme = s.theme;
}

function loadHint(): unknown { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null"); } catch { return null; } }
function saveHint(s: UserSettings): void { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable */ } }

type Route = TabId | "demo" | "reading" | "reading-run" | "grammar" | "gp" | "gp-run" | "kana" | "kana-run" | "diag" | "diag-run" | "diag-result" | "study" | "help" | "review" | "review-run" | "weak" | "weak-run";
const EXTRA_ROUTES = ["reading", "reading-run", "grammar", "kana", "kana-run", "diag", "diag-run", "diag-result", "study", "help", "review", "review-run", "weak", "weak-run"];
const routeOf = (hash: string): Route => {
  const id = hash.replace(/^#/, "");
  if (id.startsWith("gp/")) return "gp";
  if (id.startsWith("gp-run/")) return "gp-run";
  if (EXTRA_ROUTES.includes(id)) return id as Route;
  const t = tabFromHash(hash);
  return t === "quiz" ? "learn" : t;
};

function toast(text: string): void {
  const t = h("div", { class: "toast", role: "status" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 5000);
}

export function mount(root: HTMLElement, env: { protocol: string; hostname: string }): void {
  const mode = detectRuntimeMode(env.protocol, env.hostname);
  const settings = new SettingsStore(loadHint(), saveHint);
  applySettings(document, settings.get());
  let quiz: QuizShell | null = null;
  let storage: AppStorage | undefined;
  let model: AppModel | null = null;
  let conn: ConnectionManager | null = null;
  let restoring = false;
  const clock = new ActiveTimer();
  let activity = "STUDY";

  const testNow = mode === "LOCALHOST_DEV" ? (window as unknown as { __JLPT_TEST_NOW__?: string }).__JLPT_TEST_NOW__ : undefined;
  const now = (): Date => (testNow ? new Date(testNow) : new Date());
  const isQuizRoute = () => ["diag-run", "study", "demo", "review-run", "weak-run", "kana-run", "gp-run", "reading-run"].includes(routeOf(location.hash));
  const isEditing = () => { const a = document.activeElement; return !!a && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName); };
  // Background updates (sync status, pulls) never tear down a running quiz or a half-typed form.
  const refresh = async (force = true) => { model = await loadModel(storage, settings.get(), now()); if (force || (!isQuizRoute() && !isEditing())) draw(); };
  const go = (hash: string) => { if (location.hash === hash) draw(); else location.hash = hash; };

  const flushClock = (): void => {
    const seconds = Math.round(clock.take(Date.now()) / 1000);
    if (seconds >= 1 && storage) storage.record("STUDY_INTERVAL_COMPLETED", "study", { dayKey: todayKey(now(), settings.get().timezone), activity, seconds }).catch(() => {});
  };
  const rec = (type: Parameters<AppStorage["record"]>[0], entity: string, payload: unknown) => storage?.record(type, entity, payload).catch(() => {});

  const runQuiz = (host: HTMLElement, items: QuizItem[], o: { exposureType: "DIAGNOSTIC" | "PRACTICE"; activity: string; offset?: number; total?: number; onFinish: () => void; onExit: () => void }) => {
    activity = o.activity;
    clock.touch(Date.now());
    let qStart = 0;
    const dayKey = () => todayKey(now(), settings.get().timezone);
    const onEvent = (e: QuizEvent) => {
      const it = items.find((x) => x.id === e.itemId);
      const kana = parseKanaItemId(e.itemId);
      if (kana) {
        const base = { contentId: kana.pairId, kanaPair: kana.pairId, kanaMode: kana.mode, exposureType: o.exposureType };
        if (e.type === "QUESTION_PRESENTED") { qStart = clock.elapsed(Date.now()); rec("QUESTION_PRESENTED", kana.pairId, { ...base, order: e.order, contentVersion: 1 }); }
        else if (e.type === "QUESTION_SUBMITTED") rec("QUESTION_SUBMITTED", kana.pairId, { ...base, selectedChoiceId: e.selectedChoiceId, isCorrect: e.isCorrect, order: e.order, elapsedActiveMs: Math.round(clock.elapsed(Date.now()) - qStart), contentVersion: 1 });
        else rec("ANSWER_REVEALED", kana.pairId, { contentId: kana.pairId });
        return;
      }
      const card = parseCardItemId(e.itemId);
      if (card) {
        const base = { contentId: card.contentId, direction: card.direction, exposureType: o.exposureType, retry: card.retry, refId: it?.refId ?? null };
        if (e.type === "QUESTION_PRESENTED") { qStart = clock.elapsed(Date.now()); rec("QUESTION_PRESENTED", card.contentId, { ...base, stimulusId: null, order: e.order, contentVersion: 1 }); }
        else if (e.type === "QUESTION_SUBMITTED") {
          const elapsed = Math.round(clock.elapsed(Date.now()) - qStart);
          rec("QUESTION_SUBMITTED", card.contentId, { ...base, selectedChoiceId: e.selectedChoiceId, isCorrect: e.isCorrect, order: e.order, elapsedActiveMs: elapsed, contentVersion: 1 });
          rec("CARD_REVIEWED", card.contentId, { contentId: card.contentId, direction: card.direction, correct: e.isCorrect, retry: card.retry, dayKey: dayKey(), elapsedActiveMs: elapsed });
        } else rec("ANSWER_REVEALED", card.contentId, { contentId: card.contentId });
        return;
      }
      if (e.type === "QUESTION_PRESENTED") { qStart = clock.elapsed(Date.now()); rec("QUESTION_PRESENTED", e.itemId, { contentId: e.itemId, exposureType: o.exposureType, stimulusId: it?.stimulusId ?? null, order: e.order, contentVersion: 1 }); }
      else if (e.type === "QUESTION_SUBMITTED") rec("QUESTION_SUBMITTED", e.itemId, { contentId: e.itemId, selectedChoiceId: e.selectedChoiceId, isCorrect: e.isCorrect, order: e.order, exposureType: o.exposureType, elapsedActiveMs: Math.round(clock.elapsed(Date.now()) - qStart), contentVersion: 1 });
      else rec("ANSWER_REVEALED", e.itemId, { contentId: e.itemId });
    };
    // one same-session retry of a missed card (the retry never changes stage or due date, see srs.applyAnswer)
    const afterSubmit = (item: QuizItem, ok: boolean, session: { insertAfterCurrent(i: QuizItem, gap?: number): void }) => {
      const c = parseCardItemId(item.id);
      if (!c || c.retry || ok || !model) return;
      const r = model.byId.get(c.contentId);
      const q = r ? cardQuestion(r, c.direction, model.pool, dayKey(), true, model.cardStates.get(`${c.contentId}#${c.direction}`)?.reviews ?? 0) : null;
      if (q) session.insertAfterCurrent(q);
    };
    return new QuizShell(host, items, { onEvent, afterSubmit, onReport: (item) => openReport(item), progress: o.total ? { offset: o.offset ?? 0, total: o.total } : undefined, onExit: () => { flushClock(); o.onExit(); }, onFinish: () => { flushClock(); o.onFinish(); } });
  };

  const download = (name: string, data: unknown): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    const a = h("a", { href: url, download: name }) as HTMLAnchorElement;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const existingFor = () => ({ rows: model?.rows ?? [], blockedIds: new Set<string>([...(model?.flags.keys() ?? []), ...(model?.retired ?? [])]), exposed: model?.exposed ?? new Set<string>() });
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

  const openReport = (item: QuizItem): void => {
    const target = item.refId ?? parseCardItemId(item.id)?.contentId ?? item.id;
    const rec = model?.byId.get(target);
    const reasons = FLAG_REASONS.map((r, i) => h("label", { class: "seg-opt" }, h("input", { type: "radio", name: "flag-reason", value: r, checked: i === 0 }), h("span", {}, r)));
    const overlay = h("div", { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": "문제 신고" },
      h("div", { class: "sheet" }, h("h2", {}, "문제 신고"), h("p", { class: "muted" }, "신고하면 이 문제는 앞으로 나오지 않습니다."), h("div", { id: "flag-reasons" }, ...reasons),
        h("div", { class: "actions" },
          h("button", { class: "ghost", type: "button", onclick: () => overlay.remove() }, "취소"),
          h("button", { class: "primary", type: "button", id: "flag-submit", onclick: async () => {
            const reason = (overlay.querySelector("input[name=flag-reason]:checked") as HTMLInputElement | null)?.value ?? "기타";
            await storage?.record("CONTENT_FLAGGED", target, { contentId: target, reason, contentVersion: rec?.contentVersion ?? 1, contentHash: rec?.contentHash ?? "" });
            overlay.replaceChildren(h("div", { class: "sheet" }, h("p", { id: "flag-done" }, "신고했습니다. 이 문제는 앞으로 나오지 않습니다."), h("button", { class: "primary", type: "button", onclick: () => overlay.remove() }, "닫기")));
            void refresh(false);
          } }, "신고"))));
    document.body.append(overlay);
  };

  const ctx: PageCtx = {
    mode, settings, version: __APP_VERSION__, availableLevels: [DEFAULT_TARGET_LEVEL],
    get model() { return model; }, get storage() { return storage; }, get conn() { return conn; }, go,
    planImport: (text, kinds, forceAdd) => (model ? planImportFn(text, existingFor(), { kinds: kinds.length ? kinds : undefined, forceAdd }) : null),
    applyImport: async (text, kinds, forceAdd) => {
      if (!storage || !model) return "저장소를 열 수 없어 가져올 수 없습니다.";
      const r = planImportFn(text, existingFor(), { kinds: kinds.length ? kinds : undefined, forceAdd });
      if (!r.ok) return r.fileError ?? "가져올 수 없습니다.";
      const manifest = r.pack!;
      await storage.record("PACK_IMPORT_STARTED", manifest.packId, { packId: manifest.packId, packVersion: manifest.packVersion, items: r.toWrite.length });
      await storage.store.putContent(r.toWrite); // idempotent by id@version, safe to re-run
      let sheetNote = conn?.state.kind === "READY" ? "" : " (시트에는 아직 올라가지 않았습니다. 연결하면 자동으로 올라갑니다.)";
      try {
        if (conn?.state.kind === "READY") { const w = await conn.pushContent(r.toWrite, { packId: manifest.packId, packVersion: manifest.packVersion }, manifest); sheetNote = ` 시트에 ${w.written}건을 기록했습니다.`; }
      } catch (e) { sheetNote = ` 시트 기록은 완료되지 않았습니다(${(e as Error).message}). 같은 파일을 다시 가져오면 이어서 반영됩니다.`; }
      await storage.record("PACK_IMPORT_COMPLETED", manifest.packId, { packId: manifest.packId, packVersion: manifest.packVersion, items: r.toWrite.length });
      await refresh();
      const s = r.summary;
      return `${r.toWrite.length}건을 반영했습니다 (신규 ${s.added} · 새 버전 ${s.newVersions} · 중복 ${s.duplicates} · 충돌 ${s.conflicts} · 거부 ${s.rejected} · 보류 ${s.held} · 강등 ${s.demoted}).${sheetNote}`;
    },
    exportPack: ({ kinds, includeUnverified }) => {
      const pack = exportPackFn(model?.rows ?? [], { kinds: kinds.length ? kinds : undefined, includeUnverified }, { flagged: model?.flags ?? new Map(), retired: model?.retired ?? new Set() }, { appVersion: __APP_VERSION__ });
      download(packFileName(pack, kinds), pack);
      return pack.items.length;
    },
    exportProgress: () => {
      if (!model) return;
      const route = model.diag.routing.route === "PROVISIONAL" ? null : model.diag.routing.route;
      download(`jlpt-progress_${stamp()}.json`, buildProgress({ records: model.records, pool: model.pool, events: model.events, level: settings.get().targetLevel, route, appVersion: __APP_VERSION__ }));
    },
    exportFlags: () => {
      const list = [...(model?.flags.values() ?? [])];
      download(`jlpt-flags_${stamp()}.json`, buildFlagsExport(list));
      return list.length;
    },
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
    if (route === "kana" && model) {
      const view = h("main", { class: "view" });
      root.append(view, buildTabBar("learn"));
      const items = kanaSession(model.pool, model.events, todayKey(now(), settings.get().timezone));
      renderBrief(view, ctx, { title: "혼동 글자", purpose: "모양이 비슷해 헷갈리는 글자(シ/ツ 등)의 읽기와 글자를 구분합니다.", count: items.length, minutes: (items.length * 15) / 60, startHash: "#kana-run", extra: ["틀린 글자 쌍은 다음 퀴즈에서 더 자주 나옵니다. 복습 단계(5단계)에는 반영되지 않는 별도 연습입니다."] });
      return;
    }
    if (route === "reading" && model) {
      const view = h("main", { class: "view" });
      root.append(view, buildTabBar("learn"));
      const rd = model.readingNext;
      const type = rd ? String(rd.passage.payload.type) : "";
      renderBrief(view, ctx, { title: "독해", purpose: rd ? `${({ SHORT: "단문", MEDIUM: "중문", LONG: "장문", INFO: "정보검색" } as Record<string, string>)[type] ?? "지문"}을 읽고 문제를 풉니다. 지문은 페이지로 나뉘어 있고, 문제와 보기 4개는 화면에 고정됩니다.` : "읽을 새 지문이 없습니다.", count: rd?.questions.length ?? 0, minutes: rd?.questions.length ?? 0, startHash: "#reading-run", extra: ["해설 화면에서 [지문 보기]로 근거를 다시 확인할 수 있습니다."] });
      return;
    }
    if (route === "grammar" && model) { const view = h("main", { class: "view" }); root.append(view, buildTabBar("learn")); renderGrammarList(view, ctx); return; }
    if (route === "gp" && model) { const view = h("main", { class: "view" }); root.append(view, buildTabBar("learn")); renderGrammarPoint(view, ctx, decodeURIComponent(location.hash.replace(/^#gp\//, ""))); return; }
    if ((route === "review" || route === "weak") && model) {
      const view = h("main", { class: "view" });
      root.append(view, buildTabBar("home"));
      const q = model.review;
      const list = route === "review" ? q.session : q.weak.slice(0, 10);
      renderBrief(view, ctx, {
        title: route === "review" ? "오늘 복습" : "약점 복습",
        purpose: route === "review" ? q.reason : "최근 5번 중 많이 틀렸거나 복습이 밀린 항목을 먼저 다시 풉니다.",
        count: list.length, minutes: (list.length * model.secondsPerCard) / 60,
        startHash: route === "review" ? "#review-run" : "#weak-run",
        extra: route === "review" ? [`기한 도래 ${q.due.length}개, 새 항목 ${list.filter((c) => c.reviews === 0).length}개 (하루 새 항목 상한 ${q.newAllowed + model.newToday}개)`] : undefined,
      });
      return;
    }
    if ((route === "review-run" || route === "weak-run" || route === "diag-run" || route === "study" || route === "kana-run" || route === "gp-run" || route === "reading-run") && model) {
      const host = h("main", { class: "view-quiz" });
      root.append(host);
      if (route === "diag-run") {
        const items = model.diag.remaining.map((d) => toQuizItem(d.record, model!.byId));
        if (!items.length) { go("#diag-result"); return; }
        if (model.diag.answered === 0) rec("DIAGNOSTIC_STARTED", "diagnostic", { total: model.diag.total });
        quiz = runQuiz(host, items, { exposureType: "DIAGNOSTIC", activity: "DIAGNOSTIC", offset: model.diag.answered, total: model.diag.total, onExit: () => { void refresh().then(() => go("#home")); }, onFinish: () => finishDiagnostic() });
      } else {
        const day = todayKey(now(), settings.get().timezone);
        const cardItems = (cs: { contentId: string; direction: Parameters<typeof cardQuestion>[1]; reviews: number }[]) => cs.flatMap((c) => { const r = model!.byId.get(c.contentId); const q = r ? cardQuestion(r, c.direction, model!.pool, day, false, c.reviews) : null; return q ? [q] : []; });
        let items: QuizItem[];
        if (route === "kana-run") items = kanaSession(model.pool, model.events, day);
        else if (route === "reading-run") items = (model.readingNext?.questions ?? []).map((r) => toQuizItem(r, model!.byId));
        else if (route === "gp-run") {
          const pid = decodeURIComponent(location.hash.replace(/^#gp-run\//, ""));
          const pt = model.grammarPoints.find((g) => g.contentId === pid);
          items = pt ? linkedQuestions(pt, model.pool).map((r) => toQuizItem(r, model!.byId)) : [];
        }
        else if (route === "review-run") items = cardItems(model.review.session);
        else if (route === "weak-run") items = cardItems(model.review.weak.slice(0, 10));
        else {
          // today's session: vocabulary cards for the planned minutes + grammar questions for theirs
          const p = model.plan;
          const gp = model.grammarPoints;
          const isG = (c: { contentId: string }) => gp.some((g) => g.contentId === c.contentId);
          const vocabCardsToday = model.review.session.filter((c) => !isG(c));
          const grammarCardsToday = model.review.session.filter(isG);
          const nV = p ? Math.floor((p.allocation.VOCAB * 60) / model.secondsPerCard) : vocabCardsToday.length;
          const nG = p ? Math.floor((p.allocation.GRAMMAR * 60) / model.secondsPerCard) : grammarCardsToday.length;
          const gCards = grammarCardsToday.slice(0, Math.max(0, nG));
          const nQ = p ? Math.max(0, Math.floor((p.allocation.GRAMMAR * 60 - gCards.length * model.secondsPerCard) / 60)) : model.studyQuestions.length;
          const reading = p ? (p.allocation.READING > 0 ? model.readingNext?.questions ?? [] : []) : model.readingNext?.questions ?? [];
          items = [...cardItems(vocabCardsToday.slice(0, Math.max(0, nV))), ...cardItems(gCards), ...model.studyQuestions.slice(0, nQ).map((r) => toQuizItem(r, model!.byId)), ...reading.map((r) => toQuizItem(r, model!.byId))];
        }
        if (!items.length) { go("#learn"); return; }
        quiz = runQuiz(host, items, { exposureType: "PRACTICE", activity: route === "weak-run" ? "WEAK_REVIEW" : "STUDY", onExit: () => { void refresh().then(() => go("#home")); }, onFinish: () => { void refresh().then(() => go("#home")); } });
      }
      return;
    }
    const tab: TabId = ["diag", "diag-run", "diag-result", "review", "weak"].includes(route) ? "home" : ["study", "grammar", "gp", "kana", "reading"].includes(route) ? "learn" : route === "help" ? "settings" : (route as TabId);
    const banner = mode === "LOCAL_FILE" ? h("div", { class: "banner warn", role: "status" }, "로컬 모드: Google 연결이 되지 않으며 기록이 이 기기에 보존된다는 보장이 없습니다. 백업을 자주 내보내세요.") : null;
    const view = h("main", { class: "view" });
    if (banner) root.append(banner);
    root.append(view, buildTabBar(tab));
    if (route === "diag" && model) renderDiagIntro(view, ctx);
    else if (route === "diag-result" && model) renderDiagResult(view, ctx);
    else if (route === "help") renderHelp(view, ctx);
    else ({ home: renderHome, learn: renderLearn, report: renderReport, settings: renderSettings } as Record<string, (r: HTMLElement, c: PageCtx) => void>)[tab]!(view, ctx);
  }

  async function finishDiagnostic(): Promise<void> {
    await refresh();
    if (model?.diag.completed) {
      await storage?.record("DIAGNOSTIC_COMPLETED", "diagnostic", { scores: model.diag.scores, route: model.diag.routing.route, borderline: model.diag.routing.borderline, listening: "NOT_MEASURED" });
      await storage?.record("ROUTE_CHANGED", "route", { route: model.diag.routing.route, evidence: "PROVISIONAL" });
      await refresh(false);
    }
    // do not pull the learner back if they already moved on while the events were being written
    if (["diag-run", "diag-result"].includes(routeOf(location.hash))) go("#diag-result");
  }

  settings.subscribe((s, keys) => {
    applySettings(document, s);
    if (!restoring) storage?.record("SETTINGS_UPDATED", "settings", s).then(() => refresh()).catch(() => {});
    if (keys.includes("targetLevel")) void refresh();
  });
  addEventListener("hashchange", () => { draw(); void refresh(false); });
  for (const ev of ["pointerdown", "keydown"]) addEventListener(ev, () => clock.touch(Date.now()), { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { clock.pause(Date.now()); flushClock(); void conn?.syncNow("hidden"); } });
  addEventListener("pagehide", () => { clock.pause(Date.now()); flushClock(); void conn?.syncNow("end"); });
  addEventListener("online", () => { void conn?.syncNow("manual"); });

  draw();
  AppStorage.init().then(async (st) => {
    storage = st;
    const testId = mode === "LOCALHOST_DEV" ? (window as unknown as { __JLPT_TEST_CLIENT_ID__?: string }).__JLPT_TEST_CLIENT_ID__ : undefined;
    conn = new ConnectionManager({
      mode, clientId: testId ?? __GOOGLE_CLIENT_ID__, storage: st, seed: SEED_PACK, requestToken: (id) => requestAccessToken(id),
      onChange: () => { void refresh(false); }, onRemoteEvents: (n) => { if (n > 0) toast(`다른 기기의 기록 ${n}건을 가져왔습니다.`); },
    });
    await conn.load();
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
