// Loading the build output and selecting rows. All rows are columnar typed arrays.

export async function loadIndex() {
  const index = await fetchJson("data/index.json");
  index.eventCode = Object.fromEntries(index.eventNames.map((name, code) => [name, code]));
  return index;
}

export async function loadMapData(mapId, index) {
  const payload = await fetchJson(index.maps[mapId].dataFile);
  const rows = {
    run: Int32Array.from(payload.rows.run),
    t: Int32Array.from(payload.rows.t),
    x: Float32Array.from(payload.rows.x),
    y: Float32Array.from(payload.rows.y),
    event: Uint8Array.from(payload.rows.event),
  };
  const rowMatch = rows.run.map((run) => payload.runs[run].match);
  return { mapId, matches: payload.matches, runs: payload.runs, rows, rowMatch, matchRowStart: findMatchRowStarts(rowMatch, payload.matches.length), eventCode: index.eventCode };
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return response.json();
}

// Rows are sorted by match, so each match owns one contiguous block: [start[m], start[m + 1]).
function findMatchRowStarts(rowMatch, matchCount) {
  const starts = new Int32Array(matchCount + 1).fill(rowMatch.length);
  for (let row = rowMatch.length - 1; row >= 0; row--) starts[rowMatch[row]] = row;
  return starts;
}

export function codesForEvents(eventNames, eventCode) {
  return eventNames.map((name) => eventCode[name]);
}

// Which matches pass the date / outcome / single-match filters? Returns a 0/1 flag per match.
export function selectMatches(mapData, { date, outcome, matchIndex }) {
  return Uint8Array.from(mapData.matches, (match, index) => {
    if (matchIndex >= 0) return index === matchIndex ? 1 : 0;
    const dateOk = date === "all" || match.date === date;
    const outcomeOk = outcome === "all" || match.outcome === outcome;
    return dateOk && outcomeOk ? 1 : 0;
  });
}

// Row indices of the selected matches whose match-time lies in [fromSec, toSec].
export function selectRows(mapData, matchFlags, fromSec, toSec) {
  const picked = [];
  for (let match = 0; match < matchFlags.length; match++) {
    if (!matchFlags[match]) continue;
    for (let row = mapData.matchRowStart[match]; row < mapData.matchRowStart[match + 1]; row++) {
      const seconds = mapData.rows.t[row];
      if (seconds >= fromSec && seconds <= toSec) picked.push(row);
    }
  }
  return Int32Array.from(picked);
}
