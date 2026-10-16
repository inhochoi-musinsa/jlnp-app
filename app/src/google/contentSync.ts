import type { ContentRecord } from "../../../shared/schema";
import { SHEET_HEADERS, SHEET_TABS } from "../../../shared/sheetSchema";
import { contentToRow } from "./init";
import type { SheetsClient } from "./sheets";

export const CONTENT_BATCH = 200;
/** ≈ 1 request/second keeps content writes far below the 60 writes/min/user quota (docs/qa/limits.md). */
export const CONTENT_PACE_MS = 1100;

export interface ContentWriteProgress { written: number; skipped: number; batches: number }

/**
 * Appends the records that are not in `_JLPT_CONTENT` yet (identity = contentId + version + hash) in batches of 200.
 * Re-running after an interruption only sends what is still missing, so a resumed import never duplicates rows.
 */
export async function writeContent(c: SheetsClient, records: ContentRecord[], pack: { packId: string; packVersion: string }, o: { now?: Date; sleep?: (ms: number) => Promise<void>; onProgress?: (p: ContentWriteProgress) => void; paceMs?: number } = {}): Promise<ContentWriteProgress> {
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const at = (o.now ?? new Date()).toISOString();
  const have = new Set<string>();
  const cols = SHEET_HEADERS.CONTENT.length;
  for (let first = 2; ; first += 5000) {
    const rows = await c.readRange(SHEET_TABS.CONTENT, first, first + 4999, cols);
    for (const r of rows) have.add(`${r[0]}@${r[1]}#${r[9]}`);
    if (rows.length < 5000) break;
  }
  const missing = records.filter((r) => !have.has(`${r.contentId}@${r.contentVersion}#${r.contentHash}`));
  const prog: ContentWriteProgress = { written: 0, skipped: records.length - missing.length, batches: 0 };
  for (let i = 0; i < missing.length; i += CONTENT_BATCH) {
    if (i > 0) await sleep(o.paceMs ?? CONTENT_PACE_MS);
    const batch = missing.slice(i, i + CONTENT_BATCH);
    await c.appendRows(SHEET_TABS.CONTENT, batch.map((r) => contentToRow(r, pack, at)), cols);
    prog.written += batch.length; prog.batches++;
    o.onProgress?.({ ...prog });
  }
  return prog;
}
