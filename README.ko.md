# scaffold-day

> AI로 하루를 설계한다.

`scaffold-day`는 캘린더의 실제 빈 시간에 TODO를 배치하는 CLI/MCP 도구입니다.
Claude Code, Cursor, Claude Desktop 같은 AI 클라이언트를
**1급 사용자(first-class user)** 로 취급하며, CLI 플래그와 MCP 도구가
동일한 표면(surface)을 노출합니다.

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](./LICENSE)

> ⚠️ **프리릴리스.** v0.1은 [Walking
> Skeleton](https://github.com/scaffold-at/day/issues/1) 단계입니다. 표면 대부분이
> 연결되어 있지만 바이너리 릴리스(`bun build --compile`), 호스팅, 데스크톱 OAuth
> 플로우는 아직 작업 중입니다. 소스에서 직접 실행해 보시고, 거친 부분은 양해
> 부탁드립니다.

## 왜 만들었나

대부분의 캘린더 도구는 *시간을 보여주는 데* 최적화돼 있습니다.
`scaffold-day`는 *시간을 배치하는 데* 최적화합니다. TODO 목록을 받아,
중요도를 계산하고, 정책에 따라 캘린더의 실제 빈 슬롯에 떨어뜨립니다. 정책은
사람이 읽고 손으로 고칠 수 있는 YAML이고, 모든 결정은 재현/리플레이가
가능합니다.

같은 표면을 CLI(사람·스크립트용)와 MCP 도구 카탈로그(AI 클라이언트용)로
함께 노출하기 때문에, LLM은 CLI 텍스트를 파싱할 필요 없이 **단일 툴 호출**로
하루를 계획할 수 있습니다.

## 빠른 시작

```sh
git clone https://github.com/scaffold-at/day.git scaffold-day
cd scaffold-day
bun install

# 로컬 홈(~/.scaffold-day) 초기화 + balanced 정책 시드
bun run dev:cli init

# 오늘 일정은?
bun run dev:cli today --tz Asia/Seoul

# AI가 읽기 좋은 표면 덤프 (markdown / json / yaml)
bun run dev:cli docs --for-ai
```

`bun build --compile`로 만들어지는 단일 바이너리 릴리스는 §S48에서 들어갑니다.
그전까지는 `bun run dev:cli`가 정식 진입점입니다.

## 지금 쓸 수 있는 것

| 표면 | 상태 | 메모 |
| --- | --- | --- |
| `today` / `day get` / `week` | ✅ | 로컬 파일 기반 데이 뷰, 빈 슬롯 계산 포함 |
| `todo add/list/get/score`, `place suggest/do/override` | ✅ | 2-티어 저장(Summary + Detail) |
| `policy show/patch/preset apply` | ✅ | YAML 코덱이 코멘트 보존, JSON Patch(RFC 6902) 지원 |
| `conflict list/resolve` + `explain` | ✅ | 리플레이 가능한 Placement / Conflict 로그 |
| `auth login/list/logout/revoke` | ✅ | Mock 모드(파일 저장). 실제 데스크톱 OAuth 플로우는 §S27 B-mode |
| Google Calendar 어댑터 | ✅ Mock / 🚧 Live | 외부 자격 없이 fork가 통과하도록 mock-first |
| AI 프로바이더 | ✅ | `MockAIProvider` + `ClaudeCliProvider`(바이너리 없으면 자연스럽게 비활성) |
| MCP 서버(도구 24개) | ✅ | `scaffold-day mcp` (stdio), 토큰 코퍼스 회귀 게이트 적용 |
| `docs --for-ai` / `AGENTS.md` / 명령별 MDX | ✅ | 단일 진실 원천, CI가 신선도 검사 |

전체 표면은 [`AGENTS.md`](./AGENTS.md)와 명령별 MDX 트리
[`apps/web/content/cli/`](./apps/web/content/cli/)에 자동 발행되며, 레지스트리가
바뀔 때마다 재생성됩니다.

## AI 클라이언트 연동

`scaffold-day mcp`는 [Model Context
Protocol](https://modelcontextprotocol.io)을 stdio로 말합니다. MCP 클라이언트
설정에 바이너리를 등록하면 24개 도구(`get_day`, `suggest_placement`,
`place_todo`, `compute_task_importance`, `replan_day`,
`explain_placement` …)를 한 번의 호출 표면으로 쓸 수 있습니다.

권장: 세션 시작 시 [`AGENTS.md`](./AGENTS.md)를 시스템 프롬프트에 한 번
붙여 넣으세요. *"미팅이 옮겨졌어요 — 다시 계획해줘"* 같은 JTBD 레시피가
포함돼 있어서, AI가 호출 시퀀스를 매번 새로 추론할 필요가 없습니다.

세션 한정 / 토큰 절약형 조회는:

```sh
scaffold-day docs --for-ai --format json --commands today,place,explain
```

## 프로젝트 구조

```
packages/
  day-core/      # 스키마, 정책, 중요도, 배치, 에러
  day-cli/       # CLI 진입 + 명령 (레지스트리 기반)
  day-mcp/       # MCP 도구 카탈로그 (24개, stdio 서버)
  day-adapters/  # Google Calendar 어댑터 (mock-first)
apps/
  web/           # 문서 사이트 자리표시자 (S52/S53)
scripts/         # 생성기 + CI 게이트 (validate-help, bench-token, gen:agents-md, gen:cli-reference)
tests/e2e/       # CLI 서브프로세스 블랙박스 테스트
```

상세 설계(PRD + 슬라이스 배포 계획)는 비공개 저장소
[scaffold-at/day-blueprint](https://github.com/scaffold-at/day-blueprint)에
있고, 공개 진행 상황은 [issue
#1](https://github.com/scaffold-at/day/issues/1)에서 추적합니다.

## 기여

DCO 서명, CLA 없음, AGPL-3.0-or-later + "더 허용적인 방향으로만 재라이선스"
약속. 자세한 내용은 [CONTRIBUTING.md](./CONTRIBUTING.md), 행동 강령은
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)를 참고하세요. 보안 이슈는
[SECURITY.md](./SECURITY.md)의 비공개 채널로 알려 주세요.

## 라이선스

AGPL-3.0-or-later. [LICENSE](./LICENSE)와 [NOTICE](./NOTICE) 참고.
