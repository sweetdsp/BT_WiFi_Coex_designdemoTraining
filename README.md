# Coex Learning Tool

An interactive, browser-only tool that teaches test engineers how Bluetooth and Wi-Fi packets share the 2.4 GHz medium: time, frequency, arbitration, and what the platform changes. It is a learning aid, not an RF simulator. It is vendor-neutral and uses only public-standard concepts.

**Status:** under construction, built in milestones. Engine and validator first, user interface after the five worked examples pass.

| Milestone | Scope | State |
|-----------|-------|-------|
| M0 | Project scaffold, CI | done |
| M1 | Data model, JSON data files, validator | done |
| M2 | Seeded RNG, seven pattern generators, timing formulas | done |
| M3 | Frequency footprints, adaptive hopping, conflict detection and severity table | done |
| M4 | Arbitration policies, dynamic priority, anchors, delays, retries | done |
| M5 | Metrics (airtime, overlap, conflicts, per-task impact, latency, anchors) | done |
| M6 | The five worked examples as automated tests and presets | done |
| M7-M9 | Views, controls, lessons, accessibility, Pages deploy | next |

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

## Adding a task

Add one record to `src/data/tasks.json` that names one of the seven pattern generators (`PERIODIC_EVENT`, `SLOT_SCHEDULE`, `BURST_TRAIN`, `WINDOWED_LISTEN`, `SCAN_SWEEP`, `IRREGULAR_BURSTS`, `ONE_SHOT_EXCHANGE`). The data-integrity tests check that every reference in the record resolves.
