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

## BLOCKED / 미확인 목록
- T00⑨ 저장소 게이트 측정: BLOCKED(DEVICE: Android Chrome, GOOGLE: Client ID·HTTPS Origin·테스트 시트)
- T00⑤ 청해 선택지 수: 미확인(이미지 PDF, 렌더러 없음)
- T00⑦ `file://` GIS 거부: 부분 확인(init 성공, 팝업은 헤드리스라 판정 불가)
- Android 실기기 전 항목: BLOCKED(DEVICE) — T03 레이아웃도 PC Chrome 에뮬레이션 뷰포트만 검증
- TTS 약관, headless 구독 자동화 약관: 미확인(사용자 확인 필요)

## 다음 작업
T06 진단·목표·플랜

## 해석·결정 기록
- IMP-10 필수 검사: BLIND_SOLVE·DISTRACTOR_CHECK는 선택지가 있는 QUESTION에만 적용, 다른 종류는 SCHEMA_LINT+QUALITY_CHECK로 판정(`shared/verification.ts`). 선택지 없는 항목에 PASS를 꾸며 기록하지 않기 위함.
- 생성 단계 자기 수리(`repairDraft`): V1 위반 초안을 검증 호출 전에 생성 모델에게 최대 2회 되돌려 보낸다. V1 자체의 "즉시 REJECT"는 그대로.
- 시드 생성은 headless(구독) 방식으로 수행. `maxCallsPerRun`은 로컬 `config.local.json`(gitignore)에서 300으로 올림(템플릿 기본 100). USD 과금 아님.
- 시드 품질은 자동 검증만 거쳤다. 사람 표본 점검은 하지 않았다(`npm run content:sample`로 가능).
