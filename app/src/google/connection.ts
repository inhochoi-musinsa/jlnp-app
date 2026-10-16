import type { Pack } from "../../../shared/pack";
import { computeContentHash } from "../../../shared/schema";
import { SyncCoordinator, type SyncStatus } from "../storage/sync";
import type { AppStorage } from "../storage/session";
import type { RuntimeMode } from "../runtime";
import { GoogleError, MSG } from "./errors";
import { inspect, initialize, pullContent, type Inspection } from "./init";
import { SheetsClient, SheetsEventLog, type HttpFetch } from "./sheets";
import { parseSpreadsheetUrl } from "./url";
import { writeContent } from "./contentSync";
import { SHEET_HEADERS, SHEET_TABS } from "../../../shared/sheetSchema";
import type { ContentRecord } from "../../../shared/schema";

export type ConnState =
  | { kind: "LOCAL_FILE"; message: string }
  | { kind: "NO_CLIENT_ID" }
  | { kind: "DISCONNECTED"; hintUrl?: string }
  | { kind: "AWAITING_URL" }
  | { kind: "NEEDS_INIT"; inspection: Inspection }
  | { kind: "READY" }
  | { kind: "ERROR"; code: string; message: string };

export interface ConnectionDeps {
  mode: RuntimeMode;
  clientId: string;
  storage: AppStorage;
  seed: Pack;
  requestToken: (clientId: string) => Promise<{ token: string; expiresAt: number }>;
  http?: HttpFetch;
  onChange: () => void;
  sleep?: (ms: number) => Promise<void>;
  onRemoteEvents?: (n: number) => void;
}

const BINDING_KEY = "sheetBinding";
interface Binding { spreadsheetId: string; sheetInstanceId?: string }

/** Owns the Google token (memory only), the bound sheet and the sync coordinator. */
export class ConnectionManager {
  state: ConnState;
  sync?: SyncCoordinator;
  syncStatus?: SyncStatus;
  private token: string | null = null;
  private client?: SheetsClient;
  private binding?: Binding;
  private pendingRef?: { spreadsheetId: string };

  constructor(private d: ConnectionDeps) {
    this.state = d.mode === "LOCAL_FILE" ? { kind: "LOCAL_FILE", message: MSG.LOCAL_FILE } : !d.clientId ? { kind: "NO_CLIENT_ID" } : { kind: "DISCONNECTED" };
  }

  private set(s: ConnState): void { this.state = s; this.d.onChange(); }
  private fail(e: unknown): void {
    if (e instanceof GoogleError) { this.set({ kind: "ERROR", code: e.code, message: e.message }); return; }
    this.set({ kind: "ERROR", code: "UNKNOWN", message: e instanceof Error ? e.message : String(e) });
  }

  async load(hintUrl?: string): Promise<void> {
    this.binding = await this.d.storage.store.getMeta<Binding>(BINDING_KEY);
    if (this.state.kind === "DISCONNECTED") this.set({ kind: "DISCONNECTED", hintUrl: hintUrl });
  }
  get bound(): boolean { return !!this.binding; }
  get hasToken(): boolean { return !!this.token; }

  /** "Google 계정으로 연결": must be called from a click. */
  async connect(): Promise<void> {
    if (this.state.kind === "LOCAL_FILE" || this.state.kind === "NO_CLIENT_ID") return;
    try {
      const t = await this.d.requestToken(this.d.clientId);
      this.token = t.token;
      if (this.binding) { await this.open(this.binding.spreadsheetId); return; }
      this.set({ kind: "AWAITING_URL" });
    } catch (e) { this.fail(e); }
  }

  /** User pasted a link. Reads only; nothing is written until the user approves initialisation. */
  async submitUrl(url: string): Promise<void> {
    const ref = parseSpreadsheetUrl(url);
    if (!ref) { this.set({ kind: "ERROR", code: "BAD_URL", message: MSG.BAD_URL }); return; }
    await this.open(ref.spreadsheetId);
  }

  private makeClient(id: string): SheetsClient { return new SheetsClient(id, () => this.token, this.d.http); }

  private async open(spreadsheetId: string): Promise<void> {
    try {
      this.client = this.makeClient(spreadsheetId);
      this.pendingRef = { spreadsheetId };
      const ins = await inspect(this.client);
      if (ins.state === "FOREIGN") { this.set({ kind: "ERROR", code: "FOREIGN_TABS", message: MSG.FOREIGN_TABS }); return; }
      if (ins.state === "NEW_SCHEMA") { this.set({ kind: "ERROR", code: "NEW_SCHEMA", message: MSG.NEW_SCHEMA }); return; }
      if (ins.state === "READY" || (ins.state === "PARTIAL" && ins.missingTabs.length === 0 && ins.sheetInstanceId)) { await this.adoptAndStart(ins); return; }
      this.set({ kind: "NEEDS_INIT", inspection: ins });
    } catch (e) { this.fail(e); }
  }

  /** The user approved "이 시트에 _JLPT_* 전용 탭을 생성합니다. 기존 탭은 수정하지 않습니다". */
  async confirmInit(): Promise<void> {
    if (this.state.kind !== "NEEDS_INIT" || !this.client) return;
    try {
      const ins = this.state.inspection;
      const mismatch = ins.ownerProfileId && ins.ownerProfileId !== this.d.storage.profileId;
      if (mismatch) { await this.adoptAndStart(ins); return; }
      await initialize(this.client, ins, { profileId: this.d.storage.profileId, seed: this.d.seed });
      await this.start((await inspect(this.client)));
    } catch (e) { this.fail(e); }
  }

  private async adoptAndStart(ins: Inspection): Promise<void> {
    const st = this.d.storage;
    if (ins.ownerProfileId && ins.ownerProfileId !== st.profileId) {
      if (!(await st.isPristine())) throw new GoogleError("PROFILE_MISMATCH", MSG.PROFILE_MISMATCH);
      await st.adoptProfile(ins.ownerProfileId); // new device joining an existing sheet
    }
    // A partially initialised sheet (same owner) is completed before use.
    if (ins.state === "PARTIAL") await initialize(this.client!, ins, { profileId: st.profileId, seed: this.d.seed });
    await this.start(await inspect(this.client!));
  }

  private async start(ins: Inspection): Promise<void> {
    const st = this.d.storage;
    this.binding = { spreadsheetId: this.pendingRef!.spreadsheetId, sheetInstanceId: ins.sheetInstanceId };
    const first = !(await st.store.getMeta(BINDING_KEY));
    await st.store.setMeta(BINDING_KEY, this.binding);
    if (first) await st.record("SHEET_BOUND", "sheet", { sheetInstanceId: ins.sheetInstanceId ?? null });
    this.sync = new SyncCoordinator(st.store, new SheetsEventLog(this.client!), {
      sleep: this.d.sleep, onStatus: (s) => { this.syncStatus = s; this.d.onChange(); },
      onRemoteEvents: (evs) => this.d.onRemoteEvents?.(evs.length),
    });
    st.onRecorded = () => { void this.sync?.notifyChanged(); };
    this.set({ kind: "READY" });
    await this.syncNow("manual");
    try { await this.pushLocalContent(); } catch { /* reported by the next sync; local content stays */ }
  }

  async syncNow(reason: "manual" | "hidden" | "end" | "interval" | "threshold" = "manual"): Promise<void> {
    if (!this.sync) return;
    await this.sync.flush(reason);
    await this.pullContentRows();
    this.d.onChange();
  }

  /** §4.7: only rows added since the stored row cursor are read, 500 per request. */
  async pullContentRows(): Promise<number> {
    if (!this.client) return 0;
    const st = this.d.storage;
    try {
      const cursor = (await st.store.getMeta<number>("contentRowCursor")) ?? 0;
      const { records, nextCursor } = await pullContent(this.client, cursor);
      const good = records.filter((r) => computeContentHash(r) === r.contentHash);
      if (good.length) await st.store.putContent(good);
      await st.store.setMeta("contentRowCursor", nextCursor);
      return good.length;
    } catch (e) {
      // Transient problems (expired token, offline, quota) are reported by the sync status; they must not
      // flip the whole connection into an error state.
      if (e instanceof GoogleError && ["NEEDS_AUTH", "OFFLINE", "RATE_LIMIT", "UNSURE"].includes(e.code)) {
        if (e.code === "NEEDS_AUTH" && this.sync) { this.syncStatus = { ...(this.syncStatus ?? { pending: 0, remoteCursor: 0 }), state: "NEEDS_AUTH", code: "NEEDS_AUTH", message: e.message }; this.d.onChange(); }
        return 0;
      }
      this.fail(e);
      return 0;
    }
  }

  /** Writes imported content to `_JLPT_CONTENT` (idempotent, 200 rows per request, paced). */
  async pushContent(records: ContentRecord[], pack: { packId: string; packVersion: string }, manifest?: unknown): Promise<{ written: number; skipped: number }> {
    if (!this.client || this.state.kind !== "READY") return { written: 0, skipped: 0 };
    const c = this.client;
    const prog = await writeContent(c, records, pack, { sleep: this.d.sleep });
    const at = new Date().toISOString();
    const have = await c.readRange(SHEET_TABS.PACKS, 2, 5000, 2);
    if (!have.some((r) => r[0] === pack.packId && r[1] === pack.packVersion)) {
      await c.appendRows(SHEET_TABS.PACKS, [[pack.packId, pack.packVersion, "", "SELF_ATTESTED", "TRUE", at, JSON.stringify(manifest ?? {}), ""]], SHEET_HEADERS.PACKS.length);
    }
    const total = (await c.readRange(SHEET_TABS.CONTENT, 2, 200000, 1)).length;
    const v = JSON.stringify(total);
    await c.appendRows(SHEET_TABS.META, [["contentRowCount", v, at, ""]], SHEET_HEADERS.META.length);
    return { written: prog.written, skipped: prog.skipped };
  }

  /** Content imported while the app was not connected goes to the sheet once it is. */
  private async pushLocalContent(): Promise<void> {
    const local = await this.d.storage.store.listContent();
    if (local.length) await this.pushContent(local, { packId: "local-import", packVersion: "1.0.0" });
  }

  /** Token expired (401): ask for a new one; the outbox stays untouched. */
  async reconnect(): Promise<void> {
    try {
      const t = await this.d.requestToken(this.d.clientId);
      this.token = t.token;
      if (this.state.kind === "ERROR" && this.binding) { await this.open(this.binding.spreadsheetId); return; }
      this.set({ kind: this.sync ? "READY" : "AWAITING_URL" } as ConnState);
      await this.syncNow("manual");
    } catch (e) { this.fail(e); }
  }

  /** Forget the token and the binding hint. The sheet, its events and the local cache are NOT deleted. */
  async disconnect(): Promise<void> {
    this.token = null; this.sync = undefined; this.client = undefined;
    this.d.storage.onRecorded = undefined;
    this.binding = undefined;
    await this.d.storage.store.setMeta(BINDING_KEY, undefined);
    this.set({ kind: "DISCONNECTED" });
  }
}
