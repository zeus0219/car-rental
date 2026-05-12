'use client';

import { useCallback, useState, type FormEvent } from 'react';
import {
  mfaDisableWithCodeSchema,
  mfaEnableWithCodeSchema,
  mfaRegenerateBackupCodesSchema,
} from '@car-rental/shared';
import { apiJson } from '../lib/api';
import type { Me } from '../lib/me-types';
import { usePublicLocaleContext } from './PublicLocaleProvider';

type Props = { me: Me; onMfaChange?: () => void };

type SetupRes = { secretBase32: string; otpauthUrl: string };

type ConfirmRes = { ok: boolean; mfaEnabled: boolean; backupCodes?: string[] };

type RegenRes = { backupCodes: string[] };

export function MfaSettingsPanel({ me, onMfaChange }: Props) {
  const { t } = usePublicLocaleContext();
  const [step, setStep] = useState<'idle' | 'qrcode' | 'confirm' | 'disable' | 'regenerate'>('idle');
  const [setup, setSetup] = useState<SetupRes | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenTotp, setRegenTotp] = useState('');
  const [flashCodes, setFlashCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    onMfaChange?.();
  }, [onMfaChange]);

  if (!me.mfaCanEnable) {
    return null;
  }

  async function onStart() {
    setErr(null);
    setBusy(true);
    try {
      const r = await apiJson<SetupRes>('/auth/mfa/setup', { method: 'POST' });
      setSetup(r);
      setErr(null);
      setStep('qrcode');
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onCancelSetup() {
    setErr(null);
    setBusy(true);
    try {
      await apiJson('/auth/mfa/setup/cancel', { method: 'POST' });
      setSetup(null);
      setStep('idle');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onConfirm(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = mfaEnableWithCodeSchema.safeParse({ code: confirmCode });
    if (!p.success) {
      setErr(t('desk.mfa.err.code6'));
      return;
    }
    setBusy(true);
    try {
      const r = await apiJson<ConfirmRes>('/auth/mfa/setup/confirm', {
        method: 'POST',
        body: JSON.stringify(p.data),
      });
      setSetup(null);
      setConfirmCode('');
      setStep('idle');
      if (r.backupCodes && r.backupCodes.length > 0) {
        setFlashCodes(r.backupCodes);
      }
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onDisable(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = mfaDisableWithCodeSchema.safeParse({ code: disableCode });
    if (!p.success) {
      setErr(t('desk.mfa.err.code6Disable'));
      return;
    }
    setBusy(true);
    try {
      await apiJson('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify(p.data),
      });
      setDisableCode('');
      setStep('idle');
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  async function onRegenerate(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const p = mfaRegenerateBackupCodesSchema.safeParse({ code: regenTotp });
    if (!p.success) {
      setErr(t('desk.mfa.err.code6'));
      return;
    }
    setBusy(true);
    try {
      const r = await apiJson<RegenRes>('/auth/mfa/backup-codes/regenerate', {
        method: 'POST',
        body: JSON.stringify(p.data),
      });
      setRegenTotp('');
      setStep('idle');
      if (r.backupCodes?.length) {
        setFlashCodes(r.backupCodes);
      }
      refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t('desk.err.generic'));
    } finally {
      setBusy(false);
    }
  }

  const backupRemaining =
    me.mfaEnabled === true ? (me.mfaBackupCodesRemaining ?? 0) : undefined;

  return (
    <div className="desk-form-panel" style={{ marginTop: '0.75rem', maxWidth: '36rem' }}>
      <h2 style={{ fontSize: '1.05rem', marginTop: 0 }}>{t('desk.mfa.heading')}</h2>
      <p className="desk-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
        {t('desk.mfa.blurb')}
      </p>

      {flashCodes && (
        <div
          className="desk-tool"
          role="status"
          style={{
            marginTop: '0.75rem',
            flexDirection: 'column',
            alignItems: 'stretch',
            padding: '0.75rem',
            border: '1px solid #cbd5e1',
            borderRadius: 6,
            background: '#f8fafc',
          }}
        >
          <h3 style={{ fontSize: '0.98rem', margin: '0 0 0.5rem' }}>{t('desk.mfa.backupCodesTitle')}</h3>
          <p className="desk-muted" style={{ fontSize: '0.82rem', margin: '0 0 0.5rem' }}>
            {t('desk.mfa.backupCodesWarn')}
          </p>
          <ul
            style={{
              margin: '0.25rem 0 0.75rem',
              paddingLeft: '1.1rem',
              fontFamily: 'ui-monospace, monospace',
              fontSize: '0.88rem',
            }}
          >
            {flashCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <button type="button" onClick={() => setFlashCodes(null)}>
            {t('desk.mfa.backupCodesDone')}
          </button>
        </div>
      )}

      {me.mfaEnabled && step !== 'disable' && step !== 'regenerate' && (
        <p className="desk-muted" style={{ fontSize: '0.88rem', marginTop: '0.5rem' }}>
          <span style={{ marginRight: '0.35rem' }}>{t('desk.mfa.backupRemaining')}</span>
          <strong>{backupRemaining ?? '—'}</strong>
        </p>
      )}

      {me.mfaEnabled && step !== 'disable' && step !== 'regenerate' && (
        <p style={{ marginTop: '0.35rem' }}>
          {t('desk.mfa.statusLabel')} <strong>{t('desk.mfa.enabled')}</strong>
          <button
            type="button"
            style={{ marginLeft: '0.75rem' }}
            onClick={() => {
              setErr(null);
              setStep('disable');
            }}
          >
            {t('desk.mfa.disableBtn')}
          </button>
          <button
            type="button"
            style={{ marginLeft: '0.5rem' }}
            onClick={() => {
              setErr(null);
              setStep('regenerate');
            }}
          >
            {t('desk.mfa.regenerateBtn')}
          </button>
        </p>
      )}

      {me.mfaEnabled && step === 'regenerate' && (
        <form className="desk-form" onSubmit={onRegenerate} style={{ marginTop: '0.5rem' }}>
          <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.35rem' }}>{t('desk.mfa.regenerateHeading')}</h3>
          <p className="desk-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
            {t('desk.mfa.regenerateBlurb')}
          </p>
          <label>
            {t('desk.mfa.code6')}
            <input
              value={regenTotp}
              onChange={(e) => setRegenTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              required
              placeholder={t('auth.codePlaceholder')}
            />
          </label>
          {err && (
            <p className="desk-err" style={{ margin: 0 }}>
              {err}
            </p>
          )}
          <div className="desk-form-actions">
            <button type="submit" disabled={busy}>
              {t('desk.mfa.regenerateSubmit')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('idle');
                setErr(null);
              }}
              disabled={busy}
            >
              {t('desk.mfa.cancel')}
            </button>
          </div>
        </form>
      )}

      {me.mfaEnabled && step === 'disable' && (
        <form className="desk-form" onSubmit={onDisable} style={{ marginTop: '0.5rem' }}>
          <label>
            {t('desk.mfa.code6')}
            <input
              value={disableCode}
              onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder={t('auth.codePlaceholder')}
            />
          </label>
          {err && (
            <p className="desk-err" style={{ margin: 0 }}>
              {err}
            </p>
          )}
          <div className="desk-form-actions">
            <button type="submit" disabled={busy}>
              {t('desk.mfa.confirmDisable')}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('idle');
                setErr(null);
              }}
              disabled={busy}
            >
              {t('desk.mfa.cancel')}
            </button>
          </div>
        </form>
      )}

      {!me.mfaEnabled && step === 'idle' && !setup && (
        <div className="desk-tool" style={{ marginTop: '0.5rem', flexDirection: 'column', alignItems: 'flex-start' }}>
          {me.mfaSetupPending && (
            <p className="desk-muted" style={{ fontSize: '0.9rem' }}>
              {t('desk.mfa.setupPendingMsg')}
            </p>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button type="button" onClick={() => void onStart()} disabled={busy}>
              {me.mfaSetupPending ? t('desk.mfa.continueSetup') : t('desk.mfa.setupAuth')}
            </button>
            {me.mfaSetupPending && (
              <button type="button" onClick={() => void onCancelSetup()} disabled={busy}>
                {t('desk.mfa.cancelSetup')}
              </button>
            )}
          </div>
          {err && (
            <p className="desk-err" style={{ margin: '0.5rem 0 0' }}>
              {err}
            </p>
          )}
        </div>
      )}

      {setup && step === 'qrcode' && (
        <div style={{ marginTop: '0.75rem' }}>
          <p className="desk-muted" style={{ fontSize: '0.85rem' }}>
            {t('desk.mfa.scanHint')}
          </p>
          <p style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem' }}>
            {setup.secretBase32}
          </p>
          <p className="desk-muted" style={{ fontSize: '0.8rem' }}>
            otpauth:{' '}
            <a href={setup.otpauthUrl} style={{ color: 'inherit' }}>
              {t('desk.mfa.addToApp')}
            </a>
          </p>
          <form className="desk-form" onSubmit={onConfirm} style={{ marginTop: '0.5rem' }}>
            <label>
              {t('desk.mfa.confirmCodeLabel')}
              <input
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                maxLength={6}
                required
                placeholder={t('auth.codePlaceholder')}
              />
            </label>
            {err && (
              <p className="desk-err" style={{ margin: 0 }}>
                {err}
              </p>
            )}
            <div className="desk-form-actions">
              <button type="submit" disabled={busy}>
                {t('desk.mfa.enableBtn')}
              </button>
              <button type="button" onClick={() => void onCancelSetup()} disabled={busy}>
                {t('desk.mfa.cancel')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
