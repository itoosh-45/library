import { LibraryValidationError } from './library';

export const XLSX_LIMITS = { file: 10 * 1024 * 1024, inflated: 64 * 1024 * 1024, entry: 16 * 1024 * 1024, entries: 512, rows: 20000, columns: 64, cells: 500000 };
const bad = (message: string): never => { throw new LibraryValidationError(`Excel: ${message}. הספרייה לא שונתה.`); };
function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

// Check actual decompressed bytes before giving an untrusted archive to the XLSX parser.
export async function guardXlsxZip(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length > XLSX_LIMITS.file || bytes.length < 22) return bad('גודל הקובץ אינו נתמך (עד 10MiB)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at, true), u32 = (at: number) => view.getUint32(at, true);
  const checkExtra = (start: number, length: number) => {
    let cursor = start;
    while (cursor < start + length) {
      if (cursor + 4 > start + length) return bad('extra field פגום');
      const id = u16(cursor), size = u16(cursor + 2);
      if (cursor + 4 + size > start + length || id === 1 || id === 0x7075) return bad('ZIP64 או שם חלופי אינם נתמכים');
      cursor += 4 + size;
    }
  };
  let end = bytes.length - 22;
  while (end >= Math.max(0, bytes.length - 65557) && u32(end) !== 0x06054b50) end--;
  if (end < Math.max(0, bytes.length - 65557) || end + 22 + u16(end + 20) !== bytes.length) return bad('נדרש קובץ XLSX ZIP תקין');
  const entries = u16(end + 10), directory = u32(end + 16), directorySize = u32(end + 12);
  if (u16(end + 4) || u16(end + 6) || entries !== u16(end + 8) || !entries || entries > XLSX_LIMITS.entries || directory + directorySize !== end) return bad('ZIP רב־חלקים, ZIP64 או מספר entries לא נתמך');
  const names = new Set<string>(), spans: [number, number][] = [];
  let cursor = directory, inflated = 0, cells = 0;
  for (let index = 0; index < entries; index++) {
    if (cursor + 46 > end || u32(cursor) !== 0x02014b50) return bad('directory פגום');
    const flags = u16(cursor + 8), method = u16(cursor + 10), crc = u32(cursor + 16), compressed = u32(cursor + 20), size = u32(cursor + 24);
    const nameSize = u16(cursor + 28), extraSize = u16(cursor + 30), commentSize = u16(cursor + 32), local = u32(cursor + 42);
    if (cursor + 46 + nameSize + extraSize + commentSize > end || flags & 65 || ![0, 8].includes(method) || compressed === 0xffffffff || size > XLSX_LIMITS.entry || inflated + size > XLSX_LIMITS.inflated) return bad('ZIP מוצפן, גדול או לא נתמך');
    checkExtra(cursor + 46 + nameSize, extraSize);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    if (!name || names.has(name) || name.includes('..') || name.includes('\\') || name.startsWith('/') || !/^[\w./[\]-]+$/.test(name)) return bad('שם entry אינו תקין או כפול');
    names.add(name);
    if (/vba|externalLinks|embeddings|connections|queryTables|\.bin$/i.test(name)) return bad('מאקרו, חיבור חיצוני או תוכן בינארי אינם נתמכים');
    if (local + 30 > directory || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u16(local + 26) !== nameSize) return bad('כותרות ZIP אינן תואמות');
    const dataAt = local + 30 + nameSize + u16(local + 28), dataEnd = dataAt + compressed;
    if (dataEnd > directory || new TextDecoder().decode(bytes.subarray(local + 30, local + 30 + nameSize)) !== name || (!(flags & 8) && (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== size))) return bad('נפחי ZIP אינם תואמים');
    checkExtra(local + 30 + nameSize, u16(local + 28));
    let entryEnd = dataEnd;
    if (flags & 8) {
      if (dataEnd + 12 > directory) return bad('descriptor חסר');
      const descriptor = u32(dataEnd) === 0x08074b50 ? dataEnd + 4 : dataEnd;
      if (descriptor + 12 > directory || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== size) return bad('descriptor אינו תואם ל־directory');
      entryEnd = descriptor + 12;
    }
    if (spans.some(([start, finish]) => local < finish && entryEnd > start)) return bad('entries חופפים');
    spans.push([local, entryEnd]);
    const packed = bytes.slice(dataAt, dataEnd);
    let content: Uint8Array<ArrayBuffer>;
    if (method === 0) content = packed;
    else {
      let stream: DecompressionStream;
      try { stream = new DecompressionStream('deflate-raw'); } catch { return bad('הדפדפן אינו תומך בפענוח ZIP בטוח; נדרש Safari 16.4 ומעלה או דפדפן עדכני'); }
      const reader = new Blob([packed]).stream().pipeThrough(stream).getReader();
      const chunks: Uint8Array[] = []; let length = 0;
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          length += value.length;
          if (length > size || length > XLSX_LIMITS.entry || inflated + length > XLSX_LIMITS.inflated) { await reader.cancel(); return bad('ZIP מנופח חורג מהמגבלה'); }
          chunks.push(value);
        }
      } catch (error) { if (error instanceof LibraryValidationError) throw error; return bad('לא ניתן לפענח entry ZIP'); }
      content = new Uint8Array(length); let at = 0; for (const chunk of chunks) { content.set(chunk, at); at += chunk.length; }
    }
    if (content.length !== size || crc32(content) !== crc) return bad('שלמות ZIP נכשלה');
    inflated += content.length;
    if (/\.(xml|rels)$/i.test(name)) {
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(content);
      if (xml.includes('\0') || /encoding\s*=\s*["'](?!UTF-8["'])/i.test(xml)) return bad('XML חייב להיות UTF-8');
      // Unused MIME defaults can mention macro formats even in an ordinary XLSX. Reject actual parts/references.
      if (/<(?:\w+:)?Override\b[^>]*ContentType=["'][^"']*(?:macroEnabled|vbaProject)|<(?:\w+:)?externalReference\b/i.test(xml)) return bad(`${name}: מאקרו וקישורים חיצוניים אינם מותרים`);
      if (/<!DOCTYPE|<!ENTITY|<\s*(?:\w+:)?f(?:\s|\/?>)|TargetMode\s*=\s*["']External["']/i.test(xml)) return bad(`${name}: נוסחאות, entities וקישורים חיצוניים אינם מותרים`);
      if (/^xl\/worksheets\//.test(name)) {
        const cellTags = /<(?:\w+:)?c(?:\s|\/?>)/g, rowTags = /<(?:\w+:)?row(?:\s|\/?>)/g;
        while (cellTags.exec(xml)) if (++cells > XLSX_LIMITS.cells) return bad(`${name}: יותר מדי תאים`);
        let rows = 0;
        while (rowTags.exec(xml)) if (++rows > XLSX_LIMITS.rows + 1) return bad(`${name}: יותר מדי שורות`);
        for (const cell of xml.matchAll(/<(?:\w+:)?c\b[^>]*\br=["']([A-Z]+)(\d+)["']/g)) {
          let column = 0; for (const letter of cell[1]) column = column * 26 + letter.charCodeAt(0) - 64;
          if (column > XLSX_LIMITS.columns || +cell[2] > XLSX_LIMITS.rows + 1) return bad(`${name}: יותר מדי שורות, עמודות או תאים`);
        }
      }
    }
    cursor += 46 + nameSize + extraSize + commentSize;
  }
  if (cursor !== end || !names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) return bad('הקובץ אינו חוברת XLSX');
}
