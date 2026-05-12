-- C3: magic-link style read-only access to a public web quote (no login)
ALTER TABLE "Reservation" ADD COLUMN "publicViewToken" VARCHAR(64);
ALTER TABLE "Reservation" ADD COLUMN "publicViewTokenAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Reservation_publicViewToken_key" ON "Reservation"("publicViewToken");
