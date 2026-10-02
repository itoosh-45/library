import { afterEach, beforeEach, expect, it } from 'vitest';
import { LibraryDatabase, initializeLibrary } from './database';
import { emptyInput, saveBook, changeCopy } from './books';
import { archivePerson, lendCopy, localDay, overdue, returnCopy, savePerson, validDay } from './loans';
import { createSnapshot, deleteBook, restoreSnapshot, validateBackup } from './backup';
import { hashBytes } from './images';

let database: LibraryDatabase;
beforeEach(async () => { database = new LibraryDatabase('phase07-' + crypto.randomUUID()); await initializeLibrary(database); });
afterEach(async () => { await database.delete(); });
async function fixture() {
  const book = await saveBook(database, { ...emptyInput, title: 'ספר השאלות סינתטי' });
  const first = (await database.copies.toArray())[0], second = await changeCopy(database, book.id, 1, { label: 'שני' }), third = await changeCopy(database, book.id, 2, { label: 'שלישי' });
  const person = await savePerson(database, 'אדם א'), other = await savePerson(database, 'אדם ב');
  return { book, copies: [first, second, third], person, other };
}
const loanInput = (copyId: string, personId: string) => ({ copyId, personId, borrowedOn: '2026-01-01', expectedReturnOn: '2026-01-02' });
async function changedBackup(edit: (backup: ReturnType<typeof JSON.parse>) => void) {
  const backup = JSON.parse((await createSnapshot(database)).text); edit(backup);
  backup.checksum = await hashBytes(new TextEncoder().encode(JSON.stringify(backup.data)).buffer); return JSON.stringify(backup);
}
it('T14 three copies loan independently to two people, return and archive retain history', async () => {
  const { book, copies, person, other } = await fixture();
  const loans = await Promise.all(copies.map((copy, i) => lendCopy(database, loanInput(copy.id, i === 1 ? other.id : person.id))));
  expect(await database.loans.count()).toBe(3); expect(await database.loans.where('[personId+openFlag]').equals([person.id, 1]).count()).toBe(2);
  await expect(changeCopy(database, book.id, 3, { id: copies[0].id, archive: true })).rejects.toThrow('מושאל');
  await expect(archivePerson(database, person, true)).rejects.toThrow('פתוחות');
  await returnCopy(database, loans[0].id, '2026-01-03');
  await changeCopy(database, book.id, 3, { id: copies[0].id, archive: true });
  await returnCopy(database, loans[2].id, '2026-01-03'); await archivePerson(database, person, true);
  expect(await database.loans.count()).toBe(3); expect((await database.loans.get(loans[0].id))?.openFlag).toBe(0);
  database.close(); await database.open(); expect(await database.loans.count()).toBe(3);
  expect((await createSnapshot(database)).counts).toMatchObject({ people: 2, loans: 3, books: 1, copies: 3 });
});
it('T14 races on the same copy serialize, including separate database connections', async () => {
  const { copies, person, other } = await fixture(); const next = new LibraryDatabase(database.name); await next.open();
  try {
    const outcomes = await Promise.allSettled([lendCopy(database, loanInput(copies[0].id, person.id)), lendCopy(next, loanInput(copies[0].id, other.id))]);
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1); expect(await database.loans.count()).toBe(1);
  } finally { next.close(); }
});
it('T14 double return cannot change the first return or erase history', async () => {
  const { copies, person } = await fixture(), loan = await lendCopy(database, loanInput(copies[0].id, person.id));
  const outcomes = await Promise.allSettled([returnCopy(database, loan.id, '2026-01-03'), returnCopy(database, loan.id, '2026-01-04')]);
  expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1); expect(await database.loans.count()).toBe(1);
  const returned = await database.loans.get(loan.id); await expect(returnCopy(database, loan.id)).rejects.toThrow('כבר'); expect(await database.loans.get(loan.id)).toEqual(returned);
});
it('T14 duplicate names require a separate-person choice and never merge histories', async () => {
  const { copies, person } = await fixture(); await expect(savePerson(database, '  אדם א  ')).rejects.toThrow('קיים');
  const duplicate = await savePerson(database, person.name, undefined, true); expect(duplicate.id).not.toBe(person.id);
  const originalLoan = await lendCopy(database, loanInput(copies[0].id, person.id)), duplicateLoan = await lendCopy(database, loanInput(copies[1].id, duplicate.id));
  await savePerson(database, 'שם שונה', duplicate); await expect(savePerson(database, 'עריכה ישנה', duplicate)).rejects.toThrow('השתנה');
  expect((await database.loans.get(originalLoan.id))?.personId).toBe(person.id); expect((await database.loans.get(duplicateLoan.id))?.personId).toBe(duplicate.id);
  expect((await createSnapshot(database)).counts.people).toBe(3);
});
it('T14 validates calendar days, future borrowing, expected dates, returns and UI overdue', async () => {
  const { copies, person } = await fixture();
  expect(validDay('2026-02-30')).toBe(false); expect(validDay('2024-02-29')).toBe(true); expect(validDay('2026-2-1')).toBe(false);
  for (const fields of [{ borrowedOn: '9999-01-01' }, { borrowedOn: '2026-02-30' }, { expectedReturnOn: '2025-12-31' }, { expectedReturnOn: '2026-02-30' }, { expectedReturnOn: 0 as unknown as string }, { separateDuplicate: 'yes' as unknown as boolean }]) await expect(lendCopy(database, { ...loanInput(copies[0].id, person.id), ...fields })).rejects.toThrow();
  const loan = await lendCopy(database, loanInput(copies[0].id, person.id)); expect(overdue(loan, '2026-01-03')).toBe(true); expect(overdue(loan, '2026-01-02')).toBe(false);
  await expect(returnCopy(database, loan.id, '2025-12-31')).rejects.toThrow('לפני'); await expect(returnCopy(database, loan.id, '9999-01-01')).rejects.toThrow('בעבר');
  await returnCopy(database, loan.id, '2026-01-03'); expect(overdue((await database.loans.get(loan.id))!, '2026-01-04')).toBe(false);
  const fresh = await lendCopy(database, { ...loanInput(copies[0].id, person.id), borrowedOn: localDay(), expectedReturnOn: '' }); expect(fresh.expectedReturnOn).toBeNull(); expect(overdue(fresh)).toBe(false);
});
it('T14 rejects missing/archived copy or person and overlapping history without writes', async () => {
  const { book, copies, person } = await fixture(); await changeCopy(database, book.id, 3, { id: copies[1].id, archive: true });
  for (const input of [loanInput(crypto.randomUUID(), person.id), loanInput(copies[1].id, person.id), loanInput(copies[0].id, crypto.randomUUID())]) await expect(lendCopy(database, input)).rejects.toThrow();
  const loan = await lendCopy(database, loanInput(copies[0].id, person.id)); await returnCopy(database, loan.id, '2026-01-03');
  await expect(lendCopy(database, { ...loanInput(copies[0].id, person.id), borrowedOn: '2026-01-02' })).rejects.toThrow('חופף');
  await archivePerson(database, person, true); await expect(lendCopy(database, loanInput(copies[2].id, person.id))).rejects.toThrow('פעיל');
  const current = (await database.people.get(person.id))!; await archivePerson(database, current, false); expect((await database.people.get(person.id))?.archivedAt).toBeNull();
});
it('new person plus loan rolls back together on storage failure', async () => {
  const { copies } = await fixture(), before = await createSnapshot(database); const fail = () => { throw new Error('loan-write-failure'); };
  database.loans.hook('creating', fail);
  await expect(lendCopy(database, { copyId: copies[0].id, newPersonName: 'לא יישמר', borrowedOn: localDay(), expectedReturnOn: '' })).rejects.toThrow('loan-write');
  database.loans.hook('creating').unsubscribe(fail); expect((await createSnapshot(database)).fingerprint).toBe(before.fingerprint);
});
it('v3 backup round trip protects people, duplicates, archived people and loan history', async () => {
  const { copies, person, other } = await fixture(), loan = await lendCopy(database, loanInput(copies[0].id, person.id));
  await returnCopy(database, loan.id, '2026-01-03'); await archivePerson(database, person, true); await lendCopy(database, loanInput(copies[1].id, other.id));
  await savePerson(database, other.name, undefined, true);
  const snapshot = await createSnapshot(database), incoming = await validateBackup(snapshot.text); expect(JSON.parse(snapshot.text).version).toBe(7); expect(incoming.counts).toMatchObject({ people: 3, loans: 2 });
  await restoreSnapshot(database, incoming, snapshot.fingerprint); expect((await createSnapshot(database)).fingerprint).toBe(snapshot.fingerprint);
});
for (const version of [1, 2]) it(`v${version} restore explicitly clears people/loans and accepts old counts`, async () => {
  const { copies, person } = await fixture();
  const old = await changedBackup(backup => { backup.version = version; backup.schemaVersion = version === 1 ? 1 : 2; for (const key of version === 1 ? ['shelves', 'bookShelves', 'series', 'genres', 'tags', 'people', 'loans', 'metadataSources', 'recognitionDrafts'] : ['people', 'loans', 'metadataSources', 'recognitionDrafts']) { delete backup.data[key]; delete backup.counts[key]; } });
  await lendCopy(database, loanInput(copies[0].id, person.id)); const incoming = await validateBackup(old); expect(incoming.counts.people).toBe(0); expect(incoming.counts.loans).toBe(0);
  await restoreSnapshot(database, incoming, (await createSnapshot(database)).fingerprint); expect(await database.people.count()).toBe(0); expect(await database.loans.count()).toBe(0);
});
it('v3 rejects dangling loans, flags, dates, foreign fields, counts, duplicate IDs and open/overlapping loans', async () => {
  const { copies, person } = await fixture(); await lendCopy(database, loanInput(copies[0].id, person.id));
  const edits = [
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].personId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].copyId = crypto.randomUUID(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].openFlag = 0; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].returnedAt = '2025-01-01T12:00:00.000Z'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].expectedReturnOn = '2026-02-30'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans[0].borrowedAt = '2026-02-30T12:00:00.000Z'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.people[0].phone = 'forbidden'; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.people[0].normalizedName = 'wrong'; },
    (b: ReturnType<typeof JSON.parse>) => { b.counts.loans = 0; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans.push({ ...b.data.loans[0] }); b.counts.loans++; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.loans.push({ ...b.data.loans[0], id: crypto.randomUUID() }); b.counts.loans++; },
    (b: ReturnType<typeof JSON.parse>) => { b.data.copies.find((copy: { id: string }) => copy.id === b.data.loans[0].copyId).archivedAt = new Date().toISOString(); },
    (b: ReturnType<typeof JSON.parse>) => { b.data.people.find((person: { id: string }) => person.id === b.data.loans[0].personId).archivedAt = new Date().toISOString(); },
  ];
  for (const edit of edits) await expect(validateBackup(await changedBackup(edit))).rejects.toThrow();
});
it('loan/person/return changes invalidate protection, restore failure rolls back all data and deletion preserves history', async () => {
  const { book, copies, person } = await fixture(), before = await createSnapshot(database), incoming = await validateBackup(before.text);
  const loan = await lendCopy(database, loanInput(copies[0].id, person.id)); await expect(restoreSnapshot(database, incoming, before.fingerprint)).rejects.toThrow('השתנתה');
  const current = await createSnapshot(database); await returnCopy(database, loan.id, '2026-01-03'); await expect(restoreSnapshot(database, incoming, current.fingerprint)).rejects.toThrow('השתנתה');
  const safety = await createSnapshot(database); await expect(deleteBook(database, book.id, safety.fingerprint)).rejects.toThrow('היסטוריית');
  const fail = () => { throw new Error('people-restore-failure'); }; database.people.hook('creating', fail);
  await expect(restoreSnapshot(database, incoming, safety.fingerprint)).rejects.toThrow('people-restore'); database.people.hook('creating').unsubscribe(fail);
  expect((await createSnapshot(database)).fingerprint).toBe(safety.fingerprint);
  await savePerson(database, 'שם חדש', person); await expect(restoreSnapshot(database, incoming, safety.fingerprint)).rejects.toThrow('השתנתה');
});
