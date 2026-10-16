import { describe, expect, it } from "vitest";
import { loadModel } from "../../app/src/state";
import { DEFAULT_SETTINGS } from "../../app/src/domain/settings";
import { createEvent, type SyncEvent } from "../../app/src/storage/events";
import { SEED_PACK } from "../../app/src/content/seed";

function bigLog(n: number): SyncEvent[] {
  const ids = SEED_PACK.items.map((r) => r.contentId);
  const out: SyncEvent[] = [];
  const t0 = Date.parse("2026-10-01T00:00:00Z");
  for (let i = 0; i < n; i++) {
    const id = ids[i % ids.length]!;
    const at = new Date(t0 + i * 20000);
    const day = at.toISOString().slice(0, 10);
    const k = i % 4;
    const type = k === 0 ? "QUESTION_PRESENTED" : k === 1 ? "QUESTION_SUBMITTED" : k === 2 ? "CARD_REVIEWED" : "STUDY_INTERVAL_COMPLETED";
    const payload = type === "QUESTION_PRESENTED" ? { contentId: id, exposureType: "PRACTICE", stimulusId: null, order: ["a", "b", "c", "d"] }
      : type === "QUESTION_SUBMITTED" ? { contentId: id, exposureType: "PRACTICE", isCorrect: i % 3 !== 0, selectedChoiceId: "a", order: ["a", "b", "c", "d"], elapsedActiveMs: 9000 }
      : type === "CARD_REVIEWED" ? { contentId: id, direction: "MEANING", correct: i % 3 !== 0, retry: false, dayKey: day, elapsedActiveMs: 9000 }
      : { dayKey: day, activity: "STUDY", seconds: 60 };
    out.push(createEvent({ profileId: "p", deviceId: "d", deviceSeq: i + 1, type: type as never, entityId: id, payload, now: at }));
  }
  return out;
}
const storageWith = (events: SyncEvent[]) => ({ store: { listEvents: async () => events.map((event) => ({ event, status: "ACKED" })), listContent: async () => [] }, pendingCount: async () => 0 }) as never;

describe("large event logs", () => {
  for (const n of [1000, 20000, 100000]) {
    it(`loadModel on ${n} events`, async () => {
      const ev = bigLog(n);
      const t = performance.now();
      const m = await loadModel(storageWith(ev), DEFAULT_SETTINGS, new Date("2026-12-01T00:00:00Z"));
      const ms = performance.now() - t;
      console.log(`events=${n} loadModel=${ms.toFixed(0)}ms`);
      expect(m.events.length).toBe(n);
    }, 120000);
  }
});
