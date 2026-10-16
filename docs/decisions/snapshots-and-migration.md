# 스냅샷·마이그레이션·다기기 충돌 (T17, v4.0.0)

## 결정
- **`_JLPT_SNAPSHOTS` 시트 탭은 만들지 않았다.** 시트 구조(`sheetSchemaVersion`)는 1 그대로다. 이유: 시트 스키마를 올리면 구버전 앱이 읽기 전용으로 떨어지는데, 실제 Google 시트에서 마이그레이션(`export snapshot → dry-run → 검증 → 기록 → 재개`)을 확인할 수단이 없다(BLOCKED(GOOGLE)). 가짜 API만으로 "시트 마이그레이션 완료"라고 보고하지 않는다. 시트 이벤트는 증분 읽기(500행 단위)라 현재 규모에서 스냅샷이 필요하지 않다(아래 측정).
- **로컬 복구 지점**: 같은 IndexedDB의 `snapshots` 저장소에 전체 JSON 백업을 둔다. 저장소 업그레이드 때(`AFTER_UPGRADE`), 백업 가져오기·복구 지점 복원 직전(`BEFORE_RESTORE`), 직접(`MANUAL`) 만들며 최근 5개만 유지한다. 3만 건 초과 시 자동 생성하지 않는다. 복원은 **합집합(빠진 이벤트만 추가)** 이다. 이벤트를 지우는 롤백은 하지 않는다(append-only).
- **저장소 마이그레이션**: IndexedDB 버전은 단계별 함수(`UPGRADES[1..3]`)로 올리며 각 단계는 저장소만 추가하고 기존 행을 고치지 않는다. `clearAll()`도 복구 지점은 지우지 않는다.
- **`deviceSeq` 복구**: 열 때 `max(저장된 카운터, 이 기기가 쓴 이벤트의 최대 seq)`로 시작해 번호 재사용을 막는다.
- **목표 충돌**: `EXAM_TARGET_SELECTED`에 `basedOn`(그 기기가 알던 목표 이벤트 id들)을 싣는다. 아무도 대체하지 않은 이벤트(head)가 값이 다른 둘 이상이면 충돌이며 사용자가 고른다. `basedOn`이 없는 기존 이벤트는 시간순 사슬로 취급해 예전과 동일하게 "최신이 이긴다". 원격에 쓰는 것은 이벤트 추가뿐이라 덮어쓰기는 발생하지 않는다.

## 측정 (PC Chrome 155 headless, macOS; 모바일 기기는 미확인)
| 기록 수 | 앱 부팅~홈 표시 | 비고 |
|---|---|---|
| 20,000 | 약 0.2 s | `tests/ui/scale.ui.test.ts` |
| 100,000 | 약 0.9 s | 같은 테스트. 모델 재계산만은 노드에서 100k 약 0.3 s (`tests/perf/scale.test.ts`) |
| 시트 12,000행 새 기기 복원 | GET ≤ 30회(500행 단위), 중복 0 | 가짜 Sheets API (`tests/google/sync.test.ts`) |
Android Chrome에서의 시간은 **미확인(BLOCKED(DEVICE))**.

## 이전 버전 fixture (`tests/fixtures/legacy/`)
각 커밋에 **커밋된 dist/index.html**(그 시점의 실제 빌드)을 `scripts/make-legacy-fixture.mjs`로 구동해 설정·목표·진단 6문항을 만들고 IndexedDB 원본 덤프와 JSON 백업을 저장했다: `t06`(DB v1), `v0.1.0`, `t12`(v1.0.0 후보), `t14`. 네 파일 모두 옛 빌드의 버그로 `deviceSeq`가 중복된 기록(23건 중 16개 고유)을 담고 있어 복원 검증에 실제 데이터 문제가 포함된다. 현재 빌드가 (1) 업그레이드 후 모든 이벤트·프로필·기기 id·목표·진단 진행을 보존하고 (2) 백업을 새 설치에 손실 없이 가져오며 (3) 새 이벤트가 옛 최대 seq보다 큰 번호를 받는지를 `tests/ui/legacy.ui.test.ts`가 검증한다.
한계: 그 시점 저장소에는 `.gitignore` 실수로 `app/src/content/`가 커밋되지 않았으므로(이후 수정), 해당 시점의 콘텐츠 계층은 재현하지 못했고 **커밋된 dist 그대로**만 사용했다.
