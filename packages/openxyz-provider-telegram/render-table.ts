import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { getNodeChildren, getNodeValue } from "chat";
import type { MdastTable, TableRow } from "chat";

// mdast `Content` is deprecated; use `RootContent`-style narrowing through
// chat's exported helpers (`getNodeChildren`/`getNodeValue`) instead of the
// deprecated alias.
type AnyMdastNode = Parameters<typeof getNodeChildren>[0];

// Renderer stack: pure WASM. Mirrors `@vercel/og`'s Node-runtime pattern
// (see `node_modules/@vercel/og/dist/index.node.js:21437-21452`) — the
// only production-tested approach for image rendering on Vercel Node 22
// functions.
//
// Why WASM over `@resvg/resvg-js` (napi): Bun.build on macOS resolves
// `@resvg/resvg-js`'s platform-specific `.node` binary against the build
// machine's arch. The bundled output ships `resvgjs.darwin-arm64.node`,
// which does the wrong thing on Vercel's Linux x64 runtime — text
// elements silently rasterize blank while shapes (rect/line) keep
// rendering. WASM has no platform binary; one `.wasm` byte stream runs
// identically on macOS dev and Vercel Linux prod.
//
// Asset loading: vendored Roboto Regular + Bold TTFs and the resvg WASM
// are imported via Bun's `with { type: "binary" }` attribute. Bun.build
// inlines each asset's bytes as a `Uint8Array` literal, baked into the
// bundle. No runtime file read, no `import.meta.url` resolution, no
// dependency on the host runtime's fs implementation — works identically
// on Vercel Node 22, Cloudflare Workers (where `fs.readFileSync` is only
// partially polyfilled by `nodejs_compat`), Deno, and the browser.
import robotoRegular from "./fonts/Roboto-Regular.ttf" with { type: "binary" };
import robotoBold from "./fonts/Roboto-Bold.ttf" with { type: "binary" };
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm" with { type: "binary" };

const initializedResvg = initWasm(resvgWasm);

const FONT_SIZE = 14;
const LINE_HEIGHT = FONT_SIZE * 1.4;
const CELL_PADDING_X = 12;
const CELL_PADDING_Y = 8;
const HEADER_FILL = "#f5f5f5";
const ZEBRA_FILL = "#fafafa";
const BORDER_COLOR = "#d0d0d0";
const TEXT_COLOR = "#222";
const HEADER_TEXT_COLOR = "#000";
const MAX_CELL_CHARS = 64;

// SVG layout width — drives column-width capping and aspect-ratio shape.
// 1200px is the open-graph standard width (1200×630 for the canonical OG
// card). Telegram preview displays inline at ~512px on mobile / ~1024px on
// desktop and tap-to-expand reveals full-res, so the source must be larger
// than display. 1200 hits both targets without padding.
const SVG_WIDTH = 1200;

// Render scale for the rasterized PNG — 2× the SVG dimensions so the image
// stays sharp on retina screens after Telegram's downscale-to-fit. Output
// width = SVG_WIDTH × RENDER_SCALE = 2400px, well under Telegram's 10000px
// `sendPhoto` ceiling and ~150–400KB per typical table after Resvg's libpng
// encode.
const RENDER_SCALE = 2;

// Hard ceiling on rasterized image height. Photos taller than ~3000px
// scroll awkwardly in Telegram and trip the "huge image" warning. Beyond
// this we clip rows; the agent saw a wide enough output to know the table
// was big anyway.
const MAX_RENDER_HEIGHT = 3000;

// Approx pixel width per char at 14px sans-serif. Heuristic — Resvg
// rasterizes through the system font, so exact metrics aren't available
// without parsing the font file. Tuning toward conservative-wide so cells
// don't visually clip; the cost is wider images.
const CHAR_PX = 7.5;

/**
 * Render a markdown `Table` mdast node as a PNG buffer. Hand-rolled SVG layout
 * (no Satori) — tables are grids, no flex/wrap solver needed. Fonts come from
 * vendored Roboto Regular + Bold (see `loadFonts` for the why); Vercel Bun's
 * serverless image has no system fonts to fall back to. Sized to OG card
 * conventions (1200px wide, 2× scale = 2400px PNG) so Telegram displays the
 * preview crisply on retina and tap-to-expand stays readable. Stop-gap
 * renderer for `mnemonic/115` — delete when chat-sdk ships a `tableRenderer`
 * hook.
 */
export async function renderTablePng(node: MdastTable): Promise<Buffer> {
  const rows = extractRows(node);
  if (rows.length === 0) return emptyPng();

  const colCount = Math.max(...rows.map((r) => r.length));
  const colWidths = computeColumnWidths(rows, colCount);
  const totalWidth = colWidths.reduce((s, w) => s + w, 0) + 1;

  const rowHeights = rows.map((r) => measureRowHeight(r, colWidths));
  const totalHeight = rowHeights.reduce((s, h) => s + h, 0) + 1;

  const svg = buildSvg(rows, colWidths, rowHeights, totalWidth, totalHeight);

  // Render at 2× the SVG width so the rasterized PNG is retina-sharp on
  // Telegram's downscale-to-fit. Cap at MAX_RENDER_HEIGHT so very long
  // tables don't blow the photo height limit.
  const renderWidth = totalWidth * RENDER_SCALE;
  const renderHeight = totalHeight * RENDER_SCALE;
  const fitTo: { mode: "width"; value: number } | { mode: "height"; value: number } =
    renderHeight > MAX_RENDER_HEIGHT
      ? { mode: "height", value: MAX_RENDER_HEIGHT }
      : { mode: "width", value: renderWidth };

  await initializedResvg;
  const resvg = new Resvg(svg, {
    background: "white",
    font: {
      // `loadSystemFonts: false` — Vercel Linux serverless image has no
      // fonts to find, and ignoring system fonts on macOS keeps render
      // identical across environments. `fontBuffers` registers Roboto
      // Regular + Bold; `defaultFontFamily` matches the `font-family`
      // emitted by `buildSvg`. `new Uint8Array(buf)` strips the Buffer
      // prototype — resvg-wasm's WASM boundary expects strict Uint8Array.
      loadSystemFonts: false,
      fontBuffers: [new Uint8Array(robotoRegular), new Uint8Array(robotoBold)],
      defaultFontFamily: "Roboto",
    },
    fitTo,
  });
  const rendered = resvg.render();
  const png = rendered.asPng();
  rendered.free();
  resvg.free();
  return Buffer.from(png);
}

type Row = string[];

function extractRows(node: MdastTable): Row[] {
  const rows: Row[] = [];
  for (const row of node.children as TableRow[]) {
    const cells: string[] = [];
    for (const cell of getNodeChildren(row)) {
      cells.push(cellToText(cell));
    }
    rows.push(cells);
  }
  return rows;
}

function cellToText(node: AnyMdastNode): string {
  // mdast `tableCell` wraps inline children — pull text recursively.
  // Long content is clipped to keep the rendered image bounded.
  const collected: string[] = [];
  walk(node, (n) => {
    const v = getNodeValue(n);
    if (v) collected.push(v);
  });
  const text = collected.join("").replace(/\s+/g, " ").trim();
  return text.length > MAX_CELL_CHARS ? text.slice(0, MAX_CELL_CHARS - 1) + "…" : text;
}

function walk(node: AnyMdastNode, visit: (n: AnyMdastNode) => void): void {
  visit(node);
  for (const child of getNodeChildren(node)) walk(child, visit);
}

function computeColumnWidths(rows: Row[], colCount: number): number[] {
  const ideal = Array.from({ length: colCount }, (_, i) => {
    const longest = Math.max(...rows.map((r) => (r[i] ?? "").length), 1);
    return Math.ceil(longest * CHAR_PX) + CELL_PADDING_X * 2;
  });
  const total = ideal.reduce((s, w) => s + w, 0);
  if (total <= SVG_WIDTH) return ideal;
  const scale = SVG_WIDTH / total;
  return ideal.map((w) => Math.max(40, Math.floor(w * scale)));
}

function measureRowHeight(row: Row, colWidths: number[]): number {
  const lines = row.map((text, i) => wrapLines(text, colWidths[i]!).length);
  const max = Math.max(...lines, 1);
  return max * LINE_HEIGHT + CELL_PADDING_Y * 2;
}

function wrapLines(text: string, colWidth: number): string[] {
  const usable = colWidth - CELL_PADDING_X * 2;
  const charsPerLine = Math.max(4, Math.floor(usable / CHAR_PX));
  if (text.length <= charsPerLine) return [text];
  const lines: string[] = [];
  const words = text.split(" ");
  let cur = "";
  for (const w of words) {
    const next = cur ? cur + " " + w : w;
    if (next.length > charsPerLine) {
      if (cur) lines.push(cur);
      cur = w.length > charsPerLine ? w.slice(0, charsPerLine) : w;
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function buildSvg(rows: Row[], colWidths: number[], rowHeights: number[], W: number, H: number): string {
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`);
  parts.push(`<rect width="${W}" height="${H}" fill="white"/>`);

  let y = 0;
  rows.forEach((row, rowIdx) => {
    const rh = rowHeights[rowIdx]!;
    const fill = rowIdx === 0 ? HEADER_FILL : rowIdx % 2 === 0 ? ZEBRA_FILL : "white";
    parts.push(`<rect x="0" y="${y}" width="${W - 1}" height="${rh}" fill="${fill}"/>`);

    let x = 0;
    row.forEach((text, colIdx) => {
      const cw = colWidths[colIdx]!;
      const lines = wrapLines(text, cw);
      const isHeader = rowIdx === 0;
      const color = isHeader ? HEADER_TEXT_COLOR : TEXT_COLOR;
      const weight = isHeader ? 600 : 400;
      lines.forEach((line, lineIdx) => {
        const ty = y + CELL_PADDING_Y + (lineIdx + 1) * LINE_HEIGHT - 4;
        parts.push(
          `<text x="${x + CELL_PADDING_X}" y="${ty}" font-family="Roboto, sans-serif" font-size="${FONT_SIZE}" font-weight="${weight}" fill="${color}">${escapeXml(line)}</text>`,
        );
      });
      x += cw;
    });

    parts.push(`<line x1="0" y1="${y}" x2="${W - 1}" y2="${y}" stroke="${BORDER_COLOR}" stroke-width="1"/>`);
    y += rh;
  });
  parts.push(`<line x1="0" y1="${y}" x2="${W - 1}" y2="${y}" stroke="${BORDER_COLOR}" stroke-width="1"/>`);

  let cx = 0;
  for (let i = 0; i <= colWidths.length; i++) {
    parts.push(`<line x1="${cx}" y1="0" x2="${cx}" y2="${y}" stroke="${BORDER_COLOR}" stroke-width="1"/>`);
    cx += colWidths[i] ?? 0;
  }

  parts.push(`</svg>`);
  return parts.join("");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function emptyPng(): Buffer {
  // 1×1 transparent PNG. Adapter rejects empty file payloads, so callers
  // should skip rendering on zero-row tables; this is the defensive floor.
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
    "base64",
  );
}
