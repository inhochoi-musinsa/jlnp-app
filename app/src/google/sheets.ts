import type { SyncEvent } from "../storage/events";
import type { AppendRange, RemoteEventLog } from "../storage/interface";
import { SHEET_HEADERS, SHEET_TABS } from "../../../shared/sheetSchema";
import { GoogleError, MSG, mapHttpError, type Op } from "./errors";

export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(n: string): string | null }; text(): Promise<string> }>;

const BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const colLetter = (n: number): string => { let s = ""; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
export const quoteTab = (t: string) => `'${t.replace(/'/g, "''")}'`;

export interface SheetTab { sheetId: number; title: string }
export interface SpreadsheetMeta { spreadsheetId: string; title: string; tabs: SheetTab[] }

/** Thin REST client for one user-supplied spreadsheet. The token never leaves memory and is never logged. */
export class SheetsClient {
  constructor(readonly spreadsheetId: string, private getToken: () => string | null, private http: HttpFetch = (u, i) => fetch(u, i)) {}

  private async call(method: "GET" | "POST", path: string, op: Op, body?: unknown): Promise<any> {
    const token = this.getToken();
    if (!token) throw new GoogleError("NEEDS_AUTH", MSG.EXPIRED);
    let res;
    try {
      res = await this.http(`${BASE}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
        method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new GoogleError("OFFLINE", "network error"); }
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
    if (res.status === 200) return json;
    const ra = Number(res.headers.get("retry-after"));
    throw mapHttpError(res.status, json, op, Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined);
  }

  async getMeta(): Promise<SpreadsheetMeta> {
    const j = await this.call("GET", `?fields=${encodeURIComponent("spreadsheetId,properties.title,sheets.properties(sheetId,title)")}`, "read");
    return { spreadsheetId: j.spreadsheetId, title: j.properties?.title ?? "", tabs: (j.sheets ?? []).map((s: any) => ({ sheetId: s.properties.sheetId, title: s.properties.title })) };
  }

  async addTabs(titles: string[]): Promise<void> {
    await this.call("POST", ":batchUpdate", "write", { requests: titles.map((title) => ({ addSheet: { properties: { title } } })) });
  }

  /** values.batchUpdate with RAW: strings are stored as typed, never interpreted as formulas. */
  async writeRanges(data: { tab: string; startRow: number; values: (string | number)[][] }[]): Promise<void> {
    await this.call("POST", "/values:batchUpdate", "write", {
      valueInputOption: "RAW",
      data: data.map((d) => ({ range: `${quoteTab(d.tab)}!A${d.startRow}:${colLetter(Math.max(1, ...d.values.map((r) => r.length)))}${d.startRow + d.values.length - 1}`, values: d.values })),
    });
  }

  async readRange(tab: string, firstRow: number, lastRow: number, lastCol: number): Promise<(string | number)[][]> {
    const range = `${quoteTab(tab)}!A${firstRow}:${colLetter(lastCol)}${lastRow}`;
    const j = await this.call("GET", `/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE`, "read");
    return j?.values ?? [];
  }

  /** Appends rows with RAW + INSERT_ROWS. Returns the 1-based sheet rows written (parsed from updatedRange). */
  async appendRows(tab: string, values: (string | number)[][], cols: number): Promise<{ firstRow: number; lastRow: number }> {
    const range = `${quoteTab(tab)}!A1:${colLetter(cols)}1`;
    const j = await this.call("POST", `/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "write", { majorDimension: "ROWS", values });
    const ur: string | undefined = j?.updates?.updatedRange;
    const m = ur ? /!?[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ur) : null;
    if (!m) throw new GoogleError("UNSURE", MSG.UNSURE);
    return { firstRow: Number(m[1]), lastRow: Number(m[2]) };
  }
}

const EV_COLS = SHEET_HEADERS.EVENTS;
export const eventToRow = (e: SyncEvent): (string | number)[] => EV_COLS.map((c) => (e as unknown as Record<string, string | number>)[c]!);
export function rowToEvent(r: (string | number)[]): SyncEvent | null {
  if (r.length < EV_COLS.length) return null;
  const o = Object.fromEntries(EV_COLS.map((c, i) => [c, r[i]]));
  if (typeof o.eventId !== "string" || typeof o.checksum !== "string") return null;
  return { ...o, deviceSeq: Number(o.deviceSeq), eventSchemaVersion: Number(o.eventSchemaVersion), eventId: String(o.eventId), checksum: String(o.checksum), payloadJson: String(o.payloadJson), type: String(o.type), entityId: String(o.entityId), profileId: String(o.profileId), deviceId: String(o.deviceId), occurredAt: String(o.occurredAt) } as unknown as SyncEvent;
}

/** `_JLPT_EVENTS` as a RemoteEventLog. Data row n lives on sheet row n+1 (row 1 is the header). */
export class SheetsEventLog implements RemoteEventLog {
  constructor(private c: SheetsClient) {}
  async appendEvents(events: SyncEvent[]): Promise<AppendRange> {
    const r = await this.c.appendRows(SHEET_TABS.EVENTS, events.map(eventToRow), EV_COLS.length);
    return { firstRow: r.firstRow - 1, lastRow: r.lastRow - 1 };
  }
  async readEventRows(firstRow: number, lastRow: number): Promise<SyncEvent[]> {
    const rows = await this.c.readRange(SHEET_TABS.EVENTS, firstRow + 1, lastRow + 1, EV_COLS.length);
    return rows.map(rowToEvent).filter((e): e is SyncEvent => e !== null);
  }
  async readEventsAfter(rowCursor: number, limit: number) {
    const rows = await this.c.readRange(SHEET_TABS.EVENTS, rowCursor + 2, rowCursor + 1 + limit, EV_COLS.length);
    return { events: rows.map(rowToEvent).filter((e): e is SyncEvent => e !== null), nextCursor: rowCursor + rows.length };
  }
  async rowCount(): Promise<number> {
    // Column A holds eventId for every data row; the count of non-empty cells minus the header is the row count.
    const rows = await this.c.readRange(SHEET_TABS.EVENTS, 2, 100000, 1);
    return rows.length;
  }
}
