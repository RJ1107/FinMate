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
resolution, deterministic market/stock composition, optional Qwen refinement, typed evidence,
and visible trace output. Current event items are labeled demonstration content. Live news
retrieval, citation URLs, and attribution guards remain for the next iteration.

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
 PostgreSQL/pgvector + cache
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
- PostgreSQL with pgvector will initially hold application metadata, full-text indexes, and vectors in one operational unit.
- Docker Compose and Caddy will target a single VPS with HTTPS and a custom domain.

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
