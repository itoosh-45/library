import { afterEach, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { LibraryDatabase, initializeLibrary } from './database';
import { createSnapshot, readCore, restoreSnapshot } from './backup';
import { emptyInput, saveBook, changeCopy } from './books';
import { saveNamedItem, saveShelf } from './collections';
import { lendCopy, returnCopy, localDay } from './loans';
import { fullWorkbook, exportWorkbook, readWorkbook, writeWorkbook, fullWorkbookCandidate, simpleWorkbook } from './xlsxWorkbook';
import { simpleWorkbookCandidate } from './xlsxSimple';
import { suggestedMapping } from './xlsxSchema';
import { mergeSnapshot, previewMerge } from './backupMerge';
import { guardXlsxZip, XLSX_LIMITS } from './xlsxZip';
import { hashBytes } from './images';
import { deflateRawSync } from 'node:zlib';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const databases: LibraryDatabase[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const db of databases.splice(0)) await db.delete(); });
async function library() { const db = new LibraryDatabase('phase16-' + crypto.randomUUID()); databases.push(db); await initializeLibrary(db); return db; }
async function richLibrary() {
  const db = await library(), shelf = await saveShelf(db, { name: 'מדף מלא', parentId: null }), child = await saveShelf(db, { name: 'ילד', parentId: shelf.id });
  const genre = await saveNamedItem(db, 'genres', 'סיפורת'), tag = await saveNamedItem(db, 'tags', 'עברית'), series = await saveNamedItem(db, 'series', 'סדרה');
  let book = await saveBook(db, { ...emptyInput, title: "ספר א׳", authors: ["מחבר א'", 'מחברת ב'], isbn: '0306406152', danacode: '0000123', shelfIds: [shelf.id, child.id], genreIds: [genre.id], tagIds: [tag.id], seriesId: series.id, seriesNumber: '2', personalNotes: '=SUM(A1:A3)' });
  await changeCopy(db, book.id, book.revision, { price: '0', notes: '+טקסט', label: 'ראשון' }); book = (await db.books.get(book.id))!;
  await changeCopy(db, book.id, book.revision, { label: 'עותק נוסף' });
  const copy = (await db.copies.toArray())[0];
  await lendCopy(db, { copyId: copy.id, newPersonName: 'שואל סינתטי', borrowedOn: localDay(), expectedReturnOn: '' });
  await returnCopy(db, (await db.loans.toArray())[0].id, localDay());
  await lendCopy(db, { copyId: copy.id, personId: (await db.people.toArray())[0].id, borrowedOn: localDay(), expectedReturnOn: '' });
  await db.metadataSources.add({ id: crypto.randomUUID(), bookId: book.id, provider: 'openlibrary', recordId: '/books/OL1M', sourceUrl: 'https://openlibrary.org/books/OL1M', fetchedAt: new Date().toISOString(), fieldValues: { title: book.title }, selectedFields: ['title'], userOverriddenFields: [] });
  return db;
}
it('full 17-sheet XLSX preserves every tabular entity, history, explicit string types and safe text on fresh restore', async () => {
  const source = await richLibrary(), target = await library(), before = await readCore(source), output = await exportWorkbook(source);
  const input = await readWorkbook(output.bytes);
  expect(input.workbook.SheetNames).toHaveLength(17);
  const book = before.books[0], sheet = input.workbook.Sheets.Books;
  expect(Object.values(sheet).filter(cell => cell?.v === '0306406152')).toMatchObject([{ t: 's', v: '0306406152' }]);
  expect(Object.values(sheet).filter(cell => cell?.v === '=SUM(A1:A3)')).toMatchObject([{ t: 's', v: '=SUM(A1:A3)' }]);
  const checked = await fullWorkbookCandidate(target, input); expect(checked.missingImages).toBe(0);
  expect(checked.backup.data.books[0]).toEqual(book);
  await restoreSnapshot(target, checked.backup, (await createSnapshot(target)).fingerprint);
  expect(await readCore(target)).toEqual(before);
});
it('foreign full Excel merge preserves links and history and repeated import adds nothing', async () => {
  const source = await richLibrary(), target = await library(); await saveBook(target, { ...emptyInput, title: 'נשאר' });
  const input = await readWorkbook((await exportWorkbook(source)).bytes), checked = await fullWorkbookCandidate(target, input);
  const plan = await previewMerge(target, checked.backup); await mergeSnapshot(target, checked.backup, plan.fingerprint, {}, true);
  expect(await target.books.count()).toBe(2); expect(await target.loans.count()).toBe(2); expect(await target.bookShelves.count()).toBe(2);
  const repeat = await previewMerge(target, (await fullWorkbookCandidate(target, input)).backup); expect(repeat.additions).toBe(0); expect(repeat.conflicts).toEqual([]);
});
it('simple Hebrew mapping expands copies, preserves zeros/apostrophe/formula-like strings and reuses the first import date', async () => {
  const db = await library(), input = await readWorkbook(writeWorkbook(simpleWorkbook())), mapping = suggestedMapping(input.headers);
  const first = await simpleWorkbookCandidate(db, input, mapping);
  expect(first.backup.data.books[0]).toMatchObject({ isbn10: '0306406152', danacode: '0000123', personalNotes: '=טקסט לדוגמה, אינו נוסחה' });
  expect(first.backup.data.copies).toHaveLength(3); expect(first.backup.data.copies[0]).toMatchObject({ purchasePriceMinor: 0, currency: 'ILS' });
  expect(first.backup.data.authors[1].displayName).toBe('א׳ כהן');
  const plan = await previewMerge(db, first.backup); await mergeSnapshot(db, first.backup, plan.fingerprint, {}, true);
  const repeat = await previewMerge(db, (await simpleWorkbookCandidate(db, input, mapping)).backup); expect(repeat.additions).toBe(0); expect(repeat.conflicts).toEqual([]);
  const undated = simpleWorkbook(); delete undated.Sheets.Books.I2;
  const noDate = await readWorkbook(writeWorkbook(undated)); const one = await simpleWorkbookCandidate(db, noDate, suggestedMapping(noDate.headers));
  const firstPlan = await previewMerge(db, one.backup); await mergeSnapshot(db, one.backup, firstPlan.fingerprint, {}, true);
  const again = await previewMerge(db, (await simpleWorkbookCandidate(db, noDate, suggestedMapping(noDate.headers))).backup); expect(again.additions).toBe(0); expect(again.conflicts).toEqual([]);
});
it('numeric identifiers, malformed dates and quantities report sheet/row/column without touching active data', async () => {
  const db = await library(), before = (await createSnapshot(db)).fingerprint;
  for (const [address, value, field] of [['C2', 306406152, 'isbn'], ['D2', 123, 'danacode'], ['E2', -1, 'copies'], ['I2', 'not-date', 'createdAt']] as const) {
    const workbook = simpleWorkbook(); workbook.Sheets.Books[address] = { t: typeof value === 'number' ? 'n' : 's', v: value };
    const input = await readWorkbook(writeWorkbook(workbook));
    await expect(simpleWorkbookCandidate(db, input, suggestedMapping(input.headers))).rejects.toMatchObject({ issues: [{ sheet: 'Books', row: 2, column: field }] });
  }
  expect((await createSnapshot(db)).fingerprint).toBe(before);
});
it('formula cached values, external links and unknown worksheets are rejected before writes', async () => {
  const db = await library(), before = (await createSnapshot(db)).fingerprint;
  const formula = simpleWorkbook(); formula.Sheets.Books.A2 = { t: 'n', f: '1+1', v: 2 };
  await expect(readWorkbook(writeWorkbook(formula))).rejects.toThrow('נוסחאות');
  const linked = simpleWorkbook(); linked.Sheets.Books.A2.l = { Target: 'https://example.invalid/' };
  await expect(readWorkbook(writeWorkbook(linked))).rejects.toThrow();
  const unknown = simpleWorkbook(); XLSX.utils.book_append_sheet(unknown, XLSX.utils.aoa_to_sheet([['unknown']]), 'Other');
  await expect(readWorkbook(writeWorkbook(unknown))).rejects.toThrow('גיליונות');
  expect((await createSnapshot(db)).fingerprint).toBe(before);
});
it('broken UUID/reference and unknown column/version fail with a location; shelf cycles are rejected atomically', async () => {
  const db = await richLibrary(), core = await readCore(db), before = (await createSnapshot(db)).fingerprint;
  for (const [sheet, address, value, column] of [['Copies','B2',crypto.randomUUID(),'bookId'], ['Books','A2','bad-id','id'], ['Books','A1','unknown','headers'], ['Manifest','B3','999','templateVersion']] as const) {
    const workbook = fullWorkbook(core); workbook.Sheets[sheet][address] = { t: 's', v: value };
    const input = await readWorkbook(writeWorkbook(workbook));
    await expect(fullWorkbookCandidate(db, input)).rejects.toMatchObject({ issues: [{ sheet: sheet === 'Manifest' ? 'Manifest' : sheet, column }] });
  }
  const cycle = fullWorkbook(core); const parentColumn = Object.keys(cycle.Sheets.Shelves).find(key => cycle.Sheets.Shelves[key]?.v === 'parentId')!;
  const parentIndex = XLSX.utils.decode_cell(parentColumn).c; cycle.Sheets.Shelves[XLSX.utils.encode_cell({ r: 1, c: parentIndex })] = { t: 's', v: core.shelves[0].id };
  await expect(fullWorkbookCandidate(db, await readWorkbook(writeWorkbook(cycle)))).rejects.toMatchObject({ issues: [{ sheet: 'Shelves', row: 2, column: 'parentId' }] });
  const overlap = fullWorkbook(core);
  const openColumn = XLSX.utils.decode_cell(Object.keys(overlap.Sheets.Loans).find(key => overlap.Sheets.Loans[key]?.v === 'openFlag')!).c;
  for (let r = 1; r <= core.loans.length; r++) { overlap.Sheets.Loans[XLSX.utils.encode_cell({ r, c: openColumn })] = { t: 'n', v: 1 }; delete overlap.Sheets.Loans[XLSX.utils.encode_cell({ r, c: 5 })]; }
  await expect(fullWorkbookCandidate(db, await readWorkbook(writeWorkbook(overlap)))).rejects.toMatchObject({ issues: [{ sheet: 'Loans', column: 'copyId/borrowedAt' }] });
  expect((await createSnapshot(db)).fingerprint).toBe(before);
});
it('ImageRefs warn about unavailable blobs and preserve matching local images without fetching', async () => {
  const db = await richLibrary(), target = await library(), book = (await db.books.toArray())[0];
  const blob = new Blob([new Uint8Array([255,216,255,192,0,17,8,0,2,0,3,3,1,17,0,2,17,0,3,17,0,255,217])], { type: 'image/jpeg' });
  const image = { id: crypto.randomUUID(), blob, mimeType: 'image/jpeg', width: 3, height: 2, byteLength: blob.size, sha256: await hashBytes(await blob.arrayBuffer()), sourceUrl: null, createdAt: new Date().toISOString() };
  await db.images.add(image); await db.books.update(book.id, { primaryImageId: image.id });
  const noEncoding = vi.spyOn(Blob.prototype, 'arrayBuffer').mockRejectedValue(new Error('Excel must not encode photos'));
  const output = await exportWorkbook(db); expect(noEncoding).not.toHaveBeenCalled(); noEncoding.mockRestore();
  const input = await readWorkbook(output.bytes);
  const missing = await fullWorkbookCandidate(target, input); expect(missing.missingImages).toBe(1); expect(missing.backup.data.books[0].primaryImageId).toBeNull();
  const available = await fullWorkbookCandidate(db, input); expect(available.missingImages).toBe(0); expect(available.backup.data.images[0].sha256).toBe(image.sha256);
});
it('missing Copies receive one stable copy; ZIP lying sizes, CRC and inflated limits reject before parser', async () => {
  const db = await richLibrary(), core = await readCore(db); core.loans = []; core.copies = [];
  const bytes = writeWorkbook(fullWorkbook(core)), input = await readWorkbook(bytes), one = await fullWorkbookCandidate(db, input), two = await fullWorkbookCandidate(db, input);
  expect(one.backup.data.copies).toHaveLength(1); expect(one.backup.data.copies).toEqual(two.backup.data.copies);
  const forged = bytes.slice(), view = new DataView(forged.buffer); let cursor = 0;
  while (cursor < forged.length - 46 && view.getUint32(cursor, true) !== 0x02014b50) cursor++;
  view.setUint32(cursor + 24, XLSX_LIMITS.entry + 1, true); await expect(guardXlsxZip(forged)).rejects.toThrow('גדול');
  const corrupt = bytes.slice(); corrupt[45] ^= 1; await expect(guardXlsxZip(corrupt)).rejects.toThrow();
  const large = simpleWorkbook(); large.Sheets.Books.A2 = { t: 's', v: 'x'.repeat(XLSX_LIMITS.entry + 1) };
  // The serializer itself enforces Excel's per-cell length, so fake central sizes above exercise the pre-parser bound.
  expect(() => writeWorkbook(large)).toThrow();
});
it('actual inflated bytes exceeding a forged declared size are stopped before the XLSX parser', async () => {
  const name = new TextEncoder().encode('xl/worksheets/sheet1.xml'), packed = deflateRawSync(Buffer.from('x'.repeat(1024 * 1024)));
  const local = new Uint8Array(30 + name.length + packed.length), central = new Uint8Array(46 + name.length), end = new Uint8Array(22);
  const a = new DataView(local.buffer), b = new DataView(central.buffer), c = new DataView(end.buffer);
  a.setUint32(0, 0x04034b50, true); a.setUint16(8, 8, true); a.setUint32(18, packed.length, true); a.setUint32(22, 1, true); a.setUint16(26, name.length, true);
  local.set(name, 30); local.set(packed, 30 + name.length);
  b.setUint32(0, 0x02014b50, true); b.setUint16(10, 8, true); b.setUint32(20, packed.length, true); b.setUint32(24, 1, true); b.setUint16(28, name.length, true); central.set(name, 46);
  c.setUint32(0, 0x06054b50, true); c.setUint16(8, 1, true); c.setUint16(10, 1, true); c.setUint32(12, central.length, true); c.setUint32(16, local.length, true);
  const archive = new Uint8Array(local.length + central.length + end.length); archive.set(local); archive.set(central, local.length); archive.set(end, local.length + central.length);
  await expect(guardXlsxZip(archive)).rejects.toThrow('מנופח');
});
it('streaming ZIP data descriptors agree with central sizes and forged descriptors cannot reach the parser', async () => {
  const original = writeWorkbook(simpleWorkbook()), source = new DataView(original.buffer), locals: Uint8Array[] = [], offsets: number[] = [];
  let cursor = 0, offset = 0;
  while (source.getUint32(cursor, true) === 0x04034b50) {
    const length = 30 + source.getUint16(cursor + 26, true) + source.getUint16(cursor + 28, true) + source.getUint32(cursor + 18, true);
    const local = original.slice(cursor, cursor + length), header = new DataView(local.buffer), descriptor = new Uint8Array(12);
    const footer = new DataView(descriptor.buffer); for (let i = 0; i < 3; i++) footer.setUint32(i * 4, source.getUint32(cursor + 14 + i * 4, true), true);
    header.setUint16(6, header.getUint16(6, true) | 8, true); header.setUint32(14, 0, true); header.setUint32(18, 0, true); header.setUint32(22, 0, true);
    offsets.push(offset); locals.push(local, descriptor); offset += local.length + descriptor.length; cursor += length;
  }
  const directory = original.slice(cursor, original.length - 22), central = new DataView(directory.buffer); let at = 0;
  for (const localOffset of offsets) {
    central.setUint16(at + 8, central.getUint16(at + 8, true) | 8, true); central.setUint32(at + 42, localOffset, true);
    at += 46 + central.getUint16(at + 28, true) + central.getUint16(at + 30, true) + central.getUint16(at + 32, true);
  }
  const end = original.slice(-22); new DataView(end.buffer).setUint32(16, offset, true);
  const archive = new Uint8Array(offset + directory.length + end.length); let position = 0;
  for (const part of [...locals, directory, end]) { archive.set(part, position); position += part.length; }
  expect((await readWorkbook(archive)).headers).toContain('דאנאקוד');
  const corrupt = archive.slice(); corrupt[locals[0].length] ^= 1; await expect(readWorkbook(corrupt)).rejects.toThrow('descriptor');
});
it('published full example and simple template are synthetic and accepted by the product parser', async () => {
  if (process.env.GENERATE_XLSX_FIXTURES === '1') {
    const db = await richLibrary(); await mkdir('public/templates', { recursive: true });
    await writeFile('public/templates/full-example.xlsx', (await exportWorkbook(db)).bytes);
    await writeFile('public/templates/Books-template.xlsx', writeWorkbook(simpleWorkbook()));
  }
  const db = await library();
  const full = await readWorkbook(new Uint8Array(await readFile('public/templates/full-example.xlsx')));
  const data = await fullWorkbookCandidate(db, full); expect(data.backup.counts.loans).toBe(2); expect(data.backup.counts.metadataSources).toBe(1); expect(data.backup.counts.bookShelves).toBe(2);
  const simple = await readWorkbook(new Uint8Array(await readFile('public/templates/Books-template.xlsx')));
  expect((await simpleWorkbookCandidate(db, simple, suggestedMapping(simple.headers))).backup.counts.copies).toBe(3);
});
it('edited titles rebuild sort keys and mark selected catalog fields as overridden; error row numbers retain gaps', async () => {
  const db = await richLibrary(), workbook = fullWorkbook(await readCore(db));
  workbook.Sheets.Books.B2 = { t: 's', v: 'שם חדש' };
  const candidate = await fullWorkbookCandidate(db, await readWorkbook(writeWorkbook(workbook)));
  expect(candidate.backup.data.books[0].titleSortKey).toBe('שם חדש'); expect(candidate.backup.data.metadataSources[0].userOverriddenFields).toContain('title');
  const spaced = simpleWorkbook();
  for (let c = 0; c < 9; c++) { const old = XLSX.utils.encode_cell({ r: 1, c }); spaced.Sheets.Books[XLSX.utils.encode_cell({ r: 3, c })] = spaced.Sheets.Books[old]; delete spaced.Sheets.Books[old]; }
  spaced.Sheets.Books['!ref'] = 'A1:I4'; spaced.Sheets.Books.E4 = { t: 'n', v: -1 };
  const input = await readWorkbook(writeWorkbook(spaced));
  await expect(simpleWorkbookCandidate(db, input, suggestedMapping(input.headers))).rejects.toMatchObject({ issues: [{ sheet: 'Books', row: 4, column: 'copies' }] });
});
