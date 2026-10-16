import { SOURCE_LABEL, TTS_LIMIT_NOTICE, fileUrlFor, overrideUrlFor, type AudioSource } from "../domain/listening";
import type { QuizItem } from "../domain/quiz";
import { h } from "./dom";

export interface PlayerDeps {
  /** HEAD-style existence check (default: fetch). Resolves false when the file is missing or unreachable (e.g. file://). */
  exists?: (url: string) => Promise<boolean>;
  createAudio?: () => HTMLAudioElement;
  speech?: SpeechSynthesis | undefined;
}
export interface PlayerOptions { maxPlays: number | null; allowBrowserTts: boolean; deps?: PlayerDeps; onPlay?: (source: AudioSource, plays: number) => void; onChange?: () => void }

const defaultExists = async (url: string): Promise<boolean> => { try { return (await fetch(url, { method: "HEAD" })).ok; } catch { return false; } };
const SPEAKER = { M: "남", F: "여", N: "해설" } as const;

/**
 * One listening item. Nothing is downloaded before the learner presses play (preload "none").
 * Source order: recorded override (audio/overrides/<contentId>.mp3) > generated file (audio/<key>.mp3) > browser voice.
 */
export class ListeningPlayer {
  source: AudioSource | null = null;
  plays = 0;
  status: "idle" | "loading" | "playing" | "error" = "idle";
  message = "";
  maxPlays: number | null;
  private audio?: HTMLAudioElement;
  private deps: PlayerDeps;
  private panel?: HTMLElement;
  private speechTimer?: ReturnType<typeof setTimeout>;

  constructor(private item: NonNullable<QuizItem["audio"]>, private contentId: string, private o: PlayerOptions) {
    this.maxPlays = o.maxPlays;
    this.deps = o.deps ?? {};
  }

  get expectedSource(): AudioSource { return this.source ?? this.item.ref?.source ?? "BROWSER_TTS"; }
  get canPlay(): boolean { return this.status !== "playing" && this.status !== "loading" && (this.maxPlays === null || this.plays < this.maxPlays); }

  private changed(): void { this.refresh(); this.o.onChange?.(); }

  private async resolve(): Promise<{ src: string; source: AudioSource } | null> {
    const exists = this.deps.exists ?? defaultExists;
    if (await exists(overrideUrlFor(this.contentId))) return { src: overrideUrlFor(this.contentId), source: "RECORDED" };
    const ref = this.item.ref;
    if (ref && ref.source !== "BROWSER_TTS") return { src: fileUrlFor(ref.key), source: ref.source };
    return null;
  }

  async play(): Promise<void> {
    if (!this.canPlay) return;
    this.status = "loading"; this.message = ""; this.changed();
    const r = await this.resolve();
    if (r) {
      this.source = r.source;
      const a = this.audio ?? (this.deps.createAudio ? this.deps.createAudio() : new Audio());
      this.audio = a;
      a.preload = "none";
      a.onended = () => { this.status = "idle"; this.changed(); };
      a.onerror = () => { void this.fallback("음원 파일을 찾을 수 없습니다."); };
      a.onplaying = () => { this.plays++; this.status = "playing"; this.o.onPlay?.(r.source, this.plays); this.changed(); };
      a.src = r.src;
      try { await a.play(); } catch { /* onerror handles missing/unplayable files */ }
      return;
    }
    await this.fallback(this.item.ref ? "" : "이 항목에는 음원이 없습니다.");
  }

  /** Browser voice only when the learner allows it; otherwise say clearly that the file is missing. */
  private async fallback(reason: string): Promise<void> {
    const speech = this.deps.speech ?? (typeof speechSynthesis !== "undefined" ? speechSynthesis : undefined);
    if (this.o.allowBrowserTts && speech && typeof SpeechSynthesisUtterance !== "undefined") {
      this.source = "BROWSER_TTS";
      this.plays++; this.status = "playing"; this.o.onPlay?.("BROWSER_TTS", this.plays); this.changed();
      const lines = this.item.segments.map((s) => s.reading || s.text);
      let i = 0;
      const next = () => {
        if (i >= lines.length) { this.status = "idle"; this.changed(); return; }
        const u = new SpeechSynthesisUtterance(lines[i]!);
        u.lang = "ja-JP";
        const pause = this.item.segments[i]!.pauseMs ?? 300;
        u.onend = () => { i++; this.speechTimer = setTimeout(next, pause); };
        u.onerror = () => { this.status = "error"; this.message = "브라우저 음성을 재생하지 못했습니다."; this.changed(); };
        speech.speak(u);
      };
      next();
      return;
    }
    this.status = "error";
    this.message = `${reason || "음원을 재생할 수 없습니다."}${speech ? " 설정 > 고급에서 브라우저 음성 대체 재생을 켤 수 있습니다." : ""}`.trim();
    this.changed();
  }

  stop(): void {
    this.audio?.pause();
    if (this.speechTimer) clearTimeout(this.speechTimer);
    try { (this.deps.speech ?? (typeof speechSynthesis !== "undefined" ? speechSynthesis : undefined))?.cancel(); } catch { /* ignore */ }
  }

  /** The panel shown in place of a passage. It is re-rendered in place when the state changes. */
  render(): HTMLElement {
    this.panel = h("div", { class: "audio-panel", id: "audio-panel" });
    this.refresh();
    return this.panel;
  }

  private refresh(): void {
    const p = this.panel;
    if (!p) return;
    const limit = this.maxPlays === null ? "" : ` / ${this.maxPlays}`;
    const used = this.maxPlays !== null && this.plays >= this.maxPlays;
    const label = this.status === "playing" ? "재생 중…" : this.status === "loading" ? "불러오는 중…" : this.plays > 0 ? "다시 듣기" : "재생";
    const kids: (HTMLElement | null)[] = [
      h("button", { class: "primary big-play", type: "button", id: "play-audio", disabled: !this.canPlay, "aria-label": "음원 재생", onclick: () => { void this.play(); } }, label),
      h("p", { id: "audio-status", class: "muted", "aria-live": "polite" }, used ? `재생 횟수를 모두 사용했습니다 (${this.plays}${limit}회)` : `재생 ${this.plays}${limit}회`),
      h("p", { class: "muted", id: "audio-source", "data-source": this.expectedSource }, `음원: ${SOURCE_LABEL[this.expectedSource]}`),
      this.message ? h("p", { class: "banner warn", role: "alert", id: "audio-error" }, this.message) : null,
      this.expectedSource !== "RECORDED" ? h("p", { class: "muted", id: "tts-notice" }, TTS_LIMIT_NOTICE) : null,
    ];
    p.replaceChildren(...kids.filter((k): k is HTMLElement => k !== null));
  }

  scriptLines(): string[] { return this.item.segments.map((s) => `${SPEAKER[s.speaker]}: ${s.text}`); }
}
