'use client';

import { useCallback, useEffect, useState } from 'react';
import { defaultOpsChecklistTemplate, type PutReservationDamageInput } from '@car-rental/shared';
import { usePublicLocaleContext } from './PublicLocaleProvider';
import { apiFetch, apiJson } from '../lib/api';
import { fetchPresignedPut } from '../lib/presigned-put';
import { translateDeskApiError } from '../lib/desk-api-error-i18n';
import { formatDeskOpsChecklistItemLabel } from '../lib/desk-ops-checklist-label';
import { clearAccessToken } from '../lib/auth-storage';
import type { Me } from '../lib/me-types';

type OpPhoto = {
  id: string;
  phase: 'HANDOVER' | 'RETURN';
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type DamageView = {
  id: string;
  status: 'DRAFT' | 'CLOSED';
  notes: string | null;
  suggestedCaptureCents: number | null;
  lines: { id: string; area: string; description: string; estimatedFeeCents: number | null; sortOrder: number }[];
  photos: { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: string }[];
};

function sumDmgLineFeeInputs(lines: { fee: string }[]): number {
  let s = 0;
  for (const l of lines) {
    const raw = l.fee.trim();
    if (raw === '') continue;
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) {
      s += n;
    }
  }
  return s;
}

type ResOps = {
  fuelOutPercent: number | null;
  fuelInPercent: number | null;
  handoverChecklistJson: unknown;
  returnChecklistJson: unknown;
  handoverOpsNotes: string | null;
  returnOpsNotes: string | null;
  operationPhotos: OpPhoto[];
  damageReport: DamageView | null;
};

type Checklist = { items: { key: string; label: string; ok: boolean }[] };

function parseChecklist(raw: unknown, template: readonly { key: string; label: string }[]): Checklist {
  if (raw && typeof raw === 'object' && raw !== null && 'items' in raw) {
    const items = (raw as { items: unknown }).items;
    if (Array.isArray(items) && items.length) {
      return { items: items as Checklist['items'] };
    }
  }
  return {
    items: template.map((row) => ({ ...row, ok: false })),
  };
}

export function ReservationOpsPanel({
  reservationId,
  me,
  canWrite,
  onSaved,
}: {
  reservationId: string;
  me: Me;
  canWrite: boolean;
  /** When set, called after ops fields or damage are saved (parent can refetch reservation gates). */
  onSaved?: () => void;
}) {
  const { t } = usePublicLocaleContext();
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingDmg, setSavingDmg] = useState(false);
  const [data, setData] = useState<ResOps | null>(null);
  const [storageMode, setStorageMode] = useState<'local' | 's3' | null>(null);

  const [fuelOut, setFuelOut] = useState('');
  const [fuelIn, setFuelIn] = useState('');
  const [hoCl, setHoCl] = useState<Checklist>(parseChecklist(null, defaultOpsChecklistTemplate));
  const [retCl, setRetCl] = useState<Checklist>(parseChecklist(null, defaultOpsChecklistTemplate));
  const [hoNotes, setHoNotes] = useState('');
  const [retNotes, setRetNotes] = useState('');

  const [dmgNotes, setDmgNotes] = useState('');
  const [dmgStatus, setDmgStatus] = useState<'DRAFT' | 'CLOSED'>('DRAFT');
  const [dmgCap, setDmgCap] = useState('');
  const [dmgLines, setDmgLines] = useState<{ area: string; description: string; fee: string }[]>([
    { area: '', description: '', fee: '' },
  ]);

  function checklistLabel(key: string, fallback: string) {
    return formatDeskOpsChecklistItemLabel(key, fallback, t);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await apiJson<
        ResOps & {
          id: string;
        }
      >(`/reservations/${reservationId}`);
      setData({
        fuelOutPercent: r.fuelOutPercent,
        fuelInPercent: r.fuelInPercent,
        handoverChecklistJson: r.handoverChecklistJson,
        returnChecklistJson: r.returnChecklistJson,
        handoverOpsNotes: r.handoverOpsNotes,
        returnOpsNotes: r.returnOpsNotes,
        operationPhotos: r.operationPhotos ?? [],
        damageReport: r.damageReport,
      });
      setFuelOut(r.fuelOutPercent != null ? String(r.fuelOutPercent) : '');
      setFuelIn(r.fuelInPercent != null ? String(r.fuelInPercent) : '');
      setHoCl(parseChecklist(r.handoverChecklistJson, defaultOpsChecklistTemplate));
      setRetCl(parseChecklist(r.returnChecklistJson, defaultOpsChecklistTemplate));
      setHoNotes(r.handoverOpsNotes ?? '');
      setRetNotes(r.returnOpsNotes ?? '');
      if (r.damageReport) {
        setDmgNotes(r.damageReport.notes ?? '');
        setDmgStatus(r.damageReport.status);
        setDmgCap(
          r.damageReport.suggestedCaptureCents != null ? String(r.damageReport.suggestedCaptureCents) : '',
        );
        setDmgLines(
          r.damageReport.lines.length
            ? r.damageReport.lines.map((l) => ({
                area: l.area,
                description: l.description,
                fee: l.estimatedFeeCents != null ? String(l.estimatedFeeCents) : '',
              }))
            : [{ area: '', description: '', fee: '' }],
        );
      } else {
        setDmgNotes('');
        setDmgStatus('DRAFT');
        setDmgCap('');
        setDmgLines([{ area: '', description: '', fee: '' }]);
      }
      const cfg = await apiJson<{ mode: 'local' | 's3' }>(`/reservations/${reservationId}/ops/storage-config`);
      setStorageMode(cfg.mode);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setLoading(false);
    }
  }, [reservationId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveOps() {
    setSaving(true);
    setErr(null);
    try {
      const fOut = fuelOut.trim() === '' ? null : Number.parseInt(fuelOut, 10);
      const fIn = fuelIn.trim() === '' ? null : Number.parseInt(fuelIn, 10);
      if (fOut != null && (fOut < 0 || fOut > 100)) {
        setErr(t('desk.res.ops.err.fuelOut'));
        return;
      }
      if (fIn != null && (fIn < 0 || fIn > 100)) {
        setErr(t('desk.res.ops.err.fuelIn'));
        return;
      }
      await apiJson(`/reservations/${reservationId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          fuelOutPercent: fOut,
          fuelInPercent: fIn,
          handoverChecklist: hoCl,
          returnChecklist: retCl,
          handoverOpsNotes: hoNotes.trim() === '' ? null : hoNotes.trim(),
          returnOpsNotes: retNotes.trim() === '' ? null : retNotes.trim(),
        }),
      });
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setSaving(false);
    }
  }

  async function saveDamage() {
    setSavingDmg(true);
    setErr(null);
    try {
      const lines = dmgLines
        .filter((l) => l.area.trim() && l.description.trim())
        .map((l) => {
          const fee = l.fee.trim();
          return {
            area: l.area.trim(),
            description: l.description.trim(),
            estimatedFeeCents: fee === '' ? null : Number.parseInt(fee, 10),
          };
        });
      for (const l of lines) {
        if (l.estimatedFeeCents != null && (Number.isNaN(l.estimatedFeeCents) || l.estimatedFeeCents < 0)) {
          setErr(t('desk.res.ops.err.fee'));
          return;
        }
      }
      const cap = dmgCap.trim();
      const body: PutReservationDamageInput = {
        status: dmgStatus,
        notes: dmgNotes.trim() === '' ? null : dmgNotes.trim(),
        suggestedCaptureCents: cap === '' ? null : Number.parseInt(cap, 10),
        lines: lines.map((l) => ({
          area: l.area,
          description: l.description,
          estimatedFeeCents: l.estimatedFeeCents,
        })),
      };
      if (body.suggestedCaptureCents != null && Number.isNaN(body.suggestedCaptureCents)) {
        setErr(t('desk.res.ops.err.suggestedCap'));
        return;
      }
      await apiJson(`/reservations/${reservationId}/ops/damage`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      await load();
      onSaved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setSavingDmg(false);
    }
  }

  async function deleteOpPhoto(photoId: string) {
    if (!canWrite) {
      return;
    }
    setErr(null);
    try {
      await apiJson(`/reservations/${reservationId}/ops/operation-photos/${photoId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function deleteDmgPhoto(photoId: string) {
    if (!canWrite) {
      return;
    }
    setErr(null);
    try {
      await apiJson(`/reservations/${reservationId}/ops/damage/photos/${photoId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function onOpPhotoFile(phase: 'HANDOVER' | 'RETURN', file: File | null) {
    if (!file || !canWrite || me.role === 'READONLY_ACCOUNTING') {
      return;
    }
    setErr(null);
    try {
      if (storageMode === 's3') {
        const presign = await apiJson<{
          photo: { id: string };
          uploadUrl: string;
          headers: Record<string, string>;
        }>(`/reservations/${reservationId}/ops/operation-photos/presign`, {
          method: 'POST',
          body: JSON.stringify({
            phase,
            originalName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });
        const put = await fetchPresignedPut(presign.uploadUrl, file, presign.headers, t);
        if (!put.ok) {
          await apiFetch(`/reservations/${reservationId}/ops/operation-photos/${presign.photo.id}`, {
            method: 'DELETE',
          });
          throw new Error(t('desk.storage.presignPutRejected').replace('{status}', String(put.status)));
        }
        await apiJson(`/reservations/${reservationId}/ops/operation-photos/${presign.photo.id}/complete`, {
          method: 'POST',
        });
      } else {
        const fd = new FormData();
        fd.append('file', file);
        const r = await apiFetch(
          `/reservations/${reservationId}/ops/operation-photos?phase=${encodeURIComponent(phase)}`,
          { method: 'POST', body: fd },
        );
        if (!r.ok) {
          const errTxt = await r.text();
          throw new Error(translateDeskApiError(errTxt || r.statusText));
        }
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function onDmgPhotoFile(file: File | null) {
    if (!file || !canWrite || me.role === 'READONLY_ACCOUNTING') {
      return;
    }
    setErr(null);
    try {
      if (storageMode === 's3') {
        const presign = await apiJson<{
          photo: { id: string };
          uploadUrl: string;
          headers: Record<string, string>;
        }>(`/reservations/${reservationId}/ops/damage/photos/presign`, {
          method: 'POST',
          body: JSON.stringify({
            originalName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
        });
        const put = await fetchPresignedPut(presign.uploadUrl, file, presign.headers, t);
        if (!put.ok) {
          await apiFetch(`/reservations/${reservationId}/ops/damage/photos/${presign.photo.id}`, {
            method: 'DELETE',
          });
          throw new Error(t('desk.storage.presignPutRejected').replace('{status}', String(put.status)));
        }
        await apiJson(`/reservations/${reservationId}/ops/damage/photos/${presign.photo.id}/complete`, {
          method: 'POST',
        });
      } else {
        const fd = new FormData();
        fd.append('file', file);
        const r = await apiFetch(`/reservations/${reservationId}/ops/damage/photos`, { method: 'POST', body: fd });
        if (!r.ok) {
          const errTxt = await r.text();
          throw new Error(translateDeskApiError(errTxt || r.statusText));
        }
      }
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  async function downloadFile(path: string, filename: string) {
    try {
      const r = await apiFetch(path);
      if (r.status === 401) {
        clearAccessToken();
        if (typeof window !== 'undefined') {
          window.location.assign('/auth');
        }
        return;
      }
      if (!r.ok) {
        const errText = await r.text();
        throw new Error(translateDeskApiError(errText || r.statusText));
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    }
  }

  if (loading || !data) {
    return <p className="desk-muted">{t('desk.res.ops.loading')}</p>;
  }

  const modeLabel = storageMode ?? t('desk.fleet.quote.emDash');
  const linesFeeSum = sumDmgLineFeeInputs(dmgLines);

  return (
    <div
      style={{
        margin: '0.5rem 0',
        padding: '0.5rem 0.6rem',
        borderRadius: 4,
        border: '1px solid #e2e8f0',
        background: '#fafbfc',
      }}
    >
      <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.ops.title')}</p>
      <p className="desk-muted" style={{ margin: '0.2rem 0 0.5rem', fontSize: '0.8rem' }}>
        {t('desk.res.ops.intro').replace('{mode}', modeLabel)}
      </p>
      {err && <p className="desk-err" style={{ fontSize: '0.85rem' }}>{err}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))', gap: '0.5rem' }}>
        <label>
          {t('desk.res.ops.fuelOut')}
          <input
            type="number"
            min={0}
            max={100}
            value={fuelOut}
            onChange={(e) => setFuelOut(e.target.value)}
            readOnly={!canWrite}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <label>
          {t('desk.res.ops.fuelIn')}
          <input
            type="number"
            min={0}
            max={100}
            value={fuelIn}
            onChange={(e) => setFuelIn(e.target.value)}
            readOnly={!canWrite}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginTop: '0.5rem' }}>
        <div>
          <p style={{ margin: '0 0 0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>{t('desk.res.ops.hoChecklist')}</p>
          {hoCl.items.map((it) => (
            <label
              key={it.key}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
            >
              <input
                type="checkbox"
                checked={it.ok}
                disabled={!canWrite}
                onChange={(e) => {
                  setHoCl((c) => ({
                    items: c.items.map((i) => (i.key === it.key ? { ...i, ok: e.target.checked } : i)),
                  }));
                }}
              />
              {checklistLabel(it.key, it.label)}
            </label>
          ))}
        </div>
        <div>
          <p style={{ margin: '0 0 0.25rem', fontSize: '0.8rem', fontWeight: 600 }}>{t('desk.res.ops.retChecklist')}</p>
          {retCl.items.map((it) => (
            <label
              key={it.key}
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}
            >
              <input
                type="checkbox"
                checked={it.ok}
                disabled={!canWrite}
                onChange={(e) => {
                  setRetCl((c) => ({
                    items: c.items.map((i) => (i.key === it.key ? { ...i, ok: e.target.checked } : i)),
                  }));
                }}
              />
              {checklistLabel(it.key, it.label)}
            </label>
          ))}
        </div>
      </div>

      <label style={{ display: 'block', marginTop: '0.35rem' }}>
        <span className="desk-muted" style={{ fontSize: '0.8rem' }}>{t('desk.res.ops.hoNotes')}</span>
        <textarea
          value={hoNotes}
          onChange={(e) => setHoNotes(e.target.value)}
          readOnly={!canWrite}
          rows={2}
          style={{ display: 'block', width: '100%', maxWidth: '40rem' }}
        />
      </label>
      <label style={{ display: 'block' }}>
        <span className="desk-muted" style={{ fontSize: '0.8rem' }}>{t('desk.res.ops.retNotes')}</span>
        <textarea
          value={retNotes}
          onChange={(e) => setRetNotes(e.target.value)}
          readOnly={!canWrite}
          rows={2}
          style={{ display: 'block', width: '100%', maxWidth: '40rem' }}
        />
      </label>

      {canWrite && (
        <button type="button" style={{ marginTop: '0.35rem' }} onClick={() => void saveOps()} disabled={saving}>
          {saving ? t('desk.res.ops.saving') : t('desk.res.ops.saveFields')}
        </button>
      )}

      <div style={{ marginTop: '0.6rem' }}>
        <p style={{ margin: '0 0 0.2rem', fontSize: '0.85rem', fontWeight: 600 }}>{t('desk.res.ops.condPhotos')}</p>
        {(['HANDOVER', 'RETURN'] as const).map((ph) => (
          <div key={ph} style={{ marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.8rem', marginRight: '0.35rem' }}>
              {ph === 'HANDOVER' ? t('desk.res.ops.phaseHandover') : t('desk.res.ops.phaseReturn')}:
            </span>
            {canWrite && (
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => void onOpPhotoFile(ph, e.target.files?.[0] ?? null)}
              />
            )}
            <ul style={{ margin: '0.2rem 0', paddingLeft: '1.1rem', fontSize: '0.8rem' }}>
              {data.operationPhotos
                .filter((p) => p.phase === ph)
                .map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        color: '#2563eb',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                      }}
                      onClick={() =>
                        void downloadFile(
                          `/reservations/${reservationId}/ops/operation-photos/${p.id}/file`,
                          p.originalName,
                        )
                      }
                    >
                      {p.originalName}
                    </button>
                        {canWrite && (
                      <button
                        type="button"
                        style={{ marginLeft: '0.35rem' }}
                        onClick={() => void deleteOpPhoto(p.id)}
                      >
                        {t('desk.res.ops.remove')}
                      </button>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </div>

      <p style={{ margin: '0.75rem 0 0.2rem', fontSize: '0.9rem', fontWeight: 600 }}>{t('desk.res.ops.damageTitle')}</p>
      <p className="desk-muted" style={{ margin: '0 0 0.4rem', fontSize: '0.8rem' }}>
        {t('desk.res.ops.damageIntro')}
      </p>
      <label>
        {t('desk.res.ops.dmgStatus')}
        <select
          value={dmgStatus}
          onChange={(e) => setDmgStatus(e.target.value as 'DRAFT' | 'CLOSED')}
          disabled={!canWrite}
        >
          <option value="DRAFT">{t('desk.res.ops.dmg.DRAFT')}</option>
          <option value="CLOSED">{t('desk.res.ops.dmg.CLOSED')}</option>
        </select>
      </label>
      <label style={{ display: 'block' }}>
        {t('desk.res.ops.dmgSuggestedCap')}
        <input
          value={dmgCap}
          onChange={(e) => setDmgCap(e.target.value)}
          readOnly={!canWrite}
          style={{ display: 'block', maxWidth: '12rem' }}
        />
      </label>
      {linesFeeSum > 0 && (
        <p className="desk-muted" style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', maxWidth: '40rem' }}>
          {t('desk.res.ops.linesFeeSum').replace('{n}', String(linesFeeSum))}
          {canWrite && (
            <>
              {' '}
              <button
                type="button"
                style={{ fontSize: '0.82rem' }}
                onClick={() => setDmgCap(String(linesFeeSum))}
              >
                {t('desk.res.ops.applyLinesSumToSuggested')}
              </button>
            </>
          )}
        </p>
      )}
      <label style={{ display: 'block' }}>
        {t('desk.res.ops.dmgNotes')}
        <textarea value={dmgNotes} onChange={(e) => setDmgNotes(e.target.value)} readOnly={!canWrite} rows={2} style={{ width: '100%', maxWidth: '40rem' }} />
      </label>
      {dmgLines.map((l, i) => (
        <div key={i} style={{ borderTop: '1px solid #eee', padding: '0.35rem 0' }}>
          <input
            placeholder={t('desk.res.ops.dmgAreaPh')}
            value={l.area}
            onChange={(e) => {
              const n = [...dmgLines];
              n[i] = { ...n[i]!, area: e.target.value };
              setDmgLines(n);
            }}
            readOnly={!canWrite}
            style={{ display: 'block', width: '100%', maxWidth: '20rem' }}
          />
          <textarea
            placeholder={t('desk.res.ops.dmgDescPh')}
            value={l.description}
            onChange={(e) => {
              const n = [...dmgLines];
              n[i] = { ...n[i]!, description: e.target.value };
              setDmgLines(n);
            }}
            readOnly={!canWrite}
            rows={2}
            style={{ width: '100%', maxWidth: '40rem' }}
          />
          <input
            placeholder={t('desk.res.ops.dmgFeePh')}
            value={l.fee}
            onChange={(e) => {
              const n = [...dmgLines];
              n[i] = { ...n[i]!, fee: e.target.value };
              setDmgLines(n);
            }}
            readOnly={!canWrite}
            style={{ maxWidth: '12rem' }}
          />
        </div>
      ))}
      {canWrite && (
        <button
          type="button"
          onClick={() => setDmgLines((x) => [...x, { area: '', description: '', fee: '' }])}
        >
          {t('desk.res.ops.dmgAddLine')}
        </button>
      )}

      <div style={{ marginTop: '0.35rem' }}>
        <span style={{ fontSize: '0.8rem' }}>{t('desk.res.ops.dmgPhotos')} </span>
        {canWrite && (
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void onDmgPhotoFile(e.target.files?.[0] ?? null)} />
        )}
        <ul style={{ fontSize: '0.8rem' }}>
          {(data.damageReport?.photos ?? []).map((p) => (
            <li key={p.id}>
              <button
                type="button"
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: '#2563eb',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
                onClick={() =>
                  void downloadFile(
                    `/reservations/${reservationId}/ops/damage/photos/${p.id}/file`,
                    p.originalName,
                  )
                }
              >
                {p.originalName}
              </button>
              {canWrite && (
                <button type="button" style={{ marginLeft: '0.35rem' }} onClick={() => void deleteDmgPhoto(p.id)}>
                  {t('desk.res.ops.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {canWrite && (
        <button type="button" style={{ marginTop: '0.35rem' }} onClick={() => void saveDamage()} disabled={savingDmg}>
          {savingDmg ? t('desk.res.ops.saving') : t('desk.res.ops.saveDamage')}
        </button>
      )}
      <details
        className="desk-muted"
        style={{ marginTop: '0.65rem', fontSize: '0.82rem', maxWidth: '42rem' }}
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--desk-fg, inherit)' }}>
          {t('desk.res.ops.f1f2Summary')}
        </summary>
        <p style={{ margin: '0.5rem 0 0.35rem' }}>{t('desk.res.ops.f1f2Lead')}</p>
        <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.45 }}>
          <li>{t('desk.res.ops.f1f2Item1')}</li>
          <li>{t('desk.res.ops.f1f2Item2')}</li>
          <li>{t('desk.res.ops.f1f2Item3')}</li>
          <li>{t('desk.res.ops.f1f2Item4')}</li>
          <li>{t('desk.res.ops.f1f2Item5')}</li>
        </ul>
      </details>
    </div>
  );
}
