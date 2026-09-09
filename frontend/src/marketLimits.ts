import type { MarketOverview, StockQuote } from "./types";

export function getLimitStocks(overview: MarketOverview) {
  const unique = new Map<string, StockQuote>();
  overview.sectors.flatMap((sector) => sector.stocks)
    .forEach((stock) => unique.set(stock.symbol, stock));
  const stocks = [...unique.values()];
  return {
    up: stocks.filter((stock) => stock.change_percent >= limitThreshold(stock)),
    down: stocks.filter((stock) => stock.change_percent <= -limitThreshold(stock)),
  };
}

function limitThreshold(stock: StockQuote) {
  if (/ST/i.test(stock.name)) return 4.8;
  if (/^(300|301|688)/.test(stock.symbol)) return 19.8;
  if (/^(4|8|92)/.test(stock.symbol)) return 29.8;
  return 9.8;
}
