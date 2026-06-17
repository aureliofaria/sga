const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/** Format integer cents into a pt-BR currency string, e.g. 123456 -> "R$ 1.234,56". */
export function formatCents(cents: number | null | undefined): string {
  if (cents == null) return '-';
  return brl.format(cents / 100);
}

/** Parse a reais input (string or number) into integer cents. Accepts "1.234,56" or "1234.56". */
export function parseReaisToCents(input: string | number): number {
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = input.trim();
  if (!cleaned) return 0;
  // Normalize: remove thousands separators, use dot as decimal.
  const normalized = cleaned
    .replace(/\s/g, '')
    .replace(/R\$/i, '')
    .replace(/\./g, '')
    .replace(/,/g, '.');
  const value = Number(normalized);
  if (Number.isNaN(value)) return 0;
  return Math.round(value * 100);
}

const dateFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Format an ISO date string into a pt-BR date-time. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return dateFmt.format(d);
}
