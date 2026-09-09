import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, createChart, type CandlestickData, type LineData, type Time, type UTCTimestamp } from "lightweight-charts";
import { Building2, CalendarDays, Clock3, LoaderCircle, X } from "lucide-react";

import { getStockDetail, getStockProfile, getStockSeries } from "../api";
import type { Candle, SeriesInterval, StockDetail, StockProfile, StockQuote, StockSeries } from "../types";

const intervals: Array<{ value: SeriesInterval; label: string }> = [
  { value: "intraday", label: "分时" }, { value: "five_day", label: "五日" },
  { value: "daily", label: "日K" }, { value: "weekly", label: "周K" }, { value: "monthly", label: "月K" },
];

export function StockExplorer({ symbol, initialQuote, onClose }: { symbol: string; initialQuote?: StockQuote; onClose: () => void }) {
  const [interval, setInterval] = useState<SeriesInterval>("intraday");
  const [detail, setDetail] = useState<StockDetail | null>(null);
  const [profile, setProfile] = useState<StockProfile | null>(null);
  const [series, setSeries] = useState<StockSeries | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.body.classList.add("modal-open");
    window.addEventListener("keydown", escape);
    return () => { document.body.classList.remove("modal-open"); window.removeEventListener("keydown", escape); };
  }, [onClose]);

  useEffect(() => {
    let active = true;
    void getStockDetail(symbol).then((nextDetail) => { if (active) setDetail(nextDetail); }).catch(() => undefined);
    void getStockProfile(symbol).then((nextProfile) => { if (active) setProfile(nextProfile); }).catch(() => undefined);
    return () => { active = false; };
  }, [symbol]);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void getStockSeries(symbol, interval).then((value) => { if (active) setSeries(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "K 线数据加载失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [symbol, interval]);

  const quote = detail?.quote ?? initialQuote;
  return (
    <div className="stock-explorer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="stock-explorer" role="dialog" aria-modal="true" aria-label={`${quote?.name ?? symbol} 个股行情`}>
        <header className="explorer-header">
          <div><span>{symbol} · {profile?.industry ?? quote?.sector ?? "A股"}</span><h2>{profile?.name ?? quote?.name ?? symbol}</h2></div>
          {quote && <div className="explorer-quote"><strong>¥{quote.price.toFixed(2)}</strong><em className={quote.change_percent >= 0 ? "value--up" : "value--down"}>{signed(quote.change_percent)}%</em></div>}
          <button className="icon-button" type="button" title="关闭个股行情" aria-label="关闭个股行情" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="explorer-body">
          <div className="chart-column">
            <div className="series-tabs" role="tablist" aria-label="K 线周期">
              {intervals.map((item) => <button key={item.value} type="button" role="tab" aria-selected={interval === item.value} onClick={() => setInterval(item.value)}>{item.label}</button>)}
              {series && <span><i className={series.is_realtime ? "live-dot" : ""} />更新 {formatTime(series.observed_at)}</span>}
            </div>
            <div className="stock-chart-shell">
              {loading && <div className="chart-state"><LoaderCircle className="spin" size={20} />读取{intervals.find((item) => item.value === interval)?.label}</div>}
              {!loading && error && <div className="chart-state chart-state--error">{error}</div>}
              {!loading && series && <StockChart series={series} />}
            </div>
          </div>
          <aside className="profile-column">
            <h3><Building2 size={15} /> 个股资料</h3>
            <ProfileRow label="所属行业" value={profile?.industry} />
            <ProfileRow label="上市日期" value={profile?.listing_date} icon={<CalendarDays size={13} />} />
            <ProfileRow label="总股本" value={shares(profile?.total_shares)} />
            <ProfileRow label="流通股" value={shares(profile?.float_shares)} />
            <ProfileRow label="总市值" value={money(profile?.market_cap_billion_cny)} />
            <ProfileRow label="流通市值" value={money(profile?.float_market_cap_billion_cny)} />
            <div className="profile-source"><Clock3 size={13} /><span>{profile ? `资料更新 ${formatTime(profile.observed_at)}` : "正在读取资料"}</span></div>
          </aside>
        </div>
      </section>
    </div>
  );
}

function StockChart({ series }: { series: StockSeries }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<CandleInfo | null>(null);
  const isMinute = series.interval === "intraday" || series.interval === "five_day";
  const latest = candleInfo(series.candles, series.candles.length - 1);
  const shown = hovered ?? latest;
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setHovered(null);
    const chart = createChart(host, {
      width: host.clientWidth, height: host.clientHeight,
      layout: { background: { type: ColorType.Solid, color: "#0b0d10" }, textColor: "#89939e", fontFamily: "Inter Variable, Microsoft YaHei" },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time: Time) => isMinute ? formatShanghaiTime(time, true) : formatShanghaiTime(time, false),
      },
      grid: { vertLines: { color: "#1d2126" }, horzLines: { color: "#1d2126" } },
      rightPriceScale: { borderColor: "#30363d" },
      timeScale: {
        borderColor: "#30363d",
        timeVisible: isMinute,
        secondsVisible: false,
        tickMarkFormatter: (time: Time) => isMinute
          ? formatShanghaiTick(time, series.interval)
          : formatShanghaiTime(time, false),
      },
      crosshair: { vertLine: { color: "#5d6874" }, horzLine: { color: "#5d6874" } },
    });
    if (isMinute) {
      const area = chart.addSeries(AreaSeries, { lineColor: "#f1c84b", topColor: "rgba(241,200,75,.28)", bottomColor: "rgba(241,200,75,.01)", lineWidth: 2 });
      area.setData(series.candles.map((item) => ({ time: chartTime(item.time), value: item.close })) as LineData[]);
    } else {
      const candle = chart.addSeries(CandlestickSeries, { upColor: "#d64a56", downColor: "#15966e", borderUpColor: "#e1646e", borderDownColor: "#35b489", wickUpColor: "#e1646e", wickDownColor: "#35b489" });
      candle.setData(series.candles.map((item) => ({ time: item.time.slice(0, 10), open: item.open, high: item.high, low: item.low, close: item.close })) as CandlestickData[]);
    }
    const candleIndex = new Map(
      series.candles.map((item, index) => [
        isMinute ? String(chartTime(item.time)) : item.time.slice(0, 10),
        index,
      ]),
    );
    chart.subscribeCrosshairMove((parameter) => {
      if (parameter.time == null) {
        setHovered(null);
        return;
      }
      const index = candleIndex.get(timeKey(parameter.time));
      setHovered(index == null ? null : candleInfo(series.candles, index));
    });
    chart.timeScale().fitContent();
    const observer = new ResizeObserver(([entry]) => chart.applyOptions({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(host);
    return () => { observer.disconnect(); chart.remove(); };
  }, [isMinute, series]);
  return (
    <div className={isMinute ? "stock-chart-layout stock-chart-layout--minute" : "stock-chart-layout"}>
      {shown && (
        <div className="chart-ohlc" aria-live="polite">
          <strong>{formatCandleLabel(shown.candle.time, isMinute)}</strong>
          <span>开 <b>{shown.candle.open.toFixed(2)}</b></span>
          <span>高 <b>{shown.candle.high.toFixed(2)}</b></span>
          <span>低 <b>{shown.candle.low.toFixed(2)}</b></span>
          <span>收 <b>{shown.candle.close.toFixed(2)}</b></span>
          <span className={shown.change >= 0 ? "value--up" : "value--down"}>涨跌 <b>{signed(shown.change)}%</b></span>
          <span>量 <b>{compactNumber(shown.candle.volume)}</b></span>
          {shown.candle.amount != null && <span>额 <b>¥{compactMoney(shown.candle.amount)}</b></span>}
        </div>
      )}
      <div className="stock-chart" ref={hostRef} />
      {isMinute && (
        <div className="trading-session-axis" aria-label="北京时间交易时段">
          <span>09:30 开盘</span><span>11:30 午休</span><span>13:00 午盘</span><span>15:00 收盘</span>
        </div>
      )}
    </div>
  );
}

interface CandleInfo {
  candle: Candle;
  change: number;
}

function candleInfo(candles: Candle[], index: number): CandleInfo | null {
  const candle = candles[index];
  if (!candle) return null;
  const baseline = candles[index - 1]?.close ?? candle.open;
  return { candle, change: baseline ? (candle.close / baseline - 1) * 100 : 0 };
}

function timeKey(time: Time): string {
  if (typeof time === "number" || typeof time === "string") return String(time);
  return `${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;
}

function formatCandleLabel(value: string, includeClock: boolean) {
  const date = new Date(value.replace(" ", "T") + (value.includes("T") || value.includes(" ") ? "+08:00" : "T00:00:00+08:00"));
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(includeClock ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
  }).format(date);
}

function compactNumber(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function compactMoney(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

function ProfileRow({ label, value, icon }: { label: string; value: string | null | undefined; icon?: React.ReactNode }) {
  return <div className="profile-row"><span>{icon}{label}</span><strong>{value || "暂无"}</strong></div>;
}
function chartTime(value: string): Time { return Math.floor(new Date(value.replace(" ", "T") + "+08:00").getTime() / 1000) as UTCTimestamp; }
function formatShanghaiTick(time: Time, interval: SeriesInterval) {
  const clock = formatShanghaiTime(time, true);
  if (interval === "five_day" && clock === "09:30") return `${formatShanghaiDate(time)} 开盘`;
  if (clock === "09:30") return "09:30 开盘";
  if (clock === "11:30") return "11:30 午休";
  if (clock === "13:00") return "13:00 午盘";
  if (clock === "15:00") return "15:00 收盘";
  return clock;
}
function formatShanghaiTime(time: Time, includeClock: boolean) {
  const date = timeToDate(time);
  return new Intl.DateTimeFormat("zh-CN", includeClock
    ? { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false }
    : { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(date);
}
function formatShanghaiDate(time: Time) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }).format(timeToDate(time));
}
function timeToDate(time: Time) {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(`${time.slice(0, 10)}T00:00:00+08:00`);
  return new Date(`${time.year}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}T00:00:00+08:00`);
}
function signed(value: number) { return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`; }
function money(value: number | null | undefined) { return value == null ? null : `¥${value.toLocaleString("zh-CN")} 亿`; }
function shares(value: number | null | undefined) { return value == null ? null : `${(value / 100_000_000).toFixed(2)} 亿股`; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(value)); }
