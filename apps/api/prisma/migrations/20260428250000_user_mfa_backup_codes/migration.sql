-- A3: MFA backup (recovery) code hashes
ALTER TABLE "User" ADD COLUMN "mfaBackupCodeHashes" JSONB;
