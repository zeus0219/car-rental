-- G2: idempotency for POST /v1/partner/reservations (Idempotency-Key header)
CREATE TABLE "PartnerReservationIdempotency" (
    "id" TEXT NOT NULL,
    "partnerApiKeyId" TEXT NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "bodyHash" VARCHAR(64) NOT NULL,
    "reservationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerReservationIdempotency_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PartnerReservationIdempotency_partnerApiKeyId_keyHash_key" ON "PartnerReservationIdempotency"("partnerApiKeyId", "keyHash");

CREATE INDEX "PartnerReservationIdempotency_reservationId_idx" ON "PartnerReservationIdempotency"("reservationId");

ALTER TABLE "PartnerReservationIdempotency" ADD CONSTRAINT "PartnerReservationIdempotency_partnerApiKeyId_fkey" FOREIGN KEY ("partnerApiKeyId") REFERENCES "PartnerApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PartnerReservationIdempotency" ADD CONSTRAINT "PartnerReservationIdempotency_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
