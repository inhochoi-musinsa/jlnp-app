import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module
import { findViolations, scan } from "../../scripts/level-neutral.mjs";
import { resolve } from "node:path";

const ok: [string, string][] = [
  ["const level = settings.targetLevel;", "app/src/a.ts"],
  ["ExamSpec[level].testSections", "app/src/b.ts"],
  ["const LEVELS = ['N5','N4','N3','N2','N1'];", "shared/examSpec.ts"],
  ['{ "level": "N3", "vocab": 2000 }', "tools/content/targets/N3.json"],
  ["const HN3 = 1; // identifier containing the letters is fine", "app/src/c.ts"],
  ["// ordinary comment about levels", "shared/lint.ts"],
  ["const BN1X = 'x'", "tools/content/src/d.ts"],
  ['{ "level": "N3" }', "app/seed/seed.jlptpack.json"],
];
const bad: [string, string][] = [
  ["const level = 'N3';", "app/src/a.ts"],
  ["if (level === \"N2\") {}", "shared/schema.ts"],
  ["const label = `N1 mode`;", "tools/content/src/x.ts"],
  ["// default to N5 here", "app/src/ui/home.ts"],
  ["title: 'N4 diagnostic'", "app/src/ui/diag.ts"],
  ["export const N3_FOCUS = 1;", "app/src/domain/plan.ts"],
  ["", "app/src/N3_reading.ts"],
];

describe("level-neutral lint", () => {
  it.each(ok)("allows: %s (%s)", (text: string, path: string) => expect(findViolations(text, path)).toEqual([]));
  it.each(bad)("flags: %s (%s)", (text: string, path: string) => expect(findViolations(text, path).length).toBeGreaterThan(0));
  it("the repository itself has 0 violations", () => expect(scan(resolve(__dirname, "../.."))).toEqual([]));
});
