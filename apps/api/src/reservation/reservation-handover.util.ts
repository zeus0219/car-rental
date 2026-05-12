import { BadRequestException } from '@nestjs/common';

/** Matches `CustomerDocumentType` in Prisma; kept as strings so this module typechecks if `prisma generate` is pending. */
export const ID_STYLE_DOCUMENT_TYPES = ['DRIVING_LICENSE', 'ID_CARD', 'PASSPORT'] as const;

/** Stable codes for client i18n (desk); API errors use English derived from these. */
export type HandoverBlockerCode =
  | 'AGREEMENT_NOT_SIGNED'
  | 'CARGOS_REQUIRED'
  | 'CARGOS_ENQUEUE_CUTOFF'
  | 'ID_DOCS_UPLOAD'
  | 'ID_DOCS_LINK_CUSTOMER';

export type HandoverGateView = {
  ready: boolean;
  blockerCodes: HandoverBlockerCode[];
  agreementSigned: boolean;
  cargosOk: boolean;
  cargosOverridden: boolean;
  idDocumentsOk: boolean;
  requireIdDocuments: boolean;
  /** When set with `requireIdDocuments`, at least one ID-style doc must have `verifiedAt` (staff review). */
  requireVerifiedIdDocuments: boolean;
  requireCargos: boolean;
  /** True when env requires CaRGOS and company is in scope with adapter not OFF (handover must see a success or override) */
  cargosTransmissionRequired: boolean;
  requireSignedAgreement: boolean;
};

function envOn(name: string, defaultOn: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) {
    return defaultOn;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') {
    return false;
  }
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') {
    return true;
  }
  return defaultOn;
}

/** When true with `HANDOVER_REQUIRE_ID_DOCUMENTS`, handover counts only **verified** ID-style documents. */
export function handoverRequiresVerifiedIdDocuments(): boolean {
  return envOn('HANDOVER_REQUIRE_VERIFIED_ID_DOCUMENTS', false);
}

type GateReservationSlice = {
  id: string;
  companyId: string;
  status: string;
  pickupAt: Date;
  /** Company D5 policy: minutes before `pickupAt` by which CaRGOS should be queued (`null`/`0` = no cutoff in software). */
  cargosCutoffMinutesBeforePickup: number | null;
  customerId: string | null;
  rentalAgreement: { status: string } | null;
  cargosHandoverOverrideAt: Date | null;
  cargosSubmissions: { status: string }[];
};

/** `true` when current time is past `pickupAt − cutoffMinutes` — too late to enqueue per company policy. */
export function isPastCargosEnqueueCutoff(
  pickupAt: Date,
  cutoffMinutes: number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (cutoffMinutes == null || cutoffMinutes <= 0) {
    return false;
  }
  const deadlineMs = pickupAt.getTime() - cutoffMinutes * 60_000;
  return now.getTime() > deadlineMs;
}

type CompanyCargosPolicy = {
  cargosInScope: boolean;
  cargosAdapter: 'MOCK' | 'HTTP' | 'OFF';
};

type OverrideIntent = { kind: 'unchanged' } | { kind: 'clear' } | { kind: 'set' };

/**
 * `overrideIntent` describes PATCH body for handover override in the same request as a status change.
 */
export function computeHandoverGate(
  r: GateReservationSlice,
  completedIdStyleDocCount: number,
  companyCargos: CompanyCargosPolicy,
  overrideIntent: OverrideIntent = { kind: 'unchanged' },
): HandoverGateView {
  const requireSignedAgreement = envOn('HANDOVER_REQUIRE_SIGNED_AGREEMENT', true);
  const requireCargos = envOn('HANDOVER_REQUIRE_CARGOS', true);
  const requireIdDocuments = envOn('HANDOVER_REQUIRE_ID_DOCUMENTS', false);
  const requireVerifiedIdDocuments = envOn('HANDOVER_REQUIRE_VERIFIED_ID_DOCUMENTS', false);

  const agreementSigned = r.rentalAgreement?.status === 'SIGNED';
  const hasResolvedCargos = r.cargosSubmissions.some(
    (s) => s.status === 'MOCK_SENT' || s.status === 'SKIPPED',
  );
  let cargosOverridden = r.cargosHandoverOverrideAt != null;
  if (overrideIntent.kind === 'clear') {
    cargosOverridden = false;
  } else if (overrideIntent.kind === 'set') {
    cargosOverridden = true;
  }
  const cargosTransmissionRequired =
    requireCargos && companyCargos.cargosInScope && companyCargos.cargosAdapter !== 'OFF';
  const cargosOk = !cargosTransmissionRequired || hasResolvedCargos || cargosOverridden;
  const idDocumentsOk = !requireIdDocuments || (r.customerId != null && completedIdStyleDocCount > 0);

  const blockerCodes: HandoverBlockerCode[] = [];
  if (requireSignedAgreement && !agreementSigned) {
    blockerCodes.push('AGREEMENT_NOT_SIGNED');
  }
  if (cargosTransmissionRequired && !hasResolvedCargos && !cargosOverridden) {
    if (isPastCargosEnqueueCutoff(r.pickupAt, r.cargosCutoffMinutesBeforePickup)) {
      blockerCodes.push('CARGOS_ENQUEUE_CUTOFF');
    } else {
      blockerCodes.push('CARGOS_REQUIRED');
    }
  }
  if (requireIdDocuments && !idDocumentsOk) {
    blockerCodes.push(
      r.customerId ? 'ID_DOCS_UPLOAD' : 'ID_DOCS_LINK_CUSTOMER',
    );
  }

  const ready = blockerCodes.length === 0;
  return {
    ready,
    blockerCodes,
    agreementSigned,
    cargosOk,
    cargosOverridden: cargosOverridden,
    idDocumentsOk,
    requireIdDocuments,
    requireVerifiedIdDocuments,
    requireCargos,
    cargosTransmissionRequired,
    requireSignedAgreement,
  };
}

export function assertInProgressHandoverGates(
  r: GateReservationSlice,
  completedIdStyleDocCount: number,
  companyCargos: CompanyCargosPolicy,
  overrideIntent: OverrideIntent,
): void {
  const g = computeHandoverGate(r, completedIdStyleDocCount, companyCargos, overrideIntent);
  if (!g.ready) {
    throw new BadRequestException({
      message: 'HANDOVER_BLOCKED',
      blockerCodes: g.blockerCodes,
    });
  }
}
