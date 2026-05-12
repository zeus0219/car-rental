const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Number of 24h “rental day” blocks in \[pickup, return), **rounded up** to the next
 * full 24h (aligned with the half-open model: any fraction of a 24h block counts as a day).
 * Minimum 1 if `return` > `pickup`.
 */
export function countRentalDays24h(pickup: Date, returnAt: Date): number {
  if (!(returnAt > pickup)) {
    return 0;
  }
  const diff = returnAt.getTime() - pickup.getTime();
  return Math.max(1, Math.ceil(diff / MS_PER_DAY));
}
