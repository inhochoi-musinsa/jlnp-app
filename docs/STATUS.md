# STATUS (resume file)

최종 갱신: 2026-10-16

| 작업 | 상태 | 커밋 | 비고 |
|---|---|---|---|
| T00 사실 확인 | DONE(일부 BLOCKED/미확인) | 0b18a89 | ①②③④⑥⑩ 확인, ⑤ 미확인, ⑦ 부분 확인, ⑨ BLOCKED(DEVICE, GOOGLE) |
| T01 저장소·빌드 | DONE | 4130934 | 빌드 2.4 KiB, file:// 및 localhost 렌더 확인, 테스트 5 PASS |
| T02 공용 스키마·도메인 | DONE | d8de327 | 테스트 50 PASS, lint:level-neutral 0건 |
| T03 퀴즈 쉘·설정·홈 쉘 | DONE(PC Chrome headless 기준) | dc0fe78 | UI 20 PASS(3 뷰포트×4 글자크기). Android 실기기 미확인 |
| T04 로컬 저장·outbox·백업 | DONE(Mock 포함, 실제 Sheets 아님) | 2e9b61b | 단위 19 + 브라우저 4 PASS. 백업→복원 중복 0 |
| T05 콘텐츠 CLI 최소판 | DONE | 16700f3 | 시드 팩 45항목 전부 VERIFIED(생성 claude-sonnet-5-5 ≠ 검증 claude-opus-5-5, headless, 모델명 resolved). 테스트 125 PASS |
| T06 진단·목표·플랜 | DONE(PC Chrome headless) | 0080a9d | 28문항 진단·라우팅·재개, 목표 연도/월, 60분 플랜(청해 제외·재배분·분량 부족 표기). 단위 18+UI 6 PASS |
| T07 Google 연동·동기화 | **BLOCKED(GOOGLE) — 실제 E2E 미수행** / 코드·가짜 API 테스트 DONE | 18a3ad3 | GIS·URL 파서·Sheets 어댑터·비파괴 초기화·배치 동기화(readback ACK)·증분 로딩·오류 매트릭스·UI 구현. 테스트 59(가짜 Google, 실제 Google 아님). 체크리스트: docs/qa/t07-real-e2e-checklist.md |
| T08 팩 import/export·신고·진도 | DONE(시트 쓰기는 가짜 API로만 검증) | bd48ed5 | IMP-01~11, 병합 규칙, 5,000항목 계획 0.3초·200행 배치 25회, 신고·flags.json, progress.json(개인정보 0), 런웨이. 테스트 241 PASS |
| T09 v0.1.0 릴리스 | **DONE(후보), 태그 보류** | 9477672 | 통합 QA 기록(docs/qa/v0-qa.md), 릴리스 문서, 도움말, 가이드 대조 테스트, 화면 캡처, 배포 스크립트(스테이징만), 비밀 스캔. 262 테스트 PASS. P0 미해결(실제 Google, Android, 사람 검수, 게시 승인)로 `v0.1.0` 태그는 만들지 않음 |
| T10 복습 엔진 | DONE(PC Chrome headless) | (T10) | 전이표 전 경우·25분 규칙·재생 복원·약점 점수 단위 테스트, 카드 문항 생성(읽기/뜻/빈칸), 시작 전 안내, 재출제, 영역 5단계 막대, 약점 복습. |

## BLOCKED / 미확인 목록
- T00⑨ 저장소 게이트 측정: BLOCKED(DEVICE: Android Chrome, GOOGLE: Client ID·HTTPS Origin·테스트 시트)
- T00⑤ 청해 선택지 수: 미확인(이미지 PDF, 렌더러 없음)
- T00⑦ `file://` GIS 거부: 부분 확인(init 성공, 팝업은 헤드리스라 판정 불가)
- T07 실제 Google E2E: BLOCKED(GOOGLE: Client ID, HTTPS Origin, 테스트 시트, Android 기기). 가짜 API 테스트 통과를 실제 Google 완료로 보고하지 않는다.
- 사용자 확인 대기: `git push` / GitHub Pages 게시 / 저장소 공개 설정(Free 플랜은 public 필요). 승인 전에는 `npm run deploy`가 site/ 스테이징만 한다.
- Android 실기기 전 항목: BLOCKED(DEVICE) — T03 레이아웃도 PC Chrome 에뮬레이션 뷰포트만 검증
- TTS 약관, headless 구독 자동화 약관: 미확인(사용자 확인 필요)

## 다음 작업
T11 문법 원리 학습·혼동 글자

## 해석·결정 기록
- IMP-10 필수 검사: BLIND_SOLVE·DISTRACTOR_CHECK는 선택지가 있는 QUESTION에만 적용, 다른 종류는 SCHEMA_LINT+QUALITY_CHECK로 판정(`shared/verification.ts`). 선택지 없는 항목에 PASS를 꾸며 기록하지 않기 위함.
- 생성 단계 자기 수리(`repairDraft`): V1 위반 초안을 검증 호출 전에 생성 모델에게 최대 2회 되돌려 보낸다. V1 자체의 "즉시 REJECT"는 그대로.
- 시드 생성은 headless(구독) 방식으로 수행. `maxCallsPerRun`은 로컬 `config.local.json`(gitignore)에서 300으로 올림(템플릿 기본 100). USD 과금 아님.
- 시드 품질은 자동 검증만 거쳤다. 사람 표본 점검은 하지 않았다(`npm run content:sample`로 가능).
- T06 오늘 세션: v0.1.0에서는 문법 문제(LEARN 풀 QUESTION)만 풀 수 있다. 어휘 카드 학습은 T10(복습 엔진)에서 제공되므로 플랜에서 "카드 복습은 v1.0.0에서 제공"으로 제외 표기한다.
- T06 시드 분량: 진단 28 + 어휘 8 + 문법 포인트 4(+문제 3). 문법 문제가 4개가 아닌 3개인 것은 검증을 통과한 항목만 담았기 때문이다.
- T07 결정: 계정 식별(`boundGoogleSub`)을 위한 `openid email` 추가 스코프는 요청하지 않는다(스코프 최소화). 계정/프로필 불일치는 시트 META의 `ownerProfileId`와 기기 `profileId` 비교로 판정한다. 새 기기(기록이 자동 생성 이벤트뿐)는 시트의 프로필에 합류한다.
- T07 클라이언트 ID: 빌드 시 `config.local.json`의 `clientId`를 번들에 넣는다(공개 값). 테스트용 런타임 주입은 localhost에서만 허용.
- T08 해석: 같은 id+같은 버전+같은 hash가 아니라 "같은 id로 더 높은 버전이 UNVERIFIED이고 기존이 VERIFIED"이면 후보(비활성), 반대로 기존이 UNVERIFIED이고 새 버전이 VERIFIED이면 새 버전이 활성이 된다(활성 = 가장 높은 VERIFIED 버전). 명세의 "둘 다 VERIFIED일 때만 전환"에서 후자 경우만 안전 쪽으로 넓혔다.
- T08 런웨이: 현재 버전에서 공부할 수 있는 영역(어휘, 문법)만 센다. 독해·청해는 해당 기능(v2.0.0)이 들어올 때 `ACTIVE_AREAS`에 추가한다. 따라서 v0.1.0에서는 런웨이가 항상 14일 미만이라 "콘텐츠 추가 필요"가 보인다(시드가 작기 때문이며 정상).
- T10 결정: 하루 신규 상한(5/10/15)은 단어가 아니라 **카드 수** 기준이다(단어 하나가 읽기·뜻·빈칸 최대 3장). AUDIO 방향은 음원이 생기는 v2.0.0에서 추가. 진단을 마치기 전에는 경로를 모르므로 새 카드는 0개(복습 대상만 허용).
- T10 재출제: 틀린 카드는 같은 세션 3문항 뒤에 1회만 다시 나오며, 재시도 결과는 단계·복습일을 바꾸지 않는다(`applyAnswer(retry)`).
