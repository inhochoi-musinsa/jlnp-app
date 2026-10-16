import { detectRuntimeMode, runtimeModeLabel } from "./runtime";

declare const __APP_VERSION__: string;

export function render(root: HTMLElement, protocol: string = location.protocol): void {
  const mode = detectRuntimeMode(protocol, typeof location !== "undefined" ? location.hostname : "");
  root.textContent = "";
  const h = document.createElement("h1");
  h.textContent = "JLPT 학습";
  const badge = document.createElement("span");
  badge.className = mode === "LOCAL_FILE" ? "badge warn" : "badge";
  badge.textContent = runtimeModeLabel(mode);
  const card = document.createElement("div");
  card.className = "card";
  card.textContent =
    mode === "LOCAL_FILE"
      ? "로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다."
      : "빌드 확인용 화면입니다. 기능은 이후 작업(T03~)에서 추가됩니다.";
  const ver = document.createElement("p");
  ver.className = "badge";
  ver.textContent = "v" + __APP_VERSION__;
  root.append(h, badge, card, ver);
}

const root = typeof document !== "undefined" ? document.getElementById("app") : null;
if (root) render(root);
