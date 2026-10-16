// Furigana notation inside content strings (Aozora style):
//   ｜漢字《かんじ》   explicit base            漢字《かんじ》   base = preceding kanji run
export interface RubySegment { text: string; rt?: string }

const RE = /(?:｜([^｜《》\n]+)|([一-鿿々〆ヶ]+))《([^《》\n]+)》/gu;

export function parseRuby(input: string): RubySegment[] {
  const out: RubySegment[] = [];
  let last = 0;
  for (const m of input.matchAll(RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: input.slice(last, idx) });
    out.push({ text: (m[1] ?? m[2])!, rt: m[3]! });
    last = idx + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

/** Text without readings (what a screen reader / matcher should treat as the surface). */
export const stripRuby = (input: string): string => parseRuby(input).map((s) => s.text).join("");
