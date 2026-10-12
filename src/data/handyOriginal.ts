import schema from './handySchema.json';
import { LibraryValidationError } from './library';
import type { HandyLibraryOriginal } from './models';

export function validateHandyOriginal(value: HandyLibraryOriginal, imageIds: Set<string>) {
  const fail = (): never => { throw new LibraryValidationError('נתוני המקור של Handy Library אינם תקינים. הספרייה לא שונתה.'); };
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== ['row', 'csv', 'iconImageId', 'photoImageId'].sort().join()) return fail();
  for (const [record, allowed, numeric] of [[value.row, schema.bookColumns, true], [value.csv, schema.csvHeaders, false]] as const) {
    if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(key => !allowed.includes(key))) return fail();
    for (const item of Object.values(record)) if (!(typeof item === 'string' && item.length <= 20000 || numeric && (item === null || typeof item === 'number' && Number.isFinite(item)))) return fail();
  }
  for (const id of [value.iconImageId, value.photoImageId]) if (id !== null && !imageIds.has(id)) return fail();
}
