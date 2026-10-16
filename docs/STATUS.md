# STATUS (resume file)

최종 갱신: 2026-10-16

| 작업 | 상태 | 커밋 | 비고 |
|---|---|---|---|
| T00 사실 확인 | DONE(일부 BLOCKED/미확인) | 0b18a89 | ①②③④⑥⑩ 확인, ⑤ 미확인, ⑦ 부분 확인, ⑨ BLOCKED(DEVICE, GOOGLE) |
| T01 저장소·빌드 | DONE | 4130934 | 빌드 2.4 KiB, file:// 및 localhost 렌더 확인, 테스트 5 PASS |
| T02 공용 스키마·도메인 | DONE | d8de327 | 테스트 50 PASS, lint:level-neutral 0건 |

## BLOCKED / 미확인 목록
- T00⑨ 저장소 게이트 측정: BLOCKED(DEVICE: Android Chrome, GOOGLE: Client ID·HTTPS Origin·테스트 시트)
- T00⑤ 청해 선택지 수: 미확인(이미지 PDF, 렌더러 없음)
- T00⑦ `file://` GIS 거부: 부분 확인(init 성공, 팝업은 헤드리스라 판정 불가)
- Android 실기기 전 항목: BLOCKED(DEVICE)
- TTS 약관, headless 구독 자동화 약관: 미확인(사용자 확인 필요)

## 다음 작업
T03 퀴즈 쉘·설정·홈 쉘
