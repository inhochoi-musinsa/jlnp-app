import { BudgetExceeded, type BudgetTracker } from "../budget";
import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./types";

export interface CallOptions {
  budget?: BudgetTracker;
  maxParseRetries?: number;      // default 2 (execution_plan §4.3.1 rule 4)
  maxRateRetries?: number;       // default 4
  backoffMs?: number;            // base for exponential backoff, default 30000
  sleep?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** One request with budget accounting and rate-limit backoff. */
export async function callWithBackoff(p: LlmProvider, req: LlmRequest, o: CallOptions = {}): Promise<LlmResponse> {
  const sleep = o.sleep ?? realSleep;
  const maxRate = o.maxRateRetries ?? 4;
  for (let attempt = 0; ; attempt++) {
    o.budget?.check();
    try {
      const res = await p.complete(req);
      o.budget?.record(p.kind, req.model, res);
      return res;
    } catch (e) {
      if (e instanceof BudgetExceeded) throw e;
      if (e instanceof LlmError && e.kind === "RATE_LIMIT" && attempt < maxRate) {
        const wait = e.retryAfterMs ?? (o.backoffMs ?? 30000) * 2 ** attempt;
        o.log?.(`rate limited, waiting ${Math.round(wait / 1000)}s (attempt ${attempt + 1}/${maxRate})`);
        await sleep(wait);
        continue;
      }
      if (e instanceof LlmError && e.kind === "TIMEOUT" && attempt < 1) { o.log?.("timeout, retrying once"); continue; }
      throw e;
    }
  }
}

/** Extracts the first JSON value from text (handles ```json fences and chatter around it). */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [text.trim(), fence?.[1]?.trim() ?? ""];
  for (const c of candidates) { if (!c) continue; try { return JSON.parse(c); } catch { /* try next */ } }
  const start = text.search(/[\[{]/);
  if (start >= 0) {
    for (let end = text.length; end > start; end--) {
      const ch = text[end - 1];
      if (ch !== "}" && ch !== "]") continue;
      try { return JSON.parse(text.slice(start, end)); } catch { /* shrink */ }
    }
  }
  throw new LlmError("BAD_RESPONSE", "no JSON found in response");
}

/** Request -> parse -> validate, re-asking the same request up to maxParseRetries times. */
export async function callJson<T>(p: LlmProvider, req: LlmRequest, validate: (v: unknown) => T, o: CallOptions = {}): Promise<{ value: T; response: LlmResponse }> {
  const retries = o.maxParseRetries ?? 2;
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    const response = await callWithBackoff(p, req, o);
    try { return { value: validate(extractJson(response.text)), response }; }
    catch (e) { lastErr = e; o.log?.(`response parse/validate failed (${i + 1}/${retries + 1}): ${(e as Error).message}`); }
  }
  throw new LlmError("BAD_RESPONSE", `invalid response after ${retries + 1} attempts: ${(lastErr as Error).message}`);
}
