import { createEvent, replayOrder, uuid, type SyncEvent } from "./events";
import type { LocalStore } from "./interface";
import { MemoryStore, openBestStore, type StorageProbe } from "./local";
import { sanitizeSettings, type UserSettings } from "../domain/settings";
import type { EventType } from "../../../shared/sheetSchema";

/** App-level façade: identity (profile/device), event recording, projections. */
export class AppStorage {
  profileId = "";
  deviceId = "";
  /** Called after every committed local event (the app wires this to the sync coordinator). */
  onRecorded?: (e: SyncEvent) => void;
  private seq = 0;
  private constructor(readonly store: LocalStore, readonly probe: StorageProbe) {}

  static async init(factory?: IDBFactory | null): Promise<AppStorage> {
    const opened = factory === null ? { store: new MemoryStore(), probe: { kind: "memory" as const, reason: "disabled" } } : await openBestStore(factory ?? undefined);
    const s = new AppStorage(opened.store, opened.probe);
    s.deviceId = (await s.store.getMeta<string>("deviceId")) ?? uuid();
    await s.store.setMeta("deviceId", s.deviceId);
    s.seq = (await s.store.getMeta<number>("deviceSeq")) ?? 0;
    const existing = await s.store.getMeta<string>("profileId");
    if (existing) s.profileId = existing;
    else {
      s.profileId = uuid();
      await s.store.setMeta("profileId", s.profileId);
      await s.record("PROFILE_CREATED", s.profileId, { locale: "ko" });
    }
    return s;
  }

  private metaWrite: Promise<void> = Promise.resolve();
  get persistent(): boolean { return this.store.kind === "indexeddb"; }

  /** Resolves only after the local commit. Callers must not show "saved" earlier. */
  async record(type: EventType, entityId: string, payload: unknown): Promise<SyncEvent> {
    // the sequence number and timestamp are taken synchronously, so concurrent record() calls keep their call order
    const seq = ++this.seq;
    const now = new Date();
    const e = createEvent({ profileId: this.profileId, deviceId: this.deviceId, deviceSeq: seq, type, entityId, payload, now });
    this.metaWrite = this.metaWrite.then(() => this.store.setMeta("deviceSeq", seq));
    await this.metaWrite;
    await this.store.appendEvent(e);
    this.onRecorded?.(e);
    return e;
  }

  /** True while the device holds nothing but the automatic first-run events (safe to join another profile). */
  async isPristine(): Promise<boolean> {
    return (await this.store.listEvents()).every((s) => s.event.type === "PROFILE_CREATED" || s.event.type === "SETTINGS_UPDATED" || s.event.type === "SHEET_BOUND");
  }

  /** Joins the profile stored in the sheet (new device). Drops the throw-away first-run events. */
  async adoptProfile(profileId: string): Promise<void> {
    if (profileId === this.profileId) return;
    const keepMeta = { deviceId: this.deviceId, deviceSeq: this.seq };
    const content = await this.store.listContent();
    await this.store.clearAll();
    await this.store.setMeta("deviceId", keepMeta.deviceId);
    await this.store.setMeta("deviceSeq", keepMeta.deviceSeq);
    await this.store.putContent(content);
    this.profileId = profileId;
    await this.store.setMeta("profileId", profileId);
  }

  async pendingCount(): Promise<number> { return (await this.store.listPending()).length; }

  async projectSettings(): Promise<UserSettings | null> {
    const evs = (await this.store.listEvents()).map((s) => s.event).filter((e) => e.type === "SETTINGS_UPDATED").sort(replayOrder);
    const last = evs[evs.length - 1];
    return last ? sanitizeSettings(JSON.parse(last.payloadJson)) : null;
  }
}
