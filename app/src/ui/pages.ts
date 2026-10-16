import { FONT_SCALES, FURIGANA_MODES, THEMES, type SettingsStore, type UserSettings } from "../domain/settings";
import { LEVELS, type Level } from "../../../shared/examSpec";
import { runtimeModeLabel, type RuntimeMode } from "../runtime";
import { h } from "./dom";

export interface PageCtx {
  mode: RuntimeMode;
  settings: SettingsStore;
  version: string;
  availableLevels: Level[];
  startDemo?: () => void;
}

const card = (title: string, ...body: (Node | string)[]) => h("section", { class: "card" }, h("h2", {}, title), ...body);
const muted = (t: string) => h("p", { class: "muted" }, t);

export function renderHome(root: HTMLElement, ctx: PageCtx): void {
  root.append(
    h("h1", {}, "홈"),
    card("오늘의 60분", muted("아직 학습 계획이 없습니다. 배치 진단 후 오늘의 60분 플랜이 만들어집니다.")),
    card("오늘 복습", muted("복습할 항목이 없습니다.")),
    card("영역", h("div", { class: "areas" }, ...["어휘·한자", "문법", "독해·청해"].map((n) => h("div", { class: "area" }, h("b", {}, n), muted("자료 없음"))))),
    card("목표", muted("목표 연도/월이 아직 설정되지 않았습니다.")),
    card("동기화", h("span", { class: ctx.mode === "LOCAL_FILE" ? "badge warn" : "badge" }, ctx.mode === "LOCAL_FILE" ? "로컬 모드 · 시트에 저장되지 않음" : "시트 연결 전")),
  );
}

export function renderLearn(root: HTMLElement, ctx: PageCtx): void {
  root.append(
    h("h1", {}, "학습"),
    card("오늘 세션", muted("학습할 콘텐츠가 아직 없습니다. 콘텐츠를 가져오면 여기에 표시됩니다.")),
    card("영역별 학습 · 약점 복습 · 혼동 글자", muted("v1.0.0에서 제공됩니다.")),
  );
  if (ctx.startDemo) root.append(card("개발용 레이아웃 데모", h("button", { class: "primary", type: "button", onclick: ctx.startDemo }, "퀴즈 데모 시작")));
}

export function renderReport(root: HTMLElement): void {
  root.append(h("h1", {}, "리포트"), card("리포트", muted("학습 시간·정확도·영역별 준비도는 v3.0.0에서 제공됩니다.")));
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

export function renderSettings(root: HTMLElement, ctx: PageCtx): void {
  const s = ctx.settings;
  const level = h("select", { id: "level", onchange: (e: Event) => s.set({ targetLevel: (e.target as HTMLSelectElement).value as Level }) },
    ...LEVELS.filter((l) => ctx.availableLevels.includes(l)).map((l) => h("option", { value: l, selected: l === s.get().targetLevel }, l)));
  root.append(
    h("h1", {}, "설정"),
    card("표시",
      segmented("font", "글자 크기", "fontScale", FONT_SCALES, FONT_LABEL, s),
      segmented("furi", "후리가나", "furiganaMode", FURIGANA_MODES, FURI_LABEL, s),
      segmented("theme", "화면 색", "theme", THEMES, THEME_LABEL, s),
      muted("글자는 화면에 맞춰 자동으로 줄어들지 않습니다.")),
    card("목표 급수", h("label", { for: "level" }, "목표 급수 "), level, muted("콘텐츠가 있는 급수만 선택할 수 있습니다. 바꿔도 기존 기록은 지워지지 않습니다.")),
    card("앱 정보", h("p", {}, `버전 v${ctx.version}`), h("p", {}, `실행 환경: ${runtimeModeLabel(ctx.mode)}`)),
  );
}
