/** B3: lightweight Italian fiscal / VAT checks (desk customer + company forms). */

/** Standard codice fiscale pattern — does not cover every omocodia edge case. */
const IT_CF_RE =
  /^[A-Z]{6}\d{2}[ABCDEHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/i;

export function isValidItalianFiscalCode(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') {
    return true;
  }
  const s = raw.trim().toUpperCase().replace(/\s/g, '');
  if (s.length !== 16) {
    return false;
  }
  return IT_CF_RE.test(s);
}

/** Normalize VAT: strip IT prefix and spaces; expect 11 digits + optional check digit. */
export function normalizeItalianVatDigits(raw: string | null | undefined): string | null {
  if (raw == null || raw === '') {
    return null;
  }
  let s = raw.trim().toUpperCase().replace(/\s/g, '');
  if (s.startsWith('IT')) {
    s = s.slice(2);
  }
  return /^\d{11}$/.test(s) ? s : null;
}

/** Mod-11 check digit on first 10 digits (Agenzia Entrate Partita IVA). */
export function isValidItalianVatNumber(raw: string | null | undefined): boolean {
  if (raw == null || raw === '') {
    return true;
  }
  const d = normalizeItalianVatDigits(raw);
  if (!d) {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let n = d.charCodeAt(i) - 48;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === d.charCodeAt(10) - 48;
}
