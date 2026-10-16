import { isLevel, type Level } from "./examSpec";
import { canonicalJSON, makeContentId } from "./normalize";
import { sha256Hex } from "./hash";

export const KINDS = ["KANA", "VOCAB", "KANJI", "GRAMMAR", "QUESTION", "PASSAGE", "LISTENING"] as const;
export type Kind = (typeof KINDS)[number];
export const POOLS = ["LEARN", "DIAG", "ASSESS"] as const;
export type Pool = (typeof POOLS)[number];
export const DOMAINS = ["KANA", "READING_KANJI", "ORTHOGRAPHY", "CONTEXT", "PARAPHRASE", "USAGE", "GRAMMAR_FORM", "SENTENCE_ORDER", "TEXT_GRAMMAR", "READING_Q", "LISTENING_Q"] as const;
export type Domain = (typeof DOMAINS)[number];
export const LISTENING_TASKS = ["TASK", "POINT", "OVERVIEW", "UTTERANCE", "RESPONSE"] as const;
export const PASSAGE_TYPES = ["SHORT", "MEDIUM", "LONG", "INFO"] as const;
export const AUDIO_SOURCES = ["GENERATED_FILE", "RECORDED", "BROWSER_TTS"] as const;
export const VERIFICATION_STATUSES = ["VERIFIED", "UNVERIFIED", "FLAGGED", "RETIRED"] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const MAX_PAYLOAD_CHARS = 30000;

export interface Choice { id: string; text: string; whyWrong?: string; howToCorrect?: string }
export interface Check { id: string; result: "PASS" | "WARN" | "FAIL"; note?: string }
export interface Provenance {
  origin: "AI_GENERATED" | "USER_AUTHORED" | "IMPORTED";
  generatorModel?: string; llmProvider?: string; resolved?: boolean; runId?: string; promptVersion?: string; createdAt: string;
}
export interface Verification {
  status: VerificationStatus; selfAttested: boolean; verifierModel?: string; rounds?: number; checks: Check[]; verifiedAt?: string;
}
export interface ContentRecord {
  contentId: string; contentVersion: number; kind: Kind; level: Level; pool: Pool; tags: string[];
  payload: Record<string, any>; provenance: Provenance; verification: Verification; license: "ORIGINAL"; contentHash: string;
}

export interface Issue { code: string; path: string; message: string }

export function computeContentHash(r: Pick<ContentRecord, "kind" | "level" | "pool" | "contentVersion" | "payload">): string {
  return sha256Hex(canonicalJSON({ kind: r.kind, level: r.level, pool: r.pool, contentVersion: r.contentVersion, payload: r.payload }));
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isStrArr = (v: unknown, min = 0): v is string[] => Array.isArray(v) && v.length >= min && v.every((x) => typeof x === "string");

/** Structural validation (IMP-02). Does not judge semantics; see lint.ts for that. */
export function validateContentRecord(rec: unknown): Issue[] {
  const out: Issue[] = [];
  const add = (path: string, message: string) => out.push({ code: "SCHEMA", path, message });
  if (!isObj(rec)) return [{ code: "SCHEMA", path: "", message: "record must be an object" }];
  if (!isStr(rec.contentId)) add("contentId", "required string");
  if (!Number.isInteger(rec.contentVersion) || rec.contentVersion < 1) add("contentVersion", "integer >= 1");
  if (!(KINDS as readonly string[]).includes(rec.kind)) add("kind", "unknown kind");
  if (!isLevel(rec.level)) add("level", "unknown level");
  if (!(POOLS as readonly string[]).includes(rec.pool)) add("pool", "unknown pool");
  if (!isStrArr(rec.tags)) add("tags", "string[] required");
  if (rec.license !== "ORIGINAL") add("license", "must be ORIGINAL");
  if (!isStr(rec.contentHash)) add("contentHash", "required string");
  const pv = rec.provenance;
  if (!isObj(pv)) add("provenance", "object required");
  else {
    if (!["AI_GENERATED", "USER_AUTHORED", "IMPORTED"].includes(pv.origin)) add("provenance.origin", "invalid");
    if (!isStr(pv.createdAt)) add("provenance.createdAt", "required");
  }
  const vf = rec.verification;
  if (!isObj(vf)) add("verification", "object required");
  else {
    if (!(VERIFICATION_STATUSES as readonly string[]).includes(vf.status)) add("verification.status", "invalid");
    if (typeof vf.selfAttested !== "boolean") add("verification.selfAttested", "boolean required");
    if (!Array.isArray(vf.checks) || !vf.checks.every((c: any) => isObj(c) && isStr(c.id) && ["PASS", "WARN", "FAIL"].includes(c.result)))
      add("verification.checks", "array of {id,result} required");
  }
  if (!isObj(rec.payload)) { add("payload", "object required"); return out; }
  if ((KINDS as readonly string[]).includes(rec.kind)) out.push(...validatePayload(rec.kind as Kind, rec.payload));
  return out;
}

export function validatePayload(kind: Kind, p: Record<string, any>): Issue[] {
  const out: Issue[] = [];
  const need = (cond: boolean, path: string, msg: string) => { if (!cond) out.push({ code: "SCHEMA", path: "payload." + path, message: msg }); };
  switch (kind) {
    case "KANA":
      need(isStrArr(p.chars, 2) && p.chars.length === 2, "chars", "exactly 2 chars");
      need(isObj(p.readings) || Array.isArray(p.readings), "readings", "required");
      need(isStr(p.confusionNoteKo), "confusionNoteKo", "required");
      break;
    case "VOCAB":
      need(isStr(p.surface), "surface", "required");
      need(isStr(p.reading), "reading", "required");
      need(isStr(p.pos), "pos", "required");
      need(isStr(p.meaningKo), "meaningKo", "required");
      need(isObj(p.example) && isStr(p.example.ja) && isStr(p.example.ko), "example", "{ja,ko} required");
      need(isStr(p.levelEstimate), "levelEstimate", "required");
      need(isStrArr(p.miscTags), "miscTags", "string[] required");
      break;
    case "KANJI":
      need(isStr(p.kanji) && [...p.kanji].length === 1, "kanji", "single character");
      need(isStrArr(p.onyomi) && isStrArr(p.kunyomi), "onyomi/kunyomi", "string[] required");
      need(isStr(p.meaningKo), "meaningKo", "required");
      need(isStrArr(p.relatedVocabIds), "relatedVocabIds", "string[] required");
      break;
    case "GRAMMAR":
      need(isStr(p.pattern), "pattern", "required");
      need(isStr(p.attachment), "attachment", "required");
      need(isStr(p.meaningKo) && isStr(p.nuanceKo), "meaningKo/nuanceKo", "required");
      need(isStrArr(p.contrastPatterns), "contrastPatterns", "string[] required");
      need(Array.isArray(p.examples) && p.examples.length >= 2 && p.examples.every((e: any) => isObj(e) && isStr(e.ja) && isStr(e.ko)), "examples", ">= 2 {ja,ko}");
      break;
    case "QUESTION": {
      need((DOMAINS as readonly string[]).includes(p.domain), "domain", "unknown domain");
      need(isStr(p.stem), "stem", "required");
      const ch = p.choices;
      need(Array.isArray(ch) && ch.length === 4 && ch.every((c: any) => isObj(c) && isStr(c.id) && isStr(c.text)), "choices", "exactly 4 {id,text}");
      need(Array.isArray(ch) && ch.filter((c: any) => c?.id === p.correctChoiceId).length === 1, "correctChoiceId", "must match exactly one choice id");
      need(Array.isArray(ch) && new Set(ch.map((c: any) => c?.id)).size === ch.length, "choices.id", "ids must be unique");
      need(isStr(p.explanationKo), "explanationKo", "required");
      need(isStr(p.scoringSection), "scoringSection", "required");
      break;
    }
    case "PASSAGE":
      need((PASSAGE_TYPES as readonly string[]).includes(p.type), "type", "unknown type");
      need(isStrArr(p.pages, 1), "pages", "string[] (>=1)");
      need(isStrArr(p.questionIds), "questionIds", "string[] required");
      break;
    case "LISTENING":
      need((LISTENING_TASKS as readonly string[]).includes(p.taskType), "taskType", "unknown taskType");
      need(Array.isArray(p.segments) && p.segments.length >= 1 && p.segments.every((s: any) => isObj(s) && ["M", "F", "N"].includes(s.speaker) && isStr(s.text)), "segments", "segments required");
      need(p.audio === undefined || (isObj(p.audio) && (AUDIO_SOURCES as readonly string[]).includes(p.audio.source)), "audio", "invalid audio");
      need(isStr(p.questionId), "questionId", "required");
      break;
  }
  return out;
}

/** Build a record with deterministic id + hash. Callers fill provenance/verification. */
export function buildRecord(input: {
  kind: Kind; level: Level; pool: Pool; tags: string[]; payload: Record<string, any>; contentVersion?: number;
  provenance: Provenance; verification: Verification;
}): ContentRecord {
  const contentVersion = input.contentVersion ?? 1;
  const base = { kind: input.kind, level: input.level, pool: input.pool, contentVersion, payload: input.payload };
  return {
    contentId: makeContentId(input.kind, input.payload), contentVersion, kind: input.kind, level: input.level, pool: input.pool,
    tags: input.tags, payload: input.payload, provenance: input.provenance, verification: input.verification, license: "ORIGINAL",
    contentHash: computeContentHash(base),
  };
}
