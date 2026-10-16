import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig, makeProvider, roleConcurrency } from "./config";
import { BudgetExceeded, BudgetTracker } from "./budget";
import { catalog } from "./catalog";
import { doctor } from "./doctor";
import { estimate } from "./estimate";
import { genCommand, ledgerCommand, packCommand, readPack, runDir, sampleCommand, verifyCommand, type RunEnv } from "./run";
import { Ledger } from "./ledger";
import { runSeed } from "./seed";
import { fill } from "./fill";
import { allListening, synthesizeAll, updatePackAudioManifest } from "./audio";
import { makeTts } from "./tts";
import { makePlan, planEstimate, type Progress } from "./plan";
import { CONTENT_DIR, REPO_ROOT, ensureDir, readJson, writeJson } from "./util";
import { DEFAULT_TARGET_LEVEL, isLevel, type Level } from "../../../shared/examSpec";
import { KINDS, POOLS, type Kind, type Pool } from "../../../shared/schema";
import { checkPackIntegrity } from "../../../shared/pack";
import type { ProviderKind } from "./llm/types";

export function parseArgs(argv: string[]): { cmd: string; flags: Record<string, string | true> } {
  const [cmd = "", ...rest] = argv;
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) continue;
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) flags[a.slice(2)] = true; else { flags[a.slice(2)] = next; i++; }
  }
  return { cmd, flags };
}

const HELP = `content CLI
  doctor                                   check Claude (api/headless) and TTS setup
  catalog [--level L]                      shortfall vs the long-term target
  gen --kind K --count N [--level L] [--pool P] [--topic T] [--domain D] [--type TASK|POINT|OVERVIEW|UTTERANCE|RESPONSE|DICTATION] [--tts-engine E] [--provider api|headless] [--max-usd X] [--max-calls N] [--dry-run]
  verify --run ID | --pack FILE            run V1..V6 (resumes an interrupted run)
  pack --run ID --out FILE [--version X]   bundle VERIFIED items
  ledger --from-pack FILE                  rebuild the duplicate ledger from a full export
  sample [--n 20]                          markdown sample for manual spot checks
  plan --progress FILE --days N [--level L] next generation plan from the app's progress.json -> content/plan.json
  fill --days N [--max-usd X | --max-calls N] [--provider api|headless] [--dry-run] [--only GROUP,...] [--plan FILE] [--progress FILE]
                                           gen -> verify -> pack for everything the plan needs; re-run resumes
  audio --pack FILE | --all-missing [--engine google|macos-say] [--dry-run]
                                           synthesise LISTENING scripts to audio/<key>.mp3 (existing files are kept)
  seed [--dry-run] [--max-calls N]         generate/verify/pack the built-in seed set (app/seed)`;

function buildEnv(flags: Record<string, string | true>): RunEnv {
  const { config, env } = loadConfig();
  const gp = (flags.provider as ProviderKind | undefined) ?? config.llm.generate.provider;
  const vp = (flags.provider as ProviderKind | undefined) ?? config.llm.verify.provider;
  const budget = new BudgetTracker({
    maxUsd: flags["max-usd"] ? Number(flags["max-usd"]) : gp === "api" || vp === "api" ? config.maxUsdPerRun : undefined,
    maxCalls: flags["max-calls"] ? Number(flags["max-calls"]) : config.maxCallsPerRun,
  });
  return {
    generator: { provider: makeProvider(gp, config, env), model: config.llm.generate.model, concurrency: roleConcurrency(config, gp) },
    verifier: { provider: makeProvider(vp, config, env), model: config.llm.verify.model, concurrency: roleConcurrency(config, vp) },
    budget, log: (m) => console.error("[content]", m),
  };
}

export async function main(argv: string[]): Promise<number> {
  const { cmd, flags } = parseArgs(argv);
  const level = ((): Level => { const l = flags.level; if (typeof l === "string") { if (!isLevel(l)) throw new Error(`unknown level ${l}`); return l; } return DEFAULT_TARGET_LEVEL; })();
  try {
    switch (cmd) {
      case "doctor": {
        const { config, env, usedLocal } = loadConfig();
        console.log(usedLocal ? "config: config.local.json" : "config: defaults from config.local.example.json (config.local.json not found)");
        const lines = await doctor(config, env);
        for (const l of lines) console.log(`${l.ok ? "OK  " : "FAIL"} ${l.name}: ${l.detail}${l.fix ? `\n       -> ${l.fix}` : ""}`);
        const usable = lines.filter((l) => (l.name === "api" || l.name === "headless") && l.ok).map((l) => l.name);
        console.log(usable.length ? `usable Claude modes: ${usable.join(", ")}` : "no usable Claude mode: generation is BLOCKED(LLM)");
        return usable.length ? 0 : 1;
      }
      case "catalog": {
        const out = catalog(level, new Ledger());
        console.log(`catalog (${level}) -> content/catalog.json`);
        for (const r of out.rows) console.log(`  ${r.kind.padEnd(10)} have ${String(r.have).padStart(5)} / target ${String(r.target).padStart(5)}  missing ${r.missing}`);
        return 0;
      }
      case "gen": {
        const kind = String(flags.kind ?? "") as Kind;
        if (!(KINDS as readonly string[]).includes(kind)) throw new Error("--kind is required: " + KINDS.join("|"));
        const pool = String(flags.pool ?? "LEARN") as Pool;
        if (!(POOLS as readonly string[]).includes(pool)) throw new Error("--pool must be " + POOLS.join("|"));
        const count = Number(flags.count ?? 0);
        if (!count || count < 1) throw new Error("--count is required");
        const env = buildEnv(flags);
        const est = estimate({ kind, count, pool, gen: { provider: env.generator.provider.kind, model: env.generator.model }, verify: { provider: env.verifier.provider.kind, model: env.verifier.model } });
        console.log(`estimate: ${est.totalCalls} calls (generate ${est.genCalls} + verify ${est.verifyCalls})${est.usd !== undefined ? `, about $${est.usd.toFixed(2)} (API part)` : ""}`);
        console.log("assumptions: " + est.assumptions.join("; "));
        if (flags["dry-run"]) { console.log("dry-run: nothing generated."); return 0; }
        const tcfg = (loadConfig().config as unknown as { tts?: { engine?: string; speed?: number } }).tts ?? {};
        const ttsEngine = String(flags["tts-engine"] ?? tcfg.engine ?? "google");
        const label = ttsEngine === "macos-say" ? "say:Kyoko" : "ja-JP:auto";
        const r = await genCommand(env, { kind, level, count, pool, topic: flags.topic as string | undefined, domain: flags.domain as string | undefined, listeningType: flags.type as never, tts: { engine: ttsEngine, voice: label, speed: tcfg.speed ?? 1 } });
        console.log(`run ${r.runId}: ${r.written} drafts written (${r.calls} generation calls). Next: npm run content:verify -- --run ${r.runId}`);
        console.log("budget:", JSON.stringify(env.budget.summary()));
        return 0;
      }
      case "verify": {
        const env = buildEnv(flags);
        if (flags.pack) {
          const pack = readPack(String(flags.pack));
          const chk = checkPackIntegrity(pack);
          console.log(`pack ${pack.manifest.packId}: ${pack.items.length} items; integrity ${chk.fileErrors.length || chk.badHashItems.length ? "FAILED " + JSON.stringify(chk) : "ok"}`);
          return chk.fileErrors.length || chk.badHashItems.length ? 1 : 0;
        }
        const runId = String(flags.run ?? "");
        if (!runId || !existsSync(runDir(env, runId))) throw new Error("--run <runId> (existing run) or --pack <file> is required");
        const s = await verifyCommand(env, runId);
        console.log(`run ${runId}: verified ${s.verified}, unverified ${s.unverified}, rejected ${s.rejected}, duplicates ${s.duplicates}, pending ${s.pending}`);
        for (const r of s.results.filter((x) => x.outcome !== "VERIFIED")) console.log(`  ${r.outcome} ${r.id}: ${r.reason ?? ""}`);
        if (s.stoppedByBudget) console.log(`stopped: ${s.stoppedByBudget}. Run the same command again to continue.`);
        console.log("budget:", JSON.stringify(env.budget.summary()));
        return s.stoppedByBudget ? 2 : 0;
      }
      case "pack": {
        const env = buildEnv(flags);
        const runId = String(flags.run ?? "");
        const out = String(flags.out ?? "");
        if (!runId || !out) throw new Error("--run and --out are required");
        const r = packCommand(env, runId, out.startsWith("/") ? out : join(REPO_ROOT, out), { packVersion: flags.version as string | undefined });
        console.log(`pack ${r.pack.manifest.packId} v${r.pack.manifest.packVersion}: ${r.pack.items.length} items -> ${r.path}`);
        for (const d of r.dropped) console.log(`  dropped ${d.id}: ${d.why}`);
        return 0;
      }
      case "ledger": {
        const from = String(flags["from-pack"] ?? "");
        if (!from) throw new Error("--from-pack <file> is required");
        console.log(`ledger rebuilt: ${ledgerCommand(from)} entries`);
        return 0;
      }
      case "sample": {
        const env = buildEnv(flags);
        ensureDir(CONTENT_DIR);
        console.log("written:", sampleCommand(env, Number(flags.n ?? 20), join(CONTENT_DIR, "sample.md")));
        return 0;
      }
      case "plan": {
        const days = Number(flags.days ?? 28);
        const pf = flags.progress ? String(flags.progress) : undefined;
        if (pf && !existsSync(pf)) throw new Error(`progress file not found: ${pf}`);
        const progress = pf ? readJson<Progress>(pf) : undefined;
        if (progress && progress.format !== "jlpt-progress") throw new Error("not a progress.json exported by the app");
        const env = buildEnv(flags);
        const plan = makePlan({ level, days, progress, ledger: new Ledger() });
        writeJson(join(CONTENT_DIR, "plan.json"), plan);
        console.log(`plan (${level}, ${days} days) -> content/plan.json`);
        for (const s of plan.steps) console.log(`  ${s.group.padEnd(18)} ${s.kind.padEnd(8)} x${String(s.count).padStart(4)}${s.domain ? ` ${s.domain}` : ""}${s.topic ? ` [${s.topic}]` : ""}`);
        if (plan.emphasisTags.length) console.log("  extra weight on: " + plan.emphasisTags.map((e) => `${e.tag}(${e.wrong})`).join(", "));
        for (const n of plan.notes) console.log("  note: " + n);
        const e = planEstimate(plan, env).total;
        console.log(`  estimate: ${e.totalCalls} calls${e.usd !== undefined ? `, about $${e.usd.toFixed(2)} (API part)` : ""}`);
        return 0;
      }
      case "fill": {
        const env = buildEnv(flags);
        const only = typeof flags.only === "string" ? String(flags.only).split(",") : undefined;
        return await fill(env, { level, days: Number(flags.days ?? 28), dryRun: !!flags["dry-run"], only, planFile: typeof flags.plan === "string" ? String(flags.plan) : undefined, progressFile: typeof flags.progress === "string" ? String(flags.progress) : undefined });
      }
      case "audio": {
        const { config, env } = loadConfig();
        const tcfg = (config as unknown as { tts?: { engine?: string; voices?: Record<string, string>; macVoice?: string } }).tts ?? {};
        const engine = String(flags.engine ?? tcfg.engine ?? "google");
        const tts = makeTts(engine, env, { voices: tcfg.voices, macVoice: tcfg.macVoice });
        let records;
        if (typeof flags.pack === "string") records = readPack(String(flags.pack)).items;
        else if (flags["all-missing"]) records = allListening();
        else throw new Error("--pack <file> or --all-missing is required");
        const rep = await synthesizeAll(records, tts, { dryRun: !!flags["dry-run"], log: (m) => console.log(m) });
        console.log(`audio (${engine}): planned ${rep.planned}, synthesised ${rep.synthesized}, already present ${rep.skippedExisting}${rep.wrongEngine ? `, other engine ${rep.wrongEngine}` : ""}${rep.noAudioField ? `, without audio field ${rep.noAudioField}` : ""}${rep.keyMismatch ? `, key mismatch ${rep.keyMismatch}` : ""}; ${rep.chars} characters`);
        if (flags["dry-run"]) console.log("dry-run: nothing synthesised. Google TTS bills by characters (see tools/content/pricing.json).");
        if (typeof flags.pack === "string" && rep.manifest.length) updatePackAudioManifest(String(flags.pack), rep.manifest);
        for (const f of rep.failed) console.log(`FAILED ${f.key}: ${f.why}`);
        if (engine === "macos-say") console.log("note: macos-say audio is for local checks only; do not publish it.");
        return rep.failed.length ? 1 : 0;
      }
      case "seed": return await runSeed(buildEnv(flags), { dryRun: !!flags["dry-run"], level });
      default:
        console.log(HELP);
        return cmd ? 1 : 0;
    }
  } catch (e) {
    if (e instanceof BudgetExceeded) { console.error(`stopped: ${e.message}`); return 2; }
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && /cli\.ts$/.test(process.argv[1])) main(process.argv.slice(2)).then((c) => process.exit(c));
export { readJson, writeJson };
