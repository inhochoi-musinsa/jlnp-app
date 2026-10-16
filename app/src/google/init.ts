import { sha256Hex } from "../../../shared/hash";
import { canonicalJSON } from "../../../shared/normalize";
import type { Pack } from "../../../shared/pack";
import type { ContentRecord } from "../../../shared/schema";
import { EVENT_SCHEMA_VERSION, SHEET_HEADERS, SHEET_SCHEMA_VERSION, SHEET_TABS } from "../../../shared/sheetSchema";
import { uuid } from "../storage/events";
import { GoogleError, MSG } from "./errors";
import type { SheetsClient, SpreadsheetMeta } from "./sheets";

type TabKey = keyof typeof SHEET_TABS;
const TAB_KEYS = Object.keys(SHEET_TABS) as TabKey[];
const isAppTab = (t: string) => t.startsWith("_JLPT_");

export type InspectState = "EMPTY" | "PARTIAL" | "READY" | "FOREIGN" | "NEW_SCHEMA";
export interface Inspection {
  state: InspectState;
  meta: SpreadsheetMeta;
  missingTabs: TabKey[];
  sheetInstanceId?: string;
  ownerProfileId?: string | null;
  schemaVersion?: number;
}

const metaRow = (key: string, value: unknown, at: string): string[] => {
  const valueJson = JSON.stringify(value);
  return [key, valueJson, at, sha256Hex(key + "\n" + valueJson).slice(0, 16)];
};

/** Read-only look at the spreadsheet. Never writes. */
export async function inspect(c: SheetsClient): Promise<Inspection> {
  const meta = await c.getMeta();
  const present = meta.tabs.filter((t) => isAppTab(t.title));
  if (present.length === 0) return { state: "EMPTY", meta, missingTabs: [...TAB_KEYS] };
  // Any `_JLPT_` tab that is not one of ours, or with other headers, means somebody else's data: do not touch.
  const known = new Set<string>(Object.values(SHEET_TABS));
  if (present.some((t) => !known.has(t.title))) return { state: "FOREIGN", meta, missingTabs: [] };
  for (const key of TAB_KEYS) {
    const tab = SHEET_TABS[key];
    if (!present.some((t) => t.title === tab)) continue;
    const hdr = (await c.readRange(tab, 1, 1, SHEET_HEADERS[key].length))[0] ?? [];
    if (hdr.length !== SHEET_HEADERS[key].length || hdr.some((h, i) => h !== SHEET_HEADERS[key][i])) return { state: "FOREIGN", meta, missingTabs: [] };
  }
  const missingTabs = TAB_KEYS.filter((k) => !present.some((t) => t.title === SHEET_TABS[k]));
  const metaTab = present.some((t) => t.title === SHEET_TABS.META);
  const kv = new Map<string, any>();
  if (metaTab) for (const r of await c.readRange(SHEET_TABS.META, 2, 200, 4)) { try { kv.set(String(r[0]), JSON.parse(String(r[1]))); } catch { /* ignore a damaged row */ } }
  const schemaVersion = typeof kv.get("schemaVersion") === "number" ? (kv.get("schemaVersion") as number) : undefined;
  const sheetInstanceId = typeof kv.get("sheetInstanceId") === "string" ? (kv.get("sheetInstanceId") as string) : undefined;
  if (metaTab && !sheetInstanceId) return { state: "FOREIGN", meta, missingTabs: [] };
  if (schemaVersion !== undefined && schemaVersion > SHEET_SCHEMA_VERSION) return { state: "NEW_SCHEMA", meta, missingTabs, schemaVersion, sheetInstanceId };
  return { state: missingTabs.length || !kv.get("activePackRevision") ? "PARTIAL" : "READY", meta, missingTabs, sheetInstanceId, ownerProfileId: (kv.get("ownerProfileId") as string | null) ?? null, schemaVersion };
}

/** One content row. `payloadJson` carries everything except the identity columns. */
export function contentToRow(r: ContentRecord, pack: { packId: string; packVersion: string }, at: string): (string | number)[] {
  const body = { pool: r.pool, tags: r.tags, payload: r.payload, provenance: r.provenance, verification: r.verification };
  return [r.contentId, r.contentVersion, pack.packId, pack.packVersion, r.kind, r.level, r.verification.status, r.license, canonicalJSON(body), r.contentHash, at];
}
export function rowToContent(row: (string | number)[]): ContentRecord | null {
  try {
    const body = JSON.parse(String(row[8]));
    return { contentId: String(row[0]), contentVersion: Number(row[1]), kind: row[4] as ContentRecord["kind"], level: row[5] as ContentRecord["level"], pool: body.pool, tags: body.tags, payload: body.payload, provenance: body.provenance, verification: body.verification, license: "ORIGINAL", contentHash: String(row[9]) };
  } catch { return null; }
}

export interface InitOptions { profileId: string; seed: Pack; now?: Date; newId?: () => string }

/**
 * Non-destructive initialisation: creates only the missing `_JLPT_*` tabs, writes headers and META, then
 * adds the seed content rows that are not there yet. `activePackRevision` is written LAST, so a half-finished
 * run never exposes incomplete content and a re-run only completes the missing steps.
 */
export async function initialize(c: SheetsClient, ins: Inspection, o: InitOptions): Promise<{ created: TabKey[]; contentAdded: number }> {
  if (ins.state === "FOREIGN") throw new GoogleError("FOREIGN_TABS", MSG.FOREIGN_TABS);
  if (ins.state === "NEW_SCHEMA") throw new GoogleError("NEW_SCHEMA", MSG.NEW_SCHEMA);
  if (ins.ownerProfileId && ins.ownerProfileId !== o.profileId) throw new GoogleError("PROFILE_MISMATCH", MSG.PROFILE_MISMATCH);
  const at = (o.now ?? new Date()).toISOString();
  const created: TabKey[] = [];
  if (ins.missingTabs.length) {
    await c.addTabs(ins.missingTabs.map((k) => SHEET_TABS[k]));
    created.push(...ins.missingTabs);
    await c.writeRanges(ins.missingTabs.map((k) => ({ tab: SHEET_TABS[k], startRow: 1, values: [[...SHEET_HEADERS[k]]] })));
  }
  const m = await inspectMeta(c);
  const instanceId = ins.sheetInstanceId ?? m.get("sheetInstanceId") ?? (o.newId ?? uuid)();
  if (!m.has("sheetInstanceId")) {
    await c.appendRows(SHEET_TABS.META, [
      metaRow("schemaVersion", SHEET_SCHEMA_VERSION, at), metaRow("eventSchemaVersion", EVENT_SCHEMA_VERSION, at),
      metaRow("sheetInstanceId", instanceId, at), metaRow("initializedAt", at, at), metaRow("ownerProfileId", o.profileId, at),
      metaRow("boundGoogleSub", null, at), metaRow("bootstrapPackVersion", o.seed.manifest.packVersion, at),
    ], 4);
  }
  // content rows that are not in the sheet yet (identity = contentId + version + hash)
  const have = new Set<string>();
  const rows = await c.readRange(SHEET_TABS.CONTENT, 2, 100000, SHEET_HEADERS.CONTENT.length);
  for (const r of rows) have.add(`${r[0]}@${r[1]}#${r[9]}`);
  const missing = o.seed.items.filter((r) => !have.has(`${r.contentId}@${r.contentVersion}#${r.contentHash}`));
  const mani = o.seed.manifest;
  const packRows = await c.readRange(SHEET_TABS.PACKS, 2, 1000, 2);
  if (!packRows.some((r) => r[0] === mani.packId && r[1] === mani.packVersion)) {
    await c.appendRows(SHEET_TABS.PACKS, [[mani.packId, mani.packVersion, mani.targetLevels.join(","), "VERIFIED", "TRUE", mani.createdAt, JSON.stringify(mani), mani.manifestHash]], SHEET_HEADERS.PACKS.length);
  }
  for (let i = 0; i < missing.length; i += 200) {
    await c.appendRows(SHEET_TABS.CONTENT, missing.slice(i, i + 200).map((r) => contentToRow(r, mani, at)), SHEET_HEADERS.CONTENT.length);
  }
  const total = rows.length + missing.length;
  await c.appendRows(SHEET_TABS.META, [metaRow("contentRowCount", total, at)], 4);
  if (m.get("activePackRevision") !== mani.manifestHash) await c.appendRows(SHEET_TABS.META, [metaRow("activePackRevision", mani.manifestHash, at)], 4);
  return { created, contentAdded: missing.length };
}

/** Latest value per META key (later rows win; META is append-only). */
export async function inspectMeta(c: SheetsClient): Promise<Map<string, any>> {
  const kv = new Map<string, any>();
  for (const r of await c.readRange(SHEET_TABS.META, 2, 500, 4)) { try { kv.set(String(r[0]), JSON.parse(String(r[1]))); } catch { /* skip */ } }
  return kv;
}

/** §4.7 incremental loading: read only the rows added since `cursor`, 500 per request. */
export async function pullContent(c: SheetsClient, cursor: number, limit = 500): Promise<{ records: ContentRecord[]; nextCursor: number; bad: number }> {
  const records: ContentRecord[] = [];
  let bad = 0, next = cursor;
  for (;;) {
    const rows = await c.readRange(SHEET_TABS.CONTENT, next + 2, next + 1 + limit, SHEET_HEADERS.CONTENT.length);
    for (const r of rows) { const rec = rowToContent(r); if (rec) records.push(rec); else bad++; }
    next += rows.length;
    if (rows.length < limit) break;
  }
  return { records, nextCursor: next, bad };
}
