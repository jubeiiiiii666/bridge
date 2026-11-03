// Drives real flows through the UI: an approval tapped on screen, then a hands-free voice turn
// (speech recognition / synthesis are stubbed since headless Edge has no microphone).
// Usage: node scripts/ui-flow.mjs <outDir> <cwd> [port]
import puppeteer from 'puppeteer-core';

const [out = '.', cwd = process.cwd(), port = '9787'] = process.argv.slice(2);
const base = `http://127.0.0.1:${port}/`;
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.evaluateOnNewDocument(() => {
  const said = ['Réponds seulement : vocal OK', 'stop'];
  window.__spoken = [];
  window.SpeechRecognition = window.webkitSpeechRecognition = class {
    start() {
      const text = said.shift() ?? '';
      setTimeout(() => {
        if (text) this.onresult?.({ results: [Object.assign([{ transcript: text }], { isFinal: true })] });
        this.onend?.();
      }, 400);
    }
    stop() {}
  };
  const synth = { speak: (u) => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 150); }, cancel() {}, getVoices: () => [] };
  Object.defineProperty(window, 'speechSynthesis', { value: synth });
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (path, body) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

// 1. approval tapped in the UI
const { sessionId } = await post('/api/send', { agent: 'claude', cwd, mode: 'default', text: 'Crée le fichier ui-test.txt contenant le mot ok, puis réponds juste : Fini.' });
await page.goto(`${base}#/claude/${sessionId}`, { waitUntil: 'networkidle0' });
await page.waitForSelector('.request', { timeout: 120000 });
await wait(600);
await page.screenshot({ path: `${out}/flow-1-request.png` });
await page.click('.request .btn.primary');
await page.waitForFunction(() => !document.querySelector('.request') && !document.querySelector('.working'), { timeout: 120000 });
await wait(800);
await page.screenshot({ path: `${out}/flow-2-after.png` });

// 2. voice mode: listen -> send -> read answer -> listen ("stop") -> exit
await page.evaluate(() => [...document.querySelectorAll('.composer .chip')].find((b) => b.textContent.includes('Mode vocal')).click());
await wait(1500);
await page.screenshot({ path: `${out}/flow-3-voice.png` });
await page.waitForFunction(() => !document.querySelector('.voice'), { timeout: 120000 });
console.log('spoken:', await page.evaluate(() => window.__spoken));
await page.screenshot({ path: `${out}/flow-4-voice-done.png` });
console.log(errors.length ? errors.join('\n') : 'no page errors');
await browser.close();
