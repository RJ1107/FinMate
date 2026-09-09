import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const artifactDirectory = resolve("artifacts");

test.beforeAll(() => {
  mkdirSync(artifactDirectory, { recursive: true });
});

test("renders the collision market field and global reference tape", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "实时大盘云图" })).toBeVisible();
  await expect(page.getByText(/未开盘|正在交易|午间收盘|盘后交易|已收盘/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("纳斯达克")).toBeVisible();
  await expect(page.getByText("日经 225")).toBeVisible();
  await expect(page.getByText(/碰撞图显示 \d+ \/ 活跃池 \d+ 只/)).toBeVisible();

  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toBeVisible();

  await expect.poll(async () => canvas.evaluate((element) => {
    const drawing = element as HTMLCanvasElement;
    const context = drawing.getContext("2d");
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, drawing.width, drawing.height).data;
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 64) {
      if (pixels[index] > 0) painted += 1;
    }
    return painted;
  })).toBeGreaterThan(1_000);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(8, 9, 11)");

  await page.screenshot({
    path: resolve(artifactDirectory, `market-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("filters the collision map and links a stock to its detail panel", async ({ page }) => {
  await page.goto("/");

  const search = page.getByPlaceholder("搜索全部 A 股或代码");
  await search.fill("宁德时代");

  await expect(page.locator(".map-frame canvas")).toBeVisible();
  await expect(page.getByText("300750")).toBeVisible();
  await expect(page.getByText("相对板块")).toBeVisible();
});

test("focuses and selects a painted bubble through the canvas", async ({ page }, testInfo) => {
  await page.goto("/");

  const search = page.getByPlaceholder("搜索全部 A 股或代码");
  await search.fill("宁德时代");
  const detailHeading = page.locator(".stock-panel h2");
  await expect(detailHeading).toHaveText("宁德时代");
  await page.getByRole("button", { name: "清除筛选" }).click();

  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-settled", "true");
  const findPaintedBubble = async () => canvas.evaluate((element) => {
    const drawing = element as HTMLCanvasElement;
    const context = drawing.getContext("2d");
    if (!context) return null;
    const scaleX = drawing.width / drawing.clientWidth;
    const scaleY = drawing.height / drawing.clientHeight;
    for (let y = 55; y < drawing.clientHeight - 20; y += 8) {
      for (let x = 20; x < drawing.clientWidth - 20; x += 8) {
        const pixel = context.getImageData(
          Math.round(x * scaleX),
          Math.round(y * scaleY),
          1,
          1,
        ).data;
        const isRed = pixel[0] > 130 && pixel[0] > pixel[1] * 1.35;
        const isGreen = pixel[1] > 75 && pixel[1] > pixel[0] * 1.25;
        if (pixel[3] > 220 && (isRed || isGreen)) return { x, y };
      }
    }
    return null;
  });
  await expect.poll(findPaintedBubble).not.toBeNull();
  const point = await findPaintedBubble();

  if (!point) throw new Error("Unable to locate a painted market bubble");

  if (testInfo.project.name === "mobile") {
    await canvas.tap({ position: point });
    await expect(detailHeading).not.toHaveText("宁德时代");
    return;
  }

  await canvas.hover({ position: point });
  const tooltip = page.locator(".bubble-tooltip");
  await expect(tooltip).toBeVisible();
  const stockName = await tooltip.locator("strong").textContent();
  if (!stockName) throw new Error("Focused bubble did not expose a stock name");

  await canvas.click({ position: point });
  await expect(page.getByRole("heading", { name: stockName })).toBeVisible();
});

test("opens sector context and lists every visible constituent", async ({ page }) => {
  await page.goto("/");

  await page.locator(".sector-filter button").filter({ hasText: "人工智能" }).click();
  await expect(page.getByRole("heading", { name: "人工智能" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "板块" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/成分股涨跌 · \d+ 只/)).toBeVisible();
  await expect.poll(() => page.locator(".leader-list li").count()).toBeGreaterThan(0);
  await page.locator(".leader-list button").filter({ hasText: "中际旭创" }).click();
  await expect(page.locator(".stock-panel h2")).toHaveText("中际旭创");
});

test("runs the market-fact agent and exposes its trace", async ({ page }, testInfo) => {
  await page.goto("/");

  const question = page.getByPlaceholder("问问 FinMate，例如：宁德时代表现如何？");
  await question.fill("今天市场怎么样？");
  await page.getByRole("button", { name: "分析", exact: true }).click();

  await expect(page.getByText("市场宽度")).toBeVisible();
  await expect(page.getByText(/load_market/)).toBeVisible();
  await expect(page.getByText(/compose_market/)).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(/Qwen · 已响应|DeepSeek · 已响应/, { timeout: 25_000 });
  await expect(page.getByText("模型增强", { exact: true })).toBeVisible();

  await page.screenshot({
    path: resolve(artifactDirectory, `agent-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("switches to the heatmap, selects a tile, and remembers the view", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "矩形云图", exact: true }).click();
  await expect.poll(() => page.locator(".heatmap-tile").count()).toBeGreaterThan(100);
  await page.locator(".heatmap-tile").filter({ hasText: "宁德时代" }).click();
  await expect(page.locator(".stock-panel h2")).toHaveText("宁德时代");
  await page.screenshot({ path: resolve(artifactDirectory, `heatmap-${testInfo.project.name}.png`), fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "矩形云图", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".heatmap-tile").first()).toBeVisible();
  await page.getByPlaceholder("搜索全部 A 股或代码").fill("宁德时代");
  await expect(page.locator(".heatmap-tile")).toHaveCount(1);
  await page.getByRole("button", { name: "碰撞小球", exact: true }).click();
  await expect(page.locator(".map-frame canvas")).toBeVisible();
  await expect(page.locator(".stock-panel h2")).toHaveText("宁德时代");
});

test("switches independently between stocks, sectors, bubbles, and heatmap", async ({ page }) => {
  await page.goto("/");
  await expect.poll(
    () => page.locator(".bubble-access-list button").count(),
    { timeout: 20_000 },
  ).toBeGreaterThan(40);
  await expect(page.locator(".bubble-access-list button")).toHaveCount(96);
  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toHaveAttribute("data-settled", "true");
  await expect(canvas).toHaveAttribute("data-overlap-count", "0");
  await expect(canvas).toHaveAttribute("data-boundary-violations", "0");
  await expect(canvas).toHaveAttribute("data-label-violations", "0");
  await expect.poll(async () => canvas.evaluate((element) => {
    const min = Number((element as HTMLCanvasElement).dataset.minRadius);
    const max = Number((element as HTMLCanvasElement).dataset.maxRadius);
    return max / min;
  })).toBeGreaterThan(1.8);
  await expect.poll(async () => canvas.evaluate((element) =>
    Number((element as HTMLCanvasElement).dataset.motionEnergy),
  )).toBeGreaterThan(0.03);
  await expect.poll(async () => canvas.evaluate((element) =>
    Number((element as HTMLCanvasElement).dataset.centerClearance),
  )).toBeLessThan(34);

  await page.getByRole("button", { name: "板块", exact: true }).click();
  await expect.poll(() => page.locator(".bubble-access-list button").count()).toBeGreaterThan(30);
  await expect(page.getByRole("heading", { name: "概念板块涨跌碰撞云图" })).toBeVisible();

  await page.getByRole("button", { name: "矩形云图", exact: true }).click();
  await expect.poll(() => page.locator(".heatmap-tile").count()).toBeGreaterThan(30);
  await expect(page.locator(".heatmap")).toHaveAttribute("data-up-count", /[1-9]\d*/);
  await expect(page.locator(".heatmap")).toHaveAttribute("data-down-count", /[1-9]\d*/);
  await expect(page.getByText("面积 · 涨跌幅绝对值（平滑）")).toBeVisible();
  await page.getByRole("button", { name: "个股", exact: true }).click();
  await expect.poll(() => page.locator(".heatmap-tile").count()).toBeGreaterThan(100);
  await expect(page.getByText("面积 · 成交活跃度（平滑）")).toBeVisible();
});

test("opens the local paper account and completes a simulated buy", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");
  await page.getByRole("button", { name: "打开模拟盘" }).click();
  const dialog = page.getByRole("dialog", { name: "模拟盘" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("spinbutton", { name: "初始资金" }).fill("500000");
  await dialog.getByRole("button", { name: "应用" }).click();
  await expect(dialog.getByText("¥500,000.00", { exact: true }).first()).toBeVisible();
  await dialog.getByPlaceholder("搜索股票名称或代码").fill("300308");
  await expect(dialog.locator(".paper-suggestions button").first()).toBeVisible({ timeout: 15_000 });
  await dialog.locator(".paper-suggestions button").first().click();
  await expect(dialog.getByText("中际旭创", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel("股数").fill("100");
  await dialog.getByRole("button", { name: "模拟买入" }).click();
  await expect(dialog.getByText(/模拟买入.*100 股/)).toBeVisible();
  await expect(dialog.locator(".paper-position-list article")).toHaveCount(1);
});

test("tracks the active top navigation section while scrolling", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "The compact mobile header intentionally hides section links.");
  await page.goto("/");
  const marketLink = page.getByRole("link", { name: "市场脉搏" });
  const analysisLink = page.getByRole("link", { name: "HeyFinmate" });
  await expect(marketLink).toHaveClass(/nav-link--active/);
  await analysisLink.click();
  await expect(analysisLink).toHaveClass(/nav-link--active/);
  await expect(marketLink).not.toHaveClass(/nav-link--active/);
});

test("opens the limit list and stores structured profile interests", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Compact mobile navigation is hidden.");
  await page.goto("/");
  await page.getByRole("button", { name: /涨停 \/ 跌停/ }).click();
  await expect(page.getByLabel("涨停跌停榜单")).toBeVisible();
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  await page.getByRole("link", { name: "用户画像" }).click();
  await expect(page.getByRole("heading", { name: "用户画像" })).toBeVisible();
  await page.locator(".profile-grid fieldset").filter({ hasText: "投资经验" })
    .getByRole("button", { name: "3-5 年" }).click();
  await page.getByPlaceholder(/更关注长期基本面/).fill("不使用杠杆。");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("finmate.user-profile.v1") ?? ""))
    .toContain("3-5 年");
});

test("keeps bubbles moving after the initial layout", async ({ page }) => {
  await page.goto("/");
  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toHaveAttribute("data-settled", "true");
  const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(before);
});

test("shows a model failure without claiming a model response", async ({ page }) => {
  await page.route("**/api/v1/agent/query", (route) => route.fulfill({ json: {
    request_id: "fallback-test", answer: "当前观察范围上涨 3298 家。", intent: "market_summary",
    resolved_entity: null, confidence: 1, evidence: [], data_mode: "demo",
    observed_at: "2026-09-08T10:00:00+08:00", answer_mode: "deterministic", model: null,
    trace: [{ node: "refine_with_model", label: "大模型增强", summary: "调用失败，保留确定性结论", duration_ms: 1 }],
  } }));
  await page.goto("/");
  await page.getByPlaceholder("问问 FinMate，例如：宁德时代表现如何？").fill("今天市场怎么样？");
  await page.getByRole("button", { name: "分析", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("模型暂不可用");
  await expect(page.getByRole("alert")).toContainText("大模型本次未能响应");
  await expect(page.locator(".answer-text")).toContainText("3298");
});

test("searches an arbitrary A-share and opens live charts and company profile", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  const search = page.getByPlaceholder("搜索全部 A 股或代码");
  await search.fill("兆易创新");
  const result = page.getByRole("option", { name: /兆易创新.*603986/ });
  await expect(result).toBeVisible({ timeout: 15_000 });
  await result.click();

  const dialog = page.getByRole("dialog", { name: /兆易创新 个股行情/ });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText("603986", { exact: false }).first()).toBeVisible();
  await expect(dialog.getByText("半导体", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".stock-chart canvas").first()).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole("tab", { name: "日K" }).click();
  await expect(dialog.getByRole("tab", { name: "日K" })).toHaveAttribute("aria-selected", "true");
  await expect(dialog.locator(".stock-chart canvas").first()).toBeVisible({ timeout: 20_000 });
  await expect(dialog.locator(".chart-ohlc")).toContainText("开");
  await expect(dialog.locator(".chart-ohlc")).toContainText("涨跌");
  await dialog.getByRole("button", { name: "关闭个股行情" }).click();
  await expect(dialog).toBeHidden();
});

test("polls displayed stock quotes every three seconds while visible", async ({ page }) => {
  let quoteRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/v1/market/quotes")) quoteRequests += 1; });
  await page.goto("/");
  await expect.poll(() => quoteRequests, { timeout: 8_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.getByText(/3 秒更新/)).toBeVisible();
});
