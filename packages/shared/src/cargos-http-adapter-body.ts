import {
  CARGOS_HTTP_PAYLOAD_SPEC_VERSION,
  type CargosHttpAdapterPayload,
} from './cargos-http-payload';

/** Narrow shape returned from Prisma for CaRGOS HTTP POST (see `buildCargosHttpAdapterBody`). */
export type ReservationForCargosHttp = {
  id: string;
  pickupAt: Date;
  returnAt: Date;
  status: string;
  source: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  company: { name: string };
  pickupStation: { name: string; code: string; cargosLocationCode: string | null };
  vehicle: {
    id: string;
    licensePlate: string;
    modelLabel: string | null;
    vin: string | null;
    vehicleType: string;
    vehicleClass: { code: string; name: string };
  };
  customer: {
    id: string;
    name: string;
    email: string;
    fiscalCode: string | null;
    vatNumber: string | null;
  } | null;
  rentalAgreement: {
    id: string;
    status: string;
    agreementTemplateVersion: string | null;
    signedAt: Date | null;
  } | null;
};

export function buildCargosHttpAdapterBody(
  pending: { id: string; companyId: string },
  resRow: ReservationForCargosHttp,
  environment: 'TEST' | 'PRODUCTION',
): CargosHttpAdapterPayload {
  return {
    specVersion: CARGOS_HTTP_PAYLOAD_SPEC_VERSION,
    submissionId: pending.id,
    companyId: pending.companyId,
    companyName: resRow.company.name,
    reservationId: resRow.id,
    environment,
    pickupAt: resRow.pickupAt.toISOString(),
    returnAt: resRow.returnAt.toISOString(),
    reservationStatus: resRow.status,
    reservationSource: resRow.source,
    customerOnReservation: {
      name: resRow.customerName,
      email: resRow.customerEmail,
      phone: resRow.customerPhone,
    },
    customerProfile: resRow.customer
      ? {
          id: resRow.customer.id,
          name: resRow.customer.name,
          email: resRow.customer.email,
          fiscalCode: resRow.customer.fiscalCode,
          vatNumber: resRow.customer.vatNumber,
        }
      : null,
    vehicle: {
      id: resRow.vehicle.id,
      licensePlate: resRow.vehicle.licensePlate,
      modelLabel: resRow.vehicle.modelLabel,
      vin: resRow.vehicle.vin,
      vehicleType: resRow.vehicle.vehicleType,
      vehicleClassCode: resRow.vehicle.vehicleClass.code,
      vehicleClassName: resRow.vehicle.vehicleClass.name,
    },
    station: {
      code: resRow.pickupStation.code,
      name: resRow.pickupStation.name,
      cargosLocationCode: resRow.pickupStation.cargosLocationCode,
    },
    rentalAgreement: resRow.rentalAgreement
      ? {
          id: resRow.rentalAgreement.id,
          status: resRow.rentalAgreement.status,
          agreementTemplateVersion: resRow.rentalAgreement.agreementTemplateVersion,
          signedAt: resRow.rentalAgreement.signedAt?.toISOString() ?? null,
        }
      : null,
    customerName: resRow.customerName,
    stationCode: resRow.pickupStation.code,
    stationCargosLocationCode: resRow.pickupStation.cargosLocationCode,
  };
}
