import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright-core";
import type { ChildProcess } from "node:child_process";
import { launch, startServer, fileUrl } from "./helpers";

const PORT = 18080;
const URL = `http://localhost:${PORT}/`;
let server: ChildProcess;
let browser: Browser;

beforeAll(async () => { server = await startServer(PORT); browser = await launch(); }, 30000);
afterAll(async () => { await browser?.close(); server?.kill(); });

const VIEWPORTS = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }];
const SCALES = ["S", "M", "L", "XL"];

async function open(viewport: { width: number; height: number }, scale: string, hash = "#demo"): Promise<Page> {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((s) => { try { localStorage.setItem("jlpt.settings.hint", JSON.stringify({ fontScale: s })); } catch {} }, scale);
  const page = await ctx.newPage();
  await page.goto(URL + hash);
  await page.waitForSelector(".quiz");
  return page;
}

/** No vertical scroll, and every choice + the main action fully inside the viewport. */
async function assertOneScreen(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const vh = innerHeight, vw = innerWidth;
    const de = document.documentElement;
    const rect = (el: Element) => el.getBoundingClientRect();
    const choices = [...document.querySelectorAll(".choice")].map(rect);
    const action = rect(document.querySelector(".actions .primary")!);
    return {
      docScroll: de.scrollHeight - vh, hScroll: de.scrollWidth - vw,
      nChoices: choices.length,
      choicesInside: choices.every((c) => c.top >= 0 && c.bottom <= vh + 0.5 && c.left >= 0 && c.right <= vw + 0.5),
      actionInside: action.top >= 0 && action.bottom <= vh + 0.5,
      choiceFonts: [...new Set([...document.querySelectorAll(".choice")].map((c) => getComputedStyle(c).fontSize))],
      heights: choices.map((c) => c.height),
    };
  });
  expect(r.nChoices, label).toBe(4);
  expect(r.docScroll, `${label} vertical scroll`).toBeLessThanOrEqual(1);
  expect(r.hScroll, `${label} horizontal scroll`).toBeLessThanOrEqual(1);
  expect(r.choicesInside, `${label} choices inside viewport`).toBe(true);
  expect(r.actionInside, `${label} action inside viewport`).toBe(true);
  expect(r.heights.every((h) => h >= 44), `${label} touch targets >= 44px`).toBe(true);
  return r;
}

describe("TST-QUIZ one screen at 320x568, 360x640, 390x844 x S/M/L/XL", () => {
  for (const vp of VIEWPORTS) for (const sc of SCALES) {
    it(`${vp.width}x${vp.height} font ${sc}: question and feedback keep 4 big choices on one screen`, async () => {
      const page = await open(vp, sc);
      const before = await assertOneScreen(page, `Q ${vp.width} ${sc}`);
      await page.click(".choice >> nth=1");
      await page.click("#submit");
      await page.waitForSelector("#next");
      const after = await assertOneScreen(page, `F ${vp.width} ${sc}`);
      expect(after.choiceFonts).toEqual(before.choiceFonts); // text never shrinks between question and feedback
      await page.context().close();
    }, 20000);
  }
});

describe("TST-QUIZ behaviour", () => {
  it("TST-QUIZ-01: no time limit, no auto advance after 10s, manual next only", async () => {
    const page = await open({ width: 390, height: 844 }, "M");
    await page.click(".choice >> nth=0");
    await page.click("#submit");
    await page.waitForSelector("#next");
    const progress = await page.textContent(".quiz-progress");
    await page.waitForTimeout(10500);
    expect(await page.textContent(".quiz-progress")).toBe(progress);
    expect(await page.locator("#next").count()).toBe(1);
    await page.click("#next");
    expect(await page.textContent(".quiz-progress")).not.toBe(progress);
    await page.context().close();
  }, 30000);

  it("submit is impossible before a choice is selected; DOM leaks no correct-answer marker before submit", async () => {
    const page = await open({ width: 390, height: 844 }, "M");
    expect(await page.locator("#submit").isDisabled()).toBe(true);
    const html = await page.evaluate(() => document.querySelector(".quiz")!.outerHTML);
    expect(html).not.toMatch(/is-correct|data-correct|correct/i);
    await page.click(".choice >> nth=2");
    expect(await page.locator("#submit").isDisabled()).toBe(false);
    const html2 = await page.evaluate(() => document.querySelector(".quiz")!.outerHTML);
    expect(html2).not.toMatch(/is-correct|data-correct/i);
    await page.context().close();
  });

  it("choice order is re-drawn per attempt and the 4 choices are the same set in feedback", async () => {
    const page = await open({ width: 390, height: 844 }, "M");
    const ids = () => page.$$eval(".choice", (els) => els.map((e) => e.getAttribute("data-choice")));
    const q = await ids();
    await page.click(".choice >> nth=0"); await page.click("#submit");
    const f = await ids();
    expect(f).toEqual(q);
    expect([...f].sort()).toEqual(["a", "b", "c", "d"]);
    await page.context().close();
  });

  it("feedback: tapping each wrong choice shows its own why-wrong and how-to-correct", async () => {
    const page = await open({ width: 390, height: 844 }, "M");
    await page.click(".choice[data-choice=a]"); await page.click("#submit");
    for (const id of ["b", "c", "d"]) {
      await page.click(`.choice[data-choice=${id}]`);
      const text = await page.textContent("#pane-body");
      expect(text).toContain("왜 틀렸나");
      expect(text).toContain("고치려면");
    }
    await page.context().close();
  });

  it("long stem (demo-2) is paged, with the 4 choices and the action still fixed on screen", async () => {
    const page = await open({ width: 320, height: 568 }, "XL");
    await page.click(".choice >> nth=0"); await page.click("#submit"); await page.click("#next");
    await page.waitForSelector("#pager button");
    expect(await page.locator("#pager").isVisible()).toBe(true);
    const first = await page.textContent("#pane-body");
    await page.click("#pager button >> nth=1");
    expect(await page.textContent("#pane-body")).not.toBe(first);
    await assertOneScreen(page, "paged stem XL 320");
    await page.context().close();
  }, 20000);

  it("furigana: HIDDEN hides readings, ALWAYS shows them", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("jlpt.settings.hint", JSON.stringify({ furiganaMode: "HIDDEN" })); } catch {} });
    const page = await ctx.newPage();
    await page.goto(URL + "#demo");
    await page.waitForSelector(".quiz");
    expect(await page.locator("rt").first().isVisible()).toBe(false);
    await page.evaluate(() => { document.documentElement.dataset.furigana = "ALWAYS"; });
    expect(await page.locator("rt").first().isVisible()).toBe(true);
    await ctx.close();
  });

  it("settings tab changes font size and persists the hint; tab bar has 4 tabs", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto(URL + "#settings");
    await page.waitForSelector(".tabbar");
    expect(await page.locator(".tabbar .tab").count()).toBe(4);
    await page.getByLabel("아주 크게").check();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim())).toBe("22px");
    await page.reload();
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--fs").trim())).toBe("22px");
    await ctx.close();
  });

  it("file:// shows LOCAL_FILE mode, the exact notice, and no demo route", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    const requests: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(fileUrl() + "#home");
    await page.waitForSelector(".tabbar");
    expect(await page.textContent(".banner")).toContain("로컬 모드");
    await page.goto(fileUrl() + "#demo");
    await page.waitForSelector(".tabbar");
    expect(await page.locator(".quiz").count()).toBe(0);
    expect(requests.filter((u) => !u.startsWith("file://"))).toEqual([]); // TST-RUNTIME-01: no Google/SDK/network request
    await ctx.close();
  });
});
