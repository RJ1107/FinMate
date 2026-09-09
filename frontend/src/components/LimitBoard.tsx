import { useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowUpToLine, X } from "lucide-react";

import { getLimitStocks } from "../marketLimits";
import type { MarketOverview, StockQuote } from "../types";

interface Props {
  open: boolean;
  overview: MarketOverview;
  onClose: () => void;
  onSelectStock: (stock: StockQuote) => void;
}

export function LimitBoard({ open, overview, onClose, onSelectStock }: Props) {
  const [side, setSide] = useState<"up" | "down">("up");
  const limits = useMemo(() => getLimitStocks(overview), [overview]);
  const stocks = limits[side].sort((a, b) =>
    Math.abs(b.change_percent) - Math.abs(a.change_percent) ||
    b.turnover_million_cny - a.turnover_million_cny
  );

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("modal-open");
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", close);
    return () => {
      document.body.classList.remove("modal-open");
      document.removeEventListener("keydown", close);
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <>
      <button className="limit-backdrop" type="button" aria-label="关闭涨跌停榜单" onClick={onClose} />
      <aside className="limit-drawer" aria-label="涨停跌停榜单">
        <header>
          <div>
            <span>PRICE LIMIT</span>
            <h2>涨停 / 跌停</h2>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="limit-switch" role="tablist" aria-label="涨跌停方向">
          <button type="button" role="tab" aria-selected={side === "up"} onClick={() => setSide("up")}>
            <ArrowUpToLine size={15} />涨停 <strong>{limits.up.length}</strong>
          </button>
          <button type="button" role="tab" aria-selected={side === "down"} onClick={() => setSide("down")}>
            <ArrowDownToLine size={15} />跌停 <strong>{limits.down.length}</strong>
          </button>
        </div>
        <p className="limit-note">当前成交额活跃池，按 A 股不同板块价格限制识别</p>
        <div className="limit-list">
          {stocks.length ? stocks.map((stock, index) => (
            <button key={stock.symbol} type="button" onClick={() => { onSelectStock(stock); onClose(); }}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><strong>{stock.name}</strong><small>{stock.symbol} · {stock.sector}</small></div>
              <em className={side === "up" ? "value--up" : "value--down"}>
                {stock.change_percent >= 0 ? "+" : ""}{stock.change_percent.toFixed(2)}%
              </em>
            </button>
          )) : (
            <div className="limit-empty">当前活跃池暂无{side === "up" ? "涨停" : "跌停"}股票</div>
          )}
        </div>
      </aside>
    </>
  );
}
