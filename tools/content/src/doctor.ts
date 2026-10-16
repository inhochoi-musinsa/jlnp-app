import { spawnSync } from "node:child_process";
import type { ContentConfig } from "./config";
import { makeProvider } from "./config";
import type { LlmProvider, ProviderKind } from "./llm/types";
import { LlmError } from "./llm/types";
import { makeTts } from "./tts";

export interface DoctorLine { name: string; ok: boolean; detail: string; fix?: string }

async function ping(p: LlmProvider, model: string): Promise<DoctorLine["ok"] extends boolean ? { ok: boolean; detail: string; resolved?: string } : never> {
  try {
    const r = await p.complete({ prompt: 'Reply with the JSON {"ok":true} and nothing else.', model });
    return { ok: /ok/.test(r.text), detail: `answered in model ${r.resolvedModel ?? "(unknown)"}${r.resolved ? "" : " (not resolved)"}`, resolved: r.resolvedModel };
  } catch (e) {
    return { ok: false, detail: e instanceof LlmError ? `${e.kind}: ${e.message}` : String(e) };
  }
}

export async function doctor(config: ContentConfig, env: Record<string, string>, makeP = (k: ProviderKind) => makeProvider(k, config, env)): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = [];
  // api
  if (!env.ANTHROPIC_API_KEY) lines.push({ name: "api", ok: false, detail: "ANTHROPIC_API_KEY is not set", fix: "Put the key in .env.local (API mode only)." });
  else {
    const r = await ping(makeP("api"), config.llm.verify.provider === "api" ? config.llm.verify.model : "claude-haiku-5-5");
    lines.push({ name: "api", ok: r.ok, detail: r.detail, fix: r.ok ? undefined : "Check the key, the console spend limit and network." });
  }
  // headless
  const v = spawnSync("claude", ["--version"], { encoding: "utf8" });
  if (v.error || v.status !== 0) lines.push({ name: "headless", ok: false, detail: "`claude` command not found", fix: "Install Claude Code, open a new terminal and check `claude -v`." });
  else {
    const results: string[] = [];
    let okAll = true;
    for (const model of new Set([config.llm.generate.model, config.llm.verify.model])) {
      const r = await ping(makeP("headless"), model);
      okAll &&= r.ok;
      results.push(`${model}: ${r.ok ? "ok" : "FAIL"} (${r.detail})`);
    }
    lines.push({ name: "headless", ok: okAll, detail: `claude ${v.stdout.trim()}; ${results.join("; ")}`, fix: okAll ? undefined : "Run `claude` once to log in, or wait and retry if a usage limit was hit." });
  }
  const tcfg = (config as unknown as { tts?: { engine?: string } }).tts ?? {};
  const tts = await makeTts(tcfg.engine ?? "google", env).check();
  lines.push({ name: "tts", ok: tts.ok, detail: tts.detail, fix: tts.ok ? undefined : "Needed only for listening audio: enable Cloud Text-to-Speech, create an API key, put it in .env.local." });
  const gen = config.llm.generate, ver = config.llm.verify;
  lines.push({ name: "roles", ok: gen.model !== ver.model, detail: `generate=${gen.provider}:${gen.model}  verify=${ver.provider}:${ver.model}`, fix: gen.model === ver.model ? "Generator and verifier models must differ." : undefined });
  return lines;
}
