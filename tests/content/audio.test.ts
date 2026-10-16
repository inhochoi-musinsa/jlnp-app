import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { audioKeyFor, overridePath, scriptHash, type Segment } from "../../shared/audio";
import { GoogleTts, TtsError, concatBytes, mp3DurationMs, silentMp3, ssmlFor, type TtsFetch, type TtsProvider } from "../../tools/content/src/tts";
import { collectJobs, synthesizeAll, updatePackAudioManifest } from "../../tools/content/src/audio";
import { buildRecord, validateContentRecord, type ContentRecord } from "../../shared/schema";
import { lintRecord } from "../../shared/lint";
import { buildPack, checkPackIntegrity } from "../../shared/pack";
import { genCommand, verifyCommand, packCommand, closeReferences, type RunEnv } from "../../tools/content/src/run";
import { BudgetTracker } from "../../tools/content/src/budget";
import { FakeProvider, isBlind, isDistractor, isGen, isQuality } from "./fakes";
import { planImport } from "../../app/src/content/import";
import { readJson } from "../../tools/content/src/util";

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });
const SEG: Segment[] = [{ speaker: "F", text: "すみません、駅はどこですか。", pauseMs: 400 }, { speaker: "M", text: "まっすぐ行って、右です。" }];
const listening = (segments = SEG, engine = "google", voice = "ja-JP:auto", extra: Record<string, unknown> = {}): ContentRecord =>
  buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "TASK", segments, audio: { key: audioKeyFor(segments, engine, voice, 1), source: "GENERATED_FILE", engine, voice, speed: 1 }, questionId: "q:abcdefghij", ...extra }, provenance: prov, verification: ver("LISTENING") });

describe("audio key and mp3 helpers", () => {
  it("key = 16 hex chars, stable, and sensitive to script, engine, voice and speed", () => {
    const k = audioKeyFor(SEG, "google", "ja-JP:auto", 1);
    expect(k).toMatch(/^[0-9a-f]{16}$/);
    expect(audioKeyFor(SEG, "google", "ja-JP:auto", 1)).toBe(k);
    expect(audioKeyFor(SEG, "macos-say", "ja-JP:auto", 1)).not.toBe(k);
    expect(audioKeyFor(SEG, "google", "other", 1)).not.toBe(k);
    expect(audioKeyFor(SEG, "google", "ja-JP:auto", 1.1)).not.toBe(k);
    expect(audioKeyFor([{ ...SEG[0]!, text: "すみません、駅はどこですか？" }, SEG[1]!], "google", "ja-JP:auto", 1)).not.toBe(k);
    expect(scriptHash(SEG)).toMatch(/^[0-9a-f]{64}$/);
    expect(overridePath("q:abc/../x")).toBe("audio/overrides/q_abc____x.mp3");
  });
  it("mp3 duration from frame headers", () => {
    const ms = mp3DurationMs(silentMp3(100));
    expect(ms).toBeGreaterThan(2500); expect(ms).toBeLessThan(2700); // 100 * 1152 / 44100 = 2.612 s
    expect(mp3DurationMs(concatBytes([silentMp3(50), silentMp3(50)]))).toBe(ms);
    expect(mp3DurationMs(new Uint8Array([1, 2, 3]))).toBe(0);
  });
});

describe("GoogleTts (fake HTTP; real synthesis is BLOCKED(TTS))", () => {
  const voices = { voices: [
    { name: "ja-JP-Standard-A", ssmlGender: "FEMALE", languageCodes: ["ja-JP"] }, { name: "ja-JP-Wavenet-C", ssmlGender: "MALE", languageCodes: ["ja-JP"] },
    { name: "ja-JP-Neural2-B", ssmlGender: "FEMALE", languageCodes: ["ja-JP"] }, { name: "ja-JP-Neural2-C", ssmlGender: "MALE", languageCodes: ["ja-JP"] }, { name: "ja-JP-Neural2-D", ssmlGender: "MALE", languageCodes: ["ja-JP"] },
  ] };
  function fakeHttp(onSynth?: (body: any) => void): { fetch: TtsFetch; urls: string[] } {
    const urls: string[] = [];
    return { urls, fetch: async (url, init) => {
      urls.push(url);
      if (url.includes("/voices")) return { status: 200, text: async () => JSON.stringify(voices) };
      const body = JSON.parse(init.body!); onSynth?.(body);
      return { status: 200, text: async () => JSON.stringify({ audioContent: Buffer.from(silentMp3(10)).toString("base64") }) };
    } };
  }
  it("picks the best male/female voices from the account's list, one request per segment, speaker -> voice", async () => {
    const bodies: any[] = []; const h = fakeHttp((b) => bodies.push(b));
    const tts = new GoogleTts({ apiKey: "SECRET-KEY-123", fetch: h.fetch });
    const r = await tts.synthesize({ segments: SEG, speed: 1.1 });
    expect(bodies.length).toBe(2);
    expect(bodies[0].voice).toEqual({ languageCode: "ja-JP", name: "ja-JP-Neural2-B" }); // F
    expect(bodies[1].voice.name).toBe("ja-JP-Neural2-C");                                  // M
    expect(bodies[0].audioConfig).toEqual({ audioEncoding: "MP3", speakingRate: 1.1 });
    expect(bodies[0].input.ssml).toBe('<speak>すみません、駅はどこですか。<break time="400ms"/></speak>');
    expect(r.engine).toBe("google"); expect(r.voice).toContain("Neural2-C");
    expect(r.durationMs).toBeGreaterThan(200);
    expect(h.urls.every((u) => u.includes("key=SECRET-KEY-123"))).toBe(true);
  });
  it("SSML: escapes markup, uses <sub alias> for readings, caps long pauses", () => {
    expect(ssmlFor({ speaker: "F", text: `A & B <c> "d"` })).toBe("<speak>A &amp; B &lt;c&gt; &quot;d&quot;</speak>");
    expect(ssmlFor({ speaker: "M", text: "今日", reading: "きょう" })).toBe('<speak><sub alias="きょう">今日</sub></speak>');
    expect(ssmlFor({ speaker: "N", text: "x", pauseMs: 99999 })).toContain('time="10000ms"');
  });
  it("errors are mapped and never contain the key", async () => {
    const mk = (status: number, message: string) => new GoogleTts({ apiKey: "SECRET-KEY-123", fetch: async () => ({ status, text: async () => JSON.stringify({ error: { message } }) }) });
    await expect(mk(400, "API key not valid. SECRET-KEY-123").check()).resolves.toMatchObject({ ok: false });
    const a = await mk(400, "API key not valid. SECRET-KEY-123").check();
    expect(a.detail).not.toContain("SECRET-KEY-123");
    await expect(mk(403, "Cloud Text-to-Speech API has not been used").synthesize({ segments: SEG })).rejects.toMatchObject({ kind: "AUTH" });
    await expect(mk(429, "quota").synthesize({ segments: SEG })).rejects.toMatchObject({ kind: "QUOTA" }); // the voices lookup hits the quota first
    await expect(new GoogleTts({ apiKey: "" }).check()).resolves.toMatchObject({ ok: false });
    const quota = new GoogleTts({ apiKey: "k", voices: { M: "m", F: "f" }, fetch: async () => ({ status: 429, text: async () => "{}" }) });
    await expect(quota.synthesize({ segments: SEG })).rejects.toMatchObject({ kind: "QUOTA" });
  });
  it("check() uses the free voices list, not a billable synthesis", async () => {
    const h = fakeHttp();
    const r = await new GoogleTts({ apiKey: "k", fetch: h.fetch }).check();
    expect(r.ok).toBe(true);
    expect(h.urls.every((u) => u.includes("/voices"))).toBe(true);
  });
});

class FakeTts implements TtsProvider {
  engine: string; voiceLabel = "ja-JP:auto"; calls = 0; failWith?: TtsError;
  constructor(engine = "google") { this.engine = engine; }
  async synthesize(req: { segments: Segment[]; speed?: number }) { if (this.failWith) throw this.failWith; this.calls++; const mp3 = silentMp3(20 + req.segments.length); return { mp3, durationMs: mp3DurationMs(mp3), engine: this.engine, voice: this.voiceLabel, speed: req.speed ?? 1 }; }
  async check() { return { ok: true, detail: "fake" }; }
}

describe("content:audio", () => {
  const items = [listening(), listening([{ speaker: "N", text: "別のスクリプトです。" }]), listening([{ speaker: "M", text: "もう一つです。" }], "macos-say", "say:Kyoko")];
  it("synthesises each missing key once, skips existing files and other engines, reports counts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    const tts = new FakeTts();
    const r1 = await synthesizeAll(items, tts, { dir });
    expect(r1).toMatchObject({ planned: 2, synthesized: 2, skippedExisting: 0, wrongEngine: 1 });
    for (const j of collectJobs(items).jobs.filter((x) => x.engine === "google")) expect(existsSync(join(dir, `${j.key}.mp3`))).toBe(true);
    expect(r1.manifest.every((m) => m.durationMs! > 0 && /^[0-9a-f]{64}$/.test(m.scriptHash))).toBe(true);
    const r2 = await synthesizeAll(items, tts, { dir });
    expect(r2).toMatchObject({ planned: 0, synthesized: 0, skippedExisting: 2 });
    expect(tts.calls).toBe(2);
  });
  it("dry-run writes nothing; a changed script is a key mismatch, a record without audio is reported", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    const edited = { ...items[0]!, payload: { ...items[0]!.payload, segments: [{ speaker: "F", text: "書き換えた" }] } } as ContentRecord;
    const noAudio = buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "TASK", segments: SEG, questionId: "q:x" }, provenance: prov, verification: ver("LISTENING") });
    const r = await synthesizeAll([items[1]!, edited, noAudio], new FakeTts(), { dir, dryRun: true });
    expect(r).toMatchObject({ planned: 1, synthesized: 0, keyMismatch: 1, noAudioField: 1 });
    expect(r.chars).toBe("別のスクリプトです。".length);
    expect(readdirSync(dir)).toEqual([]);
  });
  it("an auth/quota failure stops the run and keeps what was done", async () => {
    const dir = mkdtempSync(join(tmpdir(), "audio-"));
    const tts = new FakeTts(); tts.failWith = new TtsError("AUTH", "bad key");
    const r = await synthesizeAll(items.slice(0, 2), tts, { dir });
    expect(r.synthesized).toBe(0);
    expect(r.failed.length).toBe(1); // stopped after the first failure
  });
  it("the pack's audioManifest is updated without invalidating the pack", () => {
    const pack = buildPack(items.slice(0, 2), { generator: { tool: "t", toolVersion: "1", models: {} } });
    const p = join(mkdtempSync(join(tmpdir(), "audio-")), "x.jlptpack.json");
    writeFileSync(p, JSON.stringify(pack));
    updatePackAudioManifest(p, [{ audioKey: "0123456789abcdef", scriptHash: "h", engine: "google", voice: "v", speed: 1, durationMs: 1000 }]);
    const out = readJson<any>(p);
    expect(out.audioManifest.length).toBe(1);
    expect(checkPackIntegrity(out)).toEqual({ fileErrors: [], badHashItems: [] });
  });
});

describe("LISTENING content rules", () => {
  it("valid records pass schema and lint; bad audio keys, long scripts, bad dictation are caught", () => {
    expect(validateContentRecord(listening())).toEqual([]);
    expect(lintRecord(listening())).toEqual([]);
    expect(validateContentRecord(listening(SEG, "google", "v", { audio: { key: "nothex", source: "GENERATED_FILE", engine: "google", voice: "v", speed: 1 } })).length).toBeGreaterThan(0);
    const long = Array.from({ length: 15 }, () => ({ speaker: "F" as const, text: "あ" }));
    expect(lintRecord(listening(long)).map((i) => i.code)).toContain("LISTENING_LONG");
    expect(lintRecord(listening([{ speaker: "F", text: "あ".repeat(161) }])).map((i) => i.code)).toContain("LISTENING_LONG");
    expect(lintRecord(listening([{ speaker: "F", text: "今日", reading: "kyou" }])).map((i) => i.code)).toContain("READING_CHARS");
    const dict = (segments: Segment[]) => buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "UTTERANCE", dictation: true, segments }, provenance: prov, verification: ver("LISTENING") });
    expect(validateContentRecord(dict([{ speaker: "F", text: "今日は", reading: "きょうは" }]))).toEqual([]);
    expect(lintRecord(dict([{ speaker: "F", text: "今日は", reading: "きょうは" }]))).toEqual([]);
    expect(lintRecord(dict([{ speaker: "F", text: "今日は" }])).map((i) => i.code)).toContain("DICTATION_SHAPE");
    expect(validateContentRecord(buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "TASK", segments: SEG }, provenance: prov, verification: ver("LISTENING") })).length).toBeGreaterThan(0); // no questionId
  });
  it("import holds a listening item whose question is missing; a pack with both is accepted", () => {
    const q = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { domain: "LISTENING_Q", stem: "男の人は何と言いましたか。", choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: "右です" } : { id, text: `誤り${id}`, whyWrong: `w${id}`, howToCorrect: `h${id}` }), correctChoiceId: "a", explanationKo: "x", scoringSection: "LISTENING" }, provenance: prov, verification: ver("QUESTION") });
    const l = listening(SEG, "google", "ja-JP:auto", { questionId: q.contentId });
    const none = { rows: [], blockedIds: new Set<string>(), exposed: new Set<string>() };
    const orphan = planImport(JSON.stringify(buildPack([listening()], { generator: { tool: "t", toolVersion: "1", models: {} } })), none);
    expect(orphan.summary.held).toBe(1);
    const both = planImport(JSON.stringify(buildPack([l, { ...q, payload: { ...q.payload, stimulusId: l.contentId } } as ContentRecord], { generator: { tool: "t", toolVersion: "1", models: {} } })), none);
    // the question changed after building (stimulusId added) so its hash no longer matches -> rejected; build it properly:
    expect(both.summary.rejected + both.summary.added).toBeGreaterThan(0);
    const q2 = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { ...q.payload, stimulusId: l.contentId }, provenance: prov, verification: ver("QUESTION") });
    const l2 = listening(SEG, "google", "ja-JP:auto", { questionId: q2.contentId });
    const ok = planImport(JSON.stringify(buildPack([l2, q2], { generator: { tool: "t", toolVersion: "1", models: {} } })), none);
    expect(ok.summary).toMatchObject({ added: 2, held: 0, rejected: 0 });
    expect(closeReferences([l2]).kept.length).toBe(0); // CLI side: the item is dropped when its question is not in the pack
    expect(closeReferences([l2, q2]).kept.length).toBe(2);
  });
});

describe("gen LISTENING (fake LLM) -> verify -> pack", () => {
  it("creates linked listening + question records, the blind solver gets the script, a dictation item has no question", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lis-"));
    const stems = ["男の人はこのあとまず何をしますか。（甲）", "女の人が一番言いたいことは何ですか。（乙）"];
    const scripts: Record<string, Segment[]> = { [stems[0]!]: [{ speaker: "F", text: "切符はもう買いましたか。" }, { speaker: "M", text: "いいえ、これから買います。" }], [stems[1]!]: [{ speaker: "F", text: "電車で行くより、バスのほうが安いです。" }] };
    const correct = (s: string) => `正解${s.length}`;
    const gen = new FakeProvider("headless", (req) => {
      if (req.prompt.includes("DICTATION practice")) return JSON.stringify([{ text: "今日は雨です。", reading: "きょうはあめです。", tags: ["VOWEL_LENGTH"] }]);
      if (isGen(req.prompt) || req.prompt.includes("listening-comprehension items")) return JSON.stringify(stems.map((s) => ({ segments: scripts[s], question: { stem: s, choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: correct(s) } : { id, text: `誤り${id}${s.length}`, whyWrong: `${id}は聞こえた内容と違う(${s.length})`, howToCorrect: `${id}の直し方(${s.length})` }), correctChoiceId: "a", explanationKo: "스크립트에 근거가 있습니다." }, tags: ["GRAMMAR_NUANCE"] })));
      throw new Error("unexpected gen prompt");
    }, () => "claude-sonnet-5-5");
    const seenPrompts: string[] = [];
    const ver2 = new FakeProvider("headless", (req) => {
      if (isBlind(req.prompt)) { seenPrompts.push(req.prompt); const s = stems.find((x) => req.prompt.includes(x))!; const m = new RegExp(`^([A-D])\\. ${correct(s)}$`, "m").exec(req.prompt); return JSON.stringify({ answer: m?.[1] ?? "NONE", reason: "ok" }); }
      if (isDistractor(req.prompt)) return JSON.stringify({ wrong: [], multipleCorrectPossible: false, issues: [] });
      if (isQuality(req.prompt)) return JSON.stringify({ verdict: "PASS", issues: [], levelFit: true, contextCues: 2 });
      throw new Error("unexpected verifier prompt");
    }, () => "claude-opus-5-5");
    const env: RunEnv = { generator: { provider: gen, model: "sonnet", concurrency: 2 }, verifier: { provider: ver2, model: "opus", concurrency: 2 }, budget: new BudgetTracker({ maxCalls: 500 }), contentDir: join(dir, "content"), ledgerPath: join(dir, "ledger.json"), useAnalyzer: false, log: () => {}, sleep: async () => {} };
    const g = await genCommand(env, { kind: "LISTENING", level: "N3", count: 2, pool: "LEARN", listeningType: "TASK", tts: { engine: "google", voice: "ja-JP:auto", speed: 1 } });
    expect(g.written).toBe(4); // 2 listening + 2 questions
    const v = await verifyCommand(env, g.runId);
    expect(v).toMatchObject({ verified: 4, rejected: 0 });
    expect(seenPrompts.length).toBeGreaterThan(0);
    expect(seenPrompts.every((p) => p.includes("Reference text:") && p.includes("F: "))).toBe(true); // the solver is given the script
    const packed = packCommand(env, g.runId, join(dir, "p.jlptpack.json"));
    const l = packed.pack.items.filter((i) => i.kind === "LISTENING"), q = packed.pack.items.filter((i) => i.kind === "QUESTION");
    expect(l.length).toBe(2); expect(q.length).toBe(2);
    for (const rec of l) {
      const a = rec.payload.audio as any;
      expect(a.key).toBe(audioKeyFor(rec.payload.segments as Segment[], "google", "ja-JP:auto", 1));
      expect(q.find((x) => x.contentId === rec.payload.questionId)!.payload.stimulusId).toBe(rec.contentId);
    }
    expect(checkPackIntegrity(packed.pack)).toEqual({ fileErrors: [], badHashItems: [] });
    // dictation
    const d = await genCommand(env, { kind: "LISTENING", level: "N3", count: 1, pool: "LEARN", listeningType: "DICTATION", tts: { engine: "google", voice: "ja-JP:auto", speed: 1 } });
    expect(d.written).toBe(1);
    const dv = await verifyCommand(env, d.runId);
    expect(dv.verified).toBe(1);
    const rec = readJson<ContentRecord>(join(dir, "content/runs", d.runId, "verified", readdirOf(join(dir, "content/runs", d.runId, "verified"))[0]!));
    expect(rec.payload.dictation).toBe(true);
    expect(rec.tags).toContain("dictation");
    expect(readFileSync(join(dir, "p.jlptpack.json"), "utf8")).not.toMatch(/GOOGLE_TTS|api[_-]?key/i);
  });
});
import { readdirSync } from "node:fs";
const readdirOf = (d: string) => readdirSync(d);
