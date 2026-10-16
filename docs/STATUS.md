# STATUS (resume file)

최종 갱신: 2026-10-17

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
| T10 복습 엔진 | DONE(PC Chrome headless) | 8db0057 | 전이표 전 경우·25분 규칙·재생 복원·약점 점수 단위 테스트, 카드 문항 생성(읽기/뜻/빈칸), 시작 전 안내, 재출제, 영역 5단계 막대, 약점 복습. |
| T11 문법 원리 학습·혼동 글자 | DONE(PC Chrome headless) | 63d122e | 문법 포인트=복습 카드(원리 화면→문맥 문제 순환), 포인트 설명·연습 화면, 혼동 글자 퀴즈(별도 메뉴, 틀린 쌍 가중), 린트(어미만 풀리는 문항 6/6 차단·6/6 통과), KANA 생성 프롬프트·린트. 콘텐츠(혼동쌍 20)는 T12 |
| T12 콘텐츠 런 1 → v1.0.0 | **기계장치 DONE / 분량 BLOCKED(COST)** | f96d8e1 | content:plan·fill·taxonomy 구현·테스트(가짜 LLM 8+3). 실제 생성: 혼동쌍 20/20 완료(헤드리스, 59콜), 어휘 400·문법 40·한자 문항 100은 예상 2,039콜이라 승인 대기. 신규 상한을 카드→항목(단어/포인트) 단위로 정정. docs/releases/V1.md |
| T13 독해 UI | DONE(PC Chrome headless) | 28dc963 | 지문 원본 페이지 구분 유지·페이징, 고정 문제줄+보기 4개, 해설에서 지문/해설 전환, 하루 새 지문 1개, 런웨이·플랜·진도 반영, stimulusId 노출 기록. 3뷰포트×4글자크기×3지문 유형 한 화면 검증 |
| T14 청해·오디오 | DONE(PC Chrome headless; TTS는 macos-say 로컬 확인) / BLOCKED(TTS: 실제 Google 합성), BLOCKED(DEVICE: Android 재생) | a2c581c | 재생기(녹음 오버라이드>생성 파일>브라우저 음성, 재생 횟수, 소스 배지, TTS 한계 문구), 오디오 패널·스크립트/다시 듣기, 듣고 쓰기, 청해 하루 2개·런웨이, `content:audio`. 실제 headless 생성·검증 청해 1문항을 macos-say로 합성해 Chrome 재생 확인(로컬 전용, 게시 금지). 청해 수정(revise) 시 음원 키가 깨지던 버그 수정 |
| T15 콘텐츠 런 2 | BLOCKED(COST: 호출 상한 미승인), BLOCKED(TTS: 실제 Google 합성 키 없음) | - | 독해 10 지문·청해 40 생성은 T12와 같은 headless 호출 상한 승인이 필요하다. 청해 1문항만 로컬 스모크(macos-say, 게시 금지)로 생성·검증·재생 확인 |
| T16 평가·준비도·리포트 | DONE(PC Chrome headless) / BLOCKED(COST: 평가 문항 영역당 60) | ebe9395 | 실전 세트(ASSESS 풀 격리·신규 노출만), 준비도(28일·첫 노출·정답 미공개·청해 음원 유효, n 0/<20/≥20/≥30 분기, 상대 취약), SVG 리포트(학습 시간·숙련도·영역 정답률), TTS 배지·음원 구성, 공식 결과 직접 입력. 확률·예상 점수 문구 0회(테스트). 부수 수정: deviceSeq 중복, 퀴즈 직후 모델 지연, 청해 수정 시 음원 키 소실 |
| T17 안정화 | DONE(PC Chrome headless; 가짜 Sheets) / BLOCKED(GOOGLE: 시트 스키마 마이그레이션·`_JLPT_SNAPSHOTS`), BLOCKED(DEVICE: 모바일 성능) | dab1d90 | 로컬 복구 지점(업그레이드·복원 직전 자동, 5개, 합집합 복원), IndexedDB v3 단계 업그레이드, 실제 옛 빌드(t06/v0.1.0/t12/t14) 덤프·백업 fixture 복원 검증(손실 0, seq 중복 데이터 포함), deviceSeq 복구, 두 기기 목표 충돌 선택 카드, 대용량(로컬 10만 건 부팅 ≈1 s, 시트 1.2만 행 복원). `.gitignore` 오류로 tools/·tests/content/·app/src/content/가 이전 커밋에 빠져 있던 문제 수정(a699c9a) |
| T18 N2/N1 확장 | BLOCKED(APPROVAL: execution_plan §9 "별도 승인") | - | 시작하지 않음. 승인 시 `tools/content/targets/<LEVEL>.json`, 진단 구성, 콘텐츠 생성이 필요하며 코드는 등급 중립으로 유지되어 있다(`npm run lint:level-neutral` 0건) |

## BLOCKED / 미확인 목록
- T00⑨ 저장소 게이트 측정: BLOCKED(DEVICE: Android Chrome, GOOGLE: Client ID·HTTPS Origin·테스트 시트)
- T00⑤ 청해 선택지 수: 미확인(이미지 PDF, 렌더러 없음)
- T00⑦ `file://` GIS 거부: 부분 확인(init 성공, 팝업은 헤드리스라 판정 불가)
- **BLOCKED(COST) T12 초기 분량**: 어휘 392·문법 36점(문항 4개씩)·한자 문항 100 생성 예상 2,039 headless 호출. 호출 상한을 사용자가 승인해야 한다 (`npm run content:fill -- --days 28 --max-calls 2200`, 재실행 시 이어서 진행).
- T07 실제 Google E2E: BLOCKED(GOOGLE: Client ID, HTTPS Origin, 테스트 시트, Android 기기). 가짜 API 테스트 통과를 실제 Google 완료로 보고하지 않는다.
- 사용자 확인 대기: `git push` / GitHub Pages 게시 / 저장소 공개 설정(Free 플랜은 public 필요). 승인 전에는 `npm run deploy`가 site/ 스테이징만 한다.
- Android 실기기 전 항목: BLOCKED(DEVICE) — T03 레이아웃도 PC Chrome 에뮬레이션 뷰포트만 검증
- TTS 약관, headless 구독 자동화 약관: 미확인(사용자 확인 필요)

## 다음 작업
없음 — 남은 것은 사용자 준비물·승인 항목뿐(위 BLOCKED 목록 참고)

- **BLOCKED(COST) T15/T16 콘텐츠**: 독해 10 지문·청해 40(+음원), 평가 문항 영역당 60개. 평가 문항은 블라인드 풀이 4회라 60문항당 약 470 호출(`--dry-run` 추정). 호출 상한 승인 후 `content:gen --pool ASSESS`.
- T16 정책값(28일, n<20, 0.60, 0.15p, 청해 1회 재생)은 plan.md §9의 [실무 제안] 값이며 검증된 컷오프가 아니다.

## 해석·결정 기록
- T17: 시트 스키마는 올리지 않았다(실제 Google에서 검증 불가). 자세한 결정과 측정: docs/decisions/snapshots-and-migration.md. 이전 커밋에는 tools/, tests/content/, app/src/content/가 없다(.gitignore 오류, a699c9a에서 수정).
- T16: ASSESS 레코드는 `AppModel.pool`에서 제외하고 `assessPool`로만 접근한다(학습·복습 화면이 우연히 쓸 수 없도록). 브라우저 음성은 평가·준비도에서 항상 제외(설정으로 포함하는 옵션은 두지 않음). 평가 세트 크기: 언어지식 10, 독해 6(지문 단위), 청해 6.
- T14: LISTENING→QUESTION은 `questionId`로만 연결(역참조는 id 순환). 앱은 청해에 연결된 문제를 낱개 연습에서 제외한다. 설정 변경 직후의 늦은 `refresh()`가 진행 중인 퀴즈를 다시 그리던 문제를 퀴즈 경로에서는 강제 재그리기를 하지 않도록 고침.
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
- T11 결정: 혼동 글자 읽기는 한국어 학습자를 위해 **한글 표기**(シ→시, ツ→츠)로 저장한다(`readings` 값). 혼동 퀴즈는 별도 연습이며 SRS 카드가 아니다.
- T11 린트 보강: "서로 다른 조사 3개 이상"도 문맥 단서 1개로 센다(휴리스틱이므로 오탐/미탐이 있을 수 있음: 6개 차단·6개 통과 사례로 검증).
- T12 정정(T10 결정 번복): 하루 새 항목 상한(5/10/15)은 **카드가 아니라 항목(단어)** 기준이다. 문법 포인트는 하루 1개(`GRAMMAR_NEW_PER_DAY`, `[실무 제안]`), 런웨이는 영역별 `미노출 항목 ÷ 하루 도입 수`의 최솟값이다. 이유: 초기 분량(어휘 400 ≈ 4주)과 맞추기 위함.
- T12 생성기: 모델이 인기 항목만 반복하므로 "이미 만든 것(do NOT repeat)" 목록을 보충 시도마다 프롬프트에 넣는다. 형식이 깨진 항목은 배치 전체를 중단시키지 않고 건너뛴다.
- T13 지문 레이아웃: 문제 한 줄(`#qline`)을 보기 위에 고정하고 지문 페이지를 그 위 영역에 둔다(plan.md §11.2 "현재 화면 페이지의 모든 요소가 한 화면"). 런웨이에 독해(영역)가 포함되므로 지문 콘텐츠가 없으면 런웨이는 0일이다(콘텐츠 런 2, T15에서 채움).
