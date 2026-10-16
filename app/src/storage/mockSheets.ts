import { SHEET_HEADERS } from "../../../shared/sheetSchema";
import type { SyncEvent } from "./events";
import type { AppendRange, RemoteEventLog } from "./interface";

export type MockFailure = "LOST_RESPONSE" | "HTTP_5XX" | "HTTP_429" | "HTTP_401" | "HTTP_403" | "HTTP_404" | "OFFLINE";

import { GoogleError, mapHttpError } from "../google/errors";

const COLS = SHEET_HEADERS.EVENTS;
const toRow = (e: SyncEvent): string[] => COLS.map((c) => String((e as unknown as Record<string, unknown>)[c]));
const fromRow = (r: string[]): SyncEvent => {
  const o = Object.fromEntries(COLS.map((c, i) => [c, r[i]]));
  return { ...o, deviceSeq: Number(o.deviceSeq), eventSchemaVersion: Number(o.eventSchemaVersion) } as unknown as SyncEvent;
};

/**
 * In-memory stand-in for the `_JLPT_EVENTS` tab. MOCK ONLY: passing tests against this class
 * says nothing about real Google Sheets behaviour (see execution_plan §10-9).
 */
export class MockSheetsAdapter implements RemoteEventLog {
  readonly isMock = true as const;
  rows: string[][] = [];
  private queue: MockFailure[] = [];
  appendCalls = 0;
  failNext(...f: MockFailure[]): void { this.queue.push(...f); }

  private maybeFailBefore(): MockFailure | undefined {
    const f = this.queue[0];
    if (!f || f === "LOST_RESPONSE") return undefined;
    this.queue.shift();
    if (f === "OFFLINE") throw new GoogleError("OFFLINE", "network");
    const status = { HTTP_5XX: 503, HTTP_429: 429, HTTP_401: 401, HTTP_403: 403, HTTP_404: 404 }[f];
    throw mapHttpError(status, null, "write");
  }

  async appendEvents(events: SyncEvent[]): Promise<AppendRange> {
    this.appendCalls++;
    this.maybeFailBefore();
    const first = this.rows.length + 1;
    for (const e of events) this.rows.push(toRow(e));
    const range = { firstRow: first, lastRow: this.rows.length };
    if (this.queue[0] === "LOST_RESPONSE") { this.queue.shift(); throw new GoogleError("OFFLINE", "response lost after the write was applied"); }
    return range;
  }
  async readEventRows(firstRow: number, lastRow: number): Promise<SyncEvent[]> {
    this.maybeFailBefore();
    return this.rows.slice(firstRow - 1, lastRow).map(fromRow);
  }
  async readEventsAfter(rowCursor: number, limit: number) {
    this.maybeFailBefore();
    const slice = this.rows.slice(rowCursor, rowCursor + limit);
    return { events: slice.map(fromRow), nextCursor: rowCursor + slice.length };
  }
  async rowCount(): Promise<number> { return this.rows.length; }
}
