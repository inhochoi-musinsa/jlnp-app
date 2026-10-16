import { parseRuby } from "../../../shared/ruby";

type Attrs = Record<string, string | number | boolean | null | undefined | ((e: Event) => void)>;

/** Safe element builder: only textContent / attributes, never innerHTML. */
export function h(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (typeof v === "function") el.addEventListener(k.replace(/^on/, "").toLowerCase(), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) el.append(c);
  return el;
}

/** Text with Aozora-style readings -> text nodes + <ruby>. Visibility is controlled by CSS. */
export function richText(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const seg of parseRuby(text)) {
    if (seg.rt === undefined) frag.append(seg.text);
    else {
      const ruby = document.createElement("ruby");
      ruby.append(seg.text, h("rt", {}, seg.rt));
      frag.append(ruby);
    }
  }
  return frag;
}
