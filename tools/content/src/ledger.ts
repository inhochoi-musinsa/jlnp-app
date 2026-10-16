import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ContentRecord, Kind } from "../../../shared/schema";
import { normalizedKey } from "../../../shared/normalize";
import { SIMILARITY_THRESHOLD, similarity } from "../../../shared/similarity";
import type { Pack } from "../../../shared/pack";
import { CONTENT_DIR, readJson, writeJson } from "./util";

export interface LedgerEntry { contentId: string; kind: Kind; level: string; pool: string; key: string; contentHash: string; contentVersion: number; status: string; simText?: string }
export const SIM_KINDS: Kind[] = ["QUESTION", "PASSAGE", "LISTENING"];

const simTextOf = (r: ContentRecord): string => {
  const p = r.payload;
  if (r.kind === "QUESTION") return String(p.stem) + (p.choices as any[]).find((c) => c.id === p.correctChoiceId)?.text;
  if (r.kind === "PASSAGE") return (p.pages as string[]).join("");
  if (r.kind === "LISTENING") return (p.segments as any[]).map((s) => s.text).join("");
  return "";
};

export type DupResult = { dup: false } | { dup: true; reason: "SAME_ID" | "SAME_KEY" | "SIMILAR"; existingId: string; score?: number };

export class Ledger {
  entries = new Map<string, LedgerEntry>();
  constructor(readonly path = join(CONTENT_DIR, "ledger.json")) {
    if (existsSync(path)) for (const e of readJson<LedgerEntry[]>(path)) this.entries.set(e.contentId, e);
  }
  save(): void { writeJson(this.path, [...this.entries.values()]); }

  /** V6: exact id, exact normalized key, or n-gram similarity >= threshold (same kind). */
  check(r: ContentRecord): DupResult {
    const own = this.entries.get(r.contentId);
    if (own) return { dup: true, reason: "SAME_ID", existingId: own.contentId };
    const key = normalizedKey(r.kind, r.payload);
    for (const e of this.entries.values()) if (e.kind === r.kind && e.key === key) return { dup: true, reason: "SAME_KEY", existingId: e.contentId };
    if (SIM_KINDS.includes(r.kind)) {
      const t = simTextOf(r);
      for (const e of this.entries.values()) {
        if (e.kind !== r.kind || !e.simText) continue;
        const score = similarity(t, e.simText);
        if (score >= SIMILARITY_THRESHOLD) return { dup: true, reason: "SIMILAR", existingId: e.contentId, score };
      }
    }
    return { dup: false };
  }

  add(r: ContentRecord): void {
    this.entries.set(r.contentId, {
      contentId: r.contentId, kind: r.kind, level: r.level, pool: r.pool, key: normalizedKey(r.kind, r.payload), contentHash: r.contentHash,
      contentVersion: r.contentVersion, status: r.verification.status, simText: SIM_KINDS.includes(r.kind) ? simTextOf(r) : undefined,
    });
  }

  rebuildFromPack(pack: Pack): number { this.entries.clear(); for (const i of pack.items) this.add(i); return this.entries.size; }
  get size(): number { return this.entries.size; }
}
