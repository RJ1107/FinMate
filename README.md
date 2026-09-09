# FinMate

FinMate is an A-share market intelligence agent built for explainable market analysis. The first vertical slice turns market snapshots into an interactive market map with explicit data provenance and reliable fallback behavior. Later phases add cited news/filing retrieval and a LangGraph-based attribution workflow.

## Current milestone

The current vertical slice establishes the interview-demo foundation:

- FastAPI market overview and stock detail APIs
- dynamic turnover-ranked display pool drawn from the full A-share universe
- Eastmoney ranking with Sina ranking and deterministic snapshot fallbacks
- explicit `live`, `delayed`, `cached`, and `demo` data states
- React + Canvas collision market map powered by `d3-force`
- dark workspace with a compact, persistent switch between moving bubbles and sector treemap
- rising/falling zones, hover focus, touch/click selection, and stock/sector/event views
- A-share index tape with US, Japan, and Korea reference indices
- LangGraph market-fact agent with optional Qwen refinement, typed evidence, and visible trace
- Docker Compose development/deployment baseline
- GitHub Actions CI and GHCR-to-K3s production deployment
- backend contract/service tests and desktop/mobile Playwright tests

No feature in this repository should be interpreted as investment advice. FinMate does not place trades or make personalized buy/sell recommendations.

## Quick start

### Docker Compose

```bash
docker compose up --build
```

Open `http://localhost:8080`. The API documentation is available at `http://localhost:8000/docs`.

The running local demo is also available at `http://127.0.0.1:8080` after the Compose stack starts.

### Local development

Backend:

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

OpenRouter is optional. Copy the settings from `.env.example` into the ignored root `.env`
and set `OPENROUTER_API_KEY`. The default primary model is
`qwen/qwen3.5-flash-02-23`, with `deepseek/deepseek-v3.2` as the configured fallback.
Without a key, the deterministic Agent remains fully usable.

Quality checks:

```bash
cd backend
.venv/Scripts/python -m ruff check .
.venv/Scripts/python -m pytest --cov=app
.venv/Scripts/python scripts/run_agent_evals.py

cd ../frontend
npm run build
npm run test:e2e
```

For the running Compose site, set `PLAYWRIGHT_BASE_URL=http://localhost:8080` when running
browser tests. The Agent browser checks make short real model calls; backend unit tests
explicitly disable credentials. `/api/v1/agent/status` reports configuration without secrets.

Use one serving stack per port. Running Vite on IPv4 port 8080 alongside Docker's IPv6
port 8080 can make `localhost` resolve to a stale container. Rebuild with
`docker compose up -d --build --wait` after edits when using the Compose site.

## Production deployment

The production release uses GitHub Actions to build SHA-tagged backend and frontend images,
publish them to GHCR, and roll them out to the existing K3s cluster. Domain routing remains
on the existing `finmate` Service, Traefik Ingress, and Let's Encrypt certificate.

See [the deployment runbook](deploy/README.md) for the one-time server and GitHub setup,
deployment, smoke test, and rollback commands. The first public release is intentionally
stateless; persistence for in-app conversations and feedback is planned for a later version.

## Data behavior

`MARKET_PROVIDER=auto` is the default. The overview requests a turnover-ranked slice of
the full A-share universe, caches the selected membership, and sends about 180 active stocks
to the browser. Visible quotes refresh in batches every three seconds; the membership is
reselected every five minutes. The UI states both the displayed count and the upstream
universe total so the visualization is not mistaken for the query boundary.

Stock search, quote, profile, and K-line tools remain on-demand and are not limited to the
visualization pool. Eastmoney is attempted first for ranking and industry metadata, Sina is
the live ranking fallback, and the bundled fixed snapshot is used only when both live paths
are unavailable. `MARKET_PROVIDER=demo` remains available for deterministic tests.

## Agent behavior

`POST /api/v1/agent/query` runs a LangGraph workflow for market summaries and stock
snapshots. Market numbers and comparisons are always calculated deterministically. When
OpenRouter is configured, Qwen receives only the question, deterministic draft, and typed
evidence; it produces a concise cited explanation and cannot replace the underlying facts.
Timeouts or provider errors return the deterministic answer instead of failing the request.

## Documentation

- [Product and architecture](docs/product-and-architecture.md)
- [Architecture decisions](docs/decisions.md)
- [Interview engineering log](docs/engineering-log.md)
- [Feature, design, and tradeoff notes](docs/feature-decisions-v2.md)
- [UI implementation prompt](docs/ui-generation-prompt.md)
