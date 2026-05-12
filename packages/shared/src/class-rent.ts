import { countRentalDays24h } from './rental-days';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ClassSeasonalRateRow = {
  validFrom: Date;
  validTo: Date;
  dailyCents: number;
  priority: number;
};

function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Sum rent for `countRentalDays24h` billing days: day *i* uses UTC calendar date
 * of `pickup + i×24h`. Each day picks the season row with highest `priority` (then `dailyCents`)
 * that covers the date, else `defaultDailyCents`. If any day is unpriced, returns `null`.
 */
export function sumClassRentCents24h(
  defaultDailyCents: number | null,
  seasons: ClassSeasonalRateRow[],
  pickup: Date,
  returnAt: Date,
): number | null {
  const numDays = countRentalDays24h(pickup, returnAt);
  if (numDays === 0) {
    return null;
  }
  let total = 0;
  for (let i = 0; i < numDays; i++) {
    const t = new Date(pickup.getTime() + i * MS_PER_DAY);
    const dStr = isoDateUtc(t);
    const candidates = seasons.filter((s) => {
      const a = isoDateUtc(s.validFrom);
      const b = isoDateUtc(s.validTo);
      return dStr >= a && dStr <= b;
    });
    candidates.sort((x, y) => y.priority - x.priority || y.dailyCents - x.dailyCents);
    const dayRate = candidates.length > 0 ? candidates[0].dailyCents : defaultDailyCents;
    if (dayRate == null) {
      return null;
    }
    total += dayRate;
  }
  return total;
}
