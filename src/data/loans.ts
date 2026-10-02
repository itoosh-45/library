import type { LibraryDatabase } from './database';
import type { Loan, Person } from './models';
import { LibraryValidationError, normalizeText } from './library';

const fail = (message: string): never => { throw new LibraryValidationError(message); };
export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || year > 9999) return false;
  return localDay(new Date(year, month - 1, day, 12)) === value;
}
function eventTime(day: string, now: Date): string {
  if (!validDay(day) || day > localDay(now)) return fail('תאריך ההשאלה או ההחזרה צריך להיות היום או תאריך תקין בעבר.');
  const [year, month, date] = day.split('-').map(Number);
  return day === localDay(now) ? now.toISOString() : new Date(year, month - 1, date, 12).toISOString();
}
export function overdue(loan: Loan, today = localDay()): boolean {
  return loan.returnedAt === null && loan.expectedReturnOn !== null && loan.expectedReturnOn < today;
}
export async function savePerson(database: LibraryDatabase, name: string, existing?: Person, separateDuplicate = false): Promise<Person> {
  if (typeof separateDuplicate !== 'boolean') return fail('אישור אדם נוסף אינו תקין.');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || !normalizeText(name)) return fail('שם האדם צריך להכיל בין 1 ל־120 תווים.');
  const value = name.trim(), normalizedName = normalizeText(value);
  return database.transaction('rw', database.people, async () => {
    const current = existing ? await database.people.get(existing.id) : undefined;
    if (existing && JSON.stringify(current) !== JSON.stringify(existing)) return fail('האדם השתנה בחלון אחר. פתח אותו מחדש.');
    const duplicate = await database.people.where('normalizedName').equals(normalizedName).filter(person => person.id !== existing?.id).first();
    if (duplicate && !separateDuplicate) return fail('קיים אדם בשם הזה. בחר אותו, או אשר שזהו אדם נוסף עם אותו שם.');
    const person: Person = { id: current?.id ?? crypto.randomUUID(), name: value, normalizedName, archivedAt: current?.archivedAt ?? null };
    await database.people.put(person); return person;
  });
}
export async function archivePerson(database: LibraryDatabase, expected: Person, archive: boolean): Promise<void> {
  if (typeof archive !== 'boolean') return fail('מצב הארכוב אינו תקין.');
  await database.transaction('rw', [database.people, database.loans], async () => {
    if (JSON.stringify(await database.people.get(expected.id)) !== JSON.stringify(expected)) return fail('האדם השתנה בחלון אחר. פתח אותו מחדש.');
    if (archive && await database.loans.where('[personId+openFlag]').equals([expected.id, 1]).count()) return fail('לאדם יש השאלות פתוחות. רשום החזרות לפני ארכוב.');
    await database.people.update(expected.id, { archivedAt: archive ? new Date().toISOString() : null });
  });
}
export interface LoanInput { copyId: string; personId?: string; newPersonName?: string; separateDuplicate?: boolean; borrowedOn: string; expectedReturnOn: string }
export async function lendCopy(database: LibraryDatabase, input: LoanInput): Promise<Loan> {
  if (!input || typeof input.copyId !== 'string' || typeof input.expectedReturnOn !== 'string' || (input.personId !== undefined && typeof input.personId !== 'string') || (input.newPersonName !== undefined && typeof input.newPersonName !== 'string') || (input.separateDuplicate !== undefined && typeof input.separateDuplicate !== 'boolean')) return fail('נתוני ההשאלה אינם תקינים.');
  const now = new Date(), borrowedAt = eventTime(input.borrowedOn, now);
  if (input.expectedReturnOn && (!validDay(input.expectedReturnOn) || input.expectedReturnOn < input.borrowedOn)) return fail('תאריך ההחזרה הצפוי צריך להיות תאריך תקין שאינו לפני ההשאלה.');
  if (!!input.personId === !!input.newPersonName?.trim()) return fail('בחר אדם קיים או הזן שם לאדם חדש.');
  return database.transaction('rw', [database.books, database.copies, database.people, database.loans], async () => {
    const copy = await database.copies.get(input.copyId);
    if (!copy || !await database.books.get(copy.bookId)) return fail('העותק אינו קיים. פתח את הספר מחדש.');
    if (copy.archivedAt) return fail('העותק בארכיון. החזר אותו מהארכיון לפני השאלה.');
    if (await database.loans.where('[copyId+openFlag]').equals([copy.id, 1]).count()) return fail('העותק כבר מושאל. בחר עותק זמין אחר.');
    const history = await database.loans.where('copyId').equals(copy.id).toArray();
    if (history.some(loan => loan.returnedAt !== null && Date.parse(loan.returnedAt) > Date.parse(borrowedAt))) return fail('תאריך ההשאלה חופף להשאלה קודמת של העותק.');
    const person = input.personId ? await database.people.get(input.personId) : await savePerson(database, input.newPersonName!, undefined, input.separateDuplicate);
    if (!person || person.archivedAt) return fail('האדם אינו זמין להשאלה. בחר אדם פעיל.');
    const loan: Loan = { id: crypto.randomUUID(), copyId: copy.id, personId: person.id, borrowedAt, expectedReturnOn: input.expectedReturnOn || null, returnedAt: null, openFlag: 1, notes: null, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await database.loans.add(loan); return loan;
  });
}
export async function returnCopy(database: LibraryDatabase, id: string, returnedOn = localDay()): Promise<void> {
  const now = new Date(), returnedAt = eventTime(returnedOn, now);
  await database.transaction('rw', database.loans, async () => {
    const loan = await database.loans.get(id);
    if (!loan) return fail('ההשאלה אינה קיימת.');
    if (loan.returnedAt !== null) return fail('ההשאלה כבר הוחזרה. לא נרשמה החזרה נוספת.');
    if (Date.parse(returnedAt) < Date.parse(loan.borrowedAt)) return fail('תאריך ההחזרה אינו יכול להיות לפני ההשאלה.');
    await database.loans.update(id, { returnedAt, openFlag: 0, updatedAt: now.toISOString() });
  });
}
