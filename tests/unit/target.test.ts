import { describe, expect, it } from "vitest";
import { eligibleDays, firstSundayOf, isPastSession, makeExamTarget, maximumRemainingMinutes, todayKey, effectiveDate } from "../../app/src/domain/target";

describe("TST-DATE-01 first Sunday", () => {
  it("matches the plan table; official fields stay null", () => {
    expect(firstSundayOf(2027, 7)).toBe("2027-07-04");
    expect(firstSundayOf(2027, 12)).toBe("2027-12-05");
    expect(firstSundayOf(2028, 7)).toBe("2028-07-02");
    const t = makeExamTarget("N3", 2027, 7);
    expect(t).toMatchObject({ expectedExamDate: "2027-07-04", confirmedExamDate: null, dateStatus: "EXPECTED", sourceUrl: null });
  });
  it("month starting on Sunday returns day 1", () => {
    expect(firstSundayOf(2026, 2)).toBe("2026-02-01");
    expect(firstSundayOf(2027, 8)).toBe("2027-08-01");
  });
  it("confirmed date wins over expected", () => {
    const t = makeExamTarget("N3", 2027, 7, "2027-07-11");
    expect(t.dateStatus).toBe("CONFIRMED");
    expect(effectiveDate(t)).toBe("2027-07-11");
  });
  it("no selection keeps nulls; invalid month throws", () => {
    expect(makeExamTarget("N3", null, null)).toMatchObject({ dateStatus: "NOT_SELECTED", expectedExamDate: null });
    expect(() => makeExamTarget("N3", 2027, 9)).toThrow();
  });
});

describe("TST-DATE-02 changing the target", () => {
  it("is a pure recomputation that touches nothing else", () => {
    const history = ["2027/07", "2027/12", "2028/07"] as const;
    const kept = { events: ["e1", "e2"], settings: { fontScale: "L" }, sheetId: "abc" };
    const snapshot = JSON.stringify(kept);
    let last = makeExamTarget("N3", null, null);
    for (const h of history) { const [y, m] = h.split("/").map(Number); last = makeExamTarget("N3", y!, m!); }
    expect(last.expectedExamDate).toBe("2028-07-02");
    expect(JSON.stringify(kept)).toBe(snapshot);
  });
});

describe("TST-DATE-03 remaining days", () => {
  it("2026-10-15 -> 262 days / 416 days (max hours)", () => {
    expect(eligibleDays("2026-10-15", firstSundayOf(2027, 7))).toBe(262);
    expect(maximumRemainingMinutes(262) / 60).toBe(262);
    expect(eligibleDays("2026-10-15", firstSundayOf(2027, 12))).toBe(416);
  });
  it("exam day excluded, past sessions give 0, rest days excluded", () => {
    expect(eligibleDays("2027-07-03", "2027-07-04")).toBe(1);
    expect(eligibleDays("2027-07-04", "2027-07-04")).toBe(0);
    expect(eligibleDays("2027-08-01", "2027-07-04")).toBe(0);
    expect(eligibleDays("2027-06-28", "2027-07-05", [7])).toBe(6); // 7 days Mon..Sun minus one Sunday(07-04)
    expect(eligibleDays("2026-10-15", null)).toBe(0);
  });
  it("past session detection", () => {
    expect(isPastSession("2027-07-04", 2027, 7)).toBe(true);
    expect(isPastSession("2027-07-03", 2027, 7)).toBe(false);
    expect(isPastSession("2026-10-15", 2026, 7)).toBe(true);
  });
  it("day key uses the Seoul calendar, not UTC", () => {
    expect(todayKey(new Date("2026-10-14T16:30:00Z"))).toBe("2026-10-15");
    expect(todayKey(new Date("2026-10-14T14:59:59Z"))).toBe("2026-10-14");
  });
});
