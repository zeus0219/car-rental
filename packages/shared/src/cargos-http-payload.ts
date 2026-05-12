/** Increment when the worker POST body shape changes (middleware should read `specVersion`). */
export const CARGOS_HTTP_PAYLOAD_SPEC_VERSION = 1 as const;

/**
 * JSON body the worker POSTs to `company.cargosHttpUrl` when `cargosAdapter === 'HTTP'`.
 * Dates are ISO 8601 strings; `null` fields mean missing / not linked in DB.
 */
export type CargosHttpAdapterPayload = {
  specVersion: typeof CARGOS_HTTP_PAYLOAD_SPEC_VERSION;
  submissionId: string;
  companyId: string;
  companyName: string;
  reservationId: string;
  environment: 'TEST' | 'PRODUCTION';
  pickupAt: string;
  returnAt: string;
  reservationStatus: string;
  reservationSource: string;
  customerOnReservation: {
    name: string;
    email: string;
    phone: string;
  };
  customerProfile: null | {
    id: string;
    name: string;
    email: string;
    fiscalCode: string | null;
    vatNumber: string | null;
  };
  vehicle: {
    id: string;
    licensePlate: string;
    modelLabel: string | null;
    vin: string | null;
    vehicleType: string;
    vehicleClassCode: string;
    vehicleClassName: string;
  };
  station: {
    code: string;
    name: string;
    cargosLocationCode: string | null;
  };
  rentalAgreement: null | {
    id: string;
    status: string;
    agreementTemplateVersion: string | null;
    signedAt: string | null;
  };
  /** @deprecated Prefer `customerOnReservation.name` — retained for existing middleware. */
  customerName: string;
  /** @deprecated Prefer `station.code`. */
  stationCode: string;
  /** @deprecated Prefer `station.cargosLocationCode`. */
  stationCargosLocationCode: string | null;
};
