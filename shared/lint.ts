import { MAX_PAYLOAD_CHARS, type ContentRecord, type Issue } from "./schema";
import { nfkc } from "./normalize";

const KANA_ONLY = /^[ぁ-ゖァ-ヺー]+$/u; // hiragana, katakana, long-vowel mark
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const HTML = /<\s*\/?\s*[a-zA-Z!]/;
const URLISH = /(?:https?:\/\/|www\.|javascript:|data:text)/i;

export const isKanaOnly = (s: string): boolean => KANA_ONLY.test(s);

function* strings(v: unknown, path = ""): Generator<[string, string]> {
  if (typeof v === "string") yield [path, v];
  else if (Array.isArray(v)) for (let i = 0; i < v.length; i++) yield* strings(v[i], `${path}[${i}]`);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* strings(x, path ? `${path}.${k}` : k);
}

/** IMP-07 safety checks: HTML tags, URLs, control characters, payload size. */
export function safetyIssues(rec: Pick<ContentRecord, "payload">): Issue[] {
  const out: Issue[] = [];
  const json = JSON.stringify(rec.payload);
  if (json.length > MAX_PAYLOAD_CHARS) out.push({ code: "PAYLOAD_TOO_LARGE", path: "payload", message: `payload ${json.length} > ${MAX_PAYLOAD_CHARS}` });
  for (const [path, s] of strings(rec.payload, "payload")) {
    if (HTML.test(s)) out.push({ code: "HTML_FORBIDDEN", path, message: "HTML tags are not allowed" });
    if (URLISH.test(s)) out.push({ code: "URL_FORBIDDEN", path, message: "URLs are not allowed" });
    if (CONTROL.test(s)) out.push({ code: "CONTROL_CHAR", path, message: "control characters are not allowed" });
  }
  return out;
}

const COMMON_PREFIX = (a: string[]): number => {
  if (!a.length) return 0;
  let n = 0;
  while (a.every((s) => s.length > n && s[n] === a[0]![n])) n++;
  return n;
};

// Context cues: time words, connectives/particles that carry clause relations, actors.
const CUE_PATTERNS: RegExp[] = [
  /昨日|今日|明日|毎日|毎朝|今朝|さっき|もう|まだ|ずっと|いつも|去年|来年|先週|来週|今度|これから|もうすぐ|前に|後で/u,
  /から|ので|けれど|けど|のに|ため|ために|ように|ながら|たら|ば、|ても|たあと|てから|まえに/u,
  /私|僕|彼|彼女|先生|母|父|友達|友人|兄|姉|弟|妹|社長|部長|客|店員|子供|田中|山田|鈴木/u,
  /ない|なかった|ません|でした|ました|ている|ていた|てある|ておく/u,
];
const PARTICLES = ["は", "が", "を", "に", "で", "と", "へ", "も", "の"];
export function contextCueCount(stem: string): number {
  const s = nfkc(stem);
  // a stem that already uses three or more different particles carries clause structure of its own
  const particleCue = PARTICLES.filter((x) => s.includes(x)).length >= 3 ? 1 : 0;
  return CUE_PATTERNS.reduce((n, re) => n + (re.test(s) ? 1 : 0), particleCue);
}

/**
 * IMP-05 heuristic: GRAMMAR_FORM / TEXT_GRAMMAR choices that differ only by their
 * tail (ending) while the stem offers fewer than 2 context cue categories.
 * Returns true when the item is likely solvable from the ending alone.
 */
export function endingOnlySolvable(stem: string, choiceTexts: string[]): boolean {
  const t = choiceTexts.map(nfkc);
  const prefix = COMMON_PREFIX(t);
  const tails = t.map((s) => s.slice(prefix));
  const tailOnly = prefix >= 1 && tails.every((x) => x.length <= 6) && new Set(tails).size === t.length;
  return tailOnly && contextCueCount(stem) < 2;
}

/** SCHEMA_LINT semantic rules (V1). Structure must already have been validated. */
export function lintRecord(rec: ContentRecord): Issue[] {
  const out: Issue[] = [...safetyIssues(rec)];
  const p = rec.payload;
  const add = (code: string, path: string, message: string) => out.push({ code, path, message });
  if (rec.kind === "VOCAB" && typeof p.reading === "string" && !isKanaOnly(p.reading)) add("READING_CHARS", "payload.reading", "reading must be kana only");
  if (rec.kind === "KANA") {
    const chars = (p.chars ?? []) as string[];
    const kanaChar = /^[\u3041-\u3096\u30A1-\u30FA]$/u;
    if (chars.length !== 2 || chars[0] === chars[1] || !chars.every((c) => kanaChar.test(c))) add("KANA_CHARS", "payload.chars", "chars must be two different single kana");
    else {
      const rd = chars.map((c) => (p.readings ?? {})[c]);
      if (rd.some((x) => typeof x !== "string" || !x.trim())) add("KANA_READINGS", "payload.readings", "each character needs a reading");
      else if (rd[0] === rd[1]) add("KANA_READINGS", "payload.readings", "the two readings must differ");
    }
  }
  if (rec.kind === "KANJI") for (const k of [...(p.onyomi ?? []), ...(p.kunyomi ?? [])]) if (!isKanaOnly(String(k).replace(/[.\-]/g, ""))) add("READING_CHARS", "payload.onyomi/kunyomi", `non-kana reading: ${k}`);
  if (rec.kind === "QUESTION") {
    const choices: { id: string; text: string; whyWrong?: string; howToCorrect?: string }[] = p.choices ?? [];
    const texts = choices.map((c) => nfkc(c.text).trim());
    if (new Set(texts).size !== texts.length) add("CHOICE_DUPLICATE", "payload.choices", "choices must be distinct");
    const wrong = choices.filter((c) => c.id !== p.correctChoiceId);
    for (const c of wrong) {
      if (!c.whyWrong?.trim() || !c.howToCorrect?.trim()) add("WRONG_EXPLANATION_MISSING", `payload.choices.${c.id}`, "wrong choices need whyWrong and howToCorrect");
    }
    const whys = wrong.map((c) => nfkc(c.whyWrong ?? "").trim());
    if (new Set(whys).size !== whys.length) add("WRONG_EXPLANATION_DUPLICATE", "payload.choices", "whyWrong must differ between wrong choices");
    const correct = choices.find((c) => c.id === p.correctChoiceId);
    if (correct && (correct.whyWrong || correct.howToCorrect)) add("CORRECT_HAS_WRONG_FIELDS", `payload.choices.${correct.id}`, "correct choice must not have whyWrong/howToCorrect");
    if ((p.domain === "GRAMMAR_FORM" || p.domain === "TEXT_GRAMMAR") && endingOnlySolvable(String(p.stem), texts))
      add("GRAMMAR_ENDING_ONLY", "payload.stem", "choices differ only by ending and stem has < 2 context cues");
  }
  if (rec.kind === "LISTENING" && p.audio && p.audio.source === "BROWSER_TTS" && rec.pool === "ASSESS") add("ASSESS_BROWSER_TTS", "payload.audio", "ASSESS items must not rely on BROWSER_TTS");
  return out;
}
