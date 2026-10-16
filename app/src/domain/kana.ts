import type { ContentRecord } from "../../../shared/schema";
import { sha256Hex } from "../../../shared/hash";
import type { SyncEvent } from "../storage/events";
import type { QuizChoice, QuizItem } from "./quiz";

export type KanaMode = "READ" | "CHOOSE";
export const kanaItemId = (pairId: string, mode: KanaMode) => `kana:${pairId}:${mode}`;
export function parseKanaItemId(id: string): { pairId: string; mode: KanaMode } | null {
  const m = /^kana:(.+):(READ|CHOOSE)$/.exec(id);
  return m ? { pairId: m[1]!, mode: m[2] as KanaMode } : null;
}

interface Pair { id: string; chars: [string, string]; readings: Record<string, string>; note: string }
const pairOf = (r: ContentRecord): Pair => {
  const p = r.payload as { chars: [string, string]; readings: Record<string, string>; confusionNoteKo: string };
  return { id: r.contentId, chars: p.chars, readings: p.readings, note: p.confusionNoteKo };
};
/** A usable pair: two characters, each with a reading, and the readings differ. */
const usable = (p: Pair) => p.chars.length === 2 && p.chars.every((c) => typeof p.readings?.[c] === "string" && p.readings[c]!.length > 0) && p.readings[p.chars[0]] !== p.readings[p.chars[1]];

export const kanaPairs = (pool: ContentRecord[]): ContentRecord[] => pool.filter((r) => r.kind === "KANA" && usable(pairOf(r)));

function rngFor(seed: string): () => number {
  let a = parseInt(sha256Hex(seed).slice(0, 8), 16) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** One of the two question forms for a confusable pair; needs at least one other pair to supply two further choices. */
export function kanaQuestion(rec: ContentRecord, mode: KanaMode, all: ContentRecord[], day: string): QuizItem | null {
  const pair = pairOf(rec);
  const others = all.filter((r) => r.contentId !== rec.contentId).map(pairOf).filter(usable);
  if (!usable(pair) || !others.length) return null;
  const rng = rngFor(`${rec.contentId}|${mode}|${day}`);
  const [a, b] = pair.chars;
  const ra = pair.readings[a]!, rb = pair.readings[b]!;
  const pool = others.flatMap((o) => o.chars.map((c) => ({ ch: c, rd: o.readings[c]! })));
  const taken = new Set<string>(mode === "READ" ? [ra, rb] : [a, b]);
  const extra: { ch: string; rd: string }[] = [];
  for (const x of pool.map((v) => ({ v, k: rng() })).sort((p, q) => p.k - q.k).map((v) => v.v)) {
    const key = mode === "READ" ? x.rd : x.ch;
    if (taken.has(key) || (mode === "CHOOSE" && x.rd === ra) || (mode === "READ" && x.ch === a)) continue;
    taken.add(key); extra.push(x);
    if (extra.length === 2) break;
  }
  if (extra.length < 2) return null;
  const how = `「${a}」は「${ra}」です。${pair.note}`;
  if (mode === "READ") {
    const choices: QuizChoice[] = [
      { id: "a", text: ra },
      { id: "b", text: rb, whyWrong: `「${rb}」는 「${b}」의 읽기입니다. 「${a}」와 모양이 비슷해 헷갈리기 쉽습니다.`, howToCorrect: how },
      ...extra.map((x, i) => ({ id: "cd"[i]!, text: x.rd, whyWrong: `「${x.rd}」는 「${x.ch}」의 읽기이며 「${a}」의 읽기가 아닙니다.`, howToCorrect: how })),
    ];
    return { id: kanaItemId(rec.contentId, mode), refId: rec.contentId, stem: `「${a}」の読み方はどれですか。`, choices, correctChoiceId: "a", explanationKo: `「${a}」는 「${ra}」로 읽습니다. ${pair.note}` };
  }
  const choices: QuizChoice[] = [
    { id: "a", text: a },
    { id: "b", text: b, whyWrong: `「${b}」는 「${rb}」로 읽는 글자입니다. 「${ra}」로 읽는 「${a}」와 모양이 비슷합니다.`, howToCorrect: `「${ra}」로 읽는 글자는 「${a}」입니다. ${pair.note}` },
    ...extra.map((x, i) => ({ id: "cd"[i]!, text: x.ch, whyWrong: `「${x.ch}」는 「${x.rd}」로 읽는 글자입니다.`, howToCorrect: `「${ra}」로 읽는 글자는 「${a}」입니다. ${pair.note}` })),
  ];
  return { id: kanaItemId(rec.contentId, mode), refId: rec.contentId, stem: `「${ra}」로 읽는 글자는 어느 것입니까?`, choices, correctChoiceId: "a", explanationKo: `「${ra}」로 읽는 글자는 「${a}」입니다. ${pair.note}` };
}

/** Mistake count per pair from the learner's own answers. */
export function kanaMistakes(events: SyncEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "QUESTION_SUBMITTED") continue;
    const p = JSON.parse(e.payloadJson);
    if (typeof p.kanaPair === "string" && !p.isCorrect) m.set(p.kanaPair, (m.get(p.kanaPair) ?? 0) + 1);
  }
  return m;
}

/** Up to `n` questions; pairs the learner missed before are drawn more often. Deterministic per day. */
export function kanaSession(pool: ContentRecord[], events: SyncEvent[], day: string, n = 10): QuizItem[] {
  const pairs = kanaPairs(pool);
  if (pairs.length < 2) return [];
  const miss = kanaMistakes(events);
  const rng = rngFor(`session|${day}|${pairs.length}`);
  const weighted = pairs.map((r) => ({ r, k: rng() / (1 + 2 * (miss.get(r.contentId) ?? 0)) })).sort((x, y) => x.k - y.k).map((x) => x.r);
  const out: QuizItem[] = [];
  for (let i = 0; out.length < n && i < weighted.length * 2; i++) {
    const r = weighted[i % weighted.length]!;
    const q = kanaQuestion(r, i < weighted.length ? "READ" : "CHOOSE", pairs, day);
    if (q && !out.some((x) => x.id === q.id)) out.push(q);
  }
  return out;
}
