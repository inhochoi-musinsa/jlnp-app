import { join } from "node:path";
import { existsSync } from "node:fs";
import type { Level } from "../../../shared/examSpec";
import { Ledger } from "./ledger";
import { REPO_ROOT, readJson, writeJson, CONTENT_DIR } from "./util";

export interface Target { level: string; longTerm: { VOCAB: number; GRAMMAR: { points: number; lowerLevelPoints: number; targetLevelPoints: number }; PASSAGE: number; LISTENING: number }; initial: any }

export const loadTarget = (level: Level | string): Target => {
  const p = join(REPO_ROOT, "tools/content/targets", `${level}.json`);
  if (!existsSync(p)) throw new Error(`no targets file for level ${level}: create tools/content/targets/${level}.json`);
  return readJson<Target>(p);
};

/** Shortfall against the long-term target (reference only; not a requirement). */
export function catalog(level: string, ledger = new Ledger(), contentDir = CONTENT_DIR) {
  const t = loadTarget(level);
  const have = { VOCAB: 0, GRAMMAR: 0, PASSAGE: 0, LISTENING: 0 } as Record<string, number>;
  for (const e of ledger.entries.values()) if (e.status === "VERIFIED" && e.level === level && e.kind in have) have[e.kind]!++;
  const rows = [
    { kind: "VOCAB", have: have.VOCAB!, target: t.longTerm.VOCAB },
    { kind: "GRAMMAR", have: have.GRAMMAR!, target: t.longTerm.GRAMMAR.points },
    { kind: "PASSAGE", have: have.PASSAGE!, target: t.longTerm.PASSAGE },
    { kind: "LISTENING", have: have.LISTENING!, target: t.longTerm.LISTENING },
  ].map((r) => ({ ...r, missing: Math.max(0, r.target - r.have) }));
  const out = { level, generatedAt: new Date().toISOString(), rows };
  writeJson(join(contentDir, "catalog.json"), out);
  return out;
}
