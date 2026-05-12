-- B2: speed retention purge queries (worker)
CREATE INDEX "CustomerDocument_retentionUntil_idx" ON "CustomerDocument"("retentionUntil");
