'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePublicLocaleContext } from '../../components/PublicLocaleProvider';
import { fetchPublicJson, getPublicApiBase, postPublicJson } from '../../lib/public-api';
import {
  canOfferPublicRentCheckout,
  describePublicReservationStatus,
  statusBannerStyle,
} from '../../lib/public-reservation-status';

const SS_VIEW_TOKEN = 'carrental_public_view_token';
const SS_RESERVATION_ID = 'carrental_public_reservation_id';

type Catalog = {
  company: { id: string; name: string };
  stations: { id: string; name: string; code: string; city: string; province: string }[];
  vehicleClasses: {
    id: string;
    name: string;
    code: string;
    defaultDailyCents: number | null;
    defaultDepositCents: number | null;
  }[];
  /** B4: counsel-registered notice versions (from `GET /public/catalog`); empty = no public privacy step */
  privacyNotices?: { version: string; policyUrl: string | null; effectiveFrom: string | null }[];
};

type QuoteResult = {
  rentalDays: number;
  subtotalCents: number | null;
  oneWayCents: number;
  totalCents: number | null;
  defaultDepositCents: number | null;
  currency: string;
  pricingModel: string;
};

type AvailResult = { count: number; vehicles: unknown[] };

type QuoteSaveResult = {
  id: string;
  status: string;
  source: 'STAFF' | 'PUBLIC_WEB';
  totalCents: number | null;
  currency: string;
  pickupAt: string;
  returnAt: string;
  companyId: string;
  /** C3: open `/booking/view?token=…` without login */
  publicViewToken: string;
  pickupStation: { id: string; name: string; code: string; city: string };
  returnStation: { id: string; name: string; code: string; city: string };
  vehicleClass?: { name: string; code: string };
};

type ExtraRowDraft = { label: string; amountEur: string };

function tryParseQuoteExtras(
  rows: ExtraRowDraft[],
): { ok: true; lines?: { label: string; amountCents: number }[] } | { ok: false } {
  const lines: { label: string; amountCents: number }[] = [];
  for (const row of rows) {
    const label = row.label.trim();
    const raw = row.amountEur.trim().replace(',', '.');
    if (label === '' && raw === '') {
      continue;
    }
    if (label === '' || raw === '') {
      return { ok: false };
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false };
    }
    lines.push({ label, amountCents: Math.round(n * 100) });
  }
  if (lines.length > 12) {
    return { ok: false };
  }
  return { ok: true, lines: lines.length ? lines : undefined };
}

type BasketLine = {
  tripFp: string;
  vehicleClassId: string;
  classLabel: string;
  quote: QuoteResult;
  availCount: number;
};

const defCompany = process.env.NEXT_PUBLIC_DEFAULT_COMPANY_ID?.trim() ?? '';

function makeTripFp(
  stationId: string,
  pickupAt: string,
  returnAt: string,
  oneWay: boolean,
  puStation: string,
  retStation: string,
): string {
  return [stationId, pickupAt, returnAt, oneWay ? '1' : '0', puStation, retStation].join('|');
}

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

/** Tomorrow 10:00 and the following day 10:00 (local) when inputs are still empty. */
function nextDefaultTripLocal(): { pickup: string; ret: string } {
  const p = new Date();
  p.setDate(p.getDate() + 1);
  p.setHours(10, 0, 0, 0);
  const r = new Date(p);
  r.setDate(r.getDate() + 1);
  r.setHours(10, 0, 0, 0);
  return { pickup: toDatetimeLocalValue(p), ret: toDatetimeLocalValue(r) };
}

function PublicQuotePageContent() {
  const { t, locale } = usePublicLocaleContext();
  const searchParams = useSearchParams();
  const stripeReturn = searchParams.get('stripe');
  const urlCompanyId = searchParams.get('companyId')?.trim() ?? '';

  const [companyId, setCompanyId] = useState(defCompany);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catErr, setCatErr] = useState<string | null>(null);
  const [catLoading, setCatLoading] = useState(false);

  const [stationId, setStationId] = useState('');
  const [classId, setClassId] = useState('');
  const [pickupAt, setPickupAt] = useState('');
  const [returnAt, setReturnAt] = useState('');
  const [puStation, setPuStation] = useState('');
  const [retStation, setRetStation] = useState('');
  const [oneWay, setOneWay] = useState(false);

  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [avail, setAvail] = useState<AvailResult | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyVersion, setPrivacyVersion] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [extras, setExtras] = useState<ExtraRowDraft[]>([]);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [savedQuote, setSavedQuote] = useState<QuoteSaveResult | null>(null);
  const [savedBatch, setSavedBatch] = useState<QuoteSaveResult[] | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [basketErr, setBasketErr] = useState<string | null>(null);
  const [saveBatchLoading, setSaveBatchLoading] = useState(false);
  const [stripeOk, setStripeOk] = useState<boolean | null>(null);
  const [payErr, setPayErr] = useState<string | null>(null);
  const [payLoadingId, setPayLoadingId] = useState<string | null>(null);
  const [stripeRestoreToken, setStripeRestoreToken] = useState<string | null>(null);

  const tripFp = makeTripFp(stationId, pickupAt, returnAt, oneWay, puStation, retStation);
  const tripFpRef = useRef(tripFp);
  useEffect(() => {
    if (tripFpRef.current !== tripFp && basket.length > 0) {
      setBasket([]);
      setBasketErr(t('quote.basket.clearedTripChanged'));
    }
    tripFpRef.current = tripFp;
  }, [tripFp, basket.length, t]);

  const loadCatalog = useCallback(async (companyIdOverride?: string) => {
    const cid = (companyIdOverride ?? companyId).trim();
    if (!cid || !/^[0-9a-f-]{36}$/i.test(cid)) {
      setCatErr(t('quote.err.invalidCompanyUuid'));
      return;
    }
    setCatLoading(true);
    setCatErr(null);
    try {
      const c = await fetchPublicJson<Catalog>(`/public/catalog?companyId=${encodeURIComponent(cid)}`);
      setCatalog(c);
      setBasket([]);
      setBasketErr(null);
      setSavedBatch(null);
      if (c.stations[0]) {
        setStationId(c.stations[0].id);
        setPuStation(c.stations[0].id);
        setRetStation(c.stations[0].id);
      }
      if (c.vehicleClasses[0]) {
        setClassId(c.vehicleClasses[0].id);
      }
      const defaultTrip = nextDefaultTripLocal();
      setPickupAt((cur) => (cur ? cur : defaultTrip.pickup));
      setReturnAt((cur) => (cur ? cur : defaultTrip.ret));
    } catch (e) {
      setCatalog(null);
      setCatErr(e instanceof Error ? e.message : t('quote.err.catalogFailed'));
    } finally {
      setCatLoading(false);
    }
  }, [companyId, t]);

  const urlCompanySyncedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlCompanyId || !/^[0-9a-f-]{36}$/i.test(urlCompanyId)) {
      return;
    }
    if (urlCompanySyncedRef.current === urlCompanyId) {
      return;
    }
    urlCompanySyncedRef.current = urlCompanyId;
    setCompanyId(urlCompanyId);
    void loadCatalog(urlCompanyId);
  }, [urlCompanyId, loadCatalog]);

  useEffect(() => {
    if (!catalog) {
      return;
    }
    const pn = catalog.privacyNotices ?? [];
    if (pn.length < 1) {
      setPrivacyVersion('');
      setPrivacyAccepted(false);
      return;
    }
    setPrivacyVersion(pn[0]!.version);
    setPrivacyAccepted(false);
  }, [catalog]);

  const defCatalogLoaded = useRef(false);
  useEffect(() => {
    if (!defCompany || defCatalogLoaded.current) return;
    if (urlCompanyId && /^[0-9a-f-]{36}$/i.test(urlCompanyId)) {
      defCatalogLoaded.current = true;
      return;
    }
    defCatalogLoaded.current = true;
    void loadCatalog();
  }, [defCompany, loadCatalog, urlCompanyId]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (stripeReturn !== 'rental_success' && stripeReturn !== 'rental_cancel') {
      return;
    }
    try {
      const viewTok = sessionStorage.getItem(SS_VIEW_TOKEN);
      if (viewTok) {
        setStripeRestoreToken(viewTok);
      }
    } catch {
      /* storage blocked */
    }
  }, [stripeReturn]);

  useEffect(() => {
    void (async () => {
      try {
        const s = await fetchPublicJson<{ stripe: boolean }>('/payments/stripe/status');
        setStripeOk(s.stripe);
      } catch {
        setStripeOk(false);
      }
    })();
  }, []);

  function quoteConsentBody(): { privacyNoticeVersion?: string; marketingEmailOptIn: boolean } {
    const pn = catalog?.privacyNotices ?? [];
    const marketingEmailOptIn = marketingOptIn;
    if (pn.length < 1) {
      return { marketingEmailOptIn };
    }
    const v = privacyVersion.trim() || pn[0]!.version;
    return { privacyNoticeVersion: v, marketingEmailOptIn };
  }

  async function handleGetEstimate() {
    setRunErr(null);
    setBasketErr(null);
    setQuote(null);
    setAvail(null);
    if (!companyId) {
      setRunErr(t('quote.err.companyFirst'));
      return;
    }
    const pD = new Date(pickupAt);
    const rD = new Date(returnAt);
    if (Number.isNaN(pD.getTime()) || Number.isNaN(rD.getTime()) || pD >= rD) {
      setRunErr(t('quote.err.pickupReturn'));
      return;
    }
    if (!stationId || !classId) {
      setRunErr(t('quote.err.stationClass'));
      return;
    }
    setRunLoading(true);
    try {
      const pms = new URLSearchParams({
        companyId,
        vehicleClassId: classId,
        pickupAt: pD.toISOString(),
        returnAt: rD.toISOString(),
      });
      if (oneWay) {
        pms.set('pickupStationId', puStation);
        pms.set('returnStationId', retStation);
      }
      const q = await fetchPublicJson<QuoteResult>(`/public/quote?${pms.toString()}`);
      setQuote(q);
      const avP = new URLSearchParams({
        companyId,
        stationId,
        from: pD.toISOString(),
        to: rD.toISOString(),
        vehicleClassId: classId,
      });
      const av = await fetchPublicJson<AvailResult>(`/public/availability/vehicles?${avP.toString()}`);
      setAvail(av);
    } catch (e) {
      setRunErr(e instanceof Error ? e.message : t('quote.err.runFailed'));
    } finally {
      setRunLoading(false);
    }
  }

  function addToBasket() {
    setBasketErr(null);
    if (!quote || avail == null || !catalog) {
      return;
    }
    if (avail.count < 1) {
      setBasketErr(t('quote.err.noAvailability'));
      return;
    }
    if (basket.length >= 6) {
      setBasketErr(t('quote.basket.maxLines'));
      return;
    }
    if (basket.some((b) => b.vehicleClassId === classId)) {
      setBasketErr(t('quote.basket.duplicateClass'));
      return;
    }
    const cls = catalog.vehicleClasses.find((c) => c.id === classId);
    setBasket((prev) => [
      ...prev,
      {
        tripFp: makeTripFp(stationId, pickupAt, returnAt, oneWay, puStation, retStation),
        vehicleClassId: classId,
        classLabel: cls ? `${cls.name} (${cls.code})` : classId,
        quote: { ...quote },
        availCount: avail.count,
      },
    ]);
  }

  function removeBasketLine(vehicleClassId: string) {
    setBasket((prev) => prev.filter((b) => b.vehicleClassId !== vehicleClassId));
    setBasketErr(null);
  }

  function clearBasket() {
    setBasket([]);
    setBasketErr(null);
  }

  async function handleSaveBatch() {
    setSaveErr(null);
    setSavedQuote(null);
    if (basket.length < 1) {
      return;
    }
    if (!companyId) {
      setSaveErr(t('quote.err.companyFirst'));
      return;
    }
    const fp = makeTripFp(stationId, pickupAt, returnAt, oneWay, puStation, retStation);
    if (basket.some((b) => b.tripFp !== fp)) {
      setSaveErr(t('quote.basket.tripMismatch'));
      return;
    }
    const pD = new Date(pickupAt);
    const rD = new Date(returnAt);
    if (Number.isNaN(pD.getTime()) || Number.isNaN(rD.getTime()) || pD >= rD) {
      setSaveErr(t('quote.err.pickupReturn'));
      return;
    }
    const nameT = customerName.trim();
    const emailT = customerEmail.trim();
    const phoneT = customerPhone.trim();
    if (nameT.length < 1 || !emailT || phoneT.length < 3) {
      setSaveErr(t('quote.err.saveContact'));
      return;
    }
    const extrasParsedBatch = tryParseQuoteExtras(extras);
    if (!extrasParsedBatch.ok) {
      setSaveErr(t('quote.extras.errInvalid'));
      return;
    }
    if ((catalog?.privacyNotices?.length ?? 0) > 0 && !privacyAccepted) {
      setSaveErr(t('quote.err.privacyRequired'));
      return;
    }
    setSaveBatchLoading(true);
    try {
      const out = await postPublicJson<{ reservations: QuoteSaveResult[] }>('/public/quote-reservations/batch', {
        companyId,
        stationId,
        pickupStationId: oneWay ? puStation : stationId,
        returnStationId: oneWay ? retStation : stationId,
        pickupAt: pD.toISOString(),
        returnAt: rD.toISOString(),
        customerName: nameT,
        customerEmail: emailT,
        customerPhone: phoneT,
        notes: notes.trim() || undefined,
        ...quoteConsentBody(),
        ...(extrasParsedBatch.lines ? { extraLines: extrasParsedBatch.lines } : {}),
        lines: basket.map((b) => ({ vehicleClassId: b.vehicleClassId })),
      });
      setSavedBatch(out.reservations);
      setBasket([]);
      setBasketErr(null);
      try {
        const first = out.reservations[0];
        if (first?.publicViewToken) {
          sessionStorage.setItem(SS_VIEW_TOKEN, first.publicViewToken);
        }
        if (first?.id) {
          sessionStorage.setItem(SS_RESERVATION_ID, first.id);
        }
      } catch {
        /* private mode */
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : t('quote.err.saveFailed'));
    } finally {
      setSaveBatchLoading(false);
    }
  }

  async function handleSaveQuote() {
    setSaveErr(null);
    setSavedQuote(null);
    setSavedBatch(null);
    if (!companyId) {
      setSaveErr(t('quote.err.companyFirst'));
      return;
    }
    const pD = new Date(pickupAt);
    const rD = new Date(returnAt);
    if (Number.isNaN(pD.getTime()) || Number.isNaN(rD.getTime()) || pD >= rD) {
      setSaveErr(t('quote.err.pickupReturn'));
      return;
    }
    if (!stationId || !classId) {
      setSaveErr(t('quote.err.stationClass'));
      return;
    }
    const nameT = customerName.trim();
    const emailT = customerEmail.trim();
    const phoneT = customerPhone.trim();
    if (nameT.length < 1 || !emailT || phoneT.length < 3) {
      setSaveErr(t('quote.err.saveContact'));
      return;
    }
    const extrasParsed = tryParseQuoteExtras(extras);
    if (!extrasParsed.ok) {
      setSaveErr(t('quote.extras.errInvalid'));
      return;
    }
    if ((catalog?.privacyNotices?.length ?? 0) > 0 && !privacyAccepted) {
      setSaveErr(t('quote.err.privacyRequired'));
      return;
    }
    if (avail != null && avail.count < 1) {
      setSaveErr(t('quote.err.noAvailability'));
      return;
    }
    setSaveLoading(true);
    try {
      const res = await postPublicJson<QuoteSaveResult>('/public/quote-reservations', {
        companyId,
        vehicleClassId: classId,
        stationId,
        pickupStationId: oneWay ? puStation : stationId,
        returnStationId: oneWay ? retStation : stationId,
        pickupAt: pD.toISOString(),
        returnAt: rD.toISOString(),
        customerName: nameT,
        customerEmail: emailT,
        customerPhone: phoneT,
        notes: notes.trim() || undefined,
        ...quoteConsentBody(),
        ...(extrasParsed.lines ? { extraLines: extrasParsed.lines } : {}),
      });
      setSavedQuote(res);
      try {
        if (res.publicViewToken) {
          sessionStorage.setItem(SS_VIEW_TOKEN, res.publicViewToken);
        }
        sessionStorage.setItem(SS_RESERVATION_ID, res.id);
      } catch {
        /* private mode */
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : t('quote.err.saveFailed'));
    } finally {
      setSaveLoading(false);
    }
  }

  async function startPublicCardPaymentFor(reservationId: string) {
    const em = customerEmail.trim();
    if (!em.includes('@')) {
      setPayErr(t('quote.err.payEmail'));
      return;
    }
    setPayErr(null);
    setPayLoadingId(reservationId);
    try {
      const out = await postPublicJson<{ url: string; sessionId: string }>(
        `/payments/stripe/public/reservations/${encodeURIComponent(reservationId)}/rental-checkout`,
        { customerEmail: em },
      );
      window.location.assign(out.url);
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : t('quote.err.payStartFailed'));
    } finally {
      setPayLoadingId(null);
    }
  }

  function renderPaySection(q: QuoteSaveResult, opts?: { subtitle?: string }) {
    const st = describePublicReservationStatus(q.status, locale);
    const showPay = Boolean(stripeOk && canOfferPublicRentCheckout(q.status, q.totalCents));
    const payBusy = payLoadingId === q.id;
    return (
      <div style={{ marginTop: '1rem' }}>
        {opts?.subtitle && (
          <p className="desk-muted" style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>
            {opts.subtitle}
          </p>
        )}
        <div style={statusBannerStyle(st.tone)}>
          <strong style={{ display: 'block', marginBottom: 4 }}>{st.label}</strong>
          {st.summary}
        </div>
        <p className="desk-muted" style={{ marginTop: '0.75rem' }}>
          {t('quote.saved.refLabel')} <code>{q.id}</code>
          {q.vehicleClass && (
            <>
              {' '}
              — {q.vehicleClass.name} ({q.vehicleClass.code})
            </>
          )}
          {q.totalCents != null && (
            <>
              {' '}
              — {t('quote.saved.rentIndicated')} {q.currency} {(q.totalCents / 100).toFixed(2)}
            </>
          )}
          . {t('quote.saved.statusNote')}{' '}
          <Link
            href={`/auth?next=${encodeURIComponent('/desk/reservations?source=PUBLIC_WEB')}`}
            style={{ whiteSpace: 'nowrap' }}
          >
            {t('quote.saved.staffSignIn')}
          </Link>
        </p>
        {q.publicViewToken && (
          <p style={{ marginTop: '0.5rem' }}>
            <Link href={`/booking/view?token=${encodeURIComponent(q.publicViewToken)}`} style={{ fontWeight: 600 }}>
              {t('quote.saved.viewBooking')}
            </Link>{' '}
            <span className="desk-muted" style={{ fontSize: '0.88rem' }}>
              {t('quote.saved.viewBookingSub')}
            </span>
          </p>
        )}
        <div style={{ marginTop: '1rem' }}>
          <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', fontWeight: 600 }}>{t('quote.pay.heading')}</p>
          {stripeOk === null ? (
            <p className="desk-muted" style={{ fontSize: '0.88rem', margin: 0 }}>
              {t('quote.pay.checking')}
            </p>
          ) : showPay ? (
            <>
              <button
                type="button"
                className="quote-cta-pay"
                onClick={() => void startPublicCardPaymentFor(q.id)}
                disabled={payLoadingId != null}
              >
                {payBusy
                  ? t('quote.pay.opening')
                  : `${t('quote.pay.withCardVerb')} ${q.currency} ${((q.totalCents ?? 0) / 100).toFixed(2)} ${t('quote.pay.withCardTail')}`}
              </button>
              <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: '0.45rem', maxWidth: '36rem' }}>
                {t('quote.pay.sameEmailBefore')} <strong>{t('quote.pay.sameEmailWord')}</strong>{' '}
                {t('quote.pay.sameEmailAfter')}
              </p>
            </>
          ) : (
            <ul className="desk-muted" style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.88rem' }}>
              {stripeOk === false && <li>{t('quote.pay.stripeOff')}</li>}
              {stripeOk === true && !canOfferPublicRentCheckout(q.status, q.totalCents) && (
                <>
                  {q.totalCents == null || q.totalCents < 1 ? (
                    <li>{t('quote.pay.amountMissing')}</li>
                  ) : (
                    <li>
                      {t('quote.pay.wrongStatusBefore')}{' '}
                      <span title={q.status}>
                        <strong>{st.label}</strong>
                      </span>{' '}
                      {t('quote.pay.wrongStatusAfter')}
                    </li>
                  )}
                </>
              )}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return (
    <main className="public-page">
      <h1>{t('quote.title')}</h1>
      <p className="desk-muted public-lead">
        <strong>{t('quote.oneClassStrong')}</strong> {t('quote.oneClassTail')}
      </p>
      <p className="desk-muted public-lead" style={{ marginTop: '0.35rem' }}>
        {t('quote.basket.lead')}
      </p>

      {stripeReturn === 'rental_success' && (
        <div role="status" style={{ ...statusBannerStyle('success'), marginBottom: '1rem' }}>
          <strong>{t('quote.stripe.successStrong')}</strong> {t('quote.stripe.successWait')}
          {stripeRestoreToken ? (
            <p style={{ margin: '0.65rem 0 0' }}>
              <Link
                href={`/booking/view?token=${encodeURIComponent(stripeRestoreToken)}`}
                style={{ fontWeight: 600 }}
              >
                {t('quote.stripe.viewBookingLink')}
              </Link>{' '}
              {t('quote.stripe.viewBookingForLine')}
            </p>
          ) : (
            <p className="desk-muted" style={{ margin: '0.5rem 0 0', fontSize: '0.88rem' }}>
              {t('quote.stripe.viewBookingHint')}
            </p>
          )}
        </div>
      )}
      {stripeReturn === 'rental_cancel' && (
        <div role="status" style={{ ...statusBannerStyle('warn'), marginBottom: '1rem' }}>
          <strong>{t('quote.stripe.cancelStrong')}</strong> {t('quote.stripe.cancelBodyStart')}{' '}
          <strong>{t('quote.stripe.payRentWithCard')}</strong> {t('quote.stripe.cancelBodyEnd')}
          {stripeRestoreToken && (
            <p style={{ margin: '0.65rem 0 0' }}>
              <Link href={`/booking/view?token=${encodeURIComponent(stripeRestoreToken)}`}>
                {t('quote.stripe.bookingSummaryLink')}
              </Link>
            </p>
          )}
        </div>
      )}

      <p className="desk-muted">
        {t('quote.flow.prefix')}{' '}
        <strong>{t('quote.flow.estimate')}</strong> → <strong>{t('quote.flow.save')}</strong> {t('quote.flow.holdsFree')} →{' '}
        {t('quote.flow.optional')} <strong>{t('quote.flow.payRent')}</strong> {t('quote.flow.sameEmailStripe')}{' '}
        <Link href="/desk">{t('home.desk')}</Link>.
        <br />
        {t('quote.flow.apiBase')} <code>{getPublicApiBase()}</code>
      </p>
      <p>
        <Link href="/">{t('booking.nav.home')}</Link> · <Link href="/auth">{t('quote.nav.staffSignIn')}</Link>
      </p>

      <section style={{ margin: '1.5rem 0' }}>
        <h2 style={{ fontSize: '1.1rem' }}>{t('quote.company.heading')}</h2>
        <div className="desk-form" style={{ maxWidth: 480 }}>
          <label>
            {t('quote.company.idLabel')}
            <input
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
              }}
              placeholder={t('quote.company.idPlaceholder')}
              spellCheck={false}
            />
          </label>
        </div>
        <button type="button" onClick={() => void loadCatalog()} disabled={catLoading} style={{ marginTop: 8 }}>
          {catLoading ? t('quote.catalog.loadingShort') : t('quote.catalog.loadBtn')}
        </button>
        {catErr && <p className="desk-err">{catErr}</p>}
        {catalog && (
          <p className="desk-muted" style={{ marginTop: 8 }}>
            <strong>{catalog.company.name}</strong> — {catalog.stations.length} {t('quote.catalog.stations')},{' '}
            {catalog.vehicleClasses.length} {t('quote.catalog.classes')}.
          </p>
        )}
      </section>

      {catalog && (
        <section className="desk-form desk-form-panel" style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t('quote.trip.heading')}</h2>
          <label>
            {t('quote.trip.homeStation')}
            <select
              value={stationId}
              onChange={(e) => {
                setStationId(e.target.value);
              }}
            >
              {catalog.stations.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code}) — {s.city}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('quote.trip.vehicleClass')}
            <select
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
              }}
            >
              {catalog.vehicleClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('quote.trip.pickup')}
            <input
              type="datetime-local"
              value={pickupAt}
              onChange={(e) => {
                setPickupAt(e.target.value);
              }}
            />
          </label>
          <label>
            {t('quote.trip.return')}
            <input
              type="datetime-local"
              value={returnAt}
              onChange={(e) => {
                setReturnAt(e.target.value);
              }}
            />
          </label>
          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={oneWay} onChange={(e) => setOneWay(e.target.checked)} />
            <span>{t('quote.trip.oneWay')}</span>
          </label>
          {oneWay && (
            <div style={{ display: 'grid', gap: 8 }}>
              <label>
                {t('quote.trip.pickupBranch')}
                <select value={puStation} onChange={(e) => setPuStation(e.target.value)}>
                  {catalog.stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t('quote.trip.returnBranch')}
                <select value={retStation} onChange={(e) => setRetStation(e.target.value)}>
                  {catalog.stations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <div className="desk-form-actions">
            <button type="button" onClick={() => void handleGetEstimate()} disabled={runLoading}>
              {runLoading ? t('quote.trip.estimating') : t('quote.trip.getEstimate')}
            </button>
          </div>
        </section>
      )}

      {runErr && <p className="desk-err">{runErr}</p>}

      {quote && (
        <section className="desk-form-panel" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t('quote.step1.heading')}</h2>
          <ul>
            <li>
              {t('quote.step1.billingDays')} {quote.rentalDays}
            </li>
            {quote.subtotalCents != null && (
              <li>
                {t('quote.step1.subtotal')} €{(quote.subtotalCents / 100).toFixed(2)}
              </li>
            )}
            {quote.oneWayCents > 0 && (
              <li>
                {t('quote.step1.oneWay')} €{(quote.oneWayCents / 100).toFixed(2)}
              </li>
            )}
            {quote.totalCents != null && (
              <li>
                {t('quote.step1.total')} €{(quote.totalCents / 100).toFixed(2)}
              </li>
            )}
            {quote.defaultDepositCents != null && quote.defaultDepositCents > 0 && (
              <li className="desk-muted">
                {t('quote.step1.defaultDeposit')} €{(quote.defaultDepositCents / 100).toFixed(2)}
              </li>
            )}
            <li className="desk-muted" style={{ fontSize: '0.9rem' }}>
              {quote.pricingModel} {t('quote.step1.notContract')}
            </li>
          </ul>
        </section>
      )}

      {avail && (
        <section style={{ marginTop: '1rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t('quote.avail.heading')}</h2>
          <p>
            <strong>{avail.count}</strong> {t('quote.avail.suffix')}
          </p>
        </section>
      )}

      {catalog && quote && avail != null && avail.count >= 1 && (
        <div className="desk-form-actions" style={{ marginTop: '0.75rem' }}>
          <button type="button" onClick={() => addToBasket()}>
            {t('quote.basket.add')}
          </button>
          {basketErr && (
            <p className="desk-err" style={{ margin: '0.5rem 0 0' }}>
              {basketErr}
            </p>
          )}
        </div>
      )}

      {basket.length > 0 && (
        <section className="desk-form-panel" style={{ marginTop: '1.25rem', maxWidth: 520 }}>
          <h2 style={{ fontSize: '1.1rem', marginTop: 0 }}>{t('quote.basket.heading')}</h2>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            {t('quote.basket.intro').replace('{count}', String(basket.length))}
          </p>
          <ul style={{ margin: '0.5rem 0', paddingLeft: '1.2rem' }}>
            {basket.map((b) => (
              <li key={b.vehicleClassId} style={{ marginBottom: 6 }}>
                <strong>{b.classLabel}</strong>
                {b.quote.totalCents != null && (
                  <span className="desk-muted">
                    {' '}
                    — €{(b.quote.totalCents / 100).toFixed(2)} · {b.availCount}{' '}
                    {t('quote.basket.availHint')}
                  </span>
                )}
                <div style={{ marginTop: 4 }}>
                  <button type="button" onClick={() => removeBasketLine(b.vehicleClassId)}>
                    {t('quote.basket.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => clearBasket()} style={{ marginTop: 4 }}>
            {t('quote.basket.clear')}
          </button>
        </section>
      )}

      {catalog && (basket.length > 0 || (quote && avail != null)) && (
        <section className="desk-form desk-form-panel" style={{ maxWidth: 520, marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem' }}>{t('quote.save.heading')}</h2>
          <p className="desk-muted" style={{ marginTop: 0 }}>
            {t('quote.save.intro')}
          </p>
          <label>
            {t('quote.save.name')}
            <input
              value={customerName}
              onChange={(e) => {
                setCustomerName(e.target.value);
              }}
              autoComplete="name"
            />
          </label>
          <label>
            {t('quote.save.email')}
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => {
                setCustomerEmail(e.target.value);
              }}
              autoComplete="email"
            />
          </label>
          <label>
            {t('quote.save.phone')}
            <input
              value={customerPhone}
              onChange={(e) => {
                setCustomerPhone(e.target.value);
              }}
              autoComplete="tel"
            />
          </label>
          <label>
            {t('quote.save.notes')}
            <input
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
              }}
            />
          </label>
          <div style={{ marginTop: '0.65rem' }}>
            <h3 style={{ fontSize: '0.98rem', marginBottom: '0.35rem' }}>{t('quote.extras.heading')}</h3>
            <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
              {t('quote.extras.intro')}
            </p>
            <div style={{ display: 'grid', gap: 8 }}>
              {extras.map((row, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 100px auto',
                    gap: 8,
                    alignItems: 'end',
                  }}
                >
                  <label style={{ marginBottom: 0 }}>
                    {t('quote.extras.labelField')}
                    <input
                      value={row.label}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtras((prev) => prev.map((r, i) => (i === idx ? { ...r, label: v } : r)));
                      }}
                      placeholder={t('quote.extras.labelPlaceholder')}
                    />
                  </label>
                  <label style={{ marginBottom: 0 }}>
                    {t('quote.extras.amountEur')}
                    <input
                      inputMode="decimal"
                      value={row.amountEur}
                      onChange={(e) => {
                        const v = e.target.value;
                        setExtras((prev) => prev.map((r, i) => (i === idx ? { ...r, amountEur: v } : r)));
                      }}
                      placeholder="0"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setExtras((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    {t('quote.extras.remove')}
                  </button>                </div>
              ))}
            </div>
            <div className="desk-form-actions" style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setExtras((prev) => [...prev, { label: '', amountEur: '' }])}
                disabled={extras.length >= 12}
              >
                {t('quote.extras.addRow')}
              </button>
            </div>
          </div>
          {catalog && (catalog.privacyNotices?.length ?? 0) > 0 && (
            <div style={{ marginTop: '0.65rem' }}>
              <h3 style={{ fontSize: '0.98rem', marginBottom: '0.35rem' }}>{t('quote.b4.heading')}</h3>
              <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: 0 }}>
                {t('quote.b4.counselHint')}
              </p>
              {(catalog.privacyNotices!.length > 1) && (
                <label style={{ marginTop: '0.5rem' }}>
                  {t('quote.b4.versionLabel')}
                  <select
                    value={privacyVersion}
                    onChange={(e) => {
                      setPrivacyVersion(e.target.value);
                      setPrivacyAccepted(false);
                    }}
                  >
                    {catalog.privacyNotices!.map((n) => (
                      <option key={n.version} value={n.version}>
                        {n.version}
                        {n.effectiveFrom
                          ? ` (${new Date(n.effectiveFrom).toLocaleDateString(
                              locale === 'it' ? 'it-IT' : 'en-GB',
                            )})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: '0.55rem',
                }}
              >
                <input
                  type="checkbox"
                  checked={privacyAccepted}
                  onChange={(e) => setPrivacyAccepted(e.target.checked)}
                />
                <span style={{ lineHeight: 1.35 }}>
                  {t('quote.b4.privacyAccept').replace(
                    '{version}',
                    privacyVersion || catalog.privacyNotices![0]!.version,
                  )}
                  {(() => {
                    const row = catalog.privacyNotices!.find((x) => x.version === privacyVersion);
                    const url = row?.policyUrl?.trim();
                    if (!url) return null;
                    return (
                      <>
                        {' '}
                        <a href={url} target="_blank" rel="noopener noreferrer">
                          {t('quote.b4.privacyLink')}
                        </a>
                      </>
                    );
                  })()}
                </span>
              </label>
            </div>
          )}
          {catalog && (
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: '0.55rem' }}>
              <input
                type="checkbox"
                checked={marketingOptIn}
                onChange={(e) => setMarketingOptIn(e.target.checked)}
              />
              <span>{t('quote.b4.marketing')}</span>
            </label>
          )}
          <div className="desk-form-actions" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              onClick={() => void handleSaveQuote()}
              disabled={
                saveLoading ||
                saveBatchLoading ||
                !(quote && avail != null && avail.count >= 1)
              }
            >
              {saveLoading ? t('quote.save.saving') : t('quote.save.btn')}
            </button>
            <button
              type="button"
              onClick={() => void handleSaveBatch()}
              disabled={saveBatchLoading || saveLoading || basket.length < 1}
            >
              {saveBatchLoading ? t('quote.save.batchSaving') : t('quote.save.batchBtn')}
            </button>
          </div>
          {saveErr && <p className="desk-err">{saveErr}</p>}
          {savedQuote && (
            <div style={{ marginTop: '1rem' }}>
              {renderPaySection(savedQuote)}
              {payErr && <p className="desk-err" style={{ marginTop: '0.5rem' }}>{payErr}</p>}
            </div>
          )}
          {savedBatch && savedBatch.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{t('quote.savedBatch.heading')}</h3>
              <p className="desk-muted" style={{ marginTop: 0, fontSize: '0.9rem' }}>
                {t('quote.savedBatch.blurb')}
              </p>
              {savedBatch.map((row, idx) => (
                <div
                  key={row.id}
                  style={{
                    marginTop: idx === 0 ? '0.75rem' : '1.25rem',
                    paddingTop: idx === 0 ? 0 : '1rem',
                    borderTop: idx === 0 ? undefined : '1px solid rgba(0,0,0,0.12)',
                  }}
                >
                  {renderPaySection(row, {
                    subtitle: t('quote.savedBatch.lineLabel').replace('{n}', String(idx + 1)),
                  })}
                </div>
              ))}
              {payErr && <p className="desk-err" style={{ marginTop: '0.5rem' }}>{payErr}</p>}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function QuotePageSuspenseFallback() {
  const { t } = usePublicLocaleContext();
  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1.5rem' }}>
      <p>{t('quote.loading')}</p>
    </main>
  );
}

export default function PublicQuotePage() {
  return (
    <Suspense fallback={<QuotePageSuspenseFallback />}>
      <PublicQuotePageContent />
    </Suspense>
  );
}
