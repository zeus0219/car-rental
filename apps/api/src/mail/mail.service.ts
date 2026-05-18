import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { PrismaService } from '../prisma/prisma.service';

export type PublicQuoteMailArgs = {
  to: string;
  customerName: string;
  reservationId: string;
  companyId: string;
  totalCents: number | null;
  currency: string;
  pickupAt: Date;
  returnAt: Date;
  /** C3: when set, email can include `/booking/view?token=…` if `APP_PUBLIC_BASE_URL` is configured */
  publicViewToken: string | null;
};

export type PublicQuoteBatchLineMail = {
  reservationId: string;
  totalCents: number | null;
  currency: string;
  vehicleClassLabel: string;
  publicViewToken: string;
};

export type PublicQuoteBatchMailArgs = {
  to: string;
  customerName: string;
  companyId: string;
  pickupAt: Date;
  returnAt: Date;
  lines: PublicQuoteBatchLineMail[];
};

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const host = this.config.get<string>('SMTP_HOST')?.trim();
    if (!host) {
      this.logger.log('Transactional email disabled (set SMTP_HOST to enable).');
      return;
    }
    const port = this.config.get<number>('SMTP_PORT') ?? 587;
    const secure =
      this.config.get<string>('SMTP_SECURE') === '1' ||
      this.config.get<string>('SMTP_SECURE') === 'true';
    const user = this.config.get<string>('SMTP_USER')?.trim();
    const pass = this.config.get<string>('SMTP_PASS') ?? '';
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      this.logger.warn('SMTP_HOST is set but SMTP_FROM is missing — email disabled.');
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
    });
    this.logger.log(`Transactional email enabled (SMTP ${host}:${port}).`);
  }

  isEnabled(): boolean {
    return this.transporter !== null;
  }

  private mailDeskCustomerWelcomeEnabled(): boolean {
    const v = this.config.get<string>('MAIL_DESK_CUSTOMER_WELCOME')?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
  }

  private formatMoney(cents: number | null, currency: string): string {
    if (cents == null) {
      return '—';
    }
    const u = currency.toUpperCase();
    return u === 'EUR' ? `€${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${u}`;
  }

  /** Public web URL for C3 read-only booking page; needs `APP_PUBLIC_BASE_URL` (e.g. `https://app.example.com`). */
  private bookingViewUrl(publicViewToken: string | null | undefined): string | null {
    const t = publicViewToken?.trim();
    if (!t) {
      return null;
    }
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    if (!base) {
      return null;
    }
    return `${base}/booking/view?token=${encodeURIComponent(t)}`;
  }

  /**
   * Acknowledge a public-web saved quote (C2 / PRODUCTION-READINESS). Fire-and-forget from caller.
   * No-ops when SMTP is not configured.
   */
  async sendPublicQuoteSaved(args: PublicQuoteMailArgs): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    const viewLine = viewUrl
      ? `\nView your booking (no login, bookmark this link): ${viewUrl}\n`
      : '';
    const linkLine = base
      ? `${viewLine}\nYou can return to the quote page: ${base}/quote\n`
      : viewLine
        ? `${viewLine}\n`
        : '\n';
    const totalLine = this.formatMoney(args.totalCents, args.currency);
    const pickup = args.pickupAt.toISOString();
    const ret = args.returnAt.toISOString();
    const subject = `${orgName} — quote request received`;
    const text = `Hello ${args.customerName},

We have received your online quote request.

Reference: ${args.reservationId}
Company: ${orgName}
Indicative total: ${totalLine}
Pickup: ${pickup}
Return: ${ret}
${linkLine}If you did not request this, you can ignore this message.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>We have received your <strong>online quote request</strong>.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Indicative total:</strong> ${escapeHtml(totalLine)}</li>
<li><strong>Pickup:</strong> ${escapeHtml(pickup)}</li>
<li><strong>Return:</strong> ${escapeHtml(ret)}</li>
</ul>
${viewUrl ? `<p><a href="${escapeHtml(viewUrl)}">View your booking</a> <span style="color:#666">(bookmark — no password)</span></p>` : ''}
${base ? `<p><a href="${escapeHtml(base)}/quote">Return to the quote page</a></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Mail sent: public quote ack → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (public quote ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * When **`MAIL_DESK_CUSTOMER_WELCOME`** is truthy and SMTP is configured, notify the customer after desk creates their CRM row (GDPR: use only with consent / legitimate interest policy).
   */
  async sendDeskCustomerWelcome(args: {
    to: string;
    customerName: string;
    companyId: string;
    customerId: string;
  }): Promise<void> {
    if (!this.transporter || !this.mailDeskCustomerWelcomeEnabled()) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const subject = `${orgName} — we saved your contact details`;
    const text = `Hello ${args.customerName},

${orgName} has added your details to our rental system after contact with our desk.

If you did not expect this message, please reply or contact the branch.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>${escapeHtml(orgName)} has added your details to our rental system after contact with our desk.</p>
<p style="color:#666;font-size:0.9em">If you did not expect this message, please reply or contact the branch.</p>
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Mail sent: desk customer welcome → ${args.to} (${args.customerId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (desk customer welcome ${args.customerId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * C1/C2: one email after public multi-class batch save — lists every reference + class + view link.
   */
  async sendPublicQuoteBatchSaved(args: PublicQuoteBatchMailArgs): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    if (args.lines.length < 2) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    const pickup = args.pickupAt.toISOString();
    const ret = args.returnAt.toISOString();
    const subject = `${orgName} — ${args.lines.length} quote requests received`;
    const textLines = args.lines
      .map((line, i) => {
        const totalLine = this.formatMoney(line.totalCents, line.currency);
        const viewUrl = this.bookingViewUrl(line.publicViewToken);
        const link = viewUrl ? ` — view: ${viewUrl}` : '';
        return `${i + 1}. ${line.vehicleClassLabel} — ref ${line.reservationId} — ${totalLine}${link}`;
      })
      .join('\n');
    const text = `Hello ${args.customerName},

We have received your online quote requests (${args.lines.length} vehicles / classes on the same trip).

Company: ${orgName}
Pickup: ${pickup}
Return: ${ret}

${textLines}

${base ? `Quote page: ${base}/quote\n` : ''}If you did not request this, you can ignore this message.

This is an automated message.`;
    const htmlList = args.lines
      .map((line, i) => {
        const totalLine = escapeHtml(this.formatMoney(line.totalCents, line.currency));
        const viewUrl = this.bookingViewUrl(line.publicViewToken);
        const linkCell = viewUrl
          ? `<a href="${escapeHtml(viewUrl)}">View</a>`
          : '—';
        return `<tr>
<td>${i + 1}</td>
<td>${escapeHtml(line.vehicleClassLabel)}</td>
<td><code>${escapeHtml(line.reservationId)}</code></td>
<td>${totalLine}</td>
<td>${linkCell}</td>
</tr>`;
      })
      .join('\n');
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>We have received your <strong>online quote requests</strong> (<strong>${args.lines.length}</strong> vehicles / classes on the same trip).</p>
<ul>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Pickup:</strong> ${escapeHtml(pickup)}</li>
<li><strong>Return:</strong> ${escapeHtml(ret)}</li>
</ul>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:0.95em">
<thead><tr><th>#</th><th>Class</th><th>Reference</th><th>Indicative</th><th>Booking link</th></tr></thead>
<tbody>${htmlList}</tbody>
</table>
${base ? `<p><a href="${escapeHtml(base)}/quote">Return to the quote page</a></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject,
        text,
        html,
      });
      this.logger.log(`Mail sent: public quote batch ack → ${args.to} (${args.lines.length} lines)`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (public quote batch): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * When desk sets reservation status to CONFIRMED (C2). Skipped when SMTP off or no guest email.
   * Webhook rental-paid email remains separate (Stripe path does not use ReservationService.update).
   */
  async sendReservationConfirmedEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    totalCents: number | null;
    currency: string;
    pickupAt: Date;
    returnAt: Date;
    publicViewToken?: string | null;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const totalLine = this.formatMoney(args.totalCents, args.currency);
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    const viewBlock = viewUrl ? `\nView your booking: ${viewUrl}\n` : '';
    const pickup = args.pickupAt.toISOString();
    const ret = args.returnAt.toISOString();
    const subject = `${orgName} — booking confirmed`;
    const text = `Hello ${args.customerName},

Your rental booking is now confirmed.

Reference: ${args.reservationId}
Company: ${orgName}
Indicative total: ${totalLine}
Pickup: ${pickup}
Return: ${ret}
${viewBlock}If you did not make this booking, contact ${orgName}.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>Your rental booking is now <strong>confirmed</strong>.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Indicative total:</strong> ${escapeHtml(totalLine)}</li>
<li><strong>Pickup:</strong> ${escapeHtml(pickup)}</li>
<li><strong>Return:</strong> ${escapeHtml(ret)}</li>
</ul>
${viewUrl ? `<p><a href="${escapeHtml(viewUrl)}">View your booking</a> <span style="color:#666">(no password)</span></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: reservation confirmed → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (confirmed ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /** Desk-triggered: quote / booking facts for the guest (not a contract). */
  async sendReservationBookingSummaryEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    status: string;
    totalCents: number | null;
    currency: string;
    pickupAt: Date;
    returnAt: Date;
    publicViewToken?: string | null;
    vehicleSummary?: string | null;
    pickupStationLine?: string | null;
    returnStationLine?: string | null;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const totalLine = this.formatMoney(args.totalCents, args.currency);
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    const viewBlock = viewUrl ? `\nView your booking: ${viewUrl}\n` : '';
    const pickup = args.pickupAt.toISOString();
    const ret = args.returnAt.toISOString();
    const vehicleBlock = args.vehicleSummary ? `\nVehicle: ${args.vehicleSummary}\n` : '';
    const pickupSt = args.pickupStationLine ? `\nPickup location: ${args.pickupStationLine}` : '';
    const returnSt = args.returnStationLine ? `\nReturn location: ${args.returnStationLine}` : '';
    const subject = `${orgName} — your rental booking summary`;
    const text = `Hello ${args.customerName},

Here is a summary of your rental booking (for your records). This message is not a rental contract.

Reference: ${args.reservationId}
Company: ${orgName}
Status: ${args.status}
Indicative total: ${totalLine}
Pickup: ${pickup}${pickupSt}
Return: ${ret}${returnSt}${vehicleBlock}${viewBlock}If you did not request this, contact ${orgName}.

This is an automated message.`;
    const vehHtml = args.vehicleSummary
      ? `<li><strong>Vehicle:</strong> ${escapeHtml(args.vehicleSummary)}</li>`
      : '';
    const pickupStHtml = args.pickupStationLine
      ? `<li><strong>Pickup location:</strong> ${escapeHtml(args.pickupStationLine)}</li>`
      : '';
    const returnStHtml = args.returnStationLine
      ? `<li><strong>Return location:</strong> ${escapeHtml(args.returnStationLine)}</li>`
      : '';
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>Here is a <strong>summary</strong> of your rental booking (for your records). This email is <strong>not</strong> a rental contract.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Status:</strong> <code>${escapeHtml(args.status)}</code></li>
<li><strong>Indicative total:</strong> ${escapeHtml(totalLine)}</li>
<li><strong>Pickup:</strong> ${escapeHtml(pickup)}</li>
${pickupStHtml}
<li><strong>Return:</strong> ${escapeHtml(ret)}</li>
${returnStHtml}
${vehHtml}
</ul>
${viewUrl ? `<p><a href="${escapeHtml(viewUrl)}">View your booking</a> <span style="color:#666">(no password)</span></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: reservation booking summary → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (booking summary ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /** Desk: signed rental agreement PDF attachment (not a substitute for qualified e-sign). */
  async sendRentalAgreementPdfEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    agreementTemplateVersion: string | null;
    pdfBytes: Uint8Array;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const tpl = args.agreementTemplateVersion?.trim();
    const tplLine = tpl ? `\nTemplate: ${tpl}` : '';
    const subject = `${orgName} — your signed rental agreement`;
    const text = `Hello ${args.customerName},

Please find your signed rental agreement attached (PDF).

Reservation: ${args.reservationId}
Company: ${orgName}${tplLine}

If you did not expect this email, contact ${orgName}.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>Please find your <strong>signed rental agreement</strong> attached (PDF).</p>
<ul>
<li><strong>Reservation:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
${tpl ? `<li><strong>Template:</strong> ${escapeHtml(tpl)}</li>` : ''}
</ul>
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    const filename = `rental-agreement-${args.reservationId.slice(0, 8)}.pdf`;
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject,
        text,
        html,
        attachments: [
          {
            filename,
            content: Buffer.from(args.pdfBytes),
            contentType: 'application/pdf',
          },
        ],
      });
      this.logger.log(`Mail sent: rental agreement PDF → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (agreement PDF ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * After staff creates a Stripe Checkout session — email the customer the pay link (C2).
   * Skipped when `EMAIL_STRIPE_CHECKOUT_LINKS` is false, or SMTP off, or invalid `to`.
   */
  async sendStripeCheckoutLinkEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    kind: 'RENTAL' | 'DEPOSIT';
    amountCents: number;
    currency: string;
    checkoutUrl: string;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const optOut = this.config.get<string>('EMAIL_STRIPE_CHECKOUT_LINKS')?.trim().toLowerCase();
    if (optOut === '0' || optOut === 'false' || optOut === 'no') {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const amountLine = this.formatMoney(args.amountCents, args.currency);
    const isRent = args.kind === 'RENTAL';
    const title = isRent ? 'Pay for your rental' : 'Security deposit (card hold)';
    const subject = `${orgName} — ${isRent ? 'Payment link' : 'Deposit payment link'}`;
    const text = `Hello ${args.customerName},

${orgName} has sent you a secure link to ${isRent ? 'pay for your rental reservation' : 'complete a security deposit pre-authorization'}.

Reference: ${args.reservationId}
Amount: ${amountLine}

Pay here (opens in your browser):
${args.checkoutUrl}

If you did not expect this email, contact the rental company.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p><strong>${escapeHtml(orgName)}</strong> has sent you a secure link to <strong>${isRent ? 'pay for your rental' : 'complete a security deposit pre-authorization'}</strong>.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Amount:</strong> ${escapeHtml(amountLine)}</li>
</ul>
<p><a href="${escapeHtml(args.checkoutUrl)}">${escapeHtml(title)}</a></p>
<p style="color:#666;font-size:0.9em">If you did not expect this message, contact the rental company.</p>`;
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject,
        text,
        html,
      });
      this.logger.log(
        `Mail sent: Stripe ${args.kind} checkout link → ${args.to} (${args.reservationId})`,
      );
    } catch (e) {
      this.logger.warn(
        `Mail send failed (Stripe link ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * After Stripe webhook records rental **paid** (`paidAt` set). Optional; opt out with `EMAIL_STRIPE_WEBHOOK_EMAILS`.
   */
  async sendRentalPaymentReceivedEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    totalCents: number | null;
    currency: string;
    statusLabel: string;
    publicViewToken?: string | null;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    if (this.isStripeWebhookEmailDisabled()) {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const amountLine = this.formatMoney(args.totalCents, args.currency);
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    const viewBlock = viewUrl ? `\nView your booking: ${viewUrl}\n` : '';
    const subject = `${orgName} — payment received`;
    const text = `Hello ${args.customerName},

We have received your payment for your rental.

Reference: ${args.reservationId}
Company: ${orgName}
Amount: ${amountLine}
Reservation status: ${args.statusLabel}
${viewBlock}This is an automated message. Please keep this email for your records.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>We have received <strong>your payment</strong> for your rental.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Amount:</strong> ${escapeHtml(amountLine)}</li>
<li><strong>Status:</strong> ${escapeHtml(args.statusLabel)}</li>
</ul>
${viewUrl ? `<p><a href="${escapeHtml(viewUrl)}">View your booking</a> <span style="color:#666">(no password)</span></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: rental paid ack → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (rental paid ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * After Stripe webhook records **deposit** card hold (manual capture, not yet charged as rent).
   */
  async sendDepositHoldPlacedEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    holdCents: number | null;
    currency: string;
    publicViewToken?: string | null;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    if (this.isStripeWebhookEmailDisabled()) {
      return;
    }
    if (!args.to?.includes('@')) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const amountLine = this.formatMoney(args.holdCents, args.currency);
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    const viewBlock = viewUrl
      ? `\nView your booking: ${viewUrl}\n`
      : '';
    const subject = `${orgName} — security deposit authorized (hold)`;
    const text = `Hello ${args.customerName},

A security deposit has been authorized on your card (not captured yet — a hold only, per your rental company’s process).

Reference: ${args.reservationId}
Company: ${orgName}
Hold amount: ${amountLine}
${viewBlock}Contact ${orgName} if you have questions.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>A <strong>security deposit</strong> has been <strong>authorized</strong> on your card (pre-authorization hold, not a final charge yet).</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Company:</strong> ${escapeHtml(orgName)}</li>
<li><strong>Hold amount:</strong> ${escapeHtml(amountLine)}</li>
</ul>
${viewUrl ? `<p><a href="${escapeHtml(viewUrl)}">View your booking</a></p>` : ''}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: deposit hold ack → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (deposit hold ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * C2: gentle one-time reminder — rent still unpaid on a public booking; customer pays via existing /quote or /booking/view flow.
   * No-op unless SMTP on, `EMAIL_RENT_PAYMENT_REMINDERS` truthy, and `to` looks like an email.
   */
  async sendRentPaymentReminderEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    totalCents: number | null;
    currency: string;
    status: string;
    publicViewToken: string | null;
  }): Promise<boolean> {
    if (!this.transporter || !this.isRentReminderEmailEnabled()) {
      return false;
    }
    if (!args.to?.includes('@')) {
      return false;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return false;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const totalLine = this.formatMoney(args.totalCents, args.currency);
    const viewUrl = this.bookingViewUrl(args.publicViewToken);
    if (!viewUrl) {
      return false;
    }
    const base = this.config.get<string>('APP_PUBLIC_BASE_URL')?.trim().replace(/\/$/, '') ?? '';
    const subject = `${orgName} — reminder: rental payment still pending`;
    const text = `Hello ${args.customerName},

This is a one-time reminder: your online booking with ${orgName} still shows rent as unpaid.

Reference: ${args.reservationId}
Status: ${args.status}
Indicative total: ${totalLine}

Open your booking summary to complete payment when ready:
${viewUrl}
${base ? `\nQuote page: ${base}/quote\n` : ''}If you already paid, refresh the booking page — it may take a moment to update.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>This is a <strong>one-time reminder</strong>: your online booking with <strong>${escapeHtml(
      orgName,
    )}</strong> still shows rent as <strong>unpaid</strong>.</p>
<ul>
<li><strong>Reference:</strong> <code>${escapeHtml(args.reservationId)}</code></li>
<li><strong>Status:</strong> ${escapeHtml(args.status)}</li>
<li><strong>Indicative total:</strong> ${escapeHtml(totalLine)}</li>
</ul>
<p><a href="${escapeHtml(viewUrl)}">Open your booking summary</a> <span style="color:#666">(pay from there if you have not yet)</span></p>
${base ? `<p><a href="${escapeHtml(base)}/quote">Return to the quote page</a></p>` : ''}
<p style="color:#666;font-size:0.9em">If you already paid, refresh the booking page. This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: rent payment reminder → ${args.to} (${args.reservationId})`);
      return true;
    } catch (e) {
      this.logger.warn(
        `Mail send failed (rent reminder ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /** C3: time-limited signed URL to /booking/view?magic=… (email + reservation ref recovery). */
  async sendPublicBookingMagicLinkEmail(args: {
    to: string;
    customerName: string;
    reservationId: string;
    companyId: string;
    magicUrl: string;
    ttlHours: number;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const company = await this.prisma.company.findUnique({
      where: { id: args.companyId },
      select: { name: true },
    });
    const orgName = company?.name ?? 'Car rental';
    const subject = `${orgName} — your booking link`;
    const text = `Hello ${args.customerName},

You asked for a new link to view booking ${args.reservationId} with ${orgName}.

Open this link (expires in about ${args.ttlHours} hours):
${args.magicUrl}

If you did not request this, you can ignore this email.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.customerName)},</p>
<p>You asked for a <strong>new link</strong> to view booking <code>${escapeHtml(args.reservationId)}</code> with <strong>${escapeHtml(
      orgName,
    )}</strong>.</p>
<p><a href="${escapeHtml(args.magicUrl)}">Open your booking summary</a> <span style="color:#666">(expires in about ${args.ttlHours} hours)</span></p>
<p style="color:#666;font-size:0.9em">If you did not request this, ignore this email.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: booking magic link → ${args.to} (${args.reservationId})`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (magic link ${args.reservationId}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * H2: staff onboarding — distinct from self-service password reset (invited by admin, same `/auth/reset-password?token=` flow).
   */
  async sendStaffAccountInviteEmail(args: {
    to: string;
    firstName: string;
    resetUrl: string;
    organizationName: string;
    invitedByLine?: string | null;
  }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const org = escapeHtml(args.organizationName);
    const who = args.invitedByLine ? escapeHtml(args.invitedByLine) : null;
    const subject = `${args.organizationName} — your staff account`;
    const text = `Hello ${args.firstName},

An administrator has created a staff account for you at ${args.organizationName} (car rental back office).

Open this link to choose your password (valid for a limited time):
${args.resetUrl}

${who ? `Invited by: ${args.invitedByLine}\n` : ''}If you were not expecting this, contact your branch or IT and do not use the link.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.firstName)},</p>
<p>An administrator has created a <strong>staff account</strong> for you at <strong>${org}</strong> (back office).</p>
<p><a href="${escapeHtml(args.resetUrl)}">Choose your password</a> <span style="color:#666">(one-time link; expires after a limited time)</span></p>
${
  who
    ? `<p style="color:#666;font-size:0.9em">Invited by: ${who}</p>`
    : '<p style="color:#666;font-size:0.9em">If you were not expecting this, contact your branch or IT.</p>'
}
<p style="color:#666;font-size:0.9em">This is an automated message.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: staff account invite → ${args.to}`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (staff invite ${args.to}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  /**
   * H2: staff forgot-password link. `resetUrl` must be the full HTTPS URL to the web app reset page (includes token query).
   */
  async sendPasswordResetEmail(args: { to: string; firstName: string; resetUrl: string }): Promise<void> {
    if (!this.transporter) {
      return;
    }
    const from = this.config.get<string>('SMTP_FROM')?.trim();
    if (!from) {
      return;
    }
    const subject = 'Car rental — reset your password';
    const text = `Hello ${args.firstName},

You asked to reset your back-office password.

Open this link in your browser (valid for a limited time):
${args.resetUrl}

If you did not request this, you can ignore this email. Your password will not change.

This is an automated message.`;
    const html = `<p>Hello ${escapeHtml(args.firstName)},</p>
<p>You asked to reset your <strong>back-office password</strong>.</p>
<p><a href="${escapeHtml(args.resetUrl)}">Set a new password</a></p>
<p style="color:#666;font-size:0.9em">If you did not request this, ignore this email.</p>`;
    try {
      await this.transporter.sendMail({ from, to: args.to, subject, text, html });
      this.logger.log(`Mail sent: password reset → ${args.to}`);
    } catch (e) {
      this.logger.warn(
        `Mail send failed (password reset ${args.to}): ${e instanceof Error ? e.message : String(e)}`,
      );
      throw e;
    }
  }

  private isStripeWebhookEmailDisabled(): boolean {
    const v = this.config.get<string>('EMAIL_STRIPE_WEBHOOK_EMAILS')?.trim().toLowerCase();
    return v === '0' || v === 'false' || v === 'no';
  }

  /** C2: one-time unpaid-rent nudge for public bookings; use with worker `POST /internal/cron/rent-payment-reminders`. */
  private isRentReminderEmailEnabled(): boolean {
    const v = this.config.get<string>('EMAIL_RENT_PAYMENT_REMINDERS')?.trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
