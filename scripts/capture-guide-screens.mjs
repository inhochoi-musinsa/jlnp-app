// Captures the screenshots used in docs/USER_GUIDE.md from the built app (390x844, PC Chrome headless).
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/screenshots");
const PORT = 18099;
const srv = spawn("node", ["scripts/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "pipe" });
await new Promise((r) => srv.stdout.on("data", (d) => String(d).includes("serving") && r()));
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const url = (h) => `http://localhost:${PORT}/${h}`;
const shot = async (name) => { await p.waitForTimeout(400); await p.screenshot({ path: join(out, name + ".png") }); console.log("captured", name); };

await p.goto(url("#home")); await p.waitForSelector("#start-diag"); await shot("01-home-before-diagnostic");
await p.goto(url("#diag")); await p.waitForSelector("#diag-go"); await shot("02-diagnostic-intro");
await p.click("#diag-go"); await p.waitForSelector(".choice"); await shot("03-quiz-question");
await p.locator(".choice").nth(1).click(); await p.click("#submit"); await p.waitForSelector("#next"); await shot("04-quiz-feedback");
await p.goto(url("#settings")); await p.waitForSelector("#save-target"); await shot("05-settings-target");
await p.goto(url("#help")); await p.waitForSelector("summary"); await p.locator("summary").first().click(); await shot("06-help");
await b.close(); srv.kill();
