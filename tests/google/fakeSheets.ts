import type { HttpFetch } from "../../app/src/google/sheets";

type Cell = string | number;
interface Tab { sheetId: number; title: string; rows: Cell[][] }
interface Book { id: string; title: string; tabs: Tab[]; readOnly: boolean; owner: string }

export interface Failure {
  /** matches "METHOD path" such as "POST .../values/...:append" */
  match: RegExp;
  status?: number;                // respond with this HTTP status
  body?: unknown;
  headers?: Record<string, string>;
  /** apply the request to the sheet and THEN fail (lost response / 5xx after commit) */
  afterApply?: boolean;
  /** throw a network error instead of answering */
  network?: boolean;
  times?: number;
}

const colNum = (s: string) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

/** An in-memory Sheets v4 look-alike. TEST DOUBLE ONLY: passing against it does not prove real Google behaviour. */
export class FakeSheets {
  books = new Map<string, Book>();
  validToken = "tok-1";
  requests: { method: string; path: string }[] = [];
  failures: Failure[] = [];
  private nextSheetId = 100;
  writeCount = 0;

  addBook(id: string, tabs: Record<string, Cell[][]> = { Sheet1: [] }, o: { readOnly?: boolean } = {}): Book {
    const b: Book = { id, title: "Test book", tabs: Object.entries(tabs).map(([title, rows]) => ({ sheetId: this.nextSheetId++, title, rows: rows.map((r) => [...r]) })), readOnly: !!o.readOnly, owner: "me" };
    this.books.set(id, b);
    return b;
  }
  tab(id: string, title: string): Tab | undefined { return this.books.get(id)?.tabs.find((t) => t.title === title); }
  snapshot(id: string, titles?: string[]): unknown { return JSON.parse(JSON.stringify(this.books.get(id)!.tabs.filter((t) => !titles || titles.includes(t.title)))); }

  http: HttpFetch = async (url, init) => {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname) + u.search;
    this.requests.push({ method: init.method, path });
    const key = `${init.method} ${path}`;
    const f = this.failures.find((x) => x.match.test(key) && (x.times === undefined || x.times > 0));
    if (f && f.times !== undefined) f.times--;
    if (f?.network && !f.afterApply) throw new TypeError("Failed to fetch");
    const auth = init.headers.authorization;
    const wrap = (r: { status: number; headers: Record<string, string>; text: string }) => ({ status: r.status, headers: { get: (n: string) => r.headers[n.toLowerCase()] ?? null }, text: async () => r.text });
    if (auth !== `Bearer ${this.validToken}`) return wrap(this.err(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."));
    let res = this.route(init.method, u, init.body ? JSON.parse(init.body) : undefined);
    if (f) {
      if (f.afterApply && f.network) throw new TypeError("Failed to fetch");
      if (f.status) res = { status: f.status, headers: f.headers ?? {}, text: JSON.stringify(f.body ?? { error: { code: f.status, message: "injected", status: "INTERNAL" } }) };
    }
    return wrap(res);
  };

  private ok(body: unknown) { return { status: 200, headers: {} as Record<string, string>, text: JSON.stringify(body) }; }
  private err(status: number, st: string, message: string, reason?: string) {
    return { status, headers: {} as Record<string, string>, text: JSON.stringify({ error: { code: status, message, status: st, ...(reason ? { details: [{ reason }] } : {}) } }) };
  }

  private route(method: string, u: URL, body: any) {
    const m = /^\/v4\/spreadsheets\/([^/:]+)(.*)$/.exec(u.pathname);
    if (!m) return this.err(404, "NOT_FOUND", "bad path");
    const book = this.books.get(decodeURIComponent(m[1]!));
    if (!book) return this.err(404, "NOT_FOUND", "Requested entity was not found.");
    const rest = decodeURIComponent(m[2]!);
    if (method === "GET" && rest === "") return this.ok({ spreadsheetId: book.id, properties: { title: book.title }, sheets: book.tabs.map((t) => ({ properties: { sheetId: t.sheetId, title: t.title } })) });
    const write = method === "POST";
    if (write && book.readOnly) return this.err(403, "PERMISSION_DENIED", "The caller does not have permission");
    if (method === "POST" && rest === ":batchUpdate") {
      this.writeCount++;
      for (const r of body.requests) {
        const title = r.addSheet.properties.title;
        if (book.tabs.some((t) => t.title === title)) return this.err(400, "INVALID_ARGUMENT", `A sheet with the name "${title}" already exists.`);
      }
      for (const r of body.requests) book.tabs.push({ sheetId: this.nextSheetId++, title: r.addSheet.properties.title, rows: [] });
      return this.ok({ spreadsheetId: book.id, replies: body.requests.map(() => ({})) });
    }
    if (method === "POST" && rest === "/values:batchUpdate") {
      if (body.valueInputOption !== "RAW") return this.err(400, "INVALID_ARGUMENT", "this app must use RAW");
      this.writeCount++;
      for (const d of body.data) {
        const p = this.parseRange(d.range); const tab = book.tabs.find((t) => t.title === p.tab);
        if (!tab) return this.err(400, "INVALID_ARGUMENT", `Unable to parse range: ${d.range}`);
        d.values.forEach((row: Cell[], i: number) => { tab.rows[p.r1 - 1 + i] = [...row]; });
      }
      return this.ok({ spreadsheetId: book.id, totalUpdatedRows: body.data.length });
    }
    const vm = /^\/values\/(.+?)(:append)?$/.exec(rest);
    if (vm) {
      const range = vm[1]!;
      const p = this.parseRange(range); const tab = book.tabs.find((t) => t.title === p.tab);
      if (!tab) return this.err(400, "INVALID_ARGUMENT", `Unable to parse range: ${range}`);
      if (method === "GET") {
        const rows = tab.rows.slice(p.r1 - 1, p.r2).map((r) => (r ?? []).slice(p.c1 - 1, p.c2));
        while (rows.length && rows[rows.length - 1]!.length === 0) rows.pop();
        return this.ok({ range, majorDimension: "ROWS", ...(rows.length ? { values: rows } : {}) });
      }
      if (vm[2] === ":append") {
        if (u.searchParams.get("valueInputOption") !== "RAW") return this.err(400, "INVALID_ARGUMENT", "this app must use RAW");
        this.writeCount++;
        const first = tab.rows.filter((r) => r && r.length).length + 1; // appended after the last non-empty row
        // keep the grid dense: rows are only ever appended
        const start = tab.rows.length + 1;
        for (const row of body.values) tab.rows.push([...row]);
        const last = tab.rows.length;
        void first;
        return this.ok({ spreadsheetId: book.id, tableRange: `'${tab.title}'!A1:A${start - 1}`, updates: { spreadsheetId: book.id, updatedRange: `'${tab.title}'!A${start}:Z${last}`, updatedRows: body.values.length } });
      }
    }
    return this.err(404, "NOT_FOUND", "unhandled " + method + " " + rest);
  }

  private parseRange(r: string) {
    const m = /^'((?:[^']|'')+)'!([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(r);
    if (!m) return { tab: "", c1: 1, c2: 1, r1: 1, r2: 1 };
    return { tab: m[1]!.replace(/''/g, "'"), c1: colNum(m[2]!), r1: Number(m[3]), c2: colNum(m[4]!), r2: Number(m[5]) };
  }
}
