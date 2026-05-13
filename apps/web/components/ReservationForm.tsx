'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createReservationSchema,
  reservationStatusValues,
  updateReservationSchema,
} from '@car-rental/shared';
import { apiJson, apiFetch } from '../lib/api';
import { translateDeskApiError, translateDeskApiErrorLine, HANDOVER_BLOCKER_KEYS, RETURN_BLOCKER_KEYS } from '../lib/desk-api-error-i18n';
import { formatDeskCargosSubmissionStatus } from '../lib/desk-cargos-submission-status';
import { formatDepositHoldStatus } from '../lib/desk-deposit-hold-label';
import { formatDeskReservationStatus } from '../lib/desk-reservation-status-label';
import { formatRentalAgreementStatus } from '../lib/desk-rental-agreement-status';
import { fetchPresignedPut } from '../lib/presigned-put';
import { clearAccessToken } from '../lib/auth-storage';
import type { Me } from '../lib/me-types';
import type { PublicMessageKey } from '../lib/public-messages';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { ReservationOpsPanel } from './ReservationOpsPanel';

type StationRow = { id: string; name: string; code: string };
type VClass = { id: string; name: string; code: string };
type VehicleListItem = {
  id: string;
  licensePlate: string;
  modelLabel: string | null;
  vehicleClass: { name: string; code: string };
};

type AvailabilityPayload = {
  from: string;
  to: string;
  stationId: string;
  vehicleClassId: string | null;
  count: number;
  vehicles: { id: string; licensePlate: string; vehicleClass: { name: string; code: string } }[];
};

function emailLooksComplete(s: string): boolean {
  const t = s.trim();
  if (t.length < 5 || !t.includes('@')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

function phoneDigitsCompleteForLookup(s: string): boolean {
  const n = s.replace(/\D/g, '').length;
  return n >= 8 && n <= 15;
}

type ReservationOne = {
  id: string;
  companyId: string;
  vehicleId: string;
  pickupStationId: string;
  returnStationId: string;
  pickupAt: string;
  returnAt: string;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  totalCents: number | null;
  currency: string;
  notes: string | null;
  odometerOutKm?: number | null;
  odometerInKm?: number | null;
  paidAt?: string | null;
  stripeDepositCheckoutSessionId?: string | null;
  stripeDepositPaymentIntentId?: string | null;
  depositHoldCents?: number | null;
  depositHoldStatus?: string | null;
  source?: 'STAFF' | 'PUBLIC_WEB' | 'PARTNER';
  createdByPartnerApiKey?: { id: string; name: string } | null;
  vehicle: {
    licensePlate: string;
    modelLabel: string | null;
    vehicleClass?: { defaultDepositCents: number | null };
  };
  extraLines?: { id: string; label: string; amountCents: number; sortOrder: number }[];
  rentalAgreement?: {
    id: string;
    status: string;
    body: string;
    agreementTemplateVersion?: string | null;
    signedAt: string | null;
    signedByName: string | null;
    signedClientIp?: string | null;
    signedUserAgent?: string | null;
    attachments?: {
      id: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      createdAt: string;
    }[];
  } | null;
  customer?: { id: string; name: string; email: string; phone: string } | null;
  cargosHandoverOverrideAt?: string | null;
  cargosHandoverOverrideReason?: string | null;
  cargosHandoverOverrideBy?: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  handoverGate?: {
    ready: boolean;
    blockerCodes: string[];
    agreementSigned: boolean;
    cargosOk: boolean;
    cargosOverridden: boolean;
    idDocumentsOk: boolean;
    requireIdDocuments: boolean;
    requireVerifiedIdDocuments: boolean;
    requireCargos: boolean;
    cargosTransmissionRequired: boolean;
    requireSignedAgreement: boolean;
  };
  returnCompletionGate?: {
    relevant: boolean;
    ready: boolean;
    blockerCodes: string[];
    requireOdometerIn: boolean;
    requireReturnChecklist: boolean;
    requireFuelIn: boolean;
    odometerInOk: boolean;
    checklistOk: boolean;
    fuelInOk: boolean;
  };
  damageReport?: {
    suggestedCaptureCents: number | null;
    lines?: { estimatedFeeCents: number | null }[];
  } | null;
};

type AgreementAttachmentRow = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type CargosSubmissionRow = {
  id: string;
  reservationId: string;
  status: string;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
};

type TimeOrderErrs = {
  timeInvalid: string;
  returnAfterPickup: string;
};

type ExtraLineErrs = {
  incomplete: string;
  badAmount: string;
};

function parseTimeOrder(
  pickup: string,
  ret: string,
  errs: TimeOrderErrs,
): { ok: true; pickup: Date; returnAt: Date } | { ok: false; err: string } {
  const a = new Date(pickup);
  const b = new Date(ret);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) {
    return { ok: false, err: errs.timeInvalid };
  }
  if (a >= b) {
    return { ok: false, err: errs.returnAfterPickup };
  }
  return { ok: true, pickup: a, returnAt: b };
}

function buildExtraLinePayload(
  rows: { label: string; amountCents: string }[],
  errs: ExtraLineErrs,
):
  | { ok: true; lines: { label: string; amountCents: number }[] }
  | { ok: false; err: string } {
  const lines: { label: string; amountCents: number }[] = [];
  for (const row of rows) {
    const lab = row.label.trim();
    const ac = row.amountCents.trim();
    if (lab === '' && ac === '') {
      continue;
    }
    if (lab === '' || ac === '') {
      return { ok: false, err: errs.incomplete };
    }
    const n = Number.parseInt(ac, 10);
    if (Number.isNaN(n) || n < 0) {
      return { ok: false, err: errs.badAmount };
    }
    lines.push({ label: lab, amountCents: n });
  }
  return { ok: true, lines };
}

function handoverBlockerLabel(code: string, t: (k: PublicMessageKey) => string): string {
  const k = HANDOVER_BLOCKER_KEYS[code];
  return k ? t(k) : code;
}

function returnBlockerLabel(code: string, t: (k: PublicMessageKey) => string): string {
  const k = RETURN_BLOCKER_KEYS[code];
  return k ? t(k) : code;
}

function sumDamageLineEstimatedFees(
  report: { lines?: { estimatedFeeCents: number | null }[] } | null | undefined,
): number {
  if (!report?.lines?.length) {
    return 0;
  }
  let s = 0;
  for (const l of report.lines) {
    const c = l.estimatedFeeCents;
    if (c != null && Number.isFinite(c) && c > 0) {
      s += c;
    }
  }
  return s;
}

const empty = {
  vehicleId: '',
  pickupStationId: '',
  returnStationId: '',
  pickupAt: '',
  returnAt: '',
  status: 'QUOTE' as (typeof reservationStatusValues)[number],
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  totalCents: '',
  currency: 'EUR',
  notes: '',
  odometerOutKm: '',
  odometerInKm: '',
  filterClassId: '',
};

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function canWriteReservations(me: Me): boolean {
  return me.role !== 'READONLY_ACCOUNTING';
}

type Props = {
  me: Me;
  companyId: string;
  open: boolean;
  editingId: string | null;
  onClose: () => void;
  onSaved: () => void;
};

export function ReservationForm({ me, companyId, open, editingId, onClose, onSaved }: Props) {
  const [values, setValues] = useState({ ...empty });
  const [stations, setStations] = useState<StationRow[]>([]);
  const [vclasses, setVclasses] = useState<VClass[]>([]);
  const [vehicles, setVehicles] = useState<VehicleListItem[]>([]);
  const [optsErr, setOptsErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [optsLoading, setOptsLoading] = useState(false);
  const [availabilityHint, setAvailabilityHint] = useState<string | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const [statusSnapshot, setStatusSnapshot] = useState<string | null>(null);
  const [paidAtSnapshot, setPaidAtSnapshot] = useState<string | null>(null);
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null);
  const [payLinkLoading, setPayLinkLoading] = useState(false);
  const [depositLinkLoading, setDepositLinkLoading] = useState(false);
  const [depositActionLoading, setDepositActionLoading] = useState(false);
  const [depositHoldStatusSnapshot, setDepositHoldStatusSnapshot] = useState<string | null>(null);
  const [depositHoldCentsSnapshot, setDepositHoldCentsSnapshot] = useState<number | null>(null);
  const [defaultDepositCentsHint, setDefaultDepositCentsHint] = useState<number | null>(null);
  const [depositAmountInput, setDepositAmountInput] = useState('');
  const [depositCaptureCentsInput, setDepositCaptureCentsInput] = useState('');
  const [damageSuggestedCaptureCents, setDamageSuggestedCaptureCents] = useState<number | null>(null);
  const [damageLineFeesSumCents, setDamageLineFeesSumCents] = useState(0);
  const [refundRentCents, setRefundRentCents] = useState('');
  const [refundDepositCents, setRefundDepositCents] = useState('');
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundOkNotice, setRefundOkNotice] = useState<string | null>(null);
  const [linkedCustomerId, setLinkedCustomerId] = useState<string | null>(null);
  const [initialLinkedCustomerId, setInitialLinkedCustomerId] = useState<string | null>(null);
  const [emailDupHint, setEmailDupHint] = useState<{
    id: string;
    name: string;
    email: string;
    phone: string;
  } | null>(null);
  const [phoneDupHint, setPhoneDupHint] = useState<{
    id: string;
    name: string;
    email: string;
    phone: string;
  } | null>(null);
  const [custSearch, setCustSearch] = useState('');
  const [custOptions, setCustOptions] = useState<{ id: string; name: string; email: string; phone: string }[]>([]);
  const custSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [agreementStatus, setAgreementStatus] = useState<string | null>(null);
  const [agreementBody, setAgreementBody] = useState('');
  const [agreementSignName, setAgreementSignName] = useState('');
  const [agreementSignedBy, setAgreementSignedBy] = useState<string | null>(null);
  const [agreementSignedAt, setAgreementSignedAt] = useState<string | null>(null);
  const [agreementTemplateVersion, setAgreementTemplateVersion] = useState('');
  const [agreementSignedClientIp, setAgreementSignedClientIp] = useState<string | null>(null);
  const [agreementSignedUserAgent, setAgreementSignedUserAgent] = useState<string | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementAttachments, setAgreementAttachments] = useState<AgreementAttachmentRow[]>([]);
  const [agreementStorageMode, setAgreementStorageMode] = useState<'local' | 's3' | null>(null);
  const agreementFileRef = useRef<HTMLInputElement | null>(null);
  const [cargosSubmissions, setCargosSubmissions] = useState<CargosSubmissionRow[]>([]);
  const [cargosBusy, setCargosBusy] = useState(false);
  const [handoverGate, setHandoverGate] = useState<NonNullable<ReservationOne['handoverGate']> | null>(null);
  const [returnCompletionGate, setReturnCompletionGate] =
    useState<NonNullable<ReservationOne['returnCompletionGate']> | null>(null);
  const [cargosHandoverOverrideSnapshot, setCargosHandoverOverrideSnapshot] = useState<{
    at: string | null;
    reason: string | null;
    by: ReservationOne['cargosHandoverOverrideBy'];
  } | null>(null);
  const [cargosOverrideInput, setCargosOverrideInput] = useState('');
  const [cargosOverrideBusy, setCargosOverrideBusy] = useState(false);
  const [extraLineRows, setExtraLineRows] = useState<{ label: string; amountCents: string }[]>([]);
  const [editingSource, setEditingSource] = useState<'STAFF' | 'PUBLIC_WEB' | 'PARTNER' | null>(null);
  const [partnerKeyInfo, setPartnerKeyInfo] = useState<{ id: string; name: string } | null>(null);

  const isEdit = Boolean(editingId);
  const canWrite = canWriteReservations(me);
  const dhs = depositHoldStatusSnapshot ?? 'NONE';
  const canOpenDeposit = canWrite && ['NONE', 'PENDING', 'CANCELED', 'FAILED'].includes(dhs);
  const canCaptureOrRelease = canWrite && dhs === 'UNCAPTURED';
  const lockPickupStation = me.role === 'AGENT' && me.stationId != null;
  const { t, locale } = usePublicLocaleContext();
  const dateLoc = locale === 'it' ? 'it-IT' : 'en-GB';

  useEffect(() => {
    setRefundOkNotice(null);
  }, [editingId]);

  useEffect(() => {
    if (!open || !companyId) {
      return;
    }
    let c = false;
    setOptsLoading(true);
    (async () => {
      try {
        const [st, cl, ve] = await Promise.all([
          apiJson<StationRow[]>(`/stations?companyId=${encodeURIComponent(companyId)}`),
          apiJson<VClass[]>(`/vehicle-classes?companyId=${encodeURIComponent(companyId)}`),
          apiJson<VehicleListItem[]>(`/vehicles?companyId=${encodeURIComponent(companyId)}`),
        ]);
        if (c) return;
        setStations(st);
        setVclasses(cl);
        setVehicles(ve);
        setOptsErr(null);
      } catch (e) {
        if (!c) setOptsErr(e instanceof Error ? e.message : t('desk.err.generic'));
      } finally {
        if (!c) setOptsLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [open, companyId, t]);

  useEffect(() => {
    if (!open || !canWrite) {
      return;
    }
    let c = false;
    (async () => {
      try {
        const s = await apiJson<{ stripe: boolean }>('/payments/stripe/status');
        if (!c) {
          setStripeEnabled(s.stripe);
        }
      } catch {
        if (!c) {
          setStripeEnabled(false);
        }
      }
    })();
    return () => {
      c = true;
    };
  }, [open, canWrite]);

  useEffect(() => {
    if (!open || !editingId) {
      setCargosSubmissions([]);
      return;
    }
    let c = false;
    (async () => {
      try {
        const params = new URLSearchParams({ reservationId: editingId });
        params.set('companyId', companyId);
        const list = await apiJson<CargosSubmissionRow[]>(
          `/integrations/cargos/submissions?${params.toString()}`,
        );
        if (!c) {
          setCargosSubmissions(list);
        }
      } catch {
        if (!c) {
          setCargosSubmissions([]);
        }
      }
    })();
    return () => {
      c = true;
    };
  }, [open, editingId, companyId]);

  useEffect(() => {
    if (!agreementId) {
      setAgreementStorageMode(null);
      return;
    }
    let c = false;
    (async () => {
      try {
        const cfg = await apiJson<{ mode: 'local' | 's3' }>('/agreements/storage-config');
        if (!c) {
          setAgreementStorageMode(cfg.mode);
        }
      } catch {
        if (!c) {
          setAgreementStorageMode('local');
        }
      }
    })();
    return () => {
      c = true;
    };
  }, [agreementId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setSubmitErr(null);
    setAvailabilityHint(null);
    if (!editingId) {
      setValues({ ...empty });
      setLinkedCustomerId(null);
      setInitialLinkedCustomerId(null);
      setCustSearch('');
      setCustOptions([]);
      setEditingSource(null);
      setPartnerKeyInfo(null);
      setStatusSnapshot(null);
      setPaidAtSnapshot(null);
      setDepositHoldStatusSnapshot(null);
      setDepositHoldCentsSnapshot(null);
      setDefaultDepositCentsHint(null);
      setDepositAmountInput('');
      setDepositCaptureCentsInput('');
      setDamageSuggestedCaptureCents(null);
      setDamageLineFeesSumCents(0);
      setAgreementId(null);
      setAgreementStatus(null);
      setAgreementBody('');
      setAgreementSignName('');
      setAgreementSignedBy(null);
      setAgreementSignedAt(null);
      setAgreementAttachments([]);
      setExtraLineRows([]);
      setHandoverGate(null);
      setReturnCompletionGate(null);
      setCargosHandoverOverrideSnapshot(null);
      return;
    }
    let c = false;
    setLoading(true);
    (async () => {
      try {
        const r = await apiJson<ReservationOne>(`/reservations/${editingId}`);
        if (c) return;
        setEditingSource(
          r.source === 'PUBLIC_WEB' ? 'PUBLIC_WEB' : r.source === 'PARTNER' ? 'PARTNER' : 'STAFF',
        );
        setPartnerKeyInfo(r.createdByPartnerApiKey ?? null);
        setStatusSnapshot(r.status);
        setPaidAtSnapshot(r.paidAt ?? null);
        setDepositHoldStatusSnapshot(r.depositHoldStatus ?? 'NONE');
        setDepositHoldCentsSnapshot(r.depositHoldCents ?? null);
        setDefaultDepositCentsHint(r.vehicle?.vehicleClass?.defaultDepositCents ?? null);
        setDepositAmountInput('');
        setDepositCaptureCentsInput('');
        setDamageSuggestedCaptureCents(r.damageReport?.suggestedCaptureCents ?? null);
        setDamageLineFeesSumCents(sumDamageLineEstimatedFees(r.damageReport));
        const linkId = r.customer?.id ?? null;
        setLinkedCustomerId(linkId);
        setInitialLinkedCustomerId(linkId);
        setCustSearch('');
        setCustOptions([]);
        setValues({
          ...empty,
          vehicleId: r.vehicleId,
          pickupStationId: r.pickupStationId,
          returnStationId: r.returnStationId,
          pickupAt: toDatetimeLocalValue(r.pickupAt),
          returnAt: toDatetimeLocalValue(r.returnAt),
          status: r.status as (typeof empty)['status'],
          customerName: r.customerName,
          customerEmail: r.customerEmail,
          customerPhone: r.customerPhone,
          totalCents: r.totalCents != null ? String(r.totalCents) : '',
          currency: r.currency,
          notes: r.notes ?? '',
          odometerOutKm: r.odometerOutKm != null ? String(r.odometerOutKm) : '',
          odometerInKm: r.odometerInKm != null ? String(r.odometerInKm) : '',
        });
        setExtraLineRows(
          (r.extraLines && r.extraLines.length > 0
            ? r.extraLines
            : []
          ).map((x) => ({
            label: x.label,
            amountCents: String(x.amountCents),
          })),
        );
        setHandoverGate(r.handoverGate ?? null);
        setReturnCompletionGate(r.returnCompletionGate ?? null);
        setCargosHandoverOverrideSnapshot(
          r.cargosHandoverOverrideAt
            ? {
                at: r.cargosHandoverOverrideAt,
                reason: r.cargosHandoverOverrideReason ?? null,
                by: r.cargosHandoverOverrideBy ?? null,
              }
            : null,
        );
        setCargosOverrideInput('');
        if (r.rentalAgreement) {
          const ra = r.rentalAgreement as {
            id: string;
            status: string;
            body: string;
            signedByName: string | null;
            signedAt: string | null;
            agreementTemplateVersion?: string | null;
            signedClientIp?: string | null;
            signedUserAgent?: string | null;
            attachments?: AgreementAttachmentRow[];
          };
          setAgreementId(ra.id);
          setAgreementStatus(ra.status);
          setAgreementBody(ra.body);
          setAgreementSignName((r.customerName || '').trim());
          setAgreementSignedBy(ra.signedByName);
          setAgreementSignedAt(ra.signedAt);
          setAgreementTemplateVersion(ra.agreementTemplateVersion?.trim() ?? '');
          setAgreementSignedClientIp(ra.signedClientIp ?? null);
          setAgreementSignedUserAgent(ra.signedUserAgent ?? null);
          setAgreementAttachments(ra.attachments ?? []);
        } else {
          setAgreementId(null);
          setAgreementStatus(null);
          setAgreementBody(t('desk.res.form.defaultAgreementBody'));
          setAgreementSignName((r.customerName || '').trim());
          setAgreementSignedBy(null);
          setAgreementSignedAt(null);
          setAgreementTemplateVersion('');
          setAgreementSignedClientIp(null);
          setAgreementSignedUserAgent(null);
          setAgreementAttachments([]);
        }
        setLoadErr(null);
      } catch (e) {
        if (!c) setLoadErr(e instanceof Error ? e.message : t('desk.err.generic'));
      } finally {
        if (!c) setLoading(false);
      }
    })();
    return () => {
      c = true;
    };
  }, [open, editingId, t]);

  // Default pickup/return to the user’s home branch (API enforces the same for AGENT+stationId)
  useEffect(() => {
    if (!open || editingId) {
      return;
    }
    if (!me.stationId) {
      return;
    }
    setValues((prev) => {
      if (prev.pickupStationId !== '' || prev.returnStationId !== '') {
        return prev;
      }
      return {
        ...prev,
        pickupStationId: me.stationId!,
        returnStationId: me.stationId!,
      };
    });
  }, [open, editingId, me.stationId]);

  useEffect(() => {
    if (!open || !companyId) {
      return;
    }
    const q = custSearch.trim();
    if (q.length < 2) {
      setCustOptions([]);
      return;
    }
    if (custSearchTimer.current) {
      clearTimeout(custSearchTimer.current);
    }
    custSearchTimer.current = setTimeout(() => {
      void (async () => {
        try {
          type CustRow = { id: string; name: string; email: string; phone: string };
          const list = await apiJson<CustRow[]>(
            `/customers?${new URLSearchParams({ companyId, q })}`,
          );
          setCustOptions(
            list.map((c) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone })),
          );
        } catch {
          setCustOptions([]);
        }
      })();
    }, 350);
    return () => {
      if (custSearchTimer.current) {
        clearTimeout(custSearchTimer.current);
      }
    };
  }, [custSearch, companyId, open]);

  useEffect(() => {
    if (!open || !companyId) {
      setEmailDupHint(null);
      return;
    }
    let cancelled = false;
    const raw = values.customerEmail.trim();
    if (!emailLooksComplete(raw)) {
      setEmailDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, email: raw });
          if (linkedCustomerId) {
            qs.set('excludeCustomerId', linkedCustomerId);
          }
          const r = await apiJson<{
            match: { id: string; name: string; email: string; phone: string } | null;
          }>(`/customers/lookup-by-email?${qs.toString()}`);
          if (cancelled) return;
          if (r.match && r.match.id !== linkedCustomerId) {
            setEmailDupHint({
              id: r.match.id,
              name: r.match.name,
              email: r.match.email,
              phone: r.match.phone,
            });
          } else {
            setEmailDupHint(null);
          }
        } catch {
          if (!cancelled) setEmailDupHint(null);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, companyId, values.customerEmail, linkedCustomerId]);

  useEffect(() => {
    if (!open || !companyId) {
      setPhoneDupHint(null);
      return;
    }
    let cancelled = false;
    const raw = values.customerPhone.trim();
    if (!raw || !phoneDigitsCompleteForLookup(raw)) {
      setPhoneDupHint(null);
      return;
    }
    const tmr = window.setTimeout(() => {
      void (async () => {
        try {
          const qs = new URLSearchParams({ companyId, phone: raw });
          if (linkedCustomerId) {
            qs.set('excludeCustomerId', linkedCustomerId);
          }
          const r = await apiJson<{
            match: { id: string; name: string; email: string; phone: string } | null;
          }>(`/customers/lookup-by-phone?${qs.toString()}`);
          if (cancelled) return;
          if (r.match && r.match.id !== linkedCustomerId) {
            setPhoneDupHint({
              id: r.match.id,
              name: r.match.name,
              email: r.match.email,
              phone: r.match.phone,
            });
          } else {
            setPhoneDupHint(null);
          }
        } catch {
          if (!cancelled) setPhoneDupHint(null);
        }
      })();
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(tmr);
    };
  }, [open, companyId, values.customerPhone, linkedCustomerId]);

  if (!open || !canWrite) {
    return null;
  }

  function applyLinkedCustomer(c: { id: string; name: string; email: string; phone: string }) {
    setLinkedCustomerId(c.id);
    setValues((prev) => ({
      ...prev,
      customerName: c.name,
      customerEmail: c.email,
      customerPhone: c.phone,
    }));
    setCustSearch('');
    setCustOptions([]);
  }

  function setField<K extends keyof typeof values>(k: K, v: (typeof values)[K]) {
    if (k === 'customerName' || k === 'customerEmail' || k === 'customerPhone') {
      setLinkedCustomerId(null);
    }
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function clearAvailabilityHint() {
    setAvailabilityHint(null);
  }

  async function onCheckAvailability() {
    setSubmitErr(null);
    if (!values.pickupStationId) {
      setSubmitErr(t('desk.res.form.err.pickupFirst'));
      return;
    }
    const timeOrder = parseTimeOrder(values.pickupAt, values.returnAt, {
      timeInvalid: t('desk.res.form.err.timeInvalid'),
      returnAfterPickup: t('desk.res.form.err.returnAfterPickup'),
    });
    if (!timeOrder.ok) {
      setSubmitErr(timeOrder.err);
      return;
    }
    setAvailLoading(true);
    setAvailabilityHint(null);
    try {
      const p = new URLSearchParams({
        stationId: values.pickupStationId,
        from: timeOrder.pickup.toISOString(),
        to: timeOrder.returnAt.toISOString(),
      });
      if (values.filterClassId) {
        p.set('vehicleClassId', values.filterClassId);
      }
      if (editingId) {
        p.set('excludeReservationId', editingId);
      }
      const res = await apiJson<AvailabilityPayload>(
        `/availability/vehicles?${p.toString()}`,
      );
      const names =
        res.vehicles.length === 0
          ? '—'
          : res.vehicles
              .map((v) => `${v.licensePlate} (${v.vehicleClass.code})`)
              .join(', ');
      setAvailabilityHint(
        res.count === 0
          ? t('desk.res.form.availNone')
          : t('desk.res.form.availOk').replace('{count}', String(res.count)).replace('{names}', names),
      );
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAvailLoading(false);
    }
  }

  async function onDeleteDraft() {
    if (!editingId || statusSnapshot !== 'QUOTE') {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.deleteDraft'))) {
      return;
    }
    setDeleting(true);
    setSubmitErr(null);
    try {
      const r = await apiFetch(`/reservations/${editingId}`, { method: 'DELETE' });
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') {
          window.location.assign('/auth');
        }
        return;
      }
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || r.statusText);
      }
      onSaved();
      onClose();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setDeleting(false);
    }
  }

  async function onOpenStripeCheckout() {
    if (!editingId) {
      return;
    }
    setPayLinkLoading(true);
    setSubmitErr(null);
    try {
      if (values.currency.trim().toUpperCase().slice(0, 3) !== 'EUR') {
        setSubmitErr(t('desk.res.form.err.stripeEur'));
        return;
      }
      const res = await apiJson<{ url: string }>(
        `/payments/stripe/reservations/${editingId}/checkout-session`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      window.open(res.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setPayLinkLoading(false);
    }
  }

  async function refetchReservationSnapshot() {
    if (!editingId) {
      return;
    }
    try {
      const r = await apiJson<ReservationOne>(`/reservations/${editingId}`);
      setPaidAtSnapshot(r.paidAt ?? null);
      setDepositHoldStatusSnapshot(r.depositHoldStatus ?? 'NONE');
      setDepositHoldCentsSnapshot(r.depositHoldCents ?? null);
      setDefaultDepositCentsHint(r.vehicle?.vehicleClass?.defaultDepositCents ?? null);
      setHandoverGate(r.handoverGate ?? null);
      setReturnCompletionGate(r.returnCompletionGate ?? null);
      setDamageSuggestedCaptureCents(r.damageReport?.suggestedCaptureCents ?? null);
      setDamageLineFeesSumCents(sumDamageLineEstimatedFees(r.damageReport));
      setCargosHandoverOverrideSnapshot(
        r.cargosHandoverOverrideAt
          ? {
              at: r.cargosHandoverOverrideAt,
              reason: r.cargosHandoverOverrideReason ?? null,
              by: r.cargosHandoverOverrideBy ?? null,
            }
          : null,
      );
    } catch {
      // ignore
    }
  }

  async function onOpenDepositCheckout() {
    if (!editingId) {
      return;
    }
    setDepositLinkLoading(true);
    setSubmitErr(null);
    try {
      if (values.currency.trim().toUpperCase().slice(0, 3) !== 'EUR') {
        setSubmitErr(t('desk.res.form.err.stripeEurDeposit'));
        return;
      }
      const raw = depositAmountInput.trim();
      const body: { amountCents?: number } = {};
      if (raw !== '') {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) {
          setSubmitErr(t('desk.res.form.err.depositAmount'));
          return;
        }
        body.amountCents = n;
      }
      const res = await apiJson<{ url: string }>(
        `/payments/stripe/reservations/${editingId}/deposit-checkout-session`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      window.open(res.url, '_blank', 'noopener,noreferrer');
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setDepositLinkLoading(false);
    }
  }

  async function onCaptureDeposit() {
    if (!editingId) {
      return;
    }
    setDepositActionLoading(true);
    setSubmitErr(null);
    try {
      const capBody: Record<string, number> = {};
      const rawCap = depositCaptureCentsInput.trim();
      if (rawCap !== '') {
        const n = Number.parseInt(rawCap, 10);
        if (!Number.isFinite(n) || n < 1) {
          setSubmitErr(t('desk.res.form.err.depositCapturePartial'));
          return;
        }
        capBody.amountCents = n;
      }
      await apiJson(`/payments/stripe/reservations/${editingId}/capture-deposit`, {
        method: 'POST',
        body: JSON.stringify(capBody),
      });
      await refetchReservationSnapshot();
      onSaved();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setDepositActionLoading(false);
    }
  }

  async function onRefundRental() {
    if (!editingId) {
      return;
    }
    if (!paidAtSnapshot) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.refundRental'))) {
      return;
    }
    setRefundBusy(true);
    setSubmitErr(null);
    setRefundOkNotice(null);
    try {
      const body: { target: 'RENTAL'; amountCents?: number } = { target: 'RENTAL' };
      const raw = refundRentCents.trim();
      if (raw !== '') {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) {
          setSubmitErr(t('desk.res.form.err.partialRefund'));
          return;
        }
        body.amountCents = n;
      }
      const ref = await apiJson<{ id: string }>(
        `/payments/stripe/reservations/${editingId}/refund`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setRefundRentCents('');
      setSubmitErr(null);
      setRefundOkNotice(t('desk.res.form.alert.refundOk').replace('{id}', ref.id));
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setRefundBusy(false);
    }
  }

  async function onRefundDepositCaptured() {
    if (!editingId) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.refundDeposit'))) {
      return;
    }
    setRefundBusy(true);
    setSubmitErr(null);
    setRefundOkNotice(null);
    try {
      const body: { target: 'DEPOSIT'; amountCents?: number } = { target: 'DEPOSIT' };
      const raw = refundDepositCents.trim();
      if (raw !== '') {
        const n = Number.parseInt(raw, 10);
        if (!Number.isFinite(n) || n < 1) {
          setSubmitErr(t('desk.res.form.err.partialRefund'));
          return;
        }
        body.amountCents = n;
      }
      const ref = await apiJson<{ id: string }>(
        `/payments/stripe/reservations/${editingId}/refund`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      setRefundDepositCents('');
      setSubmitErr(null);
      setRefundOkNotice(t('desk.res.form.alert.refundOk').replace('{id}', ref.id));
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setRefundBusy(false);
    }
  }

  async function onCancelDepositHold() {
    if (!editingId) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.releaseHold'))) {
      return;
    }
    setDepositActionLoading(true);
    setSubmitErr(null);
    try {
      await apiJson(`/payments/stripe/reservations/${editingId}/cancel-deposit`, { method: 'POST' });
      await refetchReservationSnapshot();
      onSaved();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setDepositActionLoading(false);
    }
  }

  async function onCreateRentalAgreement() {
    if (!editingId) {
      return;
    }
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      if (agreementBody.trim() === '') {
        setSubmitErr(t('desk.res.form.err.agreementEmpty'));
        return;
      }
      const tv = agreementTemplateVersion.trim();
      const a = await apiJson<{
        id: string;
        status: string;
        body: string;
        signedAt: string | null;
        signedByName: string | null;
        agreementTemplateVersion?: string | null;
        signedClientIp?: string | null;
        signedUserAgent?: string | null;
        attachments?: AgreementAttachmentRow[];
      }>('/agreements', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: editingId,
          body: agreementBody,
          ...(tv ? { agreementTemplateVersion: tv } : {}),
        }),
      });
      setAgreementId(a.id);
      setAgreementStatus(a.status);
      setAgreementBody(a.body);
      setAgreementSignedBy(a.signedByName);
      setAgreementSignedAt(a.signedAt);
      setAgreementTemplateVersion(a.agreementTemplateVersion?.trim() ?? '');
      setAgreementSignedClientIp(a.signedClientIp ?? null);
      setAgreementSignedUserAgent(a.signedUserAgent ?? null);
      setAgreementAttachments(a.attachments ?? []);
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
    }
  }

  async function onSaveRentalAgreementDraft() {
    if (!agreementId) {
      return;
    }
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      const a = await apiJson<{
        id: string;
        status: string;
        body: string;
        signedAt: string | null;
        signedByName: string | null;
        agreementTemplateVersion?: string | null;
        signedClientIp?: string | null;
        signedUserAgent?: string | null;
        attachments?: AgreementAttachmentRow[];
      }>(`/agreements/${agreementId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          body: agreementBody,
          agreementTemplateVersion: agreementTemplateVersion.trim() || null,
        }),
      });
      setAgreementId(a.id);
      setAgreementStatus(a.status);
      setAgreementBody(a.body);
      setAgreementSignedBy(a.signedByName);
      setAgreementSignedAt(a.signedAt);
      setAgreementTemplateVersion(a.agreementTemplateVersion?.trim() ?? '');
      setAgreementSignedClientIp(a.signedClientIp ?? null);
      setAgreementSignedUserAgent(a.signedUserAgent ?? null);
      setAgreementAttachments(a.attachments ?? []);
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
    }
  }

  async function onSignRentalAgreement() {
    if (!agreementId) {
      return;
    }
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      const name = agreementSignName.trim();
      if (name === '') {
        setSubmitErr(t('desk.res.form.err.signName'));
        return;
      }
      const a = await apiJson<{
        id: string;
        status: string;
        body: string;
        signedAt: string | null;
        signedByName: string | null;
        agreementTemplateVersion?: string | null;
        signedClientIp?: string | null;
        signedUserAgent?: string | null;
        attachments?: AgreementAttachmentRow[];
      }>(`/agreements/${agreementId}/sign`, {
        method: 'POST',
        body: JSON.stringify({ signedByName: name }),
      });
      setAgreementStatus(a.status);
      setAgreementId(a.id);
      setAgreementBody(a.body);
      setAgreementSignedBy(a.signedByName);
      setAgreementSignedAt(a.signedAt);
      setAgreementTemplateVersion(a.agreementTemplateVersion?.trim() ?? '');
      setAgreementSignedClientIp(a.signedClientIp ?? null);
      setAgreementSignedUserAgent(a.signedUserAgent ?? null);
      setAgreementAttachments(a.attachments ?? []);
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
    }
  }

  async function onVoidRentalAgreement() {
    if (!agreementId) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.voidAgreement'))) {
      return;
    }
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      const a = await apiJson<{
        id: string;
        status: string;
        body: string;
        signedAt: string | null;
        signedByName: string | null;
        agreementTemplateVersion?: string | null;
        signedClientIp?: string | null;
        signedUserAgent?: string | null;
        attachments?: AgreementAttachmentRow[];
      }>(`/agreements/${agreementId}/void`, { method: 'POST' });
      setAgreementStatus(a.status);
      setAgreementAttachments(a.attachments ?? []);
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
    }
  }

  async function onAgreementFileSelected() {
    const el = agreementFileRef.current;
    if (!el?.files?.length || !agreementId) {
      return;
    }
    const f = el.files[0]!;
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      let mode = agreementStorageMode;
      if (mode === null) {
        try {
          const cfg = await apiJson<{ mode: 'local' | 's3' }>('/agreements/storage-config');
          mode = cfg.mode;
          setAgreementStorageMode(cfg.mode);
        } catch {
          mode = 'local';
          setAgreementStorageMode('local');
        }
      }
      if (mode === 's3') {
        const presign = await apiJson<{
          attachment: AgreementAttachmentRow;
          uploadUrl: string;
          method: 'PUT';
          headers: Record<string, string>;
        }>(`/agreements/${agreementId}/attachments/presign`, {
          method: 'POST',
          body: JSON.stringify({
            originalName: f.name,
            mimeType: f.type || 'application/pdf',
            sizeBytes: f.size,
          }),
        });
        const put = await fetchPresignedPut(presign.uploadUrl, f, presign.headers, t);
        if (!put.ok) {
          try {
            await apiFetch(`/agreements/${agreementId}/attachments/${presign.attachment.id}`, { method: 'DELETE' });
          } catch {
            // best-effort cleanup
          }
          throw new Error(t('desk.storage.presignPutRejected').replace('{status}', String(put.status)));
        }
        const row = await apiJson<AgreementAttachmentRow>(
          `/agreements/${agreementId}/attachments/${presign.attachment.id}/complete`,
          { method: 'POST' },
        );
        setAgreementAttachments((prev) => [...prev, row]);
        return;
      }
      const fd = new FormData();
      fd.append('file', f);
      const r = await apiFetch(`/agreements/${agreementId}/attachments`, {
        method: 'POST',
        body: fd,
      });
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') {
          window.location.assign('/auth');
        }
        return;
      }
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || r.statusText);
      }
      const row = (await r.json()) as AgreementAttachmentRow;
      setAgreementAttachments((prev) => [...prev, row]);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
      if (el) {
        el.value = '';
      }
    }
  }

  async function onDownloadAgreementFile(attachment: AgreementAttachmentRow) {
    if (!agreementId) {
      return;
    }
    setSubmitErr(null);
    try {
      const r = await apiFetch(`/agreements/${agreementId}/attachments/${attachment.id}/file`);
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') {
          window.location.assign('/auth');
        }
        return;
      }
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(errText || r.statusText);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.originalName;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function onDeleteAgreementFile(attachment: AgreementAttachmentRow) {
    if (!agreementId || !canWrite) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.deleteFile').replace('{name}', attachment.originalName))) {
      return;
    }
    setAgreementBusy(true);
    setSubmitErr(null);
    try {
      await apiJson(`/agreements/${agreementId}/attachments/${attachment.id}`, { method: 'DELETE' });
      setAgreementAttachments((prev) => prev.filter((x) => x.id !== attachment.id));
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setAgreementBusy(false);
    }
  }

  async function onEnqueueCargos(sendImmediately: boolean) {
    if (!editingId) {
      return;
    }
    setCargosBusy(true);
    setSubmitErr(null);
    try {
      await apiJson<CargosSubmissionRow>('/integrations/cargos/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          reservationId: editingId,
          ...(sendImmediately ? { sendImmediately: true } : {}),
        }),
      });
      const params = new URLSearchParams({ reservationId: editingId });
      params.set('companyId', companyId);
      const list = await apiJson<CargosSubmissionRow[]>(
        `/integrations/cargos/submissions?${params.toString()}`,
      );
      setCargosSubmissions(list);
      await refetchReservationSnapshot();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setCargosBusy(false);
    }
  }

  async function onRecordCargosHandoverOverride() {
    if (!editingId || (me.role !== 'ADMIN' && me.role !== 'BRANCH_MANAGER')) {
      return;
    }
    const reason = cargosOverrideInput.trim();
    if (reason.length < 3) {
      setSubmitErr(t('desk.res.form.err.overrideReason'));
      return;
    }
    setCargosOverrideBusy(true);
    setSubmitErr(null);
    try {
      await apiJson(`/reservations/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ cargosHandoverOverride: { reason } }),
      });
      setCargosOverrideInput('');
      await refetchReservationSnapshot();
      onSaved();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setCargosOverrideBusy(false);
    }
  }

  async function onClearCargosHandoverOverride() {
    if (!editingId || (me.role !== 'ADMIN' && me.role !== 'BRANCH_MANAGER')) {
      return;
    }
    if (!window.confirm(t('desk.res.form.confirm.clearCargosOverride'))) {
      return;
    }
    setCargosOverrideBusy(true);
    setSubmitErr(null);
    try {
      await apiJson(`/reservations/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ cargosHandoverOverride: null }),
      });
      await refetchReservationSnapshot();
      onSaved();
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setCargosOverrideBusy(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitErr(null);
    if (stations.length === 0) {
      setSubmitErr(t('desk.res.form.err.needStation'));
      return;
    }
    if (vehicles.length === 0) {
      setSubmitErr(t('desk.res.form.err.needVehicle'));
      return;
    }
    const timeOrder = parseTimeOrder(values.pickupAt, values.returnAt, {
      timeInvalid: t('desk.res.form.err.timeInvalid'),
      returnAfterPickup: t('desk.res.form.err.returnAfterPickup'),
    });
    if (!timeOrder.ok) {
      setSubmitErr(timeOrder.err);
      return;
    }
    const ex = buildExtraLinePayload(extraLineRows, {
      incomplete: t('desk.res.form.err.extraIncomplete'),
      badAmount: t('desk.res.form.err.extraAmount'),
    });
    if (!ex.ok) {
      setSubmitErr(ex.err);
      return;
    }
    const totalTrim = values.totalCents.trim();
    if (totalTrim !== '' && ex.lines.length > 0) {
      setSubmitErr(t('desk.res.form.err.totalVsExtras'));
      return;
    }
    setSaving(true);
    try {
      if (isEdit && editingId) {
        const cur = values.currency.trim().toUpperCase().slice(0, 3);
        const raw: Record<string, unknown> = {
          vehicleId: values.vehicleId,
          pickupStationId: values.pickupStationId,
          returnStationId: values.returnStationId,
          pickupAt: timeOrder.pickup.toISOString(),
          returnAt: timeOrder.returnAt.toISOString(),
          status: values.status,
          customerName: values.customerName.trim(),
          customerEmail: values.customerEmail.trim(),
          customerPhone: values.customerPhone.trim(),
          currency: cur.length === 3 ? cur : 'EUR',
          notes: values.notes.trim() === '' ? null : values.notes.trim(),
        };
        if (totalTrim === '') {
          raw.extraLines = ex.lines;
        } else {
          const n = Number.parseInt(totalTrim, 10);
          if (Number.isNaN(n) || n < 0) {
            setSubmitErr(t('desk.res.form.err.totalInvalid'));
            return;
          }
          raw.totalCents = n;
        }
        const oOut = values.odometerOutKm.trim();
        const oIn = values.odometerInKm.trim();
        if (oOut === '') {
          raw.odometerOutKm = null;
        } else {
          const n = Number.parseInt(oOut, 10);
          if (Number.isNaN(n) || n < 0) {
            setSubmitErr(t('desk.res.form.err.odoOut'));
            return;
          }
          raw.odometerOutKm = n;
        }
        if (oIn === '') {
          raw.odometerInKm = null;
        } else {
          const n = Number.parseInt(oIn, 10);
          if (Number.isNaN(n) || n < 0) {
            setSubmitErr(t('desk.res.form.err.odoIn'));
            return;
          }
          raw.odometerInKm = n;
        }
        if (linkedCustomerId !== initialLinkedCustomerId) {
          raw.customerId = linkedCustomerId;
        }
        const p = updateReservationSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson(`/reservations/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(p.data),
        });
      } else {
        const raw: Record<string, unknown> = {
          companyId,
          vehicleId: values.vehicleId,
          pickupStationId: values.pickupStationId,
          returnStationId: values.returnStationId,
          pickupAt: timeOrder.pickup.toISOString(),
          returnAt: timeOrder.returnAt.toISOString(),
          status: values.status,
          customerName: values.customerName.trim(),
          customerEmail: values.customerEmail.trim(),
          customerPhone: values.customerPhone.trim(),
          currency: values.currency.trim().toUpperCase().slice(0, 3) || 'EUR',
        };
        if (totalTrim === '') {
          if (ex.lines.length) {
            raw.extraLines = ex.lines;
          }
        } else {
          const n = Number.parseInt(totalTrim, 10);
          if (Number.isNaN(n) || n < 0) {
            setSubmitErr(t('desk.res.form.err.totalInvalid'));
            return;
          }
          raw.totalCents = n;
        }
        const nts = values.notes.trim();
        if (nts) {
          raw.notes = nts;
        }
        if (linkedCustomerId) {
          raw.customerId = linkedCustomerId;
        }
        const p = createReservationSchema.safeParse(raw);
        if (!p.success) {
          setSubmitErr(translateDeskApiError(JSON.stringify({ message: p.error.flatten() })));
          return;
        }
        await apiJson('/reservations', {
          method: 'POST',
          body: JSON.stringify(p.data),
        });
      }
      onSaved();
      onClose();
    } catch (er) {
      setSubmitErr(er instanceof Error ? er.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  if (isEdit && loading) {
    return (
      <div className="desk-form-panel" role="region" aria-label={t('desk.res.form.aria.edit')}>
        <p className="desk-muted">{t('desk.res.form.loadingReservation')}</p>
        {loadErr && <p className="desk-err">{loadErr}</p>}
      </div>
    );
  }

  if (isEdit && loadErr) {
    return (
      <div className="desk-form-panel" role="region">
        <p className="desk-err">{loadErr}</p>
        <button type="button" onClick={onClose}>
          {t('desk.res.form.close')}
        </button>
      </div>
    );
  }

  const canSubmit = stations.length > 0 && vehicles.length > 0;

  return (
    <div
      className="desk-form-panel"
      role="region"
      aria-label={isEdit ? t('desk.res.form.aria.edit') : t('desk.res.form.aria.new')}
    >
      <h3 style={{ fontSize: '1.05rem', marginTop: 0 }}>
        {isEdit ? t('desk.res.form.title.edit') : t('desk.res.form.title.new')}
      </h3>
      {isEdit && editingSource === 'PUBLIC_WEB' && (
        <p className="desk-muted" style={{ margin: '0.25rem 0 0' }}>
          {t('desk.res.form.sourcePublic')}
        </p>
      )}
      {isEdit && editingSource === 'PARTNER' && (
        <>
          <p className="desk-muted" style={{ margin: '0.25rem 0 0' }}>
            {t('desk.res.form.sourcePartner')}
          </p>
          {partnerKeyInfo ? (
            <p className="desk-muted" style={{ margin: '0.2rem 0 0', fontSize: '0.9rem' }}>
              {t('desk.res.form.partnerApiKeyLine')
                .replace('{name}', partnerKeyInfo.name)
                .replace('{id}', partnerKeyInfo.id)}
            </p>
          ) : null}
        </>
      )}
      {optsLoading && <p className="desk-muted">{t('desk.res.form.loadingOpts')}</p>}
      {optsErr && <p className="desk-err">{optsErr}</p>}
      <form className="desk-form" onSubmit={onSubmit}>
        <div
          className="desk-muted"
          style={{ marginBottom: '0.5rem', fontSize: '0.95rem', lineHeight: 1.4 }}
        >
          <div style={{ fontWeight: 600, color: 'inherit', marginBottom: '0.25rem' }}>
            {t('desk.res.form.linkCustHeading')}
          </div>
          <p style={{ margin: '0 0 0.35rem' }}>
            {t('desk.res.form.linkCustBody')}{' '}
            {linkedCustomerId && (
              <button
                type="button"
                onClick={() => {
                  setLinkedCustomerId(null);
                }}
                style={{ marginLeft: '0.25rem' }}
              >
                {t('desk.res.form.unlink')}
              </button>
            )}
          </p>
          {linkedCustomerId && (
            <>
              <p style={{ margin: '0 0 0.35rem' }}>
                <span style={{ fontWeight: 600 }}>{t('desk.res.form.linked')}</span> —{' '}
                <code style={{ fontSize: '0.85rem' }}>{linkedCustomerId}</code>
              </p>
              {companyId ? (
                <p className="desk-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.88rem' }}>
                  <Link
                    href={`/desk/customers?${new URLSearchParams({
                      companyId,
                      open: linkedCustomerId,
                    }).toString()}`}
                  >
                    {t('desk.reservations.customerProfileLink')}
                  </Link>
                  {' · '}
                  <Link
                    href={`/desk/customers?${new URLSearchParams({
                      companyId,
                      docs: linkedCustomerId,
                    }).toString()}`}
                  >
                    {t('desk.reservations.customerDocumentsLink')}
                  </Link>
                  {' · '}
                  <Link
                    href={`/desk/customers?${new URLSearchParams({
                      companyId,
                      ocrPending: '1',
                      docs: linkedCustomerId,
                    }).toString()}`}
                  >
                    {t('desk.reservations.customerOcrDocsLink')}
                  </Link>
                </p>
              ) : null}
            </>
          )}
          <input
            value={custSearch}
            onChange={(e) => setCustSearch(e.target.value)}
            placeholder={t('desk.res.form.custSearchPh')}
            maxLength={200}
            style={{ maxWidth: '20rem' }}
            disabled={!companyId}
            aria-label={t('desk.res.form.custSearchAria')}
          />
          {custOptions.length > 0 && (
            <ul
              className="desk-muted"
              style={{ listStyle: 'none', padding: 0, margin: '0.35rem 0 0' }}
            >
              {custOptions.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => applyLinkedCustomer(c)} style={{ textAlign: 'left' }}>
                    {c.name} — <code style={{ fontSize: '0.8rem' }}>{c.email}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label>
          {t('desk.res.form.custName')}
          <input
            value={values.customerName}
            onChange={(e) => {
              setField('customerName', e.target.value);
            }}
            required
            maxLength={200}
          />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.res.form.email')}
            <input
              type="email"
              value={values.customerEmail}
              onChange={(e) => {
                setField('customerEmail', e.target.value);
              }}
              required
              maxLength={320}
            />
          </label>
          <label>
            {t('desk.res.form.phone')}
            <input
              value={values.customerPhone}
              onChange={(e) => {
                setField('customerPhone', e.target.value);
              }}
              required
              minLength={3}
              maxLength={40}
            />
          </label>
        </div>
        {emailDupHint && (
          <p className="desk-muted" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
            {t('desk.customers.form.emailDuplicate')}{' '}
            <Link
              href={`/desk/customers?${new URLSearchParams({ open: emailDupHint.id, companyId }).toString()}`}
              style={{ fontWeight: 600 }}
            >
              {t('desk.customers.form.openExisting').replace('{name}', emailDupHint.name)}
            </Link>
            {' · '}
            <button
              type="button"
              onClick={() => applyLinkedCustomer(emailDupHint)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
                fontWeight: 600,
                textDecoration: 'underline',
                color: 'var(--desk-link, #2563eb)',
              }}
            >
              {t('desk.res.form.emailDupApply')}
            </button>
          </p>
        )}
        {phoneDupHint && (
          <p className="desk-muted" style={{ margin: '0 0 0.75rem', fontSize: '0.88rem' }}>
            {t('desk.customers.form.phoneDuplicate')}{' '}
            <Link
              href={`/desk/customers?${new URLSearchParams({ open: phoneDupHint.id, companyId }).toString()}`}
              style={{ fontWeight: 600 }}
            >
              {t('desk.customers.form.openExisting').replace('{name}', phoneDupHint.name)}
            </Link>
            {' · '}
            <button
              type="button"
              onClick={() => applyLinkedCustomer(phoneDupHint)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                font: 'inherit',
                fontWeight: 600,
                textDecoration: 'underline',
                color: 'var(--desk-link, #2563eb)',
              }}
            >
              {t('desk.res.form.emailDupApply')}
            </button>
          </p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.res.form.pickupStation')}
            <select
              value={values.pickupStationId}
              onChange={(e) => {
                setField('pickupStationId', e.target.value);
                clearAvailabilityHint();
              }}
              required
              disabled={!stations.length || lockPickupStation}
            >
              <option value="">{t('desk.res.form.select')}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.res.form.returnStation')}
            <select
              value={values.returnStationId}
              onChange={(e) => {
                setField('returnStationId', e.target.value);
                clearAvailabilityHint();
              }}
              required
              disabled={!stations.length}
            >
              <option value="">{t('desk.res.form.select')}</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.res.form.pickupLocal')}
            <input
              type="datetime-local"
              value={values.pickupAt}
              onChange={(e) => {
                setField('pickupAt', e.target.value);
                clearAvailabilityHint();
              }}
              required
            />
          </label>
          <label>
            {t('desk.res.form.returnLocal')}
            <input
              type="datetime-local"
              value={values.returnAt}
              onChange={(e) => {
                setField('returnAt', e.target.value);
                clearAvailabilityHint();
              }}
              required
            />
          </label>
        </div>
        <div
          className="desk-tool"
          style={{ margin: '0.25rem 0', flexWrap: 'wrap' }}
        >
          <label style={{ minWidth: '12rem' }}>
            {t('desk.res.form.filterClass')}
            <select
              value={values.filterClassId}
              onChange={(e) => {
                setField('filterClassId', e.target.value);
                clearAvailabilityHint();
              }}
            >
              <option value="">{t('desk.res.form.anyClass')}</option>
              {vclasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <div style={{ alignSelf: 'end' }}>
            <button
              type="button"
              onClick={onCheckAvailability}
              disabled={availLoading}
            >
              {availLoading ? t('desk.res.form.checking') : t('desk.res.form.checkAvail')}
            </button>
          </div>
        </div>
        {availabilityHint && <p className="desk-muted" style={{ fontSize: '0.9rem' }}>{availabilityHint}</p>}
        <label>
          {t('desk.res.form.vehicle')}
          <select
            value={values.vehicleId}
            onChange={(e) => {
              setField('vehicleId', e.target.value);
            }}
            required
            disabled={!vehicles.length}
          >
            <option value="">Select…</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.licensePlate} — {v.vehicleClass.name}
                {v.modelLabel ? ` · ${v.modelLabel}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div style={{ margin: '0.5rem 0' }}>
          <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.form.extraHeading')}</p>
          <p className="desk-muted" style={{ margin: '0.2rem 0 0.5rem', fontSize: '0.8rem' }}>
            {t('desk.res.form.extraBlurb')}
          </p>
          {extraLineRows.map((row, i) => (
            <div
              key={i}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 6.5rem auto',
                gap: '0.5rem',
                alignItems: 'end',
                marginBottom: '0.35rem',
              }}
            >
              <label style={{ fontSize: '0.9rem' }}>
                {t('desk.res.form.extraLabel')}
                <input
                  value={row.label}
                  onChange={(e) => {
                    setExtraLineRows((prev) => {
                      const n = [...prev];
                      n[i] = { ...n[i]!, label: e.target.value };
                      return n;
                    });
                  }}
                  readOnly={values.totalCents.trim() !== ''}
                  maxLength={200}
                />
              </label>
              <label style={{ fontSize: '0.9rem' }}>
                {t('desk.res.form.extraCents')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={row.amountCents}
                  onChange={(e) => {
                    setExtraLineRows((prev) => {
                      const n = [...prev];
                      n[i] = { ...n[i]!, amountCents: e.target.value };
                      return n;
                    });
                  }}
                  readOnly={values.totalCents.trim() !== ''}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  setExtraLineRows((prev) => prev.filter((_, j) => j !== i));
                }}
                disabled={values.totalCents.trim() !== ''}
              >
                {t('desk.res.form.remove')}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setExtraLineRows((prev) => [...prev, { label: '', amountCents: '' }]);
            }}
            disabled={values.totalCents.trim() !== ''}
          >
            {t('desk.res.form.addLine')}
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <label>
            {t('desk.res.form.status')}
            <select
              value={values.status}
              onChange={(e) =>
                setField('status', e.target.value as (typeof values)['status'])
              }
            >
              {reservationStatusValues.map((s) => (
                <option key={s} value={s}>
                  {formatDeskReservationStatus(s, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('desk.res.form.totalCents')}
            <input
              type="text"
              inputMode="numeric"
              value={values.totalCents}
              onChange={(e) => {
                setField('totalCents', e.target.value);
              }}
              placeholder={t('desk.res.form.totalPh')}
            />
          </label>
          <label>
            {t('desk.res.form.currency')}
            <input
              value={values.currency}
              onChange={(e) => {
                setField('currency', e.target.value.toUpperCase().slice(0, 3));
              }}
              minLength={3}
              maxLength={3}
              placeholder={t('desk.res.form.currencyPh')}
            />
          </label>
        </div>
        {isEdit && editingId && handoverGate && (
          <div
            style={{
              margin: '0.5rem 0',
              padding: '0.5rem 0.6rem',
              borderRadius: 4,
              border: '1px solid #e2e8f0',
              background: '#fff',
            }}
          >
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.form.gateTitle')}</p>
            <p className="desk-muted" style={{ margin: '0.2rem 0 0.35rem', fontSize: '0.8rem' }}>
              {t('desk.res.form.gateBlurb')}
            </p>
            <ul style={{ margin: '0.25rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
              <li style={{ color: handoverGate.agreementSigned ? 'inherit' : 'crimson' }}>
                {t('desk.res.form.gateSigned')}{' '}
                {handoverGate.agreementSigned ? t('desk.res.form.yes') : t('desk.res.form.no')}
              </li>
              <li
                style={{
                  color:
                    !handoverGate.cargosTransmissionRequired
                      ? 'inherit'
                      : handoverGate.cargosOk
                        ? 'inherit'
                        : 'crimson',
                }}
              >
                {t('desk.res.form.gateCargos')}{' '}
                {!handoverGate.cargosTransmissionRequired
                  ? t('desk.res.form.gateCargosNotReq')
                  : handoverGate.cargosOk
                    ? t('desk.res.form.gateCargosOk')
                    : t('desk.res.form.gateCargosBad')}
                {handoverGate.cargosOverridden && ` ${t('desk.res.form.gateOverrideActive')}`}
              </li>
              {handoverGate.requireIdDocuments && (
                <li style={{ color: handoverGate.idDocumentsOk ? 'inherit' : 'crimson' }}>
                  {t('desk.res.form.gateIdDocs')}{' '}
                  {handoverGate.idDocumentsOk
                    ? handoverGate.requireVerifiedIdDocuments
                      ? t('desk.res.form.gateIdOkVerified')
                      : t('desk.res.form.gateIdOk')
                    : handoverGate.requireVerifiedIdDocuments
                      ? t('desk.res.form.gateIdMissingVerified')
                      : t('desk.res.form.gateIdMissing')}
                </li>
              )}
            </ul>
            {!handoverGate.ready && handoverGate.blockerCodes.length > 0 && (
              <ul className="desk-err" style={{ margin: '0.2rem 0 0.25rem', fontSize: '0.8rem' }}>
                {handoverGate.blockerCodes.map((c) => (
                  <li key={c} style={{ margin: '0.1rem 0' }}>
                    {handoverBlockerLabel(c, t)}
                  </li>
                ))}
              </ul>
            )}
            {cargosHandoverOverrideSnapshot && (
              <p className="desk-muted" style={{ fontSize: '0.8rem', margin: '0.35rem 0' }}>
                {t('desk.res.form.overrideRecorded')}
                {cargosHandoverOverrideSnapshot.at && (
                  <>
                    {' '}
                    {new Date(cargosHandoverOverrideSnapshot.at).toLocaleString(dateLoc)}
                  </>
                )}
                {cargosHandoverOverrideSnapshot.by && (
                  <>
                    {' '}
                    — {cargosHandoverOverrideSnapshot.by.firstName} {cargosHandoverOverrideSnapshot.by.lastName} (
                    {cargosHandoverOverrideSnapshot.by.email})
                  </>
                )}
                {cargosHandoverOverrideSnapshot.reason && (
                  <>
                    <br />
                    <span style={{ display: 'inline-block', marginTop: '0.2rem' }}>
                      {t('desk.res.form.overrideReason')} {cargosHandoverOverrideSnapshot.reason}
                    </span>
                  </>
                )}
              </p>
            )}
            {canWrite && (me.role === 'ADMIN' || me.role === 'BRANCH_MANAGER') && (
              <div style={{ marginTop: '0.35rem' }}>
                <label>
                  <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                    {t('desk.res.form.exceptionLabel')}
                  </span>
                  <textarea
                    value={cargosOverrideInput}
                    onChange={(e) => setCargosOverrideInput(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder={t('desk.res.form.exceptionPh')}
                    style={{ display: 'block', width: '100%', maxWidth: '32rem', marginTop: '0.2rem', fontSize: '0.85rem' }}
                  />
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.3rem' }}>
                  <button
                    type="button"
                    onClick={onRecordCargosHandoverOverride}
                    disabled={cargosOverrideBusy}
                  >
                    {cargosOverrideBusy ? t('desk.res.form.saving') : t('desk.res.form.recordException')}
                  </button>
                  {cargosHandoverOverrideSnapshot && (
                    <button type="button" onClick={onClearCargosHandoverOverride} disabled={cargosOverrideBusy}>
                      {t('desk.res.form.clearException')}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        {isEdit &&
          editingId &&
          returnCompletionGate?.relevant &&
          statusSnapshot === 'IN_PROGRESS' && (
            <div
              style={{
                margin: '0.5rem 0',
                padding: '0.5rem 0.6rem',
                borderRadius: 4,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
              }}
            >
              <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>
                {t('desk.res.form.returnGateTitle')}
              </p>
              <p className="desk-muted" style={{ margin: '0.2rem 0 0.35rem', fontSize: '0.8rem' }}>
                {t('desk.res.form.returnGateBlurb')}
              </p>
              <ul style={{ margin: '0.25rem 0', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                {returnCompletionGate.requireOdometerIn && (
                  <li style={{ color: returnCompletionGate.odometerInOk ? 'inherit' : 'crimson' }}>
                    {t('desk.res.form.returnGateOdo')}{' '}
                    {returnCompletionGate.odometerInOk ? t('desk.res.form.yes') : t('desk.res.form.no')}
                  </li>
                )}
                {returnCompletionGate.requireReturnChecklist && (
                  <li style={{ color: returnCompletionGate.checklistOk ? 'inherit' : 'crimson' }}>
                    {t('desk.res.form.returnGateChecklist')}{' '}
                    {returnCompletionGate.checklistOk ? t('desk.res.form.yes') : t('desk.res.form.no')}
                  </li>
                )}
                {returnCompletionGate.requireFuelIn && (
                  <li style={{ color: returnCompletionGate.fuelInOk ? 'inherit' : 'crimson' }}>
                    {t('desk.res.form.returnGateFuel')}{' '}
                    {returnCompletionGate.fuelInOk ? t('desk.res.form.yes') : t('desk.res.form.no')}
                  </li>
                )}
              </ul>
              {!returnCompletionGate.ready && returnCompletionGate.blockerCodes.length > 0 && (
                <ul className="desk-err" style={{ margin: '0.2rem 0 0.25rem', fontSize: '0.8rem' }}>
                  {returnCompletionGate.blockerCodes.map((c) => (
                    <li key={c} style={{ margin: '0.1rem 0' }}>
                      {returnBlockerLabel(c, t)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        {isEdit && editingId && (
          <ReservationOpsPanel
            reservationId={editingId}
            me={me}
            canWrite={canWrite}
            onSaved={() => void refetchReservationSnapshot()}
          />
        )}
        {isEdit && editingId && (
          <div style={{ margin: '0.5rem 0' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.form.agreementTitle')}</p>
            <p className="desk-muted" style={{ margin: '0.2rem 0 0.5rem', fontSize: '0.8rem' }}>
              {t('desk.res.form.agreementBlurb')}
            </p>
            <label style={{ display: 'block', marginBottom: '0.35rem' }}>
              <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                {t('desk.res.form.agreementTpl')}
              </span>
              <input
                type="text"
                value={agreementTemplateVersion}
                onChange={(e) => setAgreementTemplateVersion(e.target.value)}
                readOnly={!canWrite || agreementStatus === 'SIGNED' || agreementStatus === 'VOID'}
                maxLength={200}
                placeholder={t('desk.res.form.agreementTplPh')}
                style={{ display: 'block', width: '100%', maxWidth: '28rem', marginTop: '0.2rem' }}
              />
            </label>
            {agreementId && (
              <p className="desk-muted" style={{ fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                {t('desk.res.form.agreementStatus')}{' '}
                <code title={agreementStatus ?? undefined}>
                  {agreementStatus ? formatRentalAgreementStatus(agreementStatus, t) : '—'}
                </code>
                {agreementStatus === 'SIGNED' && agreementSignedBy && (
                  <>{` ${t('desk.res.form.signedAs').replace('{name}', agreementSignedBy)}`}</>
                )}
                {agreementStatus === 'SIGNED' && agreementSignedAt && (
                  <> · {new Date(agreementSignedAt).toLocaleString(dateLoc)}</>
                )}
              </p>
            )}
            {agreementStatus === 'SIGNED' && (agreementSignedClientIp || agreementSignedUserAgent) && (
              <p className="desk-muted" style={{ fontSize: '0.8rem', margin: '0 0 0.35rem' }}>
                {t('desk.res.form.evid')}
                {agreementSignedClientIp && (
                  <>
                    {' '}
                    {t('desk.res.form.ip')} <code>{agreementSignedClientIp}</code>
                  </>
                )}
                {agreementSignedUserAgent && (
                  <>
                    {' '}
                    · {t('desk.res.form.ua')}{' '}
                    <code
                      title={agreementSignedUserAgent}
                      style={{ wordBreak: 'break-all' as const }}
                    >
                      {agreementSignedUserAgent.length > 100
                        ? `${agreementSignedUserAgent.slice(0, 100)}…`
                        : agreementSignedUserAgent}
                    </code>
                  </>
                )}
              </p>
            )}
            <textarea
              value={agreementBody}
              onChange={(e) => {
                setAgreementBody(e.target.value);
              }}
              readOnly={
                !canWrite || agreementStatus === 'SIGNED' || agreementStatus === 'VOID'
              }
              rows={8}
              maxLength={500000}
              style={{ width: '100%', fontSize: '0.9rem' }}
            />
            {agreementBody.trim() !== '' && (
              <div className="desk-tool" style={{ marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    const w = window.open('', '_blank', 'noopener,noreferrer');
                    if (!w) {
                      return;
                    }
                    w.document.title = t('desk.res.form.printAgreementTitle');
                    const pre = w.document.createElement('pre');
                    pre.style.whiteSpace = 'pre-wrap';
                    pre.style.fontFamily = 'system-ui, sans-serif';
                    pre.style.padding = '1rem';
                    pre.textContent = agreementBody;
                    w.document.body.appendChild(pre);
                    w.document.close();
                    w.focus();
                    w.print();
                    window.setTimeout(() => {
                      w.close();
                    }, 500);
                  }}
                >
                  {t('desk.res.form.printAgreement')}
                </button>
                <span className="desk-muted" style={{ fontSize: '0.8rem' }}>
                  {t('desk.res.form.attachPrintHint')}
                </span>
              </div>
            )}
            {agreementId && (
              <div style={{ margin: '0.5rem 0' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600 }}>{t('desk.res.form.attachHeading')}</p>
                {agreementAttachments.length === 0 && (
                  <p className="desk-muted" style={{ fontSize: '0.8rem' }}>
                    {t('desk.res.form.noFiles')}
                  </p>
                )}
                {agreementAttachments.length > 0 && (
                  <ul style={{ margin: '0.25rem 0 0.5rem', paddingLeft: '1.2rem' }}>
                    {agreementAttachments.map((f) => (
                      <li key={f.id} style={{ fontSize: '0.9rem' }}>
                        <button
                          type="button"
                          style={{
                            textDecoration: 'underline',
                            cursor: 'pointer',
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            color: 'inherit',
                            font: 'inherit',
                          }}
                          onClick={() => onDownloadAgreementFile(f)}
                        >
                          {f.originalName}
                        </button>
                        <span className="desk-muted">
                          {' '}
                          ({(f.sizeBytes / 1024).toFixed(1)} KB)
                        </span>
                        {canWrite && agreementStatus === 'DRAFT' && (
                          <>
                            {' '}
                            <button
                              type="button"
                              onClick={() => onDeleteAgreementFile(f)}
                              disabled={agreementBusy}
                            >
                              {t('desk.res.form.delete')}
                            </button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canWrite && agreementStatus && agreementStatus !== 'VOID' && (
                  <div style={{ marginTop: '0.25rem' }}>
                    <input
                      ref={agreementFileRef}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      style={{ maxWidth: '100%' }}
                      onChange={onAgreementFileSelected}
                    />
                    {agreementStorageMode === 's3' && (
                      <p className="desk-muted" style={{ fontSize: '0.8rem', margin: '0.3rem 0 0' }}>
                        {t('desk.res.form.s3Presign')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            {canWrite && !agreementId && (
              <div className="desk-form-actions" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={onCreateRentalAgreement}
                  disabled={agreementBusy}
                >
                  {agreementBusy ? t('desk.res.form.creating') : t('desk.res.form.createAgreement')}
                </button>
              </div>
            )}
            {canWrite && agreementId && agreementStatus === 'DRAFT' && (
              <div
                className="desk-form-actions"
                style={{ marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}
              >
                <label style={{ flex: '1 1 12rem' }}>
                  {t('desk.res.form.signName')}
                  <input
                    value={agreementSignName}
                    onChange={(e) => {
                      setAgreementSignName(e.target.value);
                    }}
                    maxLength={200}
                  />
                </label>
                <button
                  type="button"
                  onClick={onSaveRentalAgreementDraft}
                  disabled={agreementBusy}
                >
                  {agreementBusy ? t('desk.res.form.saving') : t('desk.res.form.saveDraft')}
                </button>
                <button
                  type="button"
                  onClick={onSignRentalAgreement}
                  disabled={agreementBusy}
                >
                  {agreementBusy ? t('desk.res.form.signing') : t('desk.res.form.signAgreement')}
                </button>
                <button type="button" onClick={onVoidRentalAgreement} disabled={agreementBusy}>
                  {t('desk.res.form.voidDraft')}
                </button>
              </div>
            )}
            {agreementStatus === 'VOID' && (
              <p className="desk-muted" style={{ fontSize: '0.85rem' }}>
                {t('desk.res.form.agreementVoided')}
              </p>
            )}
            {!canWrite && agreementId && (
              <p className="desk-muted" style={{ fontSize: '0.85rem' }}>
                {t('desk.res.form.readonlyAcct')}
              </p>
            )}
          </div>
        )}
        {isEdit && editingId && (
          <div style={{ margin: '0.5rem 0' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.form.cargosTitle')}</p>
            <p className="desk-muted" style={{ margin: '0.2rem 0 0.5rem', fontSize: '0.8rem' }}>
              {t('desk.res.form.cargosBlurb')}
            </p>
            {cargosSubmissions.length > 0 && (
              <ul style={{ margin: '0 0 0.4rem', paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
                {cargosSubmissions.map((s) => (
                  <li key={s.id}>
                    <code title={s.status}>{formatDeskCargosSubmissionStatus(s.status, t)}</code>
                    {s.processedAt && ` · ${new Date(s.processedAt).toLocaleString(dateLoc)}`}
                    {s.errorMessage && (
                      <span className="desk-err"> — {translateDeskApiErrorLine(s.errorMessage)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <div className="desk-table-actions" style={{ gap: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    void onEnqueueCargos(false);
                  }}
                  disabled={cargosBusy}
                >
                  {cargosBusy ? t('desk.res.form.cargosQueuing') : t('desk.res.form.cargosEnqueue')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onEnqueueCargos(true);
                  }}
                  disabled={cargosBusy}
                >
                  {cargosBusy ? t('desk.res.form.cargosQueuing') : t('desk.res.form.cargosSendNow')}
                </button>
              </div>
            )}
            {!canWrite && cargosSubmissions.length > 0 && (
              <p className="desk-muted" style={{ fontSize: '0.8rem' }}>
                {t('desk.res.form.cargosReadonly')}
              </p>
            )}
          </div>
        )}
        {isEdit && editingId && stripeEnabled && (
          <div className="desk-tool" style={{ margin: '0.35rem 0', flexDirection: 'column', alignItems: 'stretch' }}>
            {refundOkNotice && (
              <p className="desk-ok" role="status" style={{ margin: '0 0 0.35rem' }}>
                {refundOkNotice}
              </p>
            )}
            <p style={{ margin: 0, fontSize: '0.9rem' }} className="desk-muted">
              {t('desk.res.form.stripeBlurb')}
            </p>
            {paidAtSnapshot && (
              <p style={{ margin: '0.35rem 0 0' }} className="desk-muted">
                {t('desk.res.form.paidAt')} {new Date(paidAtSnapshot).toLocaleString(dateLoc)}
              </p>
            )}
            {paidAtSnapshot && canWrite && (
              <div style={{ marginTop: '0.5rem' }}>
                <label className="desk-muted" style={{ fontSize: '0.85rem', display: 'block' }}>
                  {t('desk.res.form.partialRefundRent')}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={refundRentCents}
                    onChange={(e) => {
                      setRefundRentCents(e.target.value);
                    }}
                    placeholder={t('desk.res.form.fullIfEmpty')}
                    style={{ display: 'block', marginTop: '0.25rem', maxWidth: '12rem' }}
                  />
                </label>
                <button
                  type="button"
                  style={{ marginTop: '0.35rem' }}
                  onClick={() => {
                    void onRefundRental();
                  }}
                  disabled={refundBusy}
                >
                  {refundBusy ? t('desk.ui.buttonBusy') : t('desk.res.form.refundRental')}
                </button>
                <p className="desk-muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                  {t('desk.res.form.refundNote')}
                </p>
              </div>
            )}
            {!paidAtSnapshot && (
              <div style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={onOpenStripeCheckout}
                  disabled={payLinkLoading}
                >
                  {payLinkLoading ? t('desk.res.form.creatingLink') : t('desk.res.form.openCheckout')}
                </button>
              </div>
            )}
            <p style={{ margin: '0.75rem 0 0', fontSize: '0.9rem' }} className="desk-muted">
              {t('desk.res.form.depositBlurb')}{' '}
              {defaultDepositCentsHint != null && defaultDepositCentsHint > 0
                ? t('desk.res.form.depositClassEur').replace(
                    '{amount}',
                    (defaultDepositCentsHint / 100).toFixed(2),
                  )
                : t('desk.res.form.depositClassHint')}
            </p>
            <p className="desk-muted" style={{ margin: '0.25rem 0', fontSize: '0.85rem' }}>
              {t('desk.res.form.depositStatus')}{' '}
              <code title={dhs}>{formatDepositHoldStatus(dhs, t)}</code>
              {depositHoldCentsSnapshot != null && depositHoldCentsSnapshot > 0 && (
                <>
                  {t('desk.res.form.depositAmt')} {depositHoldCentsSnapshot}
                </>
              )}
            </p>
            {canOpenDeposit && (
              <label style={{ fontSize: '0.9rem' }}>
                {t('desk.res.form.overrideCents')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={depositAmountInput}
                  onChange={(e) => {
                    setDepositAmountInput(e.target.value);
                  }}
                  placeholder={t('desk.res.form.classDefaultPh')}
                  style={{ display: 'block', marginTop: '0.25rem', maxWidth: '12rem' }}
                />
              </label>
            )}
            {canOpenDeposit && (
              <div style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    void onOpenDepositCheckout();
                  }}
                  disabled={depositLinkLoading}
                >
                  {depositLinkLoading ? t('desk.res.form.creatingLink') : t('desk.res.form.depositOpen')}
                </button>
              </div>
            )}
            {canCaptureOrRelease && (
              <div style={{ marginTop: '0.35rem', maxWidth: '28rem' }}>
                <label className="desk-muted" style={{ fontSize: '0.85rem', display: 'block' }}>
                  {t('desk.res.form.depositCapturePartialLabel')}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={depositCaptureCentsInput}
                    onChange={(e) => setDepositCaptureCentsInput(e.target.value)}
                    style={{ display: 'block', marginTop: '0.25rem', maxWidth: '12rem' }}
                  />
                </label>
                <p className="desk-muted" style={{ fontSize: '0.75rem', margin: '0.2rem 0 0.25rem' }}>
                  {t('desk.res.form.depositCapturePartialHint')}
                </p>
                {damageSuggestedCaptureCents != null && damageSuggestedCaptureCents > 0 && (
                  <button
                    type="button"
                    style={{ fontSize: '0.85rem' }}
                    onClick={() => setDepositCaptureCentsInput(String(damageSuggestedCaptureCents))}
                  >
                    {t('desk.res.form.depositUseDamageSuggestion')} ({damageSuggestedCaptureCents})
                  </button>
                )}
                {damageLineFeesSumCents > 0 && (
                  <button
                    type="button"
                    style={{ fontSize: '0.85rem', marginLeft: '0.35rem' }}
                    onClick={() => setDepositCaptureCentsInput(String(damageLineFeesSumCents))}
                  >
                    {t('desk.res.form.depositUseLinesFeeSum')} ({damageLineFeesSumCents})
                  </button>
                )}
              </div>
            )}
            {canCaptureOrRelease && (
              <div className="desk-form-actions" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    void onCaptureDeposit();
                  }}
                  disabled={depositActionLoading}
                >
                  {depositActionLoading ? t('desk.ui.buttonBusy') : t('desk.res.form.captureDeposit')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onCancelDepositHold();
                  }}
                  disabled={depositActionLoading}
                >
                  {depositActionLoading ? t('desk.ui.buttonBusy') : t('desk.res.form.releaseHold')}
                </button>
              </div>
            )}
            {dhs === 'CAPTURED' && canWrite && (
              <div style={{ marginTop: '0.5rem' }}>
                <label className="desk-muted" style={{ fontSize: '0.85rem', display: 'block' }}>
                  {t('desk.res.form.partialRefundDep')}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={refundDepositCents}
                    onChange={(e) => {
                      setRefundDepositCents(e.target.value);
                    }}
                    placeholder={t('desk.res.form.fullIfEmpty')}
                    style={{ display: 'block', marginTop: '0.25rem', maxWidth: '12rem' }}
                  />
                </label>
                <button
                  type="button"
                  style={{ marginTop: '0.35rem' }}
                  onClick={() => {
                    void onRefundDepositCaptured();
                  }}
                  disabled={refundBusy}
                >
                  {refundBusy ? t('desk.ui.buttonBusy') : t('desk.res.form.refundDepositBtn')}
                </button>
              </div>
            )}
            {!canWrite && dhs !== 'NONE' && (
              <p className="desk-muted" style={{ fontSize: '0.8rem' }}>
                {t('desk.res.form.readonlyDeposit')}
              </p>
            )}
          </div>
        )}
        {isEdit && canWrite && stripeEnabled === false && (
          <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
            {t('desk.res.form.stripeOff')}
          </p>
        )}
        {isEdit && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))',
              gap: '0.75rem',
              maxWidth: '24rem',
            }}
          >
            <label>
              {t('desk.res.form.odoOut')}
              <input
                type="text"
                inputMode="numeric"
                value={values.odometerOutKm}
                onChange={(e) => {
                  setField('odometerOutKm', e.target.value);
                }}
                placeholder={t('desk.res.form.odoOutPh')}
                style={{ display: 'block', marginTop: '0.25rem' }}
              />
            </label>
            <label>
              {t('desk.res.form.odoIn')}
              <input
                type="text"
                inputMode="numeric"
                value={values.odometerInKm}
                onChange={(e) => {
                  setField('odometerInKm', e.target.value);
                }}
                placeholder={t('desk.res.form.odoInPh')}
                style={{ display: 'block', marginTop: '0.25rem' }}
              />
            </label>
            <p
              className="desk-muted"
              style={{ gridColumn: '1 / -1', fontSize: '0.8rem', margin: 0 }}
            >
              {t('desk.res.form.odoBlurb')}
            </p>
          </div>
        )}
        <label>
          {t('desk.res.form.notes')}
          <textarea
            value={values.notes}
            onChange={(e) => {
              setField('notes', e.target.value);
            }}
            maxLength={2000}
            rows={3}
          />
        </label>
        {submitErr && (
          <p className="desk-err" role="alert">
            {submitErr}
          </p>
        )}
        <div className="desk-form-actions">
          <button type="submit" disabled={saving || !canSubmit}>
            {saving ? t('desk.res.form.saving') : isEdit ? t('desk.res.form.save') : t('desk.res.form.create')}
          </button>
          {isEdit && statusSnapshot === 'QUOTE' && (
            <button
              type="button"
              onClick={onDeleteDraft}
              disabled={saving || deleting}
              style={{ color: 'var(--desk-err, #b00020)' }}
            >
              {deleting ? t('desk.res.form.deleting') : t('desk.res.form.deleteDraft')}
            </button>
          )}
          <button type="button" onClick={onClose} disabled={saving || deleting}>
            {t('desk.res.form.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}
