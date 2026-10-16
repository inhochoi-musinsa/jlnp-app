export interface QuizChoice { id: string; text: string; whyWrong?: string; howToCorrect?: string }
export interface QuizItem {
  id: string;
  stem: string;
  choices: QuizChoice[];
  correctChoiceId: string;
  explanationKo: string;
  stimulusId?: string;
  /** record to report/mark as seen when the item is a card made from another record (e.g. the linked grammar question) */
  refId?: string;
  /** lines shown once before the question (new grammar point principle) */
  intro?: { title: string; lines: string[] };
}
export type Phase = "QUESTION" | "ANSWER_SELECTED" | "FEEDBACK" | "FINISHED";

export interface QuizResult { itemId: string; selectedChoiceId: string; isCorrect: boolean; order: string[]; elapsedActiveMs: number }
export type QuizEvent =
  | { type: "QUESTION_PRESENTED"; itemId: string; order: string[] }
  | { type: "QUESTION_SUBMITTED"; itemId: string; selectedChoiceId: string; isCorrect: boolean; order: string[] }
  | { type: "ANSWER_REVEALED"; itemId: string };

export type Rng = () => number;

/** Fisher-Yates over choice ids. A fresh order is drawn for every attempt. */
export function shuffleIds(ids: string[], rng: Rng = Math.random): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Quiz state machine. There is deliberately no timer and no auto-advance:
 * FEEDBACK only ends through an explicit next() call (UX invariants 1, 2).
 * `timeLimitSeconds` is always null in this shell.
 */
export class QuizSession {
  readonly timeLimitSeconds: null = null;
  phase: Phase = "QUESTION";
  index = 0;
  order: string[] = [];
  selectedId: string | null = null;
  results: QuizResult[] = [];
  private presentedAt = 0;

  constructor(
    readonly items: QuizItem[],
    private emit: (e: QuizEvent) => void = () => {},
    private rng: Rng = Math.random,
    private now: () => number = () => Date.now(),
  ) {
    for (const it of items) {
      if (it.choices.length !== 4) throw new Error(`item ${it.id}: exactly 4 choices required`);
      if (it.choices.filter((c) => c.id === it.correctChoiceId).length !== 1) throw new Error(`item ${it.id}: exactly one correct choice`);
    }
    if (items.length === 0) this.phase = "FINISHED";
    else this.present();
  }

  get item(): QuizItem | null { return this.items[this.index] ?? null; }

  /** Adds an item after the current one (e.g. the one same-session retry of a missed card). */
  insertAfterCurrent(item: QuizItem, gap = 3): void {
    if (item.choices.length !== 4) throw new Error("exactly 4 choices required");
    const at = Math.min(this.items.length, this.index + 1 + gap);
    this.items.splice(at, 0, item);
  }

  private present(): void {
    const it = this.items[this.index]!;
    this.order = shuffleIds(it.choices.map((c) => c.id), this.rng);
    this.selectedId = null;
    this.phase = "QUESTION";
    this.presentedAt = this.now();
    this.emit({ type: "QUESTION_PRESENTED", itemId: it.id, order: [...this.order] });
  }

  select(choiceId: string): void {
    if (this.phase !== "QUESTION" && this.phase !== "ANSWER_SELECTED") return;
    if (!this.order.includes(choiceId)) return;
    this.selectedId = choiceId;
    this.phase = "ANSWER_SELECTED";
  }

  /** "정답 확인": only possible after a choice has been selected. */
  submit(): void {
    if (this.phase !== "ANSWER_SELECTED" || !this.selectedId) return;
    const it = this.item!;
    const isCorrect = this.selectedId === it.correctChoiceId;
    this.results.push({ itemId: it.id, selectedChoiceId: this.selectedId, isCorrect, order: [...this.order], elapsedActiveMs: this.now() - this.presentedAt });
    this.phase = "FEEDBACK";
    this.emit({ type: "QUESTION_SUBMITTED", itemId: it.id, selectedChoiceId: this.selectedId, isCorrect, order: [...this.order] });
    this.emit({ type: "ANSWER_REVEALED", itemId: it.id });
  }

  /** "다음 계속하기": the only way out of FEEDBACK. */
  next(): void {
    if (this.phase !== "FEEDBACK") return;
    if (this.index + 1 >= this.items.length) { this.phase = "FINISHED"; return; }
    this.index++;
    this.present();
  }
}
