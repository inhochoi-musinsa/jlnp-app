import { FONT_SCALES, FURIGANA_MODES, THEMES, type SettingsStore, type UserSettings } from "../domain/settings";
import { LEVELS, getExamSpec, type Level } from "../../../shared/examSpec";
import { runtimeModeLabel, type RuntimeMode } from "../runtime";
import { h, richText } from "./dom";
import type { AppStorage } from "../storage/session";
import { applyImport, backupFileName, exportBackup, previewImport, type ImportPreview } from "../storage/backup";
import type { AppModel } from "../state";
import type { ConnectionManager } from "../google/connection";
import type { ImportReport } from "../content/import";
import { reportLines } from "../content/import";
import { KINDS, type Kind } from "../../../shared/schema";
import { SOURCE_LABEL, TTS_LIMIT_NOTICE } from "../domain/listening";
import { EVIDENCE_LABEL, EXCLUDED_LABEL, MIN_SAMPLE, SECTION_NAME, WEAK_NOTE, sectionLines } from "../domain/readiness";
import { dailyMinutes, officialResults, studiedDays } from "../domain/report";
import { assessmentSet } from "../domain/assessment";
import { accuracyChart, barChart, stageChart } from "./charts";
import { RUNWAY_WARN_DAYS } from "../domain/progress";
import { DOMAIN_LABEL, DOMAINS } from "../domain/planner";
import { ROUTE_LABEL, DIAG_GROUPS } from "../domain/diagnostic";
import { STAGE_NAME, STAGES, stageDistribution } from "../domain/srs";
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
  planImport: (text: string, kinds: Kind[], forceAdd: Set<string>) => ImportReport | null;
  applyImport: (text: string, kinds: Kind[], forceAdd: Set<string>) => Promise<string>;
  exportPack: (o: { kinds: Kind[]; includeUnverified: boolean }) => number;
  recordOfficialResult: (r: { level: Level; year: number; month: number; sectionScores: Record<string, number>; passed: boolean | null }) => Promise<void>;
  exportProgress: () => void;
  exportFlags: () => number;
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
  // runway
  const rw = m.runway;
  root.append(card("남은 학습 분량", h("p", { id: "runway-text" }, `남은 학습 분량: ${rw.days}일`),
    rw.needsContent ? h("p", { class: "banner warn", id: "need-content", role: "status" }, `콘텐츠 추가 필요 (${RUNWAY_WARN_DAYS}일 미만) — 설정 > 콘텐츠에서 진도를 내보내 PC에서 새 콘텐츠를 만드세요.`) : null));
  // 2. 복습
  const rv = m.review;
  const dueN = rv.due.length, weakN = rv.weak.length;
  root.append(card("오늘 복습",
    h("p", { id: "review-counts" }, dueN || weakN ? `기한 도래 ${dueN}개 · 틀리기 쉬운 항목 ${weakN}개` : "복습할 항목이 없습니다."),
    rv.session.length ? muted(`오늘 세션: 복습 ${rv.session.filter((c) => c.reviews > 0).length}개 + 새 항목 ${rv.session.filter((c) => c.reviews === 0).length}개`) : null,
    rv.session.length ? btn("복습 시작", () => ctx.go("#review"), "primary", "start-review") : null));
  // 3. 영역 (5단계 분포)
  const dist = stageDistribution(m.vocabStages);
  root.append(card("영역", h("div", { class: "areas" },
    areaBlock("어휘·한자", m.vocabStages.length ? dist : null),
    areaBlock("문법", m.grammarStages.length ? stageDistribution(m.grammarStages) : null), areaBlock("독해·청해", null))));
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

function areaBlock(name: string, dist: Record<0 | 1 | 2 | 3 | 4, number> | null): HTMLElement {
  if (!dist) return h("div", { class: "area" }, h("b", {}, name), muted("자료 없음"));
  const total = STAGES.reduce<number>((a, s) => a + dist[s], 0) || 1;
  const label = STAGES.map((s) => `${STAGE_NAME[s]} ${dist[s]}`).join(", ");
  return h("div", { class: "area", "data-area": name },
    h("b", {}, name),
    h("div", { class: "stagebar", role: "img", "aria-label": `숙련도 분포: ${label}` }, ...STAGES.filter((s) => dist[s] > 0).map((s) => h("span", { class: `st st${s}`, style: `width:${(dist[s] / total) * 100}%`, title: `${STAGE_NAME[s]} ${dist[s]}` }))),
    h("small", { class: "muted" }, label));
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
    p.totalMinutes > 0 && (m.studyQuestions.length || m.review.session.length) ? btn("오늘 세션 시작", () => ctx.go("#study"), "primary", "start-study") : null);
}

export interface Brief { title: string; purpose: string; count: number; minutes: number; startHash: string; extra?: string[] }

/** One screen before any session: what, why, how many, and about how long (execution_plan §3.1). */
export function renderBrief(root: HTMLElement, ctx: PageCtx, b: Brief): void {
  root.append(h("h1", {}, b.title),
    card("시작 전 안내",
      h("ul", { id: "brief-list" }, h("li", {}, `무엇을: ${b.purpose}`), h("li", {}, `몇 개: ${b.count}개`), h("li", {}, `예상 소요: 약 ${Math.max(1, Math.round(b.minutes))}분`), h("li", {}, "진행 방식: 보기 4개 중 하나를 고르고 [정답 확인] → 해설을 읽고 [다음 계속하기]. 시간 제한은 없고 자동으로 넘어가지 않습니다."), h("li", {}, "틀리면 같은 세션에서 한 번 더 나오고, 다음 날 다시 복습합니다."), ...(b.extra ?? []).map((x) => h("li", {}, x))),
      b.count > 0 ? btn("시작", () => ctx.go(b.startHash), "primary", "brief-go") : muted("지금 할 수 있는 항목이 없습니다."),
      btn("돌아가기", () => ctx.go("#home"), "ghost")));
}

export function renderAssessMenu(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model!;
  const level = ctx.settings.get().targetLevel;
  root.append(h("h1", {}, "실전 세트"),
    card("안내",
      h("ul", {}, h("li", {}, "처음 보는 평가 문항만 사용합니다. 학습·진단에서 본 문제는 나오지 않습니다."), h("li", {}, "풀이 후에 해설이 나오며, 같은 문항은 다시 평가에 쓰이지 않습니다."),
        h("li", {}, "청해는 재생 1회이고, 음원 파일로 재생된 경우만 준비도에 반영됩니다. 브라우저 음성은 평가에 쓰이지 않습니다."), h("li", {}, "시간 제한은 걸지 않습니다. 실전 제한시간 적응도: 미측정")),
      muted(TTS_LIMIT_NOTICE)),
    ...getExamSpec(level).scoringSections.map((sec) => {
      const set = assessmentSet(m.assessPool, m.byId, m.exposed, level, sec.id);
      return card(SECTION_NAME[sec.id], muted(set.available ? `처음 보는 문항 ${set.available}개 중 ${set.items.length}문항을 풉니다.` : "처음 보는 평가 문항이 없습니다. 콘텐츠를 더 가져오세요."),
        set.items.length ? btn("세트 시작", () => ctx.go(`#assess-run/${sec.id}`), "primary", `start-assess-${sec.id}`) : null);
    }),
    btn("리포트 보기", () => ctx.go("#report"), "ghost", "open-report"), btn("돌아가기", () => ctx.go("#learn"), "ghost"));
}

const PASSAGE_LABEL: Record<string, string> = { SHORT: "단문", MEDIUM: "중문", LONG: "장문", INFO: "정보검색" };
export function renderLearn(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model;
  root.append(h("h1", {}, "학습"));
  const weak = m?.review.weak.length ?? 0;
  const gp = m?.grammarPoints.length ?? 0, kn = m?.kanaPairs ?? 0;
  root.append(card("약점 복습", muted(weak ? `최근 많이 틀린 항목 ${weak}개를 모아 복습합니다.` : "아직 틀린 기록이 없어 약점 항목이 없습니다."), weak ? btn("약점 복습 시작", () => ctx.go("#weak"), "primary", "start-weak") : null));
  const n = (m?.studyQuestions.length ?? 0) + (m?.review.session.length ?? 0);
  root.append(card("오늘 세션", n ? muted(`오늘 할 수 있는 항목 ${n}개`) : muted("학습할 콘텐츠가 아직 없습니다. 콘텐츠를 가져오면 여기에 표시됩니다."), n ? btn("오늘 세션 시작", () => ctx.go("#study"), "primary", "learn-start") : null));
  const ln = m?.listeningNext.length ?? 0, dn = m?.dictation.length ?? 0;
  root.append(card("청해", muted(ln ? `오늘 들을 수 있는 항목 ${ln}개` : m && m.listeningToday ? "오늘의 새 청해는 이미 들었습니다." : "들을 청해 콘텐츠가 아직 없습니다. 콘텐츠를 가져오면 표시됩니다."), ln ? btn("청해 시작", () => ctx.go("#listening"), "primary", "start-listening") : null, h("p", { class: "muted", id: "listening-limit" }, TTS_LIMIT_NOTICE)));
  root.append(card("듣고 쓰기", muted(dn ? `짧은 단어·문장 ${dn}개를 듣고 가나로 씁니다.` : "듣고 쓰기 콘텐츠가 아직 없습니다."), dn ? btn("듣고 쓰기 시작", () => ctx.go("#dictation"), "primary", "start-dictation") : null));
  const rd = m?.readingNext;
  root.append(card("독해", muted(rd ? `다음 지문: ${PASSAGE_LABEL[String(rd.passage.payload.type)] ?? "지문"} · 문제 ${rd.questions.length}개` : m && m.readingToday ? "오늘의 새 지문은 이미 읽었습니다." : "읽을 새 지문이 없습니다. 콘텐츠를 가져오면 표시됩니다."), rd ? btn("지문 읽기", () => ctx.go("#reading"), "primary", "start-reading") : null));
  root.append(card("문법 학습", muted(gp ? `문법 포인트 ${gp}개. 설명을 읽고 문맥 문제로 연습합니다.` : "문법 콘텐츠가 아직 없습니다."), gp ? btn("문법 포인트 보기", () => ctx.go("#grammar"), "primary", "open-grammar") : null));
  root.append(card("혼동 글자", muted(kn >= 2 ? `헷갈리는 글자 쌍 ${kn}개로 퀴즈를 풉니다.` : "혼동 글자 콘텐츠가 아직 없습니다. 팩을 가져오면 사용할 수 있습니다."), kn >= 2 ? btn("혼동 글자 퀴즈 시작", () => ctx.go("#kana"), "primary", "start-kana") : null));
  const sets = m ? getExamSpec(ctx.settings.get().targetLevel).scoringSections.reduce((a, sec) => a + (assessmentSet(m.assessPool, m.byId, m.exposed, ctx.settings.get().targetLevel, sec.id).items.length ? 1 : 0), 0) : 0;
  root.append(card("실전 세트", muted(sets ? `처음 보는 평가 문항으로 영역별 실력을 확인합니다. 지금 풀 수 있는 영역 ${sets}개.` : "평가용 콘텐츠가 아직 없습니다. 콘텐츠를 가져오면 표시됩니다."), btn("실전 세트 열기", () => ctx.go("#assess"), sets ? "primary" : "ghost", "open-assess")));
  root.append(card("영역별 학습", muted("이후 작업에서 제공됩니다.")));
  if (ctx.startDemo) root.append(card("개발용 레이아웃 데모", btn("퀴즈 데모 시작", ctx.startDemo)));
}

export function renderGrammarList(root: HTMLElement, ctx: PageCtx): void {
  const m = ctx.model!;
  root.append(h("h1", {}, "문법 학습"),
    ...m.grammarPoints.map((g) => h("section", { class: "card" }, h("h2", {}, String((g.payload as { pattern: string }).pattern)), muted(String((g.payload as { meaningKo: string }).meaningKo)),
      btn("설명 보기", () => ctx.go(`#gp/${encodeURIComponent(g.contentId)}`), "ghost"))),
    btn("돌아가기", () => ctx.go("#learn"), "ghost"));
}

export function renderGrammarPoint(root: HTMLElement, ctx: PageCtx, id: string): void {
  const m = ctx.model!;
  const g = m.grammarPoints.find((x) => x.contentId === id);
  if (!g) { root.append(h("h1", {}, "문법 학습"), muted("해당 문법 포인트를 찾을 수 없습니다."), btn("돌아가기", () => ctx.go("#grammar"), "ghost")); return; }
  const p = g.payload as { pattern: string; attachment: string; meaningKo: string; nuanceKo: string; contrastPatterns: string[]; examples: { ja: string; ko: string }[] };
  const n = m.pool.filter((q) => q.kind === "QUESTION" && q.payload.linkedContentId === id).length;
  root.append(h("h1", {}, p.pattern));
  root.append(
    card("뜻과 접속", h("p", {}, `뜻: ${p.meaningKo}`), h("p", {}, `접속: ${p.attachment}`), h("p", {}, `뉘앙스: ${p.nuanceKo}`)),
    ...(p.contrastPatterns.length ? [card("헷갈리는 문형", h("p", {}, p.contrastPatterns.join(", ")))] : []),
    card("예문", h("ul", {}, ...p.examples.map((e) => h("li", {}, richText(e.ja), h("br", {}), h("span", { class: "muted" }, e.ko))))),
    n ? btn(`연습하기 (${n}문제)`, () => ctx.go(`#gp-run/${encodeURIComponent(id)}`), "primary", "practice-point") : muted("이 문법의 연습 문제가 아직 없습니다."),
    btn("돌아가기", () => ctx.go("#grammar"), "ghost"));
}

export function renderReport(root: HTMLElement, ctx: PageCtx): void {
  root.append(h("h1", {}, "리포트"));
  const m = ctx.model;
  if (!m) { root.append(muted("불러오는 중입니다.")); return; }
  const level = ctx.settings.get().targetLevel;
  // 1. 학습 시간
  const days = dailyMinutes(m.events, m.today);
  const total = days.reduce((a, d) => a + d.minutes, 0);
  root.append(card("학습 시간 (최근 28일)", barChart(days.map((d) => ({ label: d.day.slice(5), value: d.minutes })), { title: `최근 28일 학습 시간: 합계 ${total}분, 학습한 날 ${studiedDays(days)}일`, unit: "분", max: 60 }),
    h("p", { id: "study-summary" }, `합계 ${total}분 · 학습한 날 ${studiedDays(days)}일 / 28일`), muted("하루 목표는 60분입니다. 쉬는 날이 있어도 괜찮습니다.")));
  // 2. 숙련도
  const dist = (st: typeof m.vocabStages) => stageDistribution(st);
  const stageCard = (name: string, st: typeof m.vocabStages) => st.length ? [h("p", { class: "muted" }, name), stageChart(STAGES.map((x) => dist(st)[x]), STAGES.map((x) => STAGE_NAME[x]), `${name} 숙련도 분포`)] : [];
  const vs = stageCard("어휘·한자", m.vocabStages), gs = stageCard("문법", m.grammarStages);
  root.append(card("숙련도 5단계", ...(vs.length || gs.length ? [...vs, ...gs] : [muted("복습 기록이 아직 없습니다.")])));
  // 3. 영역별 준비도 (평가 문항 기준)
  const r = m.readiness;
  root.append(card("영역별 준비도",
    muted(`처음 보는 평가 문항의 최근 ${r.windowDays}일 기록입니다. 학습 중 이미 본 문제, 정답을 먼저 본 문제, 음원이 없는 청해는 세지 않습니다.`),
    accuracyChart(r.sections.map((s) => ({ label: SECTION_NAME[s.id], k: s.k, n: s.n, accuracy: s.accuracy, lo: s.interval?.lo, hi: s.interval?.hi, muted: s.evidence !== "OBSERVED" })), "영역별 정답률(평가 문항). 빗금은 자료 부족"),
    r.overall === "NONE" ? h("p", { id: "readiness-none", class: "banner warn", role: "status" }, "아직 평가 문항을 풀지 않았습니다. 학습 > 실전 세트에서 시작하세요.") : null,
    btn("실전 세트 열기", () => ctx.go("#assess"), "ghost", "report-open-assess")));
  for (const s of r.sections) {
    root.append(h("section", { class: "card", "data-section": s.id },
      h("h2", {}, SECTION_NAME[s.id]), h("span", { class: s.evidence === "OBSERVED" ? "badge" : "badge warn", "data-evidence": s.evidence }, EVIDENCE_LABEL[s.evidence]),
      ...sectionLines(s).map((l) => h("p", { class: "muted" }, l)),
      s.weak ? h("p", { class: "banner warn", role: "status", "data-weak": "1" }, `상대 취약 영역 주의: ${WEAK_NOTE}`) : null,
      s.sources ? h("div", {}, h("span", { class: "badge", id: "tts-badge" }, "TTS 음원 기반"), h("p", { class: "muted", id: "source-mix" }, `음원 구성: ${Object.entries(s.sources).map(([k, v]) => `${SOURCE_LABEL[k as keyof typeof SOURCE_LABEL]} ${v}`).join(", ") || "아직 없음"}`), h("p", { class: "muted" }, TTS_LIMIT_NOTICE)) : null));
  }
  root.append(card("읽는 법",
    h("ul", {}, h("li", {}, "이 화면은 JLPT 점수나 합격 가능성을 계산하지 않습니다. 공식 점수로 바꾸는 방법이 공개되어 있지 않기 때문입니다."),
      h("li", {}, `서로 다른 지문·문항 수와 표본 수(n)를 함께 보세요. n이 ${MIN_SAMPLE} 미만이면 "자료 부족"입니다.`), h("li", {}, "실전 제한시간 적응도: 미측정 (타이머를 강제하지 않습니다)")),
    r.excluded.length ? h("p", { class: "muted", id: "excluded" }, `세지 않은 기록: ${r.excluded.map((x) => `${EXCLUDED_LABEL[x.reason]} ${x.count}건`).join(", ")}`) : null));
  root.append(officialCard(ctx, level));
}

function officialCard(ctx: PageCtx, level: Level): HTMLElement {
  const m = ctx.model!;
  const spec = getExamSpec(level);
  const past = officialResults(m.events);
  const year = h("input", { id: "off-year", type: "number", inputmode: "numeric", min: "2020", max: "2099", "aria-label": "응시 연도" }) as HTMLInputElement;
  const month = h("select", { id: "off-month", "aria-label": "응시 회차" }, ...[7, 12].map((v) => h("option", { value: v }, MONTH_LABEL(v)))) as HTMLSelectElement;
  const scores = spec.scoringSections.map((s) => ({ s, input: h("input", { id: `off-${s.id}`, type: "number", inputmode: "numeric", min: "0", max: String(s.maxScaledScore), "aria-label": `${SECTION_NAME[s.id]} 점수` }) as HTMLInputElement }));
  const pass = h("select", { id: "off-pass", "aria-label": "합격 여부" }, h("option", { value: "" }, "입력 안 함"), h("option", { value: "yes" }, "합격"), h("option", { value: "no" }, "불합격")) as HTMLSelectElement;
  const err = h("div", { id: "off-error", "aria-live": "polite" });
  const save = btn("공식 결과 저장", async () => {
    err.textContent = "";
    const y = Number(year.value);
    if (!Number.isInteger(y) || y < 2020 || y > 2099) { err.append(warn("응시 연도를 확인해 주세요.")); return; }
    const sectionScores: Record<string, number> = {};
    for (const { s, input } of scores) {
      if (input.value === "") continue;
      const v = Number(input.value);
      if (!Number.isFinite(v) || v < 0 || v > s.maxScaledScore) { err.append(warn(`${SECTION_NAME[s.id]} 점수는 0~${s.maxScaledScore} 사이여야 합니다.`)); return; }
      sectionScores[s.id] = v;
    }
    await ctx.recordOfficialResult({ level, year: y, month: Number(month.value), sectionScores, passed: pass.value === "" ? null : pass.value === "yes" });
  }, "primary", "off-save");
  return h("details", { class: "card", id: "official-card", open: past.length > 0 }, h("summary", {}, "실제 공식 시험 결과 기록 (선택)"),
    muted("응시 후 성적표의 값을 직접 입력합니다. 기록용이며 앱의 정답률과 합치거나 비교해 점수를 추정하지 않습니다."),
    h("div", { class: "row" }, h("label", { for: "off-year" }, "연도 "), year, h("label", { for: "off-month" }, "회차 "), month),
    ...scores.map(({ s, input }) => h("div", { class: "row" }, h("label", { for: `off-${s.id}` }, `${SECTION_NAME[s.id]} (0~${s.maxScaledScore}) `), input)),
    h("div", { class: "row" }, h("label", { for: "off-pass" }, "합격 여부 "), pass), err, save,
    past.length ? h("ul", { id: "off-list" }, ...past.map((p) => h("li", {}, `${p.level} ${p.year}년 ${MONTH_LABEL(p.month)}: ${Object.entries(p.sectionScores).map(([k, v]) => `${SECTION_NAME[k as keyof typeof SECTION_NAME] ?? k} ${v}`).join(", ") || "점수 없음"}${p.passed === null ? "" : p.passed ? " · 합격" : " · 불합격"} (직접 입력)`))) : null);
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
  const sum = m ? targetSummary(m) : { text: "불러오는 중입니다.", detail: null };
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
    contentCard(ctx),
    card("고급",
      h("fieldset", { class: "seg" }, h("legend", {}, "청해 재생 횟수(연습)"),
        ...(["UNLIMITED", "ONCE"] as const).map((v) => h("label", { class: "seg-opt" }, h("input", { type: "radio", name: "replays", value: v, checked: s.get().practiceReplays === v, onchange: () => s.set({ practiceReplays: v }) }), h("span", {}, v === "UNLIMITED" ? "무제한" : "1회")))),
      h("label", { class: "seg-opt" }, h("input", { type: "checkbox", id: "tts-fallback", checked: s.get().browserTtsFallback, onchange: (e: Event) => s.set({ browserTtsFallback: (e.target as HTMLInputElement).checked }) }), h("span", {}, "음원 파일이 없으면 브라우저 음성으로 재생 (평가에는 사용되지 않음)")),
      muted("평가용 청해의 재생 횟수 기본값은 1회입니다.")),
    backupCard(ctx),
    card("도움말", btn("도움말 열기", () => ctx.go("#help"), "ghost", "open-help")),
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

const KIND_LABEL: Record<Kind, string> = { KANA: "가나", VOCAB: "어휘", KANJI: "한자", GRAMMAR: "문법", QUESTION: "문제", PASSAGE: "지문", LISTENING: "청해" };
const ACTION_LABEL: Record<string, string> = { ADD: "신규", ADD_VERSION_ACTIVE: "새 버전(활성)", ADD_VERSION_CANDIDATE: "새 버전(후보)", SKIP_SAME: "중복(동일)", SKIP_DUPLICATE_KEY: "중복(같은 항목)", SKIP_SIMILAR: "유사 항목", SKIP_FLAGGED_SAME_HASH: "신고·폐기 항목", REJECT: "거부", HOLD: "보류" };

function kindChecks(name: string): { box: HTMLElement; selected: () => Kind[] } {
  const inputs = KINDS.map((k) => h("input", { type: "checkbox", name, value: k, checked: true, "aria-label": KIND_LABEL[k] }) as HTMLInputElement);
  const box = h("div", { class: "row" }, ...KINDS.map((k, i) => h("label", { class: "seg-opt" }, inputs[i]!, h("span", {}, KIND_LABEL[k]))));
  return { box, selected: () => inputs.filter((i) => i.checked).map((i) => i.value as Kind) };
}

function contentCard(ctx: PageCtx): HTMLElement {
  const m = ctx.model;
  const out = h("div", { id: "pack-report", "aria-live": "polite" });
  const imp = kindChecks("imp-kind");
  const exp = kindChecks("exp-kind");
  let text = "";
  const forced = new Set<string>();
  const show = () => {
    out.textContent = "";
    const r = ctx.planImport(text, imp.selected(), forced);
    if (!r) return;
    out.append(h("p", { id: "report-summary" }, reportLines(r)[0]));
    if (!r.ok) return;
    const rows = r.outcomes.filter((o) => o.action !== "ADD").slice(0, 60);
    if (rows.length) out.append(h("ul", { class: "report-list" }, ...rows.map((o) => h("li", {}, `${ACTION_LABEL[o.action] ?? o.action} · ${o.contentId}${o.detail ? ` — ${o.detail}` : ""}${o.existingId ? ` (기존 ${o.existingId})` : ""}`,
      o.action === "SKIP_SIMILAR" ? h("label", { class: "seg-opt" }, h("input", { type: "checkbox", checked: forced.has(o.contentId), onchange: (e: Event) => { if ((e.target as HTMLInputElement).checked) forced.add(o.contentId); else forced.delete(o.contentId); show(); } }), h("span", {}, "그래도 추가")) : null))));
    if (r.summary.demoted) out.append(muted("검증 증명이 부족한 항목은 미검증(UNVERIFIED)으로 가져옵니다. 가져온 팩의 '검증됨' 표시는 서명이 없는 자가 신고입니다."));
    out.append(h("button", { class: "primary", type: "button", id: "apply-pack", disabled: r.toWrite.length === 0, onclick: async () => {
      out.textContent = "반영 중…";
      const msg = await ctx.applyImport(text, imp.selected(), forced);
      // applying refreshes the model and redraws the page, so write the result into the CURRENT report element
      const cur = document.getElementById("pack-report") ?? out;
      cur.textContent = "";
      cur.append(h("p", { id: "apply-result" }, msg));
    } }, "가져오기 승인"));
  };
  const file = h("input", { type: "file", id: "import-pack-file", accept: "application/json,.json", "aria-label": "팩 파일 선택", onchange: async (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; text = await f.text(); forced.clear(); show(); } });
  const unv = h("input", { type: "checkbox", id: "include-unverified", checked: ctx.settings.get().includeUnverified, onchange: (e: Event) => ctx.settings.set({ includeUnverified: (e.target as HTMLInputElement).checked }) });
  const expUnv = h("input", { type: "checkbox", id: "export-unverified" }) as HTMLInputElement;
  const exMsg = h("div", { id: "export-result", "aria-live": "polite" });
  const flagCount = m?.flags.size ?? 0;
  return card("콘텐츠",
    h("p", { id: "content-count" }, `보유 콘텐츠: ${m?.pool.length ?? 0}개 (학습 가능)`),
    h("label", { class: "seg-opt" }, unv, h("span", {}, "미검증 콘텐츠 포함 (연습에만 사용)")),
    h("h3", {}, "가져오기"), muted("전체 팩 또는 유형별로 가져올 수 있습니다. 쓰기 전에 검사 리포트를 먼저 보여 드립니다."), imp.box, h("label", { for: "import-pack-file" }, "팩 파일 "), file, out,
    h("h3", {}, "내보내기"), exp.box,
    h("label", { class: "seg-opt" }, expUnv, h("span", {}, "미검증 포함")),
    btn("팩 내보내기", () => { const n = ctx.exportPack({ kinds: exp.selected(), includeUnverified: expUnv.checked }); exMsg.textContent = `${n}개 항목을 내보냈습니다. 개인 기록·설정·시트 주소는 포함되지 않습니다.`; }, "primary", "export-pack"), exMsg,
    h("h3", {}, "진도·신고"), muted("PC에서 새 콘텐츠를 만들 때 쓰는 진도 파일입니다. 영역별 정확도, 오개념 태그별 오답 수, 미노출 수, 런웨이만 들어 있습니다."),
    btn("진도 내보내기", () => ctx.exportProgress(), "ghost", "export-progress"),
    h("p", { id: "flag-count" }, `신고한 문제: ${flagCount}개`),
    btn("신고 목록 내보내기", () => { ctx.exportFlags(); }, "ghost", "export-flags"));
}

const HELP: { title: string; lines: string[] }[] = [
  { title: "시트 연결", lines: ["설정 > 시트 연결 > Google 계정으로 연결 → 시트 주소 붙여넣기 → 연결 확인 → 초기화 승인.", "처음에는 테스트용 빈 시트로 시작하세요. 앱은 _JLPT_ 로 시작하는 전용 탭만 만들고 기존 탭은 건드리지 않습니다.", "파일을 직접 연(file://) 로컬 모드에서는 연결할 수 없습니다. 배포된 https 주소로 여세요."] },
  { title: "동기화 배지", lines: ["동기화 완료: 시트에 저장하고 다시 읽어 확인했습니다.", "동기화 전 N건: 아직 이 기기에만 있습니다. 지금 동기화를 누르거나 잠시 기다리세요.", "다시 연결 필요: 연결이 만료되었습니다(약 1시간). 다시 연결을 누르세요. 기록은 그대로입니다.", "오프라인 / 동기화 지연: 연결이 돌아오거나 한도가 풀리면 자동으로 이어집니다.", "읽기 전용: 시트에 쓸 수 없습니다. 권한이나 시트를 확인하세요."] },
  { title: "콘텐츠 추가", lines: ["홈의 남은 학습 분량이 14일 미만이면 PC에서 콘텐츠를 만드세요.", "설정 > 콘텐츠 > 진도 내보내기 → PC에서 npm run content:gen, content:verify, content:pack → 설정 > 콘텐츠 > 가져오기.", "가져오기는 쓰기 전에 검사 리포트를 보여 주고, 승인해야 반영됩니다."] },
  { title: "백업", lines: ["설정 > 백업 > JSON 내보내기를 월 1회 해 두세요. 토큰과 비밀번호는 들어 있지 않습니다.", "현재 실행에서만 유지됨 — 백업 권장 경고가 보이면 지금 내보내세요."] },
  { title: "문제 해결", lines: ["로그인 창이 안 뜨면 팝업 허용을 확인하세요.", "access blocked: Google Cloud 테스트 사용자에 본인 계정이 있어야 합니다.", "기존 기록용 탭이 있어 자동 초기화할 수 없습니다: 새 빈 시트를 쓰세요.", "문제나 해설이 이상하면 해설 화면의 문제 신고를 누르세요."] },
];

export function renderHelp(root: HTMLElement, ctx: PageCtx): void {
  root.append(h("h1", {}, "도움말"),
    ...HELP.map((sec) => h("details", { class: "card" }, h("summary", {}, sec.title), h("ul", {}, ...sec.lines.map((l) => h("li", {}, l))))),
    btn("설정으로 돌아가기", () => ctx.go("#settings"), "ghost", "help-back"));
}
