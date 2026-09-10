import type {
  AgentAnswer, AgentStatus, DailyQuotaStatus, MarketNewsItem, MarketOverview, MarketPulse, QuoteBatch, SeriesInterval,
  SectorSnapshot, StockDetail, StockProfile, StockSearchItem, StockSeries,
} from "./types";
import type { UserProfileData } from "./userProfile";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function apiError(response: Response, fallback: string) {
  let detail: string | { message?: string; code?: string } | undefined;
  try { detail = (await response.json() as { detail?: typeof detail }).detail; } catch { /* Empty error body. */ }
  const message = typeof detail === "string" ? detail : detail?.message ?? fallback;
  return new ApiError(message, response.status, typeof detail === "object" ? detail?.code : undefined);
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw await apiError(response, `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw await apiError(response, `请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getMarketOverview(refresh = false): Promise<MarketOverview> {
  return request(`/market/overview${refresh ? "?refresh=true" : ""}`);
}

export function getMarketPulse(refresh = false): Promise<MarketPulse> {
  return request(`/market/pulse${refresh ? "?refresh=true" : ""}`);
}

export function getMarketNews(query = "", limit = 8): Promise<MarketNewsItem[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (query.trim()) params.set("q", query.trim());
  return request(`/market/news?${params.toString()}`);
}

export function getStockDetail(symbol: string): Promise<StockDetail> {
  return request(`/market/stocks/${encodeURIComponent(symbol)}`);
}

export function getSectorDetail(sectorId: string, name: string): Promise<SectorSnapshot> {
  return request(`/market/sectors/${encodeURIComponent(sectorId)}?name=${encodeURIComponent(name)}&limit=40`);
}

export function getIndustrySectors(): Promise<SectorSnapshot[]> {
  return request("/market/sectors");
}

export function queryAgent(question: string, clientId: string, conversationId: string): Promise<AgentAnswer> {
  return post("/agent/query", { question, client_id: clientId, conversation_id: conversationId });
}

export function getDailyQuota(clientId: string): Promise<DailyQuotaStatus> {
  return request(`/memory/quota/${encodeURIComponent(clientId)}`);
}

export function saveUserProfile(
  clientId: string,
  profile: UserProfileData,
): Promise<{ quota: DailyQuotaStatus }> {
  return fetch(`${API_BASE}/memory/profile/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  }).then((response) => {
    if (!response.ok) return apiError(response, `用户画像保存失败 (${response.status})`).then((error) => { throw error; });
    return response.json();
  });
}

export function savePortfolio(clientId: string, portfolio: unknown) {
  return fetch(`${API_BASE}/memory/portfolio/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(portfolio),
  }).then((response) => {
    if (!response.ok) throw new Error(`模拟组合保存失败 (${response.status})`);
    return response.json();
  });
}

export function getAgentStatus(): Promise<AgentStatus> {
  return request("/agent/status");
}

export function searchStocks(query: string): Promise<StockSearchItem[]> {
  return request(`/market/search?q=${encodeURIComponent(query)}&limit=8`);
}

export async function getLiveQuotes(symbols: string[]): Promise<QuoteBatch> {
  const unique = [...new Set(symbols.filter(Boolean))];
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += 80) {
    chunks.push(unique.slice(index, index + 80));
  }
  const batches = await Promise.all(chunks.map((chunk) =>
    request<QuoteBatch>(`/market/quotes?symbols=${encodeURIComponent(chunk.join(","))}`),
  ));
  const latest = batches.reduce(
    (value, batch) => batch.observed_at > value ? batch.observed_at : value,
    batches[0]?.observed_at ?? new Date().toISOString(),
  );
  return {
    quotes: batches.flatMap((batch) => batch.quotes),
    source: batches
      .map((batch) => batch.source)
      .filter((value, index, all) => all.indexOf(value) === index)
      .join("+"),
    observed_at: latest,
  };
}

export function getStockProfile(symbol: string): Promise<StockProfile> {
  return request(`/market/stocks/${encodeURIComponent(symbol)}/profile`);
}

export function getStockSeries(symbol: string, interval: SeriesInterval): Promise<StockSeries> {
  return request(`/market/stocks/${encodeURIComponent(symbol)}/series?interval=${interval}`);
}
