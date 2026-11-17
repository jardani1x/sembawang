# Sembawang Brook · 3D estate model

An interactive 3D model of **Sembawang Brook** (HDB Build-To-Order, 2026) in Sembawang, Singapore. It is reconstructed from the brochure site plan and photos of HDB's 1:300 sales model. The whole app is one `index.html` built on Three.js r160, and it works on desktop and phones.

**Live:** https://jardani1x.github.io/sembawang-brooks/ (GitHub Pages)

![Sembawang Brook seen from Admiralty Street](docs/preview.jpg)

> **Unofficial.** This is a personal project and is not affiliated with HDB. HDB owns the copyright in the Sembawang Brook design and its sales materials, and no brochure or sales-model images are included here. Layouts and facilities are subject to change. This is a reconstruction, not a survey.

## What's in it

- **Estate:** five residential blocks (437A, 437B, 438A rental, 439A, 440A); Blk 436, an 8-storey car park with its roof garden; the pavilions, shops (440) and sub-station (441); roads, the Sungei Sembawang canal, covered linkways, bus bays, and the neighbouring reserved sites as flat, labelled plots.
- **Blocks:**
  - Every residential block has a dark-glass-grid west tower and a white "light cells" east tower, joined by a link with the 2-Room Flexi stacks and the lift core.
  - Flats occupy storeys 2–30 (2–26 for 438A); storey 1 is a void deck.
  - Each block's flat count reproduces the brochure table (1,360 flats in total).
- **Explore:**
  - **Views:** camera presets that match the sales-model photos.
  - **Block details:** tap a block to see its brochure flat mix and every stack (type and which way it faces). Tapping a facade also picks the stack under your finger.
  - **Search and filters:** search blocks, `#120`, `#12-160`, flat types, facilities and roads; colour stacks by flat type and filter by type.
  - **Storey highlight.**
- **My flat:** set your block, unit and storey to highlight the flat and estimate its **direct sun hours** on the main facade for any date. The table also shows the equinoxes and solstices. Your flat is saved only in your own browser.
- **Sun & shadows:** NOAA solar position for Singapore (UTC+8), with a date and time slider, playback, sun path, and sunrise, solar noon and sunset.
- **Tools:**
  - measure distances
  - eye-level walk mode (WASD, or a touch joystick)
  - layer toggles
  - editable storey and void-deck heights
  - export and import of settings and data as JSON
  - PNG snapshot

## Accuracy

| | Source | Confidence |
|---|---|---|
| Block positions, footprints, 25.5° estate grid, roads, canal | Brochure site plan; scale bar 0.708 m/px, measured three ways (within 0.2%) | Measured |
| Storeys, flat mix, unit numbers, labels | Brochure table and site plan, sales-model tags | Read |
| Storey 1 = void deck | Every block's flat count divides exactly by its residential floors | Derived |
| Facades, roof tanks, car-park roof garden | Sales-model photos | Modelled from photos |
| Floor-to-floor 2.8 m, void deck 3.6 m | Consistent with the model photos (2.7–2.9 m; 3.2–4.6 m), but not printed in the brochure | **Estimated** (editable in the app) |
| Car-park (~24 m) and low-rise heights | Not printed in the brochure | Estimated |
| Trees, play equipment, shelters | Placed to look like the model | Representative |

Known uncertainties:
- Absolute heights.
- Slab depth.
- The labels on Blk 437A stacks #116 and #118: the brochure digits are illegible, so the numbering follows the pattern of the other blocks. The flat types are certain.
- Which 438A tower holds the 1-Room and which the 2-Room rental flats.
- Future buildings on the reserved sites, which aren't modelled and would change views and sun.

Sun hours are a geometric estimate at the centre of the flat's main facade, blocked by the modelled buildings only.

## Run it

Open `index.html` in a recent browser. It needs internet, because Three.js loads from jsDelivr. No build step is needed to use it.

## Develop

```
src/            app modules (00_core … 90_main), style.css, template.html
data/           site-data.json (generated) + source/ (measured site-plan geometry)
tools/          build_data.py → data/site-data.json · build.py → index.html · fetch_three.sh
tests/          run.py (headless Chrome, 40 checks) · probe.py (ad-hoc screenshots)
```

```sh
python3 tools/build_data.py        # regenerate data (self-checks the brochure totals)
python3 tools/build.py             # inline everything into index.html
pip install playwright && python -m playwright install chromium
sh tools/fetch_three.sh            # local three.js for offline tests
python3 tests/run.py               # optional: CHROME=/path/to/chrome
```

The tests cover console errors, data validation, the sun position against independent values, every control, search, filters, measure, walk, export/import with rollback on bad input, persistence, and the phone layout. Frame rate and iOS Safari behaviour aren't covered, because the tests run in a software renderer.
