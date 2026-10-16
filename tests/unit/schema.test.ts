import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex, base32 } from "../../shared/hash";
import { canonicalJSON, makeContentId, normalizedKey } from "../../shared/normalize";
import { buildRecord, computeContentHash, validateContentRecord } from "../../shared/schema";
import { lintRecord, endingOnlySolvable, isKanaOnly } from "../../shared/lint";
import { question, vocab } from "../fixtures/records";
import { EXAM_SPECS, LEVELS, scoringSectionFor } from "../../shared/examSpec";
import { SHEET_HEADERS } from "../../shared/sheetSchema";

describe("hash", () => {
  it("sha256 matches node crypto for edge lengths and unicode", () => {
    for (const s of ["", "abc", "a".repeat(55), "a".repeat(56), "a".repeat(64), "日本語のテスト🙂", "あ".repeat(1000)]) {
      expect(sha256Hex(s)).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });
  it("base32 is RFC4648 lowercase", () => {
    expect(base32(new TextEncoder().encode("foobar"))).toBe("mzxw6ytboi");
  });
});

describe("normalize", () => {
  it("canonicalJSON ignores key order", () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(canonicalJSON({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
  it("contentId is deterministic and prefixed", () => {
    const a = makeContentId("VOCAB", { surface: "油断", reading: "ゆだん", pos: "noun" });
    expect(a).toMatch(/^vocab:[a-z2-7]{10}$/);
    expect(makeContentId("VOCAB", { surface: "油断", reading: "ゆだん", pos: "noun" })).toBe(a);
  });
  it("normalizedKey folds width, spaces and tilde variants", () => {
    expect(normalizedKey("GRAMMAR", { pattern: "〜ことにする" })).toBe(normalizedKey("GRAMMAR", { pattern: "～ こと にする" }));
    expect(normalizedKey("KANA", { chars: ["ツ", "シ"] })).toBe(normalizedKey("KANA", { chars: ["シ", "ツ"] }));
  });
});

describe("TST-SCHEMA-01 exam spec", () => {
  it("scoring sections: 3 for upper levels, 2 for the two lowest", () => {
    const counts = Object.fromEntries(LEVELS.map((l) => [l, EXAM_SPECS[l].scoringSections.length]));
    expect(counts).toEqual({ N5: 2, N4: 2, N3: 3, N2: 3, N1: 3 });
  });
  it("pass marks and times match the official table", () => {
    expect(EXAM_SPECS.N3.officialOverallPassMark).toBe(95);
    expect(EXAM_SPECS.N3.testSections.map((s) => s.timeMinutes)).toEqual([30, 70, 40]);
    expect(EXAM_SPECS.N4.scoringSections[0]).toMatchObject({ maxScaledScore: 120, officialSectionalPassMark: 38 });
    expect(EXAM_SPECS.N1.testSections.map((s) => s.timeMinutes)).toEqual([110, 55]);
  });
  it("domain -> scoring section depends on level structure", () => {
    expect(scoringSectionFor("N3", "READING_Q")).toBe("READING");
    expect(scoringSectionFor("N5", "READING_Q")).toBe("LANGUAGE_KNOWLEDGE_READING");
    expect(scoringSectionFor("N5", "LISTENING_Q")).toBe("LISTENING");
  });
});

describe("TST-SCHEMA-01 record validation", () => {
  it("valid records pass and hash verifies", () => {
    const r = question();
    expect(validateContentRecord(r)).toEqual([]);
    expect(computeContentHash(r)).toBe(r.contentHash);
    expect(validateContentRecord(vocab())).toEqual([]);
  });
  it("rejects structural problems", () => {
    const bad = [
      { ...question(), level: "N9" },
      { ...question(), license: "COMMERCIAL" },
      { ...question(), contentVersion: 0 },
      { ...question(), payload: { ...question().payload, choices: question().payload.choices.slice(0, 3) } },
      { ...question(), payload: { ...question().payload, correctChoiceId: "zz" } },
      { ...vocab(), payload: { surface: "x" } },
      null,
    ];
    for (const b of bad) expect(validateContentRecord(b).length).toBeGreaterThan(0);
  });
  it("sheet headers carry no lamport", () => {
    expect(SHEET_HEADERS.EVENTS).not.toContain("lamport");
    expect(SHEET_HEADERS.EVENTS).toContain("deviceSeq");
  });
});

describe("lint rules", () => {
  it("clean record has no issues", () => expect(lintRecord(question())).toEqual([]));
  it("wrong choices need whyWrong and howToCorrect", () => {
    const q = question({}, [
      { id: "a", text: "やめる" }, { id: "b", text: "やめた" }, { id: "c", text: "やめて", whyWrong: "x", howToCorrect: "y" }, { id: "d", text: "やめない", whyWrong: "z", howToCorrect: "w" },
    ]);
    expect(lintRecord(q).map((i) => i.code)).toContain("WRONG_EXPLANATION_MISSING");
  });
  it("identical whyWrong texts and duplicate choices are flagged", () => {
    const dup = (id: string, text: string) => ({ id, text, whyWrong: "same", howToCorrect: "fix" + id });
    const codes = lintRecord(question({}, [{ id: "a", text: "A" }, dup("b", "B"), dup("c", "C"), dup("d", "B")])).map((i) => i.code);
    expect(codes).toContain("WRONG_EXPLANATION_DUPLICATE");
    expect(codes).toContain("CHOICE_DUPLICATE");
  });
  it("correct choice must not carry wrong-fields", () => {
    const q = question({}, [{ id: "a", text: "A", whyWrong: "no" }, { id: "b", text: "B", whyWrong: "1", howToCorrect: "1" }, { id: "c", text: "C", whyWrong: "2", howToCorrect: "2" }, { id: "d", text: "D", whyWrong: "3", howToCorrect: "3" }]);
    expect(lintRecord(q).map((i) => i.code)).toContain("CORRECT_HAS_WRONG_FIELDS");
  });
  it("reading must be kana only", () => {
    expect(isKanaOnly("ゆだん")).toBe(true);
    expect(isKanaOnly("ラーメン")).toBe(true);
    expect(isKanaOnly("油だん")).toBe(false);
    expect(isKanaOnly("yudan")).toBe(false);
    expect(lintRecord(vocab({ reading: "油だん" })).map((i) => i.code)).toContain("READING_CHARS");
  });
  it("blocks html, urls, control chars, oversize payloads", () => {
    expect(lintRecord(vocab({ meaningKo: "<script>alert(1)</script>" })).map((i) => i.code)).toContain("HTML_FORBIDDEN");
    expect(lintRecord(vocab({ meaningKo: "see https://example.com" })).map((i) => i.code)).toContain("URL_FORBIDDEN");
    expect(lintRecord(vocab({ meaningKo: "a\u0007b" })).map((i) => i.code)).toContain("CONTROL_CHAR");
    expect(lintRecord(vocab({ meaningKo: "가".repeat(31000) })).map((i) => i.code)).toContain("PAYLOAD_TOO_LARGE");
  });
  it("ending-only grammar heuristic: positives", () => {
    expect(endingOnlySolvable("これを（　　）。", ["食べる", "食べた", "食べて", "食べない"])).toBe(true);
    expect(endingOnlySolvable("手紙を（　　）。", ["書いた", "書いて", "書く", "書かない"])).toBe(true);
  });
  it("ending-only grammar heuristic: items with context cues pass", () => {
    expect(endingOnlySolvable("昨日は雨が降っていたので、約束を（　　）ことにした。", ["やめる", "やめた", "やめて", "やめない"])).toBe(false);
    // only one cue category (から) -> still flagged: the heuristic is deliberately conservative
    expect(endingOnlySolvable("（　　）から、電気をつけた。", ["暗い", "暗く", "暗かった", "暗さ"])).toBe(true);
    expect(endingOnlySolvable("彼は毎日（　　）。", ["食べる", "食べた", "食べて", "食べない"])).toBe(false);
  });
  it("different stems are not ending-only", () => {
    expect(endingOnlySolvable("私は先生に宿題を（　　）。", ["見てもらった", "あげた", "くれた", "さしあげた"])).toBe(false);
  });
});

describe("buildRecord", () => {
  it("different versions give different hashes with the same id", () => {
    const a = vocab();
    const b = buildRecord({ kind: a.kind, level: a.level, pool: a.pool, tags: a.tags, payload: a.payload, contentVersion: 2, provenance: a.provenance, verification: a.verification });
    expect(b.contentId).toBe(a.contentId);
    expect(b.contentHash).not.toBe(a.contentHash);
  });
});
