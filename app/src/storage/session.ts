import { createEvent, replayOrder, uuid, type SyncEvent } from "./events";
import type { LocalStore } from "./interface";
import { MemoryStore, openBestStore, type StorageProbe } from "./local";
import { sanitizeSettings, type UserSettings } from "../domain/settings";
import type { EventType } from "../../../shared/sheetSchema";

/** App-level façade: identity (profile/device), event recording, projections. */
export class AppStorage {
  profileId = "";
  deviceId = "";
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

  get persistent(): boolean { return this.store.kind === "indexeddb"; }

  /** Resolves only after the local commit. Callers must not show "saved" earlier. */
  async record(type: EventType, entityId: string, payload: unknown): Promise<SyncEvent> {
    this.seq++;
    await this.store.setMeta("deviceSeq", this.seq);
    const e = createEvent({ profileId: this.profileId, deviceId: this.deviceId, deviceSeq: this.seq, type, entityId, payload });
    await this.store.appendEvent(e);
    return e;
  }

  async pendingCount(): Promise<number> { return (await this.store.listPending()).length; }

  async projectSettings(): Promise<UserSettings | null> {
    const evs = (await this.store.listEvents()).map((s) => s.event).filter((e) => e.type === "SETTINGS_UPDATED").sort(replayOrder);
    const last = evs[evs.length - 1];
    return last ? sanitizeSettings(JSON.parse(last.payloadJson)) : null;
  }
}
