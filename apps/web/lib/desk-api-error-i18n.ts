import { tryParseLocaleCookie } from './public-locale';
import { publicT, type PublicMessageKey } from './public-messages';

/** English API messages (Nest defaults + service strings) → i18n keys */
const STRING_TO_KEY: Record<string, PublicMessageKey> = {
  Forbidden: 'desk.apiErr.nestForbidden',
  Unauthorized: 'desk.apiErr.nestUnauthorized',
  'Not Found': 'desk.apiErr.nestNotFound',
  'Session expired or invalid': 'desk.apiErr.sessionExpired',
  'Invalid credentials': 'desk.apiErr.invalidCredentials',
  'Your password no longer meets security policy; use Forgot password to set a new one.':
    'desk.apiErr.passwordPolicyLogin',
  'CaRGOS: cannot enqueue after the cutoff before pickup (company policy). Reschedule pickup or ask Branch/Admin for a handover override.':
    'desk.apiErr.cargosEnqueueCutoff',
  'Account temporarily locked due to failed sign-in attempts': 'desk.apiErr.accountLocked',
  'Invalid two-factor code': 'desk.apiErr.invalidTotp',
  'Invalid or expired MFA step token': 'desk.apiErr.invalidMfaToken',
  'MFA is not active for this account': 'desk.apiErr.mfaNotActive',
  'Invalid recovery code': 'desk.apiErr.invalidRecoveryCode',
  'MFA is only available for admin and branch manager accounts': 'desk.apiErr.mfaRoleOnly',
  'MFA is already enabled': 'desk.apiErr.mfaAlreadyEnabled',
  'Call POST /auth/mfa/setup first, then enter the app code here': 'desk.apiErr.mfaSetupFirst',
  'Invalid code': 'desk.apiErr.invalidCode',
  'Turn off MFA with disable, not cancel': 'desk.apiErr.mfaUseDisable',
  'MFA is not enabled': 'desk.apiErr.mfaNotEnabled',
  'Two-factor authentication is required for admin and branch manager accounts.':
    'desk.apiErr.mfaPolicyLogin',
  'Two-factor authentication cannot be disabled while required by policy.': 'desk.apiErr.mfaPolicyDisable',
  'Complete or cancel two-factor enrollment (confirm the app code) before using the desk.':
    'desk.apiErr.mfaEnrollmentRequiredForDesk',
  'MFA enrollment is no longer pending — sign in again for a full session.':
    'desk.apiErr.mfaSessionStaleEnroll',
  'Two-factor authentication is required — sign in again with a fully enrolled account.':
    'desk.apiErr.mfaFullSessionRequired',
  'Registration is not enabled (AUTH_ALLOW_REGISTER=true)': 'desk.apiErr.registerDisabled',
  'Company not found': 'desk.apiErr.companyNotFound',
  'Booking link recovery is not configured': 'desk.apiErr.bookingLinkRecoveryNotConfigured',
  'Cannot update an anonymized customer (B4)': 'desk.apiErr.customerCannotUpdateAnonymized',
  'Customer is already anonymized': 'desk.apiErr.customerAlreadyAnonymized',
  'Only admin or branch manager can anonymize a customer': 'desk.apiErr.customerAnonymizeRoleOnly',
  'Cannot merge a customer record into itself': 'desk.apiErr.customerMergeSelf',
  'Merge is only allowed between customers of the same company': 'desk.apiErr.customerMergeDifferentCompany',
  'Cannot merge anonymized customer records': 'desk.apiErr.customerMergeAnonymized',
  'Invalid companyId': 'desk.apiErr.invalidCompanyIdParam',
  'Invalid query (companyId must be a UUID, q max 200 chars)': 'desk.apiErr.customerListInvalidQuery',
  'Invalid query (filters / UUIDs / q max 200 chars)': 'desk.apiErr.invoiceListInvalidQuery',
  'Pass companyId': 'desk.apiErr.auditCompanyIdRequired',
  'Provide either token or magic, not both': 'desk.apiErr.publicBookingTokenMagicExclusive',
  'token or magic is required': 'desk.apiErr.publicBookingTokenOrMagicRequired',
  'Partner API key required': 'desk.apiErr.partnerKeyRequired',
  'Invalid partner API key': 'desk.apiErr.partnerKeyInvalid',
  'companyId does not match API key': 'desk.apiErr.partnerCompanyMismatch',
  'API key not found': 'desk.apiErr.partnerKeyNotFound',
  'Idempotency-Key must be at most 256 characters': 'desk.apiErr.partnerIdempotencyKeyTooLong',
  'Idempotency-Key was already used with a different request payload':
    'desk.apiErr.partnerIdempotencyPayloadMismatch',
  'Idempotency record exists but reservation is missing or no longer PARTNER-sourced':
    'desk.apiErr.partnerIdempotencyOrphan',
  'Partner context missing': 'desk.apiErr.partnerContextMissing',
  'Invalid status (use PENDING, PROCESSING, SUCCEEDED, or DEAD)':
    'desk.apiErr.partnerWebhookInvalidStatus',
  'No OCR suggestion to apply': 'desk.apiErr.ocrNoSuggestion',
  'OCR suggestion was already applied': 'desk.apiErr.ocrAlreadyApplied',
  'Document upload is not complete; finish upload before running OCR': 'desk.apiErr.ocrUploadIncomplete',
  'OCR was already applied for this document': 'desk.apiErr.ocrDocumentDone',
  'Cannot dismiss OCR after it was applied': 'desk.apiErr.ocrDismissAfterApply',
  'No document number or expiry in suggestion to append': 'desk.apiErr.ocrNoDocMeta',
  'Suggested full name is missing': 'desk.apiErr.ocrNoSuggestedName',
  'Suggested fiscal code is missing': 'desk.apiErr.ocrNoSuggestedFiscal',
  'Nothing to apply': 'desk.apiErr.ocrNothingToApply',
  'Station does not belong to this company': 'desk.apiErr.stationWrongCompany',
  'Email already in use': 'desk.apiErr.emailInUse',
  'Invalid or expired reset link': 'desk.apiErr.invalidResetLink',
  'Current password is incorrect': 'desk.apiErr.wrongCurrentPassword',
  'New password must differ from current password': 'desk.apiErr.samePassword',
  'Not allowed to access this company': 'desk.apiErr.forbiddenCompany',
  'companyId is required when filtering by source': 'desk.apiErr.companyIdForSource',
  'customerId does not belong to the requested company': 'desk.apiErr.customerWrongCompany',
  'Provide at least one filter, e.g. companyId, vehicleId, or from+to': 'desk.apiErr.reservationFilterRequired',
  'Only ADMIN or BRANCH_MANAGER can set a CaRGOS handover override': 'desk.apiErr.cargosOverrideRole',
  'Will not queue CaRGOS for a cancelled reservation': 'desk.apiErr.cargosCancelledReservation',
  'Set company cargosHttpUrl in Organization → CaRGOS, or use MOCK / OFF adapter':
    'desk.apiErr.cargosHttpUrlRequired',
  'Provide companyId and/or reservationId for CaRGOS submission list': 'desk.apiErr.cargosListParams',
  'Only QUOTE reservations can be deleted; set status to CANCELLED instead': 'desk.apiErr.deleteQuoteOnly',
  'returnAt must be after pickupAt': 'desk.apiErr.returnAfterPickup',
  'Privacy notice version is required and must match the company register (B4).':
    'desk.apiErr.publicQuotePrivacyVersionRequired',
  'Vehicle does not belong to this company': 'desk.apiErr.vehicleWrongCompany',
  'Stations must belong to the same company as the reservation': 'desk.apiErr.stationsSameCompany',
  'Stations must belong to the same company as the vehicle class': 'desk.apiErr.quoteStationsSameCompanyAsClass',
  'Pickup or return station not found for quote': 'desk.apiErr.quoteStationNotFound',
  'from and to must be used together (ISO 8601)': 'desk.apiErr.fromToTogether',
  'companyId is required': 'desk.apiErr.companyIdRequired',
  'Customer not found for this company': 'desk.apiErr.customerNotForCompany',
  'Pickup or return station not found': 'desk.apiErr.stationNotFoundReservation',
  'Invalid date': 'desk.apiErr.invalidDate',
  'File is empty': 'desk.apiErr.fileEmpty',
  'File size exceeds 10MB': 'desk.apiErr.fileSizeExceeds10Mb',
  'Only PDF and JPEG, PNG, WebP images are allowed': 'desk.apiErr.customerDocMimeAllowed',
  'Only JPEG, PNG, WebP images are allowed': 'desk.apiErr.opsImageMimeAllowed',
  'Not a presigned S3 document': 'desk.apiErr.customerDocNotPresigned',
  'Document not found': 'desk.apiErr.customerDocNotFound',
  'file is required': 'desk.apiErr.customerDocFileRequired',
  'Invalid docType or retentionUntil': 'desk.apiErr.customerDocInvalidMeta',
  'User not found': 'desk.apiErr.userNotFound',
  'Only admin can create staff users': 'desk.apiErr.staffCreateAdminOnly',
  'Only admin can update staff': 'desk.apiErr.staffUpdateAdminOnly',
  'Cannot deactivate your own account': 'desk.apiErr.staffCannotDeactivateSelf',
  'Cannot change your own role away from ADMIN': 'desk.apiErr.staffCannotDemoteSelfAdmin',
  'Cannot change the only active admin’s role': 'desk.apiErr.staffCannotDemoteOnlyAdmin',
  'Cannot deactivate the only active admin': 'desk.apiErr.staffCannotDeactivateOnlyAdmin',
  'List vehicles only for your assigned station': 'desk.apiErr.agentVehicleListStation',
  'Reservation pickup must be at your assigned station': 'desk.apiErr.agentReservationPickupStation',
  'You can only query availability for your assigned station': 'desk.apiErr.agentAvailabilityStationScope',
  'Not allowed to create for another company': 'desk.apiErr.agentForbiddenCreateOtherCompany',
  'Not allowed to modify this company': 'desk.apiErr.agentForbiddenModifyOtherCompany',
  'Per-vehicle rent amounts apply only to FIXED_DAILY or FLAT_TRIP; use class pricing or clear amounts':
    'desk.apiErr.vehiclePricingUseClassOnly',
  'FIXED_DAILY requires rentOverrideDailyCents (≥ 0 cents per 24h day)':
    'desk.zod.vehicleFixedDailyNeedsOverride',
  'FIXED_DAILY cannot set flatTripRentCents': 'desk.zod.vehicleRemoveFlatForFixedDaily',
  'FLAT_TRIP requires flatTripRentCents (≥ 0 cents for the trip)': 'desk.zod.vehicleFlatTripNeedsAmount',
  'FLAT_TRIP cannot set rentOverrideDailyCents': 'desk.zod.vehicleRemoveOverrideForFlatTrip',
  'Vehicle class does not belong to the same company as the vehicle': 'desk.apiErr.vehicleClassWrongCompany',
  'Home station does not belong to the same company as the vehicle': 'desk.apiErr.vehicleHomeStationWrongCompany',
  'Reservation belongs to a different company': 'desk.apiErr.invoiceReservationCompany',
  'Credited invoice belongs to a different company': 'desk.apiErr.creditedWrongCompany',
  'Credited invoice not found': 'desk.apiErr.creditedInvoiceNotFound',
  'Can only issue credit notes against an ISSUED tax invoice': 'desk.apiErr.creditNoteIssuedOnly',
  'Credit notes can only be issued against an ISSUED tax invoice': 'desk.apiErr.creditNoteIssuedOnly',
  'Only DRAFT invoices can be updated': 'desk.apiErr.invoiceDraftUpdateOnly',
  'No fields to update': 'desk.apiErr.noFieldsToUpdate',
  'Not allowed to issue invoices': 'desk.apiErr.issueInvoiceDenied',
  'Only DRAFT documents can be issued': 'desk.apiErr.issueDraftOnly',
  'Credit note is missing credited invoice': 'desk.apiErr.creditMissingOriginal',
  'Not allowed to void invoices': 'desk.apiErr.voidInvoiceDenied',
  'Only ISSUED documents can be voided': 'desk.apiErr.voidIssuedOnly',
  'Not allowed to delete invoices': 'desk.apiErr.deleteInvoiceDenied',
  'Only DRAFT invoices can be deleted': 'desk.apiErr.deleteDraftOnly',
  'Cannot delete: referenced by a credit note draft': 'desk.apiErr.invoiceCreditReferenced',
  'SDI submission requires an ISSUED document (not draft or void)': 'desk.apiErr.sdiIssuedOnly',
  'Invalid callback authorization': 'desk.apiErr.sdiCallbackUnauthorized',
  'Set company sdiHttpUrl (Organization → SDI), or use MOCK / OFF adapter': 'desk.apiErr.sdiHttpOrMock',
  'An SDI handoff is already in progress or completed for this invoice': 'desk.apiErr.sdiAlreadyQueued',
  'SDI_CALLBACK_SECRET is not configured': 'desk.apiErr.sdiCallbackNotConfigured',
  'Provide companyId and/or invoiceId for SDI submission list': 'desk.apiErr.sdiListParams',
  'endsAt must be after startsAt': 'desk.apiErr.blockEndsAfterStart',
  '"from" must be before "to"': 'desk.apiErr.fromBeforeTo',
  'Vehicle class does not belong to the same company as the station': 'desk.apiErr.classStationCompany',
  'Invalid PEC email': 'desk.apiErr.invalidPecEmail',
  'Invalid Italian fiscal code (codice fiscale)': 'desk.apiErr.invalidItalianFiscal',
  'Invalid Italian VAT number (11 digits, IT-prefixed allowed)': 'desk.apiErr.invalidItalianVat',
  'Document upload is not complete; finish upload before verification':
    'desk.apiErr.customerDocUploadIncomplete',
  'Remove the initial password when sending an invite email': 'desk.apiErr.staffInvitePasswordConflict',
  'Cannot send staff invite: configure SMTP (e.g. SMTP_HOST, SMTP_FROM) and APP_PUBLIC_BASE_URL':
    'desk.apiErr.staffInviteMailNotConfigured',
  'Only admin can resend staff setup emails': 'desk.apiErr.staffSetupEmailAdminOnly',
  'Cannot send setup email to yourself': 'desk.apiErr.staffSetupEmailSelf',
  'Cannot send setup email to an inactive user': 'desk.apiErr.staffSetupEmailInactive',
  'This user has already signed in — use Forgot password instead of a setup email':
    'desk.apiErr.staffSetupEmailAlreadySignedIn',
  'Could not send invite email; the new user was not created. Try again or add staff without the email invite.':
    'desk.apiErr.staffInviteSendFailed',
  'Rental agreement must be SIGNED (create/sign agreement on this reservation).':
    'desk.handover.blocker.AGREEMENT_NOT_SIGNED',
  'CaRGOS: enqueue transmission and wait for success, or record an override (Branch/Admin) with a reason.':
    'desk.handover.blocker.CARGOS_REQUIRED',
  'Link a customer and upload at least one ID (driving licence, ID card, or passport) in customer documents.':
    'desk.handover.blocker.ID_DOCS_UPLOAD',
  'Handover requires a linked customer with at least one ID document (driving licence, ID card, or passport).':
    'desk.handover.blocker.ID_DOCS_LINK_CUSTOMER',
  'No free vehicle in this class for the selected station and time window. Choose another time or class.':
    'quote.apiErr.noVehicleClassWindow',
  'No free vehicle for one of the selected classes for this station and time window. Adjust the basket or trip.':
    'quote.apiErr.noVehicleBatchLine',
  'to must be on or after from': 'desk.apiErr.reconciliationFromToOrder',
  'Stripe is not configured (STRIPE_SECRET_KEY)': 'desk.apiErr.stripeNotConfigured',
  'Set a positive totalCents on the reservation before taking payment':
    'desk.apiErr.stripePositiveTotalRequired',
  'Only EUR currency is supported for Stripe in this v1 (extend mapping as needed)':
    'desk.apiErr.stripeEurOnly',
  'Stripe did not return a hosted checkout URL (check configuration)': 'desk.apiErr.stripeNoCheckoutUrl',
  'This booking is not in a state that accepts online rental payment':
    'desk.apiErr.stripePublicRentalState',
  'Will not take a deposit for a cancelled reservation': 'desk.apiErr.stripeDepositCancelledReservation',
  'Set amountCents on the request, or set defaultDepositCents on the vehicle class':
    'desk.apiErr.stripeDepositAmountOrClassDefault',
  'Release the existing uncaptured deposit hold or capture it before starting a new one':
    'desk.apiErr.stripeDepositHoldConflictUncaptured',
  'A deposit was already captured for this reservation in v1 (no second on-book hold yet)':
    'desk.apiErr.stripeDepositAlreadyCaptured',
  'No uncaptured deposit hold to capture (complete deposit checkout first)':
    'desk.apiErr.stripeDepositHoldNoneToCapture',
  'No capturable amount on deposit PaymentIntent': 'desk.apiErr.stripeDepositNoCapturable',
  'No uncaptured deposit hold to release (nothing to cancel on Stripe)':
    'desk.apiErr.stripeDepositHoldNoneToCancel',
  'Nothing to refund: rental is not recorded as paid': 'desk.apiErr.stripeRefundRentalNotPaid',
  'No Stripe Checkout session on file — this payment may not have been taken via the desk link':
    'desk.apiErr.stripeRefundNoCheckoutSession',
  'Could not resolve PaymentIntent for this Checkout session':
    'desk.apiErr.stripeRefundPiUnresolved',
  'Deposit is not in captured state (capture the hold first, or nothing to refund)':
    'desk.apiErr.stripeRefundDepositNotCaptured',
  'Invalid refund target': 'desk.apiErr.stripeInvalidRefundTarget',
  'Online payment is only available for web quotes': 'desk.apiErr.stripePublicQuoteOnly',
  'This reservation is already recorded as paid': 'desk.apiErr.reservationAlreadyPaid',
  'Email does not match this booking': 'desk.apiErr.publicBookingEmailMismatch',
  'Reservation not found': 'desk.apiErr.reservationNotFound',

  'Failed to reserve invoice number': 'desk.apiErr.invoiceNumberReserveFailed',
  'A customer with this email already exists for this company': 'desk.apiErr.customerEmailExists',
  'A privacy notice with this version already exists for this company': 'desk.apiErr.companyPrivacyNoticeExists',
  'License plate must be unique within the company': 'desk.apiErr.licensePlateUnique',
  'Cannot delete class: vehicles still reference it': 'desk.apiErr.classDeleteHasVehicles',
  'Vehicle class code must be unique within the company': 'desk.apiErr.classCodeUnique',
  'Calendar block overlaps an existing block for this vehicle': 'desk.apiErr.calendarBlockOverlap',
  'A rental agreement already exists for this reservation': 'desk.apiErr.agreementAlreadyExists',
  'No rental agreement for this reservation yet': 'desk.apiErr.agreementNoneYet',
  'Only DRAFT agreements can be edited': 'desk.apiErr.agreementEditDraftOnly',
  'Only DRAFT agreements can be signed': 'desk.apiErr.agreementSignDraftOnly',
  'Only DRAFT agreements can be voided': 'desk.apiErr.agreementVoidDraftOnly',
  'Cannot upload to a voided agreement': 'desk.apiErr.agreementUploadVoided',
  'Attachment not found': 'desk.apiErr.agreementAttachmentNotFound',
  'Not a presigned S3 attachment': 'desk.apiErr.agreementNotPresignedS3',
  'Not a local file': 'desk.apiErr.agreementNotLocalFile',
  'Remove attachments only while the agreement is DRAFT (or use admin tools later)':
    'desk.apiErr.agreementRemoveAttachmentsDraftOnly',
  'S3 is not configured': 'desk.apiErr.s3NotConfigured',
  'Empty object body': 'desk.apiErr.s3EmptyObjectBody',
  'Vehicle is not available for rental (fleet status)': 'desk.apiErr.vehicleFleetUnavailable',
  'Rental window overlaps a calendar block (e.g. maintenance) on this vehicle':
    'desk.apiErr.reservationCalendarOverlap',
  'Presigned upload is only available when STORAGE_MODE=s3': 'desk.apiErr.opsPresignS3Only',
  'Not in S3 mode': 'desk.apiErr.opsNotS3',
  'Not a presigned S3 upload': 'desk.apiErr.opsNotPresignedUpload',
  'Object not found in storage; upload may have failed or expired': 'desk.apiErr.opsStorageObjectMissing',
  'Uploaded file size is invalid': 'desk.apiErr.opsUploadedSizeInvalid',
  'Multipart upload to API is disabled when STORAGE_MODE=s3; use presigned upload from the client':
    'desk.apiErr.opsMultipartDisabledS3',
  'Invalid file': 'desk.apiErr.opsInvalidFile',
  'Photo not found': 'desk.apiErr.opsPhotoNotFound',
  'Upload not completed yet': 'desk.apiErr.opsUploadIncomplete',
  'File missing on disk': 'desk.apiErr.opsFileMissingDisk',
  'Set query ?phase=HANDOVER or ?phase=RETURN': 'desk.apiErr.opsPhaseQueryRequired',
  'Missing file (multipart field name: file)': 'desk.apiErr.opsMissingMultipartFile',
  'Not allowed': 'desk.apiErr.notAllowedGeneric',
  'STRIPE_WEBHOOK_SECRET is not set': 'desk.apiErr.stripeWebhookSecretMissing',
  'Raw body is required (enable rawBody in Nest or JSON verify middleware)':
    'desk.apiErr.stripeWebhookRawBody',
  'Missing stripe-signature header': 'desk.apiErr.stripeWebhookSignatureHeader',

  'Password must be at least 12 characters': 'desk.zod.passwordMin12',
  'Password must be at most 128 characters': 'desk.zod.passwordMax128',
  'Password must contain a lowercase letter': 'desk.zod.passwordLower',
  'Password must contain an uppercase letter': 'desk.zod.passwordUpper',
  'Password must contain a number': 'desk.zod.passwordDigit',
  'Password must contain a special character (e.g. !@#$%^&*)': 'desk.zod.passwordSpecial',
  'Provide exactly one of totp or backupCode': 'desk.zod.mfaOneOf',
  'Provide at least one of role, stationId, isActive': 'desk.zod.staffPatchOneField',
  'Do not set rent amounts when using class pricing': 'desk.zod.vehicleNoManualRentWithClass',
  'FIXED_DAILY requires rentOverrideDailyCents (cents per 24h day, ≥ 0)':
    'desk.zod.vehicleFixedDailyNeedsOverride',
  'Remove flat trip amount for FIXED_DAILY mode': 'desk.zod.vehicleRemoveFlatForFixedDaily',
  'FLAT_TRIP requires flatTripRentCents (gross rent for trip, ≥ 0)': 'desk.zod.vehicleFlatTripNeedsAmount',
  'Remove daily override for FLAT_TRIP mode': 'desk.zod.vehicleRemoveOverrideForFlatTrip',
  'Provide customerId or all of customerName, customerEmail, and customerPhone':
    'desk.zod.reservationCustomerOrContact',
  'Omit totalCents to use auto total (rent + one-way + extras), or do not add extra line items with a manual total':
    'desk.zod.reservationTotalVsExtrasCreate',
  'Omit totalCents when adding extra line items; you may set totalCents with empty or omitted extra lines':
    'desk.zod.reservationTotalVsExtrasUpdate',
  'odometerInKm must be greater than or equal to odometerOutKm when both are set':
    'desk.zod.reservationOdometerOrder',
  'creditedInvoiceId is required for CREDIT_NOTE': 'desk.zod.invoiceCreditIdRequired',
  'creditedInvoiceId only allowed for CREDIT_NOTE': 'desk.zod.invoiceCreditIdOnlyForCredit',
  'pickupStationId and returnStationId must both be set or both omitted': 'desk.zod.stationsBothOrNeither',
  'Each vehicle class may appear only once in the basket': 'desk.zod.quoteBasketUniqueClass',
  '`from` must be on or before `to`': 'desk.zod.reportFromBeforeTo',
  'validFrom must be on or before validTo': 'desk.zod.seasonalFromBeforeTo',
  'Select at least one of applyName, applyFiscalCode, appendDetailsToNotes':
    'desk.zod.ocrApplyOneField',
};

export const HANDOVER_BLOCKER_KEYS: Record<string, PublicMessageKey> = {
  AGREEMENT_NOT_SIGNED: 'desk.handover.blocker.AGREEMENT_NOT_SIGNED',
  CARGOS_REQUIRED: 'desk.handover.blocker.CARGOS_REQUIRED',
  CARGOS_ENQUEUE_CUTOFF: 'desk.handover.blocker.CARGOS_ENQUEUE_CUTOFF',
  ID_DOCS_UPLOAD: 'desk.handover.blocker.ID_DOCS_UPLOAD',
  ID_DOCS_LINK_CUSTOMER: 'desk.handover.blocker.ID_DOCS_LINK_CUSTOMER',
};

export const RETURN_BLOCKER_KEYS: Record<string, PublicMessageKey> = {
  ODOMETER_IN_REQUIRED: 'desk.return.blocker.ODOMETER_IN_REQUIRED',
  RETURN_CHECKLIST_INCOMPLETE: 'desk.return.blocker.RETURN_CHECKLIST_INCOMPLETE',
  FUEL_IN_REQUIRED: 'desk.return.blocker.FUEL_IN_REQUIRED',
};

const API_BLOCKER_KEYS: Record<string, PublicMessageKey> = {
  ...HANDOVER_BLOCKER_KEYS,
  ...RETURN_BLOCKER_KEYS,
};

function extractBlockerCodes(j: Record<string, unknown>): string[] | null {
  const top = j.blockerCodes;
  if (Array.isArray(top) && top.length > 0 && top.every((x) => typeof x === 'string')) {
    return top as string[];
  }
  const m = j.message;
  if (m !== null && typeof m === 'object' && !Array.isArray(m)) {
    const inner = (m as Record<string, unknown>).blockerCodes;
    if (Array.isArray(inner) && inner.length > 0 && inner.every((x) => typeof x === 'string')) {
      return inner as string[];
    }
  }
  return null;
}

function translateBlockers(codes: string[], locale: ReturnType<typeof tryParseLocaleCookie>): string {
  return codes
    .map((c) => {
      const k = API_BLOCKER_KEYS[c];
      return k ? publicT(locale, k) : c;
    })
    .join(' ');
}

const ZOD_EN_TO_KEY: Record<string, PublicMessageKey> = {
  Required: 'desk.zod.required',
  'Invalid email': 'desk.zod.invalidEmail',
  'Invalid uuid': 'desk.zod.invalidUuid',
  'Invalid url': 'desk.zod.invalidUrl',
  'Invalid URL': 'desk.zod.invalidUrl',
  'Number must be greater than or equal to 1': 'desk.zod.numberGte1',
};

function translateIssueDetail(raw: string, locale: ReturnType<typeof tryParseLocaleCookie>): string {
  const t = raw.trim();
  if (t.startsWith('Unrecognized key(s) in object:')) {
    return publicT(locale, 'desk.zod.strictObject');
  }

  const captureRange = t.match(
    /^Capture amount must be between (\d+) and (\d+) cents \(remaining hold\)$/,
  );
  if (captureRange) {
    return publicT(locale, 'desk.apiErr.stripeDepositCaptureRange')
      .replace('{min}', captureRange[1]!)
      .replace('{max}', captureRange[2]!);
  }

  const creditExceeds = t.match(
    /^Credit note total \((\d+) minor units\) exceeds remaining creditable amount on (.+) \((\d+) minor units left, incl\. VAT\)$/,
  );
  if (creditExceeds) {
    return publicT(locale, 'desk.apiErr.creditNoteExceedsRemaining')
      .replace('{noteTotal}', creditExceeds[1]!)
      .replace('{ref}', creditExceeds[2]!.trim())
      .replace('{remaining}', creditExceeds[3]!);
  }

  const vehicleBusy = t.match(/^Vehicle already has an active reservation in this period \((.+)\)$/);
  if (vehicleBusy) {
    return publicT(locale, 'desk.apiErr.vehicleActiveReservationPeriod').replace(
      '{id}',
      vehicleBusy[1]!.trim(),
    );
  }

  const sdiCb = t.match(
    /^Submission (.+) is (.+); callbacks only while PENDING or PROCESSING$/,
  );
  if (sdiCb) {
    return publicT(locale, 'desk.apiErr.sdiCallbackBadState')
      .replace('{id}', sdiCb[1]!.trim())
      .replace('{status}', sdiCb[2]!.trim());
  }

  const notFoundWithId = t.match(/^Reservation not found:\s*(.+)$/);
  if (notFoundWithId) {
    return publicT(locale, 'desk.apiErr.reservationNotFoundWithId').replace(
      '{id}',
      notFoundWithId[1]!.trim(),
    );
  }

  const invoiceNotFoundWithId = t.match(/^Invoice not found:\s*(.+)$/);
  if (invoiceNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.invoiceNotFoundWithId').replace(
      '{id}',
      invoiceNotFoundWithId[1]!.trim(),
    );
  }

  const vehicleNotFoundWithId = t.match(/^Vehicle not found:\s*(.+)$/);
  if (vehicleNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.vehicleNotFoundWithId').replace(
      '{id}',
      vehicleNotFoundWithId[1]!.trim(),
    );
  }

  const vehicleClassNotFoundWithId = t.match(/^Vehicle class not found:\s*(.+)$/);
  if (vehicleClassNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.vehicleClassNotFoundWithId').replace(
      '{id}',
      vehicleClassNotFoundWithId[1]!.trim(),
    );
  }

  const calendarBlockNotFoundWithId = t.match(/^Calendar block not found:\s*(.+)$/);
  if (calendarBlockNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.calendarBlockNotFoundWithId').replace(
      '{id}',
      calendarBlockNotFoundWithId[1]!.trim(),
    );
  }

  const rentalAgreementNotFoundWithId = t.match(/^Rental agreement not found:\s*(.+)$/);
  if (rentalAgreementNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.rentalAgreementNotFoundWithId').replace(
      '{id}',
      rentalAgreementNotFoundWithId[1]!.trim(),
    );
  }

  const customerNotFoundWithId = t.match(/^Customer not found:\s*(.+)$/);
  if (customerNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.customerNotFoundWithId').replace(
      '{id}',
      customerNotFoundWithId[1]!.trim(),
    );
  }

  const companyNotFoundWithId = t.match(/^Company not found:\s*(.+)$/);
  if (companyNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.companyNotFoundWithId').replace(
      '{id}',
      companyNotFoundWithId[1]!.trim(),
    );
  }

  const stationNotFoundWithId = t.match(/^Station not found:\s*(.+)$/);
  if (stationNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.stationNotFoundWithId').replace(
      '{id}',
      stationNotFoundWithId[1]!.trim(),
    );
  }

  const userNotFoundWithId = t.match(/^User not found:\s*(.+)$/);
  if (userNotFoundWithId) {
    return publicT(locale, 'desk.apiErr.userNotFoundWithId').replace(
      '{id}',
      userNotFoundWithId[1]!.trim(),
    );
  }

  const sdiSubmissionNotFound = t.match(/^SDI submission not found:\s*(.+)$/);
  if (sdiSubmissionNotFound) {
    return publicT(locale, 'desk.apiErr.sdiSubmissionNotFoundWithId').replace(
      '{id}',
      sdiSubmissionNotFound[1]!.trim(),
    );
  }

  const cargosSubmissionNotFound = t.match(/^CaRGOS submission not found:\s*(.+)$/);
  if (cargosSubmissionNotFound) {
    return publicT(locale, 'desk.apiErr.cargosSubmissionNotFoundWithId').replace(
      '{id}',
      cargosSubmissionNotFound[1]!.trim(),
    );
  }

  const stripePrefixes: { prefix: string; key: PublicMessageKey }[] = [
    { prefix: 'Stripe retrieve failed: ', key: 'desk.apiErr.stripeRetrieveFailed' },
    { prefix: 'Stripe capture failed: ', key: 'desk.apiErr.stripeCaptureFailed' },
    { prefix: 'Stripe cancel failed: ', key: 'desk.apiErr.stripeCancelFailed' },
    { prefix: 'Stripe refund failed: ', key: 'desk.apiErr.stripeRefundFailed' },
  ];
  for (const { prefix, key } of stripePrefixes) {
    if (t.startsWith(prefix)) {
      return publicT(locale, key).replace('{detail}', t.slice(prefix.length));
    }
  }

  const z = ZOD_EN_TO_KEY[t];
  if (z) {
    return publicT(locale, z);
  }
  const k = STRING_TO_KEY[t];
  return k ? publicT(locale, k) : raw;
}

function isZodFlatten(msg: unknown): msg is Record<string, unknown> {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg)) {
    return false;
  }
  return 'fieldErrors' in msg || 'formErrors' in msg;
}

function formatZodFlatten(
  msg: Record<string, unknown>,
  locale: ReturnType<typeof tryParseLocaleCookie>,
): string {
  const lines: string[] = [];
  const fe = msg.formErrors;
  if (Array.isArray(fe)) {
    for (const x of fe) {
      if (typeof x === 'string' && x.trim()) {
        lines.push(translateIssueDetail(x, locale));
      }
    }
  }
  const ferr = msg.fieldErrors;
  if (ferr !== null && typeof ferr === 'object' && !Array.isArray(ferr)) {
    for (const [field, errs] of Object.entries(ferr as Record<string, unknown>)) {
      if (!Array.isArray(errs)) continue;
      const parts = errs
        .filter((x): x is string => typeof x === 'string')
        .map((p) => translateIssueDetail(p, locale));
      if (parts.length) {
        lines.push(`${field}: ${parts.join(', ')}`);
      }
    }
  }
  if (!lines.length) {
    return publicT(locale, 'desk.apiErr.validation');
  }
  return lines.join('; ');
}

function isBareFieldErrorMap(msg: Record<string, unknown>): boolean {
  if ('formErrors' in msg || 'fieldErrors' in msg) {
    return false;
  }
  const keys = Object.keys(msg);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((k) => {
    const v = msg[k];
    return Array.isArray(v) && v.every((x) => typeof x === 'string');
  });
}

function formatBareFieldErrors(
  msg: Record<string, unknown>,
  locale: ReturnType<typeof tryParseLocaleCookie>,
): string {
  const lines: string[] = [];
  for (const [field, errs] of Object.entries(msg)) {
    if (!Array.isArray(errs)) continue;
    const parts = errs
      .filter((x): x is string => typeof x === 'string')
      .map((p) => translateIssueDetail(p, locale));
    if (parts.length) {
      lines.push(`${field}: ${parts.join(', ')}`);
    }
  }
  if (!lines.length) {
    return publicT(locale, 'desk.apiErr.validation');
  }
  return lines.join('; ');
}

/** Map Nest / JSON error body to a user-facing string using the public locale cookie. */
export function translateDeskApiError(raw: string): string {
  const locale = tryParseLocaleCookie();
  const trimmed = raw.trim();

  const direct = STRING_TO_KEY[trimmed];
  if (direct) {
    return publicT(locale, direct);
  }

  if (!trimmed.startsWith('{')) {
    return trimmed || publicT(locale, 'desk.apiErr.generic');
  }

  try {
    const j = JSON.parse(trimmed) as Record<string, unknown>;
    const blockers = extractBlockerCodes(j);
    if (blockers) {
      return translateBlockers(blockers, locale);
    }

    const msg = j.message;
    if (typeof msg === 'string') {
      return translateIssueDetail(msg, locale);
    }
    if (Array.isArray(msg)) {
      const parts = msg.filter((x): x is string => typeof x === 'string');
      return parts.map((p) => translateIssueDetail(p, locale)).join('; ');
    }
    if (msg !== null && typeof msg === 'object' && !Array.isArray(msg)) {
      const mobj = msg as Record<string, unknown>;
      const nestedBlockers = extractBlockerCodes({ message: mobj });
      if (nestedBlockers) {
        return translateBlockers(nestedBlockers, locale);
      }
      if (isZodFlatten(msg)) {
        return formatZodFlatten(mobj, locale);
      }
      if (isBareFieldErrorMap(mobj)) {
        return formatBareFieldErrors(mobj, locale);
      }
      return publicT(locale, 'desk.apiErr.validation');
    }
  } catch {
    return trimmed || publicT(locale, 'desk.apiErr.generic');
  }

  return trimmed || publicT(locale, 'desk.apiErr.generic');
}

/**
 * Localize a line persisted from integrations (SDI/CaRGOS/etc.): plain API English, or a JSON
 * error body. Plain text runs through the same detail rules as nested `message` fields.
 */
export function translateDeskApiErrorLine(raw: string): string {
  const locale = tryParseLocaleCookie();
  const trimmed = raw.trim();
  if (!trimmed) {
    return publicT(locale, 'desk.apiErr.generic');
  }
  if (trimmed.startsWith('{')) {
    return translateDeskApiError(trimmed);
  }
  return translateIssueDetail(trimmed, locale);
}

/** Empty body on error responses (e.g. CDN) — still localize by status where useful. */
export function translateHttpErrorWithoutBody(status: number): string {
  const locale = tryParseLocaleCookie();
  if (status === 429) {
    return publicT(locale, 'public.apiErr.rateLimit');
  }
  if (status >= 500) {
    return publicT(locale, 'public.apiErr.server');
  }
  return publicT(locale, 'public.apiErr.http').replace('{status}', String(status));
}
