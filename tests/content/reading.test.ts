import { describe, expect, it } from "vitest";
import { loadKuromoji, readingFindings } from "../../tools/content/src/readingCheck";
import { Ledger } from "../../tools/content/src/ledger";
import { vocab, question } from "../fixtures/records";
import { buildRecord } from "../../shared/schema";
import { similarity } from "../../shared/similarity";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("V2 READING_CHECK with kuromoji (real dictionary)", () => {
  it("accepts correct readings and flags wrong ones", async () => {
    const a = await loadKuromoji();
    expect(readingFindings(vocab(), a)).toEqual([]);
    const bad = readingFindings(vocab({ reading: "ゆうだん" }), a);
    expect(bad.length).toBe(1);
    expect(bad[0]).toMatchObject({ text: "油断", expected: "ゆうだん", analyzer: "ゆだん" });
  }, 30000);
  it("checks ruby annotations inside strings", async () => {
    const a = await loadKuromoji();
    const q = question({ stem: "昨日《きのう》は雨《あめ》が降《ふ》った。" });
    expect(readingFindings(q, a)).toEqual([]);
    const wrong = question({ stem: "昨日《さくじつ》は雨が降った。" });
    expect(readingFindings(wrong, a).length).toBe(1);
  }, 30000);
});

describe("V6 DEDUPE", () => {
  it("catches same id, same normalized key and near-duplicates (>= 0.85) but not different items", () => {
    const l = new Ledger(join(mkdtempSync(join(tmpdir(), "led-")), "l.json"));
    const q = question();
    l.add({ ...q, verification: { ...q.verification, status: "VERIFIED" } });
    expect(l.check(q)).toMatchObject({ dup: true, reason: "SAME_ID" });
    const spaced = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { ...q.payload, stem: q.payload.stem.replace("友達", " 友達 ") }, provenance: q.provenance, verification: q.verification });
    expect(l.check(spaced).dup).toBe(true);
    const near = buildRecord({ kind: "QUESTION", level: "N3", pool: "LEARN", tags: [], payload: { ...q.payload, stem: q.payload.stem + "。" + "その後の予定は未定だ" , choices: q.payload.choices }, provenance: q.provenance, verification: q.verification });
    expect(similarity(String(q.payload.stem) + "やめる", String(near.payload.stem) + "やめる")).toBeGreaterThan(0.6);
    const other = question({ stem: "来週の旅行は、天気が悪かったので（　　）ことになった。" }, [{ id: "a", text: "延期する" }, { id: "b", text: "延期した", whyWrong: "x1", howToCorrect: "y1" }, { id: "c", text: "延期して", whyWrong: "x2", howToCorrect: "y2" }, { id: "d", text: "延期しない", whyWrong: "x3", howToCorrect: "y3" }]);
    expect(l.check(other).dup).toBe(false);
  });
});
