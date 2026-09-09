# Engineering and Interview Log

This document captures real implementation problems and decisions. Entries should include the symptom, root cause, alternatives, chosen fix, verification, and what would change at larger scale.

## 2026-09-08: Upstream market data cannot be the demo's single point of failure

**Problem:** Free market data sources may be delayed, rate limited, unavailable outside a local network, or change response fields without notice.

**Decision:** Add a provider boundary, cache the latest successful response, and ship a deterministic demo snapshot. Carry the active mode and timestamps through the API to the UI.

**Why it matters:** Reliability is part of the product. A fallback that silently masquerades as live data would be worse than a visible demo mode because it destroys trust in every later Agent conclusion.

**Verification target:** Force the live adapter to fail, then verify that the market overview and stock detail remain functional and visibly switch to demo mode with a fallback reason.

## 2026-09-08: Full-market endpoints are too slow for the request path

**Experiment:** Tested both full-market A-share snapshot functions through AKShare from the development machine.

**Observed results:**

- Eastmoney (`stock_zh_a_spot_em`) retried and then failed after 10.77 seconds because the remote peer closed the connection.
- Sina (`stock_zh_a_spot`) returned 5,557 rows and the expected quote fields, but took 80.74 seconds across 70 paged requests.
- The AKShare documentation warns that repeated Sina calls can temporarily block the caller's IP.

**Decision:** Default the interactive application to the deterministic demo snapshot for now. A live provider remains available only when explicitly enabled. The production design will collect live data in a background job, validate it, persist the last successful snapshot, and let visitor requests read that snapshot with no upstream dependency in their latency path.

**Rejected alternative:** Increasing the frontend timeout would make the page appear broken and would still expose interview demos to rate limits and schema drift.

**Next validation:** Measure a scheduled collection strategy and compare a licensed snapshot API before choosing the production provider.

## 2026-09-08: Local artifacts inflated the Docker build context

**Problem:** The first frontend image build sent a 213 MB context because `node_modules`, Playwright browsers, screenshots, and test traces were present locally.

**Decision:** Add service-specific `.dockerignore` files and use `npm ci` against the committed lockfile for reproducible container installs.

**Verification target:** A clean rebuild should send only application source and configuration rather than local development artifacts.

**Result:** The next build sent 1.18 KB for the frontend context and 2.06 KB for the backend context. Both images built successfully.

## 2026-09-08: Relative performance test caught a mistaken human assumption

**Problem:** A new Agent test expected Ningde Times at -1.12% to be weaker than its new-energy sector at -1.47%.

**Finding:** The deterministic calculation correctly reported the stock as 0.35 percentage points stronger than its sector. The test expectation, not the implementation, was wrong.

**Decision:** Keep all numeric comparisons in code-backed tools and test concrete values. LLM nodes may summarize those facts but must not recompute them.

## 2026-09-08: Establish a pre-LLM latency baseline

**Experiment:** Sent 20 sequential market-summary requests through the Docker/Caddy reverse proxy to the deterministic LangGraph workflow.

**Result:** Mean 11.47 ms, P95 18.25 ms, maximum 100.95 ms on the local development machine.

**Interpretation:** This measures API and orchestration overhead only. It must not be presented as an LLM-agent latency result or production SLA. Later retrieval and model runs will be measured separately so their cost is visible.

## 2026-09-08: Version the Agent's deterministic baseline

**Experiment:** Added 20 questions covering market summaries, stock name/code resolution, and out-of-scope investment or prediction requests.

**Result:** 20/20 passed, with 100% intent accuracy and 100% entity accuracy on the fixed demo set.

**Interpretation:** This protects current behavior and supplies a comparison point for the future LLM router. It is not a benchmark for unrestricted user questions; the dataset and report are committed so the scope remains auditable.

## 2026-09-08: Add model language without moving financial math into the model

**Experiment:** Connected `qwen/qwen3.5-flash-02-23` through OpenRouter and kept the
existing deterministic LangGraph nodes as the source of all figures. The first eight-token
probe was consumed by visible reasoning text. The corrected client disables reasoning for this
short answer path and caps output at 240 tokens.

**Decision:** Qwen refines only supported market and stock answers. Provider failure, timeout,
or an empty response preserves the deterministic draft. The UI identifies whether an answer
was model-enhanced and exposes the `refine_with_model` trace step.

**Measured validation cost:** OpenRouter account usage increased by approximately `$0.000226`
during key checks, minimal probes, and browser-level Agent tests, about CNY 0.0016 at an
illustrative 7.2 USD/CNY rate.

## 2026-09-08: Replace the treemap with a directional collision field

**Problem:** The original treemap communicated turnover but not the requested sense of market
movement. It also could not separate rising and falling instruments spatially.

**Decision:** Use `d3-force` for collision and attraction, and Canvas for rendering. Bubble
radius represents absolute percentage movement; A-share red/green semantics represent
direction. Desktop hover exposes a focused tooltip, while mouse click and mobile touch update
the linked detail panel.

**Implementation issue:** React StrictMode cancelled the first animation frame but left its
pending-frame marker set, causing the second mount to remain blank. Cleanup now resets that
marker, the first frame is drawn synchronously, and the Canvas exposes a settled state for
stable interaction tests.

**Design reference:** The supplied university concept deck inspired the graphite, white, and
signal-yellow hierarchy and the emphasis on explainability. Its Australian investor-profile
workflow and recommendation framing were deliberately not copied into this A-share product.
