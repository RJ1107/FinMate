# FinMate V2: Features, Design, and Tradeoffs

## What is implemented

- A-share-first index tape with Nasdaq, S&P 500, Dow Jones, Nikkei 225, and KOSPI as context.
- A continuously moving force-driven stock map split into rising and falling zones.
- A compact two-icon switch for a sector-grouped turnover treemap; preference persists locally.
- Bubble size based on absolute percentage movement and A-share red-up/green-down color.
- Desktop hover focus, mouse click, and mobile touch selection.
- Search and one-click sector isolation.
- Linked stock facts, sector breadth/leaders, and attributed event context.
- LangGraph facts followed by optional Qwen explanation through OpenRouter.
- Visible data mode, timestamps, evidence IDs, model identity, graph nodes, and fallback state.

## Visual direction

The interface uses near-black for the page, charcoal and neutral gray for analytical surfaces, signal
yellow for selection and commands, cyan for data/model state, and red/green only for market
direction. The supplied course deck informed the clean hierarchy and explainability cues, but
the product composition, A-share semantics, market physics, and workflows are original to this
implementation. The exact reusable implementation brief is in `ui-generation-prompt.md`.

## Deliberate choices

**Movement over turnover in bubble size.** The requested experience is about the magnitude of
rise and fall, so radius maps to `abs(change_percent)`. Turnover remains visible in details.
A future control can switch size encoding between movement, turnover, and market cap.

**Global indices are context, not mixed into the A-share field.** Different trading sessions
and currencies make direct bubble comparison misleading. They therefore occupy a separate,
clearly labeled tape.

**Canvas with an accessibility mirror.** Canvas provides smooth collision animation and stable
performance, but has no native semantic nodes. A screen-reader stock-button list mirrors the
visual field, while the visible search and sector filters remain keyboard accessible.

**Model after deterministic tools.** The model improves language and question fit, but market
figures, rankings, and comparisons stay in typed code. This reduces hallucination risk and
makes the answer reproducible in interviews.

Financial concepts without a market-tool match can also reach the model, with no fabricated
market evidence attached. Configuration and successful responses are separate UI states;
the actual returned model is shown, and failed calls visibly retain the fact-based fallback.

**Demonstration events instead of invented live news.** The current event tab proves the
interaction and data contract, and labels every item as demonstration content. Shipping fake
headlines as live data would be unacceptable. Real news enters only after source, timestamp,
deduplication, and URL attribution are implemented.

## Deferred work

- Background market snapshot collection and resilient global-index provider.
- Licensed or terms-compliant news and exchange-announcement ingestion.
- PostgreSQL/pgvector hybrid retrieval with URL and document citations.
- Event-window attribution and explicit insufficient-evidence responses.
- Streaming model output, conversation memory, and measured per-request cost display.
- Production domain, HTTPS, secret injection, monitoring, and rate limiting.
