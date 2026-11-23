// Canvas drawing. Everything is drawn in minimap coordinates (0-1024); the caller sets the zoom/pan transform.
import { BOT_STYLE, COORDINATE_SIZE, HUMAN_STYLE, MAX_INTERPOLATION_GAP_SEC, MINIMAP_DIM_UNDER_HEAT } from "./config.js";

export function drawMinimap(ctx, image, dimForHeat) {
  ctx.drawImage(image, 0, 0, COORDINATE_SIZE, COORDINATE_SIZE);
  if (!dimForHeat) return;
  ctx.fillStyle = `rgba(0, 0, 0, ${MINIMAP_DIM_UNDER_HEAT})`;
  ctx.fillRect(0, 0, COORDINATE_SIZE, COORDINATE_SIZE);
}

export function drawHeat(ctx, heatCanvas, smooth) {
  ctx.imageSmoothingEnabled = smooth;
  ctx.drawImage(heatCanvas, 0, 0, COORDINATE_SIZE, COORDINATE_SIZE);
  ctx.imageSmoothingEnabled = true;
}

// Player heads. `pixelSize(n)` (passed by callers) converts n screen pixels into minimap coordinates so marks keep their size when zooming.
function traceHead(ctx, shape, x, y, radius) {
  ctx.beginPath();
  if (shape === "circle") ctx.arc(x, y, radius, 0, 2 * Math.PI);
  if (shape === "square") ctx.rect(x - radius, y - radius, 2 * radius, 2 * radius);
}

const MARKER_SCREEN_SIZE = 10; // icon width in screen pixels
const ICON_GRID = 24; // icons in config.js are drawn on a 24x24 grid
const iconPaths = new Map(); // SVG path string -> Path2D, built once

export function drawEventMarkers(ctx, rows, rowIndices, markerStyleByEventCode, pixelSize) {
  const scale = pixelSize(MARKER_SCREEN_SIZE) / ICON_GRID;
  ctx.lineWidth = 4; // in icon units: a dark halo so icons read on any minimap colour
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#000";
  const drawable = [];
  for (const row of rowIndices) {
    const style = markerStyleByEventCode[rows.event[row]];
    if (style) drawable.push({ row, style });
  }
  drawable.sort((a, b) => a.style.z - b.style.z); // stable: ties keep time order
  for (const { row, style } of drawable) {
    if (!iconPaths.has(style.icon)) iconPaths.set(style.icon, new Path2D(style.icon));
    const path = iconPaths.get(style.icon);
    ctx.save();
    ctx.translate(rows.x[row], rows.y[row]);
    ctx.scale(scale, scale);
    ctx.translate(-ICON_GRID / 2, -ICON_GRID / 2);
    ctx.stroke(path);
    ctx.fillStyle = style.color;
    ctx.fill(path);
    ctx.restore();
  }
}

// Samples of one run, as {start, end} row ranges inside a match block, split by run.
function runRangesInMatch(mapData, matchIndex) {
  const { rows, matchRowStart } = mapData;
  const ranges = [];
  for (let row = matchRowStart[matchIndex]; row < matchRowStart[matchIndex + 1]; row++) {
    const last = ranges[ranges.length - 1];
    if (last && last.run === rows.run[row]) last.end = row + 1;
    else ranges.push({ run: rows.run[row], start: row, end: row + 1 });
  }
  return ranges;
}

// Where a run was at `seconds`: exactly on a sample, or interpolated between two samples that are
// close together in time. Null before the first sample, after the last, or inside a long gap.
export function positionAtTime(rows, positionRows, seconds) {
  for (let i = 0; i < positionRows.length; i++) {
    const current = positionRows[i];
    if (rows.t[current] === seconds) return { x: rows.x[current], y: rows.y[current] };
    const next = positionRows[i + 1];
    if (next === undefined || seconds < rows.t[current] || seconds >= rows.t[next]) continue; // a hit on `next` is found on the next pass
    const gap = rows.t[next] - rows.t[current];
    if (gap > MAX_INTERPOLATION_GAP_SEC) return null;
    const blend = (seconds - rows.t[current]) / gap;
    return { x: rows.x[current] + (rows.x[next] - rows.x[current]) * blend, y: rows.y[current] + (rows.y[next] - rows.y[current]) * blend };
  }
  return null;
}

export function drawMatchPlayers(ctx, mapData, matchIndex, fromSec, toSec, pixelSize) {
  const { rows, runs, eventCode } = mapData;
  const isPosition = (row) => rows.event[row] === eventCode.Position || rows.event[row] === eventCode.BotPosition;
  const runsWithPositions = runRangesInMatch(mapData, matchIndex).map(({ run, start, end }) => ({
    run,
    positionRows: Array.from({ length: end - start }, (_, i) => start + i).filter(isPosition),
  }));
  const botsFirst = [...runsWithPositions].sort((a, b) => Number(runs[a.run].isHuman) - Number(runs[b.run].isHuman));

  for (const { run, positionRows } of botsFirst) {
    const style = runs[run].isHuman ? HUMAN_STYLE : BOT_STYLE;
    const visibleRows = positionRows.filter((row) => rows.t[row] >= fromSec && rows.t[row] <= toSec);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = pixelSize(style.lineWidth);
    ctx.globalAlpha = runs[run].isHuman ? 1 : 0.75;
    ctx.beginPath();
    visibleRows.forEach((row, i) => {
      const startsNewSegment = i === 0 || rows.t[row] - rows.t[visibleRows[i - 1]] > MAX_INTERPOLATION_GAP_SEC;
      if (startsNewSegment) ctx.moveTo(rows.x[row], rows.y[row]);
      else ctx.lineTo(rows.x[row], rows.y[row]);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;

    const head = positionAtTime(rows, positionRows, toSec);
    if (!head) continue;
    ctx.fillStyle = style.color;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = pixelSize(1.5);
    traceHead(ctx, style.headShape, head.x, head.y, pixelSize(style.headRadius));
    ctx.fill();
    ctx.stroke();
  }
}
