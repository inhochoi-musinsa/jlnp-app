# 런타임 스파이크 기록 (T00 ⑥⑦⑧)

확인일: 2026-10-16. 환경: macOS 14(Darwin 23.6), Node v22.16.0, Google Chrome 155.0.8059.84(PC). Android 실기기: **없음(미확인)**.

## ⑦ `file://`에서 Google 로그인 불가 확인
- 공식 근거: GIS/OAuth 웹 클라이언트는 **등록된 JavaScript origin**(https 또는 localhost)에서만 동작하며 `file://`·`content://`는 등록할 수 없다.
  https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow ,
  https://google.github.io/google-api-javascript-client/docs/faq.html (plan.md §1.1 인용)
- 재현 시도(헤드리스 Chrome 155, `file://` 페이지, 더미 client_id):
  - `origin=file://`, GIS 스크립트 로드 **성공**, `initTokenClient` 예외 **없음**. 즉 SDK 쪽은 `file://`를 막지 않는다.
  - `requestAccessToken()`은 `popup_failed_to_open`으로 실패했으나, 헤드리스·사용자 제스처 없음 조건이므로 **이 결과만으로 file:// 거부를 입증하지는 못한다**.
- 결론: `file://` 거부를 이 환경에서 직접 재현하지는 못했다(**부분 확인**). 공식 문서 근거만으로도 설계 결정(`file://`에서 GIS 로드·호출 0회)은 유효하다. 앱은 SDK가 막지 않으므로 **스스로 차단**해야 한다(`TST-RUNTIME-01`). 실기기·실제 클릭 재현은 T07 실환경(사용자 Client ID 필요)에서 보완한다.

## Android Chrome 실기기 항목 → BLOCKED(DEVICE)
- `file://`/`content://` 열기, IndexedDB 영속, 다운로드·가져오기 동작: **미확인**. T09에서 실기기 QA 시 기록한다. 결과 전에는 "모바일 로컬 파일 모드 지원"이라고 쓰지 않는다.

## ⑥ 형태소 분석기 후보 (V2 `READING_CHECK`)
| 후보 | 확인 | 판단 |
|---|---|---|
| **kuromoji** (npm `kuromoji` 0.1.2) | Apache-2.0, 사전(ipadic) 포함, Node 동작, 설치 크기 약 41 MB | **채택(CLI 전용, 앱 번들에 넣지 않음)**. 설치·동작 확인은 T05에서 `npm install` 후 `READING_CHECK` 단위 테스트로 한다 → 지금은 **미설치 상태의 후보 확정**일 뿐 |
| kuroshiro (6.0.0 표기) | 래퍼. 분석기는 kuromoji 등 별도 | 보류 |
| lindera-wasm | 버전 조회됨, 사전·라이선스 미확인 | 보류 **[미확인]** |
- 앱(브라우저)에는 형태소 분석기를 넣지 않는다. 크기 예산(§8.3) 때문이며, 의미 검증은 CLI에서만 한다.

## ⑧ plan.md T00 항목
- ADR: execution_plan §2에 따라 ADR 3개(ADR-001 단일 HTML+정적 HTTPS, ADR-002 Sheets 정본+배치 동기화, ADR-003 콘텐츠 파이프라인·팩 포맷)를 **T01에서 작성**한다.
- 모드별 가능/불가 표는 plan.md §1.1 "실행 모드 결정표"를 그대로 따른다. D4=ACCEPTED.
- 정적 HTTPS Origin: `https://<owner>.github.io`(경로 없음). 사용자 Cloud 준비 상태: **미제공(Client ID·Origin·테스트 시트 없음)** → T07 BLOCKED 예정.
