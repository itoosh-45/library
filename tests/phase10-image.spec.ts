import { test, expect } from '@playwright/test';

for (const encoder of ['native', 'html', 'hung']) test(`T06 crop/rotate/JPEG removes metadata without upload, encoder=${encoder}`, async ({ page }) => {
  if (encoder === 'html') await page.addInitScript(() => { Object.defineProperty(globalThis, 'OffscreenCanvas', { value: undefined, configurable: true }); });
  if (encoder === 'hung') await page.addInitScript(() => { OffscreenCanvas.prototype.convertToBlob = () => new Promise(() => {}); });
  const external: string[] = []; page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4330') && !request.url().startsWith('blob:')) external.push(request.url()); }); await page.goto('');
  const result = await page.evaluate(async () => {
    const path = '/library/src/data/visionImage.ts'; const { loadVisionImage, prepareVisionImage } = await import(/* @vite-ignore */ path);
    const canvas = document.createElement('canvas'); canvas.width = 4000; canvas.height = 2000; const context = canvas.getContext('2d')!; context.fillStyle = 'red'; context.fillRect(0, 0, 2000, 2000); context.fillStyle = 'blue'; context.fillRect(2000, 0, 2000, 2000);
    const original = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/jpeg', 0.95)), bytes = new Uint8Array(await original.arrayBuffer()), marker = new TextEncoder().encode('SYNTHETIC_PRIVATE_METADATA_SENTINEL');
    const comment = new Uint8Array([255, 254, 0, marker.length + 2, ...marker]);
    const file = new File([bytes.subarray(0, 2), comment, bytes.subarray(2)], 'synthetic-photo.jpg', { type: 'image/jpeg' }); const source = await loadVisionImage(file);
    try {
      const rotated = await prepareVisionImage(source, [0, 0, 1, 1], 90), cropped = await prepareVisionImage(source, [0.5, 0, 1, 1], 270);
      const url = URL.createObjectURL(cropped.blob), image = new Image(); image.src = url; await image.decode(); const sample = document.createElement('canvas'); sample.width = 1; sample.height = 1; const sampleContext = sample.getContext('2d')!; sampleContext.drawImage(image, 0, 0, 1, 1); const color = [...sampleContext.getImageData(0, 0, 1, 1).data]; URL.revokeObjectURL(url);
      return { rotated: [rotated.width, rotated.height], cropped: [cropped.width, cropped.height], color, mime: rotated.blob.type, size: rotated.blob.size, keptMetadata: new TextDecoder().decode(await rotated.blob.arrayBuffer()).includes('SYNTHETIC_PRIVATE_METADATA_SENTINEL') };
    } finally { source.dispose(); }
  });
  expect(result.rotated).toEqual([1024, 2048]); expect(result.cropped).toEqual([2000, 2000]); expect(result.color[0]).toBeLessThan(10); expect(result.color[2]).toBeGreaterThan(240); expect(result.mime).toBe('image/jpeg'); expect(result.size).toBeLessThanOrEqual(1.5 * 1024 * 1024); expect(result.keptMetadata).toBe(false); expect(external).toEqual([]);
});
