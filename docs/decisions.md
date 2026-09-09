# Architecture Decision Record

## ADR-001: Build a vertical slice before the agent

**Status:** accepted

The market map is implemented end to end before RAG and LangGraph. This produces a usable artifact early and establishes the data contracts the agent will later call as tools.

## ADR-002: Keep providers outside domain logic

**Status:** accepted

Free financial data endpoints can change schema, throttle requests, or become unreachable from a server region. Provider adapters normalize these differences into stable Pydantic models. Upstream names and fields must not leak into frontend contracts.

## ADR-003: Make fallback state visible

**Status:** accepted

The application must not label stale or fixed data as real time. Every response includes provenance and the UI prominently displays the current mode and timestamps.

## ADR-004: Prefer PostgreSQL plus pgvector for the MVP

**Status:** proposed for Phase 2

One database is easier to run and explain on a single VPS. It supports relational metadata, native text search, and vector similarity without adding another stateful service. A dedicated vector database remains an option if measured retrieval or scaling requirements justify it.

## ADR-005: Use LangGraph for constrained analysis workflows

**Status:** accepted; deterministic subset and model refinement implemented

Market facts, retrieval, attribution, and grounding have different failure modes. Explicit graph nodes and typed state make routing and retries inspectable. LangChain will provide selected integrations, not define the application's architecture.

## ADR-006: Use Canvas plus d3-force for the market field

**Status:** accepted

The main visualization uses a Canvas renderer and `d3-force` collision simulation. Absolute
price movement controls radius, while direction controls both color and vertical attraction.
This matches the intended rising/falling physical metaphor and keeps 24 moving nodes smooth.
An accessible hidden stock list mirrors the Canvas interaction for keyboard and assistive use.

The rejected treemap encoded turnover efficiently but could not express the requested physical
movement or directional zones. DOM circles would be easier to style but create more layout and
animation overhead as the universe grows.

## ADR-007: Let the model explain facts, not calculate them

**Status:** accepted

Qwen receives a deterministic draft and typed evidence after market calculations are complete.
It is instructed to cite evidence IDs, avoid new figures and causality claims, and keep the
answer concise. A 12-second timeout, one retry, and deterministic fallback keep the interview
demo usable when OpenRouter is unavailable. DeepSeek is configured as provider-level fallback.
