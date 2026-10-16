import { buildPack, type Pack } from "../../../shared/pack";
import { KINDS, POOLS, type ContentRecord, type Kind, type Pool } from "../../../shared/schema";
import type { Level } from "../../../shared/examSpec";
import { effectiveStatus, type flagProjection } from "./status";

export interface ExportFilter { kinds?: Kind[]; levels?: Level[]; pools?: Pool[]; includeUnverified?: boolean }

/** Pack from the learner's content. Default: VERIFIED only; flagged/retired items are never exported. Personal data is never in a pack. */
export function exportPack(rows: ContentRecord[], f: ExportFilter, fp: ReturnType<typeof flagProjection>, o: { appVersion: string; now?: Date }): Pack {
  const kinds = f.kinds?.length ? f.kinds : [...KINDS];
  const items = rows.filter((r) => {
    if (!kinds.includes(r.kind)) return false;
    if (f.levels?.length && !f.levels.includes(r.level)) return false;
    if (f.pools?.length && !f.pools.includes(r.pool)) return false;
    const s = effectiveStatus(r, fp);
    return s === "VERIFIED" || (!!f.includeUnverified && s === "UNVERIFIED");
  });
  return buildPack(items, { generator: { tool: "jlpt-app", toolVersion: o.appVersion, models: {} }, now: o.now });
}

export function packFileName(p: Pack, kindsSelected: Kind[] | undefined, now = new Date()): string {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  const k = kindsSelected?.length && kindsSelected.length < KINDS.length ? kindsSelected.map((x) => x.toLowerCase()).join("-") : "all";
  return `jlpt-pack_${k}_${day}_${p.items.length}.jlptpack.json`;
}
export const ALL_POOLS = POOLS;
