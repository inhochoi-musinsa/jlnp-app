import { describe, expect, it } from "vitest";
import { computeRunway, buildProgress, buildFlagsExport, DAILY_NEW_CAP, RUNWAY_WARN_DAYS } from "../../app/src/domain/progress";
import { exportPack, packFileName } from "../../app/src/content/export";
import { planImport } from "../../app/src/content/import";
import { flagProjection } from "../../app/src/content/status";
import { createEvent } from "../../app/src/storage/events";
import { buildRecord, type ContentRecord } from "../../shared/schema";
import { writeContent, CONTENT_BATCH } from "../../app/src/google/contentSync";
import { SheetsClient } from "../../app/src/google/sheets";
import { initialize, inspect } from "../../app/src/google/init";
import { SEED_PACK } from "../../app/src/content/seed";
import { FakeSheets } from "../google/fakeSheets";
import { SHEET_TABS } from "../../shared/sheetSchema";

const prov = { origin: "AI_GENERATED" as const, generatorModel: "claude-sonnet-5-5", createdAt: "2026-10-16T00:00:00Z" };
const ver = (kind: string) => ({ status: "VERIFIED" as const, selfAttested: false, verifierModel: "claude-opus-5-5", checks: (kind === "QUESTION" ? ["SCHEMA_LINT", "BLIND_SOLVE", "DISTRACTOR_CHECK", "QUALITY_CHECK"] : ["SCHEMA_LINT", "QUALITY_CHECK"]).map((id) => ({ id, result: "PASS" as const })) });
const vocab = (n: number, pool: any = "LEARN"): ContentRecord => buildRecord({ kind: "VOCAB", level: "N3", pool, tags: [], payload: { surface: `語${n}`, reading: "ごい", pos: "noun", meaningKo: `뜻${n}`, example: { ja: `例${n}です。`, ko: "예" }, levelEstimate: "N3", miscTags: [] }, provenance: prov, verification: ver("VOCAB") });
const gram = (n: number): ContentRecord => buildRecord({ kind: "GRAMMAR", level: "N3", pool: "LEARN", tags: [], payload: { pattern: `〜文型${n}`, attachment: "동사", meaningKo: "뜻", nuanceKo: "뉘앙스", contrastPatterns: [], examples: [{ ja: "例1です。", ko: "예1" }, { ja: "例2です。", ko: "예2" }] }, provenance: prov, verification: ver("GRAMMAR") });
const question = (n: number, parent?: ContentRecord, tags: string[] = ["KO_PARTICLE_TRANSFER"]): ContentRecord => buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags,
  payload: { domain: "GRAMMAR_FORM", stem: `昨日は雨が降っていたので、約束${n}を（　　）ことにした。`, choices: ["a", "b", "c", "d"].map((id) => id === "a" ? { id, text: `正${n}` } : { id, text: `誤${id}${n}`, whyWrong: `w${id}${n}`, howToCorrect: `h${id}${n}` }), correctChoiceId: "a", explanationKo: "x", scoringSection: "LANGUAGE_KNOWLEDGE", ...(parent ? { linkedContentId: parent.contentId } : {}) }, provenance: prov, verification: ver("QUESTION") });
const ev = (type: any, payload: any, n = 1) => createEvent({ profileId: "p-secret-profile", deviceId: "d-secret-device", deviceSeq: n, type, entityId: "x", payload });

describe("runway (남은 학습 분량)", () => {
  it("unseen / daily cap, smallest area wins, 14-day warning", () => {
    const pool = [...Array.from({ length: 150 }, (_, i) => vocab(i)), ...Array.from({ length: 60 }, (_, i) => gram(i))];
    const r = computeRunway(pool, [], "TARGET_FOCUS", { areas: ["VOCAB", "GRAMMAR"] });
    expect(r.dailyCap).toBe(15);
    expect(r.perArea.VOCAB).toEqual({ unseen: 150, days: 10 });      // 15 new words per day
    expect(r.perArea.GRAMMAR).toEqual({ unseen: 60, days: 60 });     // 1 new grammar point per day
    expect(r).toMatchObject({ days: 10, limitingArea: "VOCAB", needsContent: true });
    const plenty = computeRunway([...Array.from({ length: 450 }, (_, i) => vocab(i)), ...Array.from({ length: 450 }, (_, i) => gram(i))], [], "TARGET_FOCUS", { areas: ["VOCAB", "GRAMMAR"] });
    expect(plenty.days).toBe(30);
    expect(plenty.needsContent).toBe(false);
    expect(RUNWAY_WARN_DAYS).toBe(14);
  });
  it("caps depend on the route; reviewed cards and studied grammar points are no longer unseen", () => {
    const v = Array.from({ length: 40 }, (_, i) => vocab(i));
    expect(computeRunway(v, [], "KANA_FOUNDATION", { areas: ["VOCAB"] }).perArea.VOCAB!.days).toBe(8);
    expect(computeRunway(v, [], "FOUNDATION", { areas: ["VOCAB"] }).perArea.VOCAB!.days).toBe(4);
    const events = [ev("CARD_REVIEWED", { contentId: v[0]!.contentId }), ev("CARD_REVIEWED", { contentId: v[1]!.contentId }, 2)];
    expect(computeRunway(v, events, "FOUNDATION").perArea.VOCAB!.unseen).toBe(38);
    const g = gram(1), gq = question(1, g);
    expect(computeRunway([g, gq], [], "FOUNDATION").perArea.GRAMMAR!.unseen).toBe(1);
    expect(computeRunway([g, gq], [ev("QUESTION_PRESENTED", { contentId: gq.contentId })], "FOUNDATION").perArea.GRAMMAR!.unseen).toBe(0);
  });
  it("reading counts too: one new passage per day, so 10 unseen passages are 10 days", () => {
    const passage = (n: number) => buildRecord({ kind: "PASSAGE", level: "N3", pool: "LEARN", tags: [], payload: { type: "SHORT", pages: [`短い文章${n}です。`], questionIds: [] }, provenance: prov, verification: ver("PASSAGE") });
    const pool = [...Array.from({ length: 900 }, (_, i) => vocab(i)), ...Array.from({ length: 900 }, (_, i) => gram(i)), ...Array.from({ length: 10 }, (_, i) => passage(i))];
    const r = computeRunway(pool, [], "TARGET_FOCUS", { areas: ["VOCAB", "GRAMMAR", "READING"] });
    expect(r.perArea.READING).toEqual({ unseen: 10, days: 10 });
    expect(r).toMatchObject({ days: 10, limitingArea: "READING", needsContent: true });
    const seen = ev("QUESTION_PRESENTED", { contentId: "q:x", stimulusId: pool.find((x) => x.kind === "PASSAGE")!.contentId });
    expect(computeRunway(pool, [seen], "TARGET_FOCUS").perArea.READING!.unseen).toBe(9);
  });
  it("listening counts too: 2 new items a day; dictation items are not counted", () => {
    const lis = (n: number, dictation = false) => buildRecord({ kind: "LISTENING", level: "N3", pool: "LEARN", tags: [], payload: { taskType: "POINT", segments: [{ speaker: "F", text: `聞く文${n}です。` }], ...(dictation ? { dictation: true } : { questionId: `q:${n}` }) }, provenance: prov, verification: ver("LISTENING") });
    const pool = [...Array.from({ length: 900 }, (_, i) => vocab(i)), ...Array.from({ length: 900 }, (_, i) => gram(i)), ...Array.from({ length: 10 }, (_, i) => lis(i)), lis(99, true)];
    const r = computeRunway(pool, [], "TARGET_FOCUS", { areas: ["VOCAB", "GRAMMAR", "LISTENING"] });
    expect(r.perArea.LISTENING).toEqual({ unseen: 10, days: 5 });
    expect(r.limitingArea).toBe("LISTENING");
  });
  it("with no content the runway is 0 and content is needed", () => {
    expect(computeRunway([], [], null)).toMatchObject({ days: 0, needsContent: true });
    expect(DAILY_NEW_CAP).toEqual({ KANA_FOUNDATION: 5, FOUNDATION: 10, TARGET_FOCUS: 15 });
  });
});

describe("progress.json carries no personal data", () => {
  it("aggregates only: accuracy, tag counts, unseen, backlog, runway", () => {
    const q1 = question(1, undefined, ["KO_PARTICLE_TRANSFER", "diag:KANA", "free text tag"]), q2 = question(2);
    const events = [
      ev("QUESTION_SUBMITTED", { contentId: q1.contentId, isCorrect: false, selectedChoiceId: "b", exposureType: "PRACTICE" }, 1),
      ev("QUESTION_SUBMITTED", { contentId: q2.contentId, isCorrect: true, selectedChoiceId: "a", exposureType: "PRACTICE" }, 2),
      ev("SHEET_BOUND", { sheetInstanceId: "inst-secret" }, 3), ev("SETTINGS_UPDATED", { x: 1 }, 4),
    ];
    const prog = buildProgress({ records: [q1, q2], pool: [q1, q2], events, level: "N3", route: "TARGET_FOCUS", appVersion: "0.1.0", now: new Date("2026-10-16T00:00:00Z") });
    expect(prog.accuracy.GRAMMAR).toEqual({ n: 2, k: 1 });
    expect(prog.wrongByTag).toEqual({ KO_PARTICLE_TRANSFER: 1 }); // only standard tags, never free text or diag markers
    const text = JSON.stringify(prog);
    for (const bad of ["docs.google", "spreadsheet", "token", "p-secret-profile", "d-secret-device", "inst-secret", "eventId", "profileId", "deviceId", "@", "https://", "client"]) expect(text, bad).not.toContain(bad);
    expect(Object.keys(prog).sort()).toEqual(["accuracy", "appVersion", "createdAt", "dailyNewCap", "format", "formatVersion", "level", "reviewBacklog", "route", "runway", "unseen", "wrongByTag"]);
    expect(prog.format).toBe("jlpt-progress");
  });
  it("flags export holds ids, versions, hashes and reasons only", () => {
    const f = buildFlagsExport([{ contentId: "q:abc", contentVersion: 1, contentHash: "h", reason: "정답 오류", flaggedAt: "2026-10-16T00:00:00Z" }]);
    expect(f).toMatchObject({ format: "jlpt-flags", flags: [{ contentId: "q:abc" }] });
    expect(JSON.stringify(f)).not.toMatch(/profile|device|token|docs\.google/i);
  });
});

describe("export -> import round trip", () => {
  const rows = [...Array.from({ length: 6 }, (_, i) => vocab(i)), question(1), question(2), gram(1)];
  const fp = flagProjection([]);
  it("full and per-kind exports re-import with 0 new and 100% duplicates; files carry no personal data", () => {
    const full = exportPack(rows, {}, fp, { appVersion: "0.1.0", now: new Date("2026-10-16T00:00:00Z") });
    expect(full.items.length).toBe(9);
    expect(packFileName(full, undefined, new Date("2026-10-16T00:00:00Z"))).toBe("jlpt-pack_all_20261016_9.jlptpack.json");
    const vocabOnly = exportPack(rows, { kinds: ["VOCAB"] }, fp, { appVersion: "0.1.0" });
    expect(vocabOnly.items.length).toBe(6);
    expect(packFileName(vocabOnly, ["VOCAB"], new Date("2026-10-16T00:00:00Z"))).toBe("jlpt-pack_vocab_20261016_6.jlptpack.json");
    const fresh = planImport(JSON.stringify(full), { rows: [], blockedIds: new Set(), exposed: new Set() });
    expect(fresh.summary.added).toBe(9);
    const again = planImport(JSON.stringify(full), { rows: fresh.toWrite, blockedIds: new Set(), exposed: new Set() });
    expect(again.summary.added + again.summary.newVersions).toBe(0);
    expect(again.summary.duplicates).toBe(9);
    expect(JSON.stringify(full)).not.toMatch(/profileId|deviceId|eventId|docs\.google|token/i);
  });
  it("flagged items and unverified items are excluded by default", () => {
    const flagged = flagProjection([ev("CONTENT_FLAGGED", { contentId: rows[0]!.contentId, reason: "정답 오류" })]);
    expect(exportPack(rows, {}, flagged, { appVersion: "0.1.0" }).items.length).toBe(8);
    const unv = { ...rows[1]!, verification: { ...rows[1]!.verification, status: "UNVERIFIED" as const } };
    expect(exportPack([unv], {}, fp, { appVersion: "0.1.0" }).items.length).toBe(0);
    expect(exportPack([unv], { includeUnverified: true }, fp, { appVersion: "0.1.0" }).items.length).toBe(1);
  });
});

describe("writing 5,000 items to the sheet (FAKE Sheets API)", () => {
  const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd";
  async function setup() {
    const fake = new FakeSheets(); fake.addBook(ID, { Sheet1: [] });
    const c = new SheetsClient(ID, () => fake.validToken, fake.http);
    await initialize(c, await inspect(c), { profileId: "p", seed: SEED_PACK });
    return { fake, c };
  }
  const items = Array.from({ length: 5000 }, (_, i) => vocab(10000 + i));
  const pack = { packId: "pack-x", packVersion: "1.0.0" };

  it("200 rows per request, <= 60 write requests per minute, all rows land once", async () => {
    const { fake, c } = await setup();
    const t = { now: 0 }; const stamps: number[] = [];
    const base = fake.http;
    fake.http = async (u, i) => { if (i.method === "POST") stamps.push(t.now); return base(u, i); };
    const c2 = new SheetsClient(ID, () => fake.validToken, fake.http);
    const rowsBefore = fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length;
    const prog = await writeContent(c2, items, pack, { sleep: async (ms) => { t.now += ms; } });
    expect(prog).toMatchObject({ written: 5000, batches: 25 });
    expect(fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length - rowsBefore).toBe(5000);
    expect(CONTENT_BATCH).toBe(200);
    for (const s of stamps) expect(stamps.filter((x) => x >= s && x < s + 60000).length).toBeLessThanOrEqual(60);
  });
  it("interrupted midway -> resume writes only the rest; running it again writes nothing", async () => {
    const { fake, c } = await setup();
    fake.failures.push({ match: /CONTENT.*:append/, status: 503, times: 1 });
    // let 9 appends through, then fail the 10th
    let n = 0; const base = fake.http;
    fake.http = async (u, i) => { if (i.method === "POST" && u.includes(":append") && ++n === 10) return { status: 503, headers: { get: () => null }, text: async () => "{}" }; return base(u, i); };
    const c1 = new SheetsClient(ID, () => fake.validToken, fake.http);
    fake.failures.length = 0;
    await expect(writeContent(c1, items, pack, { sleep: async () => {} })).rejects.toBeTruthy();
    const mid = fake.tab(ID, SHEET_TABS.CONTENT)!.rows.length;
    expect(mid).toBeGreaterThan(1500);
    const c2 = new SheetsClient(ID, () => fake.validToken, base);
    const rest = await writeContent(c2, items, pack, { sleep: async () => {} });
    expect(rest.skipped).toBe(9 * 200);
    expect(rest.written).toBe(5000 - 9 * 200);
    const ids = fake.tab(ID, SHEET_TABS.CONTENT)!.rows.slice(1).map((r) => `${r[0]}@${r[1]}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await writeContent(c2, items, pack, { sleep: async () => {} })).written).toBe(0);
  });
});
