// Screenshots of the PWA in a phone-sized headless Edge, plus any console/page errors.
// Usage: node scripts/ui-shots.mjs <outDir> [port] [theme]
import puppeteer from 'puppeteer-core';

const [out = '.', port = '9787', theme = 'dark'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const shot = async (name) => { await new Promise((r) => setTimeout(r, 900)); await page.screenshot({ path: `${out}/${theme}-${name}.png` }); };

await page.goto(base, { waitUntil: 'networkidle0' });
await shot('1-home');
await page.click('.agent-switch button:nth-child(2)');
await shot('2-home-codex');
await page.click('.session');
await new Promise((r) => setTimeout(r, 2500));
await shot('3-chat');
await page.click('.fab').catch(() => undefined);
await page.goto(base + '#/', { waitUntil: 'networkidle0' });
await page.click('.fab');
await shot('4-project-sheet');
await page.click('.sheet .row');
await shot('5-new');
await page.click('.composer .chip');
await shot('6-model-sheet');
await page.keyboard.press('Escape');
await page.click('.topbar .icon-btn:nth-of-type(1)').catch(() => undefined);
await page.goto(base + '#/', { waitUntil: 'networkidle0' });
await page.click('button[aria-label="Réglages"]');
await shot('7-settings');
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
await page.goto(base + '#/', { waitUntil: 'networkidle0' });
await page.click('.session');
await new Promise((r) => setTimeout(r, 2500));
await shot('8-wide');
console.log(errors.length ? errors.join('\n') : 'no console errors');
await browser.close();
