import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * C2: optional transactional SMS via Twilio REST (no SDK — fetch + Basic auth).
 * All methods no-op when credentials or feature flags are unset.
 */
@Injectable()
export class SmsService implements OnModuleInit {
  private readonly logger = new Logger(SmsService.name);
  private accountSid: string | null = null;
  private authToken: string | null = null;
  private fromNumber: string | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID')?.trim() ?? '';
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN')?.trim() ?? '';
    const from = this.config.get<string>('TWILIO_FROM_NUMBER')?.trim() ?? '';
    if (!sid || !token || !from) {
      this.logger.log('SMS disabled (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to enable).');
      return;
    }
    this.accountSid = sid;
    this.authToken = token;
    this.fromNumber = from;
    this.logger.log('Twilio SMS enabled.');
  }

  isEnabled(): boolean {
    return this.accountSid !== null && this.authToken !== null && this.fromNumber !== null;
  }

  /** When true with `isEnabled()`, send a short ack after public multi-line quote batch save. */
  isPublicBatchAckEnabled(): boolean {
    const v = this.config.get<string>('SMS_PUBLIC_BATCH_ACK')?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }

  /**
   * Best-effort E.164 for IT numbers often entered without country code.
   * Returns null when normalization is not confident.
   */
  tryNormalizeE164(raw: string | null | undefined): string | null {
    if (raw == null) {
      return null;
    }
    const s = raw.trim().replace(/[\s().-]/g, '');
    if (!s) {
      return null;
    }
    if (s.startsWith('+')) {
      const rest = s.slice(1).replace(/\D/g, '');
      if (rest.length >= 8 && rest.length <= 15) {
        return `+${rest}`;
      }
      return null;
    }
    const digits = s.replace(/\D/g, '');
    if (digits.startsWith('39') && digits.length >= 10 && digits.length <= 13) {
      return `+${digits}`;
    }
    if (digits.startsWith('0') && digits.length >= 10 && digits.length <= 12) {
      const without0 = digits.slice(1);
      if (without0.length >= 9) {
        return `+39${without0}`;
      }
    }
    if (digits.length === 10 && digits.startsWith('3')) {
      return `+39${digits}`;
    }
    return null;
  }

  async sendSms(toE164: string, body: string): Promise<void> {
    if (!this.isEnabled() || !this.accountSid || !this.authToken || !this.fromNumber) {
      return;
    }
    const to = toE164.trim();
    if (!to.startsWith('+') || to.length < 8) {
      this.logger.warn('SMS skipped: To must be E.164 (+…).');
      return;
    }
    const b = body.trim();
    if (!b) {
      return;
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: this.fromNumber, Body: b });
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`, 'utf8').toString('base64');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`Twilio SMS failed (${res.status}): ${text.slice(0, 200)}`);
        return;
      }
      this.logger.log(`SMS sent → ${to}`);
    } catch (e) {
      this.logger.warn(`Twilio SMS error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
