export type RuntimeMode = "LOCAL_FILE" | "HTTPS_GUEST" | "LOCALHOST_DEV" | "UNSUPPORTED";

/** Decide the execution mode from location.protocol / hostname. Pure function. */
export function detectRuntimeMode(protocol: string, hostname = ""): RuntimeMode {
  if (protocol === "file:" || protocol === "content:") return "LOCAL_FILE";
  if (protocol === "https:") return "HTTPS_GUEST";
  if (protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")) {
    return "LOCALHOST_DEV";
  }
  return "UNSUPPORTED";
}

export function runtimeModeLabel(mode: RuntimeMode): string {
  switch (mode) {
    case "LOCAL_FILE": return "로컬 모드";
    case "HTTPS_GUEST": return "HTTPS 실행";
    case "LOCALHOST_DEV": return "개발 모드(localhost)";
    case "UNSUPPORTED": return "지원하지 않는 실행 환경";
  }
}
