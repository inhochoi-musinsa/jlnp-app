import { nfkc } from "./normalize";

const strip = (s: string) => nfkc(s).replace(/[\s　\p{P}\p{S}]/gu, "");

export function ngrams(text: string, n = 3): Set<string> {
  const t = strip(text);
  const out = new Set<string>();
  if (t.length < n) { if (t) out.add(t); return out; }
  for (let i = 0; i <= t.length - n; i++) out.add(t.slice(i, i + n));
  return out;
}

/** Jaccard similarity over character n-grams. `[실무 제안]` threshold 0.85 (execution_plan §4.6). */
export function similarity(a: string, b: string, n = 3): number {
  const A = ngrams(a, n), B = ngrams(b, n);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export const SIMILARITY_THRESHOLD = 0.85;

/**
 * Inverted n-gram index so near-duplicate checks stay fast for thousands of items.
 * A candidate needs at least `threshold * smaller set size` shared grams to reach the Jaccard threshold.
 */
export class SimIndex {
  private grams = new Map<string, string[]>();
  private sets = new Map<string, { kind: string; g: Set<string> }>();
  add(id: string, kind: string, text: string): void {
    const g = ngrams(text);
    this.sets.set(id, { kind, g });
    for (const x of g) (this.grams.get(x) ?? this.grams.set(x, []).get(x)!).push(id);
  }
  find(kind: string, text: string, threshold = SIMILARITY_THRESHOLD, selfId?: string): { id: string; score: number } | null {
    const g = ngrams(text);
    if (!g.size) return null;
    const hits = new Map<string, number>();
    for (const x of g) for (const id of this.grams.get(x) ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
    let best: { id: string; score: number } | null = null;
    for (const [id, inter] of hits) {
      if (id === selfId) continue;
      const o = this.sets.get(id)!;
      if (o.kind !== kind) continue;
      const score = inter / (g.size + o.g.size - inter);
      if (score >= threshold && (!best || score > best.score)) best = { id, score };
    }
    return best;
  }
}
