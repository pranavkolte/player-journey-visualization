"""Turn the raw LILA BLACK parquet telemetry into small static JSON files for the web viewer.

Usage:  python scripts/build_data.py [player_data_dir] [output_dir]

Output (default: web/):
    data/index.json        maps, event names, dates
    data/<MapId>.json      matches, runs and event rows for one map (columnar arrays)
    minimaps/<MapId>.jpg   minimap images resized to a square

The cleaning rules are documented in ARCHITECTURE.md; each one is a named function below.
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow.parquet as pq
from PIL import Image

MINIMAP_SIZE_IN_COORDINATES = 1024  # pixel space that every x/y in the output uses
MINIMAP_IMAGE_SIZE = 2048  # shipped image resolution (sharper when the viewer zooms)

# map -> (scale, origin_x, origin_z), straight from the data README
MAP_CONFIG = {
    "AmbroseValley": (900, -370, -473),
    "GrandRift": (581, -290, -290),
    "Lockdown": (1000, -500, -500),
}
MINIMAP_FILES = {
    "AmbroseValley": "AmbroseValley_Minimap.png",
    "GrandRift": "GrandRift_Minimap.png",
    "Lockdown": "Lockdown_Minimap.jpg",
}

# "RunEnd" is not in the raw data: build_data adds one per human run at its last position (see add_run_end_rows).
EVENT_NAMES = ["Position", "BotPosition", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot", "RunEnd"]
EVENT_CODES = {name: code for code, name in enumerate(EVENT_NAMES)}
COMBAT_EVENTS = ["Kill", "Killed", "BotKill", "BotKilled"]
DATA_YEAR = 2026  # day folders are named February_10 ... February_14 (README: Feb 10-14, 2026)
DEATH_OUTCOME_BY_EVENT = {"KilledByStorm": "storm", "BotKilled": "killed_by_bot", "Killed": "killed_by_player"}


def world_to_minimap_pixels(world_x, world_z, map_id):
    """README formula: u,v in 0-1, then flip Y because image origin is top-left."""
    scale, origin_x, origin_z = MAP_CONFIG[map_id]
    u = (np.asarray(world_x, dtype="float64") - origin_x) / scale
    v = (np.asarray(world_z, dtype="float64") - origin_z) / scale
    return u * MINIMAP_SIZE_IN_COORDINATES, (1 - v) * MINIMAP_SIZE_IN_COORDINATES


def decode_event(raw_event):
    return raw_event.decode("utf-8") if isinstance(raw_event, bytes) else raw_event


def day_folder_to_iso_date(folder_name):
    """'February_10' -> '2026-02-10'. The dataset's own day folders define the date filter."""
    return f"{DATA_YEAR}-02-{int(folder_name.split('_')[1]):02d}"


def read_all_rows(player_data_dir):
    """Every row of every file; `ts` is kept as raw integer seconds (see add_match_relative_seconds)."""
    frames = []
    for path in sorted(Path(player_data_dir).glob("February_*/*")):
        run_rows = pq.read_table(path).to_pandas()
        run_rows["day"] = day_folder_to_iso_date(path.parent.name)
        frames.append(run_rows)
    rows = pd.concat(frames, ignore_index=True)
    rows["event"] = rows["event"].map(decode_event)
    # The column is typed as milliseconds but the stored integers are Unix epoch SECONDS.
    rows["epoch_seconds"] = rows["ts"].astype("int64")
    return rows.drop(columns=["ts"])


def drop_duplicate_rows(rows):
    return rows.drop_duplicates(["user_id", "match_id", "epoch_seconds", "event", "x", "z"])


def mark_human_runs(rows):
    """A run is human if its file has a `Position` event. The filename rule is wrong for
    17 numeric-id files that behave like humans (Position/Loot, never BotPosition)."""
    human_runs = rows.loc[rows["event"] == "Position", ["match_id", "user_id"]].drop_duplicates()
    human_runs["is_human"] = True
    rows = rows.merge(human_runs, on=["match_id", "user_id"], how="left")
    rows["is_human"] = rows["is_human"].fillna(False).astype(bool)
    return rows


def drop_combat_events_from_bot_runs(rows):
    """Bot files also contain BotKill/BotKilled rows that cannot be matched to a human, so
    their meaning is ambiguous. Human kill/death statistics only use human files."""
    is_ambiguous = ~rows["is_human"] & rows["event"].isin(COMBAT_EVENTS)
    return rows[~is_ambiguous]


def add_match_relative_seconds(rows):
    """All players in a match share one clock, so seconds since the match's first row is the timeline."""
    match_start = rows.groupby("match_id")["epoch_seconds"].transform("min")
    rows["match_started_at"] = match_start
    rows["t"] = rows["epoch_seconds"] - match_start
    return rows


def add_minimap_pixels(rows):
    rows["px"] = np.nan
    rows["py"] = np.nan
    for map_id in MAP_CONFIG:
        on_map = rows["map_id"] == map_id
        rows.loc[on_map, "px"], rows.loc[on_map, "py"] = world_to_minimap_pixels(
            rows.loc[on_map, "x"], rows.loc[on_map, "z"], map_id
        )
    return rows


def add_run_end_rows(rows):
    """One derived `RunEnd` row per human run, at its last position: the extraction spot for runs
    that never died, otherwise where the run stopped. Lets designers map where journeys finish."""
    human_positions = rows[rows["is_human"] & (rows["event"] == "Position")]
    last_positions = human_positions.sort_values("t").groupby(["match_id", "user_id"], as_index=False).tail(1).copy()
    last_positions["event"] = "RunEnd"
    return pd.concat([rows, last_positions], ignore_index=True)


def clean_rows(rows):
    rows = drop_duplicate_rows(rows)
    rows = mark_human_runs(rows)
    rows = drop_combat_events_from_bot_runs(rows)
    rows = add_match_relative_seconds(rows)
    rows = add_run_end_rows(rows)
    rows = add_minimap_pixels(rows)
    return rows.sort_values(["match_started_at", "match_id", "user_id", "t"], kind="stable")


def human_run_outcome(run_events):
    for event, outcome in DEATH_OUTCOME_BY_EVENT.items():
        if event in run_events:
            return outcome
    return "survived"  # no death event: probably extracted, but the data has no extraction event


def build_map_payload(map_rows):
    """Columnar payload for one map: matches, runs, and one array per row field."""
    match_number = map_rows.groupby("match_id", sort=False).ngroup()
    run_number = map_rows.groupby(["match_id", "user_id"], sort=False).ngroup()

    runs, human_outcomes_by_match = [], {}
    for _, run_rows in map_rows.groupby(["match_id", "user_id"], sort=False):
        match = int(match_number[run_rows.index[0]])
        is_human = bool(run_rows["is_human"].iloc[0])
        runs.append({"match": match, "isHuman": is_human})
        if is_human:
            human_outcomes_by_match.setdefault(match, []).append(human_run_outcome(set(run_rows["event"])))

    matches = []
    for match, (match_id, match_rows) in enumerate(map_rows.groupby("match_id", sort=False)):
        human_outcomes = human_outcomes_by_match.get(match, [])
        match_runs = [run for run in runs if run["match"] == match]
        matches.append({
            "id": match_id.removesuffix(".nakama-0"),
            "date": match_rows["day"].min(),
            "startedAt": int(match_rows["match_started_at"].iloc[0]),
            "durationSec": int(match_rows["t"].max()),
            "humans": len(human_outcomes),
            "bots": len(match_runs) - len(human_outcomes),
            "outcome": human_outcomes[0] if human_outcomes else "no_human",  # first human if a match has two
        })

    rows = {
        "run": run_number.tolist(),
        "t": map_rows["t"].astype(int).tolist(),
        "x": map_rows["px"].round(1).tolist(),
        "y": map_rows["py"].round(1).tolist(),
        "event": map_rows["event"].map(EVENT_CODES).tolist(),
    }
    return {"matches": matches, "runs": runs, "rows": rows}


def write_minimap(player_data_dir, output_dir, map_id):
    image = Image.open(Path(player_data_dir) / "minimaps" / MINIMAP_FILES[map_id]).convert("RGB")
    image = image.resize((MINIMAP_IMAGE_SIZE, MINIMAP_IMAGE_SIZE), Image.LANCZOS)
    image.save(Path(output_dir) / "minimaps" / f"{map_id}.jpg", quality=85)


def write_json(path, payload):
    path.write_text(json.dumps(payload, separators=(",", ":")))


def build_all(player_data_dir, output_dir):
    output_dir = Path(output_dir)
    (output_dir / "data").mkdir(parents=True, exist_ok=True)
    (output_dir / "minimaps").mkdir(parents=True, exist_ok=True)

    rows = clean_rows(read_all_rows(player_data_dir))
    index = {"eventNames": EVENT_NAMES, "maps": {}}
    for map_id in MAP_CONFIG:
        payload = build_map_payload(rows[rows["map_id"] == map_id])
        write_json(output_dir / "data" / f"{map_id}.json", payload)
        write_minimap(player_data_dir, output_dir, map_id)
        index["maps"][map_id] = {
            "dataFile": f"data/{map_id}.json",
            "image": f"minimaps/{map_id}.jpg",
            "world": dict(zip(("scale", "originX", "originZ"), MAP_CONFIG[map_id])),  # lets the viewer show engine coordinates
            "maxSeconds": max(match["durationSec"] for match in payload["matches"]),
            "dates": sorted({match["date"] for match in payload["matches"]}),
        }
        print(f"{map_id}: {len(payload['matches'])} matches, {len(payload['rows']['t'])} rows")
    write_json(output_dir / "data" / "index.json", index)


if __name__ == "__main__":
    build_all(sys.argv[1] if len(sys.argv) > 1 else "player_data", sys.argv[2] if len(sys.argv) > 2 else "web")
