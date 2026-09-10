export type DataMode = "live" | "delayed" | "cached" | "demo";

export interface Provenance {
  source: string;
  mode: DataMode;
  observed_at: string;
  retrieved_at: string;
  market_timezone: string;
  fallback_reason: string | null;
}

export interface IndexQuote {
  symbol: string;
  name: string;
  price: number;
  change_percent: number;
  market: string;
  currency: string;
}

export interface MarketNewsItem {
  news_id: string;
  headline: string;
  summary: string;
  source: string;
  published_at: string;
  url: string | null;
}

export interface MarketMetrics {
  advancers: number;
  decliners: number;
  unchanged: number;
  limit_up: number;
  limit_down: number;
  turnover_billion_cny: number;
  sentiment_score: number;
}

export interface MarketPulseMetrics {
  advancers: number | null;
  decliners: number | null;
  unchanged: number | null;
  limit_up: number | null;
  limit_down: number | null;
  turnover_billion_cny: number | null;
  sentiment_score: number | null;
}

export interface MarketPulse {
  market: string;
  indices: IndexQuote[];
  metrics: MarketPulseMetrics;
  breadth_status: "ready" | "updating" | "unavailable";
  provenance: Provenance;
}

export interface StockQuote {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change_percent: number;
  turnover_million_cny: number;
  market_cap_billion_cny: number | null;
}

export interface SectorSnapshot {
  name: string;
  sector_id?: string | null;
  constituent_count?: number | null;
  change_percent: number;
  turnover_billion_cny: number;
  stocks: StockQuote[];
  news: MarketNewsItem[];
}

export interface MarketOverview {
  market: string;
  indices: IndexQuote[];
  reference_indices: IndexQuote[];
  metrics: MarketMetrics;
  sectors: SectorSnapshot[];
  industry_sectors?: SectorSnapshot[];
  provenance: Provenance;
  universe_total?: number | null;
  displayed_count?: number | null;
  selection_method?: string | null;
}

export interface StockDetail {
  quote: StockQuote;
  relative_to_sector_percent: number;
  rank_in_sector: number;
  sector_size: number;
  provenance: Provenance;
}

export interface StockSearchItem {
  symbol: string;
  name: string;
  market: string;
  security_type: string;
}

export interface QuoteBatch {
  quotes: StockQuote[];
  source: string;
  observed_at: string;
}

export interface StockProfile {
  symbol: string;
  name: string;
  industry: string | null;
  listing_date: string | null;
  total_shares: number | null;
  float_shares: number | null;
  market_cap_billion_cny: number | null;
  float_market_cap_billion_cny: number | null;
  source: string;
  observed_at: string;
}

export type SeriesInterval = "intraday" | "five_day" | "daily" | "weekly" | "monthly";

export interface Candle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number | null;
  average: number | null;
}

export interface StockSeries {
  symbol: string;
  interval: SeriesInterval;
  label: string;
  candles: Candle[];
  source: string;
  observed_at: string;
  is_realtime: boolean;
}

export type AgentIntent = "market_summary" | "market_news" | "stock_snapshot" | "portfolio_allocation" | "unknown";

export interface AgentStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
}

export interface DailyQuotaStatus {
  client_id: string;
  usage_date: string;
  agent_used: number;
  agent_limit: number;
  agent_remaining: number;
  profile_used: number;
  profile_limit: number;
  profile_remaining: number;
}

export interface AgentEvidence {
  evidence_id: string;
  title: string;
  value: string;
  source: string;
  observed_at: string;
}

export interface AgentTraceStep {
  node: string;
  label: string;
  summary: string;
  duration_ms: number;
}

export interface AgentAnswer {
  request_id: string;
  answer: string;
  intent: AgentIntent;
  resolved_entity: string | null;
  confidence: number;
  evidence: AgentEvidence[];
  trace: AgentTraceStep[];
  data_mode: DataMode;
  observed_at: string;
  answer_mode: "deterministic" | "model";
  model: string | null;
  daily_remaining: number | null;
  daily_limit: number;
}
