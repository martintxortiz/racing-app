# What the workbench has to answer, and how

A short first-principles pass. Sources: the 51 Pitwall v2 widgets (`/workspace/pitwall/bundle_inventory.md`), Martin's four Pitwall screenshots, Foxglove (topic-bound panels, shared cursor, per-panel settings), MoTeC i2 / McLaren ATLAS (overlaid laps by distance, a delta channel, a shared cursor, maths channels, histograms and the "time lost where" view), and the data we actually have: laps with sector times and speed traps, intervals, stints, pits, race control, weather, pose and telemetry.

**The rule.** An analyst scans a lot of data and stops at whatever stands out. So encoding beats decoration:

- Use cell fills for meaning: purple = session best, green = personal best or a gap that is closing, yellow = yellow flag.
- Fill the driver cell with the team colour instead of a 6 px dot; it scans faster.
- Use zebra rows and tabular numbers so the eye can track along a row.
- Use position (sorted order) for "who is ahead", length (bars) for shares and stints, and spread (a box plot) for consistency.
- Everything is keyed off generic fields (sector_n, *_kph, compound, class, driver), so it holds for F1, LMU multi-class or AC practice.

## Questions by session type

| Session | Question at a glance | Component | Encoding | Priority |
|---|---|---|---|---|
| All | What is happening right now? | Session | big clock + time remaining; full-width track status block filled green / yellow / SC / red; one weather line | P0 |
| All | Why did that happen? | Race control | table: time · category · flag cell filled · message; filter by category; newest first | P0 |
| All | Who is where on track, and in whose traffic? | Track map | dots on the outline; compared cars labelled; follow / zoom | P0 |
| Qualifying | Who is fastest, by how much, and who is out? | Timing tower | ranked by best; gap and interval; sector, best and last cells filled purple/green; cut line when the session defines one (derived from who runs in the next part) | P0 |
| Qualifying / practice | Where is the time? | Sectors / ideal lap | best sectors with fills; ideal; "to ideal" = best − ideal | P0 |
| Qualifying / practice | Where on the lap is time lost vs the reference? | Telemetry | speed / throttle / brake / gear / RPM stacked by distance; Δ-time channel; corner markers; shared cursor | P0 |
| Qualifying / practice | Driving style: commitment, coasting, braking | Pedal behaviour | 100 % stacked bar per driver: full throttle / partial / coast / brake on the chosen lap | P1 |
| Qualifying / practice | Track evolution and who improved | Lap history grid | laps × drivers, cells filled purple / green / in / out / deleted; metric = lap, sector or speed trap | P1 |
| Practice / endurance | Who is quick *and* consistent on long runs? | Lap distribution | box plot per driver (timed laps), sorted by median | P1 |
| Race | Who is gaining and who is under threat? | Timing tower | interval cell green when closing on the car ahead, faint red when dropping back; laps down; pit / out-lap / stopped as a subtle row state | P0 |
| Race | How have gaps developed, and is the undercut working? | Gaps | gap to leader / interval / position by lap; compared drivers highlighted | P0 |
| Race / endurance | Tyre state and strategy | Stints | bars by lap coloured by compound; age; driver swaps | P0 |
| Race | Straight-line speed / tow | Lap grid (speed-trap metric) + tower trap column | per-lap trap speed with field-best purple fills | P2 |
| Endurance | Classes and driver swaps | Tower grouped by class, "in car" column, stints by driver | class sections, per-class purple | P0 (built) |

Left out for now: win probability, pit window, championship points and battle OT%. Each needs a model or season data, not a recording. Team radio needs audio topics. Traffic timeline needs a gap-to-car-ahead-on-track channel; the tower interval and lap grid cover most of it for now.

## Layouts

- **Timing:** tower, map, session, race control, lap times. Answers "what is happening".
- **Telemetry:** stacked traces with Δ and corners, map, sectors, pedal behaviour. Answers "where is the time".
- **Strategy:** gaps, tower, stints, weather, race control. Answers "who wins the race from here".
- **Laps:** lap history grid, box plot, sectors. Answers "track evolution and consistency".
