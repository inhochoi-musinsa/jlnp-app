import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmResponse, ProviderKind } from "./llm/types";

const here = dirname(fileURLToPath(import.meta.url));
export interface PriceRow { inputPerMTok: number; outputPerMTok: number; cacheWrite5mPerMTok?: number; cacheReadPerMTok?: number; overPromptTokens?: number; inputPerMTokOver?: number; outputPerMTokOver?: number; alias?: string }
export const loadPricing = (): Record<string, PriceRow> => JSON.parse(readFileSync(resolve(here, "../pricing.json"), "utf8")).models;

export function priceFor(model: string, table = loadPricing()): PriceRow | undefined {
  return table[model] ?? Object.values(table).find((r) => r.alias === model);
}

export function costUsd(model: string, usage: { inputTokens: number; outputTokens: number; cacheCreationTokens?: number; cacheReadTokens?: number }, table = loadPricing()): number | undefined {
  const p = priceFor(model, table);
  if (!p) return undefined;
  const over = p.overPromptTokens !== undefined && usage.inputTokens > p.overPromptTokens;
  const inP = over ? p.inputPerMTokOver ?? p.inputPerMTok : p.inputPerMTok;
  const outP = over ? p.outputPerMTokOver ?? p.outputPerMTok : p.outputPerMTok;
  return (usage.inputTokens * inP + usage.outputTokens * outP + (usage.cacheCreationTokens ?? 0) * (p.cacheWrite5mPerMTok ?? p.inputPerMTok) + (usage.cacheReadTokens ?? 0) * (p.cacheReadPerMTok ?? p.inputPerMTok)) / 1e6;
}

export class BudgetExceeded extends Error {
  constructor(readonly reason: "USD" | "CALLS" | "TIME", message: string) { super(message); }
}

export interface Limits { maxUsd?: number; maxCalls?: number; deadlineMs?: number }

/** Tracks calls and spend. API spend is computed from tokens; headless cost is reference-only. */
export class BudgetTracker {
  calls = 0;
  usd = 0;
  referenceUsd = 0;
  unknownPrice = false;
  private started = Date.now();
  constructor(private limits: Limits, private now: () => number = Date.now) { this.started = now(); }

  /** Call before every LLM request. */
  check(): void {
    if (this.limits.maxCalls !== undefined && this.calls >= this.limits.maxCalls) throw new BudgetExceeded("CALLS", `call limit ${this.limits.maxCalls} reached`);
    if (this.limits.maxUsd !== undefined && this.usd >= this.limits.maxUsd) throw new BudgetExceeded("USD", `USD limit ${this.limits.maxUsd} reached (spent ~${this.usd.toFixed(4)})`);
    if (this.limits.deadlineMs !== undefined && this.now() - this.started > this.limits.deadlineMs) throw new BudgetExceeded("TIME", "time limit reached");
  }

  record(kind: ProviderKind, model: string, r: LlmResponse): void {
    this.calls++;
    if (kind === "api" && r.usage) {
      const c = costUsd(r.resolvedModel ?? model, r.usage);
      if (c === undefined) this.unknownPrice = true; else this.usd += c;
    }
    if (kind === "headless" && r.reportedCostUsd !== undefined) this.referenceUsd += r.reportedCostUsd;
  }

  summary() { return { calls: this.calls, usd: Number(this.usd.toFixed(6)), referenceUsd: Number(this.referenceUsd.toFixed(6)), unknownPrice: this.unknownPrice }; }
}
