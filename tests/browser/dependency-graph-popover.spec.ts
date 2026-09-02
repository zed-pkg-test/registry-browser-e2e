import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const SOURCE_ROOT = process.env.ZED_WEB_SOURCE_DIR;
if (!SOURCE_ROOT) throw new Error("ZED_WEB_SOURCE_DIR must name an exact Zed web checkout");

const ORIGIN = "https://zpkg.test.invalid";
const PAGE_URL = `${ORIGIN}/__test/dependency-graph-popover`;
const GRAPH_DIGEST = `sha256:${"b".repeat(64)}`;
const ASSETS = new Map<string, { file: string; contentType: string }>([
  [
    "/graph-assets/dependency-graph.css",
    { file: "assets/dependency-graph.css", contentType: "text/css; charset=utf-8" },
  ],
  [
    "/graph-assets/dependency-graph.js",
    { file: "assets/dependency-graph.js", contentType: "text/javascript; charset=utf-8" },
  ],
  [
    "/static/dependency-graph-insights.css",
    { file: "static/dependency-graph-insights.css", contentType: "text/css; charset=utf-8" },
  ],
  [
    "/static/dependency-graph-insights-core.js",
    { file: "static/dependency-graph-insights-core.js", contentType: "text/javascript; charset=utf-8" },
  ],
  [
    "/static/dependency-graph-insights.js",
    { file: "static/dependency-graph-insights.js", contentType: "text/javascript; charset=utf-8" },
  ],
  [
    "/static/htmx.min.js",
    { file: "static/htmx.min.js", contentType: "text/javascript; charset=utf-8" },
  ],
]);

function declaredDocument() {
  return {
    schema: "zpkg/dependency-graph/v1",
    view: "declared",
    graph_digest: GRAPH_DIGEST,
    package: {
      registry_id: "registry:test",
      org: "fixture",
      name: "root",
      version: "1.0.0",
    },
    dependencies: [
      {
        registry_id: "registry:test",
        org: "fixture",
        name: "runtime-child",
        requirement: "^1.0.0",
        kind: "runtime",
        optional: false,
        features: [],
      },
      {
        registry_id: "registry:test",
        org: "vendor",
        name: "peer-child",
        requirement: "^2.0.0",
        kind: "peer",
        optional: true,
        features: [],
      },
    ],
  };
}

function fixtureHtml() {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <meta name="htmx-config" content='{"allowEval":false,"allowScriptTags":false,"includeIndicatorStyles":false,"selfRequestsOnly":true}'>
      <title>Zed dependency graph popover fixture</title>
      <style>
        :root { color-scheme: dark; --text:#f2f2f0; --muted:#8fa1b5; --panel:#0d1118; --border:#263241; --orange:#ff7a1a; --blue:#8fd3f4; --mono:ui-monospace,monospace; }
        html, body { margin:0; min-height:100%; background:#07080c; color:var(--text); font-family:system-ui,sans-serif; }
        main { width:min(100% - 24px, 1120px); margin:12px auto; }
      </style>
      <link rel="stylesheet" href="/graph-assets/dependency-graph.css">
      <link rel="stylesheet" href="/static/dependency-graph-insights.css">
      <script src="/static/htmx.min.js"></script>
      <script type="module" src="/graph-assets/dependency-graph.js"></script>
      <script type="module" src="/static/dependency-graph-insights.js"></script>
    </head>
    <body>
      <main>
        <zed-dependency-graph
          id="dependency-graph"
          data-mode="package"
          data-org="fixture"
          data-package="root"
          data-version="1.0.0"
          data-private="false"
          data-versions='[{"version":"1.0.0","prerelease":false,"yanked":false}]'>
        </zed-dependency-graph>
      </main>
    </body>
  </html>`;
}

async function fulfillGraph(route: Route) {
  const body = JSON.stringify(declaredDocument());
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  await route.fulfill({
    status: 200,
    headers: {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "application/vnd.zpkg.dependency-graph.v1+json",
      etag,
      "x-zpkg-graph-authoritative": "true",
      "x-zpkg-graph-digest": GRAPH_DIGEST,
    },
    body,
  });
}

async function installFixture(page: Page) {
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/__test/dependency-graph-popover") {
      await route.fulfill({ status: 200, contentType: "text/html", body: fixtureHtml() });
      return;
    }
    if (url.pathname.includes("/bff/dependency-graphs/packages/")) {
      await fulfillGraph(route);
      return;
    }
    if (url.pathname.startsWith("/partials/dependency-graph/")) {
      // The independent fixture does not own the Rust fragment renderer, but
      // the real component legitimately requests those same-origin fragments.
      // Return inert successful markup so browser errors cannot obscure the
      // geometry and pointer boundary under test.
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
        body: '<span data-fixture-fragment="true"></span>',
      });
      return;
    }
    const asset = ASSETS.get(url.pathname);
    if (asset) {
      await route.fulfill({
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": asset.contentType,
        },
        body: readFileSync(path.join(SOURCE_ROOT, asset.file)),
      });
      return;
    }
    await route.fulfill({ status: 404, body: "not found" });
  });
  const response = await page.goto(PAGE_URL);
  expect(response?.status()).toBe(200);
  const workspace = page.locator("zed-dependency-graph");
  // The public data-ready attribute is a transient connection guard, not a
  // load-completion contract. Wait on the actual rendered semantic graph.
  await expect(workspace.locator(".dg-node")).toHaveCount(3, { timeout: 15_000 });
  await expect(workspace.locator(".dg-node").first()).toBeVisible();
  await expect(workspace.locator('[data-metric="nodes"]')).toHaveText("3");
  await expect(workspace.locator('[data-metric="edges"]')).toHaveText("2");
  return workspace;
}

for (const width of [1120, 760, 430]) {
  test(`edge filters remain painted and pointer-safe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin !== ORIGIN) externalRequests.push(request.url());
    });

    const workspace = await installFixture(page);
    const shell = workspace.locator(".dg-shell");
    const menu = workspace.locator(".dg-filter-menu");
    const summary = menu.locator("summary");
    await summary.click();
    await expect(menu).toHaveAttribute("open", "");

    const panel = menu.locator(".dg-filter-panel");
    await expect(panel).toBeVisible();
    const [shellBox, panelBox] = await Promise.all([shell.boundingBox(), panel.boundingBox()]);
    expect(shellBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.x).toBeGreaterThanOrEqual(shellBox!.x - 1);
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(shellBox!.x + shellBox!.width + 1);

    const peer = menu.locator('[data-kind="peer"]');
    const optional = menu.locator('[data-control="optional"]');
    await expect(peer).toBeChecked();
    await expect(optional).toBeChecked();

    // These are deliberately ordinary pointer interactions. A clipped or
    // covered popover fails here; force-clicking would hide the product bug.
    await peer.click();
    await optional.click();
    await expect(peer).not.toBeChecked();
    await expect(optional).not.toBeChecked();
    await expect
      .poll(() =>
        workspace.evaluate((element) => {
          const graph = element as HTMLElement & {
            enabledKinds: Set<string>;
            includeOptional: boolean;
          };
          return {
            peer: graph.enabledKinds.has("peer"),
            optional: graph.includeOptional,
          };
        }),
      )
      .toEqual({ peer: false, optional: false });

    const saved = new URL(page.url());
    expect(saved.searchParams.get("graph-optional")).toBe("0");
    expect((saved.searchParams.get("graph-kinds") || "").split(",")).not.toContain("peer");

    // The unrelated Download popover remains right-aligned and inside the same
    // clipped shell after the Edge filters alignment repair.
    await summary.click();
    const download = workspace.locator(".dg-export-menu");
    await download.locator("summary").click();
    const downloadPanel = download.locator(":scope > div");
    await expect(downloadPanel).toBeVisible();
    const downloadBox = await downloadPanel.boundingBox();
    expect(downloadBox).not.toBeNull();
    expect(downloadBox!.x).toBeGreaterThanOrEqual(shellBox!.x - 1);
    expect(downloadBox!.x + downloadBox!.width).toBeLessThanOrEqual(
      shellBox!.x + shellBox!.width + 1,
    );

    expect(errors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
}
