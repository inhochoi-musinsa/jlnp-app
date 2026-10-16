import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs module
import { scanText, FORBIDDEN_TRACKED } from "../../scripts/scan-secrets.mjs";

describe("secret scanner", () => {
  const bad = ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz", "AIzaSyA1234567890abcdefghijklmnopqrstuv", "ya29.a0AfH6SMBabcdefghijklmnopqrstuv", "GOCSPX-abcdefghijklmnopqrstuvwxyz12", "-----BEGIN PRIVATE KEY-----", '"client_secret": "abc123"', "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "https://docs.google.com/spreadsheets/d/1RealSheetIdThatIsLongEnough123456/edit"];
  const ok = ["const x = 1;", "ANTHROPIC_API_KEY=", "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd/edit", "https://docs.google.com/spreadsheets/d/<ID>/edit", "sk-ant is a prefix", "client_secret은 쓰지 않는다"];
  it.each(bad)("flags %s", (t: string) => expect(scanText(t).length).toBeGreaterThan(0));
  it.each(ok)("allows %s", (t: string) => expect(scanText(t)).toEqual([]));
  it("local-only files must not be tracked", () => {
    for (const f of [".env.local", "config.local.json", "content/runs/x.json", "packs/a.json", "audio/a.mp3", "site/index.html"]) expect(FORBIDDEN_TRACKED.some((re: RegExp) => re.test(f)), f).toBe(true);
    expect(FORBIDDEN_TRACKED.some((re: RegExp) => re.test("app/seed/seed.jlptpack.json"))).toBe(false);
  });
});
