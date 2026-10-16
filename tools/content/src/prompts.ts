import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../prompts");

export interface Prompt { name: string; version: number; body: string }

export function loadPrompt(name: string): Prompt {
  const raw = readFileSync(join(dir, name + ".md"), "utf8");
  const m = /^version:\s*(\d+)\s*\n---\n([\s\S]*)$/.exec(raw);
  if (!m) throw new Error(`prompt ${name}: missing "version: N" header`);
  return { name, version: Number(m[1]), body: m[2]!.trim() };
}

export function render(p: Prompt, vars: Record<string, string | number | undefined>): string {
  const withCommon = p.body.replace("{{common}}", () => loadPrompt("_common").body);
  return withCommon.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    const v = vars[k];
    if (v === undefined) throw new Error(`prompt ${p.name}: missing variable ${k}`);
    return String(v);
  });
}

export const promptVersion = (names: string[]): string => names.map((n) => `${n}@${loadPrompt(n).version}`).join(",");
