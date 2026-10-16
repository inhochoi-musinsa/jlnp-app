# ADR-003 콘텐츠 파이프라인·팩 포맷
- 상태: ACCEPTED (D6, D9)
- 결정: 콘텐츠는 앱 밖 `tools/content` CLI로 생성·검증하고 `*.jlptpack.json` 팩으로 앱에 import한다. 앱은 LLM 키를 갖지 않는다.
- 검증: 생성 모델 ≠ 검증 모델, 블라인드 풀이·오답 점검·품질 점검·중복 점검. 앱 안에서는 구조·안전·무결성(IMP-01..11)만 재검사하며 의미 검증 주장은 `selfAttested`.
- LLM 연동: `LlmProvider` 인터페이스, `api`·`headless` 두 구현(`llm-providers.md`).
- 포맷: `ContentRecord`(공용 `shared/` 스키마·해시·정규화), 불변 버전 행, `_JLPT_CONTENT` append-only + 행 커서 증분 로딩.
