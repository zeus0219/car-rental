/**
 * Desk-only VAT breakdown for display. API amounts (e.g. GET /rates/quote subtotalCents)
 * are treated as **net** when showing VAT; configure with NEXT_PUBLIC_VAT_RATE (0–1, e.g. 0.22).
 * Set to 0 to hide the VAT lines.
 */
export function getVatRate(): number {
  const raw = process.env.NEXT_PUBLIC_VAT_RATE;
  if (raw != null && raw !== '') {
    const n = Number.parseFloat(raw);
    if (!Number.isNaN(n) && n >= 0 && n <= 1) {
      return n;
    }
  }
  return 0.22;
}

export function vatFromNetCents(netCents: number, rate: number): { vatCents: number; grossCents: number } {
  const vatCents = Math.round(netCents * rate);
  return { vatCents, grossCents: netCents + vatCents };
}
