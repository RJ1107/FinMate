import { useEffect, useMemo, useState } from "react";
import { Clock3, ExternalLink, Newspaper, RefreshCw } from "lucide-react";

import type { MarketNewsItem } from "../types";

interface Props {
  items: MarketNewsItem[];
  loading: boolean;
}

export function MarketNews({ items, loading }: Props) {
  const [page, setPage] = useState(0);
  const pageSize = 6;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const visibleItems = useMemo(
    () => items.slice(page * pageSize, page * pageSize + pageSize),
    [items, page],
  );

  useEffect(() => {
    setPage(0);
  }, [items]);

  return (
    <section className="market-news" aria-label="市场新闻">
      <div className="market-news__heading">
        <div><Newspaper size={17} /><span><strong>市场新闻</strong><small>为 Agent 检索准备的实时资讯语料</small></span></div>
        <div className="market-news__controls">
          <span>第 {Math.min(page + 1, pageCount)} / {pageCount} 组 · 共 {items.length} 条</span>
          <button
            type="button"
            disabled={loading || items.length <= pageSize}
            onClick={() => setPage((current) => (current + 1) % pageCount)}
          >
            <RefreshCw size={13} />换一换
          </button>
        </div>
      </div>
      {loading ? <div className="market-news__loading">正在读取市场新闻…</div> : items.length ? (
        <div className="market-news__grid">
          {visibleItems.map((item) => (
            <article key={item.news_id}>
              <span><Clock3 size={12} />{formatNewsTime(item.published_at)} · {item.source}</span>
              <h3>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.headline}<ExternalLink size={12} /></a> : item.headline}</h3>
              <p>{item.summary}</p>
            </article>
          ))}
        </div>
      ) : <div className="market-news__loading">新闻源暂不可用，请稍后刷新</div>}
    </section>
  );
}

function formatNewsTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}
