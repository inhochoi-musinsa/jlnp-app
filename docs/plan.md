# JLPT 최단기간 합격 학습앱 — 개발·검증 플랜 (`plan.md`)

- **문서 버전:** 2.2 (구현 착수용 최종안. 2.2: 특정 등급에 한정된 식별자·명칭을 레벨 중립으로 정리, N3는 최초 목표 등급의 기본값) / 2026-10-16. 기존 Vite·React·localhost 상시 실행 설계를 대체하고 정적 HTTPS 단일 HTML 운영 방식을 기본안으로 확정한다.
- **일정 계산 기준일:** 사용자가 지정한 2026-10-15 / `Asia/Seoul`. 실제 앱은 실행 시점 날짜로 다시 계산한다.
- **근거:** `research_revised.md`, JLPT·한국 실시위원회·Google 공식 자료, 2026-10-16 사용자 추가 결정.
- **최종 배포 산출물:** **`index.html` 단일 파일(HTML+inline CSS+inline JS+최소 승인된 bootstrap 콘텐츠)**. 실행 시 Node, npm, Python, 로컬 HTTP 서버, 별도 JS/CSS 파일을 요구하지 않는다. 개발 저장소의 소스·테스트 파일은 여러 개여도 된다.
- **제품 사용 대상:** 한국어 모국어 성인, 하루 학습 예산 상한 60분, 목표 등급은 설정값이며 최초 목표는 N3, 이후 N2/N1로 확장.
- **기존 v5.x:** 완전 종료. 소스·데이터 구조 재사용을 전제로 하지 않는다.
- **범례:** `[공식 확인]` 공식 출처에서 직접 확인 / `[실무 제안]` 선택·검증할 엔지니어링 또는 학습 설계값 / `[미확인]` 근거 부족 또는 실환경 확인 전. 설계용 수치가 공식 통계로 읽히지 않도록 표시한다.

> **반드시 인식해야 할 제약:** `file:///.../index.html` 자체는 브라우저에서 열 수 있도록 만든다. **하지만 `file://`에서 Google Identity Services(GIS) 로그인 후 비공개 Sheets API를 호출하는 것은 공식 지원되는 브라우저 OAuth 방식이 아니다.** 이는 코드로 우회할 요구가 아니라 실행 환경에 관한 기술적 제약이다. 단일 HTML을 **정적 HTTPS 주소로 제공**하면 별도 애플리케이션 서버·백엔드·사용자 PC 서버 없이 GIS와 Sheets REST API를 사용할 수 있다. 로컬 파일 모드와 Google 연결 모드의 지원 범위를 명확히 분리한다. **제품 실행 방식은 정적 HTTPS 호스팅을 기본으로 확정한다. 다만 실제 GitHub 저장소·호스팅 URL·Google Cloud 설정은 사용자 소유 환경이므로 구현자가 권한 없이 생성·공개·배포하지 않는다.**

---

## 1. 결정사항 및 구현 착수 조건 — 5개 이내

| ID | 상태 | 결정·선택지 | 추천/확정·실행 규칙 |
|---|---|---|---|
| **D1 — 정본 저장소** | **사용자 확정: A** | A. Google Sheets 정본 + 로컬 캐시 / B. 로컬 정본+Sheets 백업 | **A 확정.** 원격에서 재조회·확인한 이벤트만 `SYNCED`; 미반영 이벤트는 기기에 `PENDING`. 학습 이력·설정·콘텐츠 모두 해당 시트 안에 보관한다. 단, 실행 모드가 파일 단독이면 Google 연결이 불가능하므로 **정본 반영 전 임시 상태**임을 명시한다. |
| **D2 — 시트 접근** | **사용자 확정: B** | A. `drive.file`+Google Picker / B. 링크만 입력+`spreadsheets` | **B 확정.** Picker **구현하지 않는다**. 사용자가 넣은 기존 Sheet ID를 대상으로 `https://www.googleapis.com/auth/spreadsheets` 권한으로 읽기·쓰기한다. 해당 권한이 사용자가 접근 가능한 스프레드시트에 광범위하게 적용되는 **민감 스코프**라는 동의 설명을 의무화한다. |
| **D3 — 시험 목표** | **사용자 확정: 연도·월** | `year`(연도) + `month`(7 또는 12)를 온보딩에서 입력, 설정에서 언제든 변경 | 최초 목표를 2027년 7월로 **강제하지 않는다**. 공식 발표 전 날짜는 해당 연도·월의 첫째 일요일 **예상**으로 계산하고, 공고 확인 시 `confirmedDate`를 별도 보관한다. 목표 변경은 계획만 재계산하고 과거 기록은 유지한다. |
| **D4 — 단일 HTML 실행 방식** | **구현 기본안 확정: B** | A. `file://` 단독: 로컬 샘플 학습·파일 백업만, OAuth·Sheets 자동 동기화 불가 / **B. `index.html` 단일 파일 + GitHub Pages 정적 HTTPS**: Google 로그인·Sheets 자동 동기화, 별도 앱 백엔드 없음 / C. Apps Script/별도 브리지: 추가 운영 구성 필요 | **B로 설계 확정.** Google 연동 사용 시 `https://<owner>.github.io/<repo>/`에서 실행한다. `file://` 직접 열기는 학습 미리보기·수동 백업 모드로 지원하되 OAuth를 호출하지 않는다. 실제 GitHub 계정/프로젝트/호스팅 공개·Cloud 인증 설정은 사용자가 직접 승인·진행해야 하는 **실환경 준비 작업**이지 아키텍처 미결정이 아니다. |
| **D5 — 음원·오프라인 정책** | **V0 개발 기본 정책 채택, V2 콘텐츠 승인 별도** | A. 평가 청해는 권리 확인된 검수 녹음, TTS는 연습만 / B. TTS만으로 평가(비추천) / 로컬 캐시는 best-effort와 JSON 백업 | **A로 V0~V1 설계 진행.** 검수 음원 준비 전 청해는 `미측정`; V2의 실제 음원 조달·호스팅·권리 승인 시 사용자 확인 필요. `file://` 로컬 영속성은 보장하지 않고 사용자 내보내기 지원. 출시 시 실제 파일 출처는 인수 게이트로 검증한다. |

**확정 변경 요약:** 실행 파일=단일 `index.html`, 사용자 PC에 별도 서버 설치·실행 필요 없음(HTTPS 정적 호스팅은 필요), **기존 개발용 Vite·React·React Router·Dexie 필수 의존 제거**. 시트 Picker 제거. 목표를 `연도/월`로 정규화. 어휘·문법·독해·문항을 앱 코드에서 분리해 **시트 데이터로 생성·수정·버전 확장**한다. 모바일 Chrome을 1차 대상 브라우저로 삼는다.

### 1.1 핵심 사실 재검증 기록

| 전제 | 판정 | 실제 근거 | 플랜 적용 |
|---|---|---|---|
| N3 시험 30분·70분·40분 | **검증됨** | [JLPT 시험 구성](https://www.jlpt.jp/e/guideline/testsections.html) | 표시/선택적 실전 모드에만 사용. 기본 퀴즈 시간제한 없음. |
| N3 95/180점 이상 및 세 영역별 19/60 이상 | **검증됨** | [JLPT 점수·합격](https://www.jlpt.jp/e/guideline/results.html) | 공식 기준 안내. 자체 정답률을 척도점수나 합격 확률로 환산 금지. |
| N4/N5의 성적표는 지식+독해 통합 120점, 청해 60점 | **검증됨** | [JLPT 점수·합격](https://www.jlpt.jp/e/guideline/results.html) | 레벨별 `ScoringSection` 분리. |
| 2027년 한국 7/4·12/5 시험 **확정** | **확인 불가** | [한국 시험관리규정](https://www.jlpt.or.kr/html/information_06.html), 첫째 일요일은 원칙이며 공고로 확정 | 날짜는 예상으로 계산. 사용자 목표 입력은 날짜가 아닌 **연도/월**. |
| 2027년 접수일·수험료 확정 공고 | **확인 불가** | [한국 JLPT 안내](https://www.jlpt.or.kr/) | 발표 확인 전 '미확인'. 허구 날짜 생성 금지. |
| `spreadsheets` 스코프 = 링크로 지정한 기존 파일을 접근·수정하는 데 사용 가능 | **검증됨(단, 사용자의 해당 파일 권한 필수)** | [Google Sheets OAuth 범위](https://developers.google.com/workspace/sheets/api/scopes) | D2=B, 범위는 **Sensitive**. 파일별 제한 스코프가 아니다. |
| `drive.file`만으로 링크 입력된 모든 기존 Sheet에 바로 쓰기 가능 | **불일치** | [Google Drive 파일별 승인](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) | 이번 버전에서는 `drive.file`/Picker 제거. |
| GIS Token Model은 등록된 HTTPS/localhost origin에서 동작 | **검증됨** | [GIS Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [OAuth Origin 규칙](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow) | 백엔드 없이 HTTPS static origin에서 직접 REST 사용 가능. |
| **`file://`에서 같은 GIS 권한 흐름을 정상 사용** | **불일치** | [Google JS API FAQ](https://google.github.io/google-api-javascript-client/docs/faq.html), [Origin 규칙](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow) | `file://`은 API 로그인 기능 숨기고 로컬 모드 안내. `null` origin 예외나 토큰 복사 등 우회 금지. |
| `file://`의 브라우저 영속 저장이 모든 데스크톱/Android Chrome에서 안정적으로 유지 | **확인 불가** | [MDN localStorage: file URL 동작 미정의](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage), [MDN file origin](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy) | 기능 감지·파일 백업, Chrome Android 실기기 테스트. `file://` 데이터 보존 보증 금지. |
| 한국어 화자 250~350시간 N3 합격 및 원점수→합격확률 변환 | **확인 불가** | `research_revised.md` §3·§7 | 학습 계획 공식에 넣지 않는다. |

**실행 모드 결정표(아키텍처 계약):**

| 기능 | `file://` 단일 HTML | 동일 HTML의 정적 `https://` 실행 |
|---|---|---|
| 화면, 승인된 bootstrap 샘플, 일부 진단, 퀴즈 | **가능하도록 구현**. 모바일 로컬 파일 열기는 실기기 QA 필요 | **가능** |
| Google 계정 OAuth | **지원하지 않음** | **GIS Token Client** |
| 링크 입력으로 개인 Google Sheets 읽기·쓰기 및 자동 초기화 | **지원하지 않음** | **지원 대상**(Google 동의·실제 권한·실환경 테스트 필수) |
| 신규 단어/문항을 Sheet에서 읽어 즉시 학습 | 시트 직접 접근 불가. JSON/TSV 수동 가져오기로만 일부 대체 | **지원 대상**(승인된 콘텐츠 pack만 사용) |
| 학습 상태 영속성 | 브라우저가 허용하는 경우 캐시; **안전 보장 불가**. 명시적 백업 필수 | IndexedDB 캐시 + Sheets 정본, 복원 가능 |
| Android Chrome 지원 | **HTML 파일 열기/저장 API 동작은 실기기 확인 전 미확인** | **중점 지원 대상**, HTTPS Origin에서 실기기 OAuth·학습·복원 QA |

> **구현자 경고:** 사용자에게 '서버가 전혀 없어도 파일 더블클릭만으로 Google 로그인+Sheets 자동 동기화가 된다'고 광고하거나 그런 테스트에 `PASS`를 부여하지 않는다. 최종 한 파일을 HTTPS에서 정적으로 제공하는 것은 **웹 애플리케이션 서버 실행과 다르지만, 외부 정적 호스팅 자체는 필요**하다.

---

## 2. 제품 정의

### 2.1 목표·비목표

- **목표:** 기초가 불확실한 학습자를 짧은 배치 진단으로 출발 경로에 연결 → 일일 최대 60분 학습 → 지연 복습·문장형 문법·독해·청해 훈련 → 미노출 문제로 영역별 준비도 추적. 목표 등급은 설정값이며 최초 목표는 N3, 이후 N2/N1을 추가.
- **사용자 제어:** 목표 회차(연도/월) 수시 수정, 하루 예산(상한 60분 고정), 시간제한 기본 OFF, 후리가나·글자크기, 콘텐츠 팩 설치·비활성화, Google 연결·해제, 로컬 JSON 백업.
- **데이터 소유:** 지정한 Google Sheet 안에 학습 로그·개인 설정뿐 아니라 콘텐츠·팩 메타데이터도 별도 앱 탭으로 영속화. HTML 교체는 데이터 초기화를 일으키지 않는다.
- **비목표:** v5.x 이전 코드 마이그레이션, 자체 Google 인증 서버, Cloud Run/Functions/Apps Script 백엔드 필수 구성, 공식 JLPT 문제·음원 재배포, 학습시간/합격률 보장, 검증 전 공식 척도점수·합격 확률 출력, 대규모 사용자용 중앙 DB.
- **성공지표:** Google Sheet 최초 연결/초기화 및 복원 성공, 앱 버전 바꿔도 개인정보·풀이기록·콘텐츠 유지, 학습 완료·영역별 처음 보는 평가 정확도, 60분 내 계획 실행률, 모바일 UX 계약 통과, HTML 전달 파일 1개.

### 2.2 사용자 여정 — 두 실행 모드 분리

**Google 연동 모드(동일 `index.html`의 HTTPS URL, 기본 실행 경로)**

1. Chrome(Android·PC)에서 고정 HTTPS 주소를 연다. 앱은 빌드 버전과 연결 상태를 표시한다.
2. **'Google 계정으로 연결'** 버튼을 누르면 GIS가 `spreadsheets` 및 필요한 최소한의 계정 식별 권한을 요청한다. 민감 스코프 설명을 사용자가 확인한다.
3. Google Sheet 전체 URL을 붙여넣는다. Spreadsheet ID를 파싱하고 실제 `spreadsheets.get`/쓰기 가능 상태를 검사한다. Picker는 뜨지 않는다.
4. 사용자가 새 시트 초기화에 동의하면 앱 전용 `_JLPT_*` 탭만 생성하고 **작고 검수된 bootstrap 콘텐츠**를 해당 시트에 등록한다. 기존 사용자 탭·셀은 수정하지 않는다. 이미 초기화된 시트는 덮어쓰지 않고 schema·콘텐츠 버전만 검증한다.
5. 초기 설정에서 **목표 `연도/월`(예: 2027년 12월)**을 입력하고 가나/기초/목표 등급(최초 N3) 문맥/독해 간이 진단을 수행한다. 평가 음원이 없는 청해는 **'미측정'** 처리한다. 계획이 60분을 초과하지 않게 생성한다.
6. 사용자는 문항을 풀고 **'정답 확인'**을 누른 뒤 같은 4선지 레이아웃에서 개별 오답 교정을 확인한다. **'다음 계속하기'**로만 전진한다.
7. 풀이·설정·학습시간·목표 변경은 먼저 로컬 outbox에 기록되고 Sheets 재조회 확인 후 `동기화 완료`로 바뀐다.
8. HTML을 새로운 릴리스 파일로 교체하거나 모바일에서 다시 열어도 **같은 Sheet URL로 재연결**하면 목표·폰트·후리가나·학습 이력·콘텐츠 확장을 재구성한다.

**로컬 파일 모드(`file://`)**

- HTML을 직접 열면 `로컬 모드` 배지와 `Google 자동 저장은 HTTPS 실행에서만 지원` 메시지가 먼저 표시된다. OAuth 호출 버튼을 실동작하는 듯 노출하지 않는다.
- embedded bootstrap 진단/샘플만 수행할 수 있다. Sheets에서 확보한 JSON/TSV 데이터 가져오기 및 백업 파일 내보내기는 지원할 수 있지만, **직접 Sheet에 쓴 것처럼 표시하지 않는다**.
- 로컬 저장 API 검사 실패나 불확실성일 때는 '현재 실행에서만 유지됨 — 백업 권장' 경고와 내보내기 버튼을 항시 표시한다. `file://`이 다른 경로로 복제되면 저장소가 동일하다고 가정하지 않는다.
- `file://`에서 만든 풀이를 나중에 HTTPS 모드로 **사용자가 명시적으로 백업 파일을 가져와 합치는** 경로를 V1에 제공한다. 중복 이벤트 ID는 한 번만 적용한다.

### 2.3 제품 가설(검증 전)

| 가설 | 관찰 지표 | 실패 대응 |
|---|---|---|
| 초기 진단이 획일적 목표 등급 시작보다 무리 없는 출발을 돕는다 | 재학습 발생률·미노출 후속 문제 결과 | 컷오프/진단 폼 개정 |
| 예정 복습 우선과 일일 60분 상한이 과부하를 줄인다 | 예정 카드 잔량·7일 실학습률 | 신규 카드 조절·분배 재설계 |
| 한국어 화자에 특화한 오답별 교정이 도움이 된다 | 오개념 태그별 신규 문장 정답률 | 피드백 재검수 |
| Sheet 안의 데이터/콘텐츠 분리가 앱 용량을 억제한다 | `index.html` 실측 용량, 팩 로딩량, 신규 콘텐츠 추가 시 HTML 해시 불변 | 데이터 정규화·시트 range 최적화 |
| '확률' 대신 증거 기반 준비도가 오해를 줄인다 | 화면의 수치 오해율·평가 커버리지 | 용어·설명 조정 |

### 2.4 모든 버전에 적용되는 UX 불변조건

1. **시간 제한 기본 없음:** 진단·연습·문법·독해·평가의 기본 `timeLimitSeconds=null`. 사용자 선택 세트만 제한 시간 적용. 기기 화면이 꺼져도 자동 오답 처리 금지.
2. **수동 진행:** 답을 제출한 후 `FEEDBACK`에 머무른다. 반드시 **'다음 계속하기'**를 눌러야 다음 문제로 이동. 자동 전환·자동 확인 금지.
3. **정답 직접 노출 금지:** 제출 전 정답 색·밑줄·후리가나·오디오 제목·보기 순서/패턴·ARIA 속성으로 정답을 표시하지 않는다. 소스/Sheet 자체를 들여다보는 공격 방지는 비목표.
4. **동일한 질문·해설 구성:** 단일 `QuizShell` 안에서 상태만 전환한다. 항상 4개의 선택지를 같은 폰트 크기로 표시하고 해설 상태에서도 보기 수를 줄이지 않는다.
5. **모바일 한 화면:** 문제/해설 각 현재 페이지는 세로 스크롤 없이 뷰포트에 들어가야 한다. 긴 지문·상세 해설은 **페이지 버튼/탭으로 나누되 4선지 영역과 액션을 고정**한다. 폰트를 자동 축소하지 않는다. 320×568·360×640·390×844에서 자동+실기기 확인.
6. **오답 3개의 개별 교정:** 각 오답에는 `whyWrong` + `howToCorrect`가 있어야 한다. 사용자는 해설 화면에서 4개 선택지를 모두 보고 해당 보기를 눌러 이유·수정 예문을 확인한다.
7. **설정:** 최소 4단계 글자 크기(`S/M/L/XL`), 후리가나(`ALWAYS/STUDY_ONLY/HIDDEN`)를 모바일에서 조작·저장·원격 복원한다.
8. **문맥형 문법:** 문말 형태만 비교하면 정답이 드러나는 문제 금지. 상황·행위자·조사·시제/연결형·의미 대비의 문장 맥락을 검수.
9. **접근성:** 주요 터치영역 44 CSS px 이상(제품 UX 기준), 키보드 포커스, 스크린리더 상태 알림, reduced-motion, Android Chrome safe-area 적용.
10. **내구성:** 답 제출/선택지 노출 이벤트는 화면 이동 전에 로컬 기록을 시도한다. 캐시 사용 불가 시 사용자에게 백업 필요를 알린다. 온라인 원격 저장 실패를 `동기화 완료`로 표시하지 않는다.

---

## 3. 버전 로드맵 — 최종 산출물은 항상 HTML 1개

| 버전·태그 | 핵심 목표 | 포함 기능 | 완료 기준 |
|---|---|---|---|
| **V0 `v0.1.0`** | **단일 HTML 실행 → 목표 연도/월 → 배치 진단 → 일일 60분 계획 → 새 Google Sheet 초기화·복원** | 바닐라 JS SPA 상태기계, 소형 bootstrap 팩, 로컬/HTTPS 모드 감지, Google `spreadsheets` 직접 URL 연결(HTTPS), `_JLPT_*` 초기화, 28문항 기초 진단(청해 미측정), 60분 배분, 백업/복원, 모바일 QuizShell | `dist/index.html` 외 **런타임 파일 0개**. PC file 모드 진단/플랜 가능. 모바일 Chrome **HTTPS**에서 OAuth 실계정 시트 초기화·쓰기·재읽기/복원 성공. 목표 변경으로 기록 삭제 0건. `file://` OAuth는 의도대로 차단. 사용자 소유 Cloud·HTTPS 테스트 환경 미구성 또는 실계정 E2E 미검증 시 Google 연동 완료/정식 태그 금지. |
| **V1 `v1.0.0`** | 학습 루프가 매일 돌아가는가 | SRS 카드·한자어 독음·문맥 문법, 신규 콘텐츠/팩 가져오기·검수·활성화, 일본어 오개념 교정, 주간 재편성, 로컬 백업 HTTPS 가져와 병합 | HTML 재빌드 없이 Sheets에 승인 콘텐츠를 추가하고 다음 동기화에서 사용. SRS/목표/폰트 등 원격 복원, 중복 집계 없음. |
| **V2 `v2.0.0`** | 독해·청해가 모바일에 적합한가 | 단·중·장문/정보검색, 검수 오디오·음원 링크, TTS 연습, 검수된 청해 진단 추가, 본문 페이징 | 검수 오디오만 평가에 사용, 오디오 품질 모바일 실기기 QA, 한 화면 4선지·해설 유지. 미검수는 '미측정'. |
| **V3 `v3.0.0`** | 학습 상태/준비도가 실제 데이터로 설명 가능한가 | 최초 노출 평가 전용 문제, 채점영역별 정답률·표본·커버리지·시간, 불확실성, 상대 취약영역/19점 기준 설명 | 공식 점수·합격확률 수치 생성 0회. 평가 격리·신규성·이벤트 리플레이 검증. |
| **V4 `v4.0.0`** | 장기 콘텐츠 운영과 업그레이드에 견딜 수 있는가 | 시트 대용량 최적화, 콘텐츠 정정·폐기, 스냅샷/복구, 스키마 마이그레이션, 다중기기 충돌 UX | 이전 각 버전 저장 기록/콘텐츠/설정 보존, 시트 데이터 손실 0건, HTML 파일 크기 추적·회귀 통과. |
| **V5+ (별도 승인)** | N2/N1 확장 | 레벨별 시험·커리큘럼·진단/평가 팩, 누적 학습 경로 | 새 레벨 콘텐츠만 시트에 추가해 확장. 기존 등급(N3 등) 기록/UX 역호환. |

**V0 범위 제한:** 목표 등급 전체 커리큘럼 완성/합격 확률 계산/SRS 최적화는 하지 않는다. 28문항은 **진단 라우팅을 위한 소표본**이며 공식 표준이 아니다. 청해 검수 음원 준비 전 V0에는 청해 세부 능력 미측정을 표시한다. 콘텐츠를 늘리는 작업은 앱 JS의 정적 배열을 수정하는 대신 **Sheet의 콘텐츠 테이블**을 편집·가져오기 하는 작업이 되게 한다.

**개발 순서:** T00 런타임 P0 검증 → T01 단일 파일 빌드 → T02 스키마·seed → T03 모바일 QuizShell → T04 로컬 안전 저장 → T05 HTTPS GIS/Sheets → T06 시트 원격 이벤트·콘텐츠 로딩 → T07 진단·목표/계획 → T08 통합 QA/V0 → V1 이후 확장. P0 오류를 임시 해킹으로 우회하지 않는다.

---
## 4. 학습 설계

### 4.1 배치 진단 — 시작 수준 불명·V0 경량화

- 첫 실행 시 수준을 묻는 별도의 주관식 설문에 의존하지 않는다. 진단은 **처음 보는 오리지널 문항**으로 진행한다. 무제한 시간 기본값, 중단·재개 가능, 실제 풀이시간은 해당 날짜 60분에서 공제한다.
- 진단 결과는 **학습 시작 경로**이며 JLPT 공식 수준·합격 가능성·척도점수와 무관하다.
- V0 bootstrap 패키지는 **28문항**으로 고정해 최초 실행 가능성과 파일 용량을 함께 검증한다. **28은 엔지니어링 콘텐츠 제작 목표량이지 공식 표본 기준이 아니다.**

| 묶음 | 개수 | 확인 능력 | 추가 정보 |
|---|---:|---|---|
| `KANA` | 8 | 히라가나·가타카나 혼동쌍, 탁음·요음, 촉음·장단음 | 4선지. 음원 없이도 가능. |
| `FOUNDATION_N5_N4` | 8 | 조사·활용·문장 순서·기초 의미 차이 | 문장형 4선지. |
| `TARGET_LANGUAGE` | 6 | 목표 등급형(최초 N3) 어휘·문법 문맥 판단 | 한 어미만 보고 맞힐 수 없어야 함. |
| `TARGET_READING` | 6 | 오리지널 단문·정보검색 지문 2개 × 3문항 | 같은 지문 내 공통 `stimulusId` 기록. |
| `TARGET_LISTENING` | **V0 0(미측정)** | 검수 녹음 확보 후 별도 청해 진단 추가 | TTS만으로 정량 진단 대체 금지. |
| **V0 합계** | **28** | 3개 시작 경로를 가결정 | 오디오 영역과 일부 목표 등급 능력은 측정 부족 경고. |

**초기 라우팅 의사 규칙 `[실무 제안]`:**

```text
if KANA answered < 8 or FOUNDATION answered < 8:
    route = PROVISIONAL; resume unfinished diagnostics
else if KANA correct <= 6 of 8:
    route = KANA_FOUNDATION
else if FOUNDATION correct <= 5 of 8:
    route = FOUNDATION
else:
    route = TARGET_FOCUS

routeEvidence = 'PROVISIONAL'  # 목표 등급 전체 검증이 아니라 출발 경로 참고
listeningEvidence = 'NOT_MEASURED'  # V0은 항상 이 상태
borderline = (KANA correct == 7) or (FOUNDATION correct == 6)
if borderline: suggest optional additional diagnosis (V1 확장팩, 자동 강제 금지)
```

- 재진단 확장팩(제안): 가나 4·기초 4·목표 등급 언어 3·독해 3·청해 3(청해는 검수 음원 필수). **V0 필수 아님**. 각각 최초 폼과 정답·지문·오디오 노출을 공유하지 않는다.
- 진단에 답변한 문항·이미 본 지문(`stimulusId`)은 후속 **미노출 평가**에 재사용 금지. 첫 화면 렌더 직전에 `QUESTION_PRESENTED` 이벤트 저장을 시도한다.
- 진단 결과로 자동 목표 연도/월 변경 금지. 초급 경로여도 설정된 목표 등급은 유지하고, 현실적 학습 증거 부족을 설명한다.

### 4.2 영역별 학습 루프

| 영역 | 학습·인출·교정·재시험 루프 | 저장할 지표/한국어 화자 취약점 | 출시 버전 |
|---|---|---|---|
| **가나** | 1글자·음가 익히기 → 모양 혼동 선택 → 실단어에서 읽기 → 며칠 뒤 재인출 | `kanaPairId`, 독음 정확도, 장음·촉음·요음; `シ/ツ`, `ソ/ン` | V0 진단, V1 학습 |
| **어휘·한자** | 한자+일본어 독음+한국어 뜻+문맥 예문 → 뜻/읽기/듣기 채널별 인출 → SRS 예약 → 새 문장에서 재검증 | 카드·방향별 리뷰 이벤트, 훈독 `KUN_READING`, 동형이의어 `KO_FALSE_FRIEND` | V1 |
| **문법** | 상황 제시 → 문형 의미·접속형 → 문장 내 4선지 → 정답·오답 3개 교정 → 유사 문형 신규 예문 | 조사 직역 `KO_PARTICLE_TRANSFER`, 자동/타동 `KO_TRANSITIVITY`, 문형 뉘앙스 `GRAMMAR_NUANCE` | V1 |
| **독해** | 단문 → 중문 → 장문 → 정보검색. 질문과 지문 확인, 주장·근거 찾기 → 선택지별 반박 → 새 지문 평가 | `stimulusId`, 근거 `evidenceSpan`, 완료시간, 처음 보는 지문 여부 | V0 일부, V2 확장 |
| **청해** | **검수된** 음성 1회 → 답변 → 해설/스크립트 → 반복·선택적 섀도잉/딕테이션 → 다른 음원 평가 | 첫 회 청취 기록, 반복횟수, 정보 놓침 유형; TTS 연습 결과는 평가 정확도로 합산 금지 | V2 |

**표준 오개념 태그:** `KO_FALSE_FRIEND`, `KO_PARTICLE_TRANSFER`, `KO_TRANSITIVITY`, `KUN_READING`, `VOWEL_LENGTH`, `SOKUON_YOON`, `GRAMMAR_NUANCE`, `KOREAN_SOV_OVERGENERALIZATION`. 수정하고 다시 푼 **동일 문항 정답**은 신규 평가 성과로 계수하지 않는다.

### 4.3 일일 60분 배분 — 구현 가능한 결정적 정책

**시간의 뜻:** `dailyBudgetMinutes=60`은 계획 상한. 시험 합격에 필요한 시간 추정치가 아니다. 진단·해설·복습·실제 음성 연습 시간 모두 소비분에 포함한다. 타이머가 'OFF'여도 **활성 학습시간 측정은 가능**하다. 탭이 숨김 상태이거나 일정 시간 조작·재생이 없으면 활성시간 누적을 멈춘다. 유휴 판별 임계값은 V0 설정으로 보관하고 실기기 검증 전에는 [실무 제안]이다.

**기본 루트별 분할([실무 제안], 실제 제공 가능한 콘텐츠에 따라 축소/전환):**

| 경로 | 가나 | 어휘·한자 | 문법 | 독해 | 청해 | 합계 |
|---|---:|---:|---:|---:|---:|---:|
| `KANA_FOUNDATION` | 10 | 15 | 20 | 5 | 10 | 60 |
| `FOUNDATION` | 0 | 20 | 20 | 10 | 10 | 60 |
| `TARGET_FOCUS` | 0 | 20 | 15 | 15 | 10 | 60 |

**분배 실제 동작:**

1. `remainingSeconds = max(0, 3600 - activeStudiedSecondsToday)`, `availableMinutes = floor(remainingSeconds/60)`.
2. 루트별 기본 분할에서 시작하고, 평가 미측정 영역의 우선순위는 안전상 '자료 부족'으로 표시한다. 해당 영역의 **학습 가능한 콘텐츠가 없으면** 시간을 거짓 '완료'로 기록하지 않는다.
3. V0은 bootstrap에 없는 청해 10분을 **실제 가능한 어휘·문법·독해**에 다시 배분한다. 사용자에게 `오늘의 청해는 콘텐츠 준비 중으로 제외`를 보여 준다. 따라서 하루 계획 합계는 학습 자산이 충분할 때만 정확히 60분이고, 콘텐츠 부족 시 **60분 미만도 허용**한다.
4. V1 SRS 도입 후: 당일 `due` 카드 예상 복습을 신규 카드보다 우선. 카드당 처리 시간은 개인의 최근 관찰값을 사용하고 데이터 없으면 콘텐츠 팩 초기 추정으로 시작한다. 미완료 복습이 하루 예산을 압박하면 신규 학습량을 0으로 줄인다.
5. V1부터 `dueSrsMinutes > 25`인 날 신규 카드를 만들지 않는 정책을 **제품 초기 실험값**으로 채택. 학습된 `dueAt`을 강제로 뒤로 미뤄 '복습 부담 0'으로 만들지 않는다.
6. V3 이후 미노출 평가 데이터가 유효할 때만 취약 영역에 추가 시간을 부여. 예시 우선순위 `priority_s = 1 + 0.5×(1-accuracy_s) + 0.25×staleness_s`는 **운영 가설**이며, `accuracy_s` 표본이 없으면 `unknown`으로 표시하고 속임수 0점을 만들지 않는다.
7. 소수 분 배분은 최대 나머지 방식과 고정 동률 순서(`청해→독해→문법→어휘`)로 결정적 보정. `Σminutes ≤ availableMinutes`, 음수 금지, 실제 데이터가 없는데 진행률 100% 표시 금지.
8. 일일 결과·주간 계획은 별도 `PlanRevisionEvent`로 추가. 이미 종료된 날짜를 현재 알고리즘으로 덮어쓰지 않는다. 목표 회차가 바뀌어도 종전 학습 이벤트·SRS 스케줄은 계속 유지한다.

**V1 신규 항목 상한([실무 제안]):** `KANA_FOUNDATION=5`, `FOUNDATION=10`, `TARGET_FOCUS=15`개/일. 실제 복습 잔량·새 카드 학습시간 관찰로 줄일 수 있고 고정 학습 효과를 주장하지 않는다.

### 4.4 목표 연도/월 입력·예상 시험일 산출·변경 이력

**UI 계약:** `목표 급수: targetLevel`(V0 기본값 N3, 콘텐츠가 있는 등급만 선택 가능, 변경해도 기존 기록 유지) + `연도: YYYY` + `회차: 7월 / 12월`. 저장 버튼은 `목표 변경`이며 어떤 시점에도 설정 화면에서 접근 가능하다. 최초 시작 시 사용자의 선택이 없으면 `targetYear=null`, `targetMonth=null`로 유지하고 날짜 없는 일반 60분 플랜만 보여 준다.

**논리 필드:**

```text
ExamTarget = {
  level: 'N5'|'N4'|'N3'|'N2'|'N1',   // 목표 등급(설정값, 기본 'N3')
  targetYear: integer|null,
  targetMonth: 7|12|null,
  expectedExamDate: YYYY-MM-DD|null,   // 규정상 첫째 일요일을 계산한 예상일
  confirmedExamDate: YYYY-MM-DD|null,  // 해당 회차 공식 공고 확인 후에만 입력
  dateStatus: 'NOT_SELECTED'|'EXPECTED'|'CONFIRMED',
  sourceUrl: string|null,
  sourceVerifiedAt: string|null,
  changedByEventId: string|null
}
```

- 첫째 일요일 예상일 계산: `firstDay=LocalDate(year,month,1)`, `delta=(7 - ISOweekday(firstDay)) mod 7`, `expected=firstDay+delta days`(일요일 ISOweekday 7). 이 계산은 **일정 예측 규칙**이지 공고 확정이 아니다.
- UI 예: `목표: 2027년 7월 (예상 7월 4일 / 공식 미확정)`. `2027년 12월 → 예상 12월 5일`도 동일 규칙. 월말/시간대 변동 버그 방지를 위해 시간대 기준 날짜만 산출하고 UTC 시각을 표시용 날짜로 사용하지 않는다.
- `effectiveDate = confirmedExamDate ?? expectedExamDate`, `eligibleDays = max(0, 시험 전날까지의 공부 가능 날짜 수; 오늘 포함, 쉬는 날 제외)`, `maximumRemainingMinutes = eligibleDays × 60`. 실제 수행 가능/합격 가능 시간으로 이름 붙이지 않는다.
- 2026-10-15부터 `2027-07-04`는 **262일·최대 262시간**, `2027-12-05`는 **416일·최대 416시간**(일일 1시간, 전일 가능하다는 산술 상한). 시험 접수 기한과 합격 보장은 이 계산에 들어가지 않는다.
- 목표 연도/월 변경 시 `EXAM_TARGET_SELECTED` 이벤트를 append하고 미래 계획만 재산정한다. 진단 응답·이전 계획·오답·카드·설정·Sheet 연결은 그대로 둔다. 여러 기기에서 목표가 충돌하면 자동 최종승자 선택 대신 사용자 확인 화면을 표시한다.
- 사용자가 지난 시험 회차를 미래 목표로 저장하려 하면 `선택 회차가 이미 지났습니다`로 안내하고 다른 회차를 선택하게 한다. 과거 회차의 공식 성적 입력은 별도 기록으로 허용한다.

---

## 5. 콘텐츠 전략 — **Sheet를 학습 콘텐츠 CMS로 사용**

### 5.1 저장 위치·초기화 방식

1. 앱의 HTML 안에는 **최초 동작을 검증할 작은 승인된 bootstrap pack만** 넣는다. V0 목표 분량은 위 28문항 + 시범 어휘 카드 8개 + 시범 문맥 문법 4개다. **실제 제작·검수 완료 전에는 완료 수량이라고 표시하지 않는다.**
2. 사용자가 빈 Google Sheet에 HTTPS 모드로 연결하고 **'학습 저장소 초기화'**를 승인하면 앱은 `_JLPT_*` 전용 탭을 생성한 다음 bootstrap pack을 버전·권리 정보를 포함해 저장한다. 이 작업은 **비파괴적이고 재실행해도 중복 추가되지 않아야** 한다.
3. 최초 설치 후 앱의 정식 학습 콘텐츠 출처는 **시트의 승인된 `ContentRecord`/`ContentPack`**. HTML 안 bootstrap은 복구·초기설치용만 사용. 동일 ID·동일 버전·동일 해시가 이미 있으면 다시 저장하지 않는다.
4. 사용자가 **시트에 단어·문법·문제 행을 추가**하거나 앱의 **'콘텐츠 가져오기'**에서 JSON/TSV 파일을 임포트하면, 앱이 스키마·라이선스·정답·개별 보기 해설을 검수하고 승인된 새 팩만 활성화한다. **기존 HTML을 재빌드할 필요가 없다.**
5. Sheet에 임의로 행을 넣기만 하면 '학습용 검수 통과'로 자동 승격되지 않는다. 상태 `DRAFT` → `VALIDATED` → `APPROVED` → `PUBLISHED`; 승인자/일시/해시 기록. `PUBLISHED`가 아니면 학습 화면에서 제외. 사람이 일본어·출처를 최종 검수해야 한다.
6. 앱 코드의 데이터셋은 레벨별 시험 구조·UI 계약·콘텐츠 스키마와 작은 seed로 국한한다. N3/N2/N1 어휘 목록 전체를 소스 코드/HTML에 하드코딩하지 않는다.

**초기 bootstrap을 없애려면** 사용자가 직접 빈 시트를 사전 구성해야 하므로 첫 실행 UX가 무너진다. 따라서 V0 seed를 HTML에 내장하는 것은 의도적 절충이다. V0 내장 수량과 파일 크기를 실측·리뷰한 뒤 축소할 수 있지만, **검수되지 않은 생성형 문제를 자동 무한 생성해 이 결손을 숨기지 않는다.**

### 5.2 콘텐츠별 구조·추가 절차

| 종류 | Sheet 레코드 필수 콘텐츠 | 앱에서 동적으로 추가할 때 |
|---|---|---|
| `KANA` | 가나·읽기·혼동쌍·오답 이유·교정 | 기존 `kanaId` 유지, 새로운 문제 `questionId`는 유일 |
| `VOCAB` | 일본어 표기, 히라가나 읽기, 한국어 뜻, 사용 예문, 한국어 화자 오개념 태그, 카드 방향 | 레벨 태그는 **교육용 추정**, 공식 출제 리스트 아님 |
| `KANJI` | 한자·대표 어휘·음독/훈독 어휘 연계, 예문 | 한자 단독 발음보다 어휘 맥락 중심 |
| `GRAMMAR` | 문형, 접속, 맥락, 정답 1·오답 3 선택지와 개별 이유·교정 | '어미 차이만' 문제 content-lint 차단 |
| `READING` | 지문/페이지/근거구절, 연결된 문항, 유형(단·중·장/정보검색) | 지문과 문제의 `stimulusId` 공통. 노출 이력 연계 |
| `LISTENING` | 원본 대본, 검수 오디오 URL/미디어 ID, 사용 허락, 화자·길이, 선택지·해설 | **음성 바이너리는 Sheet 셀에 저장하지 않음**. 링크/메타만 Sheet에 저장. 안전하게 접근 가능한 미디어 호스팅·권리 확보 필요 |
| `ASSESSMENT` | 평가 전용 문항·폼 ID, 표본/학습 노출 금지 정책 | 평가 전용 팩은 일반 학습/정답 확인 노출에서 격리 |

**콘텐츠 버전 정책:** `packId`, `packVersion`(SemVer), `contentId`, `contentVersion`, `contentHash`, `curriculumLevel`, `reviewStatus`, `sourceId`, `licenseId`, `publishedAt`. 문항 정답/의미가 바뀌면 이전 행 덮어쓰기 대신 새 **불변 버전 행**을 추가하고 현재 활성 버전 포인터만 변경한다. 기존 풀이 이벤트는 이전 버전을 참조하므로 히스토리가 사라지지 않는다.

**유효성 검증:** JSON 파싱·필드 필수성, 동일 키 충돌, 4선지 정확히/정답 하나, 오답 세 개 모두 원인+교정, 특정 보기 힌트 누설, 레벨·태그, 평가 노출 격리, 문자열 길이/페이지 분할, 출처·라이선스 확인, 오디오 정책. **Sheet 콘텐츠는 외부 입력으로 취급하며 HTML 문자열을 그대로 `innerHTML`에 대입 금지**.

### 5.3 오리지널 문항 제작·승인 파이프라인

`학습 목표·형식 설정 → 오리지널 초안 → 정답 1개 및 문맥 점검 → 오답 3개 이유·교정 작성 → 자연스러운 일본어/한국어 대비 검수 → 저작권/사용 허락 → 스키마·의미 검증 → 승인된 pack 등록 → Sheet PUBLISHED 활성화 → 신규 평가 격리 검증`.

- 공식 문제집은 **시험 형식 참고**로만 사용. 문제/지문/보기/음원/책 해설을 앱 HTML이나 Sheet에 복사하지 않는다.
- 외부 사전/어휘 목록을 도입하면 프로젝트·리포지토리·시트에 허가 근거, 레벨 매핑 방법, 재배포 허용 여부를 기록. 무근거 'N3 공식 단어장' 등 레이블 금지.
- 편집 권한 있는 Sheet 사용자가 `APPROVED`를 직접 기입할 수 있다는 것이 언어·저작권 심사 완료 증거는 아니다. 별도 승인 기록(`reviewer`, `reviewDate`, `licenseEvidence`)을 함께 확인해야 한다. 앱은 콘텐츠 자체의 진위를 암호학적으로 입증하지 않으며 **승인 관리 정책은 운영 가설**이다.
- 콘텐츠 볼륨 목표([실무 제안]): V0 28문항+8카드+4문법, V1 어휘 80개/한자연계 16개/문법 32개 추가, V2 독해 8지문·검수 청해 20문항 추가, V3 채점 영역별 신규 평가 20문항 이상(총 60문항 이상). 이 수치로 목표 등급의 실제 출제 커버리지를 주장하지 않는다.

### 5.4 음원·용량 전략

- `speechSynthesis`/`ja-JP` TTS는 **발음 확인·연습** 용도. 장음/촉음/억양/동음다독·문장 연속 발화는 플랫폼별 실청취 QA 필요. 히라가나 치환이 항상 발음을 100% 고친다는 주장은 금지.
- 진단·평가 청해는 **권리·대본·독음·억양 검수가 완료된 녹음**만 허용한다. 오디오가 없으면 그 영역 `NOT_MEASURED`; TTS를 점수 생성에 쓰지 않는다.
- HTML에 대용량 WAV/MP3/base64 오디오를 포함하지 않는다. Sheet에 `mediaId`, `mediaUrl`, `rights`, `hash`, `scriptVersion`, `reviewer`를 기록한다. URL은 사용자·브라우저에서 실제 접근할 수 있는지 확인; **민감 `spreadsheets` 권한만으로 비공개 Google Drive 파일 오디오를 읽을 수 있다고 가정하지 않는다.** 권리 있는 공개/제한 링크 공급방식은 V2 외부 의사결정.
- HTML/정적 리소스는 별도 서비스워커/PWA 번들을 **필수로 요구하지 않는다**. offline media도 기본 제공을 보장하지 않는다. 모바일 데이터 사용을 줄이기 위해 오디오 재생은 사용자가 클릭할 때 로드한다.

---
## 6. 데이터 모델 — 시험 스펙·개인 기록·콘텐츠를 분리

### 6.1 레벨별 시험 템플릿 `[공식 확인]`

```text
Level = 'N5'|'N4'|'N3'|'N2'|'N1'
TestSection = 'VOCAB'|'GRAMMAR_READING'|'LANGUAGE_READING'|'LISTENING'
ScoringSection = 'LANGUAGE_KNOWLEDGE'|'READING'|'LISTENING'|'LANGUAGE_KNOWLEDGE_READING'
ExamSpec = {
  level, testSections:[{id:TestSection,timeMinutes}],
  scoringSections:[{id:ScoringSection,maxScaledScore,officialSectionalPassMark}],
  officialOverallPassMark, officialTotalMaxScore:180,
  questionDomainToScoringSection, examSpecVersion, officialSourceUrl, verifiedAt
}
```

| 레벨 | 교시 시간(분) | 성적표 채점 영역 | 공식 합격 기준 |
|---|---|---|---|
| N1 | 언어지식·독해 110 / 청해 55 | 지식 60 + 독해 60 + 청해 60 | 총 100, 각 19 이상 |
| N2 | 언어지식·독해 105 / 청해 50 | 지식 60 + 독해 60 + 청해 60 | 총 90, 각 19 이상 |
| **N3** | 어휘 30 / 문법·독해 70 / 청해 40 | 지식 60 + 독해 60 + 청해 60 | 총 95, 각 19 이상 |
| N4 | 어휘 25 / 문법·독해 55 / 청해 35 | **지식·독해 통합 120** + 청해 60 | 총 90, 통합 38 및 청해 19 이상 |
| N5 | 어휘 20 / 문법·독해 40 / 청해 30 | **지식·독해 통합 120** + 청해 60 | 총 80, 통합 38 및 청해 19 이상 |

근거: https://www.jlpt.jp/e/guideline/testsections.html · https://www.jlpt.jp/e/guideline/results.html. **시험의 `TestSection`, 교육용 `Question.domain`, 공식 `ScoringSection`은 서로 다른 필드**여야 한다. 특히 N4·N5에서 독해 독립 채점영역을 만들면 잘못된 설계다. 공식 점수·시간은 공식 시험 안내 용도이고, 앱 자체 평가에는 점수 변환식이 없다.

### 6.2 엔터티와 키 계약 — V0에서 이름 고정

| 엔터티 | 필수 필드 | 저장 위치·불변조건 |
|---|---|---|
| `Profile` | `profileId:UUID`, `googleSub?:string`, `createdAt`, `locale:'ko'`, `targetLevel:Level`, `profileRevision` | 첫 `file://`에서는 `googleSub=null`; Google HTTPS 연결 성공 시 계정 식별 값 바인딩. 프로필/계정이 다르면 **무단 병합 금지**. |
| `UserSettings` | `profileId`, `fontScale:'S'|'M'|'L'|'XL'`, `furiganaMode`, `defaultTimed:false`, `dailyBudgetMinutes:60`, `timezone:'Asia/Seoul'`, `updatedByEventId` | 정본 Sheet의 이벤트 재생으로 복원. 연결 힌트/브라우저 폰트가 아니라 **원격 이벤트가 설정의 정본**. |
| `ExamTarget` | §4.4의 `targetYear,targetMonth,expectedExamDate,confirmedExamDate,dateStatus,sourceUrl,changedByEventId` | 연도·월은 필수 선택 조합, 변경 가능. null 허용(미선택). `EXAM_TARGET_SELECTED`로 히스토리 보존. |
| `SheetBinding` | `profileId,spreadsheetId,spreadsheetUrl,sheetInstanceId,namespace:'_JLPT_',accessMode:'SPREADSHEETS_LINK',connectedAt,lastAckId?` | HTTPS에서 실계정 권한 검사 후 바인딩. Picker 관련 필드 없음. `sheetInstanceId`는 리셋 탐지용. |
| `ContentPack` | `packId,packVersion,targetLevels[],packHash,reviewStatus,active,sourceManifestId,publishedAt` | Sheets `_JLPT_PACKS`의 버전별 불변 행. 활성 버전 변경은 사용자 승인+별도 활성화 이벤트. |
| `ContentRecord` | `contentId,contentVersion,packId,packVersion,kind,level,tags[],payloadJson,contentHash,reviewStatus,licenseId` | `_JLPT_CONTENT`의 버전별 행. **문항 하나당 하나의 JSON payload** 원칙; 너무 길면 `stimulus`와 `question`을 별도 레코드로 분할. |
| `Question` | `questionId,stimulusIds[],kind,domain,questionType,stemPages[],choices[4],correctChoiceId,explanation,exposurePolicy,contentVersion,mediaId?` | `choices`는 정확히 4개, 정답 정확히 1개, 나머지 3개는 `whyWrong`,`howToCorrect` 필수. 수정 시 새 버전. |
| `Card` | `cardId,contentId,direction:'READING'|'MEANING'|'AUDIO'|'CLOZE',level,algorithmVersion` | 같은 어휘의 독음·의미 회상은 별도 카드로 가능. 콘텐츠의 활성 버전 관계 유지. |
| `MediaAsset` | `mediaId,mediaUrl,scriptContentId,mediaHash,licenseId,audioPolicy,reviewedBy,reviewedAt` | **메타/URL만 Sheet**. 음성 파일 바이너리 삽입 금지. 평가용 `REVIEWED_RECORDING` 필요. |
| `SourceRecord` | `sourceId,rightsHolder,originUrl,licenseTerms,redistributionAllowed,recordingAllowed,reviewer,reviewedAt` | 승인 없으면 배포/게시 금지. `_JLPT_SOURCES`에 기록. |
| `ExposureEvent` | `eventId,profileId,questionId,stimulusIds[],exposureType:'DIAGNOSTIC'|'PRACTICE'|'ASSESSMENT',displayedAt` | 문항·지문·음원 최초 노출 기록. 미노출 평가 격리의 근거. |
| `AttemptEvent` | `eventId,sessionId,questionId,selectedChoiceId,isCorrect,elapsedActiveMs,submittedAt,exposureType,contentVersion` | 제출 후 추가 전용. 재클릭/원격 재전송 중복 제거. |
| `ReviewEvent` | `eventId,cardId,rating:'AGAIN'|'HARD'|'GOOD'|'EASY',reviewedAt,algorithmVersion` | SRS 상태는 이벤트를 재생한 **파생 상태**; 역사를 버리지 않는다. |
| `DailyPlan` | `planId,profileId,dayKey,route,targetYear,targetMonth,allocationMinutesByDomain,actualSecondsByDomain,revision,algorithmVersion` | 목표 재선택 시 해당일 이후 계획 새 revision; 이전 기록 보존. |
| `AssessmentForm`/`AssessmentSession` | `formId,formVersion,questionIds[],exposurePolicy`, `assessmentSessionId,unseenAtStart,startedAt,finishedAt,scoringSectionRawResults` | V3부터 별도 신규 문제만 사용. 평가 점수는 `raw`로 표기하고 공식 척도점수로 오인 금지. |
| `SyncEvent` | `eventId,profileId,deviceId,deviceSeq,lamport,occurredAt,type,entityId,payloadJson,eventSchemaVersion,checksum` | `_JLPT_EVENTS`의 append-only 행. **동일 eventId+동일 checksum은 한 번만 적용**, 다른 checksum이면 무결성 오류. |
| `SyncState`(로컬) | `sheetInstanceId,deviceId,remoteCursor,pendingIds[],lastSyncAt,status,lastError` | 원격 정본이 아닌 전송 상태. `PENDING/SYNCED/NEEDS_AUTH/OFFLINE/READ_ONLY`. `file://`에서는 `REMOTE_UNAVAILABLE`. |

**날짜·ID:** 이벤트 ID는 UUID, 시각은 UTC ISO 문자열, 학습 일자 `dayKey`는 `Asia/Seoul` 기준 `YYYY-MM-DD`, `deviceSeq`/`lamport`로 결정적 재생. 기기 시계가 부정확할 수 있으므로 시트 행 추가 순서와 실제 발생 시각을 혼동하지 않는다.

**이벤트 타입(추가 시 eventSchemaVersion 증가):**

```text
PROFILE_CREATED | SETTINGS_UPDATED | SHEET_BOUND | EXAM_TARGET_SELECTED |
EXAM_NOTICE_VERIFIED | DIAGNOSTIC_STARTED | DIAGNOSTIC_COMPLETED |
ROUTE_CHANGED | QUESTION_PRESENTED | QUESTION_SUBMITTED | ANSWER_REVEALED |
CARD_REVIEWED | STUDY_INTERVAL_COMPLETED | DAILY_PLAN_CREATED |
DAILY_PLAN_REVISED | ASSESSMENT_STARTED | ASSESSMENT_COMPLETED |
CONTENT_PACK_INSTALLED | CONTENT_PACK_ACTIVATED | USER_NOTE_UPDATED |
OFFICIAL_RESULT_REPORTED | ENTITY_TOMBSTONED
```

**충돌:** 설정의 일반 선호값(`fontScale`,`furiganaMode`)은 `(lamport,deviceId,eventId)` 고정 순서로 결정, **목표 연도/월·연결 시트 변경은 사용자에게 두 값과 최신 변경 시각을 표시하고 해결 전 원격 쓰기를 보류**. 공식 시험 변경일은 공식 출처 URL·확인자를 같이 요구한다. 콘텐츠 수정은 업데이트가 아닌 **새 버전 추가**; 같은 `(contentId,contentVersion)`에 해시가 다르면 자동 병합하지 않는다.

### 6.3 Google Sheet 탭·헤더 계약(시트 자체가 데이터베이스)

**유저의 기존 Google Sheet는 그대로 유지**하고, 아래 탭이 없을 때만 생성한다. 처음 쓰기 전 `spreadsheetId`와 기존 탭 이름을 재조회한다. 탭 이름은 **대소문자 포함 정확 일치**를 요구한다.

| 앱 전용 탭 | 첫 행 헤더(순서 고정) | 행 데이터 |
|---|---|---|
| `_JLPT_META` | `key,valueJson,updatedAt,checksum` | `schemaVersion`, `sheetInstanceId`, `initializedAt`, `bootstrapPackVersion`, `activePackRevision`, `ownerProfileId`, `boundGoogleSub` 등 키별 값. 계정 ID는 보안 인증 수단이 아니라 실수 방지용. |
| `_JLPT_PACKS` | `packId,packVersion,targetLevels,reviewStatus,active,publishedAt,manifestJson,packHash` | 커리큘럼·팩 목록·상태. `active`는 게시된 팩에만 설정. |
| `_JLPT_CONTENT` | `contentId,contentVersion,packId,packVersion,kind,level,reviewStatus,licenseId,payloadJson,contentHash,updatedAt` | 단어, 카드, 문법, 지문, 문항, 오디오 참조 등. **크기가 커지면 지문/문항 분리**. |
| `_JLPT_SOURCES` | `sourceId,rightsHolder,originUrl,licenseTerms,redistributionAllowed,recordingAllowed,reviewer,reviewedAt,approvalStatus` | 데이터셋/콘텐츠별 출처·권리·승인 기록. |
| `_JLPT_EVENTS` | `eventId,profileId,deviceId,deviceSeq,lamport,occurredAt,type,entityId,eventSchemaVersion,payloadJson,checksum` | 개인 학습/설정 변경/시험 목표/동기화 이벤트 추가 전용. |
| `_JLPT_SNAPSHOTS` | V4에서 도입·별도 schema | 대용량 최적화용 파생 스냅샷. 원본 이벤트 삭제를 뜻하지 않음. |

**초기화 원자성의 한계와 롤백 규칙:**

1. 먼저 `spreadsheets.get`으로 파일·탭 목록을 읽고, 앱 네임스페이스와 기존 데이터 충돌 여부를 검사한다. 기존 `_JLPT_` 탭이 한 개라도 있지만 `sheetInstanceId`/헤더가 없거나 다르면 **읽기 전용·충돌 안내**. 사용자 시트 자동 초기화/삭제 금지.
2. 빈 앱 네임스페이스에만 `spreadsheets.batchUpdate(addSheet)`로 전용 탭을 생성한 후 `spreadsheets.values.batchUpdate(valueInputOption=RAW)`로 헤더·META를 기록한다. 중간 실패가 생기면 재조회하여 **부족한 단계만** 재개한다. 모든 단계를 하나의 분산 트랜잭션이라고 가정하지 않는다.
3. 승인된 bootstrap의 각 레코드를 `contentId+version+hash`로 비교하여 **없는 버전만 추가**한다. 마지막에 유효성 검증 후 `_JLPT_META.activePackRevision`을 갱신한다. 마지막 활성화 성공 전에는 미완성 데이터를 학습 팩으로 노출하지 않는다.
4. 외부 콘텐츠 JSON의 각 셀 문자열은 앱 정책상 **30,000자 이하**(안전한 제품 초기 제한, Google 공식 제한 수치로 주장하지 않음). 초과 시 지문/문항을 분리하고 참조 ID로 연결한다. Sheets 셀에 거대 base64/오디오 저장 금지.
5. `valueInputOption=RAW`만 사용하여 단어/문법 문자열이 수식으로 해석되지 않도록 한다. CSV/TSV 내보내기에서는 별도 수식 주입 방어. [Google RAW 공식](https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption).
6. 버전 업데이트로 bootstrap이 바뀌더라도 활성 팩·사용자 제작 항목을 덮어쓰지 않는다. 기존 항목의 폐기는 비활성화 또는 `ENTITY_TOMBSTONED`이벤트로 표현하고, 이력 보존.

### 6.4 앱 코드·콘텐츠·데이터 버전의 독립성

```text
appVersion           : HTML 릴리스 v0.1.0, v1.0.0, ...
sheetSchemaVersion   : _JLPT_* 탭/헤더 버전(정수)
eventSchemaVersion   : 학습 이벤트 payload 계약 버전(정수)
contentPackVersion   : 출제/학습 데이터 패키지의 SemVer
contentVersion       : 개별 단어/지문/문항의 불변 수정 버전
localDbVersion       : HTTPS 모드 로컬 저장소 스키마 버전
```

- HTML을 v0→v1 교체해도 **Sheet Schema가 동일하면 콘텐츠 데이터와 학습 기록은 재사용**한다.
- HTML이 모르는 더 높은 원격 `sheetSchemaVersion`을 보면 **읽기 전용+백업 안내**, 자동 '초기화' 금지. 호환 가능한 낮은 버전은 `export snapshot → dry-run 변환 → 검증 → 마이그레이션 기록 → 읽기 재개` 순서.
- 오프라인/파일 모드는 `file://` origin이 달라지면 브라우저 캐시 접근이 바뀔 수 있으므로, **원격 복원 또는 명시적 JSON 백업**만을 버전 독립 복원 수단으로 약속한다.
- `sheetInstanceId`가 변경되었거나 같은 `spreadsheetId`에 전혀 다른 owner profile ID가 있으면 원격 이벤트 자동 합치기 금지.

---

## 7. 아키텍처 — 한 파일 배포, 개발 단계에서만 모듈·도구 사용

### 7.1 기술 스택 비교·선택

| 구현 방식 | 장점 | 단점 | 결론 |
|---|---|---|---|
| **A. 바닐라 JS·CSS 단일 HTML을 직접 편집** | 추가 도구 없이 HTML 한 파일에 작업 가능 | 파일이 커질수록 모듈 분리·회귀 테스트 어려움 | 소규모 PoC 가능하지만 장기 개발용 소스로는 비추천 |
| **B. TypeScript/모듈별 소스 → 빌드 시 HTML 한 파일로 inline** | 앱 코어·저장·구글·문제 UI를 독립 테스트하면서 **배포 아티팩트 1개** | 개발자에게만 Node·빌드 도구 필요 | **추천·최종 플랜** |
| C. Vite+React로 localhost 웹 앱 유지 | 큰 생태계·개발 편의성 | 사용자가 명시한 파일 직접 실행/한 파일 산출물 조건과 불일치, 런타임 규모 증가 | **이번 플랜에서 폐기** |
| D. Apps Script HTMLService + `.gs` 서버 기능 | Google 계정·Sheet 접근 통합 가능 | Google 호스팅 스크립트 배포·추가 파일 필요, 단일 파일/순수 로컬 조건과 다름 | 사용자 별도 승인 없이는 채택 금지 |

**확정할 구현 기본안 `[실무 제안]`:** 소스는 `TypeScript strict + 경량 바닐라 DOM UI + CSS custom properties + import 없는 런타임 IIFE`로 작성. **`esbuild`는 개발 시 JS 번들/minify 용도**, 테스트는 `node --test`/Vitest 또는 Playwright(개발 전용) 사용. 최종 빌드 스크립트가 CSS·JS·최소 seed JSON을 `index.template.html`에 inline하고 **오직 `dist/index.html`** 생성. 실행 시 npm 설치/외부 프레임워크 파일 요청 없음. HTTPS 모드에서만 **GIS 외부 Google 공식 스크립트를 사용자 로그인 시 로드**한다(이는 저장소·콘텐츠가 아니라 인증 SDK).

**파일 크기 예산 `[실무 제안]`:** V0 `dist/index.html` **200 KiB 이하 목표 / 300 KiB 초과 시 재검토 필수**. 수치는 공식 한도가 아니라 코드·seed 분리 여부를 판단하기 위한 초기 엔지니어링 목표. 기능/정답 검수 품질을 희생해 억지로 맞추지 않는다. 릴리스 로그에는 `rawBytes`, `JSBytes`, `CSSBytes`, `bootstrapBytes`, `sha256` 실측 저장; 콘텐츠 추가가 HTML 크기를 늘리면 패키지 경계를 재검토한다. 대형 외부 라이브러리·일본어 폰트 파일·사진·오디오를 HTML에 인라인하지 않는다.

**SPA 내비게이션:** `view` 하나(`CONNECT`,`ONBOARDING`,`DIAGNOSTIC`,`TODAY`,`QUIZ`,`CONTENT`,`READINESS`,`SETTINGS`)를 상태기계로 표시, 정적 DOM mount 하나. 브라우저 주소는 `#today`, `#quiz`, `#settings` 등 hash route로 이동. 서버 경로 재작성/React Router 없음. 퀴즈 상태는 `QUESTION`→`ANSWER_SELECTED`→`FEEDBACK`→`NEXT_REQUESTED`로 관리하고, `FEEDBACK`에서 자동 다음 절대 금지.

### 7.2 제품 사용 방법(개발·실행 구분)

**최종 사용자 — 단일 HTML 배포:**

- `index.html`을 PC에서 **더블클릭해 `file://`로 열면 로컬 모드**. 승인된 bootstrap 미리보기와 백업/내보내기를 사용. Google 로그인은 UI가 이유를 설명하고 차단한다.
- 같은 **단일** HTML 파일을 GitHub Pages 등 **정적 HTTPS Origin**에 게시한 뒤 Android Chrome/PC Chrome에서 그 URL로 접속. 정적 호스트에는 HTML만 올라가고 **별도 백엔드·개인 데이터·콘텐츠 JSON을 두지 않는다**. 개인 데이터/콘텐츠 원본은 연결한 Google Sheet 안에 있다.
- **오프라인 첫 실행에 Google 동의·새 Sheet 연결은 불가능**. 기존 HTTPS Origin의 IndexedDB 캐시가 남아 있는 경우에만 제한적 오프라인 학습/보류 이벤트를 제공한다.
- Android Chrome에서 파일 관리자 `content://` 또는 `file://` URL로 열었을 때 HTML이 JS를 실행하는지, 로컬 다운로드/백업 API가 작동하는지는 **실제 장치에서 검증 전 [미확인]**. 이 호환성을 확보하지 못한 채 '모바일 로컬 파일 직접 실행 지원'을 완료 선언하지 않는다.
- 정적 HTTPS 배포는 사용자가 따로 웹앱 서버를 실행한다는 뜻은 아니지만, **인터넷에서 HTML을 내려주는 웹 호스팅은 실제로 존재**한다. 이 차이를 안내 페이지에서 명확히 밝힌다.

### 7.2.1 정적 HTTPS 운영·Google 설정 계약(최종 확정)

**GitHub Pages는 정적 파일을 제공할 뿐 사용자 계정·학습 기록을 저장하지 않는다.** 사용자가 접속하는 페이지는 HTML 하나이고, 브라우저에서 Google OAuth → Sheets API를 직접 호출한다. GitHub Pages 저장소나 HTML에는 실제 시트 내용·개인 토큰·OAuth client secret을 포함하지 않는다.

1. 개발자는 `npm run build`로 `dist/index.html` **한 파일**을 생성한다. 개발 중 여러 TypeScript/CSS/테스트 파일을 사용하는 것과 최종 사용자에게 한 HTML만 전달하는 것은 모순이 아니다.
2. 사용자가 관리하는 GitHub 저장소(예: `jlpt-app`)에 연결한다. Pages 공개 소스는 **별도 `gh-pages` 브랜치 루트에 `index.html` 한 파일만 게시**하는 방식을 기본으로 한다. 소스코드와 검수되지 않은 원고를 페이지 공개 폴더에 넣지 않는다. 또는 GitHub Actions가 **`index.html` 하나만 포함하는 배포 아티팩트**를 만들도록 해도 된다.
3. 프로젝트 Pages의 일반적인 접속 주소는 **`https://<owner>.github.io/<repo>/`**이며, 브라우저의 Origin은 경로를 제거한 **`https://<owner>.github.io`**이다. Google Cloud **Authorized JavaScript origins에 등록할 것은 경로 없는 Origin**이다. 개인 도메인/별도 호스트를 사용하면 그 실제 Origin을 등록해야 한다.
4. Google Cloud에서 Sheets API 활성화, OAuth 동의 화면 및 테스트 사용자 구성, **Web application Client ID** 발급. HTML에 공개 가능한 Client ID만 설정한다. Google OAuth Token Model + `https://www.googleapis.com/auth/spreadsheets`를 사용하며 **Picker·Drive API·client secret·별도 로그인 백엔드는 요구하지 않는다**.
5. 사용자는 앱 URL에 접속해 계정 연결 → 시트 URL 붙여넣기 → 연결 권한 확인 → 비파괴 초기화를 수행한다. 처음부터 스프레드시트를 '링크 공개'로 바꾸지 않는다. 앱이 접속할 계정의 편집 권한으로 비공개 시트를 그대로 사용한다.
6. 새 릴리스는 `index.html`만 교체한다. 기존 앱 접속 URL·Origin을 변경하지 않으면 IndexedDB 캐시와 Sheet 연결 힌트가 유지될 수 있고, 브라우저 저장소가 없어도 **시트 URL 재입력+Google 재인증으로 정본을 복원**할 수 있어야 한다.
7. Pages 공개 URL은 HTML 코드를 **누구나 볼 수 있는 웹주소일 수 있다**. 공개 저장소/사이트의 비밀유출 점검을 필수화한다. GitHub Free에서 프로젝트 Pages를 쓸 때 저장소 공개 조건을 확인한다. `https://<owner>.github.io` 아래 다른 프로젝트는 동일 Origin을 공유할 수 있으므로, 개인/민감 저장이 필요한 운영 환경에서는 **전용 사용자 사이트 또는 독립 도메인 사용**을 검토한다. GitHub Pages가 시트 접근권을 부여해주는 것은 아니다.

**필수 사전준비(사용자가 직접 수행):** ① GitHub 저장소와 Pages 게시 권한, ② Google Cloud 프로젝트 및 OAuth Client ID, ③ 허용 Origin 등록, ④ 테스트용 스프레드시트(비공개·편집권 보유), ⑤ 테스트 Google 계정. 구현자는 필요한 입력 필드/절차를 문서화하되 **임의로 사용자 명의 계정·유료 프로젝트를 개설하거나 공개 배포하지 않는다**. 이 입력이 없더라도 Mock 기반 개발은 시작 가능하다.

근거: [GitHub Pages 개요](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [GitHub Pages 엔트리 파일](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site), [Google JS Origin 규칙](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [GIS Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model).

**구현자 — 개발 저장소에서의 빌드/테스트:**

```text
npm ci                # 개발자만, 최초 설치
npm run build         # dist/index.html 하나 생성
npm run test          # 순수 로직/콘텐츠 단위 테스트
npm run test:e2e:file # Playwright file:// 단독 모드
npm run test:e2e:web  # 사전에 준비된 테스트 HTTPS Origin에서 Google 실연동 수동 게이트
npm run size          # HTML 크기·구성요소·sha256 기록
```

- `npm run build`가 생성하는 **배포 파일은 정확히 한 개**, JS·CSS·SVG·JSON 등 companion asset 0개. `dist` 디렉터리 사용자는 복사할 필요 없음.
- 개발 내부 Mock/테스트 용도 HTTP 서버를 **필요하면 테스트 하네스만** 사용할 수 있으나, 이를 최종 사용자 필수 실행 조건으로 만들지 않는다. OAuth E2E는 실제 승인된 HTTPS Origin에서 수행.
- 파일 열기 동작 테스트 시 `file://` origin을 `localhost`로 속여 브라우저 보안 옵션을 해제하는 식으로 통과시키지 않는다.

### 7.3 레이어와 파일 구조

```text
jlpt-app/
├── plan.md                      # 최종 요구·개발 기준
├── research_revised.md          # 근거·미확인 목록
├── CLAUDE.md                    # 구현 규칙(§10 초안 참조)
├── CHANGELOG.md
├── README.md                    # 단일 HTML / 2가지 실행 모드 명확화
├── package.json / package-lock.json / tsconfig.json
├── index.template.html          # JS/CSS 번들 주입 지점만 있는 HTML 템플릿
├── src/
│   ├── app.ts                   # bootstrap, runtime mode check, hash router
│   ├── ui/{quiz,diagnostic,today,settings,content,readiness}.ts
│   ├── ui/styles.css            # inline으로 병합
│   ├── domain/{exams,target,diagnostic,planner,srs,quiz,readiness}.ts
│   ├── content/{schema,validator,manifest,seed}.ts
│   ├── storage/{interface,local,events,projection,sync}.ts
│   └── google/{gis,sheets,errors,init}.ts   # HTTPS-only adapter
├── scripts/{build-single-html,measure-size,content-lint}.*
├── tests/{unit,content,ui,storage,integration,fixtures}/
├── docs/{decisions,qa,releases,sources}/
└── dist/
    └── index.html               # **유일한 최종 앱 배포물**
```

**모듈 의존 방향:** UI → Domain Service → Repository Interface → (`LocalCacheAdapter`, `SheetsAdapter`)와 `ContentRepository`; UI에서 `fetch`/OAuth 토큰/시트 행 인덱스를 직접 다루지 않는다. 도메인 함수는 side-effect 없는 순수 함수로 단위 테스트. 앱 초기 화면은 인증 SDK를 내려받지 않아도 렌더된다.

### 7.4 실행환경 판정·저장 계층

```text
RuntimeMode:
  LOCAL_FILE      if location.protocol === 'file:' (또는 불확실한 content: origin)
  HTTPS_CONNECTED if location.protocol === 'https:' AND GIS/Sheets 준비 성공
  HTTPS_GUEST     if https: but not yet authenticated
  UNSUPPORTED     otherwise (개발용 localhost는 별도 QA 모드만 허용)

Cloud Sheets (canonical): content + settings + attempts + targets + plans
     ^  read verify / append eventId                 |
     |                                             v
Sync Coordinator (HTTPS mode)  <-> Local Cache / Pending Queue (IndexedDB if supported)
     ^                                             ^
     |                                             |
Domain Services  <-------------------------- Quiz/Planner/Content UI
     ^
Small bootstrap pack (embedded within index.html; only initial/offline sample)
```

- HTTPS: `IndexedDB`를 먼저 열고 스키마 버전 검사. 오픈 실패/스토리지 거부는 즉시 UI 경고 후 **메모리 모드+백업**으로 전환. `localStorage`는 Sheet URL/Client ID 등 비밀이 아닌 **힌트** 저장에만 보조 사용; access token을 영속 저장하지 않음.
- `file://`: IndexedDB/localStorage가 일부 Chrome에서 우연히 되더라도 **브라우저·파일 경로 간 보존을 제품 보장으로 간주하지 않는다**. 지원 여부를 실제 feature detection과 재열기 테스트로 확인하고, 테스트 실패 시 메모리/명시적 내보내기. 원격 동기화가 없다는 상태가 항상 보이도록 한다.
- `content://` 등 Android 파일 관리자 Origin은 **Google Cloud에서 허용할 수 있는 일반 웹 Origin으로 간주하지 않음**. 파일 모드/미지원 모드로 안전하게 강등.
- 온라인 최초 실행에서 Sheet가 복원되면 bootstrap 기록과 원격 `ContentRecord`를 `id/version/hash` 기준으로 병합하되 **원격이 정본**, LocalStore 캐시는 성능 최적화. 브라우저 storage 삭제 이후 사용자가 같은 Sheet를 다시 연결하면 전량 복원.

### 7.5 이벤트 동기화·충돌·오프라인

1. **로컬 기록 먼저:** 화면에서 문항 노출·제출·설정 변경 시 가능한 저장소에서 `SyncEvent`(UUID+payload checksum)를 만들고 outbox에 추가한다. 저장 성공 전 `원격 완료`를 표시하지 않는다.
2. **원격 시작:** HTTPS+GIS access token+Sheet ID가 유효하면 `_JLPT_META` 스키마/인스턴스 ID를 먼저 확인하고 `_JLPT_EVENTS`를 페이지/범위 단위로 읽는다.
3. **중복 식별:** 원격 `eventId`에 이미 **동일 checksum**이 존재하면 로컬 이벤트를 재append하지 않고 재조회 검증 후 `SYNCED`; 같은 ID·다른 checksum은 `READ_ONLY_CORRUPT`.
4. **append 후 검증:** 존재하지 않는 pending 이벤트만 Sheets `values.append` `RAW`로 배치 추가. 성공 HTTP 코드만으로 ACK하지 않고 **반드시 eventId+checksum 재조회**. 타임아웃/5xx는 먼저 원격에 이미 쓰였는지 검사한 뒤 재시도.
5. **동시 기기:** Sheets는 이 앱을 위한 CAS/단일 트랜잭션 DB가 아님. 같은 이벤트 중복 append 행이 물리적으로 생길 수 있고 다른 기기의 append 순서는 달라질 수 있다. **학습 projection은 idempotent**(중복 ID 한 번), 자동으로 물리 행 중복 0을 보증하지 않음. 충돌 발생 시 사용자가 영향도를 확인할 수 있도록 한다.
6. **원격 읽기 완료:** remote+local pending 이벤트를 결정적 정렬/병합하여 일일 통계·SRS·설정을 계산. `lastSyncedAt`, `pendingCount`, `remoteChecksum` UI 표시. 원격 데이터가 나중 schema면 쓰기 차단.
7. **오프라인:** 데이터셋·프로필 캐시가 유효할 때만 학습 허용. 새로 시작한 `file://` 모드에는 원격 outbox ACK가 없으므로 **'Sheets에 저장됨' 표시 0회**. 연결 복귀 전 outbox를 삭제하거나 제한 없이 늘리지 않음.
8. **백업/복원:** `JSON export`에는 profile/settings/exam target/events/pack manifest refs 및 schemaVersion 포함, 별도 자격정보·비공개 OAuth 토큰 포함 금지. import 전 ID/해시/schema 검사·diff preview/중복 수 집계 후 사용자 승인. HTML 버전업/Origin 변경·브라우저 저장소 삭제 후 복구 검증.
9. **제한·오류:** 401/403/404/429/5xx, 시트 용량/권한/보호 셀, 충돌 탭, 헤더 손상은 저장 실패 원인 분리. 빈번한 요청은 배치·지수 백오프; 원격 읽기 범위/페이징을 릴리스 QA에서 실측한다.

### 7.6 개인 데이터·보안

- GIS `access_token`은 메모리에만 저장, 콘솔·로그·URL·Git에 기록하지 않음. 브라우저 단독 인증은 **백엔드의 신뢰 경계가 아니며**, 원격 파일 접근은 Google API의 token+Sheet 공유 권한이 통제한다.
- `client_id`는 공개 가능 식별자일 뿐 `client_secret`이 아님. 클라이언트 비밀키·API 관리자 credential은 HTML에 절대 넣지 않는다.
- `spreadsheets`는 범위가 넓음: 앱 UI/코드에서 **사용자가 지정한 하나의 Spreadsheet ID** 외의 파일을 자동 검색하거나 수정하지 않음. 그러나 Google에 부여하는 권한 범위 자체가 한 파일로 한정되지는 않는다. 사용자에게 정확히 안내.
- 타인이 제공한 Sheet의 JSON/문항에는 악의적 HTML·스크립트가 포함될 수 있으므로 `textContent`/검증된 DOM만 사용, HTML 인터프리터나 `eval` 금지. 외부 URL은 allowlist/HTTPS·사용권 검증. 권한을 가진 사용자가 Sheet 내용을 삭제할 수 있다는 위험에 대비해 백업 안내.
- 같은 Origin의 정적 HTTPS HTML은 공개적으로 받아볼 수 있어도 개인 Sheet 데이터는 자동 공개되지 않아야 한다. 개인 시트 URL·토큰·행 데이터는 정적 호스트 저장소/빌드 로그에 기록하지 않는다.
- 최종 HTML 자체를 악의적으로 변조하면 OAuth token을 탈취할 수 있다. 배포 산출물 hash와 신뢰 가능한 HTTPS 출처를 문서에 기록하고, 사용자에게 출처가 확인된 URL만 쓰도록 안내.

---
## 8. Google 연동 설계 — 사용자 확정 D2=B, Picker 없음

### 8.1 인증·인가·시트 연결 흐름(HTTPS 모드에만 존재)

```text
[정적 https://.../index.html 접속]
  → [앱은 HTTPS Origin 확인]
  → ['Google 계정으로 연결' 사용자가 클릭]
  → [GIS Token Client 팝업·동의: spreadsheets + 최소 계정 식별]
  → [승인된 access token (메모리)]
  → [계정 식별 userinfo.sub/email을 선택적으로 표시]
  → [사용자 Google 스프레드시트 URL 입력]
  → [ID 파싱, spreadsheets.get 권한/메타 검증]
  → [앱 전용 탭 존재 시 검증 / 없으면 사용자 확인 뒤 비파괴 초기화]
  → [bootstrap 승인 팩 최초 업로드 또는 기존 데이터 복원]
  → [모든 변경: local outbox → Sheets append → ID+checksum 재조회]
```

- GIS SDK는 `https://accounts.google.com/gsi/client`에서 **사용자가 로그인하려고 누른 시점에만 로드**한다. 파일은 하나라도 외부 Google 인증 서비스가 필요한 정상적인 온라인 흐름이다.
- `google.accounts.oauth2.initTokenClient`의 필수 Scope는 `https://www.googleapis.com/auth/spreadsheets`. 계정 식별을 위해 `openid email` 등 **추가 권한을 실제로 요청하는 경우**, 온보딩 안내·콘솔 설정에 함께 기록한다. 계정 프로필은 사용자 편의를 위한 표시이며 **서버 측 검증된 신원 증명으로 취급하지 않는다**.
- 단일 HTML에서 `client_secret` 또는 refresh token을 요구하지 않는다. Token Model의 짧은 access token 만료 시 **사용자의 '다시 연결' 버튼 클릭으로** 권한을 재요청. 비밀 토큰을 영속 저장/로그 기록하지 않는다.
- Spreadsheet URL은 **정확히 `https://docs.google.com/spreadsheets/d/<ID>/...`** 만 허용. host를 URL 객체로 검사하고, `gid`는 Sheet 탭 ID이므로 문서 ID와 혼동하지 않는다. 다른 호스트·잘못된 링크·비정상 ID·열람 권한 없는 시트에 임의로 기록하지 않는다.
- D2=B므로 **Google Picker API, API key, App ID, Drive API를 기본적으로 요구하지 않는다.** `spreadsheets`는 민감 스코프라 앱 공개 시 Google OAuth 앱 검증/동의화면 정책 확인이 필요하다.
- OAuth 인증 완료 후에도 **파일 편집 권한은 별도로 검증**. 자신이 열람만 가능한 시트에 앱용 탭 생성 실패하면 '읽기 전용, 다른 시트 선택' UI. 실패한 시트에 계속 재시도하여 기존 내용을 오염시키지 않는다.
- 하나의 Sheet는 V0에서 **하나의 사용자 프로필**을 기본으로 한다. 이미 다른 `boundGoogleSub`가 기록된 시트에 다른 Google 계정으로 로그인하면 안전하게 읽기 전용으로 전환하고 사용자 확인을 요구. 이 메타가 악의적인 타인의 편집을 막는 보안 기능이라고 주장하지 않는다.

### 8.2 Google Cloud Console 수동 설정 체크리스트(사용자 수행)

1. [ ] 본인이 통제하는 Google Cloud 프로젝트를 만들고 **Google Sheets API** 활성화. Picker/Drive API는 D2=B에서는 필수 아님.
2. [ ] Google Auth Platform에서 **OAuth 동의 화면**·앱 명칭·지원 이메일·사용자 유형(Internal/External)과 필요한 **민감 `spreadsheets` 스코프**를 구성. 개발 테스트 계정으로 자신을 추가하고 Workspace 정책 제한 여부 확인.
3. [ ] OAuth Client 유형은 **Web application**. GitHub Pages 예시가 `https://<owner>.github.io/jlpt-app/`라면 Authorized JavaScript origins에는 **`https://<owner>.github.io`** 등록. 경로(`/jlpt-app/`)나 파일명은 포함하지 않는다. **`file://`/`content://`를 등록하려고 시도하지 않는다.** 개발 `http://localhost`는 별도 실험용일 뿐 사용자 실행에 필요 없음.
4. [ ] Client ID를 HTML 구성 값으로 삽입할 수 있게 마련. 정적 HTML에 `client_secret`·서비스 계정 key·실 사용자 access token·refresh token 절대 삽입하지 않음.
5. [ ] 테스트용 **빈/기존 데이터 포함** Google Sheets 2개 준비하고, 접근 Google 계정이 둘 다 수정 가능함을 확인. 실 사용자 기존 업무용 데이터가 들어 있는 시트는 V0 연동 테스트 대상에서 제외.
6. [ ] 정적 HTTPS 파일이 배포된 Origin과 OAuth Client의 Origin을 일치시켜 **PC Chrome+Android Chrome 실기기**의 로그인/팝업/권한 동의/시트 read-write를 테스트.
7. [ ] 앱을 타 사용자에 공개하려면 OAuth Testing/Production 정책, **민감 스코프 검증**, 개인정보 처리방침·앱 배포 URL 요건을 별도 공식 확인. 테스트 계정에서 작동해도 공개 배포가 승인된 것은 아님.
8. [ ] 실제 본인 시트에 바인딩할 때는 URL을 직접 붙여넣고 `이 시트에 _JLPT_* 전용 탭을 생성합니다. 기존 탭은 수정하지 않습니다`를 확인한 뒤 초기화 승인.

공식 근거: [Sheets 권한](https://developers.google.com/workspace/sheets/api/scopes), [GIS Token Model](https://developers.google.com/identity/oauth2/web/guides/use-token-model), [Origin 규칙](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow), [Sheets API 개요](https://developers.google.com/workspace/sheets/api/guides/concepts).

### 8.3 Google API 읽기·쓰기 동작 계약

| 작업 | 공식 REST 기능 | 성공 판정 |
|---|---|---|
| 파일 존재/권한/기존 앱 탭 조회 | `GET /v4/spreadsheets/{spreadsheetId}` | 대상 ID 동일·시트 목록 조회 성공. 단순 200 응답으로 **편집 권한 보장하지 않음**. |
| 앱 탭 추가 | `POST /v4/spreadsheets/{spreadsheetId}:batchUpdate` + `addSheet` | 앱 prefix 충돌 없음 확인, 신규 탭명 정확, 기존 탭 구조 보존. |
| meta/header/초기 팩 쓰기 | `POST .../values:batchUpdate` `valueInputOption=RAW` | 재조회 시 헤더·meta 인스턴스·팩 해시 확인. |
| 개인 이벤트 추가 | `POST .../values/{range}:append` `valueInputOption=RAW` | 응답만으로 ACK 안 함. **원격 eventId+checksum 재조회 확인**. |
| 팩 데이터 로딩 | `GET .../values:batchGet` 또는 범위별 `values.get` | 활성 pack 버전/해시/승인 상태 필터 및 검증. 캐시에 저장. |
| 콘텐츠 팩 추가 | 승인된 `ContentRecord`를 append + 팩 manifest append | 기존 ID/버전/해시 중복 안 함. 전체 검증 후 활성 pack 갱신. |
| 버전/스키마 검사 | `_JLPT_META`와 헤더 조회 | 미호환/손상 시 **읽기 전용**, 자동 초기화·삭제 금지. |

**API 한계:** Sheets는 한 시트 파일 안에서 데이터 정본을 보유하지만 CAS·다중 기기 동시 쓰기 정합성·대용량 이벤트 검색 성능이 DB와 동일하다고 가정하지 않는다. 앱 이벤트는 논리적 idempotency를 보장하고 **실제 실패·재시도 패턴**을 실계정 환경에서 검사한다. 콘텐츠 변경은 멀티에디터 실시간 공동 편집이 아니라 **승인된 새 pack 배포**로 취급한다.

### 8.4 필수 오류 매트릭스

| 상태 | 사용자 메시지(핵심 문구) | 처리 |
|---|---|---|
| `file://`/`content://` 진입 | **"로컬 파일 모드에서는 Google 로그인을 지원하지 않습니다. Google Sheets 연결은 HTTPS 실행이 필요합니다."** | OAuth SDK 로드/호출 0회. 로컬 진단·내보내기 사용. |
| GIS 스크립트 로드 실패/팝업 차단 | "Google 로그인 창을 열 수 없습니다. 브라우저 설정과 연결 상태를 확인해 주세요." | 로컬 데이터 유지, 사용자 클릭 재시도. URL 변경·보안 해제 강요 금지. |
| 401 / 토큰 만료 | "Google 연결이 만료되었습니다. 다시 연결해 주세요." | 메모리 토큰 폐기, pending 유지, 클릭 기반 재발급. |
| 403 / 스코프 거부·Workspace 정책 | "이 계정에서는 필요한 Google Sheets 권한을 사용할 수 없습니다." | 사용권한/프로젝트 활성화/스코프 점검. 무단 추가 권한 요청 없음. |
| 403 / 파일 읽기만 가능·보호된 탭 | "이 스프레드시트에 앱 기록을 쓸 수 없습니다." | 읽기 전용, 사용자 편집권한·다른 시트 선택 안내, pending 보존. |
| 404 / 시트 접근 불가 | "시트를 찾지 못했거나 현재 계정에서 열 수 없습니다." | 입력 링크·계정 재확인, 시트 자동 생성/전환 금지. |
| 사용자 동의 거부/닫기 | "연결하지 않았습니다. 학습 내용은 아직 시트에 저장되지 않았습니다." | 현재 로컬 데이터 보관, 다시 연결 클릭 가능. |
| 네트워크 오프라인·timeout | "연결이 끊겼습니다. N건이 기기에만 저장되어 있습니다." | 캐시 지원 시 outbox 보존, 저장 보장 불가 모드면 즉시 백업 권장. |
| 429 / quota | "Google 요청 한도로 동기화가 지연되고 있습니다." | 지수 백오프+지터, batch size 완화, 대기 건수 표시. |
| 5xx / 결과 불명확 | "원격 저장 여부를 확인 중입니다." | 재append 전에 원격 eventId 확인, 중복 계수 없음. |
| 잘못된 URL·문서 ID | "유효한 Google 스프레드시트 링크를 입력해 주세요." | ID 검증 실패 시 Google API 호출 0회. |
| 시트 앱 탭 이미 존재·타 앱 스키마 | "기존 기록용 탭이 있어 자동 초기화할 수 없습니다." | 기존 데이터 무변경·read-only/수동 해결. |
| 계정·프로필 불일치 | "다른 계정의 학습 기록이 연결되어 있습니다." | 사용자 명시 선택 전 병합/쓰기 금지. |
| 원격 새 schema·checksum 불일치 | "앱 데이터 버전을 확인할 수 없어 쓰기를 중단했습니다." | 읽기 전용·JSON 백업·수동 복원 안내. |

**오류 UX 불변조건:** `pendingCount`는 remote verified ACK 혹은 사용자의 명시적인 데이터 삭제 확인 없이는 감소하지 않는다. 로컬 임시 상태는 항상 UI에서 '동기화 전'임을 표시한다. HTTPS 로그인을 성공했다고 **시트 연결·쓰기까지 성공한 것으로 간주하지 않는다**.

---

## 9. 준비도·과락 위험 신호 — '합격 확률' 표현 제한

### 9.1 무엇을 보여줄 수 있고 무엇을 보여주지 않는가

- `[공식 확인]` N3 합격 규칙은 **총 95/180 이상과 세 채점영역 각 19/60 이상**이다. 하지만 자체 문항 원점수에서 JLPT 공식 척도점수를 산출하는 환산식은 미공개이다.
- **V0–V2:** 진단 경로·누적 학습일·실제 학습시간·어휘 복습 상태·영역별 학습 수행·'청해 미측정' 등 **사실상 관찰 가능한 지표**만 제공.
- **V3:** 처음 보는 평가 전용 문항의 `k/n` 정답률·문항 유형 범위·실시간 사용여부·경과시간·표본 부족/상대적으로 취약한 영역·오차 설명을 제공. **공식 19점 미달 여부나 합격 확률 수치를 예측하지 않는다.**
- **V5+ 별도 검토:** 실제 공식 시험 결과를 충분히 수집·동의·익명화·독립 검증한 경우에만 모델 검토. 최소 표본 규모·유효성은 [미확인]. 자동 출시 금지.

### 9.2 V3 계산 명세(설계값은 검증 전 제품 초기 정책)

```text
window = last 28 days
valid = assessments where first_exposure=true and status=COMPLETE
      and answer_revealed_before_attempt=false and audio_valid=true
for section s in [LANGUAGE_KNOWLEDGE, READING, LISTENING]:
    n_s = count(valid attempts mapped to section s)
    k_s = count(valid correct attempts mapped to section s)
    accuracy_s = (k_s / n_s) if n_s>0 else null
    evidenceStatus_s = 'INSUFFICIENT' if n_s < 20 else 'OBSERVED'
```

- `28일`, `n<20`은 **[실무 제안] 운영 기준**이며 공식 타당성 보증이 아니다. 충분한 `n`에서도 동일 지문의 여러 문제는 독립 표본이 아니므로 `uniqueStimulusCount`·난이도·커버리지를 함께 보인다.
- 95% Wilson 구간을 구현할 경우 정확도 옆에 `자체 문항 표본의 참고 구간`이라고 표시하며 실제 JLPT 합격점에 대한 신뢰구간이 아니라고 명시. 지문 간 군집·콘텐츠 품질 차이로 구간이 과소 추정될 수 있다.
- `coverage`는 **앱이 게시한 content pack 내 선언 유형 기준**으로 계산하고 공식 목표 등급 출제 범위 완성률로 홍보하지 않는다.
- 처음 보는 문항의 정확도와 SRS 반복 정답률은 다른 지표. 풀이 중 이미 해설을 본 문항과 진단/학습에 노출된 문제는 신규 평가에서 제외.
- 사용자가 타이머를 켜지 않았다면 `실전 제한시간 적응도: 미측정`. 시험 30·70·40분을 기본 퀴즈 타이머로 강제하지 않는다.

### 9.3 영역 하한 19점과 관련된 경고 문구

- **공식 19점**은 *공식 성적표에 표시되는 척도점수 하한*이지 앱의 원점수 정답률 한계값이 아니다. **"청해 과락 확률 32%", "예상 청해 18점" 등 금지.**
- V3 초기 정책 `[실무 제안]`: 세 영역 중 하나라도 `n<20`이면 `자료 부족` 우선. 표본 충분한 경우 영역 정확도가 `0.60` 미만 또는 최고 영역 대비 `0.15`p(절댓값 0.15) 이상 뒤처지면 `상대 취약 영역 주의`. 이는 **학습 우선순위 경고**이지 공식 과락 판정 아님.
- 예시 UI: `청해는 새로운 평가 문항에서 다른 영역보다 상대적으로 취약합니다. JLPT 공식 과락 기준은 척도점수 19점이지만, 앱 정답률을 그 점수로 변환할 수 없습니다.`
- 별도 사용자가 입력한 공식 시험 결과는 `OFFICIAL_RESULT_REPORTED` 이벤트에 `level/year/month/공식영역점수/합격여부/source:'USER_DECLARED'`로 저장. N4/N5는 두 영역만 허용하며 N3 과락 로직을 가져오지 않는다.

### 9.4 장래 합격 확률 모델의 출시 조건

사용자 명시 동의 하에 시험 **이전** 평가 로그와 **실제 이후** 공식 점수·응시여부·이후 추가 학습 차이를 연계하여 cohort를 구축한 후, 시점·시험 회차 분리 검증, Brier score/Calibration/ECE·편향·과락 모델 분리·불확실성 평가를 수행한다. 검증 데이터나 합의된 정확도 기준이 없으면 **[미확인]** 상태로 남기고 확률 UI를 활성화하지 않는다.

---
## 10. 로컬 Git·단일 HTML 릴리스·Sonnet 개발 규칙

### 10.1 Git 운영 계약

- 신규 로컬 저장소에서 `main`(항상 마지막 완료 버전), `feature/<task-id>-<short-name>`(기능 개발), `fix/<short-name>`(긴급 수정). 실패한 실험은 별도 브랜치; 완성되지 않은 인증 시도를 `main` 성공 릴리스로 병합하지 않는다.
- Conventional Commit 권장: `feat(ui): ...`, `feat(sheet): ...`, `fix(sync): ...`, `test(mobile): ...`, `docs(plan): ...`, `chore(build): ...`. 사용자의 개인 Sheet URL/계정/키/스크린샷 원본은 커밋하지 않는다.
- 릴리스 태그 `v0.1.0`, `v1.0.0`…는 **전 버전 테스트/권리/Google 통합 게이트 완료 후** 발행. 개발 도중 단순 빌드 성공만으로 태그를 발행하지 않는다.
- 코드와 함께 배포 빌드 **`dist/index.html`도 릴리스 커밋에 포함**하고, `npm run build` 결과가 정확히 재현되는지 CI/로컬 검사. `dist`의 다른 파일이 생기면 빌드 실패.
- 릴리스별 `docs/releases/V0.md` 등에 테스트 결과·실기기 Android Chrome 정보·HTML sha256/rawBytes·시트 schemaVersion·콘텐츠 팩 manifest 해시·해결하지 못한 이슈를 기록. `CHANGELOG.md`는 `Added/Changed/Fixed/Migrated/Content/Compatibility/Known Issues` 구분.
- 변경 전 ADR 작성: **ADR-001 단일 HTML**, **ADR-002 Sheets 정본**, **ADR-003 민감 spreadsheets 권한**, **ADR-004 연도/월 목표**, **ADR-005 file://와 OAuth 실행환경 분리(정적 HTTPS 확정)**, **ADR-006 콘텐츠 팩·시트 스키마**. D4 상태는 `ACCEPTED`로 고정하고 사용자 소유 HTTPS/Cloud 설정의 준비 완료 여부만 `READY/BLOCKED`로 추적한다.
- 모든 저장 스키마 변경은 `sheetSchemaVersion`·마이그레이션 fixture·되돌리기 안내와 함께 커밋. 앱 버전 업데이트는 정본 Sheet의 데이터를 재설정하지 않는다.

### 10.2 최초 생성할 `CLAUDE.md` 초안 — Sonnet이 그대로 옮길 규칙

```md
# JLPT App Implementation Rules

Read plan.md and research_revised.md before starting. Decisions are
D1=A (Google Sheets canonical), D2=B (link + spreadsheets scope),
D3=editable exam year/month, D4=B (single index.html hosted on static HTTPS
for Google connectivity; file:// is preview-only), and D5=reviewed recording
for scored listening (not needed until V2). Cloud account, domain and test
access are deployment prerequisites, not unresolved architectural decisions.

The ONLY shipped application artifact is dist/index.html. It must contain its
CSS, JS and minimal original/approved bootstrap content inline; no npm,
localhost server, React runtime, external local JS/CSS/JSON, or service worker
is required to open the shipped file. Build-time TypeScript/esbuild and
modular source files are allowed. Keep the HTML small and report its byte size.

file:// is LOCAL_FILE mode: do not request Google OAuth or claim Sheets sync.
HTTPS static mode may use Google Identity Services token flow to access exactly
the user-pasted Sheet via the sensitive spreadsheets scope. Do not implement
Picker or drive.file, and never ship a client_secret or access token.

Sheet is canonical for content AND user state. Seed ONLY approved bootstrap
items into new _JLPT_* tabs, never overwrite unrelated tabs/rows. All user
changes are event-sourced with local pending queue and remote readback ACK.
Use immutable content IDs/versions and a reviewed content-pack registry.

Every quiz starts without a time limit. After submitting, wait for the user's
"다음 계속하기" action. Display the same 4 choices on question and feedback
screens; do not shrink text or scroll vertically to hide overflow. Use internal
page transitions for long text. Explain WHY each incorrect option is wrong AND
HOW to correct it. Use meaningful full-sentence grammar context.

Persist/change exam year/month without deleting attempts/settings; distinguish
expected first-Sunday dates from official confirmed dates. Never convert raw
scores into official JLPT scaled scores or fabricated pass probabilities.

Do not copy JLPT official problems or recordings, and do not publish content
without human language/rights review. Never reuse the old v5.x codebase.

For every task: implement -> run actual tests -> inspect Android layout when
possible -> record results -> commit -> report blockers. Mocks do NOT prove
real Google integration; local desktop Chrome does NOT prove Android file mode.
```

**운영 규칙:** Sonnet이 사용자 확인 없이 아키텍처를 바꿔 백엔드를 추가하거나 `file://` 원본을 HTTPS로 위장하려는 우회를 도입하면 요구사항 위반. Cloud Console 실사용자 클릭·동의는 구현 에이전트가 대신 수행했다고 주장하지 않는다.

---

## 11. 검증 계획 — 실행 모드·모바일·단일 파일·콘텐츠·데이터 보존

### 11.1 자동 단위 테스트 우선순위

| ID | 대상 | 입력/예상 결과 |
|---|---|---|
| `TST-RUNTIME-01` | `file://` 모드 식별 | `location.protocol=file:` → Google SDK 초기화/HTTP API 0회, 파일 모드 안내·샘플 진단 표시. |
| `TST-RUNTIME-02` | HTTPS 모드 식별 | `location.protocol=https:` → 로그인 버튼 활성. 미인증 시 콘텐츠를 Sheet에서 읽었다고 거짓 표시하지 않음. |
| `TST-PACK-01` | 최종 한 파일 | build 후 `dist`에는 `index.html`만 있고 CSS/JS inline. 상대 `src`·`.js`·`.css`·`.json` 요청 0회. |
| `TST-PACK-02` | 파일 크기 예산 | `rawBytes` 측정·리포트. 200 KiB 이하는 목표, 300 KiB 초과는 사유/대안 리뷰가 없으면 릴리스 보류([실무 제안]). |
| `TST-SCHEMA-01` | 5레벨 공식 채점 영역 | N3 3영역, N4/N5 2영역. 실제 합격 기준과 별도 모의 raw 결과 분리. |
| `TST-DATE-01` | 연도/월 첫째 일요일 | `2027/07→2027-07-04`, `2027/12→2027-12-05`, `2028/07→2028-07-02`. 공식 공고 필드는 null. |
| `TST-DATE-02` | 목표 변경 | `2027/07→2027/12→2028/07`: 마지막 목표로 **향후 계획만** 변경, 기존 이벤트 ID·문항 결과·설정·시트 ID 손실 0건. |
| `TST-DATE-03` | 상한 시간 | `2026-10-15→2027/07` 상한 262시간(달력 전일 허용), `2027/12` 416시간. 시험일 제외·휴식일/과거 목표 처리. |
| `TST-DIAG-01` | 28문항 기본 라우팅 | 가나 6/8 이하면 `KANA_FOUNDATION`, 가나 통과+기초 5/8 이하면 `FOUNDATION`, 둘 다 초과면 `TARGET_FOCUS`; 항상 청해 미측정. |
| `TST-DIAG-02` | 중단/반복 | 2번째 제출, 새로고침, 기존 진단 문항 평가 재유입 차단. |
| `TST-PLAN-01` | 60분 예산 | 모든 경로 분배 합계 ≤60, 실제 오늘 수행분 공제. 사용 불가 청해 분량을 '완료'로 계수 안 함. |
| `TST-QUIZ-01` | 무제한 기본값·수동 진행 | `timeLimitSeconds=null`, 제출 후 10초 대기해도 다음 문제로 안 이동, 명시 버튼으로만 이동. |
| `TST-QUIZ-02` | 4선지·오답 해설 | 보기가 항상 4개, 정답 1, 오답별 이유+교정 전부 다름/존재. 누락 시 콘텐츠 게시 차단. |
| `TST-QUIZ-03` | 폰트·후리가나 | `S/M/L/XL` × 3 후리가나 모드, 설정 이벤트 원격 복원, 보기 수/순서 동일. |
| `TST-CONTENT-01` | 시트에서 동적 콘텐츠 | 승인된 `packVersion` 추가 후 HTML 해시 변화 **없이** 새 문제 노출. 비승인/스키마 오류는 노출 안 함. |
| `TST-CONTENT-02` | bootstrap idempotency | 빈 시트 처음 초기화 → 28문항 seed. 앱 새로고침/HTML 업그레이드로 같은 ID+버전 중복 0행. |
| `TST-CONTENT-03` | 버전 정정·권리 | 이전 콘텐츠 이벤트는 이전 버전 유지, 새 레코드 별도. 오디오 권리/오답 개별 교정 없는 팩은 게시 차단. |
| `TST-SYNC-01` | 중복/손상 | 동일 eventId+동일 checksum 1회 적용, 동일 ID+다른 checksum은 read-only/백업 안내. |
| `TST-SYNC-02` | 저장 재시도 | 원격 append 성공 뒤 응답 유실 → 재조회→ACK, 논리 중복 0건. |
| `TST-SYNC-03` | 두 기기/설정 변경 | 모든 풀이 이벤트 합집합, 대상 연도/월 충돌은 사용자 선택 전 원격 덮어쓰기 없음. |
| `TST-MIG-01` | 앱 버전 교체 | V0→V1 fixtures: 프로필, Sheet ID, 설정, 목표, 콘텐츠 팩, 모든 풀이 ID·해시 보존. |
| `TST-READINESS-01` | 미노출 평가 | V0/V1 학습문항 평가 재활용 불가, 표본 0/5/20/30 분기, 합격 확률 텍스트 생성 0회. |

### 11.2 UI·실기기 QA — Android Chrome을 출시 게이트로

| 기기·상황 | 체크리스트/수용 기준 |
|---|---|
| **PC Chrome `file://`** | 파일 더블클릭 즉시 앱 화면과 bootstrap 진단 표시. CORS 예외/서버 설치 요구 0회. OAuth 시도 0회·로컬 모드 메시지 정확. |
| **Android Chrome `file://`/`content://`** | 파일 다운로드→파일 앱에서 열기→Chrome 열림 여부·JS 작동·클릭/폰트/ruby·백업 내보내기/가져오기 실기기 로그. **실패하면 모바일 직접 파일 모드는 미지원으로 명시**하고 호환 가능하다고 주장 금지. |
| **Android Chrome HTTPS** | Google 계정 선택/동의·Sheet URL 붙여넣기·OAuth 팝업/복귀·실제 쓰기·재조회·페이지 재진입·폰트/후리가나 유지까지 연속 재현. |
| **GitHub Pages 단일 HTML 게시** | Pages 루트에 `index.html` 1개만 배포되어 `https://<owner>.github.io/<repo>/`로 접속 가능하고, 해당 Origin이 OAuth Client에 등록됨. APK/서버/외부 로컬 JS·CSS·JSON 요구 0건. 민감정보 공개 산출물 0건. |
| **최소 뷰포트** | Chromium 320×568, 360×640, 390×844 및 실제 Android Chrome에서 4선지+현재 지문 페이지+버튼이 **스크롤 없이 화면에 모두 표시**. 긴 글은 페이지 전환. |
| **정답/해설 전환** | 해설 상태에서도 4개의 보기가 사라지지 않음, 글꼴 줄이지 않음, 탭별 오답 이유+어떻게 고치면 맞는지 표시. |
| **사용자 이동** | 정답 확인 후 사용자가 화면을 닫지 않는 한 '다음 계속하기'를 누르기 전 문제 유지. 딜레이/오디오 재생 종료/10회 연속 탭에서 자동 진행 없음. |
| **실시간 음성/폰트** | Android의 선택 가능 `ja-JP` voice 목록·재생/에러·한자 읽기 품질 기록. 평가 청해는 검수 음원만, 없으면 미측정. |
| **키보드/스크린리더** | 보기·해설·뒤로가기·다음·설정의 포커스/접근성 이름 확인, 터치 영역 44 CSS px 유지. |
| **Chrome 프로세스 종료** | HTTPS IndexedDB에서 pending 이벤트가 유지되는지 재실행 검사. `file://`은 실패 가능성까지 테스트하고 백업 경고를 확인. |

**한 화면 규칙의 합리적 해석:** 장문 독해 원문 전체+4선지+오답 설명 네 개를 320×568에 한꺼번에 보여 주는 것은 공간상 불가능하다. **현재 화면 페이지**의 모든 요소가 한 뷰포트에 들어가도록 하고, 긴 지문/해설의 다른 페이지는 명시적 버튼으로 전환한다. 보기 4개의 가시성과 글자 크기는 유지한다. 세로 스크롤 또는 글자 축소로 요구를 회피하지 않는다.

### 11.3 Google Sheets 실제 통합·백업/복원 게이트

| 케이스 | 수용 기준 |
|---|---|
| 새 빈 Sheet 연결 | 직접 URL 입력 → `spreadsheets` 동의 → 기존 모든 탭 무변경 → 앱 전용 탭·헤더·bootstrap 활성 팩 생성 → 재조회 성공. **Picker 등장 0회.** |
| 기존 일반 데이터가 있는 Sheet | `_JLPT_*` 없는 상태에서 초기화하면 업무용 기존 탭/셀 전후 diff **0건**. |
| 두 번째 실행 | 같은 Spreadsheet ID 재연결 → 탭/seed 중복 0, 진단·개인 설정·목표·팩 복원. |
| HTML 교체 | `v0.1.0`의 `index.html`을 새 파일로 교체(HTTPS Origin 동일) → Sheet ID 힌트 유지/재입력 가능, 10개 풀이·목표 연도/월·후리가나·글자 크기·콘텐츠 복원. |
| 다른 기기 Android Chrome | 같은 Google+Sheet URL로 접속 → 최초/이전 이벤트가 복원되고 동일 미노출 진단을 새로 시작하지 않음. |
| OAuth 401·403·404·동의 거부 | §8.4 정확한 상태/문구, 이전 로컬 로그·outbox 유지, 사용자 기존 Sheet 변경 0건. |
| 429·5xx·응답 유실 | 원격 재조회 후 추가/ACK, 동일 이벤트 논리 집계 1회. |
| 권한 없는 시트·오타 URL | 무단 시트 생성·다른 ID로 fallback 금지, 원인 안내. |
| 앱 메타 충돌/미래 schema | 자동 덮어쓰기·삭제/재초기화 0건, read-only와 JSON 백업 가능. |
| 동시 2기기 풀이/목표 변경 | 풀이 이벤트 합집합 재생, 목표 선택 충돌 UI에서 기존·신규 값 비교하고 사용자 결정을 기다림. |
| 콘텐츠 확장 | 기존 HTML 그대로 새 approved `VOCAB/GRAMMAR/QUESTION` pack 임포트 → UI에서 신규 콘텐츠 사용 가능, 학습 이력 리셋 0건. |
| 다중 버전 콘텐츠 | 같은 contentId의 이전/새 콘텐츠 버전이 Sheet에 모두 남고, 과거 풀이 이벤트의 참조 대상 불변. |
| 사용자 연결 해제 | Google 권한 해제와 로컬 캐시 삭제를 분리, Sheet 정본·이벤트는 삭제하지 않음. |
| `file://` 백업 | 생성한 JSON을 파일로 내보내고 HTTPS 모드에서 **명시적 병합 승인** 후 이벤트 ID 중복 없이 반영. 실패 시 원본 백업 보존. |

### 11.4 릴리스 차단 기준(버전별)

| 버전 | 필수 검증 | 차단 사유 |
|---|---|---|
| V0 | 한 파일 빌드/데스크톱 file 모드/Android HTTPS UX, 28문항 검수, 목표 연도/월 변경, 시트 최초 초기화+쓰기+재읽기, 업그레이드 설정 복원 | `file://`를 Google 성공으로 오인; 실제 Google 미검증/HTTPS 설정 미완료; 데이터 유실; HTML 외 필수 파일 존재 |
| V1 | SRS·한국어 문맥 문법·Sheet 새 콘텐츠 팩 게시, HTML 해시 불변 실험, 파일 모드 백업 병합 | 콘텐츠 추가에 HTML 수정 필수/오답 해설 누락/학습 기록 초기화 |
| V2 | 사람 검수 음원·모바일 청해, 페이징 독해, TTS와 평가 격리 | TTS 평가 대체/권리 불명 음원/폰트 축소·세로 스크롤 |
| V3 | 신규 평가 격리, 채점영역별 표본/불확실성, 허위 합격확률 표기 없음 | 공식 점수 예상치 출력/낮은 표본을 '안전권'으로 판정 |
| V4 | 콘텐츠/이벤트 대용량·마이그레이션·스냅샷·여러 기기 충돌, 전 버전 설정 보존 | 버전 업 또는 원격 이벤트 충돌로 개인 기록 손실 |

**테스트 증빙:** 각 작업은 실행된 명령·실제 통과/실패·스크린샷/로그·실기기 정보·해시·사용한 테스트 Sheet의 **가명 식별**을 `docs/qa/`에 남긴다. Google 실제 테스트 미완이면 테스트를 실행한 척하지 않는다. 사용자 실계정 Sheet 내용·OAuth 토큰은 QA 로그/커밋에 포함하지 않는다.

---

## 12. 위험·미확인 사항과 해결 순서

### 12.1 리스크 레지스터

| ID/심각도 | 위험·근거 상태 | 처리·완료 게이트 |
|---|---|---|
| **R00/P0 (설계 해결, 실행 검증 대기)** | `file://` Google OAuth 불가 `[공식 확인]`; 동일 파일의 두 실행 모드를 혼동하면 데이터 손실/오류 | 정적 HTTPS=Google 연동, `file://`=로컬 미리보기로 분리 완료. W0에서 실제 Google OAuth/Sheets·모바일 Chrome 스파이크를 수행해 남은 실행환경 위험을 해소한다. |
| **R01/P0** | **Android Chrome이 파일 관리자의 단일 HTML을 열고 JS/Storage/백업을 안정적으로 실행하는지 `[미확인]`** | W0 실제 Android Chrome에서 다운로드→Chrome 열기→bootstrap 진단→새로고침→내보내기. 실패하면 `file:// Android` 미지원으로 표시하고 HTTPS 실행만 지원. |
| **R02/P0** | `spreadsheets` 민감 스코프와 OAuth Testing/Production 검증 조건 `[공식 확인: 민감 분류, 앱별 검증은 미확인]` | W0 Cloud 설정·테스트 사용자 1회 동의·실 시트 read/write. 공개 출시 전 추가 OAuth 검증 요건 확인. |
| **R03/P0** | Sheet 콘텐츠·사용 기록 무손실·원격 쓰기 중복/경쟁 조건 | V0 이벤트 ID 재조회 ACK, 새 시트 비파괴 초기화·업그레이드/다른 기기 복원. V4 장기 최적화. |
| **R04/P0** | 오리지널 문항/단어/녹음 사용권·일본어 품질 검수 | V0 seed 28문항+샘플 권리/언어 승인. V2 이전 평가 청해 녹음/외부 호스팅 근거 확보. 미확인 음원은 `NOT_MEASURED`. |
| **R05/P0** | 모바일 4선지·글자 크기 유지·한 화면 UX 충돌 | V0 작은 viewport·실기기 시각회귀, 긴 지문/해설 페이징. 모든 보기 고정. |
| **R06/P1** | `file://` 로컬 저장 수명·경로 이동 시 저장 유지 불명 `[미확인]` | V0 기능 감지+JSON 백업 UI, 재실행 테스트. 영속성 보장 문구 금지. |
| **R07/P1** | 2027 시험일/접수·수험료 `[미확인]` | V0 목표를 연도/월로 받고 예상일만 계산. 공고 직접 확인 후 `confirmedExamDate` 업데이트. |
| **R08/P1** | JLPT 공식 어휘·한자·문법 완전 목록 없음(N3 포함 전 등급) | 출제 범위 자체는 추정 레벨 태그. Sheet의 선언된 콘텐츠 팩 범위만 커버리지로 표시. |
| **R09/P1** | 한국인 학습 250/350/500시간, SRS 일일 분량 최적성 `[미확인]` | 앱 공식에 고정하지 않고 일수×60분 상한·주간 실적, 정책값 `[실무 제안]`. |
| **R10/P1** | 공식 척도 변환·합격 확률 통계 `[미확인]` | V3 준비도/상대 약점만, 검증 전 확률 출력 금지. |
| **R11/P1** | 콘텐츠가 커질 때 Sheet API 성능·HTML seed 용량 | V0 바이트 측정, V1 pack lazy-loading, V4 대형 시트 range·캐시 벤치마크. |
| **R12/P1** | 미검수 TTS/오디오의 음질·재생 환경 | V2 Android Chrome/PC 브라우저별 듣기 QA, 평가 녹음과 TTS 분리. |
| **R13/P1** | 기존 Sheet 탭 이름 충돌·콘텐츠 스키마 손상·사용자 수동 편집 | V0 read-only 복구와 헤더 검증. 자동 덮어쓰기 금지. |
| **R14/P1** | 단일 HTML bundle에 외부 dependency/동적 파일을 실수로 남김 | 빌드 산출물 1개 검사, file mode 네트워크 없는 샘플 테스트, size report. |
| **R15/P1** | GitHub Pages 공개 HTML·동일 `github.io` Origin 내 다른 프로젝트와 저장소 공유 가능성 | W0 Pages 공개 설정/Origin/개인정보 점검, API 토큰 메모리 전용, local storage 키 네임스페이스. 필요 시 전용 사용자 사이트·독립 도메인으로 격리하되 Origin 변경 시 재인증·정본 복원 테스트. |

### 12.2 일정 — 확정 납기 아닌 **상대 작업순서 제안**

| 단계 | 결과물·완료해야 할 위험 | 실패 시 처리 |
|---|---|---|
| **W0 착수/기술 검증** | D4=B 전제 확인, GitHub Pages HTTPS 게시·OAuth Origin·Sheets 실계정 PoC, Android Chrome 파일 열기 실기기 로그, 앱 1파일 빌드 PoC, 콘텐츠 승인 프로세스 | Cloud/HTTPS 사용자 설정 미완료면 실연동 E2E만 `BLOCKED`; 핵심 로직·Mock 테스트는 진행. |
| **W1–W2 V0** | 28문항 seed 검수, 시트 구조/초기화/동기화, 진단·60분·목표 연도/월 변경, 모바일 퀴즈, 백업/복원/배포 QA | OAuth/권리/시트 복원 P0 미해결 시 태그 금지. |
| **W3–W4 V1** | Sheet 콘텐츠 임포트·게시·SRS·문장 문법, 빌드 해시 불변 확인 | JSON/Sheet schema 불일치·정답·이력 손실 시 배포 중단. |
| **W5–W7 V2** | 독해 유형 확대·검수 청해·오디오 호스팅 계약·기기 테스트 | 권리·음질 미확인 음원 평가 제외. |
| **W8–W9 V3** | 신규 평가폼 격리·영역별 지표/경고·미확인 표시 UX 검증 | 공식 점수·확률로 오인되면 릴리스 보류. |
| **W10+ V4** | 데이터셋 대형화·콘텐츠 운영 관리·모든 구버전 복원/마이그레이션 | 스키마 무결성 실패 시 이전 릴리스/읽기 전용 유지. |

마일스톤은 인력·콘텐츠 검수·Google 설정 승인 시간에 따라 달라진다. **2027년 공식 시험/접수 공고를 W0~W10 안에 반드시 알 수 있다고 가정하지 않는다.**

---
## 13. Sonnet 5.5 인수인계 — 구현 순서와 단위별 수용 계약

### 13.1 입력·작업 범위·보고 형식

**입력 필수 파일:** `plan.md`, `research_revised.md`, 현재 리포지토리 구조·커밋 상태. 다른 대화의 요약만 보고 필드를 임의 개명하지 않는다. 과거 v5.x 단일 HTML 코드는 **검토·복사를 구현 조건으로 삼지 않는다**.

**시작 시 Sonnet이 먼저 보고할 내용:** D1=A/D2=B/D3=연도·월/D4=B 확정, D5 음원은 V2 승인 조건, 마지막 `git status`, 실행 OS/브라우저, `research_revised.md`와 plan의 미확인 항목. **파일 모드·코어 로직·Google Mock 어댑터는 추가 질문 없이 시작**한다. 실 OAuth/정적 HTTPS E2E는 사용자가 제공한 Cloud 설정·배포 권한·테스트용 Sheet가 없으면 `BLOCKED`로 정확히 기록하고, 아키텍처 결정을 다시 묻지 않는다.

**모든 작업의 종료 보고 형식(빠짐없이):** 변경 파일 → 실제 동작 → 실행한 검증 명령/실행 환경 → `PASS/FAIL/BLOCKED` 및 근거 로그 → 적용한 schema/content/app 버전 → 사용자 확인 필요 사항 → Git 커밋 해시. 오프라인 Mock 성공을 '실 계정 완료'로 보고 금지.

### 13.2 작업 목록 — 각 입력·산출물·수용 기준

| 작업 / 선행 | 입력 | 산출물 | **수용 기준** |
|---|---|---|---|
| **T00 / 최초** | D1~D5, 공식 OAuth·file origin 자료, 실제 Android Chrome·테스트 Cloud 사용 가능 여부 | `docs/decisions/ADR-001..006`, `docs/qa/runtime-spike.md`, 모드별 가능/불가 표 | `file://` GIS 불가를 재현하거나 공식 근거로 확인; Android 파일 열기 실기기 결과가 없으면 `미확인`. D4=`ACCEPTED`. 정적 HTTPS의 Origin·권한 범위·사용자 Cloud 준비 상태를 명시. |
| **T01 / T00** | §7.1–7.3, 기존 코드 재사용 금지 | TypeScript 모듈 소스·한 파일 빌드 스크립트·템플릿·`dist/index.html`, package/README/CLAUDE | `npm run build` 후 파일 정확히 하나, `file://` PC Chrome에서 화면/가나 seed 미리보기 렌더, 런타임 `npm/localhost/별도 JS` 요구 없음. 사이즈 보고. |
| **T02 / T01** | §4.4·§6.1–6.4, §5 콘텐츠 검수 규칙 | `ExamSpec` 5레벨·도메인 타입·Sheet 헤더 계약·28문항 seed 스키마/검수 fixture·content-lint | N4/N5 2영역과 N3 3영역 구분, 목표 `year/month` 첫째 일요일 계산, 오답 3개 개별 교정·라이선스 누락 차단. 실제 미검수 콘텐츠는 `BLOCKED`, 제작완료로 표시 금지. |
| **T03 / T01,T02** | `RuntimeMode`, §7.4–7.6 | file/https 모드 판별, 로컬 feature detection, append event/outbox, JSON export/import, MockSheetsAdapter | file://에서 OAuth 호출 0회, 저장 API 실패→명확한 경고/백업, 이벤트 UUID 중복 제거·checksum, JSON import 전 preview/승인, 페이지 재열기 가능 범위 문서. |
| **T04 / T02,T03** | §2.4 Quiz UX·V0 seed | 바닐라 JS `QuizShell`, 해설 pager, 4선지·폰트·ruby 설정, mobile CSS | 타이머 기본 없음/정답 확인 후 사용자 버튼 전진/4선지 고정/개별 오답 이유+교정/320×568 등 QA. DOM 정답 누설 금지. |
| **T05 / T01,T03,HTTPS 테스트 환경 준비** | Google Cloud **테스트 프로젝트·Client ID·정적 HTTPS Origin**(사용자 설정), D2=B | GIS TokenClient, 구글 연결 버튼·동의 설명, URL 파서, account binding, Sheets REST adapter, GitHub Pages 게시/Origin 검증 안내 | 실제 HTTPS에서 `spreadsheets` 범위 승인→사용자 URL의 동일 ID 조회. Picker 0회. Android Chrome 로그인 복귀 성공. Cloud Client ID/HTTPS 테스트 사이트·테스트 계정 미제공이면 실제 연동 **BLOCKED**, Mock 코드만 별도 통과. |
| **T06 / T02,T05** | §6.3 테이블/메타, 승인 bootstrap 28문항 | 비파괴 탭 생성·헤더 작성·seed idempotency, 콘텐츠 조회/manifest 해시 검사 | 신규 Sheet 앱 탭만 생성, 기존 사용자 탭 0변화, 두 번째 실행 시 seed 중복 0, 다른 schema 발견 시 read-only. 미승인/무권리 seed 게시 금지. |
| **T07 / T03,T05,T06** | §7.5 SyncEvent, Google HTTP 오류 매트릭스 | 이벤트 append/readback ACK, 원격 cursor/cache, 권한·오프라인·충돌 UI, 설정/목표/진단 복원 | 응답 유실·401/403/404/429/5xx에서 pending 유지; 재조회 후 ACK; 2기기 풀이 합집합/중복 제거; Sheet를 정본으로 쓰고 사용자 기존 탭 보호. |
| **T08 / T02,T04,T07** | §4 진단·계획, 목표 연도/월 변경 | V0 28문항 진단 라우팅, `ExamTarget` 입력/수정, 당일 학습 60분 플랜, 임시 준비도(청해 미측정) | 세 경로 테스트, `2027/07·12` 예상일·일수 회귀, 목표 변경 후 역사·설정 유지, 콘텐츠 없는 청해 완료 허위 기록 없음. |
| **T09 / T01–T08** | §11 모든 V0 테스트, 실기기·실 Google QA | `docs/releases/V0.md`, QA 스크린샷·로그, `CHANGELOG.md`, 빌드 sha256/size, 최종 `dist/index.html` | 모든 V0 P0 종료 또는 명시적 출시범위 분리. Android Chrome **HTTPS Google 실연동**, PC file 샘플, 모바일 파일 모드 실제 결과 기록. 데이터 복원·권리 검수·1파일 검증 후에만 `v0.1.0`. |
| **T10 / V0 완료** | V1 콘텐츠 팩·§4.2 학습 루프·§5 import | Sheet 콘텐츠 JSON/TSV importer, 버전 검수·활성화, 어휘·한자/SRS·문맥 문법, `v1.0.0` | HTML 파일 수정 없이 Sheet에 신규 단어/문항 추가, 승인된 팩만 학습. 구버전 학습 기록 유지·SRS due/오답 교정 테스트. |
| **T11 / V1 완료** | 승인 독해 지문·검수 청해 녹음·오디오 링크 정책 | 긴 글 페이징, 정보검색·청해·섀도잉/TTS 연습, `v2.0.0` | 모바일 모든 보기 고정·정답 해설, 오디오/스크립트 QA, TTS 평가 사용 0건, 음원 실패 미측정. |
| **T12 / V2 완료** | 미노출 평가팩·§9 준비도 | 영역별 `k/n`/표본/시간/커버리지, 불확실성·취약 주의, `v3.0.0` | `n<20` 자료 부족, 학습/진단 노출 평가 제외, JLPT 공식 점수·합격확률 수치 출력 0건. |
| **T13 / V3 완료** | V0–V3 저장 fixture·장기 시트 데이터 | 마이그레이션·스냅샷·충돌 해소·대용량 로딩, `v4.0.0` | 앱 HTML 교체/모바일 캐시 삭제/멀티기기 충돌 후 프로필·목표·설정·학습 이벤트/콘텐츠 원격 복원 검증. |
| **T14 / 별도 승인** | N2/N1 콘텐츠/시험 구조/오개념 팩 | 새 레벨 출발/복습/모의평가, N2·N1 pack | 기존 등급(N3 등) 이벤트/Sheet schema 역호환·각 레벨 공식 스펙과 개인 목표 독립. |

**릴리스 절차(매 버전):** `plan → implement → unit test → file mode smoke → HTTPS mock → 실제 Google 계정/Sheet QA → Android Chrome QA → migration regression → rights review → size/hash report → git commit → tag`. 외부 권한/실기기 결손이 있으면 `BLOCKED`로 정확히 남기고 태그 발행을 보류한다.

### 13.3 Sonnet이 **하지 말아야 할 것**

1. React/Vite 개발서버를 사용자 실행 필수 조건으로 다시 도입하거나, 최종 산출물을 여러 JS/CSS 파일로 분할하는 것.
2. **`file://`에서 Google OAuth가 가능하다고 주장**하거나, `--disable-web-security`, `Origin: null` 허용, 수동 token 복사 등 보안 우회로 성공 처리하는 것.
3. D2=B를 무시하고 Picker·`drive.file`을 기본 구현하거나 Google 전체 Drive 검색 범위를 추가하는 것.
4. 사용자가 입력한 Sheet가 아닌 다른 Spreadsheet ID에 자동 기록하거나, 사용자 원본 탭을 지우거나, 기존 앱 탭을 충돌 시 재초기화하는 것.
5. 개별 단어/문제를 HTML 안에 계속 누적하여 Sheet 기반 확장성을 없애는 것. V0 승인 bootstrap을 넘는 신규 데이터는 Sheet 팩으로 설계한다.
6. `appVersion` 변경을 `sheetSchemaVersion` 초기화로 취급하거나 목표 연도/월 변경 시 진단/답안/설정을 초기화하는 것.
7. JS 메모리에만 사용자 풀이를 보관한 채 '저장 완료'로 표시하거나, `file://` 캐시가 버전/경로 이동 이후에도 안전하다고 약속하는 것.
8. 정답 확인 후 자동 이동/기본 타임아웃/4선지 숨김/폰트 자동 축소/세로 스크롤 회피/오답별 이유+교정 누락/어미만 보고 푸는 문법 콘텐츠.
9. 공식 JLPT 시험지·오디오·교재를 복제하거나, 미검수 AI 생성 문항을 자동 발행하거나, TTS만으로 청해 합격 준비도를 점수화하는 것.
10. '한국인 250시간 합격', '정답률 65%면 합격확률 80%' 등 검증되지 않은 수치를 제품의 확정 사실로 표시하는 것.
11. OAuth Client Secret, 실 사용자 토큰, Google 개인 시트 원본, 개인 데이터, 라이선스 미확인 오디오를 Git에 포함하는 것.
12. 에뮬레이터 화면/Mock REST 성공만으로 Android Chrome 실기기·Google Sheets E2E를 완료했다고 선언하는 것.

### 13.4 사용자 확인이 필요한 실제 시점

| 시점 | 확인 내용 | 확인 전 가능한 작업 |
|---|---|---|
| **T00 이후/실 Google 시작 전** | **신규 아키텍처 결정은 필요 없음.** 사용자 소유 GitHub 저장소/Pages 배포와 Google Cloud OAuth Client ID·HTTPS Origin 등록 등 외부 계정 작업의 실행·공개 범위만 확인. | 파일 모드, 콘텐츠 모델, QuizShell, 진단/60분 계획, Mock sync, Google API adapter 제작. |
| **T05 인증 E2E 전** | 사용자가 직접 Cloud Console의 Sheets API·OAuth 동의·Sensitive scope·HTTPS Origin·테스트 계정 설정, 시험용 Sheet URL 제공. | 인증 Mock/오류처리 코드·다른 개발 작업. |
| **V0 seed·V2 오디오 승인 전** | 원어민/한국어 해설 검수와 오리지널/녹음 라이선스 승인자 지정. | 승인 대기 팩 제작·검사·학습 로직 테스트. |
| **각 릴리스 전** | HTML 한 파일·앱 크기·실 Google/모바일 QA·내용 품질·데이터 복원 테스트 결과 수용. | 미완료 테스트 보완 및 회귀 수정. |
| **공식 시험 공고 발표 후** | 사용자가 목표 회차 공식 시험일·접수일을 공식 URL 기준으로 확인/확정. | 기존 예상 시험일과 60분 상한 계획 유지. |

**D1=A·D2=B·D3=연도/월·D4=B는 다시 묻지 않는다.** Google Cloud/Pages 실환경 권한이 없어 E2E가 막힐 때는 정확한 사용자 체크리스트만 요청한다. D5 평가용 음원·사용권 최종 승인은 V2 이전에만 요청하며, V0은 `청해 미측정`으로 완료 가능하다.

### 13.5 다른 개발 세션/Sonnet에게 전달할 첫 실행 프롬프트

> `plan.md`와 `research_revised.md`를 전체 읽고 새 Git 저장소에서 T00부터 수행하세요. V0부터 새 프로젝트이며 v5.x 코드는 사용하지 않습니다. **최종 배포물은 HTML+inline CSS+inline JS가 들어간 `dist/index.html` 한 파일**입니다. 개발 단계에서만 TypeScript/esbuild·테스트 도구를 써도 됩니다. 사용자가 정한 D1=A(Sheets 정본), D2=B(링크 직접 입력+spreadsheets 민감 스코프, Picker 없음), D3(목표 연도/월 언제나 수정 가능)를 확정 요구로 적용하세요. `file://`에서는 Google OAuth가 공식 지원되지 않으므로 file 모드는 샘플 학습·수동 백업으로 제한하고, **실 Google 자동 동기화는 등록된 HTTPS 정적 Origin에서만** 동작하도록 어댑터를 분리합니다. D4=B는 확정된 구현 기본안이므로 다시 묻지 말고, 실제 Google Cloud/Pages/실계정 환경이 없는 경우에만 그 E2E를 `BLOCKED`로 남기세요. 검수된 V0 bootstrap 28문항만 HTML에 작게 포함하고, 그 밖의 모든 어휘·문법·지문·문항 및 학습 이력/설정은 사용자가 연결한 Sheet의 앱 전용 탭에 버전별 기록으로 확장·복원되게 구현하세요. 매 문제 무제한 기본, 답 제출 후 '다음 계속하기' 수동 전진, 4선지 한 화면 유지, 오답별 원인+교정, 모바일 글꼴·후리가나 설정을 지킵니다. 앱 버전 변경·목표 변경은 기존 이력을 삭제하지 않습니다. 모든 작업 후 실제 테스트·실행 환경·FAIL/BLOCKED·커밋 해시를 보고하고, 구글 Mock 성공을 실제 Google E2E로 표시하지 마세요.

---

## 부록 A. 플랜의 최종 인수 기준(전체 합격 정의)

- [ ] 최종 `dist/index.html` **단일 파일**에 JS·CSS가 인라인, 정적 콘텐츠는 작은 승인된 V0 bootstrap만 포함. 설치·실행에 로컬 서버 필요 없음.
- [ ] **PC `file://` 로컬 샘플 기능** 작동, Google 연결 불가 안내, JSON 내보내기 가능. Android `file://` 동작 여부는 실기기 근거 또는 '미지원/미확인' 라벨로 정확히 표기.
- [ ] **D4=B 적용:** 같은 HTML을 정적 HTTPS에서 Android Chrome·PC Chrome으로 실행하고 Google 계정 승인·`spreadsheets` 권한·직접 URL 지정·Sheets 읽기/쓰기 확인. Picker 없음. 실험 계정·HTTPS 환경이 없으면 **해당 E2E 차단 상태이며 V0 Cloud 완료 아님**.
- [ ] Google Sheet에 `_JLPT_META`, `_JLPT_PACKS`, `_JLPT_CONTENT`, `_JLPT_SOURCES`, `_JLPT_EVENTS`를 비파괴적으로 초기화. 초기화 재실행과 HTML 교체 시 중복·원본 데이터 변경 없음.
- [ ] 신규 콘텐츠 행/검수된 pack 추가만으로 신규 단어·문법·문제가 UI에 노출되며 HTML은 수정하지 않음. 검수되지 않은 팩 노출 없음.
- [ ] 진단 28문항을 통한 3가지 학습 경로, 미측정 청해 표기, 첫날 진단 학습시간 공제, 실적 기반 상한 60분 계획이 결정적으로 작동.
- [ ] 목표 **연도/월** 입력·수정, 첫째 일요일 **예상일** 표기, 공고 확인 전 `CONFIRMED` 금지. 변경 전 학습 이력·연결·설정 보존.
- [ ] 무제한 퀴즈 기본·정답 확인 후 수동 다음·한 화면 4선지·같은 질문/해설 구성·오답 3개 개별 이유/교정·문맥 문법·모바일 글꼴/후리가나 지원.
- [ ] Google Sheet 정본 이벤트 append+재조회 ACK, 미동기화 알림, 두 기기/브라우저 재연결 시 설정·풀이·팩·목표 복원, 이전 schema fixture 통과.
- [ ] 공식 목표 등급(최초 N3)의 시험 시간/합격 기준과 N4/N5 2영역 채점 구조를 정확히 참고. 확률·공식 예측점수·학습시간 보장 수치 생성 없음.
- [ ] 테스트 실행 로그·Android Chrome 실기기 결과·OAuth 수동 설정·콘텐츠 권리 원장·HTML 크기/해시·Git/CHANGELOG/버전 태그를 검증해 릴리스 선언.

## 부록 B. 근거 URL(공식 우선)

1. JLPT 시험 구성·시간: https://www.jlpt.jp/e/guideline/testsections.html
2. JLPT 성적 영역·합격선: https://www.jlpt.jp/e/guideline/results.html
3. JLPT 공식 출제 목록 부재/FAQ: https://www.jlpt.jp/e/faq/
4. 한국 JLPT 관리 규정(시험 일정 원칙·실시위원회): https://www.jlpt.or.kr/html/information_06.html
5. 한국 JLPT 공식 공고: https://www.jlpt.or.kr/
6. Sheets API OAuth 스코프 표: https://developers.google.com/workspace/sheets/api/scopes
7. Google GIS Token Model(직접 REST+CORS, 클릭 동의): https://developers.google.com/identity/oauth2/web/guides/use-token-model
8. Google Web OAuth 허용 JavaScript Origin: https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
9. Google JS API의 `file://` 비지원 FAQ: https://google.github.io/google-api-javascript-client/docs/faq.html
10. Google OAuth 정책(안전한 Origin·동의): https://developers.google.com/identity/protocols/oauth2/policies
11. Google Sheets RAW 입력 값: https://developers.google.com/workspace/sheets/api/reference/rest/v4/ValueInputOption
12. Google Sheets append: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append
13. Google Sheets API 한도: https://developers.google.com/workspace/sheets/api/limits
14. MDN `file:` origin 정책: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
15. MDN localStorage와 `file:` 미정의 동작: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
16. MDN Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API

**편집·검증 로그:** 2026-10-16 최종: D1=A(Sheets 정본), D2=B(링크+민감 spreadsheets 권한), D3(수정 가능한 연도/월), D4=B(단일 `index.html`의 GitHub Pages 정적 HTTPS 실행)을 구현 기본안으로 정리했다. D5는 V0 `청해 미측정`/V2 녹음 승인이라는 단계별 정책으로 반영했다. 기존 React/Vite/localhost 사용자 실행 전제와 Picker 기본 설계는 제거했다. `[실무 제안]` 수치·파일 크기·콘텐츠 초기 분량은 검증 가능한 제품 가설이지 JLPT 공식 보장치가 아니다.
