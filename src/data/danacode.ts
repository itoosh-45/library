export function normalizedDanacode(value: string): string {
  const parts = /^\s*(\d{1,4})\s*-\s*(\d{1,8})\s*$/.exec(value);
  return parts ? parts[1].padStart(4, '0') + parts[2].padStart(8, '0') : value.replace(/\s/g, '');
}
