import { base32, sha256Bytes, sha256Hex } from "./hash";

export const nfkc = (s: string): string => s.normalize("NFKC");

/** Stable JSON: object keys sorted recursively, no whitespace. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
}

const stripSpaces = (s: string) => s.replace(/[\s　]+/g, "");
const stripPunct = (s: string) => s.replace(/[\p{P}\p{S}]/gu, "");
const stripTilde = (s: string) => s.replace(/[~〜～∼˜]/g, "");

type P = Record<string, any>;

/** Duplicate-detection key (execution_plan §4.2). */
export function normalizedKey(kind: string, p: P): string {
  switch (kind) {
    case "VOCAB": return `${nfkc(String(p.surface ?? ""))}|${nfkc(String(p.reading ?? ""))}|${String(p.pos ?? "")}`;
    case "GRAMMAR": return stripTilde(stripSpaces(nfkc(String(p.pattern ?? ""))));
    case "KANJI": return nfkc(String(p.kanji ?? ""));
    case "KANA": return [...((p.chars as string[]) ?? [])].map(nfkc).sort().join("");
    case "QUESTION": {
      const choices = (p.choices as { id: string; text: string }[]) ?? [];
      const correct = choices.find((c) => c.id === p.correctChoiceId)?.text ?? "";
      return `${stripPunct(stripSpaces(nfkc(String(p.stem ?? ""))))}|${stripPunct(stripSpaces(nfkc(correct)))}`;
    }
    case "PASSAGE": return sha256Hex(stripPunct(stripSpaces(nfkc(((p.pages as string[]) ?? []).join("")))));
    case "LISTENING":
      return sha256Hex(stripPunct(stripSpaces(nfkc(((p.segments as { text: string }[]) ?? []).map((s) => s.text).join("")))));
    default: return canonicalJSON(p);
  }
}

const PREFIX: Record<string, string> = { KANA: "kana", VOCAB: "vocab", KANJI: "kanji", GRAMMAR: "gram", QUESTION: "q", PASSAGE: "pass", LISTENING: "lis" };
export const idPrefix = (kind: string): string => PREFIX[kind] ?? kind.toLowerCase();

/** contentId = "<prefix>:<base32(sha256(normalizedKey))[0..10]>" */
export function makeContentId(kind: string, payload: P): string {
  const digest = sha256Bytes(new TextEncoder().encode(normalizedKey(kind, payload)));
  return `${idPrefix(kind)}:${base32(digest).slice(0, 10)}`;
}
