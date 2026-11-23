// Everything a designer might want to tweak lives here: layers, marker looks, thresholds.

export const COORDINATE_SIZE = 1024; // build_data.py writes every x/y in this pixel space
export const HEAT_GRID_SIZE = 128; // smooth heatmap resolution (8 coordinate px per cell)
export const SUMMARY_GRID_SIZE = 32; // coarse cells used for hover stats and per-run rates
export const MIN_RUNS_FOR_RATE = 10; // hide coarse cells that fewer runs than this visited
export const MAX_INTERPOLATION_GAP_SEC = 30; // positions are sampled ~every 5s; longer gaps are not bridged
export const SMALL_SAMPLE_MATCHES = 30; // warn below this many matches
export const LOW_EVENT_COUNT = 30; // warn below this many events in the selected layer
export const MAX_PLAYBACK_STEP_SEC = 0.1; // real seconds; stops a long-hidden tab from jumping to the end
export const MINIMAP_DIM_UNDER_HEAT = 0.35; // darkens the minimap so heat colours stand out on bright maps

// Event names come from the parquet files (plus the derived "RunEnd"); `events` lists which feed each layer.
export const HEAT_LAYERS = [
  { key: "traffic", label: "Human traffic", events: ["Position"], help: "Where human players walk" },
  { key: "botTraffic", label: "Bot traffic (only some matches)", events: ["BotPosition"], help: "Where bots walk" },
  { key: "loot", label: "Loot pickups", events: ["Loot"], help: "Where loot is picked up" },
  { key: "kills", label: "Player kills (mostly bots)", events: ["Kill", "BotKill"], help: "Where a player killed a bot or another player" },
  { key: "deaths", label: "Player deaths (mostly to bots)", events: ["Killed", "BotKilled"], help: "Where a player was killed by a bot or another player" },
  { key: "storm", label: "Storm deaths", events: ["KilledByStorm"], help: "Where players died to the storm" },
  { key: "runEnds", label: "Where runs end", events: ["RunEnd"], help: "Last position of each human run: extraction spots for runs that survived, otherwise where the run stopped" },
];

// Marker icons are SVG paths on a 24x24 grid, used by both the map canvas (Path2D) and the sidebar legend.
// Holes (eyes, ring centre) are sub-paths wound the opposite way, so the default "nonzero" fill leaves them empty.
const ICONS = {
  diamond: "M12 2 22 12 12 22 2 12Z",
  crosshair: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18Z M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12Z M11 0h2v8h-2Z M11 16h2v8h-2Z M0 11h8v2H0Z M16 11h8v2h-8Z",
  skull: "M12 2C6.5 2 3 5.8 3 10.5c0 2.9 1.4 5 3.5 6.2V20a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3.3c2.1-1.2 3.5-3.3 3.5-6.2C21 5.8 17.5 2 12 2Z M8.5 9a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z M15.5 9a2 2 0 1 1 0 4a2 2 0 1 1 0-4Z M12 13.5 13.3 16h-2.6Z M10 18h1v3h-1Z M13 18h1v3h-1Z",
  robotSkull: "M11 1h2v5h-2Z M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2v4H7v-4H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z M6.5 9.5v3.5h4v-3.5Z M13.5 9.5v3.5h4v-3.5Z M9 18v2.5h1.5v-2.5Z M13.5 18v2.5H15v-2.5Z",
  lightning: "M14 1 4 14h6.5L9 23l11-13.5h-6.5Z",
  ring: "M12 3a9 9 0 1 1 0 18a9 9 0 1 1 0-18Z M12 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10Z",
};

// z = draw order (higher on top): deaths must never be hidden by the derived run-end ring or by loot.
export const MARKER_TYPES = [
  { key: "loot", z: 1, label: "Loot", events: ["Loot"], color: "#ffd23f", icon: ICONS.diamond },
  { key: "kill", z: 2, label: "Kill", events: ["Kill", "BotKill"], color: "#ff4d4d", icon: ICONS.crosshair },
  { key: "killedByPlayer", z: 4, label: "Killed by player", events: ["Killed"], color: "#ffffff", icon: ICONS.skull },
  { key: "killedByBot", z: 3, label: "Killed by bot", events: ["BotKilled"], color: "#ff9f1c", icon: ICONS.robotSkull },
  { key: "storm", z: 5, label: "Storm death", events: ["KilledByStorm"], color: "#c77dff", icon: ICONS.lightning },
  { key: "end", z: 0, label: "Run end", events: ["RunEnd"], color: "#5ee38b", icon: ICONS.ring },
];

export const OUTCOME_LABELS = {
  survived: "Survived (no death recorded)",
  killed_by_bot: "Killed by bot",
  killed_by_player: "Killed by player",
  storm: "Died to storm",
  no_human: "Bots only",
};

export const PLAYBACK_SPEEDS = [1, 5, 10, 30];
export const HUMAN_STYLE = { color: "#4cc9f0", lineWidth: 2.5, headRadius: 6, headShape: "circle" };
export const BOT_STYLE = { color: "#ff9f1c", lineWidth: 1.5, headRadius: 5, headShape: "square" };
