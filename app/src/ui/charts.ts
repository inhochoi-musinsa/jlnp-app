// Small SVG charts built with createElementNS (no innerHTML). Colours come from the page's CSS variables so dark mode works.
const NS = "http://www.w3.org/2000/svg";
type A = Record<string, string | number>;
function el(tag: string, attrs: A = {}, ...kids: (SVGElement | string)[]): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of kids) e.append(typeof c === "string" ? document.createTextNode(c) : c);
  return e;
}
const svg = (w: number, hgt: number, label: string, ...kids: SVGElement[]) =>
  el("svg", { viewBox: `0 0 ${w} ${hgt}`, width: "100%", role: "img", "aria-label": label, class: "chart", preserveAspectRatio: "xMidYMid meet" }, el("title", {}, label), ...kids);

/** Daily minutes, one bar per day. */
export function barChart(data: { label: string; value: number }[], opt: { title: string; unit: string; max?: number }): SVGElement {
  const W = 320, H = 120, padL = 4, padB = 16, padT = 8;
  const max = Math.max(opt.max ?? 0, ...data.map((d) => d.value), 1);
  const bw = (W - padL) / data.length;
  const bars = data.map((d, i) => el("rect", { x: padL + i * bw + 1, y: padT + (H - padT - padB) * (1 - d.value / max), width: Math.max(1, bw - 2), height: (H - padT - padB) * (d.value / max), fill: "var(--accent)", rx: 1 }, el("title", {}, `${d.label}: ${d.value}${opt.unit}`)));
  const first = el("text", { x: padL, y: H - 3, "font-size": 9, fill: "var(--muted)" }, data[0]?.label ?? "");
  const last = el("text", { x: W - 2, y: H - 3, "font-size": 9, "text-anchor": "end", fill: "var(--muted)" }, data[data.length - 1]?.label ?? "");
  const top = el("text", { x: W - 2, y: 8, "font-size": 9, "text-anchor": "end", fill: "var(--muted)" }, `최대 ${max}${opt.unit}`);
  return svg(W, H, opt.title, el("line", { x1: padL, x2: W, y1: H - padB, y2: H - padB, stroke: "var(--border)" }), ...bars, first, last, top);
}

export interface AccRow { label: string; k: number; n: number; accuracy: number | null; lo?: number; hi?: number; muted: boolean }
/** One horizontal bar per section; an unreliable sample (n below the minimum) is drawn hatched, not coloured. */
export function accuracyChart(rows: AccRow[], title: string): SVGElement {
  const W = 320, rowH = 34, H = rows.length * rowH + 8, x0 = 112, x1 = W - 8, bw = x1 - x0;
  const pat = el("defs", {}, el("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, el("rect", { width: 6, height: 6, fill: "var(--card)" }), el("line", { x1: 0, y1: 0, x2: 0, y2: 6, stroke: "var(--muted)", "stroke-width": 2 })));
  const parts: SVGElement[] = [pat];
  rows.forEach((r, i) => {
    const y = 6 + i * rowH;
    parts.push(el("text", { x: 0, y: y + 14, "font-size": 11, fill: "var(--fg)" }, r.label));
    parts.push(el("text", { x: 0, y: y + 27, "font-size": 9, fill: "var(--muted)" }, `${r.k}/${r.n}`));
    parts.push(el("rect", { x: x0, y: y + 4, width: bw, height: 18, fill: "var(--card)", stroke: "var(--border)", rx: 3 }));
    if (r.accuracy !== null) parts.push(el("rect", { x: x0, y: y + 4, width: bw * r.accuracy, height: 18, fill: r.muted ? "url(#hatch)" : "var(--accent)", stroke: r.muted ? "var(--muted)" : "none", rx: 3 }));
    if (r.lo !== undefined && r.hi !== undefined) parts.push(el("line", { x1: x0 + bw * r.lo, x2: x0 + bw * r.hi, y1: y + 13, y2: y + 13, stroke: "var(--fg)", "stroke-width": 2 }));
    parts.push(el("text", { x: x1 - 2, y: y + 17, "font-size": 10, "text-anchor": "end", fill: "var(--fg)" }, r.accuracy === null ? "—" : `${Math.round(r.accuracy * 100)}%`));
  });
  return svg(W, H, title, ...parts);
}

/** Stacked bar for the five mastery stages. */
export function stageChart(counts: number[], names: string[], title: string): SVGElement {
  const W = 320, H = 40, total = counts.reduce((a, b) => a + b, 0);
  const shades = ["var(--border)", "var(--sel-bg)", "var(--accent)", "var(--ok)", "var(--ok)"];
  let x = 0;
  const parts: SVGElement[] = [];
  counts.forEach((c, i) => {
    if (!c || !total) return;
    const w = (c / total) * W;
    parts.push(el("rect", { x, y: 6, width: w, height: 18, fill: shades[i] ?? "var(--accent)", stroke: "var(--bg)", "stroke-width": 1, "fill-opacity": i === 4 ? 1 : i === 3 ? 0.7 : 1 }, el("title", {}, `${names[i]} ${c}`)));
    x += w;
  });
  parts.push(el("text", { x: 0, y: 36, "font-size": 9, fill: "var(--muted)" }, names.map((n, i) => `${n} ${counts[i] ?? 0}`).join(" · ")));
  return svg(W, H, title, ...parts);
}
