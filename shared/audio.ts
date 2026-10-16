import { canonicalJSON } from "./normalize";
import { sha256Hex } from "./hash";

export interface Segment { speaker: "M" | "F" | "N"; text: string; reading?: string; pauseMs?: number }
export interface AudioRef { key: string; source: "GENERATED_FILE" | "RECORDED" | "BROWSER_TTS"; engine: string; voice: string; speed: number }

/** audioKey = first 16 hex chars of sha256(segments + engine + voice + speed) (execution_plan §5.1). */
export function audioKeyFor(segments: Segment[], engine: string, voice: string, speed: number): string {
  const segs = segments.map((s) => ({ speaker: s.speaker, text: s.text, reading: s.reading ?? null, pauseMs: s.pauseMs ?? 0 }));
  return sha256Hex(canonicalJSON({ segments: segs, engine, voice, speed })).slice(0, 16);
}

export const scriptHash = (segments: Segment[]): string => sha256Hex(canonicalJSON(segments.map((s) => ({ speaker: s.speaker, text: s.text, pauseMs: s.pauseMs ?? 0 }))));
export const scriptText = (segments: Segment[]): string => segments.map((s) => s.text).join("\n");
export const AUDIO_KEY_RE = /^[0-9a-f]{16}$/;
export const audioPath = (key: string) => `audio/${key}.mp3`;
export const overridePath = (contentId: string) => `audio/overrides/${contentId.replace(/[^A-Za-z0-9_-]/g, "_")}.mp3`;

export const SOURCE_LABEL: Record<AudioRef["source"], string> = { GENERATED_FILE: "TTS 음원 파일", RECORDED: "사람 녹음", BROWSER_TTS: "브라우저 음성(실시간)" };
export const TTS_LIMIT_NOTICE = "TTS 음원 기반(실제 시험 음성과 억양·속도·잡음이 다를 수 있음)";
