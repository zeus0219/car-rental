-- G2: Backfill `Reservation.createdByPartnerApiKeyId` for PARTNER rows created before the FK existed,
-- using the earliest `PartnerReservationIdempotency` row per reservation (the partner create path).

UPDATE "Reservation" r
SET "createdByPartnerApiKeyId" = sub."partnerApiKeyId"
FROM (
  SELECT DISTINCT ON ("reservationId") "reservationId", "partnerApiKeyId"
  FROM "PartnerReservationIdempotency"
  ORDER BY "reservationId", "createdAt" ASC
) sub
WHERE r.id = sub."reservationId"
  AND r."source" = 'PARTNER'
  AND r."createdByPartnerApiKeyId" IS NULL;
