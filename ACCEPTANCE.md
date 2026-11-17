# Acceptance check

Every acceptance criterion from the requirements (section 11, 7B.14 and 7C.8) and the test that proves it. `npm test` runs the Vitest tests. `npm run e2e` builds the app and runs the browser script `e2e/check.mjs` in headless Chromium.

| Criterion | What it requires | Proved by |
|---|---|---|
| AC-1 | Three Bluetooth and three Wi-Fi tasks together, one view | e2e: "AC-1: six tasks are selected / can be generated / are drawn" |
| AC-2 | Every task expands through the seven pattern generators only | `tests/stageA.test.ts` ("AC-2: every catalogue task expands through the generators only"), `tests/dataIntegrity.test.ts` |
| AC-3 | Antenna, isolation, core mode, arbitration, adaptive hopping change the result as 7A says | `tests/ac3.test.ts` |
| AC-4 | Time view, frequency view, platform diagram, explanation, summary, conflicts styled by outcome | e2e UX-1, UX-5 checks; `tests/components.test.tsx` |
| AC-5 | A selected conflict shows its test, the arbitration rule and each block's outcome | `tests/viewmodels.test.ts` (explanation), e2e "story" checks |
| AC-6 | Five worked examples as exact tests and as presets (a sixth, LE Audio, was added) | `tests/examples.test.ts`; e2e loads each preset |
| AC-7 | Same configuration and seed give identical results | `tests/examples.test.ts` (determinism), `tests/m8lib.test.ts` (share-link round trip gives equal metrics) |
| AC-8 | Save, reload, share link, export PNG, SVG, CSV, JSON, PDF | `tests/m8lib.test.ts`; e2e "VAL-6", "share link", "UX-8" checks |
| AC-9 | Assumptions panel lists 7A.13; content labelled | e2e "AC-9" checks; `tests/assumptions.test.ts` |
| AC-10 | One-second window, eight tasks, under 2 s | `tests/arbitration.test.ts` (speed), `tests/examples.test.ts` |
| AC-11 | UX-1 to UX-8 | see below |
| AC-12 | VAL-1 to VAL-10; no invalid configuration reaches the engine | see below; `tests/arbitration.test.ts` "VAL-8" |

## Experience tests

| Test | Proved by |
|---|---|
| UX-1 empty state to first conflict explanation by on-page guidance | e2e UX-1 block (load-first-example, guide, open-first-conflict, story) |
| UX-2 every block type shows a tooltip with every 7B.5 field | `tests/viewmodels.test.ts`; e2e tooltip checks (300 ms delay, keyboard, position) |
| UX-3 every colour cue has a pattern or shape (greyscale) | `tests/tokens.test.ts`; e2e greyscale screenshot (`e2e/shots/example3-greyscale.png`) |
| UX-4 colour-blind simulation and 4.5:1 text contrast | `tests/tokens.test.ts`; axe contrast scans in e2e |
| UX-5 time view, frequency view and platform diagram stay in sync | e2e UX-5 checks |
| UX-6 applying a suggestion updates the view; compare shows the difference | e2e "UX-6" checks (suggestion, compare) |
| UX-7 all lessons (nine: the five of 7B.11, LE Audio, and three for Thread with Wi-Fi, added at the owner's request) run start to finish with checks, data-driven | `tests/learn.test.ts` (structure, facts checked against the engine, state machine); e2e runs every lesson in the page |
| UX-8 exports open and match the screen | e2e "UX-8" checks (SVG block count equals screen, PNG signature, CSV rows, JSON, PDF signature) |

## Validation tests

| Test | Proved by |
|---|---|
| VAL-1 Wi-Fi 7 on an 802.11n device gives an ERROR with fixes | `tests/validator.test.ts`; e2e "VAL-1" (out-of-range value, badge, fix, undo) |
| VAL-2 two eSCO links with the same offset give P-1 with a fix | `tests/validator.test.ts` |
| VAL-3 A2DP and HFP give the P-4 note and do not block | `tests/validator.test.ts` |
| VAL-4 scan window above interval gives V-3; the fix corrects it | `tests/validator.test.ts` |
| VAL-5 all problems shown at once | `tests/validator.test.ts`; e2e Issues panel |
| VAL-6 an edited file with an invalid value is rejected with the issue | `tests/m8lib.test.ts`; e2e "VAL-6" |
| VAL-7 warnings need a confirmation | `tests/m8lib.test.ts` (gate); e2e "VAL-7" |
| VAL-8 the engine refuses an ERROR configuration | `tests/arbitration.test.ts` |
| VAL-9 every worked example validates | `tests/examples.test.ts` |
| VAL-10 every rule has a failing and a passing test | `tests/validator.test.ts` |

## Thread (added after release)

| What | Proved by |
|---|---|
| 802.15.4 frame timing and the channel plan | `tests/thread.test.ts` ("Thread timing and channel plan") |
| All eight Thread tasks expand through the existing pattern generators, deterministically | `tests/thread.test.ts`, `tests/dataIntegrity.test.ts` |
| Thread against Wi-Fi follows the platform rules; channels 15, 20, 25 and 26 are clear of Wi-Fi channel 6 | `tests/thread.test.ts` ("Thread against Wi-Fi") |
| Retry after the acknowledgement timeout plus backoff | `tests/thread.test.ts` |
| Rules T-1 (Thread version), V-1 (channel range), T-5, P-6, P-8, F-7 and R-3 for Thread; VAL-10 covers P-8 and F-7 | `tests/thread.test.ts`, `tests/validator.test.ts` |
| Examples 7 to 9 and their lessons | `tests/examples.test.ts`, `tests/learn.test.ts` (facts checked against the engine), e2e lesson run |
| Thread in the interface: tab, lanes, diamonds, frequency view, platform, exports, colour and legend | e2e "Thread" block, `tests/tokens.test.ts`, `tests/components.test.tsx` |
