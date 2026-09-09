import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BarChart3,
  Building2,
  CircleDollarSign,
  Layers3,
  Newspaper,
  Maximize2,
  PanelRightClose,
} from "lucide-react";

import type { SectorSnapshot, StockDetail, StockQuote } from "../types";

interface StockPanelProps {
  selected: StockQuote | null;
  detail: StockDetail | null;
  sector: SectorSnapshot | null;
  loading: boolean;
  contextMode: "stock" | "sector";
  onExpand: () => void;
  onCollapse: () => void;
  onSelectStock: (stock: StockQuote) => void;
}

type DetailTab = "stock" | "sector" | "news";

export function StockPanel({ selected, detail, sector, loading, contextMode, onExpand, onCollapse, onSelectStock }: StockPanelProps) {
  const [tab, setTab] = useState<DetailTab>("stock");

  useEffect(() => setTab(contextMode), [contextMode, selected?.symbol, sector?.name]);

  if (!sector) return null;

  const quote = detail?.quote ?? selected ?? null;

  return (
    <aside className="stock-panel">
      <div className="stock-panel__heading">
        <div>
          <span className="stock-symbol">{quote ? `${quote.symbol} · ${quote.sector}` : "概念板块"}</span>
          <h2>{quote?.name ?? sector.name}</h2>
        </div>
        <div className="stock-panel__actions">
          <span className={(quote?.change_percent ?? sector.change_percent) >= 0 ? "quote-pill quote-pill--up" : "quote-pill quote-pill--down"}>
            {formatSigned(quote?.change_percent ?? sector.change_percent)}%
          </span>
          {quote && <button type="button" className="expand-stock" title="展开 K 线与个股资料" aria-label="展开 K 线与个股资料" onClick={onExpand}><Maximize2 size={15} /></button>}
          <button type="button" className="expand-stock" title="收起详情栏" aria-label="收起详情栏" onClick={onCollapse}><PanelRightClose size={15} /></button>
        </div>
      </div>

      <div className="detail-tabs" role="tablist" aria-label="行情详情视图">
        <TabButton active={tab === "stock"} disabled={!quote} icon={<Activity size={14} />} label="个股" onClick={() => setTab("stock")} />
        <TabButton active={tab === "sector"} icon={<Layers3 size={14} />} label="板块" onClick={() => setTab("sector")} />
        <TabButton active={tab === "news"} icon={<Newspaper size={14} />} label="动态" onClick={() => setTab("news")} />
      </div>

      {tab === "stock" && quote && <StockView quote={quote} detail={detail} loading={loading} />}
      {tab === "sector" && <SectorView sector={sector} selectedSymbol={quote?.symbol ?? null} loading={loading} onSelectStock={onSelectStock} />}
      {tab === "news" && <NewsView sector={sector} />}
    </aside>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
  disabled = false,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={active ? "detail-tab detail-tab--active" : "detail-tab"}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}{label}
    </button>
  );
}

function StockView({ quote, detail, loading }: { quote: StockQuote; detail: StockDetail | null; loading: boolean }) {
  return (
    <div className="detail-view">
      <div className="quote-row">
        <span className="quote-price">¥{quote.price.toFixed(2)}</span>
        <span className="quote-caption">最新行情</span>
      </div>

      <dl className="stock-facts" aria-busy={loading}>
        <div>
          <dt><CircleDollarSign size={15} /> 成交额</dt>
          <dd>¥{(quote.turnover_million_cny / 100).toFixed(2)} 亿</dd>
        </div>
        <div>
          <dt><Building2 size={15} /> 总市值</dt>
          <dd>{quote.market_cap_billion_cny ? `¥${quote.market_cap_billion_cny.toFixed(1)} 亿` : "暂无"}</dd>
        </div>
        <div>
          <dt><Activity size={15} /> 相对板块</dt>
          <dd className={(detail?.relative_to_sector_percent ?? 0) >= 0 ? "value--up" : "value--down"}>
            {detail ? `${formatSigned(detail.relative_to_sector_percent)}%` : "计算中"}
          </dd>
        </div>
        <div>
          <dt><BarChart3 size={15} /> 板块排名</dt>
          <dd>{detail ? `${detail.rank_in_sector} / ${detail.sector_size}` : "计算中"}</dd>
        </div>
      </dl>

      <div className="fact-note">
        <span>市场事实</span>
        <p>
          {quote.name} 当前{quote.change_percent >= 0 ? "上涨" : "下跌"}{Math.abs(quote.change_percent).toFixed(2)}%，
          {detail
            ? `相对${quote.sector}板块${detail.relative_to_sector_percent >= 0 ? "强" : "弱"}${Math.abs(detail.relative_to_sector_percent).toFixed(2)}个百分点。`
            : "正在读取板块对比。"}
        </p>
      </div>
    </div>
  );
}

function SectorView({ sector, selectedSymbol, loading, onSelectStock }: { sector: SectorSnapshot; selectedSymbol: string | null; loading: boolean; onSelectStock: (stock: StockQuote) => void }) {
  const stats = useMemo(() => {
    const sorted = [...sector.stocks].sort((left, right) => right.change_percent - left.change_percent);
    return {
      rising: sector.stocks.filter((stock) => stock.change_percent >= 0).length,
      falling: sector.stocks.filter((stock) => stock.change_percent < 0).length,
      constituents: sorted,
    };
  }, [sector]);

  return (
    <div className="detail-view">
      <div className="sector-overview">
        <div>
          <span>板块涨跌</span>
          <strong className={sector.change_percent >= 0 ? "value--up" : "value--down"}>
            {formatSigned(sector.change_percent)}%
          </strong>
        </div>
        <div>
          <span>已载入成分股</span>
          <strong>{loading ? "读取中" : `${stats.rising} 涨 / ${stats.falling} 跌`}</strong>
        </div>
        <div>
          <span>成交额</span>
          <strong>¥{(sector.turnover_billion_cny * 10).toFixed(2)} 亿</strong>
        </div>
      </div>

      <h3 className="detail-subheading">
        成分股涨跌 · {stats.constituents.length}{sector.constituent_count ? ` / ${sector.constituent_count}` : ""} 只
      </h3>
      <ol className="leader-list">
        {stats.constituents.map((stock, index) => (
          <li className={stock.symbol === selectedSymbol ? "leader-list__selected" : undefined} key={stock.symbol}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <button type="button" title={`查看 ${stock.name}`} onClick={() => onSelectStock(stock)}>
              <strong>{stock.name}</strong><small>{stock.symbol}</small>
            </button>
            <em className={stock.change_percent >= 0 ? "value--up" : "value--down"}>
              {formatSigned(stock.change_percent)}%
            </em>
          </li>
        ))}
        {!stats.constituents.length && <li className="leader-list__empty">{loading ? "正在读取成交额靠前的成分股" : "暂无可用成分股行情"}</li>}
      </ol>
    </div>
  );
}

function NewsView({ sector }: { sector: SectorSnapshot }) {
  return (
    <div className="detail-view">
      <div className="news-context">
        <span>关联动态</span>
        <strong>{sector.name}</strong>
      </div>
      <div className="news-list">
        {sector.news.length ? sector.news.map((item) => (
          <article key={item.news_id}>
            <div className="news-meta">
              <time>{formatTime(item.published_at)}</time>
            </div>
            {item.url
              ? <a className="news-headline" href={item.url} target="_blank" rel="noreferrer"><h3>{item.headline}</h3></a>
              : <h3>{item.headline}</h3>}
            <p>{item.summary}</p>
            <small className="news-source">信息来源：{item.source}</small>
          </article>
        )) : <p className="empty-evidence">暂未检索到相关板块动态。</p>}
      </div>
    </div>
  );
}

function formatSigned(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
