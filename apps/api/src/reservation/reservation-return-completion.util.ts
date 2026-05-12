import { BadRequestException } from '@nestjs/common';

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

export function returnRequireOdometerIn(): boolean {
  return envOn('RETURN_REQUIRE_ODOMETER_IN', false);
}

export function returnRequireReturnChecklist(): boolean {
  return envOn('RETURN_REQUIRE_RETURN_CHECKLIST', false);
}

export function returnRequireFuelIn(): boolean {
  return envOn('RETURN_REQUIRE_FUEL_IN', false);
}

/** Stable codes for desk `translateDeskApiError` / `returnCompletionGate`. */
export type ReturnBlockerCode =
  | 'ODOMETER_IN_REQUIRED'
  | 'RETURN_CHECKLIST_INCOMPLETE'
  | 'FUEL_IN_REQUIRED';

export type ReturnCompletionGateView = {
  /** True when at least one RETURN_REQUIRE_* env flag is on. */
  relevant: boolean;
  ready: boolean;
  blockerCodes: ReturnBlockerCode[];
  requireOdometerIn: boolean;
  requireReturnChecklist: boolean;
  requireFuelIn: boolean;
  odometerInOk: boolean;
  checklistOk: boolean;
  fuelInOk: boolean;
};

/** `returnChecklistJson` / PATCH body shape: `{ items: { key, label, ok }[] }`. */
export function isReturnChecklistComplete(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || raw === null || !('items' in raw)) {
    return false;
  }
  const items = (raw as { items: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }
  return items.every(
    (it) => it && typeof it === 'object' && 'ok' in it && (it as { ok: unknown }).ok === true,
  );
}

export function fuelInPresent(fuelInPercent: number | null | undefined): boolean {
  return (
    fuelInPercent != null &&
    Number.isFinite(fuelInPercent) &&
    fuelInPercent >= 0 &&
    fuelInPercent <= 100
  );
}

export function odometerInPresent(odometerInKm: number | null | undefined): boolean {
  return odometerInKm != null && Number.isFinite(odometerInKm) && odometerInKm >= 0;
}

export function computeReturnCompletionGate(input: {
  odometerInKm: number | null;
  fuelInPercent: number | null;
  returnChecklistJson: unknown;
}): ReturnCompletionGateView {
  const requireOdometerIn = returnRequireOdometerIn();
  const requireReturnChecklist = returnRequireReturnChecklist();
  const requireFuelIn = returnRequireFuelIn();
  const relevant = requireOdometerIn || requireReturnChecklist || requireFuelIn;

  const odometerInOk = !requireOdometerIn || odometerInPresent(input.odometerInKm);
  const checklistOk = !requireReturnChecklist || isReturnChecklistComplete(input.returnChecklistJson);
  const fuelInOk = !requireFuelIn || fuelInPresent(input.fuelInPercent);

  const blockerCodes: ReturnBlockerCode[] = [];
  if (requireOdometerIn && !odometerInPresent(input.odometerInKm)) {
    blockerCodes.push('ODOMETER_IN_REQUIRED');
  }
  if (requireReturnChecklist && !isReturnChecklistComplete(input.returnChecklistJson)) {
    blockerCodes.push('RETURN_CHECKLIST_INCOMPLETE');
  }
  if (requireFuelIn && !fuelInPresent(input.fuelInPercent)) {
    blockerCodes.push('FUEL_IN_REQUIRED');
  }

  return {
    relevant,
    ready: blockerCodes.length === 0,
    blockerCodes,
    requireOdometerIn,
    requireReturnChecklist,
    requireFuelIn,
    odometerInOk,
    checklistOk,
    fuelInOk,
  };
}

export function assertReturnCompletionGates(input: {
  odometerInKm: number | null;
  fuelInPercent: number | null;
  returnChecklistJson: unknown;
}): void {
  const g = computeReturnCompletionGate(input);
  if (!g.ready) {
    throw new BadRequestException({
      message: 'RETURN_BLOCKED',
      blockerCodes: g.blockerCodes,
    });
  }
}
