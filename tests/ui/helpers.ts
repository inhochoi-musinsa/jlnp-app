import { chromium, type Browser } from "playwright-core";
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(__dirname, "../..");
export const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export async function startServer(port: number): Promise<ChildProcess> {
  execFileSync("node", ["scripts/build-single-html.mjs"], { cwd: root });
  const p = spawn("node", ["scripts/serve.mjs"], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: "pipe" });
  await new Promise<void>((res, rej) => {
    p.stdout!.on("data", (d) => { if (String(d).includes("serving")) res(); });
    p.on("error", rej);
    setTimeout(() => rej(new Error("server start timeout")), 10000);
  });
  return p;
}

export const launch = (): Promise<Browser> => chromium.launch({ executablePath: CHROME, headless: true });
export const fileUrl = () => "file://" + resolve(root, "dist/index.html");
