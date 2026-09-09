from datetime import UTC, datetime

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
def liveness() -> dict[str, str]:
    return {"status": "ok", "timestamp": datetime.now(UTC).isoformat()}


@router.get("/ready")
def readiness() -> dict[str, str]:
    return {"status": "ready", "timestamp": datetime.now(UTC).isoformat()}
