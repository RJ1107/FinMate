import type {
  AgentAnswer, AgentStatus, MarketOverview, QuoteBatch, SeriesInterval,
  SectorSnapshot, StockDetail, StockProfile, StockSearchItem, StockSeries,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`请求失败 (${response.status})`);
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
    throw new Error(`请求失败 (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getMarketOverview(refresh = false): Promise<MarketOverview> {
  return request(`/market/overview${refresh ? "?refresh=true" : ""}`);
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

export function queryAgent(question: string): Promise<AgentAnswer> {
  return post("/agent/query", { question });
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
