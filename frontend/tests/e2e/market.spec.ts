import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const artifactDirectory = resolve("artifacts");

async function openMap(page: import("@playwright/test").Page) {
  const section = page.locator("#map");
  await expect(section).toBeAttached({ timeout: 15_000 });
  await section.evaluate((element) => {
    (element.querySelector(".map-load-card") as HTMLButtonElement | null)?.click();
  });
  await section.scrollIntoViewIfNeeded();
  await expect(page.locator(".map-frame canvas, .heatmap").first()).toBeVisible({ timeout: 30_000 });
}

test.beforeAll(() => {
  mkdirSync(artifactDirectory, { recursive: true });
});

test("renders the lightweight market pulse before the collision map", async ({ page }, testInfo) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "市场脉搏" })).toBeVisible();
  await expect(page.getByText(/未开盘|正在交易|午间收盘|盘后交易|已收盘/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("上证指数")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("市场新闻", { exact: true })).toBeVisible();
  const changeNews = page.getByRole("button", { name: "换一换" });
  await expect(changeNews).toBeEnabled({ timeout: 15_000 });
  const firstHeadline = await page.locator(".market-news__grid h3").first().textContent();
  await changeNews.click();
  await expect.poll(() => page.locator(".market-news__grid h3").first().textContent())
    .not.toBe(firstHeadline);
  await expect(page.getByText(/第 2 \/ \d+ 组 · 共 \d+ 条/)).toBeVisible();

  await openMap(page);
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
  await openMap(page);

  const search = page.getByPlaceholder("搜索全部 A 股或代码");
  await search.fill("宁德时代");

  await expect(page.locator(".map-frame canvas")).toBeVisible();
  await expect(page.getByText("300750")).toBeVisible();
  await expect(page.getByText("相对板块")).toBeVisible();
});

test("focuses and selects a painted bubble through the canvas", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await openMap(page);

  const search = page.getByPlaceholder("搜索全部 A 股或代码");
  await search.fill("宁德时代");
  const detailHeading = page.locator(".stock-panel h2");
  await expect(detailHeading).toHaveText("宁德时代");
  await page.getByRole("button", { name: "清除筛选" }).click();

  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toBeVisible();
  await expect(canvas).toHaveAttribute("data-settled", "true");
  const readHitTarget = async () => canvas.evaluate((element) => {
    const drawing = element as HTMLCanvasElement;
    const x = Number(drawing.dataset.hitX);
    const y = Number(drawing.dataset.hitY);
    const name = drawing.dataset.hitName;
    return Number.isFinite(x) && Number.isFinite(y) && name ? { x, y, name } : null;
  });
  await expect.poll(readHitTarget).not.toBeNull();
  const target = await readHitTarget();

  if (!target) throw new Error("Unable to locate a market bubble hit target");

  if (testInfo.project.name === "mobile") {
    await canvas.tap({ position: target });
    await expect(detailHeading).toHaveText(target.name);
    return;
  }

  const tooltip = page.locator(".bubble-tooltip");
  await canvas.hover({ position: target });
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator("strong")).toHaveText(target.name);
  await expect(canvas).toHaveAttribute("data-pointer-field", "active");
  await expect(canvas).toHaveAttribute("data-focus-scale", "1.28");

  const currentTarget = await readHitTarget();
  if (!currentTarget) throw new Error("Market bubble target disappeared before click");
  await canvas.click({ position: currentTarget });
  await expect(page.getByRole("heading", { name: currentTarget.name })).toBeVisible();
});

test("opens sector context and lists every visible constituent", async ({ page }) => {
  await page.goto("/");
  await openMap(page);

  await page.locator(".sector-filter button").filter({ hasText: "人工智能" }).click();
  await expect(page.getByRole("heading", { name: "人工智能" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "板块" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(/成分股涨跌 · \d+(?: \/ \d+)? 只/)).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.locator(".leader-list li").count()).toBeGreaterThan(0);
  await page.locator(".leader-list button").filter({ hasText: "中际旭创" }).click();
  await expect(page.locator(".stock-panel h2")).toHaveText("中际旭创");
});

test("runs the market-fact agent and preserves its grounded fallback", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  await page.goto("/");

  const question = page.getByPlaceholder("问问 FinMate，例如：宁德时代表现如何？");
  await question.fill("今天市场怎么样？");
  await page.getByRole("button", { name: "分析", exact: true }).click();

  await expect(page.getByRole("status")).toHaveText(/Qwen · 已响应|DeepSeek · 已响应|模型暂不可用/, { timeout: 35_000 });
  await expect(page.getByText("主要指数", { exact: true })).toBeVisible();
  await expect(page.getByText(/load_market/)).toBeVisible();
  await expect(page.getByText(/compose_market/)).toBeVisible();
  await expect(page.getByText(/模型增强|确定性回答/, { exact: true })).toBeVisible();

  await page.screenshot({
    path: resolve(artifactDirectory, `agent-${testInfo.project.name}.png`),
    fullPage: true,
  });
});

test("answers a 20w allocation question from the saved user profile", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/");

  const clientId = await page.evaluate(() => localStorage.getItem("finmate.client-id.v1"));
  if (!clientId) throw new Error("Anonymous client id was not initialized");

  const profileResponse = await page.request.put("/api/v1/memory/profile/" + clientId, {
    data: {
      income: "10-30 万",
      experience: "1-3 年",
      risk: "积极",
      drawdown: "约20%",
      horizon: "1-3 年",
      goal: "稳健增值",
      liquidity: "较低",
      supplement: "不使用杠杆",
      interests: ["人工智能机会"],
      updatedAt: null,
    },
  });
  expect(profileResponse.ok()).toBe(true);

  const question = page.getByPlaceholder("问问 FinMate，例如：宁德时代表现如何？");
  await question.fill("我如果有20w，该如何配置投资呢");
  await page.getByRole("button", { name: "分析", exact: true }).click();

  await expect(page.getByText("资产配置", { exact: true })).toBeVisible({ timeout: 35_000 });
  const answer = page.locator(".answer-text");
  await expect(answer).toContainText("用户画像");
  await expect(answer).toContainText("20");
  await expect(answer).not.toContainText("股票代码");
  await expect(page.getByText(/portfolio_allocation/)).toBeVisible();
});

test("switches to the heatmap, selects a tile, and remembers the view", async ({ page }, testInfo) => {
  await page.goto("/");
  await openMap(page);
  await page.getByRole("button", { name: "矩形云图", exact: true }).click();
  await expect.poll(() => page.locator(".heatmap-tile").count()).toBeGreaterThan(100);
  await expect(page.getByText(/上涨区\s+RISING/)).toBeVisible();
  await expect(page.getByText(/下跌区\s+FALLING/)).toBeVisible();
  await expect.poll(async () => page.locator(".heatmap").evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const middle = bounds.top + bounds.height / 2;
    const upTiles = [...element.querySelectorAll<HTMLElement>('[data-zone="up"]')];
    const downTiles = [...element.querySelectorAll<HTMLElement>('[data-zone="down"]')];
    return upTiles.length > 0 && downTiles.length > 0
      && upTiles.every((tile) => tile.getBoundingClientRect().bottom < middle)
      && downTiles.every((tile) => tile.getBoundingClientRect().top > middle);
  })).toBe(true);
  await expect.poll(async () => page.locator(".heatmap").evaluate((element) => {
    const headers = [...element.querySelectorAll<HTMLElement>(".heatmap-sector")]
      .map((header) => header.getBoundingClientRect());
    const tiles = [...element.querySelectorAll<HTMLElement>(".heatmap-tile")]
      .map((tile) => tile.getBoundingClientRect());
    const overlaps = (left: DOMRect, right: DOMRect) =>
      left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top;
    return headers.length > 5 && headers.every((header) =>
      tiles.every((tile) => !overlaps(header, tile)));
  })).toBe(true);
  const selectedTile = page.locator(".heatmap-tile").first();
  const selectedTitle = await selectedTile.getAttribute("title");
  const selectedName = selectedTitle?.split(" · ")[0];
  if (!selectedName) throw new Error("Heatmap tile did not expose a stock name");
  await selectedTile.click();
  await expect(page.locator(".stock-panel h2")).toHaveText(selectedName);
  await page.screenshot({ path: resolve(artifactDirectory, `heatmap-${testInfo.project.name}.png`), fullPage: true });
  await page.reload();
  await openMap(page);
  await expect(page.getByRole("button", { name: "矩形云图", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".heatmap-tile").first()).toBeVisible();
  await page.getByPlaceholder("搜索全部 A 股或代码").fill(selectedName);
  await expect(page.locator(".heatmap-tile")).toHaveCount(1);
  await page.getByRole("button", { name: "碰撞小球", exact: true }).click();
  await expect(page.locator(".map-frame canvas")).toBeVisible();
  await expect(page.locator(".stock-panel h2")).toHaveText(selectedName);
});

test("switches independently between stocks, sectors, bubbles, and heatmap", async ({ page }) => {
  await page.goto("/");
  test.setTimeout(60_000);
  await openMap(page);
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
    Number((element as HTMLCanvasElement).dataset.centerClearance),
  )).toBeLessThan(34);

  await page.getByRole("button", { name: "板块", exact: true }).click();
  await expect.poll(() => page.locator(".bubble-access-list button").count()).toBeGreaterThan(30);
  await expect(page.getByRole("heading", { name: "行业板块涨跌碰撞云图" })).toBeVisible();
  await expect.poll(async () => canvas.evaluate((element) => {
    const drawing = element as HTMLCanvasElement;
    const visible = Number(drawing.dataset.visibleCount);
    return visible > 30 && Number(drawing.dataset.changeLabelCount) === visible;
  })).toBe(true);

  await page.getByRole("button", { name: "矩形云图", exact: true }).click();
  await expect.poll(() => page.locator(".heatmap-tile").count()).toBeGreaterThan(30);
  await expect.poll(async () => page.locator(".heatmap").evaluate((element) =>
    Number((element as HTMLElement).dataset.upCount) + Number((element as HTMLElement).dataset.downCount),
  )).toBeGreaterThan(30);
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
  const capital = dialog.getByRole("spinbutton", { name: "初始资金" });
  await capital.fill("-1");
  await dialog.getByRole("button", { name: "应用" }).click();
  await expect(dialog.getByText("初始资金必须是大于或等于 0 的有效金额")).toBeVisible();
  await capital.fill("0");
  await dialog.getByRole("button", { name: "应用" }).click();
  await expect(dialog.getByText("¥0.00", { exact: true }).first()).toBeVisible();
  await capital.fill("500000.129");
  await dialog.getByRole("button", { name: "应用" }).click();
  await expect(capital).toHaveValue("500000.13");
  await dialog.getByPlaceholder("搜索股票名称或代码").fill("300308");
  await expect(dialog.locator(".paper-suggestions button").first()).toBeVisible({ timeout: 15_000 });
  await dialog.locator(".paper-suggestions button").first().click();
  await expect(dialog.getByText("中际旭创", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await dialog.getByLabel("股数").fill("100");
  await dialog.getByRole("button", { name: "模拟买入" }).click();
  await expect(dialog.getByText(/模拟买入.*100 股/)).toBeVisible();
  await expect(dialog.locator(".paper-position-list article")).toHaveCount(1);
  await expect(dialog.getByText(/当日 [+-]\d+\.\d{2}% · [+-]¥[\d,.]+/)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: /修改 .* 持仓成本/ }).click();
  await dialog.getByRole("spinbutton", { name: "每股成本" }).fill("123.456");
  await dialog.getByRole("button", { name: "保存持仓成本" }).click();
  await expect(dialog.getByText(/成本 ¥123.46/)).toBeVisible();
  page.once("dialog", (confirmation) => confirmation.accept());
  await dialog.getByRole("button", { name: /删除 .* 持仓/ }).click();
  await expect(dialog.locator(".paper-position-list article")).toHaveCount(0);
});

test("switches to the light theme and remembers the preference", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "打开功能选项" }).click();
  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe("rgb(242, 244, 246)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect.poll(() => page.evaluate(() => localStorage.getItem("finmate.theme"))).toBe("light");
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

test("edits and explicitly saves the structured user profile", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Compact mobile navigation is hidden.");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "用户画像" })).toBeAttached({ timeout: 15_000 });
  await page.getByRole("link", { name: "用户画像" }).click();
  await expect(page.getByRole("heading", { name: "用户画像" })).toBeVisible();
  await expect(page.getByText("每天最多修改 2 次用户画像 · 今日剩余 2 次")).toBeVisible();
  await page.getByRole("button", { name: "修改用户画像" }).click();
  await page.locator(".profile-grid fieldset").filter({ hasText: "投资经验" })
    .getByRole("button", { name: "3-5 年" }).click();
  const supplement = page.getByPlaceholder(/更关注长期基本面/);
  await supplement.fill("不使用杠杆。");
  await supplement.press("Enter");
  await expect(page.getByText("已更新用户画像")).toBeVisible();
  await expect(page.getByText("每天最多修改 2 次用户画像 · 今日剩余 1 次")).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("finmate.user-profile.v1") ?? ""))
    .toContain("3-5 年");
});

test("disables Agent and profile updates after the daily quota is exhausted", async ({ page }) => {
  await page.route("**/api/v1/memory/quota/**", (route) => route.fulfill({ json: {
    client_id: "client_quota_ui", usage_date: "2026-09-10",
    agent_used: 20, agent_limit: 20, agent_remaining: 0,
    profile_used: 2, profile_limit: 2, profile_remaining: 0,
  } }));
  await page.goto("/");
  await expect(page.getByText("每天最多 20 次 FinMate 对话 · 今日剩余 0 次")).toBeVisible();
  await expect(page.getByText("每天最多修改 2 次用户画像 · 今日剩余 0 次")).toBeVisible();
  await page.getByPlaceholder("问问 FinMate，例如：宁德时代表现如何？").fill("今天市场怎么样？");
  await expect(page.getByRole("button", { name: "分析", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "修改用户画像" })).toBeDisabled();
});

test("settles bubbles without overlap after the initial layout", async ({ page }) => {
  await page.goto("/");
  await openMap(page);
  const canvas = page.locator(".map-frame canvas");
  await expect(canvas).toHaveAttribute("data-settled", "true");
  await expect(canvas).toHaveAttribute("data-overlap-count", "0");
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
  await openMap(page);
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

test("polls displayed stock quotes every fifteen seconds while visible", async ({ page }) => {
  test.setTimeout(60_000);
  let quoteRequests = 0;
  page.on("request", (request) => { if (request.url().includes("/api/v1/market/quotes")) quoteRequests += 1; });
  await page.goto("/");
  await openMap(page);
  await expect.poll(() => quoteRequests, { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.getByText(/15 秒更新/)).toBeVisible();
});
