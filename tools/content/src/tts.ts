import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Segment } from "../../../shared/audio";

// TTS provider interface (execution_plan §5.1). Engines: `google` (Cloud Text-to-Speech, default),
// `macos-say` (offline, local QA only, NOT for publishing). Adding another engine = implementing TtsProvider.
export type TtsSegment = Segment;
export interface TtsRequest { segments: Segment[]; speed?: number }
export interface TtsResult { mp3: Uint8Array; durationMs: number; engine: string; voice: string; speed: number }
export interface TtsProvider {
  readonly engine: string;
  /** label stored in `audio.voice` and hashed into the audio key */
  readonly voiceLabel: string;
  synthesize(req: TtsRequest): Promise<TtsResult>;
  /** Cheap configuration check used by content:doctor (no billable synthesis). */
  check(): Promise<{ ok: boolean; detail: string }>;
}

export class TtsError extends Error { constructor(readonly kind: "AUTH" | "QUOTA" | "BAD_REQUEST" | "TOOL" | "OTHER", message: string) { super(message); } }

/* ---------- MP3 helpers ---------- */

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Duration of an MP3 by walking its frame headers (ID3v2 skipped). Returns 0 when no frame is found. */
export function mp3DurationMs(buf: Uint8Array): number {
  let i = 0;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) i = 10 + (((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f));
  let samples = 0, rate = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1]! >> 3) & 3, layer = (buf[i + 1]! >> 1) & 3;
    const br = buf[i + 2]! >> 4, sr = (buf[i + 2]! >> 2) & 3, pad = (buf[i + 2]! >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) { i++; continue; }
    const mpeg1 = ver === 3;
    const kbps = (mpeg1 ? BITRATES_V1_L3 : BITRATES_V2_L3)[br]!;
    const hz = RATES[ver]![sr]!;
    const len = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / hz) + pad;
    rate = hz; samples += mpeg1 ? 1152 : 576;
    i += len;
  }
  return rate ? Math.round((samples / rate) * 1000) : 0;
}

/** Valid, silent MPEG-1 Layer III audio (for tests and fixtures): 128 kbps, 44.1 kHz, `frames` frames of ~26 ms. */
export function silentMp3(frames: number): Uint8Array {
  const out = new Uint8Array(frames * 417);
  for (let f = 0; f < frames; f++) { out[f * 417] = 0xff; out[f * 417 + 1] = 0xfb; out[f * 417 + 2] = 0x90; out[f * 417 + 3] = 0x00; }
  return out;
}
export const concatBytes = (parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/* ---------- Google Cloud Text-to-Speech ---------- */

export type TtsFetch = (url: string, init: { method: string; headers?: Record<string, string>; body?: string }) => Promise<{ status: number; text(): Promise<string> }>;
interface GVoice { name: string; ssmlGender: "MALE" | "FEMALE" | "SSML_VOICE_GENDER_UNSPECIFIED" | "NEUTRAL"; languageCodes: string[] }
const FAMILY_ORDER = ["Neural2", "Wavenet", "Standard"];
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const ssmlFor = (seg: Segment): string => {
  const body = seg.reading && seg.reading !== seg.text ? `<sub alias="${esc(seg.reading)}">${esc(seg.text)}</sub>` : esc(seg.text);
  const pause = seg.pauseMs && seg.pauseMs > 0 ? `<break time="${Math.min(10000, Math.round(seg.pauseMs))}ms"/>` : "";
  return `<speak>${body}${pause}</speak>`;
};

export class GoogleTts implements TtsProvider {
  readonly engine = "google";
  voiceLabel = "ja-JP:auto";
  private voices?: Record<"M" | "F" | "N", string>;
  constructor(private o: { apiKey: string; fetch?: TtsFetch; voices?: Partial<Record<"M" | "F" | "N", string>>; base?: string }) {
    if (o.voices?.M && o.voices.F) { this.voices = { M: o.voices.M, F: o.voices.F, N: o.voices.N ?? o.voices.F }; this.voiceLabel = `ja-JP:${this.voices.M}/${this.voices.F}/${this.voices.N}`; }
  }
  private get http(): TtsFetch { return this.o.fetch ?? ((u, i) => fetch(u, i) as ReturnType<TtsFetch>); }
  private url(path: string) { return `${this.o.base ?? "https://texttospeech.googleapis.com"}/v1/${path}`; }

  private async call(path: string, method: "GET" | "POST", body?: unknown): Promise<any> {
    if (!this.o.apiKey) throw new TtsError("AUTH", "GOOGLE_TTS_API_KEY is not set");
    const sep = path.includes("?") ? "&" : "?";
    const res = await this.http(`${this.url(path)}${sep}key=${encodeURIComponent(this.o.apiKey)}`, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let j: any = null; try { j = text ? JSON.parse(text) : null; } catch { /* not json */ }
    if (res.status === 200) return j;
    const msg = String(j?.error?.message ?? text).slice(0, 200).replace(this.o.apiKey, "***");
    if (res.status === 400 && /API key not valid/i.test(msg)) throw new TtsError("AUTH", `API key is not valid: ${msg}`);
    if (res.status === 403) throw new TtsError("AUTH", `access denied (enable the Cloud Text-to-Speech API and check key restrictions): ${msg}`);
    if (res.status === 429) throw new TtsError("QUOTA", `quota exceeded: ${msg}`);
    throw new TtsError(res.status === 400 ? "BAD_REQUEST" : "OTHER", `HTTP ${res.status}: ${msg}`);
  }

  /** Picks one male and one female ja-JP voice from the account's list (best family first), unless names were configured. */
  async resolveVoices(): Promise<Record<"M" | "F" | "N", string>> {
    if (this.voices) return this.voices;
    const j = await this.call("voices?languageCode=ja-JP", "GET");
    const list = ((j?.voices ?? []) as GVoice[]).filter((v) => v.languageCodes?.includes("ja-JP"));
    const pick = (g: GVoice["ssmlGender"], skip: string[] = []) => {
      for (const fam of FAMILY_ORDER) { const v = list.filter((x) => x.ssmlGender === g && x.name.includes(fam) && !skip.includes(x.name)).sort((a, b) => a.name.localeCompare(b.name))[0]; if (v) return v.name; }
      return list.filter((x) => x.ssmlGender === g && !skip.includes(x.name)).sort((a, b) => a.name.localeCompare(b.name))[0]?.name;
    };
    const M = pick("MALE"), F = pick("FEMALE");
    if (!M || !F) throw new TtsError("OTHER", "no male and female ja-JP voice available for this key");
    const N = pick("FEMALE", [F]) ?? pick("MALE", [M]) ?? F;
    this.voices = { M, F, N };
    this.voiceLabel = `ja-JP:${M}/${F}/${N}`;
    return this.voices;
  }

  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const v = await this.resolveVoices();
    const speed = req.speed ?? 1;
    const parts: Uint8Array[] = [];
    for (const seg of req.segments) {
      const ssml = ssmlFor(seg);
      if (new TextEncoder().encode(ssml).length > 5000) throw new TtsError("BAD_REQUEST", "a segment exceeds the 5,000-byte request limit");
      const j = await this.call("text:synthesize", "POST", { input: { ssml }, voice: { languageCode: "ja-JP", name: v[seg.speaker] }, audioConfig: { audioEncoding: "MP3", speakingRate: speed } });
      if (typeof j?.audioContent !== "string") throw new TtsError("OTHER", "response has no audioContent");
      parts.push(Uint8Array.from(Buffer.from(j.audioContent, "base64")));
    }
    const mp3 = concatBytes(parts);
    return { mp3, durationMs: mp3DurationMs(mp3), engine: this.engine, voice: this.voiceLabel, speed };
  }

  async check() {
    if (!this.o.apiKey) return { ok: false, detail: "GOOGLE_TTS_API_KEY is not set (only needed for listening audio, v2.0.0)" };
    try { const v = await this.resolveVoices(); return { ok: true, detail: `key accepted; voices male=${v.M}, female=${v.F}` }; }
    catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
}

/* ---------- macOS `say` + ffmpeg (offline, local QA only) ---------- */

const run = (cmd: string, args: string[]): Promise<void> => new Promise((resolve, reject) => {
  const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  let err = ""; p.stderr.on("data", (d) => (err += d));
  p.on("error", (e) => reject(new TtsError("TOOL", `${cmd}: ${e.message}`)));
  p.on("close", (c) => (c === 0 ? resolve() : reject(new TtsError("TOOL", `${cmd} exited ${c}: ${err.slice(-200)}`))));
});

/** Offline engine for local checks only. Apple voices are not meant for redistribution: do NOT publish this audio. */
export class MacSayTts implements TtsProvider {
  readonly engine = "macos-say";
  readonly voiceLabel: string;
  constructor(private voice = "Kyoko") { this.voiceLabel = `say:${voice}`; }
  async synthesize(req: TtsRequest): Promise<TtsResult> {
    const dir = mkdtempSync(join(tmpdir(), "say-"));
    try {
      const speed = req.speed ?? 1;
      const list: string[] = [];
      for (const [i, seg] of req.segments.entries()) {
        const aiff = join(dir, `s${i}.aiff`), wav = join(dir, `s${i}.wav`);
        await run("say", ["-v", this.voice, "-r", String(Math.round(170 * speed)), "-o", aiff, "--", seg.reading || seg.text]);
        await run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "24000", "-ac", "1", wav]);
        list.push(wav);
        if (seg.pauseMs && seg.pauseMs > 0) {
          const sil = join(dir, `p${i}.wav`);
          await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", String(seg.pauseMs / 1000), sil]);
          list.push(sil);
        }
      }
      writeFileSync(join(dir, "list.txt"), list.map((f) => `file '${f}'`).join("\n"));
      const out = join(dir, "out.mp3");
      await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-c:a", "libmp3lame", "-b:a", "48k", out]);
      const mp3 = new Uint8Array(readFileSync(out));
      return { mp3, durationMs: mp3DurationMs(mp3), engine: this.engine, voice: this.voiceLabel, speed };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  async check() {
    try { await run("say", ["-v", this.voice, "-o", join(tmpdir(), "say-check.aiff"), "x"]); await run("ffmpeg", ["-version"]); return { ok: true, detail: `${this.voice} voice and ffmpeg found (local QA engine only)` }; }
    catch (e) { return { ok: false, detail: (e as Error).message }; }
  }
}

export class UnconfiguredTts implements TtsProvider {
  readonly engine = "google";
  readonly voiceLabel = "ja-JP:auto";
  constructor(private key: string | undefined) {}
  async synthesize(): Promise<TtsResult> { throw new TtsError("AUTH", "GOOGLE_TTS_API_KEY is not set"); }
  async check() { return this.key ? { ok: true, detail: "GOOGLE_TTS_API_KEY is set" } : { ok: false, detail: "GOOGLE_TTS_API_KEY is not set (only needed for listening audio, v2.0.0)" }; }
}

export function makeTts(engine: string, env: Record<string, string>, cfg?: { voices?: Partial<Record<"M" | "F" | "N", string>>; macVoice?: string }): TtsProvider {
  if (engine === "macos-say") return new MacSayTts(cfg?.macVoice);
  if (engine === "google") return new GoogleTts({ apiKey: env.GOOGLE_TTS_API_KEY ?? "", voices: cfg?.voices });
  throw new Error(`unknown TTS engine "${engine}" (google | macos-say)`);
}
