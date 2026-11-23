// Run:  node --test tests/
import assert from "node:assert/strict";
import test from "node:test";
import { blurGrid, cellOfPoint, countEventsPerCell, countRuns, countVisitingRunsPerCell, perRunValues } from "../web/js/heatmap.js";
import { selectMatches, selectRows } from "../web/js/data.js";
import { positionAtTime } from "../web/js/draw.js";

const rows = {
  run: Int32Array.from([0, 0, 0, 1, 1]),
  t: Int32Array.from([0, 5, 10, 0, 5]),
  x: Float32Array.from([10, 10, 600, 10, 10]),
  y: Float32Array.from([10, 10, 600, 10, 10]),
  event: Uint8Array.from([0, 0, 7, 0, 7]),
};

test("cellOfPoint maps minimap coordinates to grid cells and clamps the edges", () => {
  assert.equal(cellOfPoint(0, 0, 4), 0);
  assert.equal(cellOfPoint(1023, 0, 4), 3);
  assert.equal(cellOfPoint(0, 1023, 4), 12);
  assert.equal(cellOfPoint(5000, 5000, 4), 15);
});

test("countEventsPerCell counts only the requested events", () => {
  const counts = countEventsPerCell(rows, [0, 1, 2, 3, 4], [7], 4);
  assert.equal(counts[cellOfPoint(600, 600, 4)], 1);
  assert.equal(counts[0], 1);
});

test("a run that stays in one cell is one visit, not one per sample", () => {
  const visits = countVisitingRunsPerCell(rows, [0, 1, 2, 3, 4], 0, 4);
  assert.equal(visits[0], 2);
});

test("countRuns counts distinct runs with position samples", () => {
  assert.equal(countRuns(rows, [0, 1, 2, 3, 4], 0), 2);
});

test("per-run values hide cells that too few runs visited", () => {
  const values = perRunValues(Float32Array.from([4, 4]), Float32Array.from([2, 10]), 10, false);
  assert.equal(values[0], 0);
  assert.ok(Math.abs(values[1] - 0.4) < 1e-6);
  assert.deepEqual(Array.from(perRunValues(Float32Array.from([0, 0]), Float32Array.from([2, 10]), 10, true)), [0, 1]);
});

test("blurGrid spreads a single dot but keeps the total roughly the same", () => {
  const grid = new Float32Array(25);
  grid[12] = 9;
  const blurred = blurGrid(grid, 5);
  assert.ok(blurred[12] < 9 && blurred[11] > 0);
  assert.ok(Math.abs(blurred.reduce((a, b) => a + b) - 9) < 1e-4);
});

test("match and time filters select the right rows", () => {
  const mapData = {
    matches: [{ date: "2026-02-10", outcome: "storm" }, { date: "2026-02-11", outcome: "survived" }],
    rows: { t: Int32Array.from([0, 5, 10, 0, 5]) },
    matchRowStart: Int32Array.from([0, 3, 5]),
  };
  assert.deepEqual(Array.from(selectMatches(mapData, { date: "2026-02-11", outcome: "all", matchIndex: -1 })), [0, 1]);
  assert.deepEqual(Array.from(selectMatches(mapData, { date: "all", outcome: "storm", matchIndex: -1 })), [1, 0]);
  assert.deepEqual(Array.from(selectMatches(mapData, { date: "all", outcome: "all", matchIndex: 1 })), [0, 1]);
  assert.deepEqual(Array.from(selectRows(mapData, Uint8Array.from([1, 1]), 5, 10)), [1, 2, 4]);
});

test("visits are counted per run even when runs are interleaved in the selection", () => {
  const interleaved = { run: Int32Array.from([0, 1, 0, 1]), event: Uint8Array.from([0, 0, 0, 0]), x: Float32Array.from([10, 10, 10, 10]), y: Float32Array.from([10, 10, 10, 10]) };
  assert.equal(countVisitingRunsPerCell(interleaved, [0, 1, 2, 3], 0, 4)[0], 2);
});

const path = { t: Int32Array.from([0, 5, 60, 65]), x: Float32Array.from([0, 10, 100, 110]), y: Float32Array.from([0, 0, 0, 0]) };
const allSamples = [0, 1, 2, 3];

test("positionAtTime interpolates between close samples", () => {
  assert.deepEqual(positionAtTime(path, allSamples, 2.5), { x: 5, y: 0 });
});

test("positionAtTime does not bridge a long gap, but finds the first sample after it", () => {
  assert.equal(positionAtTime(path, allSamples, 30), null);
  assert.deepEqual(positionAtTime(path, allSamples, 60), { x: 100, y: 0 });
});

test("positionAtTime is null before the first and after the last sample", () => {
  assert.equal(positionAtTime(path, allSamples, -1), null);
  assert.equal(positionAtTime(path, allSamples, 66), null);
});
