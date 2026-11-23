# Architecture

## What I built and why

A static site. A Python build step cleans the telemetry once; the browser only filters, bins and draws.

| Choice | Why |
|---|---|
| Static site, no backend | ~87k rows become ~2 MB of JSON, so any filter recomputes instantly; free hosting, the link never goes down. |
| Plain JS + Canvas 2D | One screen, one canvas in a fixed 1024×1024 space. No bundler or framework to explain. |
| Python (pandas/pyarrow) build | Parquet's natural reader; every cleaning rule is one named, tested function. |
| Heat computed in the browser | Day / outcome / time-window / match filters change the heatmap live; pre-baked grids could not. |

## Data flow

`player_data/*/*` (1,243 parquet files) → `scripts/build_data.py` → `web/data/<Map>.json` (columnar run, t, x, y, event) + `index.json` + `web/minimaps/*.jpg` → `data.js` loads one map → filters pick matches/rows → `heatmap.js` bins into a grid → `draw.js` paints minimap, heat, paths, markers. The whole view is stored in the URL hash, so any state is a shareable link.

Build rules: decode `event` bytes; drop 1,505 exact duplicate rows; a run is **human if its file has `Position` events** (not by filename: 17 numeric-id files behave like humans); drop 466 `BotKill/BotKilled` rows inside bot files (cannot be attributed); `ts` → match-relative seconds; sort by time (3 files were unsorted); map to minimap pixels; add one derived `RunEnd` per human run at its last position (drawn *under* death icons).

## Coordinate mapping

Per map the README gives `scale`, `origin_x`, `origin_z`: `u=(x-origin_x)/scale`, `v=(z-origin_z)/scale`, `px=u·1024`, `py=(1-v)·1024` (image Y is flipped). Only `x` and `z` are used; `y` is height. It happens once, in `world_to_minimap_pixels`; the browser inverts it only to show engine coordinates on hover.

Checked: the README's worked example (−301.45, −355.55 → 78, 890); map corners land on image corners; on Ambrose 99.7 % of human positions fall on the island versus 92.8 % unflipped and 71 % axis-swapped (same result on the other maps); paths follow roads. The supplied images are **not** 1024² (4320², 2160×2158, 9000²), so they are resized to 2048² squares; GrandRift's 2158 vs 2160 is a 0.1 % stretch.

## Assumptions where the data was ambiguous

- **`ts` is Unix epoch *seconds* in a millisecond-typed column** (read as ms it is 1970-01-21). I subtract each match's first timestamp. Feb 14 is a partial day (per the dataset README).
- **Day** is the dataset's own folder; a match split across two folders goes to the earlier.
- **"Survived" = no death event.** There is no extraction event, so some survivors may be quits.
- **Bots are thinly recorded:** bot paths exist in 52 of 796 matches (raw `BotKill` is 2,415; 2,206 after cleaning). Matches are almost all one human + bots, so player-vs-player analysis is not possible (3 `Kill` events; each shares timestamp and position with a `Killed`, possibly a logging artefact).
- Duplicate removal also collapses genuine same-second pickups, so **loot counts are a lower bound**.

## Trade-offs

| Decision | Alternative | Cost |
|---|---|---|
| Map in the build | Map in the browser | Changing a map config needs a rebuild |
| Heat from raw events in the browser | Pre-aggregated grids | Fine at ~60k rows, not millions |
| Colour scale relative to the view | Fixed across filters | Brightness is not comparable between views (legend says so) |
| 32² cells, ≥10 visiting runs for "rate" | Finer cells | Thin areas show nothing |
| Canvas 2D | deck.gl / Leaflet | Less built-in, far less weight for 87k points |
| No mobile polish | Full touch support | Tool is for designers at desks |
