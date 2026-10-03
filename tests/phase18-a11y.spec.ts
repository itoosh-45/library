import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test('T25 batched desktop/mobile contrast, labels, RTL, keyboard and 200-percent text audit', async ({ page }) => {
  const reports: unknown[] = [];
  for (const [width, height, section] of [[1280, 900, 'settings'], [360, 800, 'books']] as const) {
    await page.setViewportSize({ width, height }); await page.goto('./?audit=' + width + '#' + section);
    await expect(page.getByRole('heading', { name: section === 'settings' ? /^הגדרות$/ : /^כל הספרים/, level: 1 })).toBeVisible();
    if (section === 'settings') await expect(page.getByLabel('מפתח Gemini אישי', { exact: true })).toBeVisible();
    await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'דילוג לתוכן' })).toBeFocused();
    await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
    if (section === 'books') {
      await page.getByRole('button', { name: 'הוספת ספר', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.locator('summary').filter({ hasText: 'פרטים נוספים' }).click();
    }
    const report = await page.evaluate(() => {
      const visible = (element: HTMLElement) => !!element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[hidden],[inert]');
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0,3).map(Number);
      const luminance = (color: number[]) => color.map(value => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [0.2126,0.7152,0.0722][index], 0);
      const failures: { text: string; ratio: number; foreground: string; background: string }[] = [];
      const elements = [...document.querySelectorAll<HTMLElement>('body *')].filter(visible);
      for (const element of elements) {
        if (!element.childNodes.length || ![...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) || element.closest(':disabled,[disabled],[aria-hidden="true"]')) continue;
        const style = getComputedStyle(element); if (!style.color.startsWith('rgb')) continue;
        let parent: HTMLElement | null = element, background = 'rgb(247, 249, 249)';
        while (parent) { const color = getComputedStyle(parent).backgroundColor; if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') { background = color; break; } parent = parent.parentElement; }
        const foregroundLight = luminance(rgb(style.color)), backgroundLight = luminance(rgb(background));
        const ratio = (Math.max(foregroundLight, backgroundLight) + 0.05) / (Math.min(foregroundLight, backgroundLight) + 0.05);
        const font = parseFloat(style.fontSize), large = font >= 24 || (font >= 18.66 && parseFloat(style.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) failures.push({ text: element.textContent!.trim().slice(0,70), ratio, foreground: style.color, background });
      }
      const unlabelled = elements.filter(element => element.matches('input:not([type="hidden"]),select,textarea') && !(element as HTMLInputElement).labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).map(element => element.tagName);
      // Inject computed text sizes once. This tests layout at 200%; it does not claim physical Safari zoom behavior.
      const sizes = elements.map(element => [element, parseFloat(getComputedStyle(element).fontSize)] as const);
      for (const [element, size] of sizes) element.style.fontSize = size * 2 + 'px';
      return { direction: getComputedStyle(document.documentElement).direction, contrastFailures: failures, unlabelled, textScale: 'injected computed font size x2' };
    });
    const overflow = await page.evaluate(() => {
      for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialog.scrollTop = 0;
      return { width: innerWidth, document: document.documentElement.scrollWidth, components: [...document.querySelectorAll<HTMLElement>('.brand,.page-heading,.sheet-heading,dialog[open]')].filter(element => element.getClientRects().length).map(element => ({ target: element.className, outer: element.clientWidth, content: element.scrollWidth })) };
    });
    expect(report.direction).toBe('rtl'); expect(report.contrastFailures).toEqual([]); expect(report.unlabelled).toEqual([]);
    expect(overflow.document).toBeLessThanOrEqual(overflow.width);
    for (const component of overflow.components) expect(component.content, component.target).toBeLessThanOrEqual(component.outer + 1);
    reports.push({ width, section, ...report, overflow });
    await page.screenshot({ path: `test-results/browser-artifacts/phase18-${width}-200text.png`, fullPage: true });
    if (section === 'books') { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'הוספת ספר', exact: true })).toBeFocused(); }
  }
  await mkdir('private/phase18', { recursive: true }); await writeFile('private/phase18/a11y-observations.json', JSON.stringify(reports, null, 2));
});
