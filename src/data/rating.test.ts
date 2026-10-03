import { expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook, changeCopy } from './books';
import { createSnapshot, restoreSnapshot, validateBackup } from './backup';
import { lendCopy, loanReturnDay, changeLoanReturnDay, returnCopy } from './loans';
import { advancedBooks, defaultAdvanced } from './advancedSearch';
import { createFullSnapshot } from './fullBackup';

it('personal stars persist across unrelated edits and full backup/restore; invalid ratings never write', async () => {
  const source = new LibraryDatabase('rating-source-' + crypto.randomUUID());
  const target = new LibraryDatabase('rating-target-' + crypto.randomUUID());
  try {
    await initializeLibrary(source); await initializeLibrary(target);
    const original = await saveBook(source, { ...emptyInput, title: 'ספר מדורג', rating: 4 });
    const edited = await saveBook(source, { ...emptyInput, title: 'שם מעודכן' }, original);
    expect(edited.rating).toBe(4);
    const snapshot = await createFullSnapshot(source);
    expect(JSON.parse(snapshot.text).formatVersion).toBe(9);
    const backup = await validateBackup(snapshot.text);
    await restoreSnapshot(target, backup, (await createSnapshot(target)).fingerprint);
    expect((await target.books.get(original.id))?.rating).toBe(4);
    for (const rating of [0, 6, 2.5, NaN]) await expect(saveBook(source, { ...emptyInput, rating }, edited)).rejects.toThrow();
    expect((await source.books.get(original.id))?.rating).toBe(4);
    const cleared = await saveBook(source, { ...emptyInput, title: 'שם מעודכן', rating: null }, edited);
    expect(cleared.rating).toBeNull();
    expect((await validateBackup((await createFullSnapshot(source)).text)).data.books[0].rating).toBeNull();
  } finally { await source.delete(); await target.delete(); }
});


it('price and genres update only intended data, reject invalid input atomically and survive full backup', async () => {
  const source = new LibraryDatabase('price-source-' + crypto.randomUUID());
  const target = new LibraryDatabase('price-target-' + crypto.randomUUID());
  try {
    await initializeLibrary(source); await initializeLibrary(target);
    const book = await saveBook(source, { ...emptyInput, title: 'ספר', price: '45.50', genreNames: ['פנטזיה', 'פנטזיה'], rating: 5 });
    const copy = (await source.copies.toArray())[0];
    await changeCopy(source, book.id, book.revision, { id: copy.id, label: 'מקורי', notes: 'לשמר הערה', price: '45.50' });
    let current = (await source.books.get(book.id))!;
    const second = await changeCopy(source, book.id, current.revision, { label: 'שני', price: '90' });
    current = (await source.books.get(book.id))!;
    const changed = await saveBook(source, { ...emptyInput, title: 'שם חדש', price: '0' }, current);
    expect(await source.copies.get(copy.id)).toMatchObject({ label: 'מקורי', notes: 'לשמר הערה', purchasePriceMinor: 0, currency: 'ILS' });
    expect((await source.copies.get(second.id))?.purchasePriceMinor).toBe(9000);
    expect(changed.genreIds).toEqual(book.genreIds); expect(await source.genres.count()).toBe(1);
    const before = (await createSnapshot(source)).fingerprint;
    await expect(saveBook(source, { ...emptyInput, price: '-1', genreNames: ['חדש'] }, changed)).rejects.toThrow();
    await expect(saveBook(source, { ...emptyInput, price: '1.999' }, changed)).rejects.toThrow();
    await expect(saveBook(source, { ...emptyInput, genreNames: ['x'.repeat(121)] }, changed)).rejects.toThrow();
    expect((await createSnapshot(source)).fingerprint).toBe(before);
    await restoreSnapshot(target, await validateBackup((await createFullSnapshot(source)).text), (await createSnapshot(target)).fingerprint);
    expect(await target.copies.get(copy.id)).toEqual(await source.copies.get(copy.id));
    expect(await target.genres.toArray()).toEqual(await source.genres.toArray());
  } finally { await source.delete(); await target.delete(); }
});

it('loan duration uses calendar days and due edits reject stale, returned and invalid loans', async () => {
  expect(loanReturnDay('2026-12-29', 7)).toBe('2027-01-05');
  expect(loanReturnDay('2028-02-28', 2)).toBe('2028-03-01');
  for (const days of [0, 1.5, 3651]) expect(() => loanReturnDay('2026-01-01', days)).toThrow();
  const source = new LibraryDatabase('due-source-' + crypto.randomUUID());
  try {
    await initializeLibrary(source); await saveBook(source, { ...emptyInput, title: 'ספר' });
    const copy = (await source.copies.toArray())[0];
    const loan = await lendCopy(source, { copyId: copy.id, newPersonName: 'אדם', borrowedOn: '2026-01-01', expectedReturnOn: '2026-01-08' });
    await changeLoanReturnDay(source, loan.id, loan.expectedReturnOn, '2026-01-15');
    await expect(changeLoanReturnDay(source, loan.id, loan.expectedReturnOn, '2026-01-16')).rejects.toThrow('השתנתה');
    await expect(changeLoanReturnDay(source, loan.id, '2026-01-15', '2025-12-31')).rejects.toThrow();
    const data = { books: await source.books.toArray(), copies: await source.copies.toArray(), authors: [], genres: [], tags: [], shelves: [], bookShelves: [], loans: await source.loans.toArray() };
    expect(advancedBooks(data, '', { ...defaultAdvanced, loan: 'borrowed', sort: 'due' })).toHaveLength(1);
    const backup = await validateBackup((await createFullSnapshot(source)).text);
    expect(backup.data.loans[0].expectedReturnOn).toBe('2026-01-15');
    await returnCopy(source, loan.id, '2026-01-16');
    await expect(changeLoanReturnDay(source, loan.id, '2026-01-15', '2026-01-20')).rejects.toThrow();
    expect(advancedBooks({ ...data, loans: await source.loans.toArray() }, '', { ...defaultAdvanced, loan: 'borrowed' })).toHaveLength(0);
  } finally { await source.delete(); }
});
