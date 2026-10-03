import { test, expect } from '@playwright/test';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { benchmarkDataset } from './dataset';

test('T19 production JSON near 150MiB, real JPEG restore and v8 export in an isolated origin', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(''); await expect(page.getByRole('heading', { name: /כל הספרים/, level: 1 })).toBeVisible();
  const image = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 320;
    const ctx = canvas.getContext('2d')!, pixels = ctx.createImageData(320, 320); let state = 1234567;
    for (let i = 0; i < pixels.data.length; i += 4) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      pixels.data[i] = state & 255; pixels.data[i + 1] = state >>> 8 & 255; pixels.data[i + 2] = state >>> 16 & 255; pixels.data[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0); let low = 0, high = 1, base64 = '';
    for (let i = 0; i < 12; i++) {
      const quality = (low + high) / 2, candidate = canvas.toDataURL('image/jpeg', quality).split(',')[1];
      if (atob(candidate).length <= 114500) { low = quality; base64 = candidate; } else high = quality;
    }
    const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0)), hash = await crypto.subtle.digest('SHA-256', bytes);
    return { base64, width: 320, height: 320, byteLength: bytes.length, sha256: [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('') };
  });
  const source = benchmarkDataset(1000, image), fileBytes = Buffer.byteLength(source);
  expect(fileBytes).toBeGreaterThan(140 * 1024 * 1024); expect(fileBytes).toBeLessThanOrEqual(150 * 1024 * 1024);
  await mkdir(test.info().outputDir, { recursive: true }); const path = test.info().outputPath('SYNTHETIC-LARGE-ONLY.json'); await writeFile(path, source);
  await page.getByRole('link', { name: 'הגדרות', exact: true }).click();
  const session = await page.context().newCDPSession(page), heapSamples: number[] = [];
  let sampling = true;
  const sampler = (async () => { while (sampling) { const heap = await session.send('Runtime.getHeapUsage'); heapSamples.push(heap.usedSize); await new Promise(resolve => setTimeout(resolve, 200)); } })();
  const validateStart = Date.now();
  try {
    await page.getByLabel('בחירת גיבוי לשחזור').setInputFiles(path);
    await expect(page.getByRole('heading', { name: /תצוגה מקדימה:/ })).toBeVisible({ timeout: 180000 });
    const validationMs = Date.now() - validateStart;
    let download = page.waitForEvent('download'); await page.getByRole('button', { name: 'הורדת גיבוי מגן לפני החלפה', exact: true }).click(); await download;
    await page.getByLabel('וידאתי שהגיבוי ירד למחשב ואני מאשר החלפה').check();
    const restoreStart = Date.now(); await page.getByRole('button', { name: 'החלפת הספרייה ושחזור', exact: true }).click();
    await expect(page.getByText('הספרייה שוחזרה בהצלחה.', { exact: true })).toBeVisible({ timeout: 180000 });
    const restoreMs = Date.now() - restoreStart;
    const exportStart = Date.now(); download = page.waitForEvent('download', { timeout: 180000 });
    await page.getByRole('button', { name: 'הורדת גיבוי הספרייה', exact: true }).click(); const output = await download;
    const exportedBytes = (await stat((await output.path())!)).size, exportMs = Date.now() - exportStart;
    expect(exportedBytes).toBeGreaterThan(140 * 1024 * 1024); expect(exportedBytes).toBeLessThanOrEqual(150 * 1024 * 1024);
    await page.reload(); await page.getByRole('link', { name: 'כל הספרים', exact: true }).click();
    await expect(page.locator('.book-list li:not([hidden])')).toHaveCount(1000);
    await expect.poll(() => page.evaluate(() => document.querySelector<HTMLImageElement>('.book-list img')?.naturalWidth ?? 0)).toBeGreaterThan(0);
    const report = { appVersion: '0.13.0', browser: await page.evaluate(() => navigator.userAgent), viewport: { width: 390, height: 844 }, fileBytes, exportedBytes, imageBytes: image.byteLength * 1000,
      validationMs, restoreMs, exportMs, heapSampleCount: heapSamples.length, largestObservedV8HeapBytes: Math.max(...heapSamples),
      memoryMethod: 'CDP Runtime.getHeapUsage sampled every 200ms; synchronous work can delay samples. Excludes Blob/native/process memory and is not a total peak-memory claim. Windows desktop Chrome; physical iPhone NOT RUN.', errors };
    await mkdir('private/phase15-benchmark', { recursive: true }); await writeFile('private/phase15-benchmark/large-json.json', JSON.stringify(report, null, 2));
    await test.info().attach('large-json', { body: JSON.stringify(report), contentType: 'application/json' }); console.log(JSON.stringify(report)); expect(errors).toEqual([]);
  } finally { sampling = false; await sampler; await session.detach(); }
});
