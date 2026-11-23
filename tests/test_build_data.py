"""Checks for scripts/build_data.py: the README example, cleaning rules, and the built output.

Run:  .venv/bin/python -m unittest discover tests -v
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pandas as pd
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_data  # noqa: E402

WEB = ROOT / "web"


def make_rows(*rows):
    return pd.DataFrame(rows, columns=["user_id", "match_id", "map_id", "x", "z", "epoch_seconds", "event"])


class CoordinateMappingTest(unittest.TestCase):
    def test_readme_worked_example(self):
        px, py = build_data.world_to_minimap_pixels(-301.45, -355.55, "AmbroseValley")
        self.assertAlmostEqual(float(px), 78, delta=1)
        self.assertAlmostEqual(float(py), 890, delta=1)

    def test_map_corners_land_on_image_corners(self):
        for map_id, (scale, origin_x, origin_z) in build_data.MAP_CONFIG.items():
            left_bottom = build_data.world_to_minimap_pixels(origin_x, origin_z, map_id)
            right_top = build_data.world_to_minimap_pixels(origin_x + scale, origin_z + scale, map_id)
            self.assertEqual((float(left_bottom[0]), float(left_bottom[1])), (0.0, 1024.0), map_id)
            self.assertEqual((float(right_top[0]), float(right_top[1])), (1024.0, 0.0), map_id)


class CleaningRulesTest(unittest.TestCase):
    def test_exact_duplicates_are_dropped(self):
        rows = make_rows(("u", "m", "Lockdown", 1, 2, 100, "Loot"), ("u", "m", "Lockdown", 1, 2, 100, "Loot"))
        self.assertEqual(len(build_data.drop_duplicate_rows(rows)), 1)

    def test_numeric_id_with_position_events_is_human(self):
        rows = make_rows(("1379", "m", "Lockdown", 1, 2, 100, "Position"), ("77", "m", "Lockdown", 1, 2, 100, "BotPosition"))
        marked = build_data.mark_human_runs(rows).set_index("user_id")["is_human"]
        self.assertTrue(marked["1379"])
        self.assertFalse(marked["77"])

    def test_combat_events_in_bot_files_are_dropped_but_human_ones_stay(self):
        rows = make_rows(("77", "m", "Lockdown", 1, 2, 100, "BotKilled"), ("uuid-1", "m", "Lockdown", 1, 2, 100, "BotKilled"))
        rows["is_human"] = [False, True]
        kept = build_data.drop_combat_events_from_bot_runs(rows)
        self.assertEqual(list(kept["user_id"]), ["uuid-1"])

    def test_time_is_relative_to_match_start(self):
        rows = make_rows(("a", "m1", "Lockdown", 0, 0, 5000, "Position"), ("b", "m1", "Lockdown", 0, 0, 5030, "Position"), ("c", "m2", "Lockdown", 0, 0, 9000, "Position"))
        self.assertEqual(list(build_data.add_match_relative_seconds(rows)["t"]), [0, 30, 0])

    def test_run_end_row_is_the_last_human_position_only(self):
        rows = make_rows(
            ("u", "m", "Lockdown", 1, 1, 100, "Position"), ("u", "m", "Lockdown", 9, 9, 110, "Position"), ("u", "m", "Lockdown", 5, 5, 111, "Loot"),
            ("77", "m", "Lockdown", 3, 3, 105, "BotPosition"),
        )
        rows["is_human"] = [True, True, True, False]
        rows["t"] = rows["epoch_seconds"] - 100
        run_ends = build_data.add_run_end_rows(rows).query("event == 'RunEnd'")
        self.assertEqual(len(run_ends), 1)
        self.assertEqual((run_ends["x"].iloc[0], run_ends["t"].iloc[0]), (9, 10))

    def test_day_comes_from_the_folder_name(self):
        self.assertEqual(build_data.day_folder_to_iso_date("February_10"), "2026-02-10")

    def test_match_with_two_humans_counts_both_and_labels_by_the_first(self):
        rows = pd.DataFrame({
            "match_id": ["m"] * 5, "user_id": ["uuid-a", "uuid-a", "uuid-b", "77", "77"],
            "is_human": [True, True, True, False, False],
            "event": ["Position", "KilledByStorm", "Position", "BotPosition", "BotPosition"],
            "day": ["2026-02-10"] * 5, "match_started_at": [100] * 5, "t": [0, 9, 0, 0, 5],
            "px": [1.0] * 5, "py": [2.0] * 5,
        })
        payload = build_data.build_map_payload(rows)
        match = payload["matches"][0]
        self.assertEqual((match["humans"], match["bots"], match["outcome"], match["durationSec"]), (2, 1, "storm", 9))
        self.assertEqual([run["isHuman"] for run in payload["runs"]], [True, True, False])

    def test_outcome_comes_from_death_events(self):
        self.assertEqual(build_data.human_run_outcome({"Position", "KilledByStorm"}), "storm")
        self.assertEqual(build_data.human_run_outcome({"Position", "BotKilled"}), "killed_by_bot")
        self.assertEqual(build_data.human_run_outcome({"Position", "Loot"}), "survived")


@unittest.skipUnless((WEB / "data" / "index.json").exists(), "run scripts/build_data.py first")
class BuiltOutputTest(unittest.TestCase):
    def load_map(self, map_id):
        return json.loads((WEB / "data" / f"{map_id}.json").read_text())

    def test_every_point_is_inside_the_minimap_and_times_are_valid(self):
        for map_id in build_data.MAP_CONFIG:
            rows = self.load_map(map_id)["rows"]
            self.assertTrue(0 <= min(rows["x"]) and max(rows["x"]) <= 1024, map_id)
            self.assertTrue(0 <= min(rows["y"]) and max(rows["y"]) <= 1024, map_id)
            self.assertTrue(0 <= min(rows["t"]) and max(rows["t"]) <= 1000, map_id)

    def test_rows_are_sorted_by_run_then_time_and_runs_by_match(self):
        payload = self.load_map("Lockdown")
        run, t = np.array(payload["rows"]["run"]), np.array(payload["rows"]["t"])
        same_run = run[1:] == run[:-1]
        self.assertTrue(np.all(t[1:][same_run] >= t[:-1][same_run]))
        run_match = np.array([payload["runs"][r]["match"] for r in run])
        self.assertTrue(np.all(np.diff(run_match) >= 0))

    def test_human_positions_land_on_the_map_island_and_not_with_other_flips(self):
        """First-principles proof the mapping is right: people walk on the island, not in the black void."""
        for map_id in build_data.MAP_CONFIG:
            payload = self.load_map(map_id)
            rows = payload["rows"]
            image = np.asarray(Image.open(WEB / "minimaps" / f"{map_id}.jpg").convert("L"))
            scale = image.shape[0] / 1024
            is_position = np.array(rows["event"]) == 0
            x, y = np.array(rows["x"])[is_position], np.array(rows["y"])[is_position]

            def on_island(px, py):
                cols = np.clip((px * scale).astype(int), 0, image.shape[1] - 1)
                lines = np.clip((py * scale).astype(int), 0, image.shape[0] - 1)
                return float((image[lines, cols] > 20).mean())

            correct, flipped, swapped = on_island(x, y), on_island(x, 1024 - y), on_island(y, x)
            self.assertGreater(correct, 0.9, f"{map_id} mapped positions mostly off the island")
            self.assertGreater(correct, flipped + 0.03, f"{map_id}: y-flip should matter")
            self.assertGreater(correct, swapped + 0.03, f"{map_id}: x/z swap should matter")

    def test_row_counts_match_the_cleaning_rules(self):
        total = sum(len(self.load_map(map_id)["rows"]["t"]) for map_id in build_data.MAP_CONFIG)
        # 89,104 raw - 1,505 duplicates - 466 ambiguous bot combat rows + 798 derived RunEnd rows
        self.assertEqual(total, 87931)

    def test_dates_are_exactly_the_five_dataset_days(self):
        index = json.loads((WEB / "data" / "index.json").read_text())
        days = {date for info in index["maps"].values() for date in info["dates"]}
        self.assertEqual(days, {f"2026-02-{day}" for day in range(10, 15)})

    def test_every_human_run_has_exactly_one_run_end(self):
        payload = self.load_map("AmbroseValley")
        run_end_code = json.loads((WEB / "data" / "index.json").read_text())["eventNames"].index("RunEnd")
        ends_per_run = np.bincount(np.array(payload["rows"]["run"])[np.array(payload["rows"]["event"]) == run_end_code], minlength=len(payload["runs"]))
        for run, end_count in zip(payload["runs"], ends_per_run):
            self.assertEqual(end_count, 1 if run["isHuman"] else 0)


if __name__ == "__main__":
    unittest.main()
