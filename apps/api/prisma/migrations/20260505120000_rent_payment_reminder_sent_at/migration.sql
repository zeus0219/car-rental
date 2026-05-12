-- C2: optional one-time dunning email for unpaid public-web reservations (see RentReminderService)
ALTER TABLE "Reservation" ADD COLUMN "rentPaymentReminderSentAt" TIMESTAMP(3);
