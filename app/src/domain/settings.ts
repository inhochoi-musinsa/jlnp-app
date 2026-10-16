import { DEFAULT_TARGET_LEVEL, isLevel, type Level } from "../../../shared/examSpec";

export const FONT_SCALES = ["S", "M", "L", "XL"] as const;
export type FontScale = (typeof FONT_SCALES)[number];
export const FURIGANA_MODES = ["ALWAYS", "STUDY_ONLY", "HIDDEN"] as const;
export type FuriganaMode = (typeof FURIGANA_MODES)[number];
export const THEMES = ["SYSTEM", "LIGHT", "DARK"] as const;
export type Theme = (typeof THEMES)[number];

export interface UserSettings {
  fontScale: FontScale;
  furiganaMode: FuriganaMode;
  theme: Theme;
  targetLevel: Level;
  /** Practise UNVERIFIED content too (never used for assessment). */
  includeUnverified: boolean;
  /** how often a listening item may be played while practising */
  practiceReplays: "UNLIMITED" | "ONCE";
  /** play with the browser's Japanese voice when the audio file is missing (practice only) */
  browserTtsFallback: boolean;
  defaultTimed: false; // time limit is never on by default (UX invariant 1)
  dailyBudgetMinutes: 60;
  timezone: "Asia/Seoul";
}

export const DEFAULT_SETTINGS: UserSettings = {
  fontScale: "M", furiganaMode: "STUDY_ONLY", theme: "SYSTEM", targetLevel: DEFAULT_TARGET_LEVEL, includeUnverified: false, practiceReplays: "UNLIMITED", browserTtsFallback: true,
  defaultTimed: false, dailyBudgetMinutes: 60, timezone: "Asia/Seoul",
};

export const FONT_PX: Record<FontScale, number> = { S: 15, M: 17, L: 19, XL: 22 };

export function sanitizeSettings(raw: unknown): UserSettings {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed as readonly unknown[]).includes(v) ? (v as T) : d;
  return {
    ...DEFAULT_SETTINGS,
    fontScale: pick(r.fontScale, FONT_SCALES, DEFAULT_SETTINGS.fontScale),
    furiganaMode: pick(r.furiganaMode, FURIGANA_MODES, DEFAULT_SETTINGS.furiganaMode),
    theme: pick(r.theme, THEMES, DEFAULT_SETTINGS.theme),
    targetLevel: isLevel(r.targetLevel) ? r.targetLevel : DEFAULT_SETTINGS.targetLevel,
    includeUnverified: r.includeUnverified === true,
    practiceReplays: r.practiceReplays === "ONCE" ? "ONCE" : "UNLIMITED",
    browserTtsFallback: r.browserTtsFallback !== false,
  };
}

type Listener = (s: UserSettings, changedKeys: (keyof UserSettings)[]) => void;

/** In-memory settings with optional best-effort persistence. Event/outbox wiring comes with T04. */
export class SettingsStore {
  private value: UserSettings;
  private listeners = new Set<Listener>();
  constructor(initial?: unknown, private persist?: (s: UserSettings) => void) {
    this.value = sanitizeSettings(initial);
  }
  get(): UserSettings { return this.value; }
  set(patch: Partial<UserSettings>): void {
    const next = sanitizeSettings({ ...this.value, ...patch });
    const changed = (Object.keys(next) as (keyof UserSettings)[]).filter((k) => next[k] !== this.value[k]);
    if (!changed.length) return;
    this.value = next;
    this.persist?.(next);
    this.listeners.forEach((l) => l(next, changed));
  }
  subscribe(l: Listener): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
}
