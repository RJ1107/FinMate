# FinMate: Dark Dual-View Update

Date: 2026-09-08

## Delivered behavior

- Near-black page and charcoal detail/Agent surfaces, with A-share red-up/green-down colors.
- Moving collision bubbles by default; a small two-icon view selector sits beside search.
- The alternative rectangular treemap groups stocks by sector and encodes turnover by area.
- Both views share search, sector filters, and stock/sector/event details. View choice survives reload.
- Bubbles continue moving after initial arrangement. Pointer inspection pauses motion and
  enlarges the focused stock; leaving resumes it. Hidden tabs pause; reduced-motion is respected.
- OpenRouter Qwen answers market questions and financial concepts. The UI distinguishes
  configured, responding, successfully responded, and failed states, and displays the returned model.
- Failed model calls retain market facts with an explicit failure message.

## Why localhost showed the old UI

The local Vite and FastAPI servers were bound to IPv4 while an older FinMate Docker stack
published the same ports on IPv6. A successful HTTP status therefore did not establish that
the browser was seeing the current bundle. The duplicate local processes were stopped and
both FinMate containers rebuilt. localhost, 127.0.0.1 and ::1 now return the same asset hash.
Caddy requires cache revalidation for the frontend entry and assets.

## Verification

- Backend: 18 tests passed, with real model credentials disabled in unit tests.
- Frontend lint and production build passed.
- Desktop/mobile browser suite: 16 checks passed on http://localhost:8080.
- The suite covers persisted switching, tile selection, Canvas selection, continued motion,
  dark page background, horizontal overflow, real model success and mocked provider failure.
- Two real browser model calls and one short financial-concept API call returned Qwen model responses.
- OpenRouter account usage increased by USD 0.000113945 during this validation window.
- The final search-width adjustment passed four focused desktop/mobile rendering and switching checks.
- Final deployed frontend asset: `/assets/index-BQCFstPN.js`.
- Docker Compose services are healthy. All local address variants return the updated site.

Market and news data remain explicitly labeled demonstration snapshots. Live ingestion and
document retrieval remain separate follow-up work; no market data was made live by connecting Qwen.
