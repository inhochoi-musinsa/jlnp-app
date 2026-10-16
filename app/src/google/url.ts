export interface SheetRef { spreadsheetId: string; gid: number | null }

/** Accepts only https://docs.google.com/spreadsheets/d/<ID>/...; anything else returns null (and no API call is made). */
export function parseSpreadsheetUrl(input: string): SheetRef | null {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.hostname !== "docs.google.com") return null;
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  const gidRaw = new URLSearchParams(u.hash.replace(/^#/, "")).get("gid") ?? u.searchParams.get("gid");
  const gid = gidRaw !== null && /^\d+$/.test(gidRaw) ? Number(gidRaw) : null;
  return { spreadsheetId: m[1]!, gid };
}
