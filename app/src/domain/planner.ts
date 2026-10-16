import type { Route } from "./diagnostic";

export const DOMAINS = ["KANA", "VOCAB", "GRAMMAR", "READING", "LISTENING"] as const;
export type PlanDomain = (typeof DOMAINS)[number];
export type Alloc = Record<PlanDomain, number>;

/** plan.md §4.3 default split by route (minutes). `[실무 제안]` */
export const BASE_SPLIT: Record<Route, Alloc> = {
  KANA_FOUNDATION: { KANA: 10, VOCAB: 15, GRAMMAR: 20, READING: 5, LISTENING: 10 },
  FOUNDATION: { KANA: 0, VOCAB: 20, GRAMMAR: 20, READING: 10, LISTENING: 10 },
  TARGET_FOCUS: { KANA: 0, VOCAB: 20, GRAMMAR: 15, READING: 15, LISTENING: 10 },
};

export const DOMAIN_LABEL: Record<PlanDomain, string> = { KANA: "가나", VOCAB: "어휘·한자", GRAMMAR: "문법", READING: "독해", LISTENING: "청해" };
/** Deterministic tie-break for leftover minutes (plan.md §4.3 item 7). */
const TIE_ORDER: PlanDomain[] = ["LISTENING", "READING", "GRAMMAR", "VOCAB", "KANA"];

export interface PlanInput {
  route: Route;
  /** Seconds already studied today (diagnostics, quizzes ...). */
  activeSecondsToday: number;
  dailyBudgetMinutes?: number;
  /** Which domains have usable, unseen content right now. */
  available: Record<PlanDomain, boolean>;
  /** Optional ceiling in minutes per domain (how much unseen content exists). Infinity when unknown. */
  capacityMinutes?: Partial<Record<PlanDomain, number>>;
}

export interface Plan {
  route: Route;
  availableMinutes: number;
  allocation: Alloc;
  totalMinutes: number;
  /** Domains skipped because they have no content; shown to the user and NEVER counted as done. */
  excluded: PlanDomain[];
  /** true when less than the available time could be planned (not enough content). */
  underfilled: boolean;
}

/** Largest-remainder distribution of `total` over positive weights with per-key caps. */
function distribute(total: number, weights: Alloc, caps: Alloc): Alloc {
  const out: Alloc = { KANA: 0, VOCAB: 0, GRAMMAR: 0, READING: 0, LISTENING: 0 };
  let left = total;
  let active = DOMAINS.filter((d) => weights[d] > 0 && caps[d] > 0);
  while (left > 0 && active.length) {
    const wsum = active.reduce((a, d) => a + weights[d], 0);
    const raw = active.map((d) => ({ d, exact: (left * weights[d]) / wsum }));
    const give: Alloc = { KANA: 0, VOCAB: 0, GRAMMAR: 0, READING: 0, LISTENING: 0 };
    let used = 0;
    for (const r of raw) { give[r.d] = Math.min(Math.floor(r.exact), caps[r.d] - out[r.d]); used += give[r.d]; }
    let rest = left - used;
    const byRemainder = [...raw].sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || TIE_ORDER.indexOf(a.d) - TIE_ORDER.indexOf(b.d));
    for (const r of byRemainder) { if (rest <= 0) break; if (out[r.d] + give[r.d] < caps[r.d]) { give[r.d]++; rest--; } }
    let progressed = false;
    for (const d of DOMAINS) { if (give[d] > 0) { out[d] += give[d]; progressed = true; } }
    left = rest;
    active = active.filter((d) => out[d] < caps[d]);
    if (!progressed) break;
  }
  return out;
}

export function makePlan(i: PlanInput): Plan {
  const budget = i.dailyBudgetMinutes ?? 60;
  const availableMinutes = Math.max(0, Math.floor(Math.max(0, budget * 60 - Math.max(0, i.activeSecondsToday)) / 60));
  const base = BASE_SPLIT[i.route];
  const excluded = DOMAINS.filter((d) => base[d] > 0 && !i.available[d]);
  // Scale the base split to the time left today, then move minutes of excluded domains to the others.
  const weights: Alloc = { KANA: 0, VOCAB: 0, GRAMMAR: 0, READING: 0, LISTENING: 0 };
  const caps: Alloc = { KANA: 0, VOCAB: 0, GRAMMAR: 0, READING: 0, LISTENING: 0 };
  for (const d of DOMAINS) {
    const usable = i.available[d];
    weights[d] = usable ? base[d] : 0;
    caps[d] = usable ? Math.floor(i.capacityMinutes?.[d] ?? Infinity) : 0;
    if (!Number.isFinite(caps[d])) caps[d] = availableMinutes;
  }
  const allocation = distribute(availableMinutes, weights, caps);
  const totalMinutes = DOMAINS.reduce((a, d) => a + allocation[d], 0);
  return { route: i.route, availableMinutes, allocation, totalMinutes, excluded, underfilled: totalMinutes < availableMinutes };
}
