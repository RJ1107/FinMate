import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Check,
  Pencil,
  Search,
  ShoppingCart,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

import { getLiveQuotes, savePortfolio, searchStocks } from "../api";
import type { StockQuote, StockSearchItem } from "../types";

interface Position {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  lastPrice: number;
  changePercent?: number;
}

interface Ledger {
  initialCash: number;
  cash: number;
  positions: Position[];
}

interface Props {
  open: boolean;
  clientId: string;
  onClose: () => void;
}

const STORAGE_KEY = "finmate.paper-ledger.v1";
const INITIAL_CASH = 1_000_000;

export function PaperTrading({ open, clientId, onClose }: Props) {
  const [ledger, setLedger] = useState<Ledger>(loadLedger);
  const [capitalInput, setCapitalInput] = useState(() => String(loadLedger().initialCash));
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<StockSearchItem[]>([]);
  const [selected, setSelected] = useState<StockQuote | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [priceMode, setPriceMode] = useState<"live" | "custom">("live");
  const [customPrice, setCustomPrice] = useState("");
  const [shares, setShares] = useState("100");
  const [message, setMessage] = useState("选择股票后即可开始模拟交易");
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [costInput, setCostInput] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger)); } catch { /* Storage may be disabled. */ }
    const timer = window.setTimeout(() => {
      void savePortfolio(clientId, ledger).catch(() => {
        if (open) setMessage("组合已保存在本机，但数据库同步暂时失败");
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [clientId, ledger, open]);

  useEffect(() => {
    if (!open) return;
    document.body.classList.add("paper-trading-open");
    return () => document.body.classList.remove("paper-trading-open");
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void searchStocks(query.trim())
        .then((items) => { if (active) setSuggestions(items); })
        .catch(() => { if (active) setSuggestions([]); });
    }, 260);
    return () => { active = false; window.clearTimeout(timer); };
  }, [open, query]);

  const trackedSymbols = useMemo(() => {
    const symbols = ledger.positions.map((position) => position.symbol);
    if (selected && !symbols.includes(selected.symbol)) symbols.push(selected.symbol);
    return symbols;
  }, [ledger.positions, selected]);
  const trackedKey = trackedSymbols.join(",");

  useEffect(() => {
    if (!open || !trackedKey) return;
    let active = true;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const batch = await getLiveQuotes(trackedKey.split(","));
        if (!active) return;
        const quotes = new Map(batch.quotes.map((quote) => [quote.symbol, quote]));
        setLedger((current) => ({
          ...current,
          positions: current.positions.map((position) => {
            const quote = quotes.get(position.symbol);
            return quote ? {
              ...position,
              lastPrice: quote.price,
              changePercent: quote.change_percent,
            } : position;
          }),
        }));
        setSelected((current) => {
          if (!current) return current;
          const quote = quotes.get(current.symbol);
          return quote ? { ...current, ...quote } : current;
        });
      } catch {
        setMessage("实时价格暂不可用，仍可切换为自定义价格");
      }
      if (active) timer = window.setTimeout(refresh, 3000);
    };
    void refresh();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [open, trackedKey]);

  const marketValue = ledger.positions.reduce(
    (sum, position) => sum + position.lastPrice * position.shares,
    0,
  );
  const totalAssets = ledger.cash + marketValue;

  const chooseStock = async (item: StockSearchItem) => {
    setBusy(true);
    setSuggestions([]);
    setQuery(item.name + " " + item.symbol);
    try {
      const batch = await getLiveQuotes([item.symbol]);
      const quote = batch.quotes[0];
      if (!quote) throw new Error("empty quote");
      setSelected({ ...quote, name: quote.name || item.name });
      setCustomPrice(quote.price.toFixed(2));
      setMessage("已读取实时行情，模拟委托不会发送到券商");
    } catch {
      setSelected(null);
      setMessage("无法读取该股票价格，请重新搜索");
    } finally {
      setBusy(false);
    }
  };

  const execute = () => {
    if (!selected) {
      setMessage("请先搜索并选择一只股票");
      return;
    }
    const quantity = Math.floor(Number(shares));
    const price = priceMode === "live" ? selected.price : Number(customPrice);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(price) || price <= 0) {
      setMessage("请输入有效的价格和股数");
      return;
    }
    const amount = price * quantity;
    const existing = ledger.positions.find((position) => position.symbol === selected.symbol);
    if (side === "buy" && amount > ledger.cash) {
      setMessage("可用资金不足，无法完成本次模拟买入");
      return;
    }
    if (side === "sell" && (!existing || existing.shares < quantity)) {
      setMessage("持仓股数不足，无法完成本次模拟卖出");
      return;
    }

    setLedger((current) => {
      const currentPosition = current.positions.find((position) => position.symbol === selected.symbol);
      if (side === "buy") {
        const oldShares = currentPosition?.shares ?? 0;
        const nextShares = oldShares + quantity;
        const nextPosition: Position = {
          symbol: selected.symbol,
          name: selected.name,
          shares: nextShares,
          avgCost: ((currentPosition?.avgCost ?? 0) * oldShares + amount) / nextShares,
          lastPrice: selected.price,
          changePercent: selected.change_percent,
        };
        return {
          initialCash: current.initialCash,
          cash: current.cash - amount,
          positions: currentPosition
            ? current.positions.map((position) => position.symbol === selected.symbol ? nextPosition : position)
            : [...current.positions, nextPosition],
        };
      }
      const nextShares = (currentPosition?.shares ?? 0) - quantity;
      return {
        initialCash: current.initialCash,
        cash: current.cash + amount,
        positions: nextShares === 0
          ? current.positions.filter((position) => position.symbol !== selected.symbol)
          : current.positions.map((position) =>
              position.symbol === selected.symbol ? {
                ...position,
                shares: nextShares,
                lastPrice: selected.price,
                changePercent: selected.change_percent,
              } : position
            ),
      };
    });
    setMessage(
      (side === "buy" ? "模拟买入 " : "模拟卖出 ")
      + selected.name + " " + quantity + " 股，成交价 ¥" + price.toFixed(2),
    );
  };

  const reset = () => {
    if (!window.confirm(`确定清空模拟持仓并恢复 ¥${formatMoney(ledger.initialCash)} 初始资金吗？`)) return;
    setLedger({ initialCash: ledger.initialCash, cash: ledger.initialCash, positions: [] });
    setCapitalInput(String(ledger.initialCash));
    setMessage("模拟账户已重置");
  };

  const removePosition = (position: Position) => {
    if (!window.confirm(`确定删除 ${position.name}（${position.symbol}）这笔持仓吗？`)) return;
    setLedger((current) => ({
      ...current,
      positions: current.positions.filter((item) => item.symbol !== position.symbol),
    }));
    setEditingSymbol(null);
    setMessage(`已删除 ${position.name} 持仓；可用资金保持不变`);
  };

  const startEditingCost = (position: Position) => {
    setEditingSymbol(position.symbol);
    setCostInput(position.avgCost.toFixed(2));
  };

  const savePositionCost = (position: Position) => {
    const value = Number(costInput);
    if (!Number.isFinite(value) || value < 0) {
      setMessage("持仓成本必须是大于或等于 0 的有效金额");
      return;
    }
    const rounded = roundMoney(value);
    setLedger((current) => ({
      ...current,
      positions: current.positions.map((item) =>
        item.symbol === position.symbol ? { ...item, avgCost: rounded } : item
      ),
    }));
    setEditingSymbol(null);
    setMessage(`已将 ${position.name} 的持仓成本更新为 ¥${formatMoney(rounded)}`);
  };

  const applyInitialCapital = () => {
    const value = Number(capitalInput);
    if (!capitalInput.trim() || !Number.isFinite(value) || value < 0) {
      setMessage("初始资金必须是大于或等于 0 的有效金额");
      return;
    }
    const rounded = roundMoney(value);
    const hasActivity = ledger.positions.length > 0 || Math.abs(ledger.cash - ledger.initialCash) > 0.01;
    if (hasActivity && !window.confirm("修改初始资金会清空当前持仓和交易结果，是否继续？")) return;
    setLedger({ initialCash: rounded, cash: rounded, positions: [] });
    setCapitalInput(rounded.toFixed(2));
    setMessage(`初始资金已设为 ¥${formatMoney(rounded)}`);
  };

  if (!open) return null;

  return (
    <>
      <button className="paper-backdrop" type="button" aria-label="关闭模拟盘" onClick={onClose} />
      <aside className="paper-drawer" aria-label="模拟盘" aria-modal="true" role="dialog">
        <header className="paper-header">
          <div>
            <WalletCards size={19} />
            <span><strong>模拟盘</strong><small>本机练习账户</small></span>
          </div>
          <button className="paper-icon-button" type="button" title="关闭" aria-label="关闭模拟盘" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <section className="paper-summary" aria-label="账户概览">
          <div><span>总资产</span><strong>¥{formatMoney(totalAssets)}</strong></div>
          <div><span>可用资金</span><strong>¥{formatMoney(ledger.cash)}</strong></div>
          <div><span>持仓市值</span><strong>¥{formatMoney(marketValue)}</strong></div>
        </section>

        <section className="paper-capital" aria-label="初始资金设置">
          <label>
            <span>初始资金</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={capitalInput}
              onChange={(event) => setCapitalInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") applyInitialCapital(); }}
            />
          </label>
          <button type="button" onClick={applyInitialCapital}>应用</button>
        </section>

        <section className="paper-order">
          <div className="paper-search-wrap">
            <label className="paper-search">
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索股票名称或代码"
                autoComplete="off"
              />
            </label>
            {suggestions.length > 0 && (
              <div className="paper-suggestions">
                {suggestions.map((item) => (
                  <button key={item.market + "-" + item.symbol} type="button" onClick={() => void chooseStock(item)}>
                    <span>{item.name}<small>{item.symbol}</small></span><em>{item.market}</em>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="paper-selection">
            {selected ? (
              <>
                <span><strong>{selected.name}</strong><small>{selected.symbol}</small></span>
                <em className={selected.change_percent >= 0 ? "value--up" : "value--down"}>
                  ¥{selected.price.toFixed(2)} · {(selected.change_percent >= 0 ? "+" : "") + selected.change_percent.toFixed(2)}%
                </em>
              </>
            ) : <span>{busy ? "正在读取行情..." : "尚未选择股票"}</span>}
          </div>

          <div className="paper-segment" role="group" aria-label="交易方向">
            <button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>买入</button>
            <button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>卖出</button>
          </div>

          <div className="paper-price-mode" role="group" aria-label="成交价格方式">
            <button type="button" aria-pressed={priceMode === "live"} onClick={() => setPriceMode("live")}>实时价格</button>
            <button type="button" aria-pressed={priceMode === "custom"} onClick={() => setPriceMode("custom")}>自定义价格</button>
          </div>

          <div className="paper-fields">
            <label>
              <span>成交价格</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={priceMode === "live" ? selected?.price.toFixed(2) ?? "" : customPrice}
                disabled={priceMode === "live"}
                onChange={(event) => setCustomPrice(event.target.value)}
              />
            </label>
            <label>
              <span>股数</span>
              <input type="number" min="1" step="100" value={shares} onChange={(event) => setShares(event.target.value)} />
            </label>
          </div>

          <button
            className={"paper-submit paper-submit--" + side}
            type="button"
            disabled={!selected || busy}
            onClick={execute}
          >
            {side === "buy" ? <ShoppingCart size={16} /> : <BadgeDollarSign size={16} />}
            {side === "buy" ? "模拟买入" : "模拟卖出"}
          </button>
          <p className="paper-message" aria-live="polite">{message}</p>
        </section>

        <section className="paper-positions">
          <div className="paper-section-title">
            <span>持仓 <em>{ledger.positions.length}</em></span>
            <button type="button" title="重置模拟账户" aria-label="重置模拟账户" onClick={reset}><Trash2 size={14} /></button>
          </div>
          {ledger.positions.length === 0 ? (
            <div className="paper-empty">暂无持仓</div>
          ) : (
            <div className="paper-position-list">
              {ledger.positions.map((position) => {
                const profit = (position.lastPrice - position.avgCost) * position.shares;
                const profitRate = position.avgCost > 0
                  ? (position.lastPrice / position.avgCost - 1) * 100
                  : null;
                const dailyChangeAmount = position.changePercent == null || position.changePercent <= -100
                  ? null
                  : position.lastPrice * position.shares
                    * position.changePercent / (100 + position.changePercent);
                return (
                  <article key={position.symbol}>
                    <header>
                      <span><strong>{position.name}</strong><small>{position.symbol}</small></span>
                      <span className="paper-position-actions">
                        <button type="button" title="修改持仓成本" aria-label={`修改 ${position.name} 持仓成本`} onClick={() => startEditingCost(position)}><Pencil size={13} /></button>
                        <button type="button" title="删除该持仓" aria-label={`删除 ${position.name} 持仓`} onClick={() => removePosition(position)}><Trash2 size={13} /></button>
                      </span>
                    </header>
                    {editingSymbol === position.symbol ? (
                      <div className="paper-cost-editor">
                        <label><span>每股成本</span><input autoFocus type="number" min="0" step="0.01" value={costInput} onChange={(event) => setCostInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") savePositionCost(position); if (event.key === "Escape") setEditingSymbol(null); }} /></label>
                        <button type="button" title="保存成本" aria-label="保存持仓成本" onClick={() => savePositionCost(position)}><Check size={14} /></button>
                        <button type="button" title="取消修改" aria-label="取消修改持仓成本" onClick={() => setEditingSymbol(null)}><X size={14} /></button>
                      </div>
                    ) : <div>
                      <span>{position.shares} 股 · 成本 ¥{position.avgCost.toFixed(2)}</span>
                      <span className="paper-position-market">
                        <b>现价 ¥{position.lastPrice.toFixed(2)}</b>
                        <small className={position.changePercent == null ? undefined : position.changePercent >= 0 ? "value--up" : "value--down"}>
                          当日 {position.changePercent == null
                            ? "--"
                            : (position.changePercent >= 0 ? "+" : "") + position.changePercent.toFixed(2) + "%"
                              + (dailyChangeAmount == null ? "" : " · "
                                + (dailyChangeAmount >= 0 ? "+¥" : "-¥")
                                + formatMoney(Math.abs(dailyChangeAmount)))}
                        </small>
                      </span>
                    </div>}
                    <em className={profit >= 0 ? "value--up" : "value--down"}>
                      {(profit >= 0 ? "+" : "") + formatMoney(profit)} ({profitRate == null ? "成本为 0" : (profitRate >= 0 ? "+" : "") + profitRate.toFixed(2) + "%"})
                    </em>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </aside>
    </>
  );
}

function loadLedger(): Ledger {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) return { initialCash: INITIAL_CASH, cash: INITIAL_CASH, positions: [] };
    const parsed = JSON.parse(value) as Partial<Ledger>;
    if (!Number.isFinite(parsed.cash) || !Array.isArray(parsed.positions)) throw new Error("invalid ledger");
    return {
      initialCash: Number.isFinite(parsed.initialCash) ? parsed.initialCash as number : INITIAL_CASH,
      cash: parsed.cash as number,
      positions: parsed.positions.map((position) => ({
        symbol: position.symbol,
        name: position.name,
        shares: position.shares,
        avgCost: position.avgCost,
        lastPrice: position.lastPrice,
      })),
    };
  } catch {
    return { initialCash: INITIAL_CASH, cash: INITIAL_CASH, positions: [] };
  }
}

function formatMoney(value: number) {
  return value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
