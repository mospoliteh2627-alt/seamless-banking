import { webkit } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(here, '../docs/screens');
const base = process.env.BASE_URL || 'http://127.0.0.1:8787';

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
});

const problems = [];
const page = await context.newPage();
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

await page.goto(base, { waitUntil: 'networkidle' });
await page.click('#login-submit');
await page.waitForSelector('#screen-dashboard:not(.hidden)');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(shots, '01-dashboard.png') });

await page.click('#btn-new-transfer');
await page.waitForSelector('#screen-transfer:not(.hidden)');
await page.fill('#f-recipientName', 'Иван Петров');
await page.fill('#f-recipientBank', 'Вектор Банк');
await page.fill('#f-recipientAccount', '40817 810 0 0000 0001234');
await page.click('[data-panel="1"] [data-next="2"]');
await page.waitForTimeout(700);
await page.fill('#f-amount', '12500,50');
await page.fill('#f-purpose', 'Перевод личных средств');
await page.evaluate(() => { const el = document.querySelector('#f-saveRecipient'); el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
await page.focus('#f-amount');
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(shots, '02-transfer.png') });

await page.click('#btn-handoff');
await page.waitForSelector('#handoff-modal:not(.hidden)');
await page.waitForTimeout(450);
await page.screenshot({ path: path.join(shots, '03-handoff-qr.png') });
const phases = await page.$$eval('#handoff-timeline li', (items) => items.length);
if (phases !== 4) throw new Error(`expected 4 handoff phases, got ${phases}`);
const activePhase = await page.$eval('#handoff-timeline li.is-active', (item) => item.dataset.phase);
if (activePhase !== 'scanned') throw new Error(`unexpected active phase: ${activePhase}`);
const deeplink = await page.evaluate(() => localStorage.getItem('sb.lastHandoff'));
if (!deeplink) throw new Error('deeplink not stored');

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 430, height: 932 });
mobile.on('pageerror', (error) => problems.push(`mobile pageerror: ${error.message}`));
mobile.on('console', (message) => {
  if (message.type() === 'error') problems.push(`mobile console: ${message.text()}`);
});
await mobile.goto(`${base}/m`, { waitUntil: 'networkidle' });
await mobile.click('#m-login-btn');
await mobile.waitForSelector('#m-home:not(.hidden)');
await mobile.fill('#m-ticket', deeplink);
await mobile.click('#m-preview-btn');
await mobile.waitForSelector('#m-confirm:not(.hidden)');
await mobile.waitForTimeout(350);
await mobile.screenshot({ path: path.join(shots, '04-mobile-confirm.png') });

await mobile.click('#m-faceid-btn');
await mobile.waitForSelector('#m-draft:not(.hidden)');
await mobile.waitForTimeout(500);
await mobile.screenshot({ path: path.join(shots, '05-mobile-draft.png') });

await mobile.fill('#mf-purpose', 'Перевод личных средств (моб.)');
await mobile.waitForTimeout(900);

const restored = await mobile.textContent('#m-restored-text');
const recipient = await mobile.inputValue('#mf-recipientName');
const amount = await mobile.inputValue('#mf-amount');
if (!restored.includes('Шаг 2')) throw new Error(`unexpected restore label: ${restored}`);
if (recipient !== 'Иван Петров') throw new Error(`recipient not restored: ${recipient}`);
if (amount !== '12500,50') throw new Error(`amount not restored: ${amount}`);

await page.waitForSelector('#handoff-banner:not(.hidden)', { timeout: 5000 });
await page.waitForTimeout(350);
await page.screenshot({ path: path.join(shots, '06-web-after-handoff.png') });

await mobile.click('#m-submit-btn');
await mobile.waitForSelector('#m-success:not(.hidden)');
await mobile.waitForTimeout(350);
await mobile.screenshot({ path: path.join(shots, '07-mobile-success.png') });

await page.waitForSelector('#screen-success:not(.hidden)', { timeout: 5000 });
await page.click('#btn-success-new');
await page.waitForSelector('#screen-transfer:not(.hidden)');
await page.waitForSelector('#recipient-chips .recipient-chip', { timeout: 5000 });
const chipCount = await page.$$eval('#recipient-chips .recipient-chip', (items) => items.length);
if (chipCount < 1) throw new Error('saved recipient chip not rendered');
await page.click('#recipient-chips .recipient-chip');
const pickedName = await page.inputValue('#f-recipientName');
if (pickedName !== 'Иван Петров') throw new Error(`recipient pick failed: ${pickedName}`);

if (problems.length) {
  console.error('BROWSER PROBLEMS:\n' + problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log('UI flow OK');
  console.log('restored:', restored.trim());
  console.log('screens:', shots);
}

await browser.close();
