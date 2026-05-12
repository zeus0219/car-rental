import {
  vehicleRentPricingModeValues,
  vehicleStatusValues,
  vehicleTypeValues,
} from '@car-rental/shared';
import type { PublicMessageKey } from './public-messages';

export function formatDeskVehicleType(type: string, t: (key: PublicMessageKey) => string): string {
  if ((vehicleTypeValues as readonly string[]).includes(type)) {
    return t(`desk.fleet.vtype.${type}` as PublicMessageKey);
  }
  return type;
}

export function formatDeskVehicleStatus(status: string, t: (key: PublicMessageKey) => string): string {
  if ((vehicleStatusValues as readonly string[]).includes(status)) {
    return t(`desk.fleet.vstatus.${status}` as PublicMessageKey);
  }
  return status;
}

export function formatDeskVehicleRentMode(
  mode: string,
  t: (key: PublicMessageKey) => string,
): string {
  if ((vehicleRentPricingModeValues as readonly string[]).includes(mode)) {
    return t(`desk.fleet.vehicle.rentMode.${mode}` as PublicMessageKey);
  }
  return mode;
}
