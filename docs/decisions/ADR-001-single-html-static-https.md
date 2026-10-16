# ADR-001 단일 HTML + 정적 HTTPS
- 상태: ACCEPTED (D4, 2026-10-16)
- 결정: 앱 산출물은 `dist/index.html` 한 파일(CSS·JS 인라인). 청해 음원은 별도 정적 파일 `audio/`. 게시는 GitHub Pages(`index.html` + `audio/`).
- 이유: 사용자 PC에 서버 없이 모바일 Chrome에서 사용. Google 로그인(GIS)은 등록된 HTTPS origin에서만 동작하므로 정적 HTTPS 호스팅이 필요하다.
- 결과: `file://`는 LOCAL_FILE 모드(Google 연동 0회). 개발·검증은 `http://localhost:8080`. 크기 예산은 execution_plan §8.3.
- 대안 기각: Vite/React 개발서버(단일 파일 조건 위반), Apps Script(별도 승인 필요).
