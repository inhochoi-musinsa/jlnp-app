import { lintRecord } from "../../../shared/lint";
import { buildRecord, validateContentRecord, validatePayload, type ContentRecord, type Kind, type Pool } from "../../../shared/schema";
import { scoringSectionFor, type Level } from "../../../shared/examSpec";
import { makeContentId } from "../../../shared/normalize";
import { callJson, type CallOptions } from "./llm/call";
import type { LlmProvider, LlmResponse } from "./llm/types";
import { loadPrompt, promptVersion, render } from "./prompts";
import { audioKeyFor, type Segment } from "../../../shared/audio";

export interface GenRole { provider: LlmProvider; model: string }
export interface GenParams {
  kind: Kind;
  level: Level;
  count: number;
  pool: Pool;
  topic?: string;
  domain?: string;          // QUESTION
  domainGuide?: string;     // QUESTION
  passageType?: "SHORT" | "MEDIUM" | "LONG" | "INFO";
  questionsPerPassage?: number;
  questionsPerPoint?: number;
  extra?: string;           // extra instruction line (e.g. diagnostic group)
  listeningType?: "TASK" | "POINT" | "OVERVIEW" | "UTTERANCE" | "RESPONSE" | "DICTATION";
  tts?: { engine: string; voice: string; speed: number };
  runId: string;
}
export interface GenOutput { records: ContentRecord[]; calls: number }

const asArray = (v: unknown): any[] => { if (!Array.isArray(v)) throw new Error("expected a JSON array"); return v; };
const str = (v: unknown, name: string) => { if (typeof v !== "string" || !v.trim()) throw new Error(`${name} must be a non-empty string`); return v.trim(); };

export function cleanQuestion(q: any, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const choices = asArray(q.choices).map((c: any) => {
    const o: Record<string, unknown> = { id: str(c.id, "choice.id"), text: str(c.text, "choice.text") };
    if (typeof c.whyWrong === "string" && c.whyWrong.trim()) o.whyWrong = c.whyWrong.trim();
    if (typeof c.howToCorrect === "string" && c.howToCorrect.trim()) o.howToCorrect = c.howToCorrect.trim();
    return o;
  });
  return { stem: str(q.stem, "stem"), choices, correctChoiceId: str(q.correctChoiceId, "correctChoiceId"), explanationKo: str(q.explanationKo, "explanationKo"), ...extra };
}

const tagList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 60) : []);

function provenance(role: GenRole, res: LlmResponse, p: GenParams, promptNames: string[]) {
  return {
    origin: "AI_GENERATED" as const, generatorModel: res.resolvedModel ?? role.model, llmProvider: role.provider.kind, resolved: res.resolved,
    runId: p.runId, promptVersion: promptVersion(promptNames), createdAt: new Date().toISOString(),
  };
}
const unverified = { status: "UNVERIFIED" as const, selfAttested: false, checks: [] };

const BATCH = 8;

/** One malformed item from the model must not abort the whole batch: it is dropped (and the top-up asks for more). */
function each<T, R>(arr: T[], fn: (x: T) => R): R[] {
  const out: R[] = [];
  for (const x of arr) { try { out.push(fn(x)); } catch { /* malformed item: skipped */ } }
  return out;
}

export async function generate(role: GenRole, p: GenParams, opts: CallOptions = {}): Promise<GenOutput> {
  const out: ContentRecord[] = [];
  let calls = 0;
  let remaining = p.count;
  while (remaining > 0) {
    const n = Math.min(BATCH, remaining);
    remaining -= n;
    const recs = await generateBatch(role, { ...p, count: n }, opts);
    calls++;
    for (const r of recs) {
      const fixed = await repairDraft(role, r, opts);
      calls += fixed.calls;
      out.push(fixed.record);
    }
  }
  return { records: out, calls };
}

/**
 * Generation-stage self repair: a draft that already violates V1 (structure/lint) is sent back to the
 * generator up to 2 times BEFORE any verifier call is spent. V1 itself still rejects whatever remains.
 */
export async function repairDraft(role: GenRole, rec: ContentRecord, opts: CallOptions): Promise<{ record: ContentRecord; calls: number }> {
  let cur = rec;
  let calls = 0;
  for (let i = 0; i < 2; i++) {
    const issues = [...validateContentRecord(cur), ...lintRecord(cur)];
    if (!issues.length || cur.kind !== "QUESTION") break;
    const prompt = render(loadPrompt("revise"), { level: cur.level, issues: issues.map((x) => `- ${x.code}: ${x.message} (${x.path})`).join("\n"), item: JSON.stringify({ kind: cur.kind, tags: cur.tags, payload: cur.payload }, null, 1) });
    let value: Record<string, any>;
    try {
      ({ value } = await callJson(role.provider, { prompt, model: role.model }, (v) => { if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("expected object"); return v as Record<string, any>; }, opts));
    } catch { break; }
    calls++;
    const incoming = (value.payload ?? value) as Record<string, any>;
    const keep: Record<string, unknown> = { domain: cur.payload.domain, scoringSection: cur.payload.scoringSection };
    if (cur.payload.stimulusId) keep.stimulusId = cur.payload.stimulusId;
    if (cur.payload.linkedContentId) keep.linkedContentId = cur.payload.linkedContentId;
    try {
      const rebuilt = buildRecord({ kind: cur.kind, level: cur.level, pool: cur.pool, tags: cur.tags, payload: cleanQuestion(incoming, keep), provenance: cur.provenance, verification: cur.verification });
      cur = { ...rebuilt, contentId: cur.contentId };
    } catch { break; }
  }
  return { record: cur, calls };
}

async function generateBatch(role: GenRole, p: GenParams, opts: CallOptions): Promise<ContentRecord[]> {
  const common = { level: p.level, count: p.count, topic: p.topic ?? "(free choice; vary topics)", extra: p.extra ?? "" };
  switch (p.kind) {
    case "VOCAB": {
      const prompt = render(loadPrompt("gen_vocab"), common);
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      return each(value, (v) => {
        const payload = { surface: str(v.surface, "surface"), reading: str(v.reading, "reading"), pos: str(v.pos, "pos"), meaningKo: str(v.meaningKo, "meaningKo"), example: { ja: str(v.example?.ja, "example.ja"), ko: str(v.example?.ko, "example.ko") }, levelEstimate: str(v.levelEstimate, "levelEstimate"), miscTags: tagList(v.miscTags) };
        return buildRecord({ kind: "VOCAB", level: p.level, pool: p.pool, tags: tagList(v.miscTags), payload, provenance: provenance(role, response, p, ["gen_vocab", "_common"]), verification: unverified });
      });
    }
    case "LISTENING": {
      const tts = p.tts ?? { engine: "google", voice: "ja-JP:auto", speed: 1 };
      const type = p.listeningType ?? "POINT";
      const mkAudio = (segments: Segment[]) => ({ key: audioKeyFor(segments, tts.engine, tts.voice, tts.speed), source: "GENERATED_FILE" as const, engine: tts.engine, voice: tts.voice, speed: tts.speed });
      const segOf = (arr: unknown): Segment[] => asArray(arr).map((x: any) => {
        if (!["M", "F", "N"].includes(x.speaker)) throw new Error("speaker must be M, F or N");
        const seg: Segment = { speaker: x.speaker, text: str(x.text, "text") };
        if (typeof x.reading === "string" && x.reading.trim()) seg.reading = x.reading.trim();
        if (Number.isFinite(x.pauseMs) && x.pauseMs > 0) seg.pauseMs = Math.min(3000, Math.round(x.pauseMs));
        return seg;
      });
      if (type === "DICTATION") {
        const prompt = render(loadPrompt("gen_dictation"), common);
        const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
        return each(value, (d) => {
          const segments: Segment[] = [{ speaker: "F", text: str(d.text, "text"), reading: str(d.reading, "reading") }];
          return buildRecord({ kind: "LISTENING", level: p.level, pool: p.pool, tags: [...tagList(d.tags), "dictation"], payload: { taskType: "UTTERANCE", dictation: true, segments, audio: mkAudio(segments) }, provenance: provenance(role, response, p, ["gen_dictation", "_common"]), verification: unverified });
        });
      }
      const guides: Record<string, string> = {
        TASK: "Task comprehension: a short conversation; the question asks what the person should do (next).",
        POINT: "Point comprehension: a conversation or short talk; the question asks about one specific reason, fact or opinion.",
        OVERVIEW: "Overview comprehension: a short monologue or talk; the question asks for the main idea.",
        UTTERANCE: "Expressions: the narrator describes a situation and the learner picks the most natural thing to say. The script is the narrator line only.",
        RESPONSE: "Quick response: one short utterance; the learner picks the most appropriate reply.",
      };
      const prompt = render(loadPrompt("gen_listening"), { ...common, taskType: type, typeGuide: guides[type]! });
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      const recs: ContentRecord[] = [];
      for (const g of value) { try {
        const segments = segOf(g.segments);
        const prov = provenance(role, response, p, ["gen_listening", "_common"]);
        const lid = makeContentId("LISTENING", { segments });
        const q = buildRecord({ kind: "QUESTION", level: p.level, pool: p.pool, tags: tagList(g.question?.tags ?? g.tags), payload: cleanQuestion(g.question, { domain: "LISTENING_Q", scoringSection: scoringSectionFor(p.level, "LISTENING_Q"), stimulusId: lid }), provenance: prov, verification: unverified });
        const l = buildRecord({ kind: "LISTENING", level: p.level, pool: p.pool, tags: tagList(g.tags), payload: { taskType: type, segments, audio: mkAudio(segments), questionId: q.contentId }, provenance: prov, verification: unverified });
        recs.push(l, q);
      } catch { /* skip this item */ } }
      return recs;
    }
    case "KANA": {
      const prompt = render(loadPrompt("gen_kana"), common);
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      return each(value, (k) => {
        const chars = asArray(k.chars).map((c) => str(c, "char"));
        if (chars.length !== 2) throw new Error("chars must have exactly 2 entries");
        const readings = Object.fromEntries(chars.map((c) => [c, str(k.readings?.[c], `readings.${c}`)]));
        const payload = { chars, readings, confusionNoteKo: str(k.confusionNoteKo, "confusionNoteKo") };
        return buildRecord({ kind: "KANA", level: p.level, pool: p.pool, tags: tagList(k.tags), payload, provenance: provenance(role, response, p, ["gen_kana", "_common"]), verification: unverified });
      });
    }
    case "QUESTION": {
      const domain = p.domain ?? "CONTEXT";
      const prompt = render(loadPrompt("gen_question"), { ...common, domain, domainGuide: p.domainGuide ?? "(none)" });
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      return each(value, (q) => buildRecord({
        kind: "QUESTION", level: p.level, pool: p.pool, tags: tagList(q.tags),
        payload: cleanQuestion(q, { domain, scoringSection: scoringSectionFor(p.level, domain) }),
        provenance: provenance(role, response, p, ["gen_question", "_common"]), verification: unverified,
      }));
    }
    case "GRAMMAR": {
      const prompt = render(loadPrompt("gen_grammar"), { ...common, questionsPerPoint: p.questionsPerPoint ?? 1 });
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      const recs: ContentRecord[] = [];
      for (const g of value) { try {
        const pt = g.point ?? g;
        const payload = { pattern: str(pt.pattern, "pattern"), attachment: str(pt.attachment, "attachment"), meaningKo: str(pt.meaningKo, "meaningKo"), nuanceKo: str(pt.nuanceKo, "nuanceKo"), contrastPatterns: tagList(pt.contrastPatterns), examples: asArray(pt.examples).map((e: any) => ({ ja: str(e.ja, "ja"), ko: str(e.ko, "ko") })) };
        const prov = provenance(role, response, p, ["gen_grammar", "_common"]);
        const point = buildRecord({ kind: "GRAMMAR", level: p.level, pool: p.pool, tags: tagList(g.tags), payload, provenance: prov, verification: unverified });
        recs.push(point);
        for (const q of asArray(g.questions ?? [])) {
          const domain = q.domain === "TEXT_GRAMMAR" ? "TEXT_GRAMMAR" : "GRAMMAR_FORM";
          try { recs.push(buildRecord({ kind: "QUESTION", level: p.level, pool: p.pool, tags: tagList(q.tags), payload: cleanQuestion(q, { domain, scoringSection: scoringSectionFor(p.level, domain), linkedContentId: point.contentId }), provenance: prov, verification: unverified })); } catch { /* skip this question */ }
        }
      } catch { /* skip this grammar point */ } }
      return recs;
    }
    case "PASSAGE": {
      const type = p.passageType ?? "SHORT";
      const guides: Record<string, string> = {
        SHORT: "A short text of about 80-200 Japanese characters (note, e-mail, announcement or short essay).",
        MEDIUM: "A medium text of about 250-450 characters (explanatory or essay-like).",
        LONG: "A long text of about 500-800 characters with argument or narrative.",
        INFO: "An information-retrieval text: a notice, schedule, price list or advertisement with several conditions, followed by questions that require locating details.",
      };
      const prompt = render(loadPrompt("gen_passage"), { ...common, passageType: type, typeGuide: guides[type]!, questionsPerPassage: p.questionsPerPassage ?? 3 });
      const { value, response } = await callJson(role.provider, { prompt, model: role.model }, asArray, opts);
      const recs: ContentRecord[] = [];
      for (const g of value) { try {
        const pages = asArray(g.pages).map((x) => str(x, "page"));
        const prov = provenance(role, response, p, ["gen_passage", "_common"]);
        // Passage id depends only on its text, so question ids can reference it before it exists.
        const passageId = makeContentId("PASSAGE", { pages });
        const questions = asArray(g.questions).map((q) => buildRecord({
          kind: "QUESTION", level: p.level, pool: p.pool, tags: tagList(q.tags),
          payload: cleanQuestion(q, { domain: "READING_Q", scoringSection: scoringSectionFor(p.level, "READING_Q"), stimulusId: passageId }), provenance: prov, verification: unverified,
        }));
        const passage = buildRecord({ kind: "PASSAGE", level: p.level, pool: p.pool, tags: tagList(g.tags), payload: { type, pages, questionIds: questions.map((q) => q.contentId) }, provenance: prov, verification: unverified });
        recs.push(passage, ...questions);
      } catch { /* skip this passage */ } }
      return recs;
    }
    default:
      throw new Error(`generation for kind ${p.kind} is not implemented in this version`);
  }
}

/** Structural pre-check used right after generation so unusable drafts never reach the verifier. */
export function draftShapeErrors(r: ContentRecord): string[] {
  return validatePayload(r.kind, r.payload).map((i) => `${i.path}: ${i.message}`);
}
