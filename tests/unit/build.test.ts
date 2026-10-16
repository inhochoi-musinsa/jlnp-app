import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");

describe("TST-PACK-01 single file build", () => {
  it("dist contains only index.html with inline CSS/JS and no external refs", () => {
    execFileSync("node", ["scripts/build-single-html.mjs"], { cwd: root });
    expect(readdirSync(resolve(root, "dist"))).toEqual(["index.html"]);
    const html = readFileSync(resolve(root, "dist/index.html"), "utf8");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href=/);
    expect(html).toContain("<style>");
  });
  it("TST-PACK-02 stays within the V0 budget", () => {
    const size = readFileSync(resolve(root, "dist/index.html")).length;
    expect(size).toBeLessThanOrEqual(300 * 1024);
  });
});
