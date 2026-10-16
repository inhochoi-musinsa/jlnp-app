import { FONT_SCALES, FURIGANA_MODES, THEMES, type SettingsStore, type UserSettings } from "../domain/settings";
import { LEVELS, type Level } from "../../../shared/examSpec";
import { runtimeModeLabel, type RuntimeMode } from "../runtime";
import { h } from "./dom";
import type { AppStorage } from "../storage/session";
import { applyImport, backupFileName, exportBackup, previewImport, type ImportPreview } from "../storage/backup";
import type { AppModel } from "../state";
import type { ConnectionManager } from "../google/connection";
import { DOMAIN_LABEL, DOMAINS } from "../domain/planner";
import { ROUTE_LABEL, DIAG_GROUPS } from "../domain/diagnostic";
import { daysBetween, effectiveDate, eligibleDays, isPastSession, maximumRemainingMinutes } from "../domain/target";

export interface PageCtx {
  mode: RuntimeMode;
  settings: SettingsStore;
  version: string;
  availableLevels: Level[];
  model: AppModel | null;
  storage?: AppStorage;
  conn?: ConnectionManager | null;
  go: (hash: string) => void;
  startDemo?: () => void;
  setTarget: (level: Level, year: number, month: number) => Promise<void>;
  confirmDate: (year: number, month: number, date: string, url: string) => Promise<void>;
}

type Kid = Node | string | null | undefined;
const card = (title: string, ...body: Kid[]) => h("section", { class: "card" }, h("h2", {}, title), ...body);
const muted = (t: string) => h("p", { class: "muted" }, t);
const warn = (t: string) => h("p", { class: "banner warn", role: "alert" }, t);
const btn = (label: string, onclick: () => void, cls = "primary", id?: string) => h("button", { class: cls, type: "button", id, onclick }, label);

const MONTH_LABEL = (m: number) => `${m}월`;
const dateLabel = (d: string) => { const [, m, day] = d.split("-"); return `${Number(m)}월 ${Number(day)}일`; };

export function targetSummary(m: AppModel): { text: string; detail: string | null } {
  const t = m.examTarget;
  if (t.dateStatus === "NOT_SELECTED" || t.targetYear === null || t.targetMonth === null) return { text: "목표가 아직 설정되지 않았습니다.", detail: null };
  const eff = effectiveDate(t)!;
  const status = t.dateStatus === "CONFIRMED" ? `공식 ${dateLabel(eff)} 확정` : `예상 ${dateLabel(eff)} / 공식 미확정`;
  const days = eligibleDays(m.today, eff);
  return { text: `${t.targetYear}년 ${t.targetMonth}월 (${status})`, detail: `남은 ${days}일 · 최대 학습 가능 시간 ${maximumRemainingMinutes(days) / 60}시간 (하루 60분 기준 산술 상한)` };
}

export function syncLabel(ctx: PageCtx): { text: string; warn: boolean } {
  const c = ctx.conn, m = ctx.model;
  if (ctx.mode === "LOCAL_FILE") return { text: "로컬 모드 · 시트에 저장되지 않음", warn: true };
  if (!c || c.state.kind !== "READY") return { text: c?.state.kind === "NO_CLIENT_ID" ? "시트 연결 전 (Client ID 미설정)" : "시트 연결 전", warn: false };
  const st = c.syncStatus;
  const pending = st?.pending ?? m?.pending ?? 0;
  switch (st?.state) {
    case "NEEDS_AUTH": return { text: "다시 연결 필요", warn: true };
    case "OFFLINE": return { text: "오프라인", warn: true };
    case "READ_ONLY": return { text: "읽기 전용", warn: true };
    case "RATE_LIMITED": return { text: "동기화 지연", warn: true };
    case "ERROR": return { text: "동기화 오류", warn: true };
    case "SYNCING": return { text: "동기화 중…", warn: false };
    default:
      // "동기화 완료" is shown only after a read-back verified ACK and nothing is pending.
      return pending === 0 && st?.lastSyncedAt ? { text: "동기화 완료", warn: false } : { text: `동기화 전 ${pending}건`, warn: false };
  }
}

export function renderHome(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model;
  root.append(h("h1", {}, "홈"));
  if (!m) { root.append(muted("불러오는 중입니다.")); return; }
  // 1. 오늘의 60분
  if (m.diag.total > 0 && !m.diag.completed) {
    root.append(card("오늘의 60분",
      muted(m.diag.answered ? `배치 진단을 이어서 하세요. (${m.diag.answered} / ${m.diag.total} 완료)` : "먼저 배치 진단(28문항)으로 시작 경로를 정합니다. 시간 제한이 없고 중간에 멈춰도 됩니다."),
      btn(m.diag.answered ? "진단 이어서 하기" : "배치 진단 시작", () => ctx.go("#diag"), "primary", "start-diag")));
  } else if (m.plan) root.append(planCard(m, ctx));
  // 2. 복습
  root.append(card("오늘 복습", muted("복습할 항목이 없습니다. (복습 엔진은 v1.0.0에서 제공됩니다.)")));
  // 3. 영역
  root.append(card("영역", h("div", { class: "areas" }, ...["어휘·한자", "문법", "독해·청해"].map((n) => h("div", { class: "area" }, h("b", {}, n), muted("자료 없음"))))));
  // 4. 목표
  const t = targetSummary(m);
  root.append(card("목표", h("p", { id: "target-text" }, t.text), t.detail ? muted(t.detail) : null, btn("목표 변경", () => ctx.go("#settings"), "ghost")));
  // 5. 동기화
  const lab = syncLabel(ctx);
  const st = ctx.conn?.syncStatus;
  root.append(card("동기화",
    h("span", { class: lab.warn ? "badge warn" : "badge", id: "sync-badge" }, lab.text),
    st?.message ? muted(st.message) : null,
    muted(m.pending ? `동기화 전 ${m.pending}건 (기기에만 저장됨)` : "동기화 전 기록 없음"),
    ctx.conn?.state.kind === "READY" ? btn("지금 동기화", () => { void ctx.conn!.syncNow("manual"); }, "ghost", "sync-now") : null,
    st?.state === "NEEDS_AUTH" ? btn("다시 연결", () => { void ctx.conn!.reconnect(); }, "primary", "reconnect") : null,
    ctx.storage && !ctx.storage.persistent ? warn("현재 실행에서만 유지됨 — 백업 권장") : null));
}

function planCard(m: AppModel, ctx: PageCtx): HTMLElement {
  const p = m.plan!;
  const rows = DOMAINS.filter((d) => p.allocation[d] > 0 || p.excluded.includes(d)).map((d) =>
    h("li", {}, `${DOMAIN_LABEL[d]}: `, p.allocation[d] > 0 ? `${p.allocation[d]}분` : `제외 (${m.notes[d] ?? "준비 중"})`));
  const listening = p.excluded.includes("LISTENING") ? muted("청해는 콘텐츠 준비 중으로 제외되며 완료로 기록하지 않습니다. (청해 미측정)") : null;
  return card("오늘의 60분",
    h("p", {}, `시작 경로: ${ROUTE_LABEL[p.route]} · 오늘 남은 시간 ${p.availableMinutes}분`),
    h("ul", { class: "plan-list", id: "plan-list" }, ...rows), listening,
    h("div", { class: "brief", id: "brief" },
      h("p", {}, h("b", {}, "시작 전 안내")),
      h("p", { class: "muted" }, "오늘 할 일: 위 영역을 순서대로 풀어요."),
      h("p", { class: "muted" }, "진행 방식: 보기 4개 중 하나를 고르고 [정답 확인] → 해설을 읽고 [다음 계속하기]. 시간 제한은 없고 자동으로 넘어가지 않습니다."),
      h("p", { class: "muted" }, p.totalMinutes > 0 ? `예상 소요: 약 ${p.totalMinutes}분${p.underfilled ? " (오늘 가능한 학습 분량이 60분보다 적습니다)" : ""}` : "오늘 학습할 수 있는 콘텐츠가 없습니다. 콘텐츠를 추가하세요.")),
    p.totalMinutes > 0 && m.studyQuestions.length ? btn("오늘 세션 시작", () => ctx.go("#study"), "primary", "start-study") : null);
}

export function renderLearn(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model;
  root.append(h("h1", {}, "학습"));
  const n = m?.studyQuestions.length ?? 0;
  root.append(card("오늘 세션", n ? muted(`풀 수 있는 문제 ${n}개`) : muted("학습할 콘텐츠가 아직 없습니다. 콘텐츠를 가져오면 여기에 표시됩니다."), n ? btn("오늘 세션 시작", () => ctx.go("#study"), "primary", "learn-start") : null));
  root.append(card("영역별 학습 · 약점 복습 · 혼동 글자", muted("v1.0.0에서 제공됩니다.")));
  if (ctx.startDemo) root.append(card("개발용 레이아웃 데모", btn("퀴즈 데모 시작", ctx.startDemo)));
}

export function renderReport(root: HTMLElement): void {
  root.append(h("h1", {}, "리포트"), card("리포트", muted("학습 시간·정확도·영역별 준비도는 v3.0.0에서 제공됩니다.")));
}

export function renderDiagIntro(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model!;
  root.append(h("h1", {}, "배치 진단"),
    card("진행 방식",
      h("ul", {}, h("li", {}, "처음 보는 문제 28문항 (가나 8, 기초 8, 목표 등급 언어 6, 독해 6)"), h("li", {}, "시간 제한이 없고, 중간에 나가도 이어서 풀 수 있습니다."), h("li", {}, "결과는 시작 경로를 정하는 용도이며 JLPT 점수나 합격 가능성이 아닙니다."), h("li", {}, "청해는 아직 측정하지 않습니다(미측정)."), h("li", {}, "진단에 쓴 시간은 오늘의 60분에서 빠집니다.")),
      muted(`${m.diag.answered} / ${m.diag.total} 완료`),
      btn(m.diag.answered ? "이어서 풀기" : "진단 시작", () => ctx.go("#diag-run"), "primary", "diag-go"),
      btn("나중에", () => ctx.go("#home"), "ghost")));
}

export function renderDiagResult(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model!;
  const r = m.diag.routing;
  const names: Record<string, string> = { KANA: "가나", FOUNDATION: "기초", TARGET_LANGUAGE: "목표 등급 언어", TARGET_READING: "목표 등급 독해" };
  root.append(h("h1", {}, "진단 결과"),
    card("시작 경로", h("p", { class: "big", id: "route-label" }, ROUTE_LABEL[r.route]),
      h("ul", {}, ...DIAG_GROUPS.map((g) => h("li", {}, `${names[g]}: ${m.diag.scores[g].correct} / ${m.diag.scores[g].total}`)), h("li", {}, "청해: 미측정")),
      r.borderline ? muted("경계 점수입니다. 추가 진단은 이후 버전에서 제공됩니다.") : null,
      muted("이 결과는 출발 경로를 정하는 참고용이며 JLPT 수준·합격 가능성·점수와 무관합니다. 목표 급수와 목표 연도/월은 바뀌지 않습니다."),
      btn("홈으로", () => ctx.go("#home"), "primary", "diag-home")));
}

const FONT_LABEL: Record<string, string> = { S: "작게", M: "보통", L: "크게", XL: "아주 크게" };
const FURI_LABEL: Record<string, string> = { ALWAYS: "항상", STUDY_ONLY: "학습 때만", HIDDEN: "숨김" };
const THEME_LABEL: Record<string, string> = { SYSTEM: "시스템", LIGHT: "밝게", DARK: "어둡게" };

function segmented<K extends keyof UserSettings>(name: string, legend: string, key: K, values: readonly UserSettings[K][], labels: Record<string, string>, store: SettingsStore): HTMLElement {
  const cur = store.get()[key];
  return h("fieldset", { class: "seg" }, h("legend", {}, legend),
    ...values.map((v) => h("label", { class: "seg-opt" },
      h("input", { type: "radio", name, value: String(v), checked: v === cur, onchange: () => store.set({ [key]: v } as Partial<UserSettings>) }),
      h("span", {}, labels[String(v)] ?? String(v)))));
}

function targetCard(ctx: PageCtx): HTMLElement {
  const m = ctx.model;
  const s = ctx.settings.get();
  const err = h("div", { id: "target-error", "aria-live": "polite" });
  const year = h("input", { id: "target-year", type: "number", inputmode: "numeric", min: "2020", max: "2099", value: String(m?.examTarget.targetYear ?? new Date().getFullYear() + 1), "aria-label": "목표 연도" }) as HTMLInputElement;
  const month = h("select", { id: "target-month", "aria-label": "목표 회차" }, ...[7, 12].map((v) => h("option", { value: v, selected: v === (m?.examTarget.targetMonth ?? 7) }, MONTH_LABEL(v)))) as HTMLSelectElement;
  const level = h("select", { id: "level", "aria-label": "목표 급수" }, ...LEVELS.filter((l) => ctx.availableLevels.includes(l)).map((l) => h("option", { value: l, selected: l === s.targetLevel }, l))) as HTMLSelectElement;
  const save = btn("목표 변경", async () => {
    err.textContent = "";
    const y = Number(year.value), mo = Number(month.value);
    if (!Number.isInteger(y) || y < 2020 || y > 2099) { err.append(warn("연도를 확인해 주세요.")); return; }
    if (m && isPastSession(m.today, y, mo)) { err.append(warn("선택 회차가 이미 지났습니다. 다른 회차를 선택해 주세요.")); return; }
    await ctx.setTarget(level.value as Level, y, mo);
  }, "primary", "save-target");
  const sum = m ? targetSummary(m) : { text: "", detail: null };
  const t = m?.examTarget;
  const confirmDate = h("input", { id: "confirm-date", type: "date", "aria-label": "공식 시험일" }) as HTMLInputElement;
  const confirmUrl = h("input", { id: "confirm-url", type: "url", placeholder: "https://", "aria-label": "공식 공고 주소" }) as HTMLInputElement;
  const cerr = h("div", { id: "confirm-error", "aria-live": "polite" });
  return card("목표",
    h("p", { id: "target-current" }, sum.text), sum.detail ? muted(sum.detail) : null,
    h("div", { class: "row" }, h("label", { for: "level" }, "급수 "), level, h("label", { for: "target-year" }, "연도 "), year, h("label", { for: "target-month" }, "회차 "), month, save),
    err,
    muted("목표를 바꿔도 지금까지의 풀이·설정·기록은 지워지지 않고, 앞으로의 계획만 다시 계산됩니다. 콘텐츠가 있는 급수만 선택할 수 있습니다."),
    t && t.targetYear !== null ? h("details", {}, h("summary", {}, "공식 시험일 입력 (공고 확인 후)"),
      muted("한국 JLPT 실시위원회 공지에서 직접 확인한 날짜만 입력하세요. 입력 전에는 예상일로 표시됩니다."),
      h("div", { class: "row" }, h("label", { for: "confirm-date" }, "시험일 "), confirmDate, h("label", { for: "confirm-url" }, "공고 주소 "), confirmUrl,
        btn("공식 시험일 저장", async () => {
          cerr.textContent = "";
          const d = confirmDate.value, u = confirmUrl.value.trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number(d.slice(0, 4)) !== t.targetYear) { cerr.append(warn("목표 연도 안의 날짜를 입력해 주세요.")); return; }
          if (daysBetween(m!.today, d) <= 0) { cerr.append(warn("이미 지난 날짜입니다.")); return; }
          try { if (new URL(u).protocol !== "https:") throw new Error(); } catch { cerr.append(warn("공식 공고의 https 주소를 입력해 주세요.")); return; }
          await ctx.confirmDate(t.targetYear!, t.targetMonth!, d, u);
        }, "ghost", "save-confirm")), cerr) : null);
}

export function renderSettings(root: HTMLElement, ctx: PageCtx): void {
  const s = ctx.settings;
  root.append(
    h("h1", {}, "설정"),
    targetCard(ctx),
    card("표시",
      segmented("font", "글자 크기", "fontScale", FONT_SCALES, FONT_LABEL, s),
      segmented("furi", "후리가나", "furiganaMode", FURIGANA_MODES, FURI_LABEL, s),
      segmented("theme", "화면 색", "theme", THEMES, THEME_LABEL, s),
      muted("글자는 화면에 맞춰 자동으로 줄어들지 않습니다.")),
    connectionCard(ctx),
    backupCard(ctx),
    card("앱 정보", h("p", {}, `버전 v${ctx.version}`), h("p", {}, `실행 환경: ${runtimeModeLabel(ctx.mode)}`)),
  );
}

function backupCard(ctx: PageCtx): HTMLElement {
  const out = h("div", { id: "backup-result", "aria-live": "polite" });
  const st = ctx.storage;
  if (!st) return card("백업", muted("저장소를 열 수 없어 백업을 사용할 수 없습니다."));
  const showPreview = (p: ImportPreview) => {
    out.textContent = "";
    if (!p.ok) { out.append(warn(p.fatal ?? "가져올 수 없습니다.")); return; }
    out.append(
      h("p", {}, `신규 ${p.newEvents}건 / 중복 ${p.duplicates}건 / 충돌 ${p.conflicts.length}건 / 거부 ${p.invalid.length}건`),
      ...(p.profileMismatch ? [warn("다른 프로필의 백업입니다. 병합하려면 확인이 필요합니다.")] : []),
      h("button", { class: "primary", type: "button", id: "apply-import", disabled: p.newEvents === 0, onclick: async () => {
        const r = await applyImport(st.store, p);
        out.textContent = ""; out.append(h("p", {}, `${r.added}건을 추가했습니다. (동기화 전 상태입니다)`));
      } }, "가져오기 승인"));
  };
  const file = h("input", { type: "file", id: "import-file", accept: "application/json,.json", "aria-label": "백업 파일 선택", onchange: async (e: Event) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) showPreview(await previewImport(await f.text(), st.store, st.profileId));
  } });
  return card("백업",
    !st.persistent ? warn("현재 실행에서만 유지됨 — 백업 권장") : null,
    h("button", { class: "primary", type: "button", id: "export-backup", onclick: async () => {
      const b = await exportBackup(st.store, { appVersion: ctx.version, profileId: st.profileId, settings: ctx.settings.get(), examTarget: ctx.model?.examTarget });
      const url = URL.createObjectURL(new Blob([JSON.stringify(b, null, 1)], { type: "application/json" }));
      const a = h("a", { href: url, download: backupFileName() }) as HTMLAnchorElement;
      document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } }, "JSON 내보내기"),
    h("label", { for: "import-file" }, "백업 가져오기 "), file, out,
    muted("백업에는 풀이 기록과 설정만 들어 있고 토큰·비밀번호는 포함되지 않습니다."));
}

function connectionCard(ctx: PageCtx): HTMLElement {
  const c = ctx.conn;
  if (ctx.mode === "LOCAL_FILE") return card("시트 연결", warn("로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다."), muted("진단과 연습은 할 수 있지만 기록은 이 기기에만 저장됩니다. 백업을 자주 내보내세요."));
  if (!c) return card("시트 연결", muted("저장소를 준비하는 중입니다."));
  const s = c.state;
  const url = h("input", { id: "sheet-url", type: "url", placeholder: "https://docs.google.com/spreadsheets/d/…", "aria-label": "구글 시트 주소", style: "width:100%" }) as HTMLInputElement;
  const body: Kid[] = [];
  switch (s.kind) {
    case "NO_CLIENT_ID": body.push(warn("Google Client ID가 이 빌드에 설정되어 있지 않습니다. config.local.json의 clientId를 채우고 다시 빌드하세요."), muted("연결하기 전까지 기록은 이 기기에만 저장됩니다.")); break;
    case "DISCONNECTED": body.push(muted("Google 계정으로 연결하면 학습 기록이 내 구글 시트에 저장됩니다. 이 앱은 '스프레드시트' 권한(내 모든 구글 시트를 읽고 쓸 수 있는 넓은 권한)을 요청하지만, 입력한 시트 하나만 사용합니다."), btn(c.bound ? "다시 연결" : "Google 계정으로 연결", () => { void c.connect(); }, "primary", "gconnect")); break;
    case "AWAITING_URL": body.push(h("label", { for: "sheet-url" }, "시트 주소를 붙여 넣으세요"), url, btn("연결 확인", () => { void c.submitUrl(url.value); }, "primary", "sheet-check"), muted("처음에는 테스트용 빈 시트로 시작하세요.")); break;
    case "NEEDS_INIT": body.push(h("p", {}, "이 시트에 _JLPT_* 전용 탭을 생성합니다. 기존 탭은 수정하지 않습니다."), muted(`시트: ${s.inspection.meta.title} (기존 탭 ${s.inspection.meta.tabs.filter((t) => !t.title.startsWith("_JLPT_")).length}개는 그대로 둡니다)`), btn("초기화 승인", () => { void c.confirmInit(); }, "primary", "init-approve"), btn("취소", () => { void c.disconnect(); }, "ghost")); break;
    case "READY": body.push(h("p", { id: "conn-ready" }, "시트에 연결되었습니다."), btn("지금 동기화", () => { void c.syncNow("manual"); }, "ghost", "sync-now-2"), btn("연결 해제", () => { void c.disconnect(); }, "ghost", "gdisconnect"), muted("연결을 해제해도 시트의 데이터와 이 기기의 기록은 삭제되지 않습니다.")); break;
    case "ERROR": body.push(warn(s.message), btn(c.bound ? "다시 연결" : "다시 시도", () => { void (c.bound ? c.reconnect() : c.connect()); }, "primary", "gretry")); break;
    case "LOCAL_FILE": break;
  }
  return card("시트 연결", h("div", { id: "conn-body", "aria-live": "polite" }, ...body));
}
