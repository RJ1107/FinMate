import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import {
  forceCollide,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";

import type { MarketOverview, SectorSnapshot, StockQuote } from "../types";

export type MarketEntityMode = "stocks" | "sectors";

interface Props {
  overview: MarketOverview;
  theme: "dark" | "light";
  entityMode: MarketEntityMode;
  selectedSymbol: string | null;
  selectedSector: string | null;
  onStockSelect: (stock: StockQuote) => void;
  onSectorSelect: (sector: SectorSnapshot) => void;
}

interface VisualEntity {
  id: string;
  name: string;
  subtitle: string;
  change: number;
  turnover: number;
  stock?: StockQuote;
  sector?: SectorSnapshot;
}

interface Crossing {
  startedAt: number;
  fromY: number;
  toY: number;
}

interface BubbleNode extends SimulationNodeDatum {
  entity: VisualEntity;
  radius: number;
  anchorX: number;
  anchorY: number;
  crossing?: Crossing;
}

interface HoverState {
  entity: VisualEntity;
  x: number;
  y: number;
}

const UP_COLORS = ["#8f2931", "#b93640", "#dc5058"];
const DOWN_COLORS = ["#09684e", "#0c8663", "#21a47b"];
export const MAX_STOCK_BUBBLES = 96;
const BOUNDARY_HALF_GAP = 12;
const COLLISION_GAP = 3;
const CROSSING_MS = 720;
const LABEL_SAFE_WIDTH = 144;
const LABEL_SAFE_HEIGHT = 48;

function canvasPixelRatio() {
  const maximum = 1.5;
  return Math.min(window.devicePixelRatio || 1, maximum);
}

export function MarketMap({
  overview,
  theme,
  entityMode,
  selectedSymbol,
  selectedSector,
  onStockSelect,
  onSectorSelect,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<BubbleNode[]>([]);
  const frameRef = useRef<number | null>(null);
  const hoveredRef = useRef<HoverState | null>(null);
  const drawRef = useRef<() => void>(() => undefined);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const interactionFrameRef = useRef<number | null>(null);
  const [hovered, setHovered] = useState<HoverState | null>(null);

  const entities = useMemo<VisualEntity[]>(() => {
    if (entityMode === "sectors") {
      return overview.sectors.map((sector) => ({
        id: "sector:" + sector.name,
        name: sector.name,
        subtitle: (sector.constituent_count != null
          ? sector.constituent_count + " 只成分股"
          : sector.stocks.length + " 只代表样本") + " · ¥" +
          (sector.turnover_billion_cny * 10).toFixed(1) + " 亿",
        change: sector.change_percent,
        turnover: sector.turnover_billion_cny * 1000,
        sector,
      }));
    }
    return overview.sectors
      .flatMap((sector) => sector.stocks)
      .sort((a, b) => b.turnover_million_cny - a.turnover_million_cny)
      .slice(0, MAX_STOCK_BUBBLES)
      .map((stock) => ({
        id: stock.symbol,
        name: stock.name,
        subtitle: stock.symbol + " · " + stock.sector,
        change: stock.change_percent,
        turnover: stock.turnover_million_cny,
        stock,
      }));
  }, [entityMode, overview]);

  const selectedId = entityMode === "stocks"
    ? selectedSymbol
    : selectedSector ? "sector:" + selectedSector : null;

  const requestInteractionDraw = () => {
    if (interactionFrameRef.current !== null) return;
    interactionFrameRef.current = window.requestAnimationFrame(() => {
      interactionFrameRef.current = null;
      drawRef.current();
    });
  };
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = 0;
    let height = 0;
    let simulation = forceSimulation<BubbleNode>();
    let tick = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const draw = () => {
      const ratio = canvasPixelRatio();
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      drawField(context, width, height, theme);
      const hoveredId = hoveredRef.current?.entity.id;
      const displayNodes = interactiveLayout(nodesRef.current, pointerRef.current, hoveredId, width, height);
      canvas.dataset.pointerField = pointerRef.current ? "active" : "inactive";
      canvas.dataset.focusScale = hoveredId ? "1.28" : "1";
      for (const node of displayNodes) {
        if (node.entity.id === hoveredId) continue;
        drawBubble(context, node, node.entity.id === selectedId, Boolean(hoveredId && node.entity.id !== hoveredId));
      }
      const focus = displayNodes.find((node) => node.entity.id === hoveredId);
      if (focus) drawBubble(context, focus, focus.entity.id === selectedId, false, true);
    };
    drawRef.current = draw;

    const scheduleDraw = () => {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        draw();
      });
    };

    const resize = () => {
      const bounds = host.getBoundingClientRect();
      width = Math.max(300, bounds.width);
      height = Math.max(460, bounds.height);
      tick = 0;
      canvas.dataset.settled = "false";
      const ratio = canvasPixelRatio();
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";

      const previous = new Map(nodesRef.current.map((node) => [node.entity.id, node]));
      const upper = entities.filter((entity) => entity.change >= 0);
      const lower = entities.filter((entity) => entity.change < 0);
      const upperAnchors = makeAnchors(upper.length, width, height, true);
      const lowerAnchors = makeAnchors(lower.length, width, height, false);
      const upperIndex = new Map(upper.map((entity, index) => [entity.id, index]));
      const lowerIndex = new Map(lower.map((entity, index) => [entity.id, index]));
      const now = performance.now();

      nodesRef.current = entities.map((entity) => {
        const isUp = entity.change >= 0;
        const anchor = isUp
          ? upperAnchors[upperIndex.get(entity.id) ?? 0]
          : lowerAnchors[lowerIndex.get(entity.id) ?? 0];
        const existing = previous.get(entity.id);
        const changedSign = existing && (existing.entity.change >= 0) !== isUp;
        return {
          entity,
          radius: bubbleRadius(
            entity.change,
            width,
            height,
            isUp ? upper.length : lower.length,
            entityMode,
          ),
          anchorX: anchor.x,
          anchorY: anchor.y,
          x: existing?.x ?? anchor.x,
          y: existing?.y ?? anchor.y,
          vx: existing?.vx ?? 0,
          vy: existing?.vy ?? 0,
          crossing: changedSign ? {
            startedAt: now,
            fromY: existing.y ?? (isUp ? height * 0.72 : height * 0.28),
            toY: anchor.y,
          } : undefined,
        };
      });
      canvas.dataset.changeLabelCount = String(
        nodesRef.current.filter((node) => shouldShowChange(node)).length,
      );

      constrainNodes(nodesRef.current, width, height, now);
      separateNodes(nodesRef.current, width, height, now, 6);
      recordLayout(canvas, nodesRef.current, width, height, now);

      simulation.stop();
      simulation = forceSimulation(nodesRef.current)
        .force("x", forceX<BubbleNode>((node) => node.anchorX).strength(0.036))
        .force("y", forceY<BubbleNode>((node) => node.anchorY).strength(0.064))
        .force(
          "collide",
          forceCollide<BubbleNode>((node) => node.radius + COLLISION_GAP / 2)
            .iterations(2)
            .strength(1),
        )
        .velocityDecay(0.34)
        .alphaDecay(0.1)
        .alphaTarget(0)
        .on("tick", () => {
          tick += 1;
          const time = performance.now();
          if (tick > 40) canvas.dataset.settled = "true";
          animateCrossings(nodesRef.current, time);
          constrainNodes(nodesRef.current, width, height, time);
          separateNodes(nodesRef.current, width, height, time, 1);
          recordLayout(canvas, nodesRef.current, width, height, time);
          scheduleDraw();
        })
        .on("end", () => {
          const time = performance.now();
          separateNodes(nodesRef.current, width, height, time, 6);
          recordLayout(canvas, nodesRef.current, width, height, time);
          canvas.dataset.settled = "true";
          draw();
        });
      draw();
      scheduleDraw();
    };

    const updateMotion = () => {
      if (document.hidden || reducedMotion.matches) simulation.stop();
      else if (canvas.dataset.settled !== "true") simulation.alpha(0.28).restart();
    };
    document.addEventListener("visibilitychange", updateMotion);
    reducedMotion.addEventListener("change", updateMotion);

    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
      reducedMotion.removeEventListener("change", updateMotion);
      simulation.stop();
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
      if (interactionFrameRef.current !== null) window.cancelAnimationFrame(interactionFrameRef.current);
      frameRef.current = null;
      interactionFrameRef.current = null;
      pointerRef.current = null;
    };
  }, [entities, entityMode, selectedId, theme]);

  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  const pointerPosition = (
    event: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>,
  ) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };

  const findNode = (x: number, y: number) =>
    [...nodesRef.current].reverse().find((node) => {
      const dx = x - (node.x ?? 0);
      const dy = y - (node.y ?? 0);
      const radius = node.radius * (node.entity.id === hoveredRef.current?.entity.id ? 1.28 : 1);
      return dx * dx + dy * dy <= radius * radius;
    });

  const selectEntity = (entity: VisualEntity) => {
    if (entity.stock) onStockSelect(entity.stock);
    if (entity.sector) onSectorSelect(entity.sector);
  };

  return (
    <div className="bubble-map" ref={hostRef}>
      <canvas
        ref={canvasRef}
        data-visible-count={entities.length}
        aria-label={entityMode === "stocks" ? "A 股个股涨跌碰撞云图" : "A 股概念板块涨跌碰撞云图"}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse") return;
          const point = pointerPosition(event);
          const node = findNode(point.x, point.y);
          const nextHovered = node ? { entity: node.entity, x: point.x, y: point.y } : null;
          pointerRef.current = point;
          hoveredRef.current = nextHovered;
          event.currentTarget.style.cursor = node ? "pointer" : "default";
          setHovered(nextHovered);
          requestInteractionDraw();
        }}
        onPointerLeave={(event) => {
          event.currentTarget.style.cursor = "default";
          pointerRef.current = null;
          hoveredRef.current = null;
          setHovered(null);
          requestInteractionDraw();
        }}
        onClick={(event) => {
          const point = pointerPosition(event);
          const node = findNode(point.x, point.y);
          if (node) selectEntity(node.entity);
        }}
      />

      {hovered && (
        <div
          className="bubble-tooltip"
          style={{
            left: Math.min(hovered.x + 14, Math.max(8, (hostRef.current?.clientWidth ?? 320) - 190)) + "px",
            top: Math.max(10, hovered.y - 72) + "px",
          }}
        >
          <strong>{hovered.entity.name}</strong>
          <span>{hovered.entity.subtitle}</span>
          <em className={hovered.entity.change >= 0 ? "value--up" : "value--down"}>
            {formatSigned(hovered.entity.change)}%
          </em>
        </div>
      )}

      <div className="bubble-access-list sr-only" aria-label={entityMode === "stocks" ? "云图个股列表" : "云图行业列表"}>
        {entities.map((entity) => (
          <button key={entity.id} type="button" onClick={() => selectEntity(entity)}>
            {entity.name} {formatSigned(entity.change)}%
          </button>
        ))}
      </div>
    </div>
  );
}

function drawField(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  theme: "dark" | "light",
) {
  const light = theme === "light";
  context.fillStyle = light ? "#f8fafc" : "#090b0e";
  context.fillRect(0, 0, width, height);
  context.fillStyle = light ? "rgba(185, 54, 64, 0.055)" : "rgba(185, 54, 64, 0.045)";
  context.fillRect(0, 0, width, height / 2 - BOUNDARY_HALF_GAP);
  context.fillStyle = light ? "rgba(12, 134, 99, 0.055)" : "rgba(12, 134, 99, 0.045)";
  context.fillRect(0, height / 2 + BOUNDARY_HALF_GAP, width, height / 2 - BOUNDARY_HALF_GAP);

  context.strokeStyle = light ? "#e2e7ec" : "#181c21";
  context.lineWidth = 1;
  for (let x = 0; x <= width; x += 48) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke();
  }
  for (let y = 0; y <= height; y += 48) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke();
  }

  context.fillStyle = light ? "rgba(248, 250, 252, .94)" : "rgba(9, 11, 14, .94)";
  context.fillRect(0, height / 2 - BOUNDARY_HALF_GAP, width, BOUNDARY_HALF_GAP * 2);
  context.setLineDash([6, 6]);
  context.strokeStyle = light ? "#9aa5af" : "#47515a";
  context.beginPath(); context.moveTo(0, height / 2); context.lineTo(width, height / 2); context.stroke();
  context.setLineDash([]);
  context.font = "600 11px Inter, Microsoft YaHei, sans-serif";
  context.fillStyle = "#e38188"; context.fillText("上升区  RISING", 16, 25);
  context.fillStyle = "#64c7a3"; context.fillText("下降区  FALLING", 16, height / 2 + 48);
  context.fillStyle = "#89939d"; context.fillText("0%", width - 34, height / 2 - 8);
}

function drawBubble(
  context: CanvasRenderingContext2D,
  node: BubbleNode,
  selected: boolean,
  dimmed: boolean,
  hovered = false,
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const change = node.entity.change;
  const colors = change >= 0 ? UP_COLORS : DOWN_COLORS;
  const intensity = Math.min(2, Math.floor(Math.abs(change) / 1.4));
  context.save();
  context.globalAlpha = dimmed ? 0.46 : 1;
  if (hovered) {
    context.shadowBlur = 18;
    context.shadowColor = change >= 0 ? "rgba(240,120,130,.5)" : "rgba(76,206,161,.5)";
  }
  context.beginPath();
  context.arc(x, y, node.radius + (hovered ? 2 : 0), 0, Math.PI * 2);
  context.fillStyle = colors[intensity];
  context.fill();
  context.lineWidth = selected ? 3 : hovered ? 2 : 1;
  context.strokeStyle = selected ? "#f1c84b" : "rgba(255,255,255,.28)";
  context.stroke();

  const maxTextWidth = node.radius * 1.62;
  let nameSize = Math.max(7, Math.min(12, node.radius * 0.32));
  context.font = "700 " + nameSize + "px Inter, Microsoft YaHei, sans-serif";
  while (nameSize > 7 && context.measureText(node.entity.name).width > maxTextWidth) {
    nameSize -= 0.5;
    context.font = "700 " + nameSize + "px Inter, Microsoft YaHei, sans-serif";
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f7f8f9";
  const showChange = shouldShowChange(node);
  context.fillText(node.entity.name, x, y - (showChange ? 5 : 0), maxTextWidth);
  if (showChange) {
    context.font = "700 " + Math.max(8, Math.min(10, node.radius * 0.27)) + "px Inter, sans-serif";
    context.fillText(formatSigned(change) + "%", x, y + 9, maxTextWidth);
  }
  context.restore();
}

function interactiveLayout(
  nodes: BubbleNode[],
  pointer: { x: number; y: number } | null,
  hoveredId: string | undefined,
  width: number,
  height: number,
) {
  if (!pointer) return nodes;
  const visualNodes = nodes.map((node) => ({ ...node }));
  const focus = visualNodes.find((node) => node.entity.id === hoveredId);
  if (focus) focus.radius = Math.min(62, focus.radius * 1.28);
  const fieldRadius = focus ? Math.max(96, focus.radius * 2.7) : 78;
  for (const node of visualNodes) {
    if (node === focus) continue;
    let dx = (node.x ?? 0) - pointer.x;
    let dy = (node.y ?? 0) - pointer.y;
    let distance = Math.hypot(dx, dy);
    if (distance >= fieldRadius) continue;
    if (distance < 0.1) {
      dx = node.entity.id.length % 2 ? 1 : -1;
      dy = node.entity.id.length % 3 ? 1 : -1;
      distance = Math.hypot(dx, dy);
    }
    const strength = Math.pow(1 - distance / fieldRadius, 2) * (focus ? 34 : 20);
    node.x = (node.x ?? 0) + dx / distance * strength;
    node.y = (node.y ?? 0) + dy / distance * strength;
  }
  const now = performance.now();
  constrainNodes(visualNodes, width, height, now);
  separateNodes(visualNodes, width, height, now, 2, hoveredId);
  return visualNodes;
}
function shouldShowChange(node: BubbleNode) {
  return Boolean(node.entity.sector) || node.radius >= 18;
}

function makeAnchors(count: number, width: number, height: number, upper: boolean) {
  if (!count) return [];
  const zoneTop = upper ? 34 : height / 2 + BOUNDARY_HALF_GAP + 12;
  const zoneBottom = upper ? height / 2 - BOUNDARY_HALF_GAP - 12 : height - 14;
  const zoneHeight = Math.max(80, zoneBottom - zoneTop);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * width / zoneHeight)));
  const rows = Math.max(1, Math.ceil(count / columns));
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const rowCount = Math.min(columns, count - row * columns);
    const offset = (width / Math.max(columns, 1)) * (columns - rowCount) / 2;
    const x = offset + ((column + 0.5) / columns) * width;
    const rowProgress = rows === 1 ? 0.5 : row / (rows - 1);
    const y = zoneTop + 14 + rowProgress * Math.max(0, zoneHeight - 28);
    const labelBottom = upper
      ? LABEL_SAFE_HEIGHT
      : height / 2 + BOUNDARY_HALF_GAP + LABEL_SAFE_HEIGHT;
    return {
      x: x < LABEL_SAFE_WIDTH && y < labelBottom ? LABEL_SAFE_WIDTH + 18 : x,
      y,
    };
  });
}

function bubbleRadius(
  change: number,
  width: number,
  height: number,
  zoneCount: number,
  mode: MarketEntityMode,
) {
  const zoneArea = width * Math.max(100, height / 2 - BOUNDARY_HALF_GAP - 42);
  const packingRadius = Math.sqrt(zoneArea / Math.max(zoneCount, 1) / Math.PI);
  const normalizedMove = Math.pow(Math.min(Math.abs(change), 10) / 10, 0.55);
  const movementScale = 0.5 + normalizedMove * 1.25;
  const densityScale = mode === "sectors" ? 0.68 : width < 640 ? 0.68 : 0.55;
  const sparseZone = zoneCount <= 32;
  const minimumRadius =
    mode === "sectors" ? 18 : width < 640 ? (sparseZone ? 13 : 10) : sparseZone ? 22 : 15;
  const maximumRadius =
    mode === "sectors" ? 54 : width < 640 ? (sparseZone ? 54 : 48) : sparseZone ? 64 : 48;
  return clamp(
    packingRadius * densityScale * movementScale,
    minimumRadius,
    maximumRadius,
  );
}

function animateCrossings(nodes: BubbleNode[], now: number) {
  for (const node of nodes) {
    if (!node.crossing) continue;
    const progress = clamp((now - node.crossing.startedAt) / CROSSING_MS, 0, 1);
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    node.y = node.crossing.fromY + (node.crossing.toY - node.crossing.fromY) * eased;
    if (progress >= 1) node.crossing = undefined;
  }
}

function constrainNodes(nodes: BubbleNode[], width: number, height: number, now: number) {
  const middle = height / 2;
  for (const node of nodes) {
    const edge = node.radius + 4;
    node.x = clamp(node.x ?? width / 2, edge, width - edge);
    if (node.crossing && now - node.crossing.startedAt < CROSSING_MS) {
      node.y = clamp(node.y ?? middle, edge, height - edge);
      continue;
    }
    node.crossing = undefined;
    node.y = node.entity.change >= 0
      ? clamp(node.y ?? node.anchorY, edge, middle - BOUNDARY_HALF_GAP - node.radius)
      : clamp(node.y ?? node.anchorY, middle + BOUNDARY_HALF_GAP + node.radius, height - edge);
    repelFromZoneLabel(node, middle);
  }
}

function repelFromZoneLabel(node: BubbleNode, middle: number) {
  const top = node.entity.change >= 0 ? 0 : middle + BOUNDARY_HALF_GAP;
  const right = LABEL_SAFE_WIDTH;
  const bottom = top + LABEL_SAFE_HEIGHT;
  const radius = node.radius + 5;
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  if (x - radius >= right || y - radius >= bottom || y + radius <= top) return;

  const escapeRight = right + radius - x;
  const escapeDown = bottom + radius - y;
  if (escapeRight <= escapeDown) {
    node.x = right + radius;
    node.vx = Math.max(0.18, Math.abs(node.vx ?? 0) * 0.82);
  } else {
    node.y = bottom + radius;
    node.vy = Math.max(0.18, Math.abs(node.vy ?? 0) * 0.82);
  }
}

function separateNodes(
  nodes: BubbleNode[],
  width: number,
  height: number,
  now: number,
  iterations: number,
  fixedId?: string,
) {
  for (let pass = 0; pass < iterations; pass += 1) {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        let dx = (right.x ?? 0) - (left.x ?? 0);
        let dy = (right.y ?? 0) - (left.y ?? 0);
        let distance = Math.hypot(dx, dy);
        const minimum = left.radius + right.radius + COLLISION_GAP;
        if (distance >= minimum) continue;
        if (distance < 0.001) {
          dx = ((leftIndex * 17 + rightIndex * 11) % 7) - 3 || 1;
          dy = ((leftIndex * 13 + rightIndex * 19) % 7) - 3 || -1;
          distance = Math.hypot(dx, dy);
        }
        const overlap = minimum - distance + 0.1;
        const nx = dx / distance;
        const ny = dy / distance;
        if (left.entity.id === fixedId) {
          right.x = (right.x ?? 0) + nx * overlap;
          right.y = (right.y ?? 0) + ny * overlap;
        } else if (right.entity.id === fixedId) {
          left.x = (left.x ?? 0) - nx * overlap;
          left.y = (left.y ?? 0) - ny * overlap;
        } else {
          left.x = (left.x ?? 0) - nx * overlap / 2;
          left.y = (left.y ?? 0) - ny * overlap / 2;
          right.x = (right.x ?? 0) + nx * overlap / 2;
          right.y = (right.y ?? 0) + ny * overlap / 2;
        }
      }
    }
    constrainNodes(nodes, width, height, now);
  }
}

function recordLayout(
  canvas: HTMLCanvasElement,
  nodes: BubbleNode[],
  width: number,
  height: number,
  now: number,
) {
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const dx = (nodes[i].x ?? 0) - (nodes[j].x ?? 0);
      const dy = (nodes[i].y ?? 0) - (nodes[j].y ?? 0);
      if (Math.hypot(dx, dy) + 0.4 < nodes[i].radius + nodes[j].radius) overlaps += 1;
    }
  }
  const middle = height / 2;
  const violations = nodes.filter((node) => {
    if (node.crossing && now - node.crossing.startedAt < CROSSING_MS) return false;
    return node.entity.change >= 0
      ? (node.y ?? 0) + node.radius > middle - BOUNDARY_HALF_GAP + 0.5
      : (node.y ?? height) - node.radius < middle + BOUNDARY_HALF_GAP - 0.5;
  }).length;
  const labelViolations = nodes.filter((node) => {
    const top = node.entity.change >= 0 ? 0 : middle + BOUNDARY_HALF_GAP;
    const bottom = top + LABEL_SAFE_HEIGHT;
    return (node.x ?? 0) - node.radius < LABEL_SAFE_WIDTH
      && (node.y ?? 0) - node.radius < bottom
      && (node.y ?? 0) + node.radius > top;
  }).length;
  canvas.dataset.overlapCount = String(overlaps);
  canvas.dataset.boundaryViolations = String(violations);
  canvas.dataset.labelViolations = String(labelViolations);
  canvas.dataset.minRadius = Math.min(...nodes.map((node) => node.radius)).toFixed(1);
  canvas.dataset.maxRadius = Math.max(...nodes.map((node) => node.radius)).toFixed(1);
  canvas.dataset.motionEnergy = (
    nodes.reduce((sum, node) => sum + Math.hypot(node.vx ?? 0, node.vy ?? 0), 0)
    / Math.max(nodes.length, 1)
  ).toFixed(3);
  canvas.dataset.centerClearance = Math.min(...nodes.map((node) =>
    node.entity.change >= 0
      ? middle - ((node.y ?? 0) + node.radius)
      : (node.y ?? height) - node.radius - middle,
  )).toFixed(1);
  canvas.dataset.crossingCount = String(nodes.filter((node) => node.crossing).length);
  canvas.dataset.layoutWidth = String(Math.round(width));
  const hitTarget = nodes[0];
  if (hitTarget) {
    canvas.dataset.hitX = String(hitTarget.x ?? 0);
    canvas.dataset.hitY = String(hitTarget.y ?? 0);
    canvas.dataset.hitName = hitTarget.entity.name;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatSigned(value: number) {
  return (value >= 0 ? "+" : "") + value.toFixed(2);
}
