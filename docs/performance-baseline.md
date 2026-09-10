# FinMate performance baseline

Measured locally on 2026-09-10 with the production React build logic and Playwright Chromium.

## Fault-isolation benchmark

The browser test injects a 20,000 ms delay into every market-pulse request, then measures when
the feature menu, HeyFinmate heading, and user-profile section are available.

- Samples: 243, 236, 221, 222, 216, 227, 223 ms
- Median (p50): 223 ms
- Trials: 7

This benchmark validates UI fault isolation rather than third-party market-data speed. It is safe
to describe as: "kept non-market interactions available at 223 ms p50 under an injected 20 s
market-provider delay."

## Workload reduction

The first screen requests five A-share indices and five aggregate market metrics. The stock cloud
is loaded on demand and paints at most 96 bubbles from the active stock pool. This removes
full-universe sorting and collision simulation from the initial rendering path.

Do not quote an external-provider latency reduction unless the before/after runs use the same
network conditions and uncached dataset.
