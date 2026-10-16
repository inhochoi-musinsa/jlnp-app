# JLPT 학습앱 확정 실행 플랜 v3.4 (`execution_plan.md`)

- **문서 버전:** 3.4 / 2026-10-16 (구현 착수용 최종 지시서. 3.4: 특정 등급(N3)에 한정된 명칭을 레벨 중립으로 정리, 저장소 이름 `jlpt-app`. 3.3: Claude 연동을 API와 headless 두 방식으로 모두 지원. 3.1: 콘텐츠를 초기 분량 + 점진 추가 방식으로 전환, 저장소 게이트 추가. 3.2: 사용자 가이드 `USER_GUIDE.md` 추가 및 유지 의무화)
- **우선순위:** `execution_plan.md`(본 문서) > `plan.md`(v2.1, ChatGPT 작성) > `research_revised.md`. 충돌하면 본 문서를 따른다.
- **읽는 방법:** `plan.md`의 §2.4(UX 불변조건), §4.1(배치 진단), §4.4(목표 연도/월), §6.1(ExamSpec), §8(Google 연동·오류 매트릭스), §9(준비도), §11(테스트 ID)은 그대로 유효하다. 본 문서는 그 위에서 **변경·추가·삭제된 사항을 확정**한다.
- **범례:** `[공식 확인]` 공식 출처 확인 / `[실무 제안]` 설계값(검증 전 가설) / `[미확인]` 근거 부족. `[실무 제안]` 수치는 공식 통계로 표시하지 않는다.

---

## 1. 확정 결정

| ID | 결정 | 상태 |
|---|---|---|
| D1 | 정본 저장소는 **Google Sheets**, 기기에는 IndexedDB 캐시를 둔다. 저장소 접근은 `Repository` 인터페이스 뒤에 두어 나중에 Drive JSON 또는 Firestore 어댑터로 교체할 수 있게 하고, T00에서 모바일 읽기 지연을 측정하는 **저장소 게이트**를 둔다(§9 T00). | 사용자 확정 |
| D2 | 시트 접근은 **링크 입력 + `spreadsheets` 스코프**(민감 스코프). Picker와 `drive.file`은 구현하지 않는다. | 사용자 확정 |
| D3 | 목표 시험은 **연도/월**로 입력하고 언제든 변경할 수 있다. | 사용자 확정 |
| D4 | 실행 환경은 **정적 HTTPS(GitHub Pages), 모바일 Chrome 1차 대상**이다. `file://`은 미리보기·백업 전용이다. 개발 중에는 같은 HTML을 `http://localhost`에서도 연다. | 사용자 확정(2026-10-16) |
| D5 | 청해는 **TTS로 생성한 음원 파일을 게시**하여 학습과 평가에 사용한다(한계 표기 의무). 한계 개선 경로로 `BROWSER_TTS`(실시간 재생), `RECORDED`(사람 녹음 교체), TTS 엔진 교체를 모두 지원한다. | 사용자 확정(2026-10-16) |
| D6 | 콘텐츠는 **Claude로 대량 생성 + 자동 교차검증 + 앱 내 신고**로 확보한다. 생성은 앱 밖의 **로컬 CLI**에서 반복 실행하며 누적 확장한다. 앱은 콘텐츠를 **유형별/전체로 export·import**하고, import 시 자동 검증·병합을 수행한다. | 사용자 확정(2026-10-16) |
| D7 | 이전 앱(일본어 마스터 v5.x)의 **학습 기능과 UX는 계승**하고 코드는 재사용하지 않는다(§3.3). | 제안 적용 |
| D8 | Google 계정은 **개인 계정**을 사용한다(회사 Workspace 계정은 관리자 정책으로 외부 앱 OAuth가 막힐 수 있음). | 제안 적용 |
| D9 | 콘텐츠 생성·검증에서 Claude 연동은 **API 방식과 headless 방식(Claude Code `claude -p`)을 모두 지원**한다. 방식은 설정으로 선택하며 역할별(생성/검증)로 다르게 지정할 수 있다(§4.3.1). | 사용자 확정(2026-10-16) |
| D10 | **레벨 중립 원칙:** 목표는 N3부터 시작하지만 앱은 N5~N1 전체로 확장한다. 식별자·파일·저장소·경로·시트 탭·이벤트·UI 문구에 특정 등급(`N3` 등)을 하드코딩하지 않고, 등급은 `targetLevel`(설정), 콘텐츠의 `level` 필드, `ExamSpec[level]`로만 표현한다. 등급별 데이터(수량 목표, 진단 구성)는 `tools/content/targets/<LEVEL>.json` 등 등급별 파일로 분리한다. 저장소·Cloud 프로젝트 이름은 `jlpt-app`을 쓴다. | 사용자 확정(2026-10-16) |

---

## 2. plan.md(v2.1) 대비 변경·무효화 항목

| plan.md 위치 | v2.1 내용 | v3.0 확정 |
|---|---|---|
| 머리말, §7.2, 부록 A | 배포물은 `index.html` 1개, 런타임 파일 0개 | **앱 코드는 `dist/index.html` 1개 유지.** 청해 음원은 별도 정적 파일 `audio/*.mp3`이며 앱 코드가 아니다. Pages 게시 루트는 `index.html` + `audio/`로 구성한다. |
| §5.1(3~5), §5.3 | `DRAFT→VALIDATED→APPROVED→PUBLISHED` 사람 검수·승인 | **자동 검증 상태 모델**(§4.4)로 대체. 사람 검수는 선택적 표본 점검과 앱 내 신고로 한다. |
| §5.3 분량 목표 | V1 어휘 80, 문법 32, V2 독해 8·청해 20 | **§4.1 수량 목표**로 대체(목표 등급 합격 준비에 부족했음). |
| §5.4, §9.2 `audio_valid`, §13.3 #9 | TTS는 평가에 사용 금지 | **TTS 음원 파일은 평가 사용 가능.** 단 `audioSource` 표기, 한계 문구, `BROWSER_TTS` 기본 제외를 의무화한다(§5). |
| §6.2 `SyncEvent`, §6.3 `_JLPT_EVENTS` | `lamport` 필드 | **`lamport` 삭제.** `deviceId`, `deviceSeq`만 유지. |
| §6.2 충돌 규칙 | 목표 충돌 시 원격 쓰기 보류 + 사용자 확인 | **최신 `occurredAt` 우선 + 알림 토스트.** 쓰기를 보류하지 않는다. |
| §7.5 (2), (4) | 이벤트마다 append 후 재조회 ACK | **배치 전송 + 배치 단위 재조회 ACK**(§7). |
| §10.1 ADR 6개 | ADR-001~006 | **ADR 3개**: ADR-001 단일 HTML + 정적 HTTPS, ADR-002 Sheets 정본 + 배치 동기화, ADR-003 콘텐츠 파이프라인·팩 포맷. |
| §12.2 | 주 단위 일정 | 폐기. §9 작업 순서를 따른다. |
| plan.md v2.2 식별자 | `N3_FOCUS`, `N3_LANGUAGE`, `N3_READING`, `N3_LISTENING`, 저장소 예시 `jlpt-n3` | **`TARGET_FOCUS`, `TARGET_LANGUAGE`, `TARGET_READING`, `TARGET_LISTENING`, `jlpt-app`**. `plan.md`는 v2.2로 정리했으며 이 이름이 정본이다. |
| §13.2~13.5 | T00~T14, 첫 실행 프롬프트 | §9, §10, §13으로 대체. |
| 파일 크기 예산 | V0 200KiB 목표 | V0 300KiB 이하, 이후 버전은 §8.3. |

---

## 3. 앱 구조와 이전 앱 계승

### 3.1 화면 구조 (하단 탭 4개, v5.5.0 단순화 교훈 반영)

| 탭 | 구성 |
|---|---|
| **홈** | ① 오늘의 60분 카드(영역별 배분 분, 시작 버튼, **시작 전 안내: 오늘 할 일·진행 방식·예상 소요**) ② 오늘 복습 카드(기한 도래 n개, 약점 m개) ③ 영역 카드 3장(어휘·한자 / 문법 / 독해·청해, 5단계 숙련도 분포 막대) ④ 목표(연도/월, 예상일 표기, 남은 일수, 최대 학습 가능 시간) ⑤ 동기화 상태 배지 |
| **학습** | 오늘 세션(순서대로), 영역별 직접 선택, **혼동 글자 퀴즈(별도 메뉴)**, 약점 복습, 듣고 쓰기(V2), 실전 세트(V3, 영역별 시험 시간 선택 옵션) |
| **리포트** | V3: 학습 시간·정확도·숙련도 차트, 영역별 준비도 |
| **설정** | 목표, 표시(글자 S/M/L/XL, 후리가나, 다크 모드), 시트 연결, 콘텐츠(가져오기·내보내기·신고 목록·미검증 포함 토글), 백업/복원, 고급(청해 음원 소스, 수동 동기화, 디버그 로그) |

### 3.2 모든 버전의 UX 불변조건

`plan.md` §2.4의 10개 항목을 그대로 적용한다. 예외 하나만 허용한다: **듣고 쓰기(받아쓰기)는 입력형이므로 "4선지" 규칙에서 제외**하되, 나머지(무제한 기본, 수동 다음, 정답 선노출 금지, 같은 구성, 오답 교정)는 지킨다.

### 3.3 이전 앱에서 계승하는 항목

| 이전 앱 기능·교훈 | 새 앱 반영 | 버전 |
|---|---|---|
| 혼동 글자 퀴즈(별도 메뉴 유지 요청 이력) | `KANA` 혼동쌍(シ/ツ, ソ/ン 등)과 한자 혼동군 퀴즈를 학습 탭에 별도 메뉴로 둔다. | V1 |
| 날짜 기반 복습 간격, 5단계 숙련도, 복습 규칙 하나 | §6.1 확정 | V1 |
| 약점 위주 복습, 시작 전 진행 방식 표시 | §6.3, 홈 카드 | V1 |
| 문법 원리 학습(동사·형용사·조사·문형을 문장 속에서) | `GRAMMAR` 포인트와 문맥형 문항, 오답별 `whyWrong`/`howToCorrect` | V1 |
| 듣고 쓰기 | §6.4 | V2 |
| 학습 리포트 차트 | 인라인 SVG 차트(외부 라이브러리 금지) | V3 |
| 백업/복원, 다크 모드, 후리가나·글자 크기, 설정 시트 | 설정 탭 | V0 |
| 신규 단어 세트는 앱 밖에서 만들고 앱은 JSON 가져오기만 담당(번복 결정) | §4.3 로컬 CLI + §4.6 import | V1 |
| 버전별 스펙 MD(고정 베이스라인 + 최신순 변경 이력) | `docs/spec/jlpt_spec.md`를 릴리스마다 갱신한다. 베이스라인 본문은 수정하지 않고 변경 이력만 위에 추가한다. | 전 버전 |
| 학습 관리가 복잡하면 사용자가 이탈 | 홈은 "오늘 60분" 중심, 부가 기능은 설정의 고급으로 이동 | 전 버전 |
| **제외:** 캔버스 손글씨 판정, 필순 번호 | 판정 오류가 많았고 JLPT가 객관식이므로 합격 기여가 낮다. V3 이후 사용자 요청 시 별도 검토 | 백로그 |

---

## 4. 콘텐츠 시스템

### 4.1 콘텐츠 확보 방식: 초기 분량 + 점진 추가 `[실무 제안, 미검증]`

**원칙:** 한 번에 대량 생성하지 않는다. 초기 분량만 만들어 출시하고, 학습 진도와 약점에 맞춰 **주기적으로 추가**한다. 생성·검증·팩·import 절차(§4.3~4.6)는 그대로이고, 실행 시점과 양만 달라진다. 수량은 모두 **검증을 통과한 항목(`VERIFIED`) 기준**이며 JLPT 출제 범위 커버를 뜻하지 않는다. 아래 수량표는 **현재 목표 등급(N3) 기준**이고 `tools/content/targets/N3.json`에 둔다. N2/N1을 추가할 때는 같은 형식의 `targets/N2.json`, `targets/N1.json`을 만들고 `content:catalog`·`content:plan`이 `targetLevel`(설정)에 맞는 파일을 읽는다.

| 구분 | 초기 분량 | 시점 |
|---|---|---|
| 진단·시드 | 진단 28문항, 어휘 8, 문법 4, 독해 2 | v0.1.0 |
| 어휘·문법·한자 | 어휘 400, 문법 포인트 40(하위 등급 15 + 목표 등급 25, 포인트당 4문항 이상), 한자 읽기·표기·문맥 100문항, 혼동쌍 20 | v1.0.0 전 |
| 독해 | 지문 10(단문 4, 중문 4, 장문 1, 정보검색 1) | v2.0.0 전 |
| 청해 | 40(유형별 8) + 음원 합성 | v2.0.0 전 |
| 평가 풀 | 채점영역별 60문항 이상. **학습에 노출되지 않도록 v3.0.0 직전에 생성**한다. | v3.0.0 전 |

위 초기 분량은 하루 신규 상한(`plan.md` §4.3, 5/10/15개)으로 약 4주 학습할 수 있는 규모를 기준으로 잡았다.

**런웨이(runway) 규칙**

- 런웨이 = 영역별 `미노출 신규 항목 수 ÷ 일일 신규 상한` 중 **가장 작은 값(일)**이다.
- 앱은 설정 > 콘텐츠와 홈에 "남은 학습 분량: N일"을 표시하고, **14일 미만이면 홈에 "콘텐츠 추가 필요" 안내**를 띄운다.
- 권장 주기: 2주마다 28일분을 추가한다.

**추가 절차(진도 기반)**

1. 앱 설정 > 콘텐츠 > **진도 내보내기**로 `progress.json`을 만든다. 내용은 영역별 정확도, 오개념 태그별 오답 수, 미노출 수, 복습 잔량, 런웨이뿐이며 시트 URL·계정·토큰·개별 풀이 기록은 포함하지 않는다.
2. PC에서 `npm run content:plan -- --progress progress.json --days 28`을 실행한다. 부족한 영역과 약점 태그(예: `KO_PARTICLE_TRANSFER`)의 비중을 높인 생성 계획이 출력된다.
3. `npm run content:fill -- --days 28 --max-usd N`으로 gen → verify → pack을 수행하고, 청해가 있으면 `content:audio`와 `npm run deploy`(사용자 승인)를 수행한다.
4. 결과 팩을 앱에서 import한다.

**장기 목표(N3 기준, 참고, 필수 아님):** 어휘 2,000, 문법 포인트 200(하위 등급 60 + 목표 등급 140), 독해 지문 40, 청해 100. `content:catalog`는 이 장기 목표 대비 부족분을 보여 주는 용도로만 쓴다.

**주의:** 앱에는 API 키를 넣지 않으므로 추가 생성은 PC의 CLI에서만 가능하다. 모바일만 쓰는 기간에도 런웨이가 14일 아래로 떨어지지 않도록 PC 작업 주기를 정해 두어야 한다.

### 4.2 콘텐츠 레코드 스키마

모든 콘텐츠는 아래 공통 레코드이며 `payload`만 종류별로 다르다. 앱과 CLI는 `shared/` 폴더의 **같은 스키마·린트·해시·정규화 코드**를 사용한다.

```text
ContentRecord {
  contentId:       "<prefix>:<base32(sha256(normalizedKey))[0..10]>"   // 결정적 ID
  contentVersion:  integer >= 1
  kind:            'KANA'|'VOCAB'|'KANJI'|'GRAMMAR'|'QUESTION'|'PASSAGE'|'LISTENING'
  level:           'N5'|'N4'|'N3'|'N2'|'N1'
  pool:            'LEARN'|'DIAG'|'ASSESS'        // ASSESS는 학습·해설 화면에 노출하지 않는다
  tags:            string[]                        // 주제, 한국어 화자 오개념 태그
  payload:         object                          // 아래 종류별
  provenance:      { origin:'AI_GENERATED'|'USER_AUTHORED'|'IMPORTED',
                     generatorModel?, runId?, promptVersion?, createdAt }
  verification:    { status:'VERIFIED'|'UNVERIFIED'|'FLAGGED'|'RETIRED',
                     selfAttested:boolean, verifierModel?, rounds?,
                     checks:[{id,result:'PASS'|'WARN'|'FAIL',note?}], verifiedAt? }
  license:         'ORIGINAL'                      // 공식 기출·교재 복제 금지
  contentHash:     sha256(canonicalJSON({kind,level,pool,contentVersion,payload}))
}
```

| kind | payload 필수 필드 |
|---|---|
| `KANA` | `chars:[c1,c2]`(혼동쌍), `readings`, `confusionNoteKo` |
| `VOCAB` | `surface`, `reading`(가나만), `pos`, `meaningKo`, `example:{ja, ko}`, `levelEstimate`, `miscTags[]` |
| `KANJI` | `kanji`, `onyomi[]`, `kunyomi[]`, `meaningKo`, `relatedVocabIds[]` |
| `GRAMMAR` | `pattern`, `attachment`, `meaningKo`, `nuanceKo`, `contrastPatterns[]`, `examples:[{ja,ko}]`(2개 이상) |
| `QUESTION` | `domain`, `stem`, `choices:[{id,text,whyWrong?,howToCorrect?}]`(정확히 4개), `correctChoiceId`, `explanationKo`, `scoringSection`, `stimulusId?`, `linkedContentId?` |
| `PASSAGE` | `type:'SHORT'|'MEDIUM'|'LONG'|'INFO'`, `pages:[string]`, `questionIds[]` |
| `LISTENING` | `taskType:'TASK'|'POINT'|'OVERVIEW'|'UTTERANCE'|'RESPONSE'`, `segments:[{speaker:'M'|'F'|'N', text, reading?, pauseMs?}]`, `audio:{key, source, engine, voice, speed}`, `questionId` |

- `QUESTION.domain`: `KANA`, `READING_KANJI`, `ORTHOGRAPHY`, `CONTEXT`, `PARAPHRASE`, `USAGE`, `GRAMMAR_FORM`, `SENTENCE_ORDER`, `TEXT_GRAMMAR`, `READING_Q`, `LISTENING_Q`.
- 오답 3개는 `whyWrong`과 `howToCorrect`가 필수이며, 정답 선택지에는 두 필드를 두지 않는다.
- 선택지 표시 순서는 시도(attempt)마다 무작위로 섞고 `choiceId`로 기록한다.
- `payload` JSON은 **30,000자 이하**(제품 정책). 초과하면 지문과 문항을 분리한다.
- **중복 판정 키(normalizedKey):** VOCAB=`NFKC(surface)|reading|pos`, GRAMMAR=`NFKC(pattern)`에서 공백·물결표 변형 제거, QUESTION=`NFKC(stem)`에서 공백·문장부호 제거 + 정답 텍스트, PASSAGE·LISTENING=본문 정규화 해시, KANJI=문자, KANA=정렬한 문자쌍.

### 4.3 로컬 콘텐츠 생성기 CLI (`tools/content/`)

앱은 생성에 관여하지 않는다. 사용자가 PC에서 CLI를 반복 실행하여 콘텐츠를 누적하고, 결과 팩을 앱으로 import한다.

| 명령 | 동작 | 출력 |
|---|---|---|
| `npm run content:catalog [-- --level <등급>]` | **장기 목표**(§4.1, 기본은 `targetLevel`) 대비 부족분을 종류·레벨·태그별로 계산 | `content/catalog.json`, 콘솔 요약 |
| `npm run content:plan -- --progress progress.json --days 28` | 앱에서 내보낸 진도(런웨이, 영역별 정확도, 오개념 태그별 오답)로 **다음 N일분 생성 계획**을 산출 | `content/plan.json`, 콘솔 요약 |
| `npm run content:doctor` | Claude 연동 점검: **api**(키 존재, 1회 호출), **headless**(`claude` 설치·로그인, 1회 호출), TTS 키. 사용 가능한 방식과 해결 방법을 출력 | 콘솔 요약 |
| `npm run content:gen -- --kind VOCAB [--level <등급>] --count 100 [--topic ...] [--pool LEARN] [--provider api|headless] [--dry-run] [--max-usd 5] [--max-calls 200]` | 생성 모델로 초안 작성 | `content/runs/<runId>/drafts/*.json` |
| `npm run content:verify -- --run <runId>` 또는 `--pack <file>` | §4.4 검증 수행. 필요 시 생성 모델에 재작성 요청(최대 2회) | `content/runs/<runId>/verified/*.json`, 리포트 |
| `npm run content:pack -- --run <runId> --out packs/<name>.jlptpack.json` | `VERIFIED` 항목을 팩으로 묶음 | 팩 파일 |
| `npm run content:fill -- --days 28 --max-usd 20 [--max-calls 200] [--provider api|headless] [--dry-run]` | `content:plan` 결과(없으면 catalog 부족분)를 우선순위대로 gen→verify→pack 반복. `--days`는 확보할 학습 일수(런웨이) 기준이다. `--dry-run`은 생성 없이 예상 비용만 출력한다. 예산 소진·목표 달성·오류 시 종료하고, 재실행하면 이어서 진행한다 | 팩 여러 개, 런 상태 파일 |
| `npm run content:audio -- --pack <file> \| --all-missing [--engine google] [--voice ...]` | LISTENING 스크립트를 TTS로 합성(§5) | `audio/<key>.mp3`, 팩의 `audio` 갱신 |
| `npm run content:ledger -- --from-pack <전체-export 팩>` | 앱에서 전체 export한 팩으로 로컬 중복 장부 재구성 | `content/ledger.json` |
| `npm run content:sample -- --n 20` | 사용자 표본 점검용 마크다운 생성(필수 아님) | `content/sample.md` |
| `npm run content:triage -- --flags flags.json` | 앱에서 내보낸 신고 목록을 재검증·재생성(새 `contentVersion`) | 수정 팩 |
| `npm run deploy` | `dist/index.html` + `audio/`를 `site/`로 구성하여 `gh-pages` 브랜치에 게시. **사용자 승인 없이 실행하지 않는다.** | 게시 |

- **모델 설정 `[실무 제안]`:** 생성 `claude-sonnet-5-5`(headless에서는 별칭 `sonnet`), 검증 `claude-opus-5-5`(별칭 `opus`)를 `config.local.json`에 둔다. 생성 모델과 검증 모델은 **서로 달라야** 한다(연동 방식이 같아도 모델은 다르게). 모델 문자열과 별칭은 T00에서 유효성을 확인한다. 자세한 연동 방식은 §4.3.1.
- **비용 제어:** **API 방식**은 `tools/content/pricing.json`(T00에서 공식 가격표로 채움, `[미확인]`)과 토큰 사용량으로 `--dry-run` 추정치와 누적 비용(USD)을 계산하고, 런마다 `MAX_USD_PER_RUN`을 넘으면 중단한다. **headless 방식**은 구독 사용량 한도에 따르는 방식이라 USD 대신 **호출 수 상한(`--max-calls`)**과 시간 상한을 쓰고, CLI 출력에 비용 필드가 있으면(`[미확인]`) 참고용으로 기록한다. 두 방식 모두 `--dry-run`은 생성 없이 예상 호출 수(API는 예상 비용 포함)를 출력한다.
- **프롬프트:** `tools/content/prompts/*.md`에 버전과 함께 보관한다. 필수 지시: 레벨 범위, 한국어 화자 오개념 태그, **오리지널 작성(기출·교재 문장 복제 금지)**, 한국어 해설, 오답별 이유와 교정 방법, 문법 문항은 **정답 판별에 문맥 단서(조사·시제·행위자·상황) 2개 이상 필요**, 엄격한 JSON 출력.
- **분류 체계(taxonomy):** 문법 포인트·어휘 주제 목록은 생성 모델이 제안하고 검증 모델이 점검하여 `content/taxonomy/*.json`에 저장한다. 시판 교재의 목록을 복사하지 않는다.
- **연동 수단이 없는 경우의 폴백:** API 키도 없고 headless도 쓸 수 없을 때만(`content:doctor` 실패) Claude Code 세션이 직접 작성하고 별도 서브에이전트(다른 컨텍스트)로 §4.4 검증을 수행한다. 대량 생성은 연동이 준비될 때까지 `BLOCKED(LLM)`으로 둔다. (이전 명칭 `BLOCKED(KEY)`는 `BLOCKED(LLM)`으로 통일한다.)
- `content/`, `packs/`, `audio/`, `.env.local`, `config.local.json`은 `.gitignore` 대상이다(`audio/`는 배포 시에만 `site/`로 복사). 장부(`ledger.json`) 백업은 사용자가 앱에서 **전체 export**한 팩으로 갈음한다.

#### 4.3.1 Claude 연동 방식 (API / headless)

생성기는 `LlmProvider` 인터페이스(`complete(prompt, {model, schema?, temperature?}) -> {text, usage?, resolvedModel?}`) 뒤에서 두 구현을 모두 제공한다. 프롬프트, 스키마 검증, 재시도, 검증 단계(§4.4)는 두 방식이 **완전히 같은 코드**를 쓴다.

| 구분 | `api` | `headless` |
|---|---|---|
| 호출 | Anthropic API(SDK, `ANTHROPIC_API_KEY`) | `claude -p "<프롬프트>" --model <별칭|ID> --output-format json`을 자식 프로세스로 실행하고 결과의 `result` 필드를 사용 |
| 인증 | `.env.local`의 API 키 | 로컬에 설치·로그인된 Claude Code (`content:doctor`로 점검). 구독 로그인 사용 가능 여부와 약관은 T00 확인 `[미확인]` |
| 비용·한도 | 토큰 × 가격표(USD), `MAX_USD_PER_RUN` | 구독 사용량 한도. `--max-calls`, 시간 상한 |
| 속도·동시성 | 동시 호출 가능(기본 4) | 호출마다 프로세스 시작 비용이 있어 느림(기본 동시 2) |
| 구조화 출력 | 프롬프트 + JSON 파싱 + 스키마 검증 | 같음. `--json-schema` 지원 시 추가 활용 `[미확인]` |
| 적합한 경우 | 대량·반복 생성, 비용 추적이 중요 | API 키가 없을 때, 소량 점진 추가, 구독 한도 내에서 쓰고 싶을 때 |

- **역할별 선택:** `config.local.json`의 `llm.generate`, `llm.verify`에 각각 `provider`(`api`|`headless`)와 `model`을 지정한다. 예: 생성은 headless `sonnet`, 검증은 api `claude-opus-5-5`. CLI의 `--provider`는 두 역할에 모두 덮어쓴다.
- **headless 호출 규칙**
  1. 호출마다 **새 세션**을 쓴다(`--resume`·`--continue` 금지). 블라인드 풀이에서 이전 정답이 새어 들어가지 않게 하기 위해서다.
  2. **빈 임시 폴더**(`content/.headless-cwd/`)에서 실행하여 저장소의 `CLAUDE.md`나 코드가 컨텍스트로 들어가지 않게 한다.
  3. 텍스트 응답만 받도록 **도구 사용을 끄는 설정**을 적용한다(플래그는 T00에서 확인 `[미확인]`). 팩·콘텐츠에서 온 문자열은 **데이터로만** 취급하며, 그 안의 지시문을 따르지 않는다.
  4. JSON 파싱 실패 시 같은 요청을 최대 2회 재시도하고, 이후에는 해당 항목을 REVISE/REJECT로 처리한다.
  5. 동시 실행 수, 호출 간 대기, 사용량 한도 오류 시 백오프를 설정값으로 둔다.
- **공식 확인 범위:** `claude -p`(비대화형 실행), `--output-format`(text/json/stream-json), `--append-system-prompt`는 공식 문서에서 확인했다 `[공식 확인]`. `--model` 별칭, `--json-schema`, 비용 필드(`total_cost_usd`), 인증 요건(일부 자료는 API 키 필요로 기재)은 비공식 자료이므로 **T00에서 공식 문서로 재확인**한다 `[미확인]`.
- **기록:** 생성·검증 결과의 `provenance.generatorModel`과 `verification.verifierModel`에 실제 사용 모델을 기록하고, 연동 방식(`api`/`headless`)도 `provenance.llmProvider`에 남긴다. headless에서 실제 모델명을 알 수 없으면 요청한 별칭을 기록하고 `resolved:false`로 표시한다. 생성 모델과 검증 모델이 다른지 판정할 수 없으면 해당 항목은 `VERIFIED`가 될 수 없다(`UNVERIFIED`).

### 4.4 자동 검증 단계와 상태 모델

| 단계 | ID | 내용 | 실패 시 |
|---|---|---|---|
| V1 | `SCHEMA_LINT` | 스키마, 4지선다·정답 1개, 오답별 `whyWrong`/`howToCorrect`, 선택지 중복, `reading` 문자 규칙, HTML·URL 금지 | 즉시 REJECT |
| V2 | `READING_CHECK` | 형태소 분석기(예: kuromoji 계열, T00에서 채택 확정)로 한자 독음 대조. 불일치는 검증 모델 판정으로 넘김 | WARN → V5에서 판정 |
| V3 | `BLIND_SOLVE` | 검증 모델에 **정답을 숨기고** 선택지 순서를 바꿔 2회 풀이시킨다. 두 번 모두 키와 일치해야 한다. `ASSESS` 풀은 4회 | REVISE |
| V4 | `DISTRACTOR_CHECK` | 오답 3개가 각각 명백히 틀린지, 복수 정답 가능성이 있는지 판정 | 복수 정답 지적 시 REVISE |
| V5 | `QUALITY_CHECK` | 레벨 적합성, 일본어 자연스러움, 한국어 해설 정확성, 문맥 단서 2개 이상 | REVISE/REJECT |
| V6 | `DEDUPE` | 장부 대조(§4.6 규칙) | 중복 SKIP |

- REVISE이면 생성 모델에 이슈를 전달해 재작성하며 **최대 2회**, 이후에는 REJECT한다.
- **상태:** `VERIFIED`(V1~V6 통과, 검증 모델≠생성 모델) / `UNVERIFIED`(검증 증명 없음 또는 import 시 강등) / `FLAGGED`(사용자 신고) / `RETIRED`(폐기).
- `UNVERIFIED`는 기본적으로 학습 풀에서 제외하고, 설정의 "미검증 콘텐츠 포함" 토글을 켠 경우에만 **연습**에 사용한다. 평가 풀(`ASSESS`)에는 `VERIFIED`만 들어간다.
- 앱에는 LLM 키를 넣지 않으므로 **앱 안에서는 의미 검증(V3~V5)을 다시 수행할 수 없다.** import한 팩의 검증 정보는 서명이 없는 `selfAttested` 값이며 UI에 그렇게 표시한다. 의미 검증이 필요하면 import 전에 `content:verify --pack <file>`을 실행한다.
- **앱 내 신고:** 해설 화면에 "문제 신고" 버튼(사유: 정답 오류 / 해설 오류 / 부자연스러운 일본어 / 난이도 부적절 / 기타)을 둔다. 신고하면 `CONTENT_FLAGGED` 이벤트를 기록하고 해당 항목은 즉시 본인의 학습 풀에서 제외한다. 설정에서 신고 목록을 `flags.json`으로 내보내 `content:triage`로 재처리한다.

### 4.5 팩 파일 포맷 (`*.jlptpack.json`)

```text
{
  "format": "jlpt-pack", "formatVersion": 1,
  "manifest": {
    "packId", "packVersion"(SemVer), "createdAt",
    "generator": { "tool", "toolVersion", "models": {"generate","verify"} },
    "targetLevels": [...], "kinds": [...], "counts": {"VOCAB": n, ...},
    "license": "ORIGINAL", "hashAlgo": "sha256", "manifestHash"
  },
  "items": [ ContentRecord, ... ],
  "audioManifest": [ {"audioKey","scriptHash","engine","voice","speed","durationMs"} ]
}
```

- 개인 학습 이벤트·설정·시트 URL·토큰은 팩에 **절대 포함하지 않는다.**
- 팩의 오디오 참조는 `audio.key`(상대 키)만 허용하며 외부 URL은 import 시 거부한다.
- 청해 항목을 다른 사람에게 공유하면 **음원 파일은 포함되지 않는다.** 받는 사람은 스크립트가 들어 있으므로 `content:audio`로 자기 음원을 합성하거나, 음원이 없을 때는 `BROWSER_TTS`로 재생(평가 제외)한다.

### 4.6 앱 내 Export / Import

**Export (설정 > 콘텐츠 > 내보내기)**

- 범위: **전체** 또는 **유형별**(KANA/VOCAB/KANJI/GRAMMAR/QUESTION/PASSAGE/LISTENING 다중 선택), 레벨 필터, 풀 필터.
- 기본 필터는 `VERIFIED`만 포함한다. 파일명은 `jlpt-pack_<kinds>_<yyyymmdd>_<n>.jlptpack.json`이다.
- 전체 export는 CLI 중복 장부 재구성(`content:ledger`)의 입력으로 쓴다.

**Import (설정 > 콘텐츠 > 가져오기)**: 전체 팩 또는 팩 안의 유형별 선택 가능. 파일을 선택하면 **쓰기 전에** 아래 검사를 모두 수행하고 리포트를 보여 준 뒤 사용자가 승인해야 반영한다.

| ID | 검사 | 실패 시 |
|---|---|---|
| IMP-01 | 형식·버전, JSON 파싱, 파일 20MB 이하, 항목 20,000개 이하 | 파일 거부 |
| IMP-02 | 항목별 스키마(필수 필드·타입) | 항목 거부 |
| IMP-03 | `contentHash` 재계산, `manifest.counts`, `manifestHash` 일치 | 항목 또는 파일 거부 |
| IMP-04 | 문제 규칙: 4지선다, 정답 1개, id 유일, 오답 3개의 이유·교정 존재 및 상호 동일하지 않음 | 항목 거부 |
| IMP-05 | 문법 문맥 휴리스틱(어미만 달라서 stem만으로 정답이 결정되는 패턴 탐지) | 경고 후 `UNVERIFIED` 강등 |
| IMP-06 | `reading`이 가나·장음기호만 포함 | 항목 거부 |
| IMP-07 | 안전: HTML 태그, 스크립트, 제어문자, 외부 URL, `payload` 30,000자 초과 | 항목 거부 |
| IMP-08 | 참조 무결성(`questionIds`, `stimulusId`, `linkedContentId`가 팩 또는 시트에 존재) | 항목 보류 |
| IMP-09 | 중복·충돌(아래 병합 규칙) | 규칙에 따름 |
| IMP-10 | `VERIFIED` 주장 점검: 검증 모델≠생성 모델, 필수 검사(`BLIND_SOLVE`,`DISTRACTOR_CHECK`,`QUALITY_CHECK`,`SCHEMA_LINT`) 전부 PASS 기록 | 미충족 시 `UNVERIFIED` 강등(삭제 아님) |
| IMP-11 | 평가 풀 격리: `ASSESS` 항목이 이미 학습에서 본 동일 키와 충돌 | 거부 |

**병합 규칙**

| 상황 | 처리 |
|---|---|
| 새 `contentId` | 행 추가. 검증 상태는 IMP-10 결과를 따른다. |
| 같은 `contentId` + 같은 hash | SKIP |
| 같은 `contentId` + 더 높은 `contentVersion` + 다른 hash | 새 버전 행 추가. 새 버전과 기존 버전이 모두 `VERIFIED`이면 활성 포인터 전환, 아니면 후보(비활성)로 둔다. |
| 같은 `contentId` + 같거나 낮은 버전 + 다른 hash | 거부(`INTEGRITY_CONFLICT`)하고 리포트에 표시 |
| 다른 `contentId` + 같은 normalizedKey | 중복 SKIP, 기존 ID를 리포트에 표시 |
| 유사도 0.85 이상(QUESTION·PASSAGE·LISTENING, 문자 n-gram 기준 `[실무 제안]`) | 중복 후보로 기본 SKIP, 리포트에서 항목별 "그래도 추가" 선택 가능 |
| 기존에 `FLAGGED`/`RETIRED`인 항목과 같은 hash | 부활시키지 않고 SKIP |

- 반영은 **200행 단위 배치**로 `_JLPT_CONTENT`에 append하며 `PACK_IMPORT_STARTED`/`PACK_IMPORT_COMPLETED` 이벤트를 기록한다. 중간에 끊겨도 `contentId+version+hash`로 멱등하므로 재실행하면 이어서 반영된다.
- 반영 결과 리포트: 신규 n / 중복 n / 충돌 n / 거부 n(사유별) / 강등 n.

### 4.7 시트의 콘텐츠 증분 로딩

- `_JLPT_CONTENT`는 **append-only**이다. 기기는 `contentRowCursor`(마지막으로 읽은 행 번호)를 IndexedDB에 두고, 시작 시 `_JLPT_META.contentRowCount`와 비교하여 **새 행만 500행 단위로** 읽는다.
- 활성 버전과 상태는 클라이언트에서 계산(projection)한다. 신규 기기는 처음 한 번만 전량 읽는다.

---

## 5. 청해 음원 시스템

### 5.1 기본 경로(D5): TTS 음원 파일

- `content:audio`가 `LISTENING.segments`를 화자별 음성으로 합성하고 SSML 휴지(`pauseMs`)를 넣어 `audio/<audioKey>.mp3`를 만든다. `audioKey = sha256(segments + engine + voice + speed)` 앞 16자.
- TTS 제공자는 인터페이스(`TtsProvider`)로 분리한다. 기본 `google`(Cloud Text-to-Speech, 남녀 음성 구분), 대안 `edge`(비공식), 추가 제공자는 인터페이스 구현으로 확장한다. 무료 한도·약관·SSML 지원은 T00에서 확인한다 `[미확인]`.
- 앱은 `./audio/<key>.mp3`를 사용자가 재생 버튼을 누를 때만 로드한다(`preload="none"`).

### 5.2 음원 소스 추상화 (한계 개선 경로)

| `audio.source` | 의미 | 평가 사용 | 개선 방법 |
|---|---|---|---|
| `GENERATED_FILE` | CLI가 만든 TTS mp3 (기본) | 가능 | 더 좋은 엔진·음성으로 재합성(새 `audioKey`) |
| `RECORDED` | 사람 녹음 mp3 | 가능(권장) | `audio/overrides/<contentId>.mp3`를 넣으면 같은 문항이 녹음본으로 교체되고 `source=RECORDED`로 기록 |
| `BROWSER_TTS` | 음원 파일이 없을 때 브라우저 `ja-JP` 음성으로 실시간 재생 | **기본 제외**(설정 토글로 포함 가능) | 파일 합성 후 `GENERATED_FILE`로 승격 |

- 재생 소스는 이벤트(`QUESTION_PRESENTED`)에 기록하여 준비도 계산이 소스별로 집계할 수 있게 한다.
- **한계 표기(의무):** 청해 준비도 옆에 "TTS 음원 기반(실제 시험 음성과 억양·속도·잡음이 다를 수 있음)" 배지를 항상 표시한다. 소스 구성(GENERATED/RECORDED 비율)도 함께 보인다.
- 청해 문항 유형별 선택지 수와 화면 표시 방식(인쇄 선택지 여부)은 **공식 시험지(목표 등급 N3 기준, N2/N1 추가 시 같은 방식)로 T00에서 확인**한다 `[미확인]`. 공식이 3지선다인 유형이 있으면 `officialChoiceCount`를 기록하고, UX 불변조건(4지선다)과의 차이는 `docs/decisions/listening-format.md`에 남긴다.
- 평가 청해의 재생 횟수 기본값은 1회, 연습은 무제한이다(설정 변경 가능).

---

## 6. 학습 로직 확정값 `[실무 제안]`

### 6.1 숙련도 5단계와 복습 규칙 (이전 앱 계승, 단일 규칙)

| 단계 | 이름 | 정답 시 다음 간격 |
|---|---|---|
| 0 | 새 항목 | 첫 정답 → 1단계, 1일 후 |
| 1 | 학습 중 | 정답 → 2단계, 3일 후 |
| 2 | 익숙함 | 정답 → 3단계, 7일 후 |
| 3 | 거의 숙달 | 정답 → 4단계, 21일 후 |
| 4 | 숙달 | 정답 → 유지, 21일 후 재확인 |

- 오답: `단계 = max(1, 단계-1)`, `lastAnswerWrong=true`, 같은 세션에서 1회 재출제 후 다음 날로 예약한다.
- **복습 규칙 하나:** `dueAt ≤ 오늘` 또는 `lastAnswerWrong`이면 복습 대상이다.
- 카드는 방향별(`READING`/`MEANING`/`AUDIO`/`CLOZE`)로 따로 관리하되 UI는 단어 단위 5단계로 합산하여 보여 준다(모드별 기록은 내부 유지).
- 신규 학습 상한(`plan.md` §4.3): 경로별 5/10/15개/일. 하루 예상 복습이 25분을 넘으면 신규 0개. 카드당 시간 초기 추정은 25초이며 실측값으로 갱신한다.
- FSRS 등 고급 스케줄러는 V3 이후 실험 항목이다(효과는 `[미확인]`).

### 6.2 오늘의 60분 플랜

`plan.md` §4.3을 따른다. 단 청해는 V2부터 실제 음원이 있으므로 V2 이후 경로 표(10분)를 그대로 적용하고, V2 이전에는 어휘·문법·독해로 재배분한다(청해는 '콘텐츠 준비 중'으로 표시, 완료로 기록하지 않음).

### 6.3 약점 복습

- 약점 점수 = `최근 5회 답 중 오답 비율 + 0.25 × 미복습 경과 비율`. 상위 N개를 "틀리기 쉬운 항목"으로 홈 복습 카드에 표시한다.
- 시작 전에 목적(어떤 항목을, 왜, 몇 개, 예상 몇 분)을 한 화면에 보여 준다.

### 6.4 듣고 쓰기 (V2)

- 짧은 단어·문장 음원을 재생 → 사용자가 가나로 입력 → NFKC 정규화 후 비교 → 차이를 표시한다. 자동 이동은 하지 않고, 해설 화면에서 사용자가 "다음 계속하기"를 눌러야 넘어간다.

---

## 7. 동기화·저장 변경 (plan.md §7.5 대체)

1. **로컬 기록 먼저:** 모든 변경은 `SyncEvent`로 만들어 IndexedDB outbox에 저장한다(저장 성공 전에는 "저장됨"을 표시하지 않는다).
2. **배치 전송 조건:** outbox가 20건 이상, 포그라운드 60초 경과, 화면이 숨겨질 때(`visibilitychange`/`pagehide`, 최선 노력), 세션 종료, 사용자의 "지금 동기화" 중 하나. 연속 전송 간격은 최소 10초, 1회 최대 200행이다.
3. **전송:** `values.append`(`RAW`) 1회로 여러 행을 보낸다. 응답의 `updatedRange`를 읽어 해당 범위를 재조회하고 **`eventId`+`checksum`이 모두 일치할 때만** `SYNCED`로 바꾼다.
4. **응답 유실·5xx·타임아웃:** 재전송 전에 원격에 이미 같은 `eventId`가 있는지 확인한다. 429는 지수 백오프와 지터를 적용한다.
5. **중복:** 같은 `eventId`+같은 checksum은 한 번만 적용(멱등 projection). 같은 `eventId`+다른 checksum은 읽기 전용+백업 안내.
6. **설정·목표 충돌:** 최신 `occurredAt` 우선, 동률이면 `deviceId` 사전순. 값이 바뀌면 토스트로 알린다.
7. **쓰기 한도:** Sheets API 쓰기/읽기 한도는 T00에서 공식 문서로 확인하여 `SYNC_*` 상수로 고정한다(제 기억으로는 사용자당 분당 60회 수준이나 `[미확인]`).
8. **이벤트 읽기:** `_JLPT_EVENTS`도 행 커서 기반 증분으로 읽는다. 이벤트 수가 많아지면 V4에서 스냅샷을 도입한다.
9. UI 불변조건: `pendingCount`는 검증된 ACK 없이 줄지 않는다. 오류 문구는 `plan.md` §8.4를 따른다.

---

## 8. 배포·저장소 구조

### 8.1 저장소

```text
jlpt-app/
├── docs/{execution_plan.md, plan.md, research_revised.md, USER_GUIDE.md, STATUS.md,
│        spec/jlpt_spec.md, decisions/, qa/, releases/}
├── CLAUDE.md, CHANGELOG.md, README.md
├── package.json, tsconfig.json
├── app/src/{app.ts, ui/, domain/, content/, storage/, google/}   # plan.md §7.3 구조
├── shared/{schema.ts, lint.ts, hash.ts, normalize.ts}            # 앱·CLI 공용
├── tools/content/{src/, prompts/, pricing.json}
├── scripts/{build-single-html, deploy-pages, measure-size}
├── tests/{unit, content, ui, storage, integration, fixtures}
├── dist/index.html            # 앱 단일 파일(유일한 앱 산출물)
├── audio/                     # (gitignore) 생성된 음원
├── site/                      # (gitignore) 배포 스테이징: index.html + audio/
├── content/, packs/           # (gitignore) 생성 작업물·팩
├── config.local.example.json  # 템플릿(커밋), 실제 config.local.json은 gitignore
└── .env.local                 # (gitignore) API 키
```

### 8.2 배포 절차

1. `npm run build` → `dist/index.html`.
2. `npm run deploy` → `site/`(= `dist/index.html` + `audio/`)를 만들고 `gh-pages` 브랜치에 게시. **첫 게시와 저장소 공개 설정은 사용자 승인 후 진행한다.** GitHub Pages 무료 사용 조건(저장소 공개 여부)과 사이트 용량 한도는 T00에서 확인한다 `[미확인]`.
3. 접속 주소 `https://<owner>.github.io/<repo>/`, OAuth에 등록할 Origin은 `https://<owner>.github.io`(경로 없음).
4. 새 릴리스는 같은 URL에 덮어쓰며 시트 정본에서 상태를 복원한다.

### 8.3 크기 예산 `[실무 제안]`

| 버전 | `dist/index.html` 목표 | 재검토 기준 |
|---|---|---|
| V0 | 300 KiB 이하 | 400 KiB 초과 |
| V1~V2 | 450 KiB 이하 | 600 KiB 초과 |
| V3 이후 | 600 KiB 이하 | 800 KiB 초과 |

콘텐츠는 HTML에 넣지 않는다(V0 시드 제외). 차트는 인라인 SVG, 일본어 폰트 파일·이미지·오디오 인라인은 금지한다.

---

## 9. 버전 로드맵과 작업 목록

| 버전 | 작업 | 내용 |
|---|---|---|
| **v0.1.0** | T00~T09 | 기반, 설정, 진단, 60분 플랜, 콘텐츠 CLI 최소판, Google 시트 연동·배치 동기화·복원, 팩 import/export, 첫 배포 |
| **v1.0.0** | T10~T12 | 숙련도 5단계 복습, 약점 복습, 문법 원리 학습, 혼동 글자, 대량 콘텐츠 1차 |
| **v2.0.0** | T13~T15 | 독해, 청해(TTS 음원), 듣고 쓰기, 대량 콘텐츠 2차 |
| **v3.0.0** | T16 | 평가 풀 격리, 준비도, 리포트 |
| **v4.0.0** | T17 | 스냅샷, 마이그레이션, 대용량 안정화 |
| 별도 승인 | T18 | N2/N1 확장 |

| 작업 | 선행 | 내용 | 수용 기준 |
|---|---|---|---|
| **T00 사실 확인** | 없음 | ① Sheets API 한도 ② GitHub Pages 조건·용량 ③ Google TTS 무료 한도·약관·SSML ④ Anthropic 가격표·모델 문자열 유효성 ⑤ 목표 등급(N3) 청해 공식 시험지(2018 N3L)로 유형별 선택지 수 ⑥ 형태소 분석기 후보 ⑦ `file://`에서 GIS 불가 재현 ⑧ plan.md T00 항목 ⑨ **저장소 게이트:** 시트 3,000행을 모바일 회선의 Android Chrome에서 읽는 초기 로딩 시간 측정(목표 5초 이내 `[실무 제안]`) ⑩ **LLM 연동:** Claude Code headless(`claude -p`)의 공식 플래그, 인증·과금·약관(구독 로그인 사용 가능 여부), 도구 비활성화 방법, `--json-schema`·`--model` 지원, 비용 필드, 동시 호출·사용량 한도 확인 | `docs/qa/runtime-spike.md`, `docs/qa/limits.md`, `tools/content/pricing.json`, `docs/decisions/listening-format.md`, `docs/decisions/storage-gate.md`, `docs/decisions/llm-providers.md`. 각 항목에 근거 URL과 결론을 적고, 확인 불가는 `미확인`으로 남긴다. 저장소 게이트가 목표를 넘으면 기본 콘텐츠를 Pages 정적 JSON으로 분리하는 대안을 `storage-gate.md`에 제안하고 사용자 확인을 받는다. |
| **T01 저장소·빌드** | T00 | `git init`, 구조(§8.1), 빌드·테스트·린트 설정, `CLAUDE.md`(§12), `STATUS.md`, 문서 배치(`USER_GUIDE.md` 포함), **`npm run serve`(`dist/`를 `http://localhost:8080`으로 서빙, 개발·검증 전용)**, `config.local.example.json`·`.env.local` 템플릿 | `npm run build`가 `dist/index.html` 1개 생성, `file://` PC Chrome에서 렌더, `npm run serve`로 접속 확인, 크기 리포트, 첫 커밋 |
| **T02 공용 스키마·도메인** | T01 | `shared/` 스키마·린트·해시·정규화, `ExamSpec` 5레벨, `targetLevel` 설정, 목표 날짜 계산, 시트 헤더 정의(`lamport` 제외), **레벨 중립 검사 스크립트(`npm run lint:level-neutral`)** | `TST-SCHEMA-01`, `TST-DATE-01~03` 통과, 린트는 정상·비정상 사례 각 5개 이상, **`app/`·`shared/`·`tools/` 소스에서 `ExamSpec`·`targets/`·테스트 fixture·문서를 제외하고 `N5`~`N1` 등급 문자열 리터럴이 0건** |
| **T03 퀴즈 쉘·설정·홈 쉘** | T02 | `QuizShell`, 글자 S/M/L/XL·후리가나·다크 모드, 하단 탭 4개, 홈 쉘 | `TST-QUIZ-*`, 320×568·360×640·390×844 한 화면 검증, 4선지 고정, 자동 이동 0회 |
| **T04 로컬 저장·outbox·백업** | T02, T03 | 이벤트 생성, IndexedDB outbox, JSON 백업/복원(미리보기·중복 제거), `MockSheetsAdapter` | `TST-SYNC-01`, `file://` 저장 실패 경고, 백업→복원 후 이벤트 중복 0 |
| **T05 콘텐츠 CLI 최소판** | T02 | `catalog/gen/verify/pack/ledger/sample/doctor`, **`LlmProvider`(api, headless 두 구현, §4.3.1)**, TTS 제공자 인터페이스, 비용·호출 수 추정. 시드(진단 28문항, 어휘 8, 문법 4, 독해 2) 생성 | 파일럿 10항목 gen→verify→pack E2E, REVISE·REJECT 경로 테스트, 장부 중복 차단, `--dry-run` 출력(api는 비용, headless는 호출 수), **두 구현이 같은 계약 테스트(모의 응답, JSON 파싱 실패 재시도, 사용량 한도 오류 백오프)를 통과**, 설정만 바꿔 방식 전환(코드 수정 0), 사용 가능한 방식으로 실제 1회 호출 성공(`content:doctor`), **시드 전부 `VERIFIED`**. 두 방식 모두 불가하면 폴백(§4.3)으로 진행하고 `BLOCKED(LLM)`으로 기록 |
| **T06 진단·목표·플랜** | T03~T05 | 28문항 진단, 라우팅, 목표 연도/월 입력·변경, 60분 플랜, 청해 미측정 표기(V2 전) | `TST-DIAG-*`, `TST-PLAN-01`, 목표 변경 후 기록 삭제 0건 |
| **T07 Google 연동·동기화** | T04, **사용자 준비물(§11)** | GIS 토큰, URL 파서, 비파괴 초기화, 배치 동기화(§7), 증분 로딩(§4.7), 복원 | 실제 HTTPS에서 시트 초기화→쓰기→재조회→다른 기기 복원, Picker 0회, `plan.md` §8.4 오류 매트릭스, 기존 탭 변경 0건. 준비물이 없으면 `BLOCKED`로 기록하고 Mock 테스트만 별도 표기 |
| **T08 팩 import/export·신고·진도 내보내기** | T05, T07 | §4.6 전체, 신고 버튼, 신고 목록 export, **진도 내보내기(`progress.json`)와 런웨이 표시·14일 미만 안내(§4.1)** | fixture 팩(정상·중복·충돌·변조·악성 문자열·참조 누락) 리포트가 정확, 전체/유형별 export→재import 시 신규 0·중복 100%, 5,000항목 import가 쓰기 한도를 지키며 재개 가능, `progress.json`에 시트 URL·계정·토큰·개별 풀이 0건, 런웨이 계산 단위 테스트 |
| **T09 v0.1.0 릴리스** | T01~T08 | 통합 QA, 실기기 Android Chrome, 배포 스크립트, 릴리스 문서·스펙 MD, **`docs/USER_GUIDE.md`를 실제 화면·명령 기준으로 갱신(§1.2 Google 설정 절차, §3 첫 실행, §10 오류 문구 대조, 화면 캡처)**, **앱 안 도움말 화면(설정 > 도움말: 연결, 동기화 배지, 콘텐츠 추가, 백업, 문제 해결 요약, HTML 증가 10KiB 이내)** | `plan.md` §11.2~11.4 V0 항목, 해시·크기 기록, **가이드의 모든 명령과 메뉴 이름이 실제와 일치하고 `plan.md` §8.4 오류 문구가 가이드 §10 표와 일치**. 사용자 승인 후 첫 게시. 미완료 P0가 있으면 태그 보류 |
| **T10 복습 엔진** | T09 | §6.1 5단계, 카드 방향, 홈 복습 카드, §6.3 약점 복습, 시작 전 안내 | 단위 테스트(전이표 전 경우), 하루 25분 초과 시 신규 0, 이벤트 재생으로 상태 복원 |
| **T11 문법 원리 학습·혼동 글자** | T10 | `GRAMMAR` 포인트 학습, 문맥형 문항, 오답별 교정 UI, 혼동 글자 퀴즈 | 어미만 보고 풀리는 문항 린트 차단, 오답 3개 개별 이유·교정 표시, 혼동 퀴즈 별도 메뉴 |
| **T12 콘텐츠 런 1 → v1.0.0** | T08, T11 | `content:plan`/`content:fill`로 §4.1 **초기 분량**(어휘 400, 문법 40 등) 생성·검증·팩, import, 학습 QA | 초기 분량 달성 또는 `BLOCKED(COST/LLM)`, 런웨이 28일 이상 표시, HTML 해시가 콘텐츠 추가 전후 동일, 구버전 기록 유지, **가이드 §4.3~4.4·§5를 실제 동작 기준으로 갱신** |
| **T13 독해 UI** | T12 | 단·중·장문, 정보검색, 페이징(4선지 고정) | 모바일 한 화면 규칙, 지문 페이지 전환, `stimulusId` 노출 기록 |
| **T14 청해·오디오** | T13 | `content:audio`, `TtsProvider`, 청해 UI, 소스 추상화(§5.2), 듣고 쓰기, 한계 배지 | mp3 재생(Android Chrome 실기기), `BROWSER_TTS` 평가 제외, `RECORDED` 오버라이드 교체 동작, 배지 표시 |
| **T15 콘텐츠 런 2 → v2.0.0** | T14 | §4.1 독해·청해 **초기 분량** 생성, 음원 합성·게시, 약점 태그 반영 추가 런 1회(`content:plan`) | 초기 분량 달성 또는 BLOCKED, 런웨이 14일 이상, 배포물이 `index.html`+`audio/`만 포함, **가이드 §7(청해)·§6.3 갱신** |
| **T16 평가·준비도·리포트 → v3.0.0** | T15 | `content:gen --pool ASSESS`로 채점영역별 60문항 이상 생성(§4.1), `ASSESS` 풀 격리, `plan.md` §9 준비도(청해는 소스 구성 표시), SVG 리포트 | `TST-READINESS-01`, `n<20` 자료 부족, 확률·공식 점수 출력 0회, **가이드 §8(준비도) 갱신** |
| **T17 안정화 → v4.0.0** | T16 | 스냅샷, 스키마 마이그레이션, 대용량, 다기기 | 이전 버전 fixture 복원, 데이터 손실 0 |
| **T18 N2/N1** | 별도 승인 | 등급별 `targets/<LEVEL>.json`, 진단 구성, `ExamSpec` 검증, 콘텐츠 생성, 설정의 목표 등급 변경 | 기존 등급(N3 등) 기록·스키마 역호환, 코드 수정 없이 등급 데이터 추가만으로 동작 |

---

## 10. Claude Code 운영 규칙 (자동 진행)

1. **시작:** `docs/STATUS.md`를 읽고 첫 미완료 작업부터 진행한다. 파일이 없으면 T00부터 시작한다.
2. **질문 금지 원칙:** 본 문서와 `plan.md`에 답이 있는 사항은 사용자에게 묻지 않는다. 확정된 D1~D8은 다시 묻지 않는다.
3. **작업마다:** 구현 → 실제 테스트 실행 → 커밋(Conventional Commit) → `STATUS.md` 갱신(완료 작업, 커밋 해시, BLOCKED/FAIL, 다음 작업) → 보고.
4. **중단하고 사용자 확인을 받는 경우(이 외에는 멈추지 않는다):**
   - `git push`, GitHub Pages 게시, 저장소 공개 설정 변경, 외부 계정 설정 변경
   - 대량 생성 런의 **예상 비용이 `MAX_USD_PER_RUN`을 초과**하는 경우(이 값 이하는 사전 승인으로 본다)
   - 요구사항 충돌, 공식 문제·음원 복제가 필요해지는 경우, 권리 문제
5. **BLOCKED 처리:** 사용자 준비물(Google Cloud, Pages, Claude 연동(API 키 또는 headless 로그인))이 없어서 못 하는 작업은 `BLOCKED(원인)`으로 기록하고 **의존하지 않는 다음 작업으로 진행**한다. 우회(`file://` OAuth 시도, 보안 해제, 토큰 수동 복사)는 금지한다.
6. **실패 처리:** 테스트 실패는 3회 수정 시도 후 `FAIL`로 기록하고 의존하지 않는 작업을 계속한다.
7. **비밀:** API 키·토큰·OAuth 비밀·개인 시트 URL을 코드·로그·커밋·보고에 쓰지 않는다. Client ID는 공개 가능하지만 `config.local.json`에 둔다.
8. **모델:** 코드 작업은 Sonnet 5.5. 콘텐츠 생성·검증은 CLI 설정의 모델 문자열을 따른다.
9. **보고 형식:** 변경 파일 → 실제 동작 → 실행한 검증과 환경 → `PASS/FAIL/BLOCKED`와 근거 → 적용한 schema/content/app 버전 → 사용자 확인 필요 사항 → 커밋 해시. Mock 성공을 실제 Google E2E로 보고하지 않는다.
10. **재개:** 세션이 끊겨도 `STATUS.md`와 git 로그만으로 이어서 진행할 수 있도록 유지한다.

---

## 11. 사용자 사전 준비 체크리스트 (Claude Code가 대신할 수 없음, 약 20~30분)

실행 전에 아래를 끝내면 T07 이후까지 멈춤 없이 진행된다. 일부가 빠져도 T00~T06, T08(Mock)은 진행된다.

**A. Google (개인 계정)**
- [ ] Google Cloud 프로젝트 생성, **Google Sheets API** 활성화
- [ ] OAuth 동의 화면 구성(External, Testing, **테스트 사용자에 본인 계정 추가**), 스코프 `.../auth/spreadsheets` 추가
- [ ] OAuth 클라이언트 ID(**Web application**) 생성. Authorized JavaScript origins에 `https://<GitHub사용자명>.github.io`와 개발용 `http://localhost:8080` 등록(경로 없이)
- [ ] 테스트용 구글 시트 2개 생성(빈 시트 1, 샘플 데이터 시트 1). 업무용 실데이터 시트는 사용하지 않는다.
- [ ] (청해용) **Cloud Text-to-Speech API** 활성화와 API 키 발급(결제 계정 연결이 필요할 수 있으니 무료 한도 확인). 대안 엔진을 쓰면 생략

**B. Claude 연동 (API, headless 중 하나 이상)**
- [ ] **API 방식:** Anthropic API 키 발급, 콘솔에서 **월 사용 한도(spend limit)** 설정, 런당 최대 비용(`MAX_USD_PER_RUN`) 결정
- [ ] **headless 방식:** Claude Code 설치와 로그인(개발에 이미 사용 중이면 완료), 터미널에서 `claude -p "ping" --output-format json`이 응답하는지 확인, 런당 최대 호출 수(`MAX_CALLS_PER_RUN`) 결정
- [ ] 둘 다 준비하면 `content:doctor`로 점검하고 역할별로 선택

**C. GitHub**
- [ ] 저장소 `jlpt-app` 생성(Pages 무료 사용 조건에 맞는 공개 설정은 T00에서 확인), 원격 URL 준비
- [ ] 로컬에서 `git push` 가능한 인증(SSH 키 또는 `gh auth login`)

**D. 로컬 PC**
- [ ] Node.js LTS, git, Claude Code 설치
- [ ] 새 폴더 `jlpt-app/docs/`에 `execution_plan.md`, `plan.md`, `research_revised.md`, `USER_GUIDE.md` 4개 배치
- [ ] Android Chrome 기기 준비(실기기 QA용)

**E. 값 입력 (T01이 만드는 템플릿을 채움)**
- [ ] `.env.local`: `ANTHROPIC_API_KEY`(API 방식에만 필요), `GOOGLE_TTS_API_KEY`
- [ ] `config.local.json`: `GOOGLE_CLIENT_ID`, `PAGES_ORIGIN`, `TEST_SHEET_URLS`, `maxUsdPerRun`(= 문서의 `MAX_USD_PER_RUN`), `maxCallsPerRun`(= `MAX_CALLS_PER_RUN`), `llm.generate`·`llm.verify`(각각 `provider`와 `model`)

---

## 12. 갱신된 `CLAUDE.md` (T01에서 저장소 루트에 그대로 생성)

```md
# JLPT App Implementation Rules

Read docs/execution_plan.md first (highest priority), then docs/plan.md and
docs/research_revised.md. Resume from docs/STATUS.md. Do not re-ask decisions
D1-D8 in execution_plan.md section 1.

Shipped app artifact: dist/index.html only (inline CSS/JS, minimal approved
seed). Listening audio is separate static files under audio/, deployed with the
app to GitHub Pages (index.html + audio/). Build-time TypeScript/esbuild and
modular sources are allowed. Report byte size every release.

file:// is LOCAL_FILE mode: no Google OAuth, no Sheets sync claims. Google
features run only on a registered HTTPS origin (or http://localhost for dev),
using GIS token flow and the sensitive spreadsheets scope on exactly the
user-pasted Sheet. No Picker, no drive.file, no client_secret, no tokens in
storage/logs/git.

Sheet is canonical for content AND user state. Never touch non-_JLPT_ tabs.
Events are batched (20 events / 60s / hide / session end), appended with RAW,
and acknowledged only after readback of eventId+checksum. Content is
append-only with immutable versions and incremental row-cursor loading.

Content is generated outside the app by tools/content (CLI). The app only
imports/exports packs (*.jlptpack.json). Generator model != verifier model.
LLM calls go through an LlmProvider interface with two implementations, "api"
(Anthropic API) and "headless" (claude -p in an empty cwd, fresh session per
call, text only), selectable per role in config.local.json.
Never copy official JLPT problems, recordings or textbook text. Imported
content is validated (IMP-01..11) before any write.

Quiz UX: no time limit by default; after submit wait for the user's
"다음 계속하기"; same 4 choices on question and feedback screens; never shrink
text or hide choices; every wrong choice explains WHY wrong and HOW to
correct; grammar items need real sentence context; settings for font size and
furigana on mobile. Dictation is the only input-type exception.

Level-neutral: never hardcode a JLPT level (N3 etc.) in identifiers, file or repo
names, sheet tabs, events or UI strings. Use targetLevel (setting), the item
level field and ExamSpec[level]. Per-level data lives in targets/<LEVEL>.json.
Run npm run lint:level-neutral.

Never convert raw scores into official JLPT scaled scores or pass
probabilities. Listening readiness always shows the TTS-source badge.

Keep docs/USER_GUIDE.md accurate: when UI labels, commands, error messages or
flows change, update the guide in the same commit.

For every task: implement -> run real tests -> check mobile layout -> commit ->
update docs/STATUS.md -> report. Mocks do not prove real Google integration.
Stop and ask only for: git push/Pages publish/repo visibility, cost above
MAX_USD_PER_RUN, requirement conflicts, rights issues.
```

---

## 13. Claude Code 실행 프롬프트 (붙여넣기용)

```text
docs/execution_plan.md(최우선), docs/plan.md, docs/research_revised.md, docs/USER_GUIDE.md를 전체 읽고, docs/STATUS.md가 있으면 그 상태부터, 없으면 T00부터 execution_plan.md §9의 작업을 순서대로 끝까지 수행하세요. 저장소가 비어 있으면 T01에서 git init 하세요.

확정 결정 D1~D8은 다시 묻지 마세요. 최종 앱 산출물은 dist/index.html 한 파일이며, 청해 음원은 별도 정적 파일(audio/)입니다. 콘텐츠는 앱 밖의 tools/content CLI로 생성·검증하고 앱은 팩 import/export만 담당합니다. v5.x 코드는 사용하지 않습니다.

작업마다 구현 → 실제 테스트 실행 → 커밋 → docs/STATUS.md 갱신 → §10-9 형식으로 보고하세요. 사용자 확인이 필요한 경우는 §10-4의 목록(git push, Pages 게시, 저장소 공개 설정, MAX_USD_PER_RUN 초과, 요구사항 충돌, 권리 문제)뿐입니다. 사용자 준비물(§11)이 없어 불가능한 작업은 BLOCKED(원인)로 기록하고 의존하지 않는 다음 작업을 계속하세요. Google Mock 성공을 실제 E2E 완료로 보고하지 마세요. 확인 불가 항목은 추정하지 말고 미확인으로 남기세요. 화면 문구·명령·오류 메시지가 바뀌면 같은 커밋에서 docs/USER_GUIDE.md를 갱신하세요.
```

---

## 14. 최종 인수 기준 (plan.md 부록 A에 추가·변경)

`plan.md` 부록 A를 유지하되 아래를 변경·추가한다.

- [ ] 레벨 중립 검사(`lint:level-neutral`)가 통과하고, 저장소·경로·식별자·UI 문구에 특정 등급 하드코딩이 없다.
- [ ] 배포물이 `index.html` + `audio/`뿐이다(앱 코드는 `index.html` 한 파일).
- [ ] `api`와 `headless` 두 연동 방식이 모두 동작하고(`content:doctor`), 설정만으로 전환되며, 두 방식이 같은 검증 규칙을 적용한다.
- [ ] 콘텐츠 CLI로 새 항목을 생성 → 검증 → 팩 → 앱 import → 학습 노출까지 **HTML 수정 없이** 동작한다.
- [ ] 전체/유형별 export → 새 시트에 import → 신규 반영, 같은 팩 재import 시 중복 0이다.
- [ ] 변조 팩, 악성 문자열 팩, 참조 누락 팩이 IMP 규칙대로 거부·보류·강등된다.
- [ ] 앱에서 신고한 항목이 학습 풀에서 제외되고 `flags.json`으로 내보내진다.
- [ ] 청해 TTS 음원이 Android Chrome 실기기에서 재생되고, 평가 시 소스 구성과 "TTS 음원 기반" 배지가 표시되며, `BROWSER_TTS`는 기본적으로 평가에서 제외된다. `RECORDED` 교체가 동작한다.
- [ ] §3.3의 계승 기능(혼동 글자, 5단계 복습, 약점 복습, 시작 전 안내, 문법 원리 학습, 듣고 쓰기, 리포트, 다크 모드, 백업/복원)이 구현되어 있다.
- [ ] §4.1 초기 분량을 달성했거나 미달 사유가 `BLOCKED(COST/LLM)`로 기록되어 있다.
- [ ] `docs/USER_GUIDE.md`가 실제 화면·명령과 일치하고(T09 이후 릴리스마다 갱신), 앱 안 도움말 화면이 있다.
- [ ] 런웨이가 앱에 표시되고 14일 미만이면 안내가 뜬다. `progress.json` → `content:plan` → `content:fill` → import 순환이 동작하며 `progress.json`에 개인 식별 정보가 없다.
- [ ] 공식 점수·합격 확률 수치 출력 0회, `file://`에서 Google 연동 성공 주장 0회.
