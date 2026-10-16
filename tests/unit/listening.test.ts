import { describe, expect, it } from "vitest";
import { checkDictation, diffChars, eligibleForAssessment, fileUrlFor, overrideUrlFor } from "../../app/src/domain/listening";
import { ListeningPlayer } from "../../app/src/ui/audio";

describe("dictation check", () => {
  it("ignores spaces and punctuation, exact kana otherwise", () => {
    expect(checkDictation("としょかん", " としょ かん。").correct).toBe(true);
    expect(checkDictation("としょかん", "としょうかん").correct).toBe(false);
  });
  it("reports a hiragana/katakana mix-up separately", () => {
    const r = checkDictation("りんご", "リンゴ");
    expect(r.correct).toBe(false);
    expect(r.scriptOnly).toBe(true);
  });
  it("diff marks missing and extra characters", () => {
    const d = diffChars("としょかん", "としょうかん");
    expect(d.filter((x) => x.kind === "extra").map((x) => x.text).join("")).toBe("う");
    expect(diffChars("あい", "あ").some((x) => x.kind === "missing" && x.text === "い")).toBe(true);
  });
});

describe("audio source rules", () => {
  it("browser TTS never counts for assessment unless the learner allows it", () => {
    expect(eligibleForAssessment("BROWSER_TTS", false)).toBe(false);
    expect(eligibleForAssessment("GENERATED_FILE", false)).toBe(true);
    expect(eligibleForAssessment("RECORDED", false)).toBe(true);
  });
  it("urls: override path is separate from the generated file", () => {
    expect(fileUrlFor("0123456789abcdef")).toBe("./audio/0123456789abcdef.mp3");
    expect(overrideUrlFor("lis:abc")).toBe("./audio/overrides/lis_abc.mp3");
  });
});

describe("ListeningPlayer (no DOM audio: injected deps)", () => {
  const item = { listeningId: "lis:x", ref: { key: "0123456789abcdef", source: "GENERATED_FILE" as const, engine: "e", voice: "v", speed: 1 }, segments: [{ speaker: "F" as const, text: "あ" }], taskType: "POINT" };
  const fakeAudio = () => { const a: any = { pause() {}, async play() { a.onplaying?.(); a.onended?.(); } }; return a as HTMLAudioElement; };
  it("override recording wins over the generated file and plays are limited", async () => {
    const seen: string[] = [];
    const p = new ListeningPlayer(item, "lis:x", { maxPlays: 1, allowBrowserTts: false, deps: { exists: async (u) => u.includes("overrides"), createAudio: () => { const a = fakeAudio(); Object.defineProperty(a, "src", { set: (v: string) => seen.push(v), get: () => "" }); return a; } } });
    await p.play();
    expect(seen).toEqual(["./audio/overrides/lis_x.mp3"]);
    expect(p.source).toBe("RECORDED");
    expect(p.plays).toBe(1);
    expect(p.canPlay).toBe(false);
    await p.play();
    expect(p.plays).toBe(1);
  });
  it("generated file used when no override; unlimited replays", async () => {
    const p = new ListeningPlayer(item, "lis:x", { maxPlays: null, allowBrowserTts: false, deps: { exists: async () => false, createAudio: fakeAudio } });
    await p.play(); await p.play();
    expect(p.source).toBe("GENERATED_FILE");
    expect(p.plays).toBe(2);
  });
});

import { mergeListeningRevision } from "../../tools/content/src/verify";
import { audioKeyFor } from "../../shared/audio";
describe("listening revision keeps audio and links consistent", () => {
  const segs = [{ speaker: "F" as const, text: "元の文です。" }];
  const orig = { taskType: "POINT", segments: segs, questionId: "q:abc", audio: { key: audioKeyFor(segs, "macos-say", "say:Kyoko", 1), source: "GENERATED_FILE", engine: "macos-say", voice: "say:Kyoko", speed: 1 } };
  it("ignores audio/questionId from the model and recomputes the key from the new script", () => {
    const ns = [{ speaker: "M" as const, text: "新しい文です。" }];
    const r = mergeListeningRevision(orig, { segments: ns, audio: { key: "", voices: {} }, questionId: "q:evil" });
    expect(r.questionId).toBe("q:abc");
    expect(r.audio.key).toBe(audioKeyFor(ns, "macos-say", "say:Kyoko", 1));
    expect(r.audio.key).toMatch(/^[0-9a-f]{16}$/);
    expect(r.audio.voices).toBeUndefined();
  });
  it("keeps the old script when the model returns none", () => {
    expect(mergeListeningRevision(orig, {}).audio.key).toBe(orig.audio.key);
  });
});
