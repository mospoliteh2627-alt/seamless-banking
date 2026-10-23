import { webkit } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');
const base = process.env.BASE_URL || 'http://127.0.0.1:8787';
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screens');

const browser = await webkit.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  locale: 'ru-RU',
});
const page = await context.newPage();
const problems = [];
page.on('pageerror', (error) => problems.push(error.message));

async function audit(target, label) {
  await target.addScriptTag({ path: axePath });
  const result = await target.evaluate(async () => {
    return window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    });
  });
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
  }));
  console.log(`\n[${label}] violations: ${violations.length}`);
  for (const violation of violations) {
    console.log(`- ${violation.id} (${violation.impact}): ${violation.help} × ${violation.nodes}`);
    for (const targetPath of violation.targets) console.log(`    ${targetPath}`);
  }
  return violations;
}

const all = [];

await page.goto(base, { waitUntil: 'networkidle' });
await page.click('#login-submit');
await page.waitForSelector('#screen-dashboard:not(.hidden)');
all.push(...(await audit(page, 'dashboard')));

await page.click('#btn-a11y');
await page.waitForSelector('#a11y-modal:not(.hidden)');
await page.screenshot({ path: path.join(shots, '08-a11y-settings.png') });
all.push(...(await audit(page, 'a11y-modal')));

await page.click('[data-font="1.15"]');
await page.locator('label:has(#a11y-contrast)').click();
const classes = await page.evaluate(() => document.documentElement.className);
if (!classes.includes('a11y-font-lg') || !classes.includes('a11y-contrast')) {
  problems.push(`a11y classes not applied: ${classes}`);
}
await page.keyboard.press('Escape');

await page.click('#btn-new-transfer');
await page.waitForSelector('#screen-transfer:not(.hidden)');
await page.fill('#f-recipientName', 'Иван Петров');
await page.fill('#f-recipientBank', 'Вектор Банк');
await page.fill('#f-recipientAccount', '40817810000000001234');
await page.click('[data-panel="1"] [data-next="2"]');
await page.fill('#f-amount', '12500,50');
await page.fill('#f-purpose', 'Перевод личных средств');
await page.waitForTimeout(700);
all.push(...(await audit(page, 'transfer')));

await page.click('#btn-handoff');
await page.waitForSelector('#handoff-modal:not(.hidden)');
all.push(...(await audit(page, 'handoff-modal')));

const deeplink = await page.evaluate(() => localStorage.getItem('sb.lastHandoff'));

const mobile = await context.newPage();
await mobile.setViewportSize({ width: 430, height: 932 });
await mobile.goto(`${base}/m`, { waitUntil: 'networkidle' });
await mobile.click('#m-login-btn');
await mobile.waitForSelector('#m-home:not(.hidden)');
await mobile.fill('#m-ticket', deeplink);
await mobile.click('#m-preview-btn');
await mobile.waitForSelector('#m-confirm:not(.hidden)');
await mobile.click('#m-faceid-btn');
await mobile.waitForSelector('#m-draft:not(.hidden)');
await mobile.waitForTimeout(500);

const mobileState = await mobile.evaluate(() => ({
  classes: document.body.className,
  restored: document.querySelector('#m-restored-text')?.textContent || '',
}));
if (!mobileState.classes.includes('a11y-font-lg') || !mobileState.classes.includes('a11y-contrast')) {
  problems.push(`mobile a11y profile not applied: ${JSON.stringify(mobileState)}`);
}
if (!mobileState.restored.includes('доступность')) {
  problems.push(`mobile restored label misses a11y: ${mobileState.restored}`);
}
await mobile.screenshot({ path: path.join(shots, '09-mobile-a11y.png') });
all.push(...(await audit(mobile, 'mobile-draft')));

const serious = all.filter((violation) => ['serious', 'critical'].includes(violation.impact));
console.log('\nSUMMARY', JSON.stringify({ total: all.length, serious: serious.length, problems }, null, 2));

await browser.close();
if (problems.length || serious.length) process.exitCode = 1;
