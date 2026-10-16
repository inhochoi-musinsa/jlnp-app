import { GoogleError, MSG } from "./errors";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GIS_SRC = "https://accounts.google.com/gsi/client";

declare global {
  interface Window { google?: { accounts: { oauth2: { initTokenClient(c: any): { requestAccessToken(o?: any): void } } } } }
}

export interface GisEnv {
  protocol: string;
  loadScript?: (src: string) => Promise<void>;
  google?: () => Window["google"];
}

const defaultLoad = (src: string) => new Promise<void>((resolve, reject) => {
  const s = document.createElement("script");
  s.src = src; s.async = true;
  s.onload = () => resolve(); s.onerror = () => reject(new Error("script load failed"));
  document.head.append(s);
});

/**
 * Requests an access token. Must be called from a user click. The token lives in memory only.
 * file:// (and any non-https page) never loads the SDK: the call fails before any network use.
 */
export async function requestAccessToken(clientId: string, env: GisEnv = { protocol: location.protocol }): Promise<{ token: string; expiresAt: number }> {
  if (env.protocol === "file:" || env.protocol === "content:") throw new GoogleError("LOCAL_FILE", MSG.LOCAL_FILE);
  if (env.protocol !== "https:" && !(env.protocol === "http:" && typeof location !== "undefined" && ["localhost", "127.0.0.1"].includes(location.hostname))) throw new GoogleError("GIS_FAILED", MSG.GIS_FAILED);
  const g = env.google ?? (() => window.google);
  if (!g()) {
    try { await (env.loadScript ?? defaultLoad)(GIS_SRC); } catch { throw new GoogleError("GIS_FAILED", MSG.GIS_FAILED); }
  }
  const api = g();
  if (!api) throw new GoogleError("GIS_FAILED", MSG.GIS_FAILED);
  return new Promise((resolve, reject) => {
    const client = api.accounts.oauth2.initTokenClient({
      client_id: clientId, scope: SHEETS_SCOPE,
      callback: (r: { access_token?: string; expires_in?: number | string; error?: string }) => {
        if (r.error || !r.access_token) {
          reject(new GoogleError(r.error === "access_denied" ? "DECLINED" : "GIS_FAILED", r.error === "access_denied" ? MSG.DECLINED : MSG.GIS_FAILED));
          return;
        }
        resolve({ token: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
      },
      error_callback: (e: { type?: string }) => {
        if (e?.type === "popup_closed") reject(new GoogleError("DECLINED", MSG.DECLINED));
        else reject(new GoogleError("GIS_FAILED", MSG.GIS_FAILED));
      },
    });
    client.requestAccessToken({ prompt: "" });
  });
}
