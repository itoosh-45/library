import { test, expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { benchmarkDataset } from './dataset';

const percentile95 = (samples: number[]) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * .95) - 1];
const runLabel = process.env.PERFORMANCE_RUN_LABEL ?? 'current';
if (!/^[a-z0-9-]+$/.test(runLabel)) throw new Error('PERFORMANCE_RUN_LABEL must contain lowercase letters, digits or hyphens');
async function searchPaint(page: Page, query: string, count: number) {
  await page.evaluate(({ query, count }) => {
    const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
    const target = window as Window & { benchmarkSearch?: Promise<number> };
    target.benchmarkSearch = new Promise(resolve => {
      input.addEventListener('input', () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          if (input.value !== query || document.querySelectorAll('.book-list li:not([hidden])').length !== count) return;
          observer.disconnect();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
        });
        observer.observe(document.getElementById('main-content')!, { subtree: true, childList: true, characterData: true });
      }, { once: true, capture: true });
    });
  }, { query, count });
  const start = Date.now();
  await page.locator('input[type=search]').fill(query);
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(count);
  const browserMs = await page.evaluate(() => (window as Window & { benchmarkSearch?: Promise<number> }).benchmarkSearch!);
  return { browserMs, automationMs: Date.now() - start };
}
async function beginActionTiming(page: Page, outcome: { selector: string; count: number; text?: string; dialogCount?: number }) {
  await page.evaluate(outcome => {
    (window as Window & { benchmarkAction?: Promise<number> }).benchmarkAction = new Promise(resolve => {
      document.addEventListener('click', () => {
        const start = performance.now();
        const observer = new MutationObserver(() => {
          const elements = document.querySelectorAll(outcome.selector);
          if (elements.length !== outcome.count || (outcome.text !== undefined && elements[0]?.textContent !== outcome.text)) return;
          if (outcome.dialogCount !== undefined && document.querySelectorAll('dialog,[role="dialog"]').length !== outcome.dialogCount) return;
          observer.disconnect(); requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - start)));
        });
        observer.observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true });
      }, { once: true, capture: true });
    });
  }, outcome);
}
const actionPaint = (page: Page) => page.evaluate(() => (window as Window & { benchmarkAction?: Promise<number> }).benchmarkAction!);
for (const count of [1000, 5000] as const) test(`production baseline ${count}, synthetic images/copies/history, isolated origin`, async ({ page, browser }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL), active = new Set<string>();
    const stats = { active: 0, created: 0, revoked: 0 };
    (window as Window & { benchmarkBlobUrls?: typeof stats }).benchmarkBlobUrls = stats;
    URL.createObjectURL = blob => { const url = create(blob); active.add(url); stats.active = active.size; stats.created++; return url; };
    URL.revokeObjectURL = url => { if (active.delete(url)) stats.revoked++; stats.active = active.size; revoke(url); };
  });
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/, level: 1 })).toBeVisible();
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 320;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(240, 320); let state = 1234567;
    for (let i = 0; i < pixels.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = state & 255; pixels.data[i + 1] = state >>> 8 & 255; pixels.data[i + 2] = state >>> 16 & 255; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); const base64 = canvas.toDataURL('image/jpeg', .1).split(',')[1];
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return { base64, width: 240, height: 320, byteLength: bytes.length, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  const source = benchmarkDataset(count, image);
  expect(Buffer.byteLength(source)).toBeLessThan(100 * 1024 * 1024);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const fixturePath = test.info().outputPath(`SYNTHETIC-${count}.json`);
  await mkdir(test.info().outputDir, { recursive: true });
  await writeFile(fixturePath, source);
  await page.getByLabel('בחירת גיבוי לשחזור', { exact: true }).setInputFiles(fixturePath);
  await expect(page.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible({ timeout: 120000 });
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await downloading;
  await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה', { exact: true }).check();
  await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
  await expect(page.getByText('הספרייה שוחזרה בהצלחה.', { exact: true })).toBeVisible({ timeout: 120000 });
  await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
  await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(count);
  const warmOpen: number[] = [];
  for (let i = 0; i < 5; i++) { const start = Date.now(); await page.reload(); await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(count); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); warmOpen.push(Date.now() - start); }
  await expect.poll(() => page.locator('.book-list img').count()).toBeGreaterThan(0);
  const initialThumbnails = await page.locator('.book-list img').count();
  expect(initialThumbnails).toBeLessThan(100);
  const lastBookId = await page.evaluate(() => [...document.querySelectorAll('.book-list li:not([hidden])')].at(-1)!.getAttribute('data-book-id')!);
  const lastRow = page.locator(`[data-book-id="${lastBookId}"]`);
  await lastRow.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(id => {
    const image = document.querySelector<HTMLImageElement>(`[data-book-id="${id}"] img`);
    return !!image?.complete && image.naturalWidth > 0;
  }, lastBookId)).toBe(true);
  await expect(lastRow.locator('img')).toBeVisible();
  await expect.poll(() => page.locator('.book-list img').count()).toBeLessThan(100);
  const endThumbnails = await page.locator('.book-list img').count();
  const scrollBlobUrls = await page.evaluate(() => (window as Window & { benchmarkBlobUrls?: { active: number; created: number; revoked: number } }).benchmarkBlobUrls!);
  expect(scrollBlobUrls.active).toBeLessThan(100); expect(scrollBlobUrls.revoked).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const searches: number[] = [], broadSearches: number[] = [], searchPaints: number[] = [], broadSearchPaints: number[] = [];
  const profileSession = process.env.PERFORMANCE_CPU_PROFILE === '1' ? await page.context().newCDPSession(page) : undefined;
  if (profileSession) await profileSession.send('Profiler.enable');
  for (let i = 0; i < 30; i++) {
    const narrow = await searchPaint(page, String(200 + i * 17).padStart(5, '0'), 1);
    searches.push(narrow.automationMs); searchPaints.push(narrow.browserMs);
    if (profileSession && i === 9) await profileSession.send('Profiler.start');
    const broad = await searchPaint(page, 'סינתטי', count);
    if (profileSession && i === 9) {
      const { profile } = await profileSession.send('Profiler.stop');
      await writeFile(test.info().outputPath('broad-search-cpu-profile.json'), JSON.stringify(profile));
      console.log(JSON.stringify(profile.nodes.filter(node => node.hitCount).sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0)).slice(0, 20).map(node => ({ name: node.callFrame.functionName, url: node.callFrame.url, hits: node.hitCount }))));
    }
    broadSearches.push(broad.automationMs); broadSearchPaints.push(broad.browserMs);
    if (i % 10 === 9) console.log(JSON.stringify({ count, completedSearchPairs: i + 1, latestNarrow: narrow, latestBroad: broad }));
  }
  const edits: number[] = [], lends: number[] = [], returns: number[] = [];
  const bookSelector = '[data-book-id="00000001-0000-4000-8000-00000000012c"]';
  const editor = page.locator('dialog');
  for (let i = 0; i < 30; i++) {
    await page.locator(bookSelector).getByRole('button').click();
    const title = `ב ספר סינתטי 00300 עדכון ${i}`;
    await editor.getByLabel('שם הספר', { exact: true }).fill(title);
    await beginActionTiming(page, { selector: `${bookSelector} h2`, count: 1, text: title, dialogCount: 0 });
    await editor.getByRole('button', { name: 'שמירת הספר', exact: true }).click();
    await expect(page.locator('dialog')).toHaveCount(0); await expect(page.locator(`${bookSelector} h2`)).toHaveText(title);
    edits.push(await actionPaint(page));
    if (i % 10 === 9) console.log(JSON.stringify({ count, completedEdits: i + 1, latestPaint: edits.at(-1) }));
  }
  await page.locator(bookSelector).getByRole('button').click();
  await editor.getByText('השאלת עותק', { exact: true }).click();
  await editor.getByRole('combobox', { name: 'למי להשאיל', exact: true }).selectOption({ label: 'קורא סינתטי 0' });
  for (let i = 0; i < 30; i++) {
    await editor.getByRole('combobox', { name: 'עותק להשאלה', exact: true }).selectOption({ label: 'עותק סינתטי 300' });
    await beginActionTiming(page, { selector: '.book-loans .loan-entry button', count: 1 });
    await page.locator('.book-loans button[type=submit]').click();
    await expect(page.locator('.book-loans .loan-entry button')).toHaveCount(1); lends.push(await actionPaint(page));
    await beginActionTiming(page, { selector: '.book-loans .loan-entry button', count: 0 });
    await page.locator('.book-loans .loan-entry button').click();
    await expect(page.locator('.book-loans .loan-entry button')).toHaveCount(0); returns.push(await actionPaint(page));
    if (i % 10 === 9) console.log(JSON.stringify({ count, completedLoanPairs: i + 1, lendPaint: lends.at(-1), returnPaint: returns.at(-1) }));
  }
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  const storage = await page.evaluate(async () => ({ estimate: await navigator.storage.estimate(), userAgent: navigator.userAgent, dpr: devicePixelRatio, rows: document.querySelectorAll('.book-list li:not([hidden])').length, scripts: [...document.scripts].map(script => script.src).filter(Boolean) }));
  const coldAssets: number[] = []; let previousPage = page;
  for (let i = 0; i < 5; i++) {
    await previousPage.evaluate(async () => {
      await Promise.all((await navigator.serviceWorker.getRegistrations()).map(registration => registration.unregister()));
      await Promise.all((await caches.keys()).map(name => caches.delete(name)));
    });
    const cacheSession = await previousPage.context().newCDPSession(previousPage);
    await cacheSession.send('Network.clearBrowserCache'); await cacheSession.detach();
    await previousPage.close();
    const coldPage = await page.context().newPage(); coldPage.on('pageerror', error => errors.push(error.message));
    const start = Date.now(); await coldPage.goto('');
    await expect(coldPage.locator('.book-list li:not([hidden])')).toHaveCount(count);
    await coldPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    coldAssets.push(Date.now() - start); previousPage = coldPage;
  }
  const report = { count, runLabel, measuredAt: new Date().toISOString(), profiling: !!profileSession, browser: browser.version(), viewport: { width: 390, height: 844 }, device: 'Windows desktop Chrome, mobile viewport; not iPhone',
    fixtureBytes: Buffer.byteLength(source), imageBytes: image.byteLength * count, historyCount: count === 5000 ? 10000 : 2000, openLoans: 50,
    coldOpen: 'NOT RUN for browser/process/OS restart or iPhone; coldAssets measures new page after deleting test-origin PWA caches/unregistering workers and clearing browser HTTP cache, within same browser process and IndexedDB profile',
    coldAssets, coldAssetsP95: percentile95(coldAssets), warmOpen, searches, broadSearches,
    warmOpenP95: percentile95(warmOpen), searchP95: percentile95(searches), broadSearchP95: percentile95(broadSearches),
    searchPaints, broadSearchPaints, searchPaintP95: percentile95(searchPaints), broadSearchPaintP95: percentile95(broadSearchPaints),
    edits, lends, returns, editPaintP95: percentile95(edits), lendPaintP95: percentile95(lends), returnPaintP95: percentile95(returns),
    thumbnails: { initial: initialThumbnails, afterScrollToEnd: endThumbnails, blobUrlsAfterScroll: scrollBlobUrls },
    timing: 'automation uses CSS input[type=search] and includes fill/actionability/count polling; browser paint measures captured input event through result DOM mutation and two animation frames; edits/loans measure captured click through committed visible outcome and two frames', storage, errors };
  await mkdir('private/phase14-benchmark', { recursive: true });
  await writeFile(`private/phase14-benchmark/${runLabel}-${count}.json`, JSON.stringify(report, null, 2));
  await test.info().attach(`baseline-${count}`, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  console.log(JSON.stringify({ count, warmOpenP95: report.warmOpenP95, searchP95: report.searchP95, broadSearchP95: report.broadSearchP95, imageBytes: report.imageBytes }));
  expect(errors).toEqual([]);
  if (count === 1000 && !profileSession) {
    expect(report.warmOpenP95).toBeLessThanOrEqual(2000);
    expect(report.searchPaintP95).toBeLessThanOrEqual(300);
    expect(report.broadSearchPaintP95).toBeLessThanOrEqual(300);
    for (const value of [report.editPaintP95, report.lendPaintP95, report.returnPaintP95]) expect(value).toBeLessThanOrEqual(500);
  }
});
