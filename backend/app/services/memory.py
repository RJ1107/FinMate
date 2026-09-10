from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from app.domain.memory import (
    ConversationMessage,
    DailyQuotaStatus,
    PortfolioPayload,
    PortfolioRecord,
    UserProfilePayload,
    UserProfileRecord,
)
from app.domain.models import MarketNewsItem

AGENT_DAILY_LIMIT = 20
PROFILE_DAILY_LIMIT = 2
SHANGHAI = ZoneInfo("Asia/Shanghai")


class MemoryStore:
    """PostgreSQL-backed memory store with a bounded connection pool."""

    def __init__(self, database_dsn: str) -> None:
        self._pool = ConnectionPool(
            conninfo=database_dsn,
            min_size=1,
            max_size=8,
            open=False,
            kwargs={"autocommit": True, "row_factory": dict_row},
        )
        self._pool.open(wait=True, timeout=10)
        with self._pool.connection() as connection:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS user_profiles (
                    client_id VARCHAR(64) PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS conversation_messages (
                    id BIGSERIAL PRIMARY KEY,
                    client_id VARCHAR(64) NOT NULL,
                    conversation_id VARCHAR(64) NOT NULL,
                    role VARCHAR(16) NOT NULL CHECK(role IN ('user', 'assistant')),
                    content TEXT NOT NULL,
                    request_id VARCHAR(64),
                    created_at TIMESTAMPTZ NOT NULL
                )
            """)
            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_messages_conversation
                ON conversation_messages(client_id, conversation_id, id DESC)
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS news_documents (
                    news_id VARCHAR(128) PRIMARY KEY,
                    headline TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    source VARCHAR(120) NOT NULL,
                    published_at TIMESTAMPTZ NOT NULL,
                    url TEXT,
                    indexed_at TIMESTAMPTZ NOT NULL
                )
            """)
            connection.execute("""
                CREATE INDEX IF NOT EXISTS idx_news_published
                ON news_documents(published_at DESC)
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS portfolios (
                    client_id VARCHAR(64) PRIMARY KEY,
                    payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE IF NOT EXISTS daily_usage (
                    client_id VARCHAR(64) NOT NULL,
                    usage_date DATE NOT NULL,
                    agent_queries INTEGER NOT NULL DEFAULT 0 CHECK(agent_queries >= 0),
                    profile_updates INTEGER NOT NULL DEFAULT 0 CHECK(profile_updates >= 0),
                    PRIMARY KEY(client_id, usage_date)
                )
            """)

    def close(self) -> None:
        self._pool.close()

    def upsert_profile(self, client_id: str, profile: UserProfilePayload) -> UserProfileRecord:
        now = datetime.now(UTC)
        with self._pool.connection() as connection:
            connection.execute(
                """INSERT INTO user_profiles(client_id, payload, updated_at) VALUES (%s, %s, %s)
                ON CONFLICT(client_id) DO UPDATE SET payload=excluded.payload,
                updated_at=excluded.updated_at""",
                (client_id, Jsonb(profile.model_dump(mode="json")), now),
            )
        return UserProfileRecord(client_id=client_id, profile=profile, updated_at=now)

    def upsert_profile_limited(
        self, client_id: str, profile: UserProfilePayload
    ) -> tuple[UserProfileRecord, DailyQuotaStatus] | None:
        now = datetime.now(UTC)
        usage_date = datetime.now(SHANGHAI).date()
        with self._pool.connection() as connection, connection.transaction():
            current = connection.execute(
                "SELECT payload, updated_at FROM user_profiles WHERE client_id=%s FOR UPDATE",
                (client_id,),
            ).fetchone()
            if current is not None and _profile_content(current["payload"]) == _profile_content(
                profile.model_dump(mode="json")
            ):
                record = UserProfileRecord(
                    client_id=client_id,
                    profile=UserProfilePayload.model_validate(current["payload"]),
                    updated_at=current["updated_at"],
                )
                return record, self._quota_status(connection, client_id, usage_date)
            quota = self._consume_quota(connection, client_id, usage_date, "profile_updates")
            if quota is None:
                return None
            connection.execute(
                """INSERT INTO user_profiles(client_id, payload, updated_at) VALUES (%s, %s, %s)
                ON CONFLICT(client_id) DO UPDATE SET payload=excluded.payload,
                updated_at=excluded.updated_at""",
                (client_id, Jsonb(profile.model_dump(mode="json")), now),
            )
        return UserProfileRecord(
            client_id=client_id, profile=profile, updated_at=now
        ), quota

    def get_daily_quota(self, client_id: str) -> DailyQuotaStatus:
        usage_date = datetime.now(SHANGHAI).date()
        with self._pool.connection() as connection:
            return self._quota_status(connection, client_id, usage_date)

    def consume_agent_query(self, client_id: str) -> DailyQuotaStatus | None:
        usage_date = datetime.now(SHANGHAI).date()
        with self._pool.connection() as connection:
            return self._consume_quota(connection, client_id, usage_date, "agent_queries")

    def _consume_quota(
        self, connection, client_id: str, usage_date: date, column: str
    ) -> DailyQuotaStatus | None:
        if column not in {"agent_queries", "profile_updates"}:
            raise ValueError("Unsupported quota column")
        limit = AGENT_DAILY_LIMIT if column == "agent_queries" else PROFILE_DAILY_LIMIT
        agent_initial = 1 if column == "agent_queries" else 0
        profile_initial = 1 if column == "profile_updates" else 0
        row = connection.execute(
            f"""INSERT INTO daily_usage
            (client_id, usage_date, agent_queries, profile_updates)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT(client_id, usage_date) DO UPDATE
            SET {column}=daily_usage.{column} + 1
            WHERE daily_usage.{column} < %s
            RETURNING agent_queries, profile_updates""",
            (client_id, usage_date, agent_initial, profile_initial, limit),
        ).fetchone()
        if row is None:
            return None
        return _quota_record(client_id, usage_date, row)

    def _quota_status(
        self, connection, client_id: str, usage_date: date
    ) -> DailyQuotaStatus:
        row = connection.execute(
            """SELECT agent_queries, profile_updates FROM daily_usage
            WHERE client_id=%s AND usage_date=%s""",
            (client_id, usage_date),
        ).fetchone()
        return _quota_record(
            client_id,
            usage_date,
            row or {"agent_queries": 0, "profile_updates": 0},
        )

    def get_profile(self, client_id: str) -> UserProfileRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                "SELECT payload, updated_at FROM user_profiles WHERE client_id=%s", (client_id,)
            ).fetchone()
        if row is None:
            return None
        return UserProfileRecord(
            client_id=client_id,
            profile=UserProfilePayload.model_validate(row["payload"]),
            updated_at=row["updated_at"],
        )

    def upsert_portfolio(self, client_id: str, portfolio: PortfolioPayload) -> PortfolioRecord:
        now = datetime.now(UTC)
        with self._pool.connection() as connection:
            connection.execute(
                """INSERT INTO portfolios(client_id, payload, updated_at) VALUES (%s, %s, %s)
                ON CONFLICT(client_id) DO UPDATE SET payload=excluded.payload,
                updated_at=excluded.updated_at""",
                (client_id, Jsonb(portfolio.model_dump(mode="json")), now),
            )
        return PortfolioRecord(client_id=client_id, portfolio=portfolio, updated_at=now)

    def get_portfolio(self, client_id: str) -> PortfolioRecord | None:
        with self._pool.connection() as connection:
            row = connection.execute(
                "SELECT payload, updated_at FROM portfolios WHERE client_id=%s", (client_id,)
            ).fetchone()
        if row is None:
            return None
        return PortfolioRecord(
            client_id=client_id,
            portfolio=PortfolioPayload.model_validate(row["payload"]),
            updated_at=row["updated_at"],
        )

    def add_turn(
        self, client_id: str, conversation_id: str, question: str, answer: str, request_id: str
    ) -> None:
        now = datetime.now(UTC)
        with (
            self._pool.connection() as connection,
            connection.transaction(),
            connection.cursor() as cursor,
        ):
            cursor.executemany(
                """INSERT INTO conversation_messages
                (client_id, conversation_id, role, content, request_id, created_at)
                VALUES (%s, %s, %s, %s, %s, %s)""",
                [
                    (client_id, conversation_id, "user", question, request_id, now),
                    (client_id, conversation_id, "assistant", answer, request_id, now),
                ],
            )

    def recent_messages(
        self, client_id: str, conversation_id: str, limit: int = 8
    ) -> list[ConversationMessage]:
        with self._pool.connection() as connection:
            rows = connection.execute(
                """SELECT role, content, created_at FROM conversation_messages
                WHERE client_id=%s AND conversation_id=%s ORDER BY id DESC LIMIT %s""",
                (client_id, conversation_id, limit),
            ).fetchall()
        return [ConversationMessage(**row) for row in reversed(rows)]

    def ingest_news(self, items: list[MarketNewsItem]) -> None:
        if not items:
            return
        now = datetime.now(UTC)
        rows = [(
            item.news_id, item.headline, item.summary, item.source,
            item.published_at, item.url, now,
        ) for item in items]
        with self._pool.connection() as connection, connection.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO news_documents
                (news_id, headline, summary, source, published_at, url, indexed_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT(news_id) DO UPDATE SET headline=excluded.headline,
                summary=excluded.summary, source=excluded.source,
                published_at=excluded.published_at, url=excluded.url,
                indexed_at=excluded.indexed_at""",
                rows,
            )


def _quota_record(client_id: str, usage_date: date, row) -> DailyQuotaStatus:
    agent_used = int(row["agent_queries"])
    profile_used = int(row["profile_updates"])
    return DailyQuotaStatus(
        client_id=client_id,
        usage_date=usage_date,
        agent_used=agent_used,
        agent_limit=AGENT_DAILY_LIMIT,
        agent_remaining=max(0, AGENT_DAILY_LIMIT - agent_used),
        profile_used=profile_used,
        profile_limit=PROFILE_DAILY_LIMIT,
        profile_remaining=max(0, PROFILE_DAILY_LIMIT - profile_used),
    )


def _profile_content(payload: dict) -> dict:
    return {key: value for key, value in payload.items() if key != "updatedAt"}


def render_memory_context(
    profile: UserProfileRecord | None,
    messages: list[ConversationMessage],
    portfolio: PortfolioRecord | None = None,
) -> str:
    parts: list[str] = []
    if profile:
        value = profile.profile
        parts.append(
            "用户明确保存的长期画像："
            f"收入={value.income}；经验={value.experience}；风险承受={value.risk}；"
            f"最大回撤={value.drawdown}；期限={value.horizon}；目标={value.goal}；"
            f"流动性={value.liquidity}；关注={','.join(value.interests) or '未填写'}；"
            f"补充={value.supplement or '无'}"
        )
    if portfolio:
        value = portfolio.portfolio
        positions = "、".join(
            f"{item.name}({item.symbol}) {item.shares}股/成本{item.avgCost:.2f}元"
            for item in value.positions
        ) or "无持仓"
        parts.append(
            "当前模拟组合（长期状态）："
            f"初始资金={value.initialCash:.2f}元；可用资金={value.cash:.2f}元；持仓={positions}"
        )
    if messages:
        compact = [f"{item.role}: {item.content[:240]}" for item in messages]
        parts.append("当前会话最近几轮（短期记忆）：\n" + "\n".join(compact))
    return "\n".join(parts)
