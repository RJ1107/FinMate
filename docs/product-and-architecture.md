# FinMate: Product and Architecture

## Product objective

FinMate is a deployable financial analysis workspace for answering: "What moved in the A-share market, and what evidence may explain it?"

The primary user journey is:

1. Scan the current market breadth and sector/stock heatmap.
2. Select an unusual stock or sector.
3. Review deterministic market facts and related evidence.
4. Ask a follow-up question and inspect the agent's cited reasoning path.

The project is designed as a resume centerpiece and live interview demo. Its quality bar is therefore not the number of technologies used, but whether the full workflow is usable, observable, reproducible, and explainable by its author.

## Scope

### Phase 1: market map

- major index snapshot
- market breadth and turnover summary
- force-driven stock collision map with rising and falling zones
- A-share indices plus clearly separated global reference indices
- linked stock, sector, and event context
- provider status, observation time, and fallback reason

### Phase 2: cited financial RAG

- ingest news, filings, financial reports, and selected research documents
- preserve source, publication time, symbol, page/section, and document type metadata
- hybrid retrieval and optional reranking
- citation-backed answers with an explicit insufficient-evidence state

### Phase 3: LangGraph attribution workflow

- route user intent
- resolve financial entities and time range
- fetch and calculate market facts
- detect an event window
- retrieve and rank evidence
- synthesize hypotheses
- validate grounding and causal language
- return a typed answer and trace

The first constrained model path is implemented: market loading, intent routing, entity
resolution, deterministic market/stock composition, optional model refinement, typed evidence,
and visible trace output. Live market news is ingested with publication metadata and URLs, then
retrieved for news questions. Vector retrieval, filings, reports, and stronger attribution guards
remain later iterations.

## Non-goals

- automated trading or brokerage integration
- personalized investment advice
- unsupported price prediction claims
- microservices, Kafka, Kubernetes, or theatrical multi-agent role play in the MVP

## System shape

```text
Market/news/document providers
             |
   normalization + provenance
             |
 PostgreSQL JSONB memory + provider caches
             |
 deterministic services + LangGraph
             |
          FastAPI
             |
 React/TypeScript + Canvas/d3-force
```

## Technology choices

- React, TypeScript, Canvas, and `d3-force` provide a dense physical market view without a heavy chart bundle.
- FastAPI and Pydantic provide typed contracts and keep financial calculations outside the LLM.
- LangGraph models the current fact workflow as explicit, observable state transitions; later retrieval nodes extend the same graph.
- PostgreSQL 16 stores anonymous profiles, recent conversation turns, paper portfolios, and retrieved news. JSONB keeps the profile and portfolio payloads flexible while relational indexes support conversation and time queries.
- Short-term memory is the last eight turns in a conversation; long-term memory is the user-controlled structured profile and explicit interest topics.
- The paper portfolio is also long-term state: initial cash, available cash, symbols, share counts, costs, and last observed prices are synchronized from the browser to the database.
- Raw conversation turns are retained in the database, while only the latest eight messages enter the active prompt. Conversation text does not silently rewrite the user's structured profile.
- A bounded PostgreSQL connection pool supports concurrent API workers. `pgvector` remains an optional later addition when embedding retrieval is justified by corpus size and evaluation results.
- Docker Compose and Caddy will target a single VPS with HTTPS and a custom domain.

## Live market and retrieval boundaries

- Major indices come from Sina's structured quote endpoint.
- Daily limit-up and limit-down counts come directly from Eastmoney's dedicated limit pools; they are structured facts and do not use RAG.
- Full-market advancer/decliner counts are calculated in a background scan and surfaced only after completeness validation.
- Market news uses a retrieval-augmented baseline: ingest current articles, score recent candidates against the question, and return the matching source URLs as evidence.
- The LLM may explain retrieved facts but cannot overwrite market numbers. If it times out, the deterministic evidence-backed answer remains available.

## Memory ownership

| Data | Prompt lifetime | Storage | Update rule |
|---|---|---|---|
| Latest 8 messages | short-term | `conversation_messages` in PostgreSQL | every successful Agent turn |
| Structured user profile | long-term | `user_profiles` JSONB in PostgreSQL | only an explicit profile save writes to the database |
| Paper portfolio | long-term | `portfolios` JSONB in PostgreSQL | debounced after each portfolio change |
| Market news corpus | retrieval memory | `news_documents` in PostgreSQL | upserted when current news is fetched |

The current anonymous `client_id` and `conversation_id` live in browser local storage. Clearing
browser storage creates a new identity; account login and cross-device identity are intentionally
deferred until the project needs real user authentication.

## Anonymous usage limits

- FinMate permits 20 Agent conversations and 2 explicit profile changes per anonymous client per China/Shanghai calendar day.
- PostgreSQL stores the counters in `daily_usage`, keyed by `(client_id, usage_date)`. An atomic upsert prevents concurrent requests from exceeding either limit.
- Loading the page and saving an unchanged profile do not consume profile quota. A successful Agent request consumes one conversation quota before model or tool execution begins.
- The interface shows the current allowance and remaining count, and the API remains the authoritative enforcement point with HTTP 429 responses.
- This is cost protection for the anonymous preview, not strong identity enforcement: clearing browser storage creates a new `client_id`. A later login system should bind these counters to an authenticated `user_id`, with an additional reverse-proxy IP rate limit for abuse resistance.

## Data source assumptions to validate

| Need | Initial candidate | Assumption | Required validation |
|---|---|---|---|
| A-share snapshot | AKShare/Eastmoney adapter | sufficient for a portfolio demo | schema drift, latency, rate limits, server reachability, permitted usage |
| Sector membership | AKShare industry endpoints | symbols can be normalized across endpoints | classification consistency and refresh cost |
| Announcements | official exchange/CNInfo sources or licensed API | metadata and source URLs are available | access terms, anti-bot controls, historical coverage |
| News | licensed API, RSS, or curated sources | publication time and canonical URL are available | redistribution rights, deduplication, relevance quality |
| Financial documents | user-provided/local public documents | text extraction retains useful structure | PDF quality, tables, page citations, versioning |

These candidates are not production commitments. Each provider is isolated behind an interface so a source can be replaced without changing the domain or UI contracts.

## Reliability contract

Every market response carries:

- `mode`: `live`, `delayed`, `cached`, or `demo`
- source name
- observation timestamp
- retrieval timestamp
- optional fallback reason

A fixed demo snapshot is a first-class product mode, not hidden mock data. If live data fails, the interface says so and preserves a complete demonstration path.

## Success criteria for the first deployable version

- A visitor can use the core flow without installing software.
- The market page remains useful when an upstream API is unavailable.
- Numeric claims can be recalculated from returned data.
- Important textual claims have clickable supporting sources.
- Agent routing, tools, evidence, timings, and failures can be inspected.
- The project includes evaluation results and real engineering tradeoff notes.
