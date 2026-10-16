import { describe, expect, it, vi } from "vitest";
import { ApiProvider, type FetchLike } from "../../tools/content/src/llm/api";
import { HeadlessProvider, type SpawnLike } from "../../tools/content/src/llm/headless";
import { callJson, callWithBackoff, extractJson } from "../../tools/content/src/llm/call";
import { BudgetExceeded, BudgetTracker } from "../../tools/content/src/budget";
import { LlmError, type LlmProvider } from "../../tools/content/src/llm/types";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Reply = { kind: "ok"; text: string } | { kind: "limit" } | { kind: "auth" };

/** Builds a provider whose transport replays the scripted replies. Same script for both implementations. */
function apiWith(script: Reply[]): LlmProvider {
  const f: FetchLike = async () => {
    const r = script.shift()!;
    const hdr = { get: (n: string) => (n === "retry-after" ? null : null) };
    if (r.kind === "limit") return { status: 429, headers: hdr, text: async () => "{}" };
    if (r.kind === "auth") return { status: 401, headers: hdr, text: async () => "{}" };
    return { status: 200, headers: hdr, text: async () => JSON.stringify({ model: "claude-sonnet-5-5", content: [{ type: "text", text: r.text }], usage: { input_tokens: 100, output_tokens: 20 } }) };
  };
  return new ApiProvider({ apiKey: "test-key", fetch: f });
}
function headlessWith(script: Reply[]): LlmProvider {
  const sp: SpawnLike = async () => {
    const r = script.shift()!;
    if (r.kind === "limit") return { code: 1, stdout: JSON.stringify({ is_error: true, result: "5-hour usage limit reached" }), stderr: "" };
    if (r.kind === "auth") return { code: 1, stdout: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }), stderr: "" };
    return { code: 0, stdout: JSON.stringify({ is_error: false, result: r.text, modelUsage: { "claude-sonnet-5-5": {} }, usage: { input_tokens: 100, output_tokens: 20 }, total_cost_usd: 0.01 }), stderr: "" };
  };
  return new HeadlessProvider({ cwd: join(mkdtempSync(join(tmpdir(), "hl-")), "cwd"), spawn: sp });
}

const impls: [string, (s: Reply[]) => LlmProvider][] = [["api", apiWith], ["headless", headlessWith]];

describe.each(impls)("LlmProvider contract: %s", (_n, make) => {
  const req = { prompt: "x", model: "sonnet" };
  const validate = (v: unknown) => { if (typeof v !== "object" || !v || !("ok" in v)) throw new Error("no ok"); return v as { ok: boolean }; };

  it("returns text and the model that actually answered", async () => {
    const p = make([{ kind: "ok", text: '{"ok":true}' }]);
    const r = await p.complete(req);
    expect(JSON.parse(r.text)).toEqual({ ok: true });
    expect(r.resolvedModel).toBe("claude-sonnet-5-5");
    expect(r.resolved).toBe(true);
  });

  it("re-asks on unparsable JSON (max 2 retries) and then succeeds", async () => {
    const p = make([{ kind: "ok", text: "sorry, here you go" }, { kind: "ok", text: "```json\n{broken" }, { kind: "ok", text: 'Sure:\n```json\n{"ok":true}\n```' }]);
    const { value } = await callJson(p, req, validate);
    expect(value.ok).toBe(true);
  });

  it("fails with BAD_RESPONSE after 3 invalid answers", async () => {
    const p = make([{ kind: "ok", text: "no" }, { kind: "ok", text: "no" }, { kind: "ok", text: "no" }]);
    await expect(callJson(p, req, validate)).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
  });

  it("backs off on usage-limit errors with growing waits, then continues", async () => {
    const p = make([{ kind: "limit" }, { kind: "limit" }, { kind: "ok", text: '{"ok":true}' }]);
    const waits: number[] = [];
    const r = await callWithBackoff(p, req, { sleep: async (ms) => { waits.push(ms); }, backoffMs: 1000 });
    expect(JSON.parse(r.text).ok).toBe(true);
    expect(waits).toEqual([1000, 2000]);
  });

  it("gives up when the limit never clears (maxRateRetries)", async () => {
    const p = make(Array.from({ length: 6 }, () => ({ kind: "limit" as const })));
    await expect(callWithBackoff(p, req, { sleep: async () => {}, maxRateRetries: 2, backoffMs: 1 })).rejects.toMatchObject({ kind: "RATE_LIMIT" });
  });

  it("auth errors are not retried", async () => {
    const p = make([{ kind: "auth" }, { kind: "ok", text: "{}" }]);
    await expect(callWithBackoff(p, req, { sleep: async () => {} })).rejects.toMatchObject({ kind: "AUTH" });
  });

  it("the call budget stops further requests", async () => {
    const p = make([{ kind: "ok", text: '{"ok":true}' }, { kind: "ok", text: '{"ok":true}' }, { kind: "ok", text: '{"ok":true}' }]);
    const budget = new BudgetTracker({ maxCalls: 2 });
    await callWithBackoff(p, req, { budget });
    await callWithBackoff(p, req, { budget });
    await expect(callWithBackoff(p, req, { budget })).rejects.toBeInstanceOf(BudgetExceeded);
    expect(budget.calls).toBe(2);
  });
});

describe("transport specifics", () => {
  it("api: USD is computed from tokens and enforced", async () => {
    const p = apiWith(Array.from({ length: 3 }, () => ({ kind: "ok" as const, text: "{}" })));
    const budget = new BudgetTracker({ maxUsd: 0.0001 });
    await callWithBackoff(p, { prompt: "x", model: "claude-sonnet-5-5" }, { budget });
    expect(budget.usd).toBeGreaterThan(0);
    await expect(callWithBackoff(p, { prompt: "x", model: "claude-sonnet-5-5" }, { budget })).rejects.toMatchObject({ reason: "USD" });
  });
  it("headless: fixed safe flags, fresh session, prompt via stdin, cost is reference only", async () => {
    let seen: { args: string[]; input: string; cwd: string } | undefined;
    const sp: SpawnLike = async (_c, args, o) => { seen = { args, input: o.input, cwd: o.cwd }; return { code: 0, stdout: JSON.stringify({ is_error: false, result: "{}", total_cost_usd: 0.4 }), stderr: "" }; };
    const dir = join(mkdtempSync(join(tmpdir(), "hl-")), "empty");
    const p = new HeadlessProvider({ cwd: dir, spawn: sp });
    const budget = new BudgetTracker({});
    const r = await callWithBackoff(p, { prompt: "PROMPT", model: "opus", schema: { type: "object" } }, { budget });
    expect(seen!.args).toEqual(expect.arrayContaining(["-p", "--output-format", "json", "--tools", "", "--no-session-persistence", "--safe-mode", "--model", "opus", "--json-schema"]));
    expect(seen!.args).not.toContain("--resume");
    expect(seen!.args).not.toContain("--continue");
    expect(seen!.input).toBe("PROMPT");
    expect(seen!.cwd).toBe(dir);
    expect(r.resolved).toBe(false); // no modelUsage reported -> alias only
    expect(budget.usd).toBe(0);
    expect(budget.referenceUsd).toBeCloseTo(0.4);
  });
  it("headless: missing binary gives an actionable error", async () => {
    const p = new HeadlessProvider({ cwd: join(mkdtempSync(join(tmpdir(), "hl-")), "c"), spawn: async () => ({ code: 127, stdout: "", stderr: "spawn claude ENOENT" }) });
    await expect(p.complete({ prompt: "x", model: "sonnet" })).rejects.toThrow(/not found/);
  });
  it("extractJson handles fences and surrounding prose", () => {
    expect(extractJson('text {"a":1} tail')).toEqual({ a: 1 });
    expect(extractJson("```json\n[1,2]\n```")).toEqual([1, 2]);
    expect(() => extractJson("nothing")).toThrow(LlmError);
  });
});

describe("switching providers needs no code change", () => {
  it("makeProvider picks the implementation from config only", async () => {
    const { makeProvider } = await import("../../tools/content/src/config");
    const { config } = (await import("../../tools/content/src/config")).loadConfig();
    expect(makeProvider("api", config, { ANTHROPIC_API_KEY: "k" }).kind).toBe("api");
    expect(makeProvider("headless", config, {}).kind).toBe("headless");
  });
});
