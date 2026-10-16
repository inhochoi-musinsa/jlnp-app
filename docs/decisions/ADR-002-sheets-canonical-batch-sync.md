# ADR-002 Sheets 정본 + 배치 동기화
- 상태: ACCEPTED (D1, D2)
- 결정: 정본은 사용자가 붙여 넣은 Google Sheet(`_JLPT_*` 탭), 기기에는 IndexedDB 캐시와 outbox. 저장소는 `Repository` 인터페이스 뒤에 두어 교체 가능.
- 인증: GIS token model, 민감 스코프 `spreadsheets`, Picker·`drive.file` 없음. 토큰은 메모리에만.
- 동기화: 로컬 기록 먼저 → 20건/60초/숨김/종료/수동 배치 → `values.append`(RAW) → `updatedRange` 재조회 후 `eventId+checksum` 일치 시에만 SYNCED.
- 한도(T00): 쓰기 60회/분/사용자. 1회 최대 200행, 최소 간격 10초 (`docs/qa/limits.md`).
- 저장소 게이트: 모바일 3,000행 읽기 5초 목표는 측정 전(`storage-gate.md`).
