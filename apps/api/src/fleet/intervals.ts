/**
 * Half-open [start, end) overlap. Two intervals overlap iff start1 < end2 && start2 < end1.
 */
export function halfOpenRangesOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}
