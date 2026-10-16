import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audioKeyFor, scriptHash, type Segment } from "../../../shared/audio";
import type { AudioManifestEntry, Pack } from "../../../shared/pack";
import type { ContentRecord } from "../../../shared/schema";
import { TtsError, type TtsProvider } from "./tts";
import { REPO_ROOT, CONTENT_DIR, ensureDir, listJson, readJson, writeJson } from "./util";

export interface AudioJob { record: ContentRecord; key: string; segments: Segment[]; engine: string; voice: string; speed: number }
export interface AudioReport { planned: number; synthesized: number; skippedExisting: number; wrongEngine: number; noAudioField: number; keyMismatch: number; chars: number; failed: { key: string; why: string }[]; manifest: AudioManifestEntry[]; files: string[] }

/** LISTENING records that expect a generated file, with the key their `audio` field names. */
export function collectJobs(records: ContentRecord[]): { jobs: AudioJob[]; noAudioField: number; keyMismatch: number } {
  const jobs: AudioJob[] = [];
  let noAudioField = 0, keyMismatch = 0;
  const seen = new Set<string>();
  for (const r of records) {
    if (r.kind !== "LISTENING") continue;
    const a = r.payload.audio as { key: string; source: string; engine: string; voice: string; speed: number } | undefined;
    if (!a) { noAudioField++; continue; }
    if (a.source !== "GENERATED_FILE" || seen.has(a.key)) continue;
    const segments = r.payload.segments as Segment[];
    if (audioKeyFor(segments, a.engine, a.voice, a.speed) !== a.key) { keyMismatch++; continue; } // script changed after the key was set
    seen.add(a.key);
    jobs.push({ record: r, key: a.key, segments, engine: a.engine, voice: a.voice, speed: a.speed });
  }
  return { jobs, noAudioField, keyMismatch };
}

export const audioDir = (root = REPO_ROOT) => join(root, "audio");

/**
 * Synthesises every missing file `audio/<key>.mp3`. Existing files are never re-synthesised (same key = same script,
 * engine, voice and speed), so a re-run is free. Records whose expected engine differs from `tts.engine` are skipped.
 */
export async function synthesizeAll(records: ContentRecord[], tts: TtsProvider, o: { dir?: string; dryRun?: boolean; log?: (m: string) => void } = {}): Promise<AudioReport> {
  const dir = o.dir ?? audioDir();
  const log = o.log ?? (() => {});
  const { jobs, noAudioField, keyMismatch } = collectJobs(records);
  const rep: AudioReport = { planned: 0, synthesized: 0, skippedExisting: 0, wrongEngine: 0, noAudioField, keyMismatch, chars: 0, failed: [], manifest: [], files: [] };
  for (const j of jobs) {
    if (j.engine !== tts.engine) { rep.wrongEngine++; continue; }
    const file = join(dir, `${j.key}.mp3`);
    if (existsSync(file)) { rep.skippedExisting++; continue; }
    rep.planned++;
    rep.chars += j.segments.reduce((a, s) => a + s.text.length, 0);
    if (o.dryRun) continue;
    try {
      const r = await tts.synthesize({ segments: j.segments, speed: j.speed });
      ensureDir(dir);
      writeFileSync(file, r.mp3);
      rep.synthesized++; rep.files.push(file);
      rep.manifest.push({ audioKey: j.key, scriptHash: scriptHash(j.segments), engine: r.engine, voice: r.voice, speed: r.speed, durationMs: r.durationMs });
      log(`audio ${j.key}: ${(r.mp3.length / 1024).toFixed(1)} KiB, ${(r.durationMs / 1000).toFixed(1)} s`);
    } catch (e) {
      rep.failed.push({ key: j.key, why: (e as Error).message });
      if (e instanceof TtsError && (e.kind === "AUTH" || e.kind === "QUOTA")) { log(`stopped: ${e.message}`); break; }
    }
  }
  return rep;
}

/** Every LISTENING record in verified run folders and, optionally, in packs. */
export function allListening(contentDir = CONTENT_DIR, packsDir = join(REPO_ROOT, "packs")): ContentRecord[] {
  const out: ContentRecord[] = [];
  const runs = join(contentDir, "runs");
  if (existsSync(runs)) for (const r of readdirSync(runs)) for (const f of listJson(join(runs, r, "verified"))) { const rec = readJson<ContentRecord>(f); if (rec.kind === "LISTENING") out.push(rec); }
  if (existsSync(packsDir)) for (const f of readdirSync(packsDir).filter((x) => x.endsWith(".jlptpack.json"))) for (const rec of readJson<Pack>(join(packsDir, f)).items) if (rec.kind === "LISTENING") out.push(rec);
  return out;
}

/** Writes the audio manifest entries into the pack (manifestHash covers items only, so the pack stays valid). */
export function updatePackAudioManifest(packPath: string, entries: AudioManifestEntry[]): void {
  const pack = readJson<Pack>(packPath);
  const have = new Map(pack.audioManifest.map((e) => [e.audioKey, e]));
  for (const e of entries) have.set(e.audioKey, e);
  writeJson(packPath, { ...pack, audioManifest: [...have.values()] });
}
