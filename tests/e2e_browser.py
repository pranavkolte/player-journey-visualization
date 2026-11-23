"""Drives the real page in headless Chromium and checks what a designer would see.

Run:  CHROME_PATH=/path/to/chrome .venv/bin/python tests/e2e_browser.py
(CHROME_PATH is optional if Playwright's own browser is installed.)
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

WEB = Path(__file__).resolve().parent.parent / "web"
PORT = 8791
failures = []


def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def load_map(map_id):
    return json.loads((WEB / "data" / f"{map_id}.json").read_text())


def count_events(payload, event_code):
    return sum(1 for code in payload["rows"]["event"] if code == event_code)


def summary_text(page):
    return page.inner_text("#summary")


def canvas_fingerprint(page):
    return page.evaluate("document.getElementById('map-canvas').toDataURL()")


def run_checks(page, errors):
    ambrose, lockdown = load_map("AmbroseValley"), load_map("Lockdown")
    check("page loads without console or network errors", not errors, str(errors))
    check("starts on Ambrose Valley with all matches", "566" in summary_text(page), summary_text(page))

    # Every event type is available as a distinct marker and heat layer
    check("seven heat layers offered", page.locator("input[name=layer]").count() == 7)
    check("six marker types offered", page.locator("#marker-checks input").count() == 6)

    # Numbers shown must equal numbers computed independently from the data
    page.check("input[name=layer][value=storm]")
    check("storm death total equals the data", f"{count_events(ambrose, 6)}" in summary_text(page), summary_text(page))
    page.check("input[name=layer][value=loot]")
    check("loot total equals the data", f"{count_events(ambrose, 7):,}" in summary_text(page), summary_text(page))

    # Heatmap toggle changes the picture
    with_heat = canvas_fingerprint(page)
    page.uncheck("#heat-toggle")
    check("heatmap toggle changes the canvas", canvas_fingerprint(page) != with_heat)
    page.check("#heat-toggle")

    # Filters: map, day, outcome
    page.select_option("#map-select", "Lockdown")
    page.wait_for_function("document.getElementById('summary').innerText.includes('171')")
    check("switching to Lockdown shows its 171 matches", "171" in summary_text(page))
    page.select_option("#date-select", "2026-02-10")
    expected = sum(1 for match in lockdown["matches"] if match["date"] == "2026-02-10")
    check("day filter keeps only that day's matches", f"{expected} matches" in summary_text(page), summary_text(page))
    page.select_option("#date-select", "all")
    page.select_option("#outcome-select", "storm")
    expected = sum(1 for match in lockdown["matches"] if match["outcome"] == "storm")
    check("outcome filter keeps only storm deaths", f"{expected} match" in summary_text(page), summary_text(page))
    page.select_option("#outcome-select", "all")

    # Time window: late-match storm deaths only appear after ~10 minutes
    page.select_option("#map-select", "AmbroseValley")
    page.wait_for_function("document.getElementById('summary').innerText.includes('566')")
    # Run-end layer: survivors' end points equal the number of surviving human runs
    ambrose_survivors = sum(match["humans"] for match in ambrose["matches"] if match["outcome"] == "survived")
    page.check("input[name=layer][value=runEnds]")
    page.select_option("#outcome-select", "survived")
    check("run-end layer counts one end per surviving run", f"<b>{ambrose_survivors}</b> × where runs end" in page.inner_html("#summary"), page.inner_html("#summary"))
    page.select_option("#outcome-select", "all")

    # Changing a filter keeps the designer's marker choice and time window
    page.check("#marker-checks input[value=loot]")
    page.fill("#from-slider", "300")
    page.dispatch_event("#from-slider", "input")
    page.select_option("#date-select", "2026-02-11")
    check("day filter keeps marker choice", page.is_checked("#marker-checks input[value=loot]"))
    check("day filter keeps the time window", page.input_value("#from-slider") == "300")
    page.select_option("#date-select", "all")
    page.uncheck("#marker-checks input[value=loot]")
    page.fill("#from-slider", "0")
    page.dispatch_event("#from-slider", "input")

    # Empty state
    page.select_option("#date-select", "2026-02-14")
    page.select_option("#outcome-select", "killed_by_player")
    check("zero matches shows an empty-state message", page.is_visible("#empty-message"))
    check("play is disabled with nothing selected", page.is_disabled("#play-button"))
    page.select_option("#date-select", "all")
    page.select_option("#outcome-select", "all")
    check("empty state clears when filters relax", not page.is_visible("#empty-message"))

    # Rapid map switching ends on the last choice, with matching data
    page.select_option("#map-select", "Lockdown")
    page.select_option("#map-select", "GrandRift")
    page.wait_for_timeout(1200)
    check("rapid map switching settles on the last map", page.input_value("#map-select") == "GrandRift" and "59" in summary_text(page), summary_text(page))
    page.select_option("#map-select", "AmbroseValley")
    page.wait_for_function("document.getElementById('summary').innerText.includes('566')")

    page.check("input[name=layer][value=storm]")
    page.fill("#to-slider", "600")
    page.dispatch_event("#to-slider", "input")
    check("no storm deaths in the first 10 minutes", "<b>0</b> × storm deaths" in page.inner_html("#summary"), page.inner_html("#summary"))
    page.fill("#to-slider", page.get_attribute("#to-slider", "max"))
    page.dispatch_event("#to-slider", "input")

    # Single-match replay with playback
    match_options = page.eval_on_selector_all("#match-select option", "o => o.map(x => x.value)")
    page.select_option("#match-select", match_options[1])
    check("choosing a match hides the heatmap", not page.is_checked("#heat-toggle"))
    check("choosing a match shows every marker type", page.locator("#marker-checks input:checked").count() == 6)
    match_length = int(page.get_attribute("#to-slider", "max"))
    check("timeline length equals the match length", 0 < match_length < 1000)
    page.fill("#to-slider", "0")
    page.dispatch_event("#to-slider", "input")
    before = canvas_fingerprint(page)
    page.click("#play-button")
    page.wait_for_timeout(1500)
    page.click("#play-button")
    position = int(page.input_value("#to-slider"))
    check("playback advances the timeline", position > 0, str(position))
    check("playback changes the canvas", canvas_fingerprint(page) != before)

    # Hover shows per-area numbers; zoom keeps working
    box = page.locator("#map-canvas").bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    check("hover tooltip shows run counts", "Runs through this area" in page.inner_text("#tooltip"))
    page.mouse.wheel(0, -400)
    page.wait_for_timeout(200)
    check("zoom and reset do not error", not errors, str(errors))
    page.click("#reset-view-button")

    # Small-sample warning when a filter leaves few matches
    page.select_option("#map-select", "GrandRift")
    page.wait_for_function("document.getElementById('summary').innerText.includes('59')")
    check("59 matches is enough to show no warning", "tentative" not in summary_text(page))
    page.select_option("#outcome-select", "storm")
    check("few matches shows a small-sample warning", "tentative" in summary_text(page), summary_text(page))


def check_drilldown(page):
    """Insight 2's Lockdown cell (x608-640, y512-544) has 9 deaths: clicking it must list them and open a replay."""
    page.goto(f"http://localhost:{PORT}/#map=Lockdown&layer=deaths&metric=count")
    page.reload()  # a hash-only navigation does not reload, so the link would not be applied
    page.wait_for_selector("#loading", state="hidden")
    x, y, width, height = page.eval_on_selector("#map-canvas", "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }")
    size = min(width, height)
    page.mouse.click(x + (width - size) / 2 + 624 / 1024 * size, y + (height - size) / 2 + 528 / 1024 * size)
    page.wait_for_selector(".drill-row")
    check("drill-down lists the 9 deaths in that cell", page.locator(".drill-row").count() == 9, str(page.locator(".drill-row").count()))
    page.locator(".drill-row").first.click()
    check("drill-down row opens that match's replay", page.input_value("#match-select") != "-1" and page.eval_on_selector("#drilldown", "e => e.hidden"))


def main():
    server = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--directory", str(WEB)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(executable_path=os.environ.get("CHROME_PATH"), args=["--no-sandbox"])
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("console", lambda message: message.type == "error" and errors.append(message.text))
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"http://localhost:{PORT}/")
            page.wait_for_selector("#loading", state="hidden", timeout=15000)
            run_checks(page, errors)
            check_drilldown(page)
            browser.close()
    finally:
        server.terminate()
    print(f"\n{len(failures)} failure(s)" if failures else "\nAll browser checks passed")
    sys.exit(1 if failures else 0)


main()
