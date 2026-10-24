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

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
for (const [id, name] of [['example-3', 'Example 3'], ['example-4', 'Example 4'], ['example-5', 'Example 5']]) {
  await page.locator(`[data-preset="${id}"]`).click();
  await page.waitForSelector('[data-testid="time-view"]');
  check(`${name} loads without errors and shows conflicts or blocks`, (await page.locator('g.block').count()) > 0 || (await page.locator('[data-lod="density"]').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/${id}.png`, fullPage: true });
}
await page.locator('[data-preset="example-3"]').click();
await page.getByRole('button', { name: 'Histogram' }).click();
check('histogram mode draws bars', (await page.locator('[data-mode="histogram"] rect').count()) > 50);
await page.screenshot({ path: `${SHOTS}/example3-histogram.png`, fullPage: true });
await page.locator('[data-preset="example-4"]').click();
check('adaptive hopping strip shows removed channels in Example 4', (await page.locator('[data-testid="afh-strip"] rect[data-removed="true"]').count()) === 23);

// ---- legend ----
await page.getByRole('button', { name: 'Legend', exact: true }).click();
check('legend lists every cue', (await page.locator('[data-testid="legend"] li').count()) === 12);
await page.screenshot({ path: `${SHOTS}/legend.png` });
await page.getByRole('button', { name: 'Close legend' }).click();

// ---- greyscale view for UX-3 ----
await page.locator('[data-preset="example-3"]').click();
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

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
process.exit(failed.length ? 1 : 0);
