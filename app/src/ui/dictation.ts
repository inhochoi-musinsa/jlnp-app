import type { ContentRecord } from "../../../shared/schema";
import type { AudioRef, Segment } from "../../../shared/audio";
import { checkDictation, type DictationResult } from "../domain/listening";
import { ListeningPlayer, type PlayerDeps } from "./audio";
import { h } from "./dom";

export type DictationEvent =
  | { type: "PRESENTED"; contentId: string }
  | { type: "SUBMITTED"; contentId: string; typed: string; expected: string; correct: boolean; scriptOnly: boolean; plays: number; source: string | null };

export interface DictationOptions {
  onEvent?: (e: DictationEvent) => void;
  onExit?: () => void;
  onFinish?: (results: { contentId: string; correct: boolean }[]) => void;
  audio: { allowBrowserTts: boolean; maxPlays: number | null; deps?: PlayerDeps };
}

/**
 * 듣고 쓰기: listen, write the kana, compare. The only input-type exception to the four-choice rule; it still waits
 * for "다음 계속하기" after the answer is checked and never advances on its own (execution_plan §3.2, §6.4).
 */
export class DictationShell {
  private index = 0;
  private phase: "QUESTION" | "FEEDBACK" = "QUESTION";
  private result: DictationResult | null = null;
  private typed = "";
  private results: { contentId: string; correct: boolean }[] = [];
  private players = new Map<string, ListeningPlayer>();
  private root: HTMLElement;

  constructor(private host: HTMLElement, private items: ContentRecord[], private o: DictationOptions) {
    this.root = h("section", { class: "quiz dictation", "aria-label": "듣고 쓰기" });
    host.textContent = ""; host.append(this.root);
    this.render(true);
  }
  destroy(): void { for (const p of this.players.values()) p.stop(); this.host.textContent = ""; }

  private get item(): ContentRecord { return this.items[this.index]!; }
  private player(): ListeningPlayer {
    const it = this.item;
    let p = this.players.get(it.contentId);
    if (!p) {
      p = new ListeningPlayer({ listeningId: it.contentId, ref: it.payload.audio as AudioRef | undefined, segments: it.payload.segments as Segment[], taskType: "UTTERANCE" }, it.contentId, { maxPlays: this.o.audio.maxPlays, allowBrowserTts: this.o.audio.allowBrowserTts, deps: this.o.audio.deps });
      this.players.set(it.contentId, p);
    }
    return p;
  }
  private expected(): string { const seg = (this.item.payload.segments as Segment[])[0]!; return seg.reading ?? seg.text; }

  private render(present = false): void {
    this.root.textContent = "";
    if (this.index >= this.items.length) {
      this.root.append(h("div", { class: "pane done" }, h("h2", {}, "세션 완료"), h("p", {}, `${this.results.length}문제 중 ${this.results.filter((r) => r.correct).length}문제 정답 (연습 결과이며 공식 점수가 아닙니다).`)),
        h("div", { class: "actions" }, h("button", { class: "primary", type: "button", onclick: () => this.o.onExit?.() }, "돌아가기")));
      this.o.onFinish?.(this.results);
      return;
    }
    if (present) this.o.onEvent?.({ type: "PRESENTED", contentId: this.item.contentId });
    const fb = this.phase === "FEEDBACK";
    const p = this.player();
    if (fb) p.maxPlays = null;
    const input = h("input", { id: "dictation-input", type: "text", lang: "ja", inputmode: "text", autocomplete: "off", autocapitalize: "off", spellcheck: "false", "aria-label": "들은 내용을 가나로 입력", value: this.typed, disabled: fb, oninput: (e: Event) => { this.typed = (e.target as HTMLInputElement).value; (this.root.querySelector("#check") as HTMLButtonElement).disabled = this.typed.trim().length === 0; } }) as HTMLInputElement;
    const head = h("header", { class: "quiz-head" }, h("span", { class: "quiz-progress" }, `${this.index + 1} / ${this.items.length}`), h("button", { class: "ghost", type: "button", onclick: () => this.o.onExit?.() }, "나가기"));
    const pane = h("div", { class: "pane", id: "pane" }, h("div", { class: "pane-body", id: "pane-body" }, p.render(), fb ? this.feedbackBlock() : h("p", { class: "muted" }, "들리는 대로 가나(히라가나·가타카나)로 쓰세요. 한자는 쓰지 않습니다.")));
    const actions = h("div", { class: "actions" });
    if (!fb) actions.append(h("button", { class: "primary", type: "button", id: "check", disabled: this.typed.trim().length === 0, onclick: () => this.check() }, "정답 확인"));
    else actions.append(h("button", { class: "primary", type: "button", id: "next", onclick: () => { this.index++; this.phase = "QUESTION"; this.result = null; this.typed = ""; this.render(true); } }, "다음 계속하기"));
    this.root.append(head, pane, h("div", { class: "dict-input" }, input), actions);
    if (!fb) queueMicrotask(() => input.focus({ preventScroll: true }));
  }

  private feedbackBlock(): HTMLElement {
    const r = this.result!;
    const seg = (this.item.payload.segments as Segment[])[0]!;
    return h("div", { id: "dictation-feedback" },
      h("p", { class: r.correct ? "strong ok" : "strong bad", id: "dictation-verdict" }, r.correct ? "정답입니다." : "틀렸습니다."),
      h("p", { id: "dictation-expected" }, `정답: ${this.expected()}`, seg.reading && seg.reading !== seg.text ? ` (${seg.text})` : ""),
      h("p", { id: "dictation-typed" }, "내 답: ", ...r.diff.filter((d) => d.kind !== "missing").map((d) => h("span", { class: `diff-${d.kind}` }, d.text)), this.typed.trim() === "" ? "(비어 있음)" : ""),
      r.correct ? null : h("p", { id: "dictation-diff", class: "muted" }, "차이: ", ...r.diff.map((d) => h("span", { class: `diff-${d.kind}`, title: d.kind === "missing" ? "빠진 글자" : d.kind === "extra" ? "더 쓴 글자" : "맞은 글자" }, d.text))),
      r.scriptOnly ? h("p", { class: "banner warn", id: "script-note" }, "글자 종류(히라가나/가타카나)만 다릅니다. 발음은 같지만 표기는 단어마다 정해져 있어요.") : null,
      h("button", { class: "ghost", type: "button", id: "replay-dictation", onclick: () => { void this.player().play(); } }, "다시 듣기"));
  }

  private check(): void {
    const exp = this.expected();
    this.result = checkDictation(exp, this.typed);
    this.phase = "FEEDBACK";
    const p = this.player();
    this.results.push({ contentId: this.item.contentId, correct: this.result.correct });
    this.o.onEvent?.({ type: "SUBMITTED", contentId: this.item.contentId, typed: this.typed.slice(0, 100), expected: exp, correct: this.result.correct, scriptOnly: this.result.scriptOnly, plays: p.plays, source: p.source });
    this.render();
  }
}
