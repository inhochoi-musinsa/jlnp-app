import type { ContentRecord } from "../../../shared/schema";
import { sha256Hex } from "../../../shared/hash";
import { stripRuby } from "../../../shared/ruby";
import type { QuizChoice, QuizItem } from "./quiz";
import { cardKey, newCard, type CardState, type Direction } from "./srs";

type Vocab = { surface: string; reading: string; pos: string; meaningKo: string; example: { ja: string; ko: string } };
const v = (r: ContentRecord) => r.payload as unknown as Vocab;

export const cardItemId = (contentId: string, d: Direction, retry = false) => `card:${contentId}:${d}${retry ? ":retry" : ""}`;
export function parseCardItemId(id: string): { contentId: string; direction: Direction; retry: boolean } | null {
  const m = /^card:(.+):(READING|MEANING|AUDIO|CLOZE)(:retry)?$/.exec(id);
  return m ? { contentId: m[1]!, direction: m[2] as Direction, retry: !!m[3] } : null;
}

/** Directions that can be asked for a word given the current pool. AUDIO arrives with listening audio (v2.0.0). */
export function directionsFor(r: ContentRecord, vocab: ContentRecord[]): Direction[] {
  if (vocab.length < 4) return [];
  const p = v(r);
  const out: Direction[] = ["READING", "MEANING"];
  if (stripRuby(p.example.ja).includes(p.surface)) out.push("CLOZE");
  return out;
}

function rngFor(seed: string): () => number {
  let a = parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Distinct distractor words: not the target, different answer text, same part of speech first. Deterministic per (word, direction, day). */
function pickDistractors(target: ContentRecord, vocab: ContentRecord[], text: (p: Vocab) => string, seed: string): ContentRecord[] {
  const want = text(v(target));
  const seen = new Set<string>([want]);
  const rng = rngFor(seed);
  const shuffled = vocab.filter((o) => o.contentId !== target.contentId).map((o) => ({ o, k: rng() })).sort((a, b) => a.k - b.k).map((x) => x.o);
  const samePos = shuffled.filter((o) => v(o).pos === v(target).pos);
  const out: ContentRecord[] = [];
  for (const o of [...samePos, ...shuffled.filter((x) => !samePos.includes(x))]) {
    const t = text(v(o));
    if (seen.has(t)) continue;
    seen.add(t); out.push(o);
    if (out.length === 3) break;
  }
  return out;
}

/** A 4-choice question for one card. Every wrong choice carries a real reason and a fix derived from the data. */
export function cardQuestion(rec: ContentRecord, dir: Direction, vocab: ContentRecord[], day: string, retry = false): QuizItem | null {
  if (!directionsFor(rec, vocab).includes(dir)) return null;
  const p = v(rec);
  const seed = `${rec.contentId}|${dir}|${day}`;
  const base = { id: cardItemId(rec.contentId, dir, retry), correctChoiceId: "a" } as const;
  const build = (stem: string, correct: string, d: ContentRecord[], text: (x: Vocab) => string, why: (o: Vocab) => string, how: string, explanationKo: string): QuizItem | null => {
    if (d.length < 3) return null;
    const choices: QuizChoice[] = [{ id: "a", text: correct }, ...d.map((o, i) => ({ id: "bcd"[i]!, text: text(v(o)), whyWrong: why(v(o)), howToCorrect: how }))];
    return { ...base, stem, choices, explanationKo };
  };
  if (dir === "READING") {
    return build(`「${p.surface}」の読み方はどれですか。`, p.reading, pickDistractors(rec, vocab, (x) => x.reading, seed), (x) => x.reading,
      (o) => `「${o.reading}」は「${o.surface}」の読み方で、「${p.surface}」の読み方ではありません。`, `「${p.surface}」の読み方は「${p.reading}」です。`,
      `「${p.surface}」의 읽기는 「${p.reading}」입니다. 뜻: ${p.meaningKo}. 예문: ${p.example.ja} (${p.example.ko})`);
  }
  if (dir === "MEANING") {
    return build(`「${p.surface}」（${p.reading}）の意味はどれですか。`, p.meaningKo, pickDistractors(rec, vocab, (x) => x.meaningKo, seed), (x) => x.meaningKo,
      (o) => `「${o.meaningKo}」는 「${o.surface}」(${o.reading})의 뜻이며, 「${p.surface}」의 뜻이 아닙니다.`, `「${p.surface}」의 뜻은 「${p.meaningKo}」입니다.`,
      `「${p.surface}」(${p.reading})는 「${p.meaningKo}」라는 뜻입니다. 예문: ${p.example.ja} (${p.example.ko})`);
  }
  // CLOZE: the example sentence with the word blanked out
  const sentence = stripRuby(p.example.ja);
  return build(`${sentence.replace(p.surface, "（　　）")}\n（${p.meaningKo}）`, p.surface, pickDistractors(rec, vocab, (x) => x.surface, seed), (x) => x.surface,
    (o) => `「${o.surface}」(${o.meaningKo})는 이 문장의 문맥에 맞지 않습니다.`, `이 문장의 빈칸에는 「${p.surface}」(${p.meaningKo})가 들어갑니다.`,
    `빈칸에는 「${p.surface}」(${p.reading}, ${p.meaningKo})가 들어갑니다. 완성된 문장: ${sentence}`);
}

/** All askable cards for the vocabulary in the pool, merged with their replayed state. */
export function vocabCards(vocab: ContentRecord[], states: Map<string, CardState>): CardState[] {
  return vocab.flatMap((r) => directionsFor(r, vocab).map((d) => states.get(cardKey(r.contentId, d)) ?? newCard(r.contentId, d)));
}
