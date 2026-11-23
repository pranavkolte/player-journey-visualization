# LILA BLACK Player Journeys

A browser tool for level designers to see how players actually move, fight, loot and die on LILA BLACK's three maps, built from 5 days of production telemetry (Feb 10–14, 2026).

**Live tool:** https://pranavkolte.github.io/player-journey-visualization/  ·  Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)  ·  Findings: [INSIGHTS.md](INSIGHTS.md)

## What a designer can do

| Need | How |
|---|---|
| See where players go | **Human traffic** heatmap on the real minimap (zoom with scroll, pan by dragging) |
| Find risky spots | **Player deaths / kills / storm deaths** layers, with *Rate per run that visited the area* so busy ≠ dangerous |
| Find unused space or loot imbalance | **Loot pickups**, and hover any area for run counts |
| See where runs finish (extraction spots) | **Where runs end** layer, filtered to *Survived* |
| Watch a match | Pick a **Single match**: human path (cyan) and bot paths (orange), event markers, play/pause, speed, *from/to* match-time window |
| View one cohort at a time | Filter by **map, day, how the run ended** (no side-by-side compare yet) |
| See the runs behind a hot spot | **Click a heatmap cell**: lists each run/event there; click a row to replay that match 30 s before to 10 s after |
| Find a spot in the engine | Hover shows the engine **world x / z**; click to copy |
| Share what you see | **Copy link to this view**: the whole state is in the URL hash |

Every event type has its own marker: loot (yellow diamond), kill (red crosshair), killed by player (white skull), killed by bot (orange robot skull), storm death (purple lightning), run end (green ring). Humans are circles/cyan, bots are squares/orange.

## Walkthrough

1. [Traffic heatmap](docs/1-traffic-heatmap.png): default view, zoom with scroll, drag to pan.
2. [Death rate per visiting run, with world coordinates on hover](docs/2-death-rate-hover-coordinates.png).
3. [Extraction spots](docs/3-extraction-spots.png): *Where runs end* + *Survived* + Run end marker.
4. [Match replay](docs/4-match-replay-markers.png): pick a single match, press Play; deaths draw above loot and the run-end ring.

## Tech stack

- **Viewer:** plain HTML + ES modules + Canvas 2D. No framework, no bundler, no runtime dependencies.
- **Data build:** Python (pandas, pyarrow, Pillow) turns the parquet files into small static JSON (≈2 MB) and resized minimaps.
- **Hosting:** any static host. `web/` is the whole site. A GitHub Pages workflow is in `.github/workflows/pages.yml`; on Vercel/Netlify set the publish directory to `web` (no build command).
- **Env vars:** none.
- **Deploy (GitHub Pages):** push to `main`, then once in *Settings → Pages* set *Source* to *GitHub Actions*; or run the workflow manually from the Actions tab.

## Run locally

```bash
python3 -m http.server --directory web 8000     # then open http://localhost:8000
```

`web/data` and `web/minimaps` are committed, so this works without the raw data.

## Rebuild the data (optional)

Put the provided `player_data/` folder (with `February_10…14/` and `minimaps/`) in the repo root, then:

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/build_data.py
```

## Tests

```bash
.venv/bin/python -m unittest discover tests -v          # cleaning rules, coordinate mapping, built output
node --test tests/                                      # heatmap, filters, interpolation, marker order (Node 20)
CHROME_PATH=/path/to/chrome .venv/bin/python tests/e2e_browser.py   # real-browser checks of the UI
```

`tests/test_build_data.py` includes a first-principles check of the coordinate mapping: with the README formula ≥90 % of human positions land on the island (not the black void), and that beats the flipped and axis-swapped alternatives on all three maps.

## Layout

```
scripts/build_data.py     parquet → JSON + minimaps (all cleaning rules, one function each)
web/index.html, style.css the page
web/js/config.js          layers, markers, thresholds
web/js/data.js            load JSON, select matches/rows
web/js/heatmap.js         binning, per-run rates, blur, colour ramp
web/js/draw.js            canvas drawing, playback interpolation
web/js/ui.js              DOM helpers
web/js/main.js            state and event wiring
tests/                    Python, Node and browser tests
```
