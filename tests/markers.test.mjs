// Death icons must be drawn above the derived run-end ring and above loot, whatever the row order.
import test from "node:test";
import assert from "node:assert/strict";
import { MARKER_TYPES } from "../web/js/config.js";

globalThis.Path2D = class {};
const { drawEventMarkers } = await import("../web/js/draw.js");

test("deaths draw after run-end ring and loot even when the ring row comes later", () => {
  const style = Object.fromEntries(MARKER_TYPES.map((type) => [type.key, type]));
  const stylesByCode = { 0: style.storm, 1: style.end, 2: style.loot };
  const rows = { event: [0, 1, 2], x: [1, 1, 1], y: [1, 1, 1] }; // storm death, then ring, then loot: worst case
  const colours = [];
  const noop = () => {};
  const ctx = { save: noop, restore: noop, translate: noop, scale: noop, stroke: noop, fillStyle: "", fill() { colours.push(this.fillStyle); } };
  drawEventMarkers(ctx, rows, [0, 1, 2], stylesByCode, (n) => n);
  assert.deepEqual(colours, [style.end.color, style.loot.color, style.storm.color]);
});
