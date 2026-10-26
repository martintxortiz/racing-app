# Workbench visual audit (v2 screenshots)

Source: `/workspace/workbench-shots/v2/*.png` (1600×960, head 09bd28f). Verdict: the v2 round pasted
Pitwall-style colour blocks onto our Carbon/Plex system. Data is there, but it is hard to read at a glance
because every cell is shouting. Defects below, grouped by cause. Each item is fixed in v3 or listed as left.

## 1. Global system problems

1. **No single table style.** Timing, Sectors, Lap distribution, Pedal, Lap history and Race control each set their
   own paddings (4/6/8/12 px), row heights (22, 24, 26, auto) and header treatments. Columns never line up
   between panels stacked in the same column.
2. **Header row is not a header.** Table headers are 28 px, 12 px, weight 500, text-2, and sit vertically centred, so
   they read as one more data row. In dark mode the header and first row run together.
3. **Saturated full-cell fills everywhere.** Team colour fills the whole driver cell (edge to edge, 100% saturation),
   purple/green fills are 24–30% mixes with bold text, the to-ideal column is a solid mustard block, the race-control
   flag and car cells are solid blocks. Five strong hues per row; the eye has no resting place.
4. **Zebra is too strong** (55% of `--pw-fill`, ~6% in light, ~4% in dark plus selection blue), and selection,
   focus, hover and compare all use similar blue mixes, so the compared rows are not distinct from zebra in dark.
5. **Comparison marker is an accent stripe** (`inset 3px` coloured bar on the position cell) — banned pattern,
   and it collides with the team block next to it.
6. **Uppercase tokens:** `PIT`, `IN`, `OUT`, `STOP` status cells, lap-history `OUT`/`IN` tags in blue bold, race
   control messages in raw uppercase, `Q1`/`Q2` labels in bold. Reads as noise.
7. **Typography drift:** 10, 11, 12, 13, 15, 16, 18, 28 px all in use; weights 400/500/600 mixed inside one row
   (session-best cells bold, team cells bold, rest regular). Numerals switch between centred and right-aligned.
8. **Panel header:** topic path (`/timing/laps`) is as prominent as the meta text and competes with the title; meta
   strings run long ("Laps within 7% of own best · out and in laps excluded") and truncate mid-word.

## 2. Timing tab (`quali-timing-*`, `race-timing-*`)

9. **Clipped columns.** The timing table's fixed column widths add up to ~760 px in a 576 px panel: `Last` is cut to
   "La", `Trap` and `Laps` are off-screen; the horizontal overflow is hidden, so the user never knows.
10. Pos and driver columns are crammed (`Pos` header wider than its data, 8 px left padding vs 4 px elsewhere).
11. Status column (`PIT`, `IN`) is 36 px of mostly empty space and is left-aligned against right-aligned numbers.
12. Tyre glyph is a 16 px red ring on every row — the column is a wall of red circles in quali (all softs).
13. Gap/Int trend fills (green/red 14–24%) on Int make the race view a checkerboard with the sector fills.
14. **Track map** floats in an over-tall panel; large dead space under the map; driver labels collide (`LEC/HAM`
    overlap at the top-right); corner numbers same weight as driver labels.
15. **Session info**: the full-width saturated green block dominates the screen; "GREEN LIGHT · PIT EXIT OPEN" in
    caps inside it; key/value rows below it are cut off at the panel bottom (`Source` half visible).
16. **Weather**: four readouts + a 60 px chart squeezed under them; the chart legend overlaps the plot top; x-axis
    labels `−56:49`… are negative offsets; y axis labels touch the panel edge.
17. **Lap times chart**: y labels `1:38.000` with three decimals; Q1/Q2/Q3 band labels collide with points;
    x-axis labels `Q1 03:19` overlap; every car drawn as hollow coloured circles + lines → rainbow scatter.
18. **Race control**: Flag and Car columns are solid colour blocks; `Break 06:31` time overflows into the flag
    cell; long uppercase messages wrap to 4–5 lines, so the panel shows only 4 messages.

## 3. Telemetry tab

19. Trace: channel titles (`Speed km/h`) are drawn inside the plot over the data; the Δ-time strip and the gear
    strip get the same visual weight as speed; corner numbers at the top are tiny and clash with the legend line.
20. Pedal use: legend squeezed into a table header; the bar column's saturated green/red/grey reads like a flag;
    numbers (`48.8 21.3 6.0 23.9`) have no unit and no visual link to the bar segments.
21. Sectors (selection) panel is 3 rows in a panel ~150 px tall, then a blank area; the yellow `+0.114` block is
    the loudest thing on the tab.
22. Lap times (selection): sparse points with long connecting lines; axis labels cramped at 250 px width.

## 4. Strategy tab

23. Gaps chart: y axis shows `+0.0 … +136.0` with no unit, 20 grey spaghetti lines with large point markers on
    the compared cars; end labels overlap (`HAM`/`LEC` stacked).
24. Timing (strategy columns) has the same clipped/crowded issues; Int trend fills dominate.
25. Stints: saturated red/yellow bars at full height, labels `S +3 · 24` inside cramped bars, the driver column
    has two dots (slot + team) — inconsistent with the team-cell treatment elsewhere; axis ticks on 12/25/37/50.
26. Weather and Race control again squeezed to ~130 px each.

## 5. Laps tab

27. Lap history: team-coloured header row is a rainbow strip; cells are 60 px fixed so only ~14 cars fit; `OUT`/
    `IN` blue caps tags everywhere; green/purple fills at 24–30% → checkerboard; lap column sticky but same tint.
28. Lap distribution: IQR boxes filled with saturated team colour + the median line; whiskers barely visible;
    axis ticks only 3, labels sit in the header without a baseline; last row clipped by the panel.
29. Sectors (field): 22 rows in a 250 px panel, half the list hidden; solid mustard to-ideal column.

## 6. Menus and chrome

30. Context menus are good structurally; but the hint column (`Auto (by session type)`) is wider than the label,
    the menu is 360 px wide, and the header row (`NOR · Lando NORRIS`) uses the surname in caps.
31. Timeline: label row (`Q1`, `Q2`, `Q3`) and tick row compete; tick labels 11 px text-3 overlap the lap marks.
32. Top bar is fine (tabs left, controls right) — keep.

## What v3 changed

- **One table system** (`.wb-t` in `workbench.css`) used by timing, sectors, lap history, lap distribution, pedal use
  and race control: 24 px rows, 28 px sticky header with bottom-aligned 11 px text-3 labels over one hairline,
  8 px cell padding and 12 px at the panel edge, Plex tabular numerals right-aligned, text left-aligned,
  about 3% zebra, no row rules. Hover, compared and focused rows have one tint each.
- **Semantic tints as per-theme tokens** (`--wb-best-*` purple, `--wb-pb-*` green, `--wb-worse-*` red,
  `--wb-warn-*` amber): a light wash with the 70-grade text of the same hue in light theme and a dark wash with the
  30-grade text in dark theme, both AA. Same weight as the row, except the session best (500).
- **Team colour** is a compact solid chip around the driver code (38 × 16 px, 2 px radius) and nowhere else in a
  table. The comparison slot is a 6 px series-coloured square after the chip. No stripes.
- **Columns fit the panel**: each timing column has a width and a priority per session type
  (`fitColumns` in `lib/workbench/columns.ts`, tested). The least important columns drop first and the header says
  "N columns hidden" with the list in its tooltip. Sectors drops Best, then Ideal. Lap history scrolls sideways with
  a sticky lap column at a width that fits a full lap time.
- **Quiet text instead of tags**: status is sentence case (`Pit`, `In`, `Out`, `Stop`); race control messages are
  shown in sentence case with acronyms and driver codes kept (`sentenceCase` in `lib/workbench/format.ts`, tested);
  the flag is an 8 px square and its name; the car is a chip at the start of the message.
- **Track status** is a tinted line with a flag square (stronger tint for yellow, SC, VSC and red), not a solid
  block. Sector flags are text with flag squares.
- **One chart look** (`axisStyle` and `CHART_GRID` in `EChart.tsx`): 11 px Plex labels in text-3, no ticks, no y axis
  line, hairline grid, the same margins in every chart. Lap and gap charts turn the rest of the field grey when cars
  are compared; lap-time axes read `1:32` not `1:32.000`; compared lines stop at the cursor; part labels sit above the
  plot. The telemetry trace has a label strip above each channel so labels never sit on the data, and corner numbers
  sit above the first strip. Weather ticks on round local clock times.
- **Stints**: driver chip, lap ticks with grid lines through the rows, tyre-coloured bars at 30% with no edge stripe.
- **Lap distribution**: boxes are neutral grey; compared cars use their series colour.
- **Presets**: Timing tower 38% wide; Strategy puts gaps over stints on the left and the tower over weather and race
  control on the right so every panel has room.
