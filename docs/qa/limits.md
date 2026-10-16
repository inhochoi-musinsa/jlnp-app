# 외부 한도·조건 확인 기록 (T00 ①②③④)

확인일: 2026-10-16. 범례: **[공식 확인]** 공식 문서 직접 확인 / **[미확인]** 확인 못 함.

## ① Google Sheets API 한도 `[공식 확인]`
- 출처: https://developers.google.com/workspace/sheets/api/limits
- 읽기 300회/분/프로젝트, **60회/분/사용자/프로젝트**. 쓰기도 동일(300 / 60).
- 요청 페이로드 권장 최대 **2 MB**, 요청당 처리 한도 **180초**(초과 시 타임아웃).
- **적용 상수(`SYNC_*`, T07에서 코드화):**
  - `SYNC_MAX_ROWS_PER_BATCH = 200`, `SYNC_MIN_INTERVAL_MS = 10000`
  - 한 사용자 쓰기 ≤ 60/분 안에서 동작(배치 간격 10초 → 최대 6회/분 + 재조회 읽기 6회/분. 한도의 10%).
  - 팩 import 5,000항목 = 200행 × 25배치 = 쓰기 25회 + 재조회 25회. 분당 한도 안에서 약 3~5분(간격 10초 기준 약 4분).
- 셀당 최대 글자 수·시트당 최대 셀 수는 이번에 확인하지 못했다 → **[미확인]**. 앱 정책 30,000자(`payload`)는 제품 정책이며 Google 공식 수치가 아니다.

## ② GitHub Pages 조건 `[공식 확인]`
- 출처: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits ,
  https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site
- 게시 사이트 크기 **1 GB 이하**, 저장소 권장 1 GB 이하, 대역폭 **월 100 GB(소프트)**, 빌드 시간당 10회(소프트, Actions 커스텀 워크플로는 제외), 배포 10분 타임아웃.
- **GitHub Free 계정은 저장소가 공개(public)여야 Pages 사용 가능**(공식 문서 문장 확인). 유료 플랜의 비공개 저장소 허용 여부는 플랜·조직 설정에 따름 → 사용자 플랜은 **[미확인]**.
- 게시 소스는 브랜치·폴더 또는 Actions. 진입 파일(`index.html`)은 게시 소스 루트에 있어야 한다.
- 방문자 IP가 보안 목적으로 로그된다고 문서에 명시.
- **사용자 확인 필요(§10-4):** 저장소 공개 설정은 사용자가 승인해야 한다. 공개되는 것은 앱 코드와 음원이며 학습 기록·콘텐츠는 사용자 시트에 있다.
- 용량 영향: `index.html` ≤ 600 KiB + 청해 mp3 100개 ≈ 수십 MB 수준 → 1 GB 한도 이내(실측은 T14/T15).

## ③ Google Cloud Text-to-Speech `[공식 확인(가격표 렌더 확인) / 일부 미확인]`
- 가격 출처: https://cloud.google.com/text-to-speech/pricing (브라우저로 렌더하여 표 추출). 결제(billing) 사용 설정이 필요하고 무료 한도 초과분은 자동 청구.
  - Standard: 월 무료 4,000,000자, 이후 $4/백만자. WaveNet: 표에 월 무료 4,000,000자·$4/백만자로 표시되나 Standard와 같은 SKU로 표기되어 있어 **[미확인]**(대량 합성 전에 재확인).
  - Neural2: 월 무료 1,000,000자, $16/백만자. Studio: 무료 1,000,000자, $160/백만자. Chirp 3 HD: 무료 1,000,000자, $30/백만자.
  - 일본어(ja-JP)는 글자당 2바이트 이상이지만 과금은 문자 수 기준이라고 페이지에 명시.
- 쿼터 출처: https://docs.cloud.google.com/text-to-speech/quotas — **요청당 최대 5,000바이트**(텍스트·SSML 공통, 증설 불가; 일본어는 글자 수가 더 적음), 분당 요청 한도 Neural2 1,000 / Chirp3 200 / 기본 1,000.
- SSML: 별도 SSML 한도 표기는 없고 5,000바이트 한도에 포함. `<break>` 지원 여부 및 음성별 SSML 지원은 **[미확인]**(T14에서 실제 합성으로 확인).
- 결론: 청해 100개 × 평균 600자 ≈ 6만 자로 어느 음성이든 **무료 한도 이내**로 추정(계산값이며 청구 보장은 아님). 약관(생성 음원의 게시 허용 범위)은 이번에 확인하지 못함 → **[미확인]**, T14 전에 사용자 확인.

## ④ Anthropic 가격표·모델 문자열 `[공식 확인]`
- 출처: https://platform.claude.com/docs/en/about-claude/pricing , https://platform.claude.com/docs/en/about-claude/models/overview
- 유효한 API 모델 ID: `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `claude-fable-5-1`(dateless pinned snapshot, 별칭 행도 동일 문자열).
- 가격($/MTok 입력/출력): Sonnet 5.5 2/10, Opus 5.5 4/20, Haiku 5.5 0.10/0.50(프롬프트 10만 토큰 초과 시 0.50/2.50), Fable 5.1 10/50. 배치 50% 할인. → `tools/content/pricing.json`.
- 실제 호출로 `--model sonnet` 별칭이 `claude-sonnet-5-5`로 해석되는 것을 headless 응답의 `modelUsage` 키로 확인(`llm-providers.md`). `opus` 별칭은 `content:doctor` 구현(T05)에서 확인한다 → 현재 **[미확인]**.
- 모델 퇴역 하한: Sonnet 5.5 2027-09-28 이후, Opus 5.5 2027-09-22 이후 (공식 표기 "not sooner than").

## 사용자 확인이 필요한 항목 요약
1. 저장소 공개 설정(Free 플랜이면 public 필요).
2. TTS 약관(음원 게시 허용 범위)과 결제 계정 연결.
