# Coex Learning Tool

An interactive, browser-only tool that teaches test engineers how Bluetooth and Wi-Fi packets share the 2.4 GHz medium: time, frequency, arbitration, and what the platform changes. It is a learning aid, not an RF simulator. It is vendor-neutral and uses only public-standard concepts.

**Status:** complete. See `ACCEPTANCE.md` for every acceptance criterion and the test that proves it, and `ASSUMPTIONS.md` for every assumption.

**Live demo:** published by GitHub Pages from `main` (see `.github/workflows/pages.yml`). Enable Pages with source "GitHub Actions" in the repository settings.

| Milestone | Scope | State |
|-----------|-------|-------|
| M0 | Project scaffold, CI | done |
| M1 | Data model, JSON data files, validator | done |
| M2 | Seeded RNG, seven pattern generators, timing formulas | done |
| M3 | Frequency footprints, adaptive hopping, conflict detection and severity table | done |
| M4 | Arbitration policies, dynamic priority, anchors, delays, retries | done |
| M5 | Metrics (airtime, overlap, conflicts, per-task impact, latency, anchors) | done |
| M6 | The five worked examples as automated tests and presets | done |
| M7 | Time and frequency views, platform diagram, explanation panel, summary strip, tooltips, playback, tokens and themes | done |
| M8 | Task selection, platform controls, live validation, undo, save/load/share, compare, export | done |
| M9 | Six lessons, first-visit tour, glossary, assumptions panel, help texts, accessibility pass, Pages deploy, acceptance check | done |

## Layout

- `src/data/*.json` — every constant, task, packet table, priority rule, validation rule and assumption. Nothing numeric is hard-coded in engine code.
- `src/engine/` — pure TypeScript with no browser dependencies (checked by `tsconfig.engine.json`, which has no DOM library).
- `src/engine/validator/` — the validation gate (spec 7C). The engine calls it itself and refuses to run on any ERROR.
- `tests/` — Vitest tests.
- `ASSUMPTIONS.md` — generated from `src/data/assumptions.json` (`npm run assumptions`).

## Commands

```
npm install
npm test            # Vitest
npm run typecheck   # app and engine
npm run dev         # development server
npm run build       # static build for GitHub Pages
```

## Using the tool

- **Learn** opens six guided lessons (the six worked examples, easiest first). Each loads its scenario, highlights the part of the page it talks about, and ends with one question.
- **Help** replays the six-step tour, opens the glossary and the assumptions, and lists the keyboard shortcuts (`?`).
- Build your own scenario in the **Tasks** and **Platform** tabs. The badge at the top says whether it can be generated; **Issues** lists every problem with a fix button.
- Everything you see is labelled **Standard says** (fixed by a public specification) or **Implementations vary** (a choice real products make differently).

## Adding content without changing code

| To add | Edit |
|---|---|
| a task | `src/data/tasks.json` (below) |
| a lesson | `src/data/lessons.json`; list facts in `verify` and the tests check them against the engine |
| a glossary term | `src/data/glossary.json`; it is underlined wherever its words appear |
| help for a rule | `src/data/helpTopics.json` |
| a use case or platform preset | `src/data/useCases.json`, `src/data/platformDefaults.json` |

## Adding a task

Add one record to `src/data/tasks.json` that names one of the seven pattern generators (`PERIODIC_EVENT`, `SLOT_SCHEDULE`, `BURST_TRAIN`, `WINDOWED_LISTEN`, `SCAN_SWEEP`, `IRREGULAR_BURSTS`, `ONE_SHOT_EXCHANGE`). The data-integrity tests check that every reference in the record resolves.

## Browser checks

`npm run e2e` builds the app, serves it and runs `e2e/check.mjs` in headless Chromium (UX-1, UX-2, UX-5 to UX-8, the builder and validation gate, undo, files, share links, compare, exports, tour, lessons, glossary, assumptions, an axe accessibility scan, keyboard focus, playback, zoom, theme, reduced motion, and panning speed with more than 20,000 blocks). Screenshots go to `e2e/shots/`.
