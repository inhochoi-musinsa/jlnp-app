# LLM 연동 방식 결정 (D9) — T00 ⑩

확인일: 2026-10-16, Claude Code 2.1.286, macOS.

## 공식 확인 `[공식 확인]`
출처: https://code.claude.com/docs/en/cli-reference , https://code.claude.com/docs/en/headless , https://code.claude.com/docs/en/authentication

| 항목 | 결과 |
|---|---|
| 비대화형 실행 | `claude -p "<prompt>"`, 성공 시 exit 0 |
| 출력 형식 | `--output-format text|json|stream-json`. json에 `result`, `session_id`, `total_cost_usd`, `usage`, `modelUsage`, `is_error` |
| 구조화 출력 | `--json-schema '<schema>'` → 응답의 `structured_output` 필드(`format` 키워드는 주석으로만 취급) |
| 모델 | `--model sonnet|opus|haiku|fable` 별칭 또는 전체 ID |
| 도구 끄기 | `--tools ""`(내장 도구 전부 비활성). MCP는 `--disallowedTools "mcp__*"` 또는 `--strict-mcp-config` |
| 세션 | `--no-session-persistence`(print 전용, 디스크 저장 안 함) |
| 최소 모드 | `--bare`: hooks·skills·plugins·MCP·CLAUDE.md 자동 로드 생략. **구독 로그인(OAuth)을 읽지 않고 `ANTHROPIC_API_KEY`/apiKeyHelper만 사용** |
| 안전 모드 | `--safe-mode`: 모든 커스터마이징 비활성, **인증·모델·내장 도구·권한은 정상 동작** (구독 로그인 사용 가능) |
| 예산 | `--max-budget-usd`(print 전용, 클라이언트 추정치), `--max-turns` |
| 장기 토큰 | `claude setup-token`(구독 필요, 1년 OAuth 토큰, `CLAUDE_CODE_OAUTH_TOKEN`) — `--bare`에서는 읽지 않음 |

## 실측 (이 PC, 구독 로그인 상태, API 키 없음)
명령(빈 임시 폴더에서 실행):
```
claude -p "<프롬프트>" --model sonnet --output-format json --tools "" \
  --no-session-persistence --safe-mode --json-schema '{...}'
```
- 성공. `structured_output={"ok":true}`, `modelUsage` 키가 `claude-sonnet-5-5` → **실제 모델명 확인 가능(`resolved:true`)**.
- `--safe-mode` 없이 실행하면 사용자 환경의 플러그인·MCP·스킬이 컨텍스트로 들어가 호출당 **약 105,800 입력 토큰(추정 $0.42)**. `--safe-mode`를 쓰면 **약 2,300 토큰(추정 $0.0099), 1.6초**. → **headless 호출에는 `--safe-mode`를 필수로 한다.**
- 구독 로그인으로 `-p` 호출이 동작함을 확인. 단 이 기능의 **약관상 자동화 허용 범위는 이번에 확인하지 못했다 → [미확인]**. 사용자가 약관을 확인해야 한다(`USER_GUIDE.md` §11에 이미 안내).
- 동시 호출 한도·구독 사용량 한도의 수치는 공개 수치 **[미확인]**. 한도 오류 시 백오프 후 이어서 진행하는 방식으로만 대응(T05 계약 테스트).

## 결정
1. `LlmProvider` 두 구현: `api`(Anthropic SDK, `ANTHROPIC_API_KEY`), `headless`(위 명령 고정 + `cwd=content/.headless-cwd/`).
2. headless 고정 플래그: `-p --output-format json --tools "" --no-session-persistence --safe-mode [--json-schema] --model <alias|id>`. `--resume/--continue` 금지.
3. 모델 기록: headless는 `modelUsage`의 키를 `resolvedModel`로 기록(`resolved:true`). 키가 없으면 요청 별칭을 기록하고 `resolved:false`.
4. 비용 필드: headless의 `total_cost_usd`는 참고용으로만 기록(구독 한도 기준 아님, `costBasis:"list"` 표기됨).
5. `--bare`는 사용하지 않는다(구독 로그인 불가). API 키가 있고 headless를 쓸 때만 선택 옵션.
6. 같은 모델 판정: `resolvedModel`이 둘 다 있고 서로 다를 때만 `VERIFIED` 가능.
