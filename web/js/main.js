// Wires state -> selection -> heatmap -> canvas. `refresh()` recomputes everything that depends on filters.
import {
  COORDINATE_SIZE, HEAT_GRID_SIZE, HEAT_LAYERS, LOW_EVENT_COUNT, MARKER_TYPES, MAX_PLAYBACK_STEP_SEC, MIN_RUNS_FOR_RATE,
  OUTCOME_LABELS, PLAYBACK_SPEEDS, SMALL_SAMPLE_MATCHES, SUMMARY_GRID_SIZE,
} from "./config.js";
import { codesForEvents, loadIndex, loadMapData, selectMatches, selectRows } from "./data.js";
import { drawEventMarkers, drawHeat, drawMatchPlayers, drawMinimap } from "./draw.js";
import { blurGrid, cellOfPoint, countEventsPerCell, countRuns, countVisitingRunsPerCell, perRunValues, valuesToHeatCanvas } from "./heatmap.js";
import { byId, countBy, describeMatch, fillSelect, formatClock, formatShortDate, renderLayerRadios, renderMarkerChecks, setMarkerChecks } from "./ui.js";

const canvas = byId("map-canvas");
const ctx = canvas.getContext("2d");
const view = { scale: 1, minScale: 1, x: 0, y: 0 };
const ALL_MARKER_KEYS = MARKER_TYPES.map((type) => type.key);
const state = {
  mapId: "AmbroseValley", date: "all", outcome: "all", matchIndex: -1,
  layerKey: "traffic", metric: "count", showHeat: true, enabledMarkers: new Set(),
  fromSec: 0, toSec: 0, playing: false, speed: 10, hoverCell: null, pointer: null, drillCell: null,
};
let index, mapData, mapImage, selection, cellStats, heat, latestMapRequest, playbackFrameRequest;
const loadedMaps = {};

const currentLayer = () => HEAT_LAYERS.find((layer) => layer.key === state.layerKey);
const supportsPerRun = (layer) => layer.key !== "botTraffic"; // bot runs are not "visitors": per-run rates use human runs
const timelineLength = () => (state.matchIndex >= 0 ? mapData.matches[state.matchIndex].durationSec : index.maps[state.mapId].maxSeconds);

// ---------- choosing what to look at ----------

async function loadMap(mapId) {
  if (!loadedMaps[mapId]) {
    const image = new Image();
    image.src = index.maps[mapId].image;
    const [data] = await Promise.all([loadMapData(mapId, index), image.decode()]);
    loadedMaps[mapId] = { data, image };
  }
  return loadedMaps[mapId];
}

async function switchMap(mapId) {
  latestMapRequest = mapId;
  const loaded = await loadMap(mapId);
  if (latestMapRequest !== mapId) return; // the user picked another map while this one was loading
  ({ data: mapData, image: mapImage } = loaded);
  Object.assign(state, { mapId, date: "all", outcome: "all", matchIndex: -1, drillCell: null });
  applyModeDefaults();
  byId("map-select").value = mapId;
  fillDateAndOutcomeChoices();
  rebuildMatchChoices();
  fitViewToCanvas();
  resetTimeWindow();
  refresh();
}

function fillDateAndOutcomeChoices() {
  const matchesPerDate = countBy(mapData.matches, (match) => match.date);
  const matchesPerOutcome = countBy(mapData.matches, (match) => match.outcome);
  const dateChoices = index.maps[state.mapId].dates.map((date) => ({ value: date, label: `${formatShortDate(date)} (${matchesPerDate[date] || 0} matches)` }));
  const outcomeChoices = Object.entries(OUTCOME_LABELS).filter(([value]) => matchesPerOutcome[value]).map(([value, label]) => ({ value, label: `${label} (${matchesPerOutcome[value]})` }));
  fillSelect(byId("date-select"), [{ value: "all", label: "All days" }, ...dateChoices], "all");
  fillSelect(byId("outcome-select"), [{ value: "all", label: "Any outcome" }, ...outcomeChoices], "all");
}

function rebuildMatchChoices() {
  const flags = selectMatches(mapData, { date: state.date, outcome: state.outcome, matchIndex: -1 });
  const choices = mapData.matches
    .map((match, matchIndex) => ({ value: String(matchIndex), label: describeMatch(match), keep: flags[matchIndex] }))
    .filter((choice) => choice.keep);
  fillSelect(byId("match-select"), [{ value: "-1", label: `All ${choices.length} matches (heatmap)` }, ...choices], "-1");
}

function onFilterChanged() {
  rebuildMatchChoices();
  chooseMatch(-1);
}

function chooseMatch(matchIndex) {
  const wasReplaying = state.matchIndex >= 0;
  const matchChanged = matchIndex !== state.matchIndex;
  state.matchIndex = matchIndex;
  if (wasReplaying !== matchIndex >= 0) applyModeDefaults();
  if (matchChanged) resetTimeWindow();
  refresh();
}

// Replay wants every marker and no heat; the overview starts as a clean heatmap.
function applyModeDefaults() {
  const replaying = state.matchIndex >= 0;
  state.showHeat = !replaying;
  state.enabledMarkers = new Set(replaying ? ALL_MARKER_KEYS : []);
  byId("heat-toggle").checked = state.showHeat;
  setMarkerChecks(byId("marker-checks"), state.enabledMarkers);
}

function resetTimeWindow() {
  stopPlayback();
  for (const slider of [byId("from-slider"), byId("to-slider")]) slider.max = timelineLength();
  state.fromSec = 0;
  state.toSec = timelineLength();
}

// ---------- recomputing what is shown ----------

function refresh() {
  const matchFlags = selectMatches(mapData, state);
  selection = {
    matchFlags,
    matchCount: matchFlags.reduce((total, flag) => total + flag, 0),
    rowIndices: selectRows(mapData, matchFlags, state.fromSec, state.toSec),
  };
  cellStats = summarizeCells();
  heat = state.showHeat && selection.matchCount > 0 ? buildHeat() : null;
  syncTimeControls();
  renderSummary();
  renderDrilldown();
  updateMetricControls();
  renderHeatLegend();
  showTooltipFor(state.pointer);
  draw();
  if (!state.playing) saveHash();
}

// Coarse per-cell numbers used for hover text and the "per run" measure.
function summarizeCells() {
  const { rows, eventCode } = mapData;
  const counts = Object.fromEntries(HEAT_LAYERS.map((layer) => [layer.key, countEventsPerCell(rows, selection.rowIndices, codesForEvents(layer.events, eventCode), SUMMARY_GRID_SIZE)]));
  return {
    counts,
    visits: countVisitingRunsPerCell(rows, selection.rowIndices, eventCode.Position, SUMMARY_GRID_SIZE),
    totalRuns: countRuns(rows, selection.rowIndices, eventCode.Position),
  };
}

function buildHeat() {
  const layer = currentLayer();
  if (state.metric === "perRun" && supportsPerRun(layer)) {
    const values = perRunValues(cellStats.counts[layer.key], cellStats.visits, cellStats.totalRuns, layer.key === "traffic");
    return { ...valuesToHeatCanvas(values, SUMMARY_GRID_SIZE), smooth: false, perRun: true };
  }
  const counts = countEventsPerCell(mapData.rows, selection.rowIndices, codesForEvents(layer.events, mapData.eventCode), HEAT_GRID_SIZE);
  return { ...valuesToHeatCanvas(blurGrid(counts, HEAT_GRID_SIZE), HEAT_GRID_SIZE), smooth: true, perRun: false };
}

function syncTimeControls() {
  byId("from-slider").value = state.fromSec;
  byId("to-slider").value = state.toSec;
  byId("from-label").textContent = formatClock(state.fromSec);
  byId("to-label").textContent = formatClock(state.toSec);
  byId("play-button").disabled = selection.matchCount === 0;
}

// ---------- drill-down: from a map cell to the runs behind it ----------

const MAX_DRILLDOWN_ROWS = 40;

function copyWorldPosition(point) {
  const { x, z } = worldOf(point);
  navigator.clipboard?.writeText(`${x.toFixed(0)}, ${z.toFixed(0)}`).catch(() => {});
}

// Events of the active layer inside one coarse cell, within the current filters and time window.
// Traffic layers list each run once (its first sample in the cell); event layers list every event.
function eventsInCell(cell) {
  const { rows, rowMatch, eventCode } = mapData;
  const layer = currentLayer();
  const codes = codesForEvents(layer.events, eventCode);
  const onePerRun = layer.key === "traffic" || layer.key === "botTraffic";
  const seenRuns = new Set();
  const hits = [];
  for (const row of selection.rowIndices) {
    if (!codes.includes(rows.event[row]) || cellOfPoint(rows.x[row], rows.y[row], SUMMARY_GRID_SIZE) !== cell) continue;
    if (onePerRun) {
      if (seenRuns.has(rows.run[row])) continue;
      seenRuns.add(rows.run[row]);
    }
    hits.push({ match: rowMatch[row], seconds: rows.t[row] });
  }
  return hits;
}

function renderDrilldown() {
  const panel = byId("drilldown");
  panel.hidden = state.drillCell === null || state.matchIndex >= 0;
  if (panel.hidden) return;
  const hits = eventsInCell(state.drillCell);
  const size = COORDINATE_SIZE / SUMMARY_GRID_SIZE;
  const centre = { x: ((state.drillCell % SUMMARY_GRID_SIZE) + 0.5) * size, y: (Math.floor(state.drillCell / SUMMARY_GRID_SIZE) + 0.5) * size };
  const world = worldOf(centre);
  const matchCount = new Set(hits.map((hit) => hit.match)).size;
  const rowsHtml = hits.slice(0, MAX_DRILLDOWN_ROWS).map((hit, i) =>
    `<button type="button" class="drill-row" data-i="${i}">at ${formatClock(hit.seconds)} → ${describeMatch(mapData.matches[hit.match])}</button>`).join("");
  panel.innerHTML = `<h2>Runs in this area <button type="button" id="drill-close" aria-label="Close">✕</button></h2>
    <p class="note"><b>${hits.length}</b> × ${currentLayer().label.toLowerCase()} in <b>${matchCount}</b> ${matchCount === 1 ? "match" : "matches"} · centre world x ${world.x.toFixed(0)}, z ${world.z.toFixed(0)}
    <button type="button" id="drill-copy">Copy</button></p>
    ${hits.length ? `<p class="note">Click a row to replay that match at that moment.</p>` : `<p class="note">Nothing from this layer here with the current filters.</p>`}
    <div class="drill-list">${rowsHtml}</div>
    ${hits.length > MAX_DRILLDOWN_ROWS ? `<p class="note">Showing the first ${MAX_DRILLDOWN_ROWS} of ${hits.length}; narrow the filters or time window to see the rest.</p>` : ""}`;
  panel.querySelector("#drill-close").onclick = () => { state.drillCell = null; renderDrilldown(); draw(); };
  panel.querySelector("#drill-copy").onclick = () => copyWorldPosition(centre);
  panel.querySelectorAll(".drill-row").forEach((button) => { button.onclick = () => openReplayAt(hits[Number(button.dataset.i)]); });
}

// Replay one match, with the time window set to 30 s before to 10 s after the chosen moment.
function openReplayAt({ match, seconds }) {
  byId("match-select").value = String(match);
  chooseMatch(match); // resets the window and clears the drill-down, so set the window afterwards
  state.fromSec = Math.max(0, seconds - 30);
  state.toSec = Math.min(timelineLength(), seconds + 10);
  refresh();
}

// ---------- text panels ----------

function renderSummary() {
  const layer = currentLayer();
  const layerTotal = cellStats.counts[layer.key].reduce((total, count) => total + count, 0);
  const noun = (count, singular, plural) => (count === 1 ? singular : plural);
  const lines = [];
  if (state.matchIndex >= 0) lines.push(describeMatch(mapData.matches[state.matchIndex]));
  lines.push(`<b>${selection.matchCount}</b> ${noun(selection.matchCount, "match", "matches")} · <b>${cellStats.totalRuns}</b> human ${noun(cellStats.totalRuns, "run", "runs")} in view`);
  lines.push(`<b>${layerTotal.toLocaleString()}</b> × ${layer.label.toLowerCase()} in the time window`);
  if (state.matchIndex < 0 && selection.matchCount > 0 && selection.matchCount < SMALL_SAMPLE_MATCHES) lines.push(`⚠ Only ${selection.matchCount} matches selected: treat patterns as tentative.`);
  if (state.matchIndex < 0 && selection.matchCount > 0 && layerTotal < LOW_EVENT_COUNT) lines.push(`⚠ Only ${layerTotal} events in this layer: a hot spot may be a single incident.`);
  byId("summary").innerHTML = lines.map((line) => `<p>${line}</p>`).join("");
  byId("empty-message").hidden = selection.matchCount > 0;
}

function updateMetricControls() {
  const layer = currentLayer();
  const botMatches = mapData.matches.filter((match) => match.bots > 0).length;
  byId("metric-select").disabled = !supportsPerRun(layer);
  byId("metric-note").textContent = !supportsPerRun(layer)
    ? `Bot paths were recorded in only ${botMatches} of ${mapData.matches.length} matches on this map, so this layer is a thin sample.`
    : state.metric === "perRun"
      ? `Coarse cells. Cells visited by fewer than ${MIN_RUNS_FOR_RATE} runs are hidden.`
      : "Smoothed density: busy areas dominate. Try 'rate per visiting run' to see risk instead of footfall.";
}

function renderHeatLegend() {
  const legend = byId("heat-legend");
  legend.hidden = !heat;
  if (!heat) return;
  const layer = currentLayer();
  const measure = !heat.perRun ? "density" : layer.key === "traffic" ? "share of runs passing through" : "events per run that visited";
  const highEnd = !heat.perRun ? "busiest spot in this view" : layer.key === "traffic" ? `${Math.round(heat.peak * 100)}% of runs` : `${heat.peak.toFixed(2)} per run`;
  legend.innerHTML = `<b>${layer.label}</b> · ${measure}<div class="ramp"></div><div class="scale"><span>none</span><span>${highEnd}</span></div><div class="scale"><span>square-root colour scale, relative to this view</span></div>`;
}

// Inverse of the README formula (build_data.py world_to_minimap_pixels): minimap pixels -> engine x/z.
function worldOf(point) {
  const { scale, originX, originZ } = index.maps[state.mapId].world;
  return { x: originX + (point.x / COORDINATE_SIZE) * scale, z: originZ + (1 - point.y / COORDINATE_SIZE) * scale };
}

function describeCell(cell) {
  const { counts, visits, totalRuns } = cellStats;
  const share = totalRuns ? Math.round((100 * visits[cell]) / totalRuns) : 0;
  const layerLines = HEAT_LAYERS.filter((layer) => layer.key !== "traffic" && layer.key !== "botTraffic").map((layer) => {
    const line = `${layer.label}: ${counts[layer.key][cell]}`;
    return layer.key === state.layerKey ? `<b>${line}</b>` : line;
  });
  const world = worldOf(state.hoverPoint);
  return [`<b>World x ${world.x.toFixed(0)}, z ${world.z.toFixed(0)}</b> <span class="note">(${state.matchIndex < 0 ? "click for the runs here" : "click to copy"})</span>`, `Runs through this area: ${visits[cell]} of ${totalRuns} (${share}%)`, ...layerLines].join("<br>");
}

// ---------- drawing ----------

function draw() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#12141a";
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.x, dpr * view.y);
  const pixelSize = (screenPixels) => screenPixels / view.scale;

  drawMinimap(ctx, mapImage, Boolean(heat));
  if (heat) drawHeat(ctx, heat.canvas, heat.smooth);
  if (state.matchIndex >= 0) drawMatchPlayers(ctx, mapData, state.matchIndex, state.fromSec, state.toSec, pixelSize);
  drawEventMarkers(ctx, mapData.rows, selection.rowIndices, markerStyleByEventCode(), pixelSize);
  drawCellOutline(state.drillCell, "#4cc9f0", 2.5, pixelSize);
  drawHoverCell(pixelSize);
}

function markerStyleByEventCode() {
  const styles = {};
  for (const type of MARKER_TYPES.filter((marker) => state.enabledMarkers.has(marker.key))) {
    for (const code of codesForEvents(type.events, mapData.eventCode)) styles[code] = type;
  }
  return styles;
}

function drawCellOutline(cell, colour, lineWidth, pixelSize) {
  if (cell === null) return;
  const size = COORDINATE_SIZE / SUMMARY_GRID_SIZE;
  ctx.strokeStyle = colour;
  ctx.lineWidth = pixelSize(lineWidth);
  ctx.strokeRect((cell % SUMMARY_GRID_SIZE) * size, Math.floor(cell / SUMMARY_GRID_SIZE) * size, size, size);
}

function drawHoverCell(pixelSize) {
  if (state.hoverCell) drawCellOutline(state.hoverCell.row * SUMMARY_GRID_SIZE + state.hoverCell.col, "#fff", 1.5, pixelSize);
}

// ---------- zoom / pan / hover ----------

function fitViewToCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const size = Math.min(canvas.clientWidth, canvas.clientHeight);
  Object.assign(view, { scale: size / COORDINATE_SIZE, minScale: size / COORDINATE_SIZE, x: (canvas.clientWidth - size) / 2, y: (canvas.clientHeight - size) / 2 });
}

const screenToMap = (screenX, screenY) => ({ x: (screenX - view.x) / view.scale, y: (screenY - view.y) / view.scale });

function zoomAt(screenX, screenY, factor) {
  const newScale = Math.min(view.minScale * 16, Math.max(view.minScale, view.scale * factor));
  view.x = screenX - ((screenX - view.x) * newScale) / view.scale;
  view.y = screenY - ((screenY - view.y) * newScale) / view.scale;
  view.scale = newScale;
}

function showTooltipFor(pointer) {
  const tooltip = byId("tooltip");
  state.hoverCell = null;
  state.hoverPoint = null;
  const point = pointer && screenToMap(pointer.x, pointer.y);
  const insideMap = point && point.x >= 0 && point.y >= 0 && point.x < COORDINATE_SIZE && point.y < COORDINATE_SIZE;
  tooltip.hidden = !insideMap || selection.matchCount === 0;
  if (tooltip.hidden) return;
  state.hoverPoint = point;
  const cell = cellOfPoint(point.x, point.y, SUMMARY_GRID_SIZE);
  state.hoverCell = { col: cell % SUMMARY_GRID_SIZE, row: Math.floor(cell / SUMMARY_GRID_SIZE) };
  tooltip.innerHTML = describeCell(cell);
  tooltip.style.left = `${Math.min(pointer.x + 14, canvas.clientWidth - 270)}px`;
  tooltip.style.top = `${Math.min(pointer.y + 14, canvas.clientHeight - 150)}px`;
}

function setUpMapInteraction() {
  let dragOffset = null;
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    zoomAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.2 : 1 / 1.2);
    showTooltipFor(state.pointer);
    draw();
  }, { passive: false });
  canvas.addEventListener("pointerdown", (event) => {
    dragOffset = { x: event.clientX - view.x, y: event.clientY - view.y, startX: event.clientX, startY: event.clientY };
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("dragging");
  });
  canvas.addEventListener("pointermove", (event) => {
    if (dragOffset) {
      view.x = event.clientX - dragOffset.x;
      view.y = event.clientY - dragOffset.y;
    }
    state.pointer = { x: event.offsetX, y: event.offsetY };
    showTooltipFor(state.pointer);
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    const wasClick = dragOffset && Math.hypot(event.clientX - dragOffset.startX, event.clientY - dragOffset.startY) < 4;
    dragOffset = null;
    canvas.classList.remove("dragging");
    if (!wasClick || !state.hoverPoint) return;
    if (state.matchIndex < 0) {
      state.drillCell = cellOfPoint(state.hoverPoint.x, state.hoverPoint.y, SUMMARY_GRID_SIZE);
      renderDrilldown();
      draw();
    } else copyWorldPosition(state.hoverPoint);
  });
  canvas.addEventListener("pointerleave", () => { state.pointer = null; showTooltipFor(null); draw(); });
  window.addEventListener("resize", () => { fitViewToCanvas(); draw(); });
  byId("reset-view-button").addEventListener("click", () => { fitViewToCanvas(); draw(); });
}

// ---------- playback ----------

let lastFrameTime = null;

function startPlayback() {
  if (state.toSec >= timelineLength()) state.toSec = state.fromSec;
  state.playing = true;
  byId("play-button").textContent = "⏸ Pause";
  lastFrameTime = null;
  playbackFrameRequest = requestAnimationFrame(playbackFrame);
}

function stopPlayback() {
  state.playing = false;
  cancelAnimationFrame(playbackFrameRequest);
  byId("play-button").textContent = "▶ Play";
}

function playbackFrame(timestamp) {
  const elapsedSeconds = lastFrameTime === null ? 0 : Math.min(MAX_PLAYBACK_STEP_SEC, (timestamp - lastFrameTime) / 1000);
  lastFrameTime = timestamp;
  state.toSec = Math.min(timelineLength(), state.toSec + elapsedSeconds * state.speed);
  refresh();
  if (state.toSec >= timelineLength()) { stopPlayback(); saveHash(); }
  else playbackFrameRequest = requestAnimationFrame(playbackFrame);
}

// ---------- shareable link: the whole view lives in location.hash ----------

function saveHash() {
  const params = new URLSearchParams({
    map: state.mapId, date: state.date, outcome: state.outcome, layer: state.layerKey, metric: state.metric,
    heat: state.showHeat ? "1" : "0", markers: [...state.enabledMarkers].join(","), from: Math.round(state.fromSec), to: Math.round(state.toSec),
  });
  if (state.matchIndex >= 0) params.set("match", mapData.matches[state.matchIndex].id);
  history.replaceState(null, "", `#${params}`);
}

// Runs after switchMap(): each value is validated against what this map actually offers, so a stale link degrades to defaults.
function applyHash(params) {
  const dates = index.maps[state.mapId].dates;
  if (dates.includes(params.get("date"))) state.date = params.get("date");
  if (params.get("outcome") in OUTCOME_LABELS) state.outcome = params.get("outcome");
  byId("date-select").value = state.date;
  byId("outcome-select").value = state.outcome;
  rebuildMatchChoices();
  const matchIndex = mapData.matches.findIndex((match) => match.id === params.get("match"));
  state.matchIndex = matchIndex;
  applyModeDefaults();
  byId("match-select").value = String(matchIndex);
  resetTimeWindow();
  if (HEAT_LAYERS.some((layer) => layer.key === params.get("layer"))) state.layerKey = params.get("layer");
  document.querySelector(`input[name=layer][value=${state.layerKey}]`).checked = true;
  if (["count", "perRun"].includes(params.get("metric"))) state.metric = params.get("metric");
  byId("metric-select").value = state.metric;
  if (params.has("heat")) state.showHeat = params.get("heat") === "1";
  byId("heat-toggle").checked = state.showHeat;
  if (params.has("markers")) state.enabledMarkers = new Set(params.get("markers").split(",").filter((key) => ALL_MARKER_KEYS.includes(key)));
  setMarkerChecks(byId("marker-checks"), state.enabledMarkers);
  const length = timelineLength();
  const from = Number(params.get("from")), to = Number(params.get("to"));
  if (params.has("from") && params.has("to") && from <= to && to <= length) Object.assign(state, { fromSec: from, toSec: to });
  refresh();
}

// ---------- controls ----------

function setUpControls() {
  fillSelect(byId("map-select"), Object.keys(index.maps).map((mapId) => ({ value: mapId, label: mapId.replace(/([a-z])([A-Z])/g, "$1 $2") })), state.mapId);
  fillSelect(byId("speed-select"), PLAYBACK_SPEEDS.map((speed) => ({ value: speed, label: `${speed}×` })), state.speed);
  renderLayerRadios(byId("layer-radios"), HEAT_LAYERS, state.layerKey, (key) => { state.layerKey = key; refresh(); });
  renderMarkerChecks(byId("marker-checks"), MARKER_TYPES, state.enabledMarkers, (key, isOn) => {
    if (isOn) state.enabledMarkers.add(key);
    else state.enabledMarkers.delete(key);
    draw();
  });

  byId("map-select").addEventListener("change", (event) => switchMap(event.target.value));
  byId("date-select").addEventListener("change", (event) => { state.date = event.target.value; onFilterChanged(); });
  byId("outcome-select").addEventListener("change", (event) => { state.outcome = event.target.value; onFilterChanged(); });
  byId("match-select").addEventListener("change", (event) => chooseMatch(Number(event.target.value)));
  byId("metric-select").addEventListener("change", (event) => { state.metric = event.target.value; refresh(); });
  byId("heat-toggle").addEventListener("change", (event) => { state.showHeat = event.target.checked; refresh(); });
  byId("from-slider").addEventListener("input", (event) => { state.fromSec = Math.min(Number(event.target.value), state.toSec); refresh(); });
  byId("to-slider").addEventListener("input", (event) => { state.toSec = Math.max(Number(event.target.value), state.fromSec); refresh(); });
  byId("play-button").addEventListener("click", () => (state.playing ? stopPlayback() : startPlayback()));
  byId("copy-link-button").addEventListener("click", async (event) => {
    await navigator.clipboard?.writeText(location.href).catch(() => {});
    event.target.textContent = "Link copied";
    setTimeout(() => (event.target.textContent = "Copy link to this view"), 1500);
  });
  byId("speed-select").addEventListener("change", (event) => { state.speed = Number(event.target.value); });
}

async function start() {
  index = await loadIndex();
  setUpControls();
  setUpMapInteraction();
  const params = new URLSearchParams(location.hash.slice(1));
  await switchMap(params.get("map") in index.maps ? params.get("map") : state.mapId);
  if (params.has("map")) applyHash(params);
  byId("loading").hidden = true;
  fitViewToCanvas();
  draw();
}

start().catch((error) => { byId("loading").textContent = `Could not start: ${error.message}`; });
