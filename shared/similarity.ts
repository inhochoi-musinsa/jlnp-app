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
