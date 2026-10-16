import { QuizSession, type QuizChoice, type QuizEvent, type QuizItem } from "../domain/quiz";
import { h, richText } from "./dom";

export interface QuizOptions {
  context?: "study" | "assess";
  onEvent?: (e: QuizEvent) => void;
  onExit?: () => void;
  onFinish?: (s: QuizSession) => void;
  rng?: () => number;
  /** Optional "문제 신고" hook (T08). */
  onReport?: (item: QuizItem) => void;
  /** Shown as "offset+index+1 / total" (used when resuming a longer set). */
  progress?: { offset: number; total: number };
  /** Called right after the answer is submitted (before feedback is drawn). */
  afterSubmit?: (item: QuizItem, isCorrect: boolean, session: QuizSession) => void;
}

const MARKS = ["①", "②", "③", "④"];

/**
 * QuizShell: ONE component for question and feedback. The four choices stay in the same
 * place with the same size; only the pane above them (stem -> explanation) and the main
 * action change. Long stems / explanations are split into pages, never scrolled or shrunk.
 */
export class QuizShell {
  private session: QuizSession;
  private root: HTMLElement;
  private pageIndex = 0;
  private detailChoiceId: string | null = null;
  private introSeen = new Set<string>();
  private resizeObs?: ResizeObserver;

  constructor(private host: HTMLElement, items: QuizItem[], private opts: QuizOptions = {}) {
    this.session = new QuizSession(items, (e) => opts.onEvent?.(e), opts.rng);
    this.root = h("section", { class: "quiz", "data-context": opts.context ?? "study", "aria-label": "퀴즈" });
    host.textContent = "";
    host.append(this.root);
    this.render();
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObs = new ResizeObserver(() => this.repaginate());
      this.resizeObs.observe(this.root);
    }
  }

  destroy(): void { this.resizeObs?.disconnect(); this.host.textContent = ""; }

  private render(): void {
    const s = this.session;
    this.root.textContent = "";
    if (s.phase === "FINISHED") { this.renderDone(); return; }
    const item = s.item!;
    const feedback = s.phase === "FEEDBACK";
    this.pageIndex = 0;
    if (s.phase === "QUESTION" && item.intro && !this.introSeen.has(item.id)) { this.renderIntro(item); return; }

    const header = h("header", { class: "quiz-head" },
      h("span", { class: "quiz-progress", "aria-live": "polite" }, `${s.index + 1 + (this.opts.progress?.offset ?? 0)} / ${this.opts.progress?.total ?? s.items.length}`),
      h("button", { class: "ghost", type: "button", onclick: () => this.opts.onExit?.() }, "나가기"));

    const pane = h("div", { class: "pane", id: "pane" },
      h("div", { class: "pane-body", id: "pane-body" }),
      h("div", { class: "pager", id: "pager", hidden: true }));

    const choices = h("div", { class: "choices", role: feedback ? "group" : "radiogroup", "aria-label": "보기" },
      ...s.order.map((id, i) => this.choiceButton(item.choices.find((c) => c.id === id)!, i, feedback)));

    const actions = h("div", { class: "actions" });
    if (!feedback) {
      actions.append(h("button", { class: "primary", type: "button", id: "submit", disabled: s.phase !== "ANSWER_SELECTED", onclick: () => { s.submit(); const last = s.results[s.results.length - 1]; if (last) this.opts.afterSubmit?.(item, last.isCorrect, s); this.detailChoiceId = s.selectedId; this.render(); } }, "정답 확인"));
    } else {
      if (this.opts.onReport) actions.append(h("button", { class: "ghost", type: "button", onclick: () => this.opts.onReport!(item) }, "문제 신고"));
      actions.append(h("button", { class: "primary", type: "button", id: "next", onclick: () => { s.next(); this.detailChoiceId = null; this.render(); } }, "다음 계속하기"));
    }
    this.root.append(header, pane, choices, actions);
    this.fillPane(feedback);
  }

  /** One-time principle screen before the first question of a new grammar point (no choices here, so nothing to hide later). */
  private renderIntro(item: QuizItem): void {
    const s = this.session;
    this.root.textContent = "";
    this.root.classList.add("is-intro");
    const header = h("header", { class: "quiz-head" }, h("span", { class: "quiz-progress" }, `${s.index + 1 + (this.opts.progress?.offset ?? 0)} / ${this.opts.progress?.total ?? s.items.length}`), h("button", { class: "ghost", type: "button", onclick: () => this.opts.onExit?.() }, "나가기"));
    const pane = h("div", { class: "pane", id: "pane" }, h("div", { class: "pane-body", id: "pane-body" }), h("div", { class: "pager", id: "pager", hidden: true }));
    const actions = h("div", { class: "actions" }, h("button", { class: "primary", type: "button", id: "intro-go", onclick: () => { this.introSeen.add(item.id); this.root.classList.remove("is-intro"); this.render(); } }, "문제 풀기"));
    this.root.append(header, pane, actions);
    this.pendingIntro = item;
    this.fillPane(false);
  }
  private pendingIntro: QuizItem | null = null;

  private choiceButton(c: QuizChoice, i: number, feedback: boolean): HTMLElement {
    const s = this.session;
    const item = s.item!;
    const selected = s.selectedId === c.id;
    let cls = "choice";
    let label = "";
    if (feedback) {
      if (c.id === item.correctChoiceId) { cls += " is-correct"; label = " 정답"; }
      else if (selected) { cls += " is-wrong"; label = " 내 선택(오답)"; }
      if (this.detailChoiceId === c.id) cls += " is-detail";
    } else if (selected) cls += " is-selected";
    const btn = h("button", {
      class: cls, type: "button", "data-choice": c.id,
      role: feedback ? undefined : "radio", "aria-checked": feedback ? undefined : String(selected),
      "aria-pressed": feedback ? String(this.detailChoiceId === c.id) : undefined,
      onclick: () => {
        if (feedback) { this.detailChoiceId = c.id; this.render(); }
        else { s.select(c.id); this.render(); }
      },
    }, h("span", { class: "mark", "aria-hidden": "true" }, MARKS[i] ?? ""), h("span", { class: "ctext" }, richText(c.text)));
    if (label) btn.append(h("span", { class: "sr-only" }, label));
    return btn;
  }

  /** Builds the pane content (stem, or explanation + selected choice detail) as page chunks. */
  private chunks(feedback: boolean): HTMLElement[] {
    const item = this.session.item!;
    const out: HTMLElement[] = [];
    if (this.root.classList.contains("is-intro") && item.intro) {
      out.push(h("p", { class: "chunk strong" }, item.intro.title));
      for (const l of item.intro.lines) out.push(h("p", { class: "chunk" }, richText(l)));
      return out;
    }
    const sentences = (t: string) => t.split(/(?<=[。！？\n])/u).map((x) => x.trim()).filter(Boolean);
    if (!feedback) {
      for (const sent of sentences(item.stem)) out.push(h("p", { class: "chunk" }, richText(sent)));
      return out;
    }
    const picked = item.choices.find((c) => c.id === this.detailChoiceId) ?? item.choices.find((c) => c.id === item.correctChoiceId)!;
    const isCorrect = picked.id === item.correctChoiceId;
    out.push(h("p", { class: "chunk strong" }, `${isCorrect ? "정답" : "오답"}: `, richText(picked.text)));
    if (isCorrect) for (const s of sentences(item.explanationKo)) out.push(h("p", { class: "chunk" }, s));
    else {
      if (picked.whyWrong) out.push(h("p", { class: "chunk" }, h("b", {}, "왜 틀렸나: "), picked.whyWrong));
      if (picked.howToCorrect) out.push(h("p", { class: "chunk" }, h("b", {}, "고치려면: "), richText(picked.howToCorrect)));
    }
    return out;
  }

  private pages: HTMLElement[][] = [];
  private fillPane(feedback: boolean): void {
    const body = this.root.querySelector<HTMLElement>("#pane-body")!;
    const pager = this.root.querySelector<HTMLElement>("#pager")!;
    const chunks = this.chunks(feedback);
    const fits = () => body.scrollHeight <= body.clientHeight + 1;
    const paginate = (reservePager: boolean): HTMLElement[][] => {
      pager.hidden = !reservePager;
      const pages: HTMLElement[][] = [];
      let cur: HTMLElement[] = [];
      body.textContent = "";
      for (const c of chunks) {
        body.append(c);
        if (!fits() && cur.length) {
          body.removeChild(c);
          pages.push(cur); cur = [c];
          body.textContent = ""; body.append(c);
        } else cur.push(c);
      }
      if (cur.length) pages.push(cur);
      return pages;
    };
    let pages = paginate(false);
    if (pages.length > 1) pages = paginate(true);
    this.pages = pages;
    this.pageIndex = Math.min(this.pageIndex, Math.max(0, pages.length - 1));
    this.showPage(pager, body);
  }

  private showPage(pager: HTMLElement, body: HTMLElement): void {
    body.textContent = "";
    for (const c of this.pages[this.pageIndex] ?? []) body.append(c);
    pager.textContent = "";
    if (this.pages.length > 1) {
      pager.hidden = false;
      pager.append(
        h("button", { class: "ghost", type: "button", disabled: this.pageIndex === 0, "aria-label": "이전 페이지", onclick: () => { this.pageIndex--; this.showPage(pager, body); } }, "이전"),
        h("span", { "aria-live": "polite" }, `${this.pageIndex + 1} / ${this.pages.length}`),
        h("button", { class: "ghost", type: "button", disabled: this.pageIndex >= this.pages.length - 1, "aria-label": "다음 페이지", onclick: () => { this.pageIndex++; this.showPage(pager, body); } }, "다음"));
    }
  }

  private lastW = 0;
  private repaginate(): void {
    const w = this.root.clientWidth;
    if (w === this.lastW || this.session.phase === "FINISHED") { this.lastW = w; return; }
    this.lastW = w;
    this.fillPane(this.session.phase === "FEEDBACK");
  }

  private renderDone(): void {
    const s = this.session;
    const correct = s.results.filter((r) => r.isCorrect).length;
    this.root.append(
      h("div", { class: "pane done" }, h("h2", {}, "세션 완료"), h("p", {}, `${s.results.length}문제 중 ${correct}문제 정답 (연습 결과이며 공식 점수가 아닙니다).`)),
      h("div", { class: "actions" }, h("button", { class: "primary", type: "button", onclick: () => this.opts.onExit?.() }, "돌아가기")));
    this.opts.onFinish?.(s);
  }
}
