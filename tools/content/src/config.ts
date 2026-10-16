import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, readJson } from "./util";
import type { ProviderKind, RoleConfig } from "./llm/types";
import { ApiProvider } from "./llm/api";
import { HeadlessProvider } from "./llm/headless";
import type { LlmProvider } from "./llm/types";

export interface ContentConfig {
  maxUsdPerRun: number;
  maxCallsPerRun: number;
  llm: { generate: RoleConfig; verify: RoleConfig };
  headless: { concurrency: number; timeoutMs: number; backoffMs: number };
  api: { concurrency: number };
  [k: string]: unknown;
}

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

export function loadConfig(root = REPO_ROOT): { config: ContentConfig; env: Record<string, string>; usedLocal: boolean } {
  const example = readJson<ContentConfig>(join(root, "config.local.example.json"));
  const localPath = join(root, "config.local.json");
  const local = existsSync(localPath) ? readJson<Partial<ContentConfig>>(localPath) : {};
  const config = { ...example, ...local, llm: { ...example.llm, ...(local.llm ?? {}) }, headless: { ...example.headless, ...(local.headless ?? {}) }, api: { ...example.api, ...(local.api ?? {}) } } as ContentConfig;
  const envPath = join(root, ".env.local");
  const fileEnv = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
  // The key may also come from the process environment; real values are never printed.
  const env = { ...fileEnv, ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}), ...(process.env.GOOGLE_TTS_API_KEY ? { GOOGLE_TTS_API_KEY: process.env.GOOGLE_TTS_API_KEY } : {}) };
  return { config, env, usedLocal: existsSync(localPath) };
}

export function makeProvider(kind: ProviderKind, config: ContentConfig, env: Record<string, string>, root = REPO_ROOT): LlmProvider {
  if (kind === "api") return new ApiProvider({ apiKey: env.ANTHROPIC_API_KEY ?? "" });
  return new HeadlessProvider({ cwd: join(root, "content", ".headless-cwd"), timeoutMs: config.headless.timeoutMs });
}

export const roleConcurrency = (c: ContentConfig, kind: ProviderKind): number => (kind === "api" ? c.api.concurrency : c.headless.concurrency);
