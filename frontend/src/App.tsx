import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Building2,
  Clock3,
  Database,
  Globe2,
  LayoutGrid,
  MessageCircle,
  Orbit,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

import { getIndustrySectors, getLiveQuotes, getMarketOverview, getSectorDetail, getStockDetail, searchStocks } from "./api";
import { AgentPanel } from "./components/AgentPanel";
import { LimitBoard } from "./components/LimitBoard";
import { MarketMap } from "./components/MarketMap";
import type { MarketEntityMode } from "./components/MarketMap";
import { MarketHeatmap } from "./components/MarketHeatmap";
import { PaperTrading } from "./components/PaperTrading";
import { StockPanel } from "./components/StockPanel";
import { StockExplorer } from "./components/StockExplorer";
import { UserProfile } from "./components/UserProfile";
import { getLimitStocks } from "./marketLimits";
import { loadUserProfile, updateProfileFromConversation, type UserProfileData } from "./userProfile";
import type { IndexQuote, MarketOverview, SectorSnapshot, StockDetail, StockQuote, StockSearchItem } from "./types";

function App() {
  const [overview, setOverview] = useState<MarketOverview | null>(null);
  const [selected, setSelected] = useState<StockQuote | null>(null);
  const [selectedSectorName, setSelectedSectorName] = useState<string | null>(null);
  const [sectorDetail, setSectorDetail] = useState<SectorSnapshot | null>(null);
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StockSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [explorerSymbol, setExplorerSymbol] = useState<string | null>(null);
  const [liveObservedAt, setLiveObservedAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [activeSection, setActiveSection] = useState<"market" | "analysis" | "profile">("market");
  const [paperOpen, setPaperOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfileData>(loadUserProfile);
  const [clock, setClock] = useState(() => new Date());
  const [entityMode, setEntityMode] = useState<MarketEntityMode>(() => {
    try { return localStorage.getItem("finmate.market-entity") === "sectors" ? "sectors" : "stocks"; }
    catch { return "stocks"; }
  });
  const [mapMode, setMapMode] = useState<"bubbles" | "heatmap">(() => {
    try { return localStorage.getItem("finmate.market-view") === "heatmap" ? "heatmap" : "bubbles"; }
    catch { return "bubbles"; }
  });

  const changeMapMode = (mode: "bubbles" | "heatmap") => {
    setMapMode(mode);
    try { localStorage.setItem("finmate.market-view", mode); } catch { /* Storage can be disabled. */ }
  };

  const changeEntityMode = (mode: MarketEntityMode) => {
    setEntityMode(mode);
    if (mode === "sectors") setQuery("");
    try { localStorage.setItem("finmate.market-entity", mode); } catch { /* Storage can be disabled. */ }
  };

  const marketSession = useMemo(() => getMarketSession(clock), [clock]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const updateActiveSection = () => {
      const sections = ["market", "analysis", "profile"] as const;
      const current = sections.reduce<(typeof sections)[number]>((active, id) => {
        const section = document.getElementById(id);
        return section && section.getBoundingClientRect().top <= window.innerHeight * 0.42 ? id : active;
      }, "market");
      setActiveSection(current);
    };
    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    return () => window.removeEventListener("scroll", updateActiveSection);
  }, [overview]);

  useEffect(() => {
    try { localStorage.setItem("finmate.user-profile.v1", JSON.stringify(userProfile)); }
    catch { /* Storage can be disabled. */ }
  }, [userProfile]);

  const loadOverview = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getMarketOverview(refresh);
      setOverview(result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "市场数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      void getMarketOverview(true).then(setOverview).catch(() => undefined);
    }, 300_000);
    return () => window.clearInterval(timer);
  }, []);

  const watchSymbols = useMemo(
    () => overview?.sectors.flatMap((sector) => sector.stocks.map((stock) => stock.symbol)).join(",") ?? "",
    [overview],
  );

  useEffect(() => {
    if (!watchSymbols) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const batch = await getLiveQuotes(watchSymbols.split(","));
          if (active) {
            setOverview((current) => current ? mergeQuotes(current, batch.quotes) : current);
            setSelected((current) => {
              if (!current) return current;
              const update = batch.quotes.find((item) => item.symbol === current.symbol);
              return update ? { ...current, ...update, sector: current.sector } : current;
            });
            setDetail((current) => {
              if (!current) return current;
              const update = batch.quotes.find((item) => item.symbol === current.quote.symbol);
              return update ? { ...current, quote: { ...current.quote, ...update, sector: current.quote.sector } } : current;
            });
            setLiveObservedAt(batch.observed_at); setLiveError(false);
          }
        } catch { if (active) setLiveError(true); }
      }
      if (active) timer = window.setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [watchSymbols]);

  useEffect(() => {
    if (entityMode !== "sectors") return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      if (!document.hidden) {
        try {
          const sectors = await getIndustrySectors();
          if (active) setOverview((current) => current ? { ...current, industry_sectors: sectors } : current);
        } catch { /* Keep the most recent industry values when the upstream pauses. */ }
      }
      if (active) timer = window.setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [entityMode]);

  useEffect(() => {
    const value = query.trim();
    if (!value || value === "全部" || overview?.sectors.some((sector) => sector.name === value)) {
      setSuggestions([]); setSearching(false); return;
    }
    let active = true;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchStocks(value).then((items) => { if (active) setSuggestions(items); })
        .catch(() => { if (active) setSuggestions([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 280);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, overview?.sectors]);

  useEffect(() => {
    const symbol = selected?.symbol;
    if (!symbol) return;
    let active = true;
    setDetailLoading(true);
    void getStockDetail(symbol)
      .then((result) => {
        if (active) setDetail(result);
      })
      .catch(() => {
        if (active) setDetail(null);
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected?.symbol]);

  const filteredOverview = useMemo(() => {
    if (!overview || !query.trim()) return overview;
    const normalized = query.trim().toLowerCase();
    return {
      ...overview,
      sectors: overview.sectors
        .map((sector) => ({
          ...sector,
          stocks: sector.stocks.filter(
            (stock) =>
              stock.name.toLowerCase().includes(normalized) ||
              stock.symbol.toLowerCase().includes(normalized) ||
              stock.sector.toLowerCase().includes(normalized),
          ),
        }))
        .filter((sector) => sector.stocks.length > 0),
    };
  }, [overview, query]);

  const industryOverview = useMemo(() => {
    if (!overview) return null;
    const generic = new Set(["A股", "沪市主板", "深市主板", "创业板", "科创板", "北交所"]);
    const sectors = overview.industry_sectors?.length
      ? overview.industry_sectors
      : overview.sectors.filter((sector) => !generic.has(sector.name));
    return { ...overview, sectors };
  }, [overview]);

  const selectedSector = useMemo(
    () => sectorDetail?.name === selectedSectorName ? sectorDetail
      : [...(industryOverview?.sectors ?? []), ...(overview?.sectors ?? [])]
        .find((sector) => sector.name === (selectedSectorName ?? selected?.sector)) ?? (selected ? {
      name: selected.sector, change_percent: selected.change_percent,
      turnover_billion_cny: selected.turnover_million_cny / 1000, stocks: [selected], news: [],
    } : null),
    [industryOverview, overview, sectorDetail, selected, selectedSectorName],
  );

  useEffect(() => {
    if (!query.trim() || !filteredOverview) return;
    const matches = filteredOverview.sectors.flatMap((sector) => sector.stocks);
    if (matches.length === 1 && matches[0].symbol !== selected?.symbol) {
      setSelected(matches[0]);
      setSelectedSectorName(null);
    }
  }, [filteredOverview, query, selected?.symbol]);

  const focusSector = (name: string) => {
    if (!overview) return;
    changeEntityMode("stocks");
    setQuery(name);
    setSelected(null);
    setDetail(null);
    setSelectedSectorName(name);
  };

  const chooseStock = (stock: StockQuote) => {
    setSelected(stock);
    setSelectedSectorName(null);
    setSectorDetail(null);
  };

  const chooseSector = (sector: SectorSnapshot) => {
    setQuery("");
    setSelected(null);
    setDetail(null);
    setSelectedSectorName(sector.name);
    setSectorDetail(sector);
    if (!sector.sector_id || sector.stocks.length) return;
    setDetailLoading(true);
    void getSectorDetail(sector.sector_id, sector.name)
      .then((result) => setSectorDetail(result))
      .catch(() => setError(`暂时无法读取${sector.name}成分股`))
      .finally(() => setDetailLoading(false));
  };

  const retryLastError = () => {
    setError(null);
    if (selectedSectorName && sectorDetail?.sector_id) {
      chooseSector(sectorDetail);
      return;
    }
    void loadOverview(true);
  };

  const chooseSearchResult = async (item: StockSearchItem) => {
    changeEntityMode("stocks");
    setSuggestions([]); setQuery("");
    try {
      const result = await getStockDetail(item.symbol);
      setDetail(result); setSelected(result.quote); setSelectedSectorName(null); setExplorerSymbol(item.symbol);
    } catch { setError(`无法读取 ${item.name} 的行情`); }
  };

  const displayOverview = entityMode === "sectors" ? industryOverview : filteredOverview;
  const limitStocks = useMemo(() => overview ? getLimitStocks(overview) : { up: [], down: [] }, [overview]);
  const marketTitle = entityMode === "stocks"
    ? mapMode === "bubbles" ? "个股涨跌碰撞云图" : "个股行情云图"
    : mapMode === "bubbles" ? "概念板块涨跌碰撞云图" : "概念板块行情云图";

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FinMate 市场工作台">
          <span className="brand-mark"><BarChart3 size={19} /></span>
          <span className="brand-word">FinMate<small>A-SHARE INTELLIGENCE</small></span>
        </a>
        <nav aria-label="主导航">
          <a className={"nav-link" + (activeSection === "market" ? " nav-link--active" : "")} href="#market" onClick={() => setActiveSection("market")}>
            <Activity size={14} />市场脉搏
          </a>
          <a className={"nav-link" + (activeSection === "analysis" ? " nav-link--active" : "")} href="#analysis" onClick={() => setActiveSection("analysis")}>
            <MessageCircle size={14} />HeyFinmate
          </a>
          <a className={"nav-link" + (activeSection === "profile" ? " nav-link--active" : "")} href="#profile" onClick={() => setActiveSection("profile")}>
            <UserRound size={14} />用户画像
          </a>
       </nav>
       <div className="topbar-actions">
         <button
            className="icon-button"
            type="button"
            title="刷新市场数据"
            aria-label="刷新市场数据"
            disabled={loading}
            onClick={() => void loadOverview(true)}
          >
            <RefreshCw className={loading ? "spin" : ""} size={18} />
          </button>
        </div>
      </header>

      <aside className="side-rail" aria-label="交易工具">
        <button
          className={paperOpen ? "side-rail__button side-rail__button--active" : "side-rail__button"}
          type="button"
          title="打开模拟盘"
          aria-label="打开模拟盘"
          aria-pressed={paperOpen}
          onClick={() => setPaperOpen((value) => !value)}
        >
          <WalletCards size={18} />
          <span>模拟盘</span>
        </button>
      </aside>

      <main id="top">
        <section className="market-header" id="market">
          <div>
            <span className="eyebrow">CHINA A-SHARE MARKET</span>
            <h1>实时大盘云图</h1>
            <p>用涨跌方向、波动幅度与板块聚集观察当前市场结构</p>
          </div>
          {overview && (
            <div className={"timestamp market-session market-session--" + marketSession.tone}>
              <Clock3 size={15} />
              <span>北京时间 {formatMarketTime(clock.toISOString())}</span>
              <strong>{marketSession.label}</strong>
            </div>
          )}
        </section>

        {error && (
          <div className="error-banner" role="alert" onAnimationEnd={() => setError(null)}>
            <AlertCircle size={18} />
            <span>{error}</span>
            <div className="error-banner__actions">
              <button type="button" onClick={retryLastError}>重试</button>
              <button className="error-banner__close" type="button" title="关闭提示" aria-label="关闭提示" onClick={() => setError(null)}>
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {loading && !overview ? (
          <MarketSkeleton />
        ) : overview && filteredOverview && displayOverview ? (
          <>
            {overview.provenance.fallback_reason && (
              <div className="data-notice">
                <Database size={16} />
                <span>实时行情暂不可用，当前显示最近一次可用行情。</span>
              </div>
            )}

            <section className="index-board" aria-label="A 股及全球参考指数">
              <IndexRow label="A 股指数" indices={overview.indices} />
              <IndexRow label="全球参考" indices={overview.reference_indices} icon={<Globe2 size={14} />} compact />
            </section>

            <section className="metric-strip" aria-label="市场指标">
              <Metric label="活跃池上涨" value={`${overview.metrics.advancers} 家`} tone="up" icon={<TrendingUp size={17} />} />
              <Metric label="活跃池下跌" value={`${overview.metrics.decliners} 家`} tone="down" icon={<TrendingDown size={17} />} />
              <Metric
                label="涨停 / 跌停"
                value={`${limitStocks.up.length} / ${limitStocks.down.length}`}
                onClick={() => setLimitOpen(true)}
              />
              <Metric label="成交额" value={`¥${(overview.metrics.turnover_billion_cny * 10).toFixed(1)} 亿`} />
              <Metric label="市场情绪" value={`${overview.metrics.sentiment_score.toFixed(0)} / 100`} tone={overview.metrics.sentiment_score >= 50 ? "up" : "down"} />
            </section>

            <section className={selected || selectedSectorName ? "workspace" : "workspace workspace--map-only"}>
              <div className="map-area">
                <div className="section-heading">
                  <div>
                    <span className="section-kicker">MARKET PULSE</span>
                    <h2>{marketTitle}</h2>
                  </div>
                  <div className="map-tools">
                    <div className="entity-switch" role="group" aria-label="展示对象">
                      <button type="button" aria-pressed={entityMode === "stocks"} onClick={() => changeEntityMode("stocks")}>
                        <BarChart3 size={14} />个股
                      </button>
                      <button type="button" aria-pressed={entityMode === "sectors"} onClick={() => changeEntityMode("sectors")}>
                        <Building2 size={14} />板块
                      </button>
                    </div>
                    <div className="view-switch" role="group" aria-label="云图视图">
                      <button type="button" title="碰撞小球" aria-label="碰撞小球" aria-pressed={mapMode === "bubbles"} onClick={() => changeMapMode("bubbles")}><Orbit size={16} /></button>
                      <button type="button" title="矩形云图" aria-label="矩形云图" aria-pressed={mapMode === "heatmap"} onClick={() => changeMapMode("heatmap")}><LayoutGrid size={16} /></button>
                    </div>
                  <div className="market-search-wrap">
                    <label className="market-search">
                      <Search size={16} aria-hidden="true" />
                      <span className="sr-only">搜索全部 A 股、代码或板块</span>
                      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索全部 A 股或代码" autoComplete="off" />
                      {searching && <span className="search-spinner" aria-label="正在搜索" />}
                      {query && <button type="button" title="清除筛选" aria-label="清除筛选" onClick={() => setQuery("")}><X size={14} /></button>}
                    </label>
                    {suggestions.length > 0 && <div className="search-suggestions" role="listbox" aria-label="A 股搜索结果">
                      {suggestions.map((item) => <button key={`${item.market}-${item.symbol}`} type="button" role="option" onClick={() => void chooseSearchResult(item)}>
                        <span><strong>{item.name}</strong><small>{item.symbol}</small></span><em>{item.market}</em>
                      </button>)}
                    </div>}
                  </div>
                  </div>
                </div>

                {entityMode === "stocks" && (
                  <div className="sector-filter" aria-label="板块筛选">
                    <button className={!query ? "sector-filter__active" : undefined} type="button" onClick={() => setQuery("")}>全部</button>
                    {overview.sectors.map((sector) => (
                      <button
                        className={query === sector.name ? "sector-filter__active" : undefined}
                        type="button"
                        key={sector.name}
                        onClick={() => focusSector(sector.name)}
                      >
                        {sector.name}
                        <span className={sector.change_percent >= 0 ? "value--up" : "value--down"}>{formatSigned(sector.change_percent)}%</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="map-frame">
                  {displayOverview.sectors.length ? (
                    mapMode === "bubbles" ? <MarketMap
                      overview={displayOverview}
                      entityMode={entityMode}
                      selectedSymbol={selected?.symbol ?? null}
                      selectedSector={selectedSectorName ?? selected?.sector ?? null}
                      onStockSelect={chooseStock}
                      onSectorSelect={chooseSector}
                    /> : <MarketHeatmap
                      overview={displayOverview}
                      entityMode={entityMode}
                      selectedSymbol={selected?.symbol ?? null}
                      selectedSector={selectedSectorName ?? selected?.sector ?? null}
                      onStockSelect={chooseStock}
                      onSectorSelect={chooseSector}
                    />
                  ) : (
                    <div className="empty-search">没有匹配的股票或板块</div>
                  )}
                </div>
                <div className="map-legend" aria-label="云图编码说明">
                  <span className={liveError ? "live-feed live-feed--error" : "live-feed"}><i />{liveError ? "实时行情暂缓" : `3 秒更新${liveObservedAt ? ` · ${formatClock(liveObservedAt)}` : ""}`}</span>
                  <span><i className="legend-dot legend-dot--size" />{mapMode === "bubbles"
                    ? "大小 · 涨跌幅绝对值"
                    : entityMode === "sectors" ? "面积 · 涨跌幅绝对值（平滑）" : "面积 · 成交活跃度（平滑）"}</span>
                  <span title={overview.selection_method ?? undefined}>
                    {entityMode === "stocks"
                      ? mapMode === "bubbles"
                        ? `碰撞图显示 ${Math.min(96, displayOverview.sectors.flatMap((sector) => sector.stocks).length)} / 活跃池 ${displayOverview.sectors.flatMap((sector) => sector.stocks).length} 只`
                        : `展示 ${displayOverview.sectors.flatMap((sector) => sector.stocks).length}${overview.universe_total ? ` / 全市场 ${overview.universe_total}` : ""} 只`
                      : `${displayOverview.sectors.length} 个活跃概念`}
                  </span>
                  <span><i className="legend-dot legend-dot--up" />上涨</span>
                  <span><i className="legend-dot legend-dot--down" />下跌</span>
                </div>
              </div>

              {(selected || selectedSectorName) && selectedSector && (
                <StockPanel
                  selected={selected}
                  detail={detail}
                  sector={selectedSector}
                  loading={detailLoading}
                  contextMode={selectedSectorName ? "sector" : "stock"}
                  onExpand={() => selected && setExplorerSymbol(selected.symbol)}
                  onCollapse={() => { setSelected(null); setDetail(null); setSelectedSectorName(null); setSectorDetail(null); }}
                  onSelectStock={chooseStock}
                />
              )}
            </section>

            <AgentPanel onConversation={(question) => {
              setUserProfile((current) => updateProfileFromConversation(current, question));
            }} />
            <UserProfile profile={userProfile} onChange={setUserProfile} />

            <footer className="app-footer">
              <span>行情每 3 秒自动更新</span>
              <span>FinMate 研究辅助，不构成投资建议</span>
            </footer>
          </>
        ) : null}
      </main>
      {explorerSymbol && <StockExplorer symbol={explorerSymbol} initialQuote={selected?.symbol === explorerSymbol ? selected : undefined} onClose={() => setExplorerSymbol(null)} />}
      <PaperTrading open={paperOpen} onClose={() => setPaperOpen(false)} />
      {overview && <LimitBoard open={limitOpen} overview={overview} onClose={() => setLimitOpen(false)} onSelectStock={chooseStock} />}
    </div>
  );
}

function IndexRow({ label, indices, icon, compact = false }: { label: string; indices: IndexQuote[]; icon?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? "index-row index-row--compact" : "index-row"}>
      <div className="index-row__label">{icon}{label}</div>
      <div className="index-row__items">
        {indices.map((index) => (
          <div className="index-item" key={`${index.market}-${index.symbol}`}>
            <span>{index.name}<small>{index.market}</small></span>
            <strong>{index.price.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}</strong>
            <em className={index.change_percent >= 0 ? "value--up" : "value--down"}>
              {formatSigned(index.change_percent)}%
            </em>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone, icon, onClick }: { label: string; value: string; tone?: "up" | "down"; icon?: React.ReactNode; onClick?: () => void }) {
  const content = (
    <>
      <span>{icon}{label}</span>
      <strong className={tone ? `value--${tone}` : undefined}>{value}</strong>
    </>
  );
  return onClick
    ? <button className="metric-item metric-item--button" type="button" onClick={onClick}>{content}</button>
    : <div className="metric-item">{content}</div>;
}

function MarketSkeleton() {
  return (
    <div className="skeleton-layout" aria-label="正在加载市场数据">
      <div className="skeleton skeleton--strip" />
      <div className="skeleton skeleton--metrics" />
      <div className="skeleton skeleton--map" />
    </div>
  );
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatMarketTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value));
}

function getMarketSession(value: Date): { label: string; tone: "idle" | "live" | "break" | "after" | "closed" } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  if (weekday === "Sat" || weekday === "Sun") return { label: "已收盘", tone: "closed" };
  const minutes = hour * 60 + minute;
  if (minutes < 570) return { label: "未开盘", tone: "idle" };
  if (minutes < 690) return { label: "正在交易", tone: "live" };
  if (minutes < 780) return { label: "午间收盘", tone: "break" };
  if (minutes < 900) return { label: "正在交易", tone: "live" };
  if (minutes < 930) return { label: "盘后交易", tone: "after" };
  return { label: "已收盘", tone: "closed" };
}

function mergeQuotes(overview: MarketOverview, quotes: StockQuote[]): MarketOverview {
  const updates = new Map(quotes.map((quote) => [quote.symbol, quote]));
  return {
    ...overview,
    sectors: overview.sectors.map((sector) => {
      const stocks = sector.stocks.map((stock) => {
        const update = updates.get(stock.symbol);
        return update ? { ...stock, ...update, sector: stock.sector } : stock;
      });
      return {
        ...sector, stocks,
        change_percent: Number((stocks.reduce((sum, stock) => sum + stock.change_percent, 0) / Math.max(stocks.length, 1)).toFixed(2)),
        turnover_billion_cny: Number((stocks.reduce((sum, stock) => sum + stock.turnover_million_cny, 0) / 1000).toFixed(2)),
      };
    }),
  };
}

export default App;
