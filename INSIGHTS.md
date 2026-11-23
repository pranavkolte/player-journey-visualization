# Insights

Three things I learned about LILA BLACK using the tool. Every number was recomputed from the raw parquet files, independently of the tool's own pipeline; counts and rates can be read off the hover tooltips, while the statistical tests (chi-square, Fisher, Bonferroni, shrinkage) were run offline. Coordinates like (232, 131) are 1024-px minimap pixels; the tooltip also shows the engine x/z of the same spot. Sample sizes are small (566 / 171 / 59 matches on Ambrose / Lockdown / GrandRift, almost always one human per match), so each insight says how sure to be. "Survived" means *no death event recorded*; the data has no extraction event.

---

## 1. Extraction points are fixed spots, and uneven exit use is driven by where players spawn

**What caught my eye.** With *Where runs end* + outcome *Survived* + the *Run end* marker, survivors' endings stack into a handful of tight clusters instead of spreading out. One exit, in the north-west, is barely used.

**Evidence.**
- Ambrose: 252 of 568 human runs survived. **79 % (200/252) end within 15 px of one of just 6 spots.** The top 5 grid cells hold 67.5 % of endings and the top cell, near (656, 560), holds 17.9 %. Lockdown: 5 spots, 67.6 % of 74 survivors; top-5 cells hold 60.8 %.
- Usage is uneven on Ambrose (chi-square vs equal usage, p = 0.006). The north-west exit near (232, 131) ends only 17 survivors (6.7 %; an equal share would be 16.7 %).
- **It is not a death trap.** 93 runs pass within 15 px of it, but there are 0 deaths within 60 px of the exit (the tooltip for that cell shows *Player deaths: 0*). The cause is spawn position: 71 of those 93 runs *start* there (77 of 568 runs spawn within 60 px of it), and only 3 of those 71 extract there; they head elsewhere. Of the 22 runs that arrive from elsewhere, 14 (64 %) extract there, in line with the west-compound exit (33 of 53, 62 %).
- Lockdown shares: east (834, 401) 18.9 %, south (600, 714) 17.6 %, south-west (259, 677) 14.9 %, west (135, 536) 9.5 %, north port (643, 177) 6.8 %. With 74 survivors this is consistent with even usage (p = 0.20), so I would not move anything yet.
- Survivors end all over the map except the far south-east corner (px ≥ 700 and py ≥ 700 is empty). Of the 200 at-exit survivors, 45 (22.5 %) used the exit nearest their spawn, so most players cross the map to extract.

**Actionable?** Yes (Ambrose; Lockdown needs more data).
- *Action items:* decide whether the NW exit should serve the players who spawn beside it. If yes, give them a reason to stay (loot or an objective that ends at the exit, a clearer exit beacon); if players are meant to cross the map, accept the low share. Ask engineering to log an explicit **extraction event** and exit id so this does not rely on "last position".
- *Metrics affected:* share of survivor endings per exit, extraction rate of players who spawn within 60 px of each exit, survival rate (44 % Ambrose / 43 % Lockdown), median time to extract (~570 s).

**Why a level designer should care.** Exits are the level's goals. An exit its nearest spawners walk away from is either invisible to them or less attractive than the alternatives, which is cheap to fix with placement or signage. Caveat: about 21 % of Ambrose survivors end away from any exit, mostly early (median 306 s vs 570 s), so some "survivors" are probably quits, which is why an extraction event is worth logging.

---

## 2. A few loot-rich compounds kill players about 4–7× more often than the map average (raw rate 7–10×)

**What caught my eye.** Switching *Player deaths* to *Rate per run that visited the area* (instead of raw counts) makes one cell on Lockdown stand out; raw counts only showed the busy centre.

**Evidence.**
- Lockdown cell (x 608–640, y 512–544), in the grey industrial compound right of centre: **9 deaths in 38 visiting runs = 23.7 %** (95 % CI 13–39 %) against a 2.2 % map average (2.15 % over cells with ≥ 10 visits, which is the set the tool shows; 2.0 % over all cells). Ambrose: (528, 592) 15/100, (368, 560) 10/70, (464, 208) 9/63, against a 2.1 % average.
- Not noise: these cells pass a Bonferroni-corrected one-sided binomial test per cell (6–7 of 353 Ambrose cells depending on the exact test; all four named cells pass; 1 of 181 Lockdown cells), and the deaths occur on at least 3 of 5 days in different matches.
- Shrinkage: choosing cells on half the matches and measuring on the other half gives ~8 % (Ambrose) and ~10.5 % (Lockdown); an independent rerun with a different split gave 10–16 %. So the real rate is closer to **8–16 %**, still about 4–7× the average; the raw 7–10× overstates it because the cells were picked for being extreme.
- These cells are loot-dense (up to 4.76 pickups per visiting run vs a 0.14 median) and players die where they stop: 95 % of the deaths to bots (*BotKilled*, 381 of 401) happen in the run's last-position cell. Deaths at Ambrose (464, 208) are early: 8 of 9 at 108–186 s.
- Together they hold only ~11 % of bot deaths per map; the problem is localized, not map-wide.

**Actionable?** Yes. This tells you *where*, not *why*, so playtest first.
- *Action items:* playtest those four compounds; add hard cover and a second exit lane so a player can disengage; move the most valuable loot off the sightline; check bot arrival timing at (464, 208) and (528, 592) where deaths happen at ~2–3 minutes; decide whether the Lockdown compound is meant to be high risk / high reward (1 in 4 deaths).
- *Metrics affected:* death rate per visiting run in those cells, bot-killed share of human runs (52 % Ambrose, 47 % Lockdown), loot per visiting run (should stay level), survived-run share.

**Why a level designer should care.** Risk and reward should be a design choice, not an accident. A cell that is both the richest loot and the most lethal is either an intentional gamble or a balance bug; this finds it without reading logs. Caveats: bot paths exist in only 52 of 796 matches, so I could not show bots are over-concentrated there (their sampled density is not elevated); GrandRift (59 runs) is too small to test.

---

## 3. Lockdown's storm kills late players far more often than Ambrose's, and they do not head for the exits

**What caught my eye.** On Lockdown, *Storm deaths* with the *From* slider at ~10:00 shows 17 deaths scattered across the interior, not clustered at the rim where exits are. Ambrose shows the same count out of 3× more matches.

**Evidence.**
- Of human runs still alive at 655 s (the first Lockdown storm death): **17 of 35 (48.6 %) died to the storm on Lockdown vs 17 of 91 (18.7 %) on Ambrose** (Fisher p = 0.0014). Over all runs: 9.9 % vs 3.0 % (p = 0.0005). On Lockdown none of those 35 late runs died in combat.
- **Careful:** one repeat player accounts for 6 of the 17 Lockdown deaths. Without them it is 11/29 (37.9 %) vs 18.7 % (p = 0.044): still elevated, but a thin margin, and 23 Lockdown players are behind the 35 runs.
- The first storm death is at 655 s on Lockdown, 669 s on Ambrose and 683 s on GrandRift (not identical), so the storm timing itself looks similar.
- Victims and survivors both start ~146 px from the nearest exit at 655 s. Survivors then walk to it (median distance change −144 px); victims do not (−3 px; 10 of 17 got no closer by even 30 px) although they had time (median 106 s to die). Deaths are not closer to exits than a random point would be (median 122 px vs ~105 px). So this is not a "storm too strong" or "exit too far" effect so much as players not moving toward extraction.

**Actionable?** Yes, cautiously.
- *Action items:* make the storm and the exits easier to read on Lockdown (exit beacon, storm-start cue or compass); check whether exits stay open and reachable late (three victims died within 34 px of one); only if parity with Ambrose is the intent, tune Lockdown storm timing or damage after that.
- *Metrics affected:* storm share of deaths among players alive at 655 s (49 %, target near Ambrose's 19 %), extraction share among them (51 % vs 74 %), median time to extract after 655 s, storm deaths per run (9.9 % vs 3.0 %).

**Why a level designer should care.** Deaths from not understanding the storm are unfair, frustrating and invisible in normal combat stats. Because the layout, exits and sightlines drive how readable the retreat is, this is level design, not balance.

---

## Checked and dropped

- **"One loot cell holds 6 % of Ambrose loot."** True (543 of 8,988) but it is only 1.37× the runner-up; this is one of several spawn-adjacent loot hubs, not an outlier.
- **"14 % of Ambrose is dead space."** An artefact: 85 % of those cells are the faded map rim, interior dead area is ~3 %, and on Lockdown the north bay water is not land. I removed the claim rather than report it.
- **"First storm death at 655 s on every map."** Wrong (655 / 669 / 683 s); corrected above.
