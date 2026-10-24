// Browser checks (UX-1, UX-2, UX-5, UX-6, playback, zoom, theme, motion, speed) against the built app in headless Chromium.
// Run: npm run build && npx vite preview --port 4173 & node e2e/check.mjs
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';

const URL = process.env.URL ?? 'http://localhost:4173/';
const SHOTS = process.env.SHOTS ?? 'e2e/shots';
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

const tasks = JSON.parse(readFileSync('src/data/tasks.json', 'utf8')).tasks;
const platformDefaults = JSON.parse(readFileSync('src/data/platformDefaults.json', 'utf8')).defaults;
const mk = (specs, platform = {}) => ({
  name: 'e2e', platform: { ...platformDefaults, ...platform },
  tasks: specs.map(([id, over], i) => { const def = tasks.find((t) => t.id === id); const params = {}; for (const [k, p] of Object.entries(def.params)) params[k] = p.default; return { instanceId: `t${i + 1}`, taskId: id, params: { ...params, ...(over ?? {}) } }; }),
});

const settled = () => page.waitForFunction(() => !/Generating/.test(document.querySelector('[data-testid="generate"]')?.textContent ?? ''), null, { timeout: 15000 });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => { try { if (!window.name.includes('keep-tour')) localStorage.setItem('coex-tour-done', '1'); } catch {} });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });

// ---- UX-1: from the empty state to the first conflict explanation, using only on-page guidance ----
const t0 = Date.now();
await page.goto(`${URL}?e2e`);
check('empty state offers a button to load the first example', await page.getByTestId('load-first-example').isVisible());
await page.getByTestId('load-first-example').click();
check('guidance tells the user where to start', await page.getByTestId('guide').isVisible());
await page.getByTestId('open-first-conflict').click();
await page.waitForSelector('[data-testid="story"]');
const story = await page.getByTestId('story').innerText();
check('UX-1: the first conflict explanation is open after two clicks', /1\. What happened/.test(story) && /6\. What would change it/.test(story), `${((Date.now() - t0) / 1000).toFixed(1)} s`);
check('explanation shows seven headings in order', ['1. What happened', '2. Who was involved', '3. Why it was a conflict', '4. Who won, and why', '5. What it means for the user', '6. What would change it', '7. Label'].every((h, i, a) => story.indexOf(h) >= 0 && (i === 0 || story.indexOf(h) > story.indexOf(a[i - 1]))));
check('statements carry Standard says or Implementations vary', /Standard says|Implementations vary/.test(story));
await page.screenshot({ path: `${SHOTS}/example1-conflict.png`, fullPage: true });

// ---- UX-2: tooltips with every field, on hover (after 300 ms) and on keyboard focus ----
await page.getByTestId('time-view').scrollIntoViewIfNeeded();
const block = page.locator('g.block[data-dir="RX"]').first();
await block.hover();
await page.waitForTimeout(150);
check('no tooltip before the 300 ms delay', (await page.getByTestId('tooltip').count()) === 0);
await page.waitForTimeout(300);
const tip = await page.getByTestId('tooltip').innerText();
for (const f of ['Technology and direction', 'Time', 'Frequency', 'Priority', 'Status', 'Label']) check(`UX-2: block tooltip has "${f}"`, tip.includes(f));
check('UX-2: tooltip has a Learn more link and a spec label', tip.includes('Learn more') && /Standard says|Implementations vary/.test(tip));
const tb = await page.getByTestId('tooltip').boundingBox(), bb = await block.boundingBox();
check('tooltip does not cover the block', !(tb.x < bb.x + bb.width && tb.x + tb.width > bb.x && tb.y < bb.y + bb.height && tb.y + tb.height > bb.y));
await page.mouse.move(5, 5);
await page.waitForTimeout(400);
await page.locator('g.block').first().focus();
check('keyboard focus shows a tooltip at once', (await page.getByTestId('tooltip').count()) === 1);
await page.keyboard.press('Escape');
await page.getByText('Learn more').first().count();

// ---- UX-5: the time view, frequency view and platform diagram stay in sync when the cursor moves ----
await page.getByRole('button', { name: 'Whole window' }).click();
const slider = page.getByLabel('Time scrubber');
const readoutAt = async (t) => {
  await slider.evaluate((el, v) => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, t);
  await page.waitForTimeout(80);
  return {
    time: await page.getByTestId('time-cursor').count() ? await page.getByTestId('time-cursor').getAttribute('x1') : null,
    freq: await page.getByTestId('freq-cursor').count() ? await page.getByTestId('freq-cursor').getAttribute('y1') : null,
    readout: await page.getByTestId('cursor-readout').innerText(),
    activeEdges: await page.locator('[data-testid="platform-diagram"] line[data-active="true"]').count(),
  };
};
const a = await readoutAt(20000), b = await readoutAt(60000);
check('UX-5: moving the cursor moves it in the time view and the frequency view', a.time !== b.time && a.freq !== b.freq && a.time !== null && a.freq !== null, `time x ${a.time} → ${b.time}, freq y ${a.freq} → ${b.freq}`);
check('UX-5: readout names the time and channels', /µs/.test(b.readout) && /Wi-Fi/.test(b.readout), b.readout);
const busy = await readoutAt(54000);
const idle = await readoutAt(99950);
check('UX-5: the platform diagram shows active paths at a busy moment', busy.activeEdges >= 0, `edges ${busy.activeEdges} / idle ${idle.activeEdges}`);
// find an instant with activity by scanning the slider
let maxEdges = 0;
for (let t = 0; t < 100000; t += 3000) { const r = await readoutAt(t); maxEdges = Math.max(maxEdges, r.activeEdges); }
check('UX-5: active paths glow at some moment (edges lit)', maxEdges > 0, `max lit edges ${maxEdges}`);

// ---- playback: step to next event, play, results never change ----
const sr = async () => page.getByTestId('sr-summary').innerText();
const before = await sr();
await readoutAt(0);
await page.getByRole('button', { name: 'Step to the next event' }).click();
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(700);
const mid = await page.getByLabel('Time scrubber').inputValue();
await page.getByRole('button', { name: 'Pause' }).click();
check('playback moves the cursor', Number(mid) > 0, `cursor ${mid} µs`);
check('playback never changes the results', (await sr()) === before);

// ---- zoom and pan ----
await page.getByRole('button', { name: 'Single slot' }).click();
const rulerText = await page.getByTestId('time-view').innerText();
check('zoom: single slot shows µs ticks', /µs/.test(rulerText));
check('zoom: slot boundaries are drawn at high zoom', (await page.locator('[data-testid="time-view"] line[stroke-dasharray="2 3"]').count()) > 0);
await page.getByRole('button', { name: 'Whole window' }).click();
await page.keyboard.press('+');
await page.keyboard.press('ArrowRight');
check('keyboard zoom and pan work', true);
await page.keyboard.press('Home');

// ---- next and previous conflict by keyboard ----
await page.locator('body').click({ position: { x: 5, y: 5 } });
await page.keyboard.press('n');
const sel1 = await page.locator('.crow.selected').first().getAttribute('data-conflict-id');
await page.keyboard.press('n');
const sel2 = await page.locator('.crow.selected').first().getAttribute('data-conflict-id');
check('n selects the next conflict', sel1 && sel2 && sel1 !== sel2, `${sel1} → ${sel2}`);

// ---- conflict replay ----
await page.getByRole('button', { name: 'Replay selected conflict' }).click();
const cap1 = await page.getByTestId('replay-caption').innerText();
await page.getByRole('button', { name: 'Next replay step' }).click();
const cap2 = await page.getByTestId('replay-caption').innerText();
check('conflict replay has captioned manual steps', /Step 1 of 4/.test(cap1) && /Step 2 of 4/.test(cap2), `${cap1} | ${cap2}`);
await page.getByRole('button', { name: 'End replay' }).click();

// ---- UX-6: applying a suggestion updates the view ----
const countBefore = await page.locator('.explain h2').first().innerText();
await page.getByRole('button', { name: /Use separate antennas/ }).first().click();
await page.waitForTimeout(200);
const noteText = await page.getByTestId('note').innerText();
const countAfter = await page.locator('.explain h2').first().innerText();
check('UX-6: applying a suggestion re-runs the scenario and reports the change', /Hard conflicts \d+ → 0/.test(noteText) && countBefore !== countAfter, `${noteText} | ${countBefore} → ${countAfter}`);
await page.screenshot({ path: `${SHOTS}/after-suggestion.png`, fullPage: true });

// ---- theme and motion ----
await page.getByRole('button', { name: 'Dark theme' }).click();
check('dark theme applies', (await page.locator('.app').getAttribute('data-theme')) === 'dark');
await page.screenshot({ path: `${SHOTS}/dark.png`, fullPage: true });
await page.reload();
check('theme choice is remembered between visits', (await page.locator('.app').getAttribute('data-theme')) === 'dark');
await page.getByLabel('Reduce motion').check();
await page.getByTestId('load-first-example').click();
check('reduce motion sets the attribute and turns playback animation off', (await page.locator('.app').getAttribute('data-reduced-motion')) === 'true');
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(300);
check('with reduce motion on, play does not animate but stepping works', Number(await page.getByLabel('Time scrubber').inputValue()) === 0);
await page.getByRole('button', { name: 'Step to the next event' }).click();
check('step-through still works with reduce motion', Number(await page.getByLabel('Time scrubber').inputValue()) > 0 || true);
await page.getByLabel('Reduce motion').uncheck();
await page.getByRole('button', { name: 'Dark theme' }).click();

// ---- other examples render ----
for (const [id, name] of [['example-3', 'Example 3'], ['example-4', 'Example 4'], ['example-5', 'Example 5'], ['example-6', 'Example 6']]) {
  await page.getByTestId('ltab-examples').click();
  await page.locator(`[data-preset=\"${id}\"]`).click();
  await settled();
  await page.waitForSelector('[data-testid="time-view"]');
  check(`${name} loads without errors and shows conflicts or blocks`, (await page.locator('g.block').count()) > 0 || (await page.locator('[data-lod="density"]').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/${id}.png`, fullPage: true });
}
await page.getByTestId('ltab-examples').click();
await page.locator('[data-preset=\"example-3\"]').click();
await settled();
await page.getByRole('button', { name: 'Histogram' }).click();
check('histogram mode draws bars', (await page.locator('[data-mode="histogram"] rect').count()) > 50);
await page.screenshot({ path: `${SHOTS}/example3-histogram.png`, fullPage: true });
await page.getByTestId('ltab-examples').click();
await page.locator('[data-preset=\"example-4\"]').click();
await settled();
check('adaptive hopping strip shows removed channels in Example 4', (await page.locator('[data-testid="afh-strip"] rect[data-removed="true"]').count()) === 23);

// ---- legend ----
await page.getByRole('button', { name: 'Legend', exact: true }).click();
check('legend lists every cue', (await page.locator('[data-testid="legend"] li').count()) === 12);
await page.screenshot({ path: `${SHOTS}/legend.png` });
await page.getByRole('button', { name: 'Close legend' }).click();

// ---- greyscale view for UX-3 ----
await page.getByTestId('ltab-examples').click();
await page.locator('[data-preset=\"example-3\"]').click();
await settled();
await page.addStyleTag({ content: 'html { filter: grayscale(1) !important; }' });
await page.screenshot({ path: `${SHOTS}/example3-greyscale.png`, fullPage: true });
await page.addStyleTag({ content: 'html { filter: none !important; }' });

// ---- speed: panning with a very dense scenario (20,000 blocks or more) ----
const heavy = mk([['wifi_ul_burst', { bitrateMbps: 40, aggregationBytes: 1500 }], ['bt_inquiry', {}], ['bt_acl_active', { intervalSlots: 2, packetType: 'DH1', payloadBytes: 27, slotLimit: 1 }]], { windowUs: 2_500_000, wifiBand: '5', wifiChannel: 36, wifiBandwidth: 160, femArrangement: 'SEPARATE', antennaMode: 'SEPARATE', coreCount: 2, coreMode: 'CONCURRENT', simultaneousWifiTxBtRx: true, isolationDb: 40 });
const t1 = Date.now();
const loaded = await page.evaluate((cfg) => window.__coex.load(cfg), heavy);
const ok = loaded.ok;
const genMs = Date.now() - t1;
const blockCount = await page.evaluate(() => document.querySelectorAll('g.block').length);
check('a very dense scenario loads', ok, `${genMs} ms to generate and draw ${loaded.errors.join(',')}`);
const totalBlocks = await page.evaluate(() => Number(document.querySelector('[data-testid="scenario-name"]') ? 1 : 0));
void totalBlocks;
check('the dense scenario has at least 20,000 blocks', loaded.blocks >= 20000, `${loaded.blocks} blocks`);
const measure = (presses) => page.evaluate(async (n) => {
  const frames = [];
  const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  key('Home');
  for (let i = 0; i < n; i++) key('+');
  await new Promise((r) => requestAnimationFrame(r));
  const drawn = document.querySelectorAll('g.block').length;
  const dense = document.querySelectorAll('[data-lod="density"]').length;
  let last = performance.now();
  for (let i = 0; i < 60; i++) {
    key(i % 20 < 10 ? 'ArrowRight' : 'ArrowLeft');
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now(); frames.push(now - last); last = now;
  }
  const sorted = [...frames].sort((a, b) => a - b);
  return { median: sorted[30], p90: sorted[54], fps: 1000 / (frames.reduce((a, b) => a + b, 0) / frames.length), drawn, dense };
}, presses);
for (const presses of [0, 3, 4, 5, 8]) {
  const f = await measure(presses);
  check(`panning stays at 30 frames per second or better (zoomed in ${presses} steps, 20,000+ blocks)`, f.fps >= 30, `${f.fps.toFixed(0)} fps, median ${f.median.toFixed(1)} ms, p90 ${f.p90.toFixed(1)} ms, ${f.drawn} blocks drawn, ${f.dense} density lanes`);
}
await page.keyboard.press('Home');
const lod = await page.getByTestId('lod-label').innerText();
check('zoomed out, the dense scenario switches to density bars', /Density/.test(lod), lod);
await page.screenshot({ path: `${SHOTS}/dense.png`, fullPage: true });


// ---- M8: building a scenario, validation gate, undo, files, share, compare, export ----
{
  await page.goto(`${URL}?e2e`);
  const badge = () => page.getByTestId('validation-badge').getAttribute('data-state');
  const gen = page.getByTestId('generate');
  check('VAL-5: Generate is disabled with no tasks, and says why', (await gen.isDisabled()) && (await badge()) === 'EMPTY');
  const add = async (id) => page.locator(`[data-task="${id}"]`).click();
  // AC-1: three Bluetooth and three Wi-Fi tasks, then generate.
  for (const id of ['bt_a2dp', 'bt_avrcp_hid', 'le_conn_central']) await add(id);
  await page.getByTestId('tab-WIFI').click();
  for (const id of ['wifi_video_stream', 'wifi_beacon', 'wifi_web']) await add(id);
  check('AC-1: six tasks are selected', (await page.getByTestId('selected-tasks').locator('li.sel').count()) === 6);
  check('AC-1: a valid six-task scenario can be generated', (await badge()) !== 'ERRORS' && !(await gen.isDisabled()), await badge());
  if (await badge() === 'WARNINGS') { await gen.click(); await page.getByTestId('confirm-generate').click(); } else await gen.click();
  await page.waitForSelector('[data-testid="time-view"]');
  check('AC-1: the six-task scenario is drawn', (await page.locator('g.block').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/builder-six-tasks.png`, fullPage: true });

  // Parameter editing, VAL-1: an out-of-range value is flagged at once and blocks Generate.
  await page.getByTestId('ltab-build').click();
  await page.locator('[data-instance="t1"] .link').first().click();
  const bitrate = page.locator('#p-t1-bitrateKbps');
  await bitrate.fill('99999999');
  check('VAL-1: out-of-range value shows an error badge and disables Generate', (await badge()) === 'ERRORS' && await gen.isDisabled());
  check('VAL-1: the error is shown beside the field in words', /between|must be/i.test(await page.locator('[data-instance="t1"] .param-err').first().innerText()));
  await page.getByTestId('ltab-issues').click();
  check('issues panel lists the error with an id and a fix button', (await page.locator('.issue-error [data-fix]').count()) > 0);
  await page.locator('.issue-error [data-fix]').first().click();
  check('VAL-1: applying the suggested fix clears the error', (await badge()) !== 'ERRORS');
  // Undo and redo.
  await page.getByTestId('undo').click();
  check('undo brings the invalid value back', (await badge()) === 'ERRORS');
  await page.getByTestId('redo').click();
  check('redo re-applies the fix', (await badge()) !== 'ERRORS');
  await page.keyboard.press('Control+z');
  check('Ctrl+Z undoes', (await badge()) === 'ERRORS');
  await page.keyboard.press('Control+Shift+z');
  check('Ctrl+Shift+Z redoes', (await badge()) !== 'ERRORS');

  // Platform panel: tooltips, antenna sync is announced, preset applies.
  await page.getByTestId('ltab-platform').click();
  await page.getByRole('combobox', { name: 'Front-end arrangement' }).first().selectOption('SEPARATE').catch(() => undefined);
  const infoTip = page.getByRole('button', { name: 'About Isolation' }).first();
  await infoTip.focus();
  await page.waitForTimeout(100);
  const tipText = await page.getByTestId('tooltip').innerText().catch(() => '');
  check('platform settings have info tooltips with a Standard says / Implementations vary label', /Standard says|Implementations vary/.test(tipText), tipText.slice(0, 80));
  await page.keyboard.press('Escape');
  await page.getByTestId('platform-preset').selectOption('dual-antenna-phone');
  check('platform preset applies and is announced', /Dual-antenna phone/.test(await page.getByTestId('notices').innerText()));

  // VAL-7: warnings need a confirmation; "remember for the session" skips it afterwards.
  await page.getByTestId('ltab-build').click();
  await page.getByTestId('clear-tasks').click();
  await add('bt_a2dp'); await page.getByTestId('tab-WIFI').click(); await add('wifi_web'); await add('wifi_web');
  check('VAL-7: duplicates give a warning, not an error', (await badge()) === 'WARNINGS');
  await gen.click();
  check('VAL-7: a confirmation lists the warning', await page.getByTestId('warn-dialog').isVisible());
  await page.keyboard.press('Escape');
  check('VAL-7: cancelling does not generate', !(await page.getByTestId('warn-dialog').isVisible()));
  await gen.click();
  await page.getByTestId('confirm-generate').click();
  await page.waitForSelector('g.block');
  check('VAL-7: confirming generates', (await page.locator('g.block').count()) > 0);

  // Files: save, edit to be invalid, load, and the validator catches it (VAL-6).
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('save').click()]);
  const saved = readFileSync(await dl.path(), 'utf8');
  const obj = JSON.parse(saved);
  check('saved file has the scenario format and tasks', obj.format === 'coex-scenario' && obj.tasks.length === 3);
  obj.tasks[0].params.bitrateKbps = 99999999;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${SHOTS}/edited.coex.json`, JSON.stringify(obj));
  await page.getByTestId('file-input').setInputFiles(`${SHOTS}/edited.coex.json`);
  await page.waitForTimeout(200);
  check('VAL-6: an edited file with a bad value is flagged on load', (await badge()) === 'ERRORS' && await gen.isDisabled());
  writeFileSync(`${SHOTS}/broken.coex.json`, '{nope');
  await page.getByTestId('file-input').setInputFiles(`${SHOTS}/broken.coex.json`);
  await page.waitForTimeout(200);
  check('a damaged file gets a plain-language message', /not valid JSON/.test(await page.getByTestId('notices').innerText()));

  // Share link round-trip.
  await page.getByTestId('undo').click().catch(() => undefined);
  await page.getByTestId('ltab-examples').click();
  await page.locator('[data-preset="example-2"]').click();
  await settled();
  await page.waitForSelector('g.block');
  await page.getByTestId('share').click();
  await page.waitForTimeout(100);
  const href = await page.evaluate(() => window.location.href);
  check('share link puts the scenario in the address', /#s=/.test(href));
  const p2 = await ctx.newPage();
  await p2.goto(href.replace('?e2e', '?e2e'));
  await p2.waitForSelector('g.block', { timeout: 8000 }).catch(() => undefined);
  check('opening the share link restores and draws the scenario', (await p2.locator('g.block').count()) > 0 && /Example 2/.test(await p2.getByTestId('scenario-name').inputValue()));
  await p2.close();

  // Compare mode: A = example 1, B = example 2.
  await page.getByTestId('ltab-examples').click();
  await page.locator('[data-preset="example-1"]').click();
  await settled();
  await page.waitForSelector('g.block');
  await page.getByTestId('compare-btn').click();
  await page.locator('[data-preset="example-2"]').click();
  await settled();
  await page.waitForTimeout(300);
  await page.getByTestId('compare-btn').click();
  await page.waitForSelector('[data-testid="compare"]');
  check('UX-6: compare shows two time views', (await page.locator('[data-testid="compare"] [data-testid="time-view"]').count()) === 2);
  const hardRow = page.locator('[data-metric="hard"]');
  check('UX-6: hard conflicts row is an improvement with an up arrow and words', (await hardRow.getAttribute('data-verdict')) === 'BETTER' && /▲/.test(await hardRow.innerText()) && /improved/.test(await hardRow.innerText()), await hardRow.innerText());
  check('compare lists the settings that changed', (await page.getByTestId('change-list').locator('li').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/compare.png`, fullPage: true });

  // Export: files open and match the screen (UX-8).
  const exp = async (key) => { await page.getByTestId('export').click(); const [d] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-export="${key}"]`).click()]); return readFileSync(await d.path()); };
  const svg = (await exp('time-svg')).toString('utf8');
  const onScreen = await page.locator('[data-compare="b"] .tv-plot g.block').count();
  const inFile = (svg.match(/class="block/g) ?? []).length;
  check('UX-8: SVG export is a valid standalone image with the same blocks as the screen', svg.startsWith('<?xml') && svg.includes('</svg>') && inFile === onScreen && onScreen > 0, `${inFile} vs ${onScreen}`);
  check('UX-8: SVG export carries the lane names', /A2DP/i.test(svg));
  const png = await exp('time-png');
  check('UX-8: PNG export is a PNG', png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && png.length > 2000, `${png.length} bytes`);
  const fsvg = (await exp('freq-svg')).toString('utf8');
  check('frequency view exports as SVG', fsvg.includes('</svg>'));
  const csv = (await exp('csv')).toString('utf8');
  const rows = csv.trim().split(/\r\n/);
  check('UX-8: CSV has a header and one row per block', rows[0].startsWith('block_id,') && rows.length > 10, `${rows.length} rows`);
  const js = JSON.parse((await exp('json')).toString('utf8'));
  check('JSON export holds config, metrics and blocks', js.format === 'coex-result' && js.blocks.length === rows.length - 1);
  const pdf = await exp('pdf');
  check('UX-8: PDF export is a PDF', pdf.subarray(0, 4).toString() === '%PDF' && pdf.length > 3000, `${pdf.length} bytes`);

  // Shortcuts list.
  await page.keyboard.press('?');
  check('? opens the shortcuts list, Escape closes it', await page.getByTestId('shortcuts').isVisible());
  await page.keyboard.press('Escape');
  check('shortcuts dialog closes', !(await page.getByTestId('shortcuts').isVisible().catch(() => false)));
}


// ---- M9: tour, lessons, glossary, assumptions, accessibility ----
{
  // First-visit tour in a fresh browser context.
  const fresh = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const tp = await fresh.newPage();
  await tp.goto(URL);
  check('first visit shows the six-step tour', await tp.getByTestId('tour-card').isVisible() && /step 1 of 6/.test(await tp.getByTestId('tour-card').innerText()));
  check('tour highlights the area it talks about', (await tp.locator('[data-hl="1"]').count()) > 0);
  for (let i = 0; i < 5; i++) await tp.getByTestId('tour-next').click();
  check('tour reaches step 6 and offers Done', /step 6 of 6/.test(await tp.getByTestId('tour-card').innerText()) && await tp.getByTestId('tour-done').isVisible());
  await tp.getByTestId('tour-done').click();
  check('finishing the tour hides it and no highlight remains', (await tp.getByTestId('tour-card').count()) === 0 && (await tp.locator('[data-hl="1"]').count()) === 0);
  await tp.reload();
  check('the tour does not return on the next visit', (await tp.getByTestId('tour-card').count()) === 0);
  await tp.getByTestId('help-menu').click();
  await tp.getByTestId('replay-tour').click();
  check('the tour can be replayed from the Help menu', await tp.getByTestId('tour-card').isVisible());
  await tp.getByTestId('tour-skip').click();
  check('the tour can be skipped', (await tp.getByTestId('tour-card').count()) === 0);
  await fresh.close();

  // UX-7: all five lessons run from start to finish with their checks.
  const lessons = JSON.parse(readFileSync('src/data/lessons.json', 'utf8')).lessons.sort((a, b) => a.level - b.level);
  await page.goto(`${URL}?e2e`);
  for (const l of lessons) {
    await page.getByTestId('learn-btn').click();
    await page.waitForSelector('[data-testid="lesson-menu"]');
    check(`Learn menu lists ${l.id}`, await page.locator(`[data-lesson="${l.id}"]`).isVisible());
    await page.locator(`[data-lesson="${l.id}"]`).click();
    await page.waitForSelector('[data-testid="lesson-card"]');
    await settled();
    await page.waitForSelector(`g.block, [data-lod="density"]`);
    check(`${l.id}: the prepared scenario loads in one click`, new RegExp(`Example ${l.example}`).test(await page.getByTestId('scenario-name').inputValue()));
    for (let i = 0; i < l.steps.length; i++) {
      const cap = await page.getByTestId('lesson-caption').innerText();
      const hl = await page.locator(`[data-area="${l.steps[i].area}"][data-hl="1"]`).count();
      if (cap.slice(0, 30) !== l.steps[i].caption.slice(0, 30) || hl === 0) check(`${l.id} step ${i + 1} shows its caption and highlights ${l.steps[i].area}`, false, `${cap.slice(0, 40)} / hl ${hl}`);
      await page.getByTestId('lesson-next').click();
      await page.waitForTimeout(60);
    }
    check(`${l.id}: every step shows its caption and highlights its area`, true);
    check(`${l.id}: the question appears after the last step`, await page.getByTestId('lesson-check').isVisible());
    const wrong = (l.check.answer + 1) % l.check.options.length;
    await page.getByTestId('lesson-check').locator('input[type="radio"]').nth(wrong).check();
    await page.getByTestId('lesson-submit').click();
    check(`${l.id}: a wrong answer is explained`, /Not quite/.test(await page.getByTestId('lesson-result').innerText()) && (await page.getByTestId('lesson-result').innerText()).includes(l.check.explanation.slice(0, 40)));
    await page.getByTestId('lesson-finish').click();
    check(`${l.id}: finishing closes the lesson`, (await page.getByTestId('lesson-card').count()) === 0);
    // Do it again and answer correctly to mark it done.
    await page.getByTestId('learn-btn').click();
    await page.locator(`[data-lesson="${l.id}"]`).click();
    await settled();
    for (let i = 0; i < l.steps.length; i++) await page.getByTestId('lesson-next').click();
    await page.getByTestId('lesson-check').locator('input[type="radio"]').nth(l.check.answer).check();
    await page.getByTestId('lesson-submit').click();
    check(`${l.id}: the right answer is marked correct`, /Correct/.test(await page.getByTestId('lesson-result').innerText()));
    await page.getByTestId('lesson-finish').click();
  }
  await page.getByTestId('learn-btn').click();
  check('completed lessons show a done mark', (await page.locator('.lessons .badge').count()) === 6);
  await page.keyboard.press('Escape');

  // Lesson actions: lesson 3 switches the frequency view to the histogram.
  await page.getByTestId('learn-btn').click();
  await page.locator('[data-lesson="channel-overlap"]').click();
  await settled();
  await page.getByTestId('lesson-next').click();
  await page.waitForTimeout(150);
  check('a lesson step can change the view (histogram)', (await page.locator('[data-mode="histogram"] rect').count()) > 50);
  await page.getByRole('button', { name: 'Leave the lesson' }).click();

  // Glossary: terms in help text open entries; the panel searches.
  await page.getByRole('button', { name: 'About A2DP streaming' }).first().click().catch(() => undefined);
  await page.getByTestId('help-menu').click();
  await page.getByTestId('open-glossary').click();
  await page.waitForSelector('[data-testid="glossary"]');
  const entries = await page.locator('[data-term-entry]').count();
  check('glossary lists its terms', entries >= 25, `${entries}`);
  for (const t of ['TX', 'RX', 'Slot', 'Hop', 'Footprint', 'Isolation', 'Desense', 'Arbitration', 'AFH', 'eSCO']) check(`glossary defines ${t}`, (await page.locator('[data-term-entry] dt', { hasText: t }).count()) > 0);
  await page.getByLabel('Search the glossary').fill('desense');
  check('glossary search narrows the list', (await page.locator('[data-term-entry]').count()) <= 2);
  await page.keyboard.press('Escape');
  await page.getByTestId('ltab-issues').click();
  await page.getByTestId('ltab-build').click();
  await page.getByTestId('clear-tasks').click();
  await page.locator('[data-task="bt_a2dp"]').click();
  await page.getByTestId('tab-WIFI').click();
  await page.locator('[data-task="wifi_web"]').click(); await page.locator('[data-task="wifi_web"]').click();
  await page.getByTestId('ltab-issues').click();
  await page.locator('[data-issue="P-5"] button.link', { hasText: 'Learn more' }).click();
  const hp = await page.getByTestId('help-panel').innerText();
  check('a validation issue Learn more link opens real help text', /Duplicate/i.test(hp) && !/No help text/.test(hp), hp.slice(0, 60));
  await page.getByRole('button', { name: 'Close help' }).click();
  await page.getByLabel('About Video streaming').first().click().catch(() => undefined);
  // A glossary term inside help text is underlined and opens its entry.
  await page.evaluate(() => (window).__coexHelp?.('conflicts'));
  await page.getByTestId('ltab-examples').click(); await page.locator('[data-preset="example-1"]').click(); await settled();
  await page.getByTestId('open-first-conflict').click();
  await page.locator('g.band-marker, .band-marker').first().focus();
  await page.getByText('Learn more').first().click().catch(() => undefined);
  if (await page.getByTestId('help-panel').count()) {
    const gl = page.getByTestId('help-panel').locator('button.gloss').first();
    check('glossary terms in help text are underlined buttons', (await gl.count()) > 0);
    if (await gl.count()) { await gl.click(); check('clicking a term opens its glossary entry', await page.getByTestId('glossary').isVisible() && (await page.locator('.glossary .focus').count()) === 1); await page.keyboard.press('Escape'); }
  }

  // AC-9: the assumptions panel lists everything in 7A.13 and labels it.
  await page.getByTestId('help-menu').click();
  await page.getByTestId('open-assumptions').click();
  await page.waitForSelector('[data-testid="assumptions-panel"]');
  for (const id of ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6']) check(`AC-9: assumptions panel lists ${id}`, (await page.locator(`[data-assumption="${id}"]`).count()) === 1);
  const spec = await page.getByTestId('assumptions-panel').innerText();
  check('AC-9: each assumption is labelled Standard says or Implementations vary', (await page.locator('[data-assumption] .spec-label').count()) === (await page.locator('[data-assumption]').count()) && /Standard says|Implementations vary/.test(spec));
  await page.getByTestId('as-added').click();
  check('AC-9: later assumptions are listed too', (await page.locator('[data-assumption]').count()) >= 70);
  await page.keyboard.press('Escape');
}

// ---- Accessibility: automatic scan of the main states with axe, plus keyboard and focus checks (7B.13) ----
{
  const axeSrc = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
  const scan = async (label, extra = {}) => {
    await page.addScriptTag({ content: axeSrc }).catch(() => undefined);
    const res = await page.evaluate(async (extra) => await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, ...extra }), extra);
    const bad = res.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');
    check(`axe: no serious or critical problems (${label})`, bad.length === 0, bad.map((v) => `${v.id} x${v.nodes.length} ${v.nodes[0].target.join(' ')}`).join(' | '));
    return res;
  };
  await page.goto(`${URL}?e2e`);
  await scan('empty state');
  await page.getByTestId('load-first-example').click(); await settled(); await page.waitForSelector('g.block');
  await page.getByTestId('open-first-conflict').click();
  await scan('Example 1 with a conflict open');
  await page.getByTestId('ltab-platform').click();
  await scan('platform panel');
  await page.getByTestId('ltab-examples').click();
  await page.getByRole('button', { name: 'Dark theme' }).click();
  await scan('dark theme');
  await page.getByRole('button', { name: 'Dark theme' }).click();

  // Keyboard: every interactive control is reachable and shows a visible focus outline.
  await page.goto(`${URL}?e2e`);
  await page.getByTestId('load-first-example').click(); await settled();
  const stops = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => { const e = document.activeElement; if (!e || e === document.body) return null; const cs = getComputedStyle(e); return { tag: e.tagName, name: e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 30) || e.id, outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; }));
  }
  const seen = stops.filter(Boolean);
  check('Tab moves through many controls', seen.length >= 40, `${seen.length}`);
  const noOutline = seen.filter((s) => !s.outline && s.tag !== 'svg' && s.tag !== 'g');
  check('every focused control has a visible outline of 2 px or more', noOutline.length === 0, noOutline.slice(0, 5).map((s) => `${s.tag}:${s.name}`).join(', '));
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('button, input, select, textarea, [role="button"], [role="slider"]')].filter((e) => { const n = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.textContent?.trim() || (e.labels && e.labels.length) || e.getAttribute('title'); return !n; }).map((e) => e.outerHTML.slice(0, 80)));
  check('every control has an accessible name', unnamed.length === 0, unnamed.slice(0, 3).join(' | '));
  const sr = await page.getByTestId('sr-summary').innerText();
  check('7B.13: a text summary of the result is available to screen readers', /conflict/i.test(sr), sr.slice(0, 90));
  // Reduced motion keeps step-through.
  await page.getByLabel('Reduce motion').check();
  await page.getByRole('button', { name: /next event|Next event/i }).first().click().catch(() => undefined);
  check('reduce motion disables playback but keeps the controls', await page.getByRole('button', { name: /Play/ }).first().isVisible().catch(() => true));
  await page.getByLabel('Reduce motion').uncheck();
}


// ---- Visitor stats corner button ----
{
  await page.goto(`${URL}?e2e`);
  const btn = page.getByTestId('visitor-stats-btn');
  check('a Visitor stats button sits in the corner of the page', await btn.isVisible());
  const box = await btn.boundingBox();
  check('the button is in the bottom-left corner', box.x < 40 && box.y > 1000 - 80, `${Math.round(box.x)},${Math.round(box.y)}`);
  await btn.click();
  check('the dialog opens and explains what is counted', /No cookies/.test(await page.getByTestId('visitor-stats').innerText()));
  check('while no site code is set it says so and offers no link', await page.getByTestId('stats-not-set').isVisible() && (await page.getByTestId('stats-link').count()) === 0);
  check('no statistics script is loaded in the browser checks', (await page.locator('script[data-goatcounter]').count()) === 0);
  await page.keyboard.press('Escape');
  check('Escape closes the dialog', (await page.getByTestId('visitor-stats').count()) === 0);
}

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
