# Verification Snapshot

Latest dark dual-view delivery and localhost deployment verification:
[2026-09-08 update](dark-dual-view-delivery.md). The figures below describe the earlier V2 baseline.

Date: 2026-09-08

## Automated checks

- Backend: Ruff passed.
- Backend: 15 tests passed.
- Backend coverage: 85% overall; 96% for the LangGraph workflow module.
- Agent eval: 20/20 cases passed; 100% intent accuracy and 100% entity accuracy on the versioned deterministic demo set.
- Frontend: TypeScript and Vite production build passed.
- Frontend runtime dependency audit: zero known vulnerabilities.
- Browser: ten Playwright checks passed across desktop and mobile Chromium.
- OpenRouter: API key validated; Qwen returned model-enhanced answers through the FinMate backend.
- Model validation cost: approximately `$0.000226` / CNY 0.0016 incremental account usage.
- Local runtime: FastAPI and Vite are running on ports 8000 and 8080 for final inspection.

The browser suite checks a painted Canvas, global reference indices, horizontal overflow,
search/detail linkage, real hover and touch selection, sector event tabs, the model-backed Agent
request path, evidence rendering, and graph trace rendering.

The Agent evaluation result is scoped to `backend/evals/cases.json`. It is a regression baseline, not a claim about unrestricted natural-language understanding.

## Local latency sample

Twenty sequential requests were sent through Caddy to `POST /api/v1/agent/query` using the deterministic demo dataset:

| Metric | Result |
|---|---:|
| Mean | 11.47 ms |
| P95 | 18.25 ms |
| Maximum | 100.95 ms |

This is a local development-machine sample, not a production SLA and not representative of a future LLM-backed path. It establishes a baseline for orchestration and API overhead before model and retrieval latency are introduced.

## Data source spike

| Provider path | Result | Decision |
|---|---|---|
| AKShare / Eastmoney full A-share snapshot | remote disconnect after 10.77 seconds | do not put on the visitor request path |
| AKShare / Sina full A-share snapshot | 5,557 rows in 80.74 seconds | use only for controlled background collection; repeated calls may trigger blocking |
| Fixed FinMate snapshot | immediate and reproducible | default for current interview demo, visibly labeled `demo` |

## Visual artifacts

Playwright writes current desktop and mobile screenshots to `frontend/artifacts/`. These files are generated verification artifacts and are intentionally excluded from version control.
