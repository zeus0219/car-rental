import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export type RentalAgreementPdfInput = {
  companyName: string;
  reservationId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupAt: Date;
  returnAt: Date;
  totalCents: number | null;
  currency: string;
  vehicleLine: string | null;
  pickupStationLine: string | null;
  returnStationLine: string | null;
  agreementStatus: string;
  agreementTemplateVersion: string | null;
  signedByName: string | null;
  signedAt: Date | null;
  body: string;
  annexNames: string[];
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const LINE_H = 14;
const BODY_SIZE = 10;
const HEAD_SIZE = 16;
const SUB_SIZE = 11;

/** Keep PDF body within WinAnsi-friendly range for standard fonts. */
function pdfSafe(s: string): string {
  return s.replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

function wrapLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  const paras = text.replace(/\r\n/g, '\n').split('\n');
  for (const para of paras) {
    const t = para.trimEnd();
    if (!t) {
      out.push('');
      continue;
    }
    let rest = t;
    while (rest.length > maxChars) {
      let cut = rest.lastIndexOf(' ', maxChars);
      if (cut < maxChars * 0.4) {
        cut = maxChars;
      }
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest) {
      out.push(rest);
    }
  }
  return out;
}

function formatMoney(cents: number | null, currency: string): string {
  if (cents == null) {
    return '—';
  }
  const u = currency.toUpperCase();
  return u === 'EUR' ? `EUR ${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)} ${u}`;
}

let cachedLogoPng: Uint8Array | null | undefined;

async function loadBrandLogoPng(): Promise<Uint8Array | null> {
  if (cachedLogoPng !== undefined) {
    return cachedLogoPng;
  }
  const candidates = [
    join(process.cwd(), 'assets', 'foreservice-logo.png'),
    join(process.cwd(), 'dist', 'assets', 'foreservice-logo.png'),
    join(__dirname, '..', '..', 'assets', 'foreservice-logo.png'),
  ];
  for (const p of candidates) {
    try {
      cachedLogoPng = await readFile(p);
      return cachedLogoPng;
    } catch {
      /* try next path */
    }
  }
  cachedLogoPng = null;
  return null;
}

@Injectable()
export class RentalAgreementPdfService {
  async buildPdf(input: RentalAgreementPdfInput): Promise<Uint8Array> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
    let page = doc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    const logoBytes = await loadBrandLogoPng();
    if (logoBytes) {
      const img = await doc.embedPng(logoBytes);
      const maxW = 160;
      const maxH = 44;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: (PAGE_W - w) / 2,
        y: y - h,
        width: w,
        height: h,
      });
      y -= h + 14;
    }

    const addPage = () => {
      page = doc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    };

    const draw = (text: string, opts?: { bold?: boolean; size?: number }) => {
      const size = opts?.size ?? BODY_SIZE;
      const f = opts?.bold ? fontBold : font;
      const lines = wrapLines(pdfSafe(text), 92);
      for (const line of lines) {
        if (y < MARGIN + LINE_H) {
          addPage();
        }
        page.drawText(line || ' ', {
          x: MARGIN,
          y,
          size,
          font: f,
          color: rgb(0.1, 0.1, 0.1),
        });
        y -= LINE_H + (size > BODY_SIZE ? 2 : 0);
      }
    };

    draw('Rental agreement', { bold: true, size: HEAD_SIZE });
    y -= 4;
    draw(input.companyName, { size: SUB_SIZE });
    draw(`Reservation: ${input.reservationId}`);
    draw(`Status: ${input.agreementStatus}`);
    if (input.agreementTemplateVersion) {
      draw(`Template: ${input.agreementTemplateVersion}`);
    }
    if (input.signedAt && input.signedByName) {
      draw(
        `Signed: ${input.signedByName} — ${input.signedAt.toISOString()}`,
      );
    }
    y -= 6;
    draw('Customer', { bold: true, size: SUB_SIZE });
    draw(`Name: ${input.customerName}`);
    draw(`Email: ${input.customerEmail}`);
    draw(`Phone: ${input.customerPhone}`);
    y -= 4;
    draw('Booking', { bold: true, size: SUB_SIZE });
    draw(`Pickup: ${input.pickupAt.toISOString()}`);
    if (input.pickupStationLine) {
      draw(`Pickup location: ${input.pickupStationLine}`);
    }
    draw(`Return: ${input.returnAt.toISOString()}`);
    if (input.returnStationLine) {
      draw(`Return location: ${input.returnStationLine}`);
    }
    draw(`Indicative total: ${formatMoney(input.totalCents, input.currency)}`);
    if (input.vehicleLine) {
      draw(`Vehicle: ${input.vehicleLine}`);
    }
    y -= 6;
    draw('Agreement text', { bold: true, size: SUB_SIZE });
    y -= 2;
    const bodyLines = wrapLines(pdfSafe(input.body), 95);
    for (const line of bodyLines) {
      if (y < MARGIN + LINE_H) {
        addPage();
      }
      page.drawText(line || ' ', {
        x: MARGIN,
        y,
        size: BODY_SIZE,
        font,
        color: rgb(0.15, 0.15, 0.15),
      });
      y -= LINE_H;
    }
    if (input.annexNames.length > 0) {
      y -= 6;
      draw('Annex files (see desk for file contents)', { bold: true, size: SUB_SIZE });
      for (const name of input.annexNames) {
        draw(`• ${name}`);
      }
    }

    return doc.save();
  }
}
