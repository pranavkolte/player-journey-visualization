// Turning event rows into per-cell numbers and then into a coloured heat image.
import { COORDINATE_SIZE, MIN_RUNS_FOR_RATE } from "./config.js";

export function cellOfPoint(x, y, gridSize) {
  const toCell = (value) => Math.max(0, Math.min(gridSize - 1, Math.floor((value / COORDINATE_SIZE) * gridSize)));
  return toCell(y) * gridSize + toCell(x);
}

export function countEventsPerCell(rows, rowIndices, eventCodes, gridSize) {
  const counts = new Float32Array(gridSize * gridSize);
  for (const row of rowIndices) {
    if (eventCodes.includes(rows.event[row])) counts[cellOfPoint(rows.x[row], rows.y[row], gridSize)]++;
  }
  return counts;
}

// A run that lingers in a cell (many samples) still counts as one visit.
export function countVisitingRunsPerCell(rows, rowIndices, positionCode, gridSize) {
  const visits = new Float32Array(gridSize * gridSize);
  const visitedPairs = new Set();
  for (const row of rowIndices) {
    if (rows.event[row] !== positionCode) continue;
    const cell = cellOfPoint(rows.x[row], rows.y[row], gridSize);
    const runAndCell = rows.run[row] * gridSize * gridSize + cell;
    if (!visitedPairs.has(runAndCell)) {
      visitedPairs.add(runAndCell);
      visits[cell]++;
    }
  }
  return visits;
}

export function countRuns(rows, rowIndices, positionCode) {
  const runs = new Set();
  for (const row of rowIndices) if (rows.event[row] === positionCode) runs.add(rows.run[row]);
  return runs.size;
}

// Per-cell value for the "per run" view: share of runs that visited (traffic) or events per visiting run.
export function perRunValues(eventCounts, visits, totalRuns, isTraffic) {
  return Float32Array.from(visits, (visitCount, cell) => {
    if (visitCount < MIN_RUNS_FOR_RATE) return 0;
    return isTraffic ? visitCount / totalRuns : eventCounts[cell] / visitCount;
  });
}

// Two passes of a 3x3 box blur ~ a small gaussian: turns single dots into readable density.
export function blurGrid(values, gridSize) {
  let current = values;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(values.length);
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        let sum = 0;
        for (let dRow = -1; dRow <= 1; dRow++) {
          for (let dCol = -1; dCol <= 1; dCol++) {
            const r = row + dRow, c = col + dCol;
            if (r >= 0 && r < gridSize && c >= 0 && c < gridSize) sum += current[r * gridSize + c];
          }
        }
        next[row * gridSize + col] = sum / 9;
      }
    }
    current = next;
  }
  return current;
}

// Perceptual ramp (inferno-like): dark purple -> red -> orange -> pale yellow.
const COLOR_STOPS = [[40, 11, 84], [120, 28, 109], [187, 55, 84], [237, 105, 37], [251, 180, 26], [252, 255, 164]];

export function colorAt(fraction) {
  const position = Math.min(1, Math.max(0, fraction)) * (COLOR_STOPS.length - 1);
  const low = Math.min(COLOR_STOPS.length - 2, Math.floor(position));
  const blend = position - low;
  return COLOR_STOPS[low].map((channel, i) => channel + (COLOR_STOPS[low + 1][i] - channel) * blend);
}

// Square-root scale because traffic and fights are very skewed toward a few hot spots.
export function valuesToHeatCanvas(values, gridSize) {
  const peak = values.reduce((highest, value) => Math.max(highest, value), 0);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = gridSize;
  const image = new ImageData(gridSize, gridSize);
  values.forEach((value, cell) => {
    if (value <= 0 || peak <= 0) return;
    const fraction = Math.sqrt(value / peak);
    const [red, green, blue] = colorAt(fraction);
    image.data.set([red, green, blue, 70 + 140 * fraction], cell * 4);
  });
  canvas.getContext("2d").putImageData(image, 0, 0);
  return { canvas, peak };
}
