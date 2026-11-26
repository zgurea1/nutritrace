// Invoked by the isolated import test. All account/recipe data belongs to its temp DB.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, symlink, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
export async function checkMealTimeBrowser({ token, recipeId, archive, db, realRecipeId }) {
  assert.ok(process.env.DB_PATH.includes('nutritrace-mealtime-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const linkedDist = !existsSync('server/dist');
  if (linkedDist) await symlink('../dist', 'server/dist', 'dir');
  const child = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT: String(port), LOG_LEVEL: 'error' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', b => stderr += b);
  let browser;
  const origin = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (await fetch(origin + '/api/auth/status').then(r => r.ok).catch(() => false)) { ready = true; break; }
      await delay(100);
    }
    assert.ok(ready, 'Temporary app server did not start: ' + stderr);
    if (process.env.MEALTIME_OFF_LIVE === '1') {
      const target = 'https://world.openfoodfacts.org/api/v3/product/6111035000058?fields=code,product_name,nutriments';
      const response = await fetch(origin + '/api/proxy?url=' + encodeURIComponent(target));
      assert.equal(response.status, 200);
      const product = await response.json();
      assert.equal(product.code, '6111035000058'); assert.ok(product.product?.product_name);
      console.log('PASS real NutriTrace proxy → Open Food Facts: barcode 6111035000058. No user food or diary written.');
    }
    const { chromium } = await import(process.env.MEALTIME_PLAYWRIGHT_MODULE || 'playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.MEALTIME_CHROME_BIN ? { executablePath: process.env.MEALTIME_CHROME_BIN } : {}) });
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    await context.addCookies([{ name: 'nt_token', value: token, url: origin, sameSite: 'Lax' }]);
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/#/foods');
    await page.evaluate(id => { location.hash = '/meal-editor/' + id; }, recipeId);
    await page.getByRole('textbox', { name: 'Ingredients — one per line' }).waitFor();
    const input = page.getByLabel('Total cooked weight (g), when measured');
    assert.equal(await input.inputValue(), '');
    await page.getByText('Cooked weight is unknown.', { exact: false }).waitFor();
    const image = page.locator('img.photo-preview-img');
    await image.waitFor(); assert.ok(await image.evaluate(i => i.complete && i.naturalWidth > 0));
    const servings = page.locator('input[type="number"][min="1"]').first();
    await servings.fill('2');
    await page.getByRole('textbox', { name: 'Ingredients — one per line' }).fill('100 g cheese\nOne egg');
    await page.getByRole('textbox', { name: 'Preparation — separate steps with a blank line' }).fill('Mix.\n\nBake.');
    // Set csrf from the authenticated endpoint, just as normal login does.
    const me = await context.request.get(origin + '/api/auth/me');
    const account = await me.json();
    await page.evaluate(account => { if (account.csrf) localStorage.setItem('nt:csrf', account.csrf); }, account);
    const response = page.waitForResponse(r => r.url().endsWith('/api/meals/' + recipeId) && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal((await response).status(), 200);
    await page.waitForURL('**/#/foods');
    let row = db.prepare('SELECT * FROM meals WHERE id=?').get(recipeId);
    assert.equal(JSON.parse(row.nutrition).calories, 189); assert.equal(row.unit, 'serving');
    await page.evaluate(id => { location.hash = '/meal-editor/' + id; }, recipeId);
    await page.getByRole('textbox', { name: 'Ingredients — one per line' }).waitFor();
    assert.equal(await page.getByRole('textbox', { name: 'Ingredients — one per line' }).inputValue(), '100 g cheese\nOne egg');
    const again = page.waitForResponse(r => r.url().endsWith('/api/meals/' + recipeId) && r.request().method() === 'PUT');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    assert.equal((await again).status(), 200);
    await page.waitForURL('**/#/foods');
    row = db.prepare('SELECT * FROM meals WHERE id=?').get(recipeId);
    assert.equal(JSON.parse(row.nutrition).calories, 189);
    await page.evaluate(() => { location.hash = '/settings/importExport'; });
    await page.getByRole('heading', { name: 'Import MealTime notebook' }).waitFor();
    await page.locator('input[type=file][accept=".zip,application/zip"]').setInputFiles(archive);
    await page.getByRole('button', { name: 'Check archive' }).click();
    await page.getByText('110 recipes: 0 new, 110 already imported, 0 conflicts.', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Import recipes and photos', exact: true }).isDisabled(), true);
    await mkdir('.local/qa', { recursive: true }); await delay(400); await page.getByRole('heading', { name: 'Import MealTime notebook' }).scrollIntoViewIfNeeded(); await page.screenshot({ path: '.local/qa/mealtime-import-390.png', fullPage: true });
    await page.evaluate(id => { location.hash = '/meal-editor/' + id; }, realRecipeId);
    await page.getByRole('textbox', { name: 'Ingredients — one per line' }).waitFor();
    await delay(400);
    await page.locator('img.photo-preview-img').evaluate(i => i.decode());
    await page.screenshot({ path: '.local/qa/mealtime-recipe-390.png', fullPage: true });
    await page.getByRole('textbox', { name: 'Ingredients — one per line' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: '.local/qa/mealtime-ingredients-390.png', fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS Chromium 390px: private photo, full ingredients/preparation, no invented grams, repeat saves preserve declared nutrition, import preview, no duplicate import.');
  } finally {
    await browser?.close();
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; }
    if (linkedDist) await unlink('server/dist');
  }
}
