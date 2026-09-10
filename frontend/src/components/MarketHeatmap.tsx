import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, treemap } from "d3-hierarchy";

import type { MarketOverview, SectorSnapshot, StockQuote } from "../types";
import type { MarketEntityMode } from "./MarketMap";

interface VisualEntity {
  id: string;
  name: string;
  subtitle: string;
  change: number;
  weight: number;
  stock?: StockQuote;
  sector?: SectorSnapshot;
}

interface TreeDatum {
  name: string;
  entity?: VisualEntity;
  children?: TreeDatum[];
}

interface TileLayout {
  entity: VisualEntity;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface HeaderLayout {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
}

interface ZoneLayout {
  tone: "up" | "down";
  label: string;
  top: number;
  count: number;
  noun: string;
}

interface Props {
  overview: MarketOverview;
  entityMode: MarketEntityMode;
  selectedSymbol: string | null;
  selectedSector: string | null;
  onStockSelect: (stock: StockQuote) => void;
  onSectorSelect: (sector: SectorSnapshot) => void;
}

const ZONE_GAP = 12;
const ZONE_HEADER = 30;
const SECTOR_HEADER = 28;

export function MarketHeatmap({
  overview,
  entityMode,
  selectedSymbol,
  selectedSector,
  onStockSelect,
  onSectorSelect,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => {
    const tiles: TileLayout[] = [];
    const headers: HeaderLayout[] = [];
    const zones: ZoneLayout[] = [];
    if (size.width <= 0 || size.height <= 0) return { tiles, headers, zones };

    if (entityMode === "stocks") {
      const seen = new Set<string>();
      const groups = overview.sectors.map((sector) => ({
        name: sector.name,
        entities: sector.stocks.flatMap((stock) => {
          if (seen.has(stock.symbol)) return [];
          seen.add(stock.symbol);
          return [{
            id: stock.symbol,
            name: stock.name,
            subtitle: stock.symbol,
            change: stock.change_percent,
            weight: Math.sqrt(Math.max(1, stock.turnover_million_cny)),
            stock,
          }];
        }),
      })).filter((group) => group.entities.length > 0);
      const zoneHeight = Math.max(1, (size.height - ZONE_GAP) / 2);
      const definitions = [
        { tone: "up" as const, label: "上涨区  RISING", top: 0, accept: (change: number) => change >= 0 },
        { tone: "down" as const, label: "下跌区  FALLING", top: zoneHeight + ZONE_GAP, accept: (change: number) => change < 0 },
      ];
      definitions.forEach((zone) => {
        const zoneGroups = groups.map((group) => ({
          name: group.name,
          entities: group.entities.filter((entity) => zone.accept(entity.change)),
        })).filter((group) => group.entities.length > 0);
        const children: TreeDatum[] = zoneGroups.map((group) => ({
          name: group.name,
          children: group.entities.map((entity) => ({ name: entity.name, entity })),
        }));
        const count = zoneGroups.reduce((total, group) => total + group.entities.length, 0);
        zones.push({ tone: zone.tone, label: zone.label, top: zone.top, count, noun: "只个股" });
        const tree = makeTree(children, size.width, zoneHeight, ZONE_HEADER, SECTOR_HEADER);
        tree.children?.forEach((sector) => headers.push({
          id: zone.tone + ":" + sector.data.name,
          name: sector.data.name,
          x: sector.x0,
          y: sector.y0 + zone.top,
          width: Math.max(0, sector.x1 - sector.x0),
        }));
        tree.leaves().forEach((node) => {
          if (!node.data.entity) return;
          tiles.push({
            entity: node.data.entity,
            x: node.x0,
            y: node.y0 + zone.top,
            width: Math.max(0, node.x1 - node.x0),
            height: Math.max(0, node.y1 - node.y0),
          });
        });
      });
      return { tiles, headers, zones };
    }

    const entities: VisualEntity[] = overview.sectors.map((sector) => ({
      id: "sector:" + sector.name,
      name: sector.name,
      subtitle: (sector.constituent_count ?? sector.stocks.length) + " 只成分股",
      change: sector.change_percent,
      weight: Math.sqrt(Math.max(0.04, Math.abs(sector.change_percent))),
      sector,
    }));
    const zoneHeight = Math.max(1, (size.height - ZONE_GAP) / 2);
    const definitions = [
      { tone: "up" as const, label: "上涨区  RISING", top: 0, items: entities.filter((item) => item.change >= 0) },
      { tone: "down" as const, label: "下跌区  FALLING", top: zoneHeight + ZONE_GAP, items: entities.filter((item) => item.change < 0) },
    ];
    definitions.forEach((zone) => {
      zones.push({ tone: zone.tone, label: zone.label, top: zone.top, count: zone.items.length, noun: "个板块" });
      const children = zone.items.map((entity) => ({ name: entity.name, entity }));
      const tree = makeTree(children, size.width, zoneHeight, ZONE_HEADER);
      tree.leaves().forEach((node) => {
        if (!node.data.entity) return;
        tiles.push({
          entity: node.data.entity,
          x: node.x0,
          y: node.y0 + zone.top,
          width: Math.max(0, node.x1 - node.x0),
          height: Math.max(0, node.y1 - node.y0),
        });
      });
    });
    return { tiles, headers, zones };
  }, [entityMode, overview, size]);

  const selectedId = entityMode === "stocks"
    ? selectedSymbol
    : selectedSector ? "sector:" + selectedSector : null;

  const selectEntity = (entity: VisualEntity) => {
    if (entity.stock) onStockSelect(entity.stock);
    if (entity.sector) onSectorSelect(entity.sector);
  };

  return (
    <div
      className="heatmap"
      ref={hostRef}
      aria-label={entityMode === "stocks" ? "A 股个股矩形云图" : "A 股概念板块矩形云图"}
      data-up-count={layout.zones.find((zone) => zone.tone === "up")?.count ?? 0}
      data-down-count={layout.zones.find((zone) => zone.tone === "down")?.count ?? 0}
    >
      {layout.zones.length > 0 && <div className="heatmap-zone-divider" aria-hidden="true" />}
      {layout.zones.map((zone) => (
        <div
          className={"heatmap-zone-label heatmap-zone-label--" + zone.tone}
          key={zone.tone}
          style={{ top: zone.top }}
        >
          {zone.label}<small>{zone.count} {zone.noun}</small>
        </div>
      ))}
      {layout.headers.map((header) => (
        <div
          className="heatmap-sector"
          key={header.id}
          style={{ left: header.x, top: header.y, width: header.width, height: 23 }}
          title={header.name}
        >
          {header.name}
        </div>
      ))}
      {layout.tiles.map(({ entity, x, y, width, height }) => {
        const change = (entity.change >= 0 ? "+" : "") + entity.change.toFixed(2) + "%";
        const nameSize = Math.max(7, Math.min(entityMode === "sectors" ? 15 : 14, (width - 8) / entity.name.length));
        const intensity = Math.min(36, 19 + Math.abs(entity.change) * 2.6);
        const selected = selectedId === entity.id;
        return (
          <button
            key={entity.id}
            type="button"
            className={"heatmap-tile" + (selected ? " heatmap-tile--selected" : "")}
            aria-label={entity.name + " " + change}
            aria-pressed={selected}
            data-zone={entity.change >= 0 ? "up" : "down"}
            title={entity.name + " · " + change + " · " + entity.subtitle}
            style={{
              left: x,
              top: y,
              width,
              height,
              background: "hsl(" + (entity.change >= 0 ? "354 56%" : "157 58%") + " " + intensity + "%)",
            }}
            onClick={() => selectEntity(entity)}
          >
            {width >= 24 && height >= 18 && <strong style={{ fontSize: nameSize }}>{entity.name}</strong>}
            {width >= 40 && height >= 39 && <span style={{ fontSize: Math.min(13, nameSize + 1) }}>{change}</span>}
            {width >= 78 && height >= 72 && <small>{entity.subtitle}</small>}
          </button>
        );
      })}
    </div>
  );
}

function makeTree(
  children: TreeDatum[],
  width: number,
  height: number,
  paddingTop: number,
  groupPaddingTop = 3,
) {
  const root = hierarchy<TreeDatum>({ name: "A 股", children })
    .sum((item) => item.entity?.weight ?? 0)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));
  return treemap<TreeDatum>()
    .size([width, height])
    .paddingOuter(3)
    .paddingInner(3)
    .paddingTop((node) => node.depth === 0
      ? paddingTop
      : node.depth === 1 && node.children ? groupPaddingTop : 3)
    .round(true)(root);
}
