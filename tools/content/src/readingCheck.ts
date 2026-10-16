import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseRuby } from "../../../shared/ruby";
import type { ContentRecord } from "../../../shared/schema";

export interface Analyzer { readingOf(text: string): string | null }

const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

let cached: Promise<Analyzer> | null = null;
/** kuromoji (Apache-2.0, ipadic bundled). CLI-only; never part of the app bundle. */
export function loadKuromoji(): Promise<Analyzer> {
  cached ??= new Promise<Analyzer>(async (resolve, reject) => {
    const require = createRequire(import.meta.url);
    const kuromoji = require("kuromoji");
    const dicPath = join(dirname(require.resolve("kuromoji/package.json")), "dict");
    kuromoji.builder({ dicPath }).build((err: Error | null, tokenizer: any) => {
      if (err) return reject(err);
      resolve({
        readingOf(text: string) {
          const toks = tokenizer.tokenize(text);
          if (toks.some((t: any) => !t.reading || t.reading === "*")) return null; // unknown word: cannot judge
          return toHiragana(toks.map((t: any) => t.reading).join(""));
        },
      });
    });
  });
  return cached;
}

export interface ReadingFinding { text: string; expected: string; analyzer: string }

/** V2: compares declared readings (VOCAB.reading, ruby annotations) with the morphological analyzer. */
export function readingFindings(rec: ContentRecord, a: Analyzer): ReadingFinding[] {
  const out: ReadingFinding[] = [];
  const cmp = (text: string, reading: string) => {
    if (!/[一-鿿]/.test(text)) return;
    const got = a.readingOf(text);
    if (got !== null && got !== toHiragana(reading)) out.push({ text, expected: reading, analyzer: got });
  };
  if (rec.kind === "VOCAB") cmp(String(rec.payload.surface), String(rec.payload.reading));
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      const segs = parseRuby(v);
      segs.forEach((seg, i) => {
        if (!seg.rt) return;
        // Include the okurigana / particle that follows so verbs and adjectives are read as whole words.
        const suffix = /^[\u3041-\u3096]{0,3}/.exec(segs[i + 1]?.rt === undefined ? segs[i + 1]?.text ?? "" : "")?.[0] ?? "";
        cmp(seg.text + suffix, seg.rt + suffix);
      });
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(rec.payload);
  return out;
}
