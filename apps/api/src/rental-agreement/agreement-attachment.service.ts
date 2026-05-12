import { createReadStream, promises as fsp, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgreementAttachmentPresignBody } from '@car-rental/shared';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../auth/types';
import { assertAgentReservationInScope, assertSameCompany } from '../auth/company-access';
import { ObjectStorageS3Service } from './object-storage-s3.service';

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
export const MAX_AGREEMENT_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const attachmentListSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
  uploadedByUserId: true,
} as const;

@Injectable()
export class AgreementAttachmentService implements OnModuleInit {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly s3: ObjectStorageS3Service,
  ) {
    this.root = this.config.get<string>('STORAGE_LOCAL_ROOT', join(process.cwd(), 'data', 'uploads'));
  }

  onModuleInit() {
    if (!existsSync(this.root)) {
      mkdirSync(this.root, { recursive: true });
    }
  }

  private isS3Mode(): boolean {
    return this.s3.isS3Mode();
  }

  getStorageConfig(): { mode: 'local' | 's3' } {
    return { mode: this.isS3Mode() ? 's3' : 'local' };
  }

  private absPath(relativeKey: string): string {
    return join(this.root, ...relativeKey.split('/'));
  }

  private async ensureDir(companyId: string, agreementId: string) {
    const p = join(this.root, companyId, agreementId);
    await fsp.mkdir(p, { recursive: true });
  }

  private safeOriginalName(n: string): string {
    const b = n.replace(/[/\\]/g, '_').split('\0').join('').trim().slice(0, 200);
    return b || 'file';
  }

  private extFromNameOrMime(originalName: string, mime: string): string {
    const m = originalName.match(/\.(pdf|jpe?g|png|webp)$/i);
    if (m) {
      return m[0].toLowerCase();
    }
    if (mime === 'application/pdf') {
      return '.pdf';
    }
    if (mime === 'image/jpeg') {
      return '.jpg';
    }
    if (mime === 'image/png') {
      return '.png';
    }
    if (mime === 'image/webp') {
      return '.webp';
    }
    return '.bin';
  }

  private async getAgreementForAccess(agreementId: string, user: JwtUser) {
    const a = await this.prisma.rentalAgreement.findUnique({
      where: { id: agreementId },
      include: { reservation: { select: { pickupStationId: true, returnStationId: true } } },
    });
    if (!a) {
      throw new NotFoundException(`Rental agreement not found: ${agreementId}`);
    }
    assertSameCompany(user, a.companyId, `Rental agreement not found: ${agreementId}`);
    assertAgentReservationInScope(
      user,
      a.reservation.pickupStationId,
      a.reservation.returnStationId,
      `Rental agreement not found: ${agreementId}`,
    );
    return a;
  }

  private completedAttachmentsWhere() {
    return {
      OR: [{ storage: 'LOCAL' as const }, { uploadCompletedAt: { not: null } }],
    };
  }

  async list(agreementId: string, user: JwtUser) {
    await this.getAgreementForAccess(agreementId, user);
    return this.prisma.rentalAgreementAttachment.findMany({
      where: {
        rentalAgreementId: agreementId,
        ...this.completedAttachmentsWhere(),
      },
      orderBy: { createdAt: 'asc' },
      select: attachmentListSelect,
    });
  }

  async upload(
    agreementId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    user: JwtUser,
  ) {
    if (this.isS3Mode()) {
      throw new BadRequestException(
        'Multipart upload to API is disabled when STORAGE_MODE=s3; use presigned upload from the client',
      );
    }
    if (!file?.buffer || file.size < 1) {
      throw new BadRequestException('File is empty');
    }
    if (file.size > MAX_AGREEMENT_ATTACHMENT_BYTES) {
      throw new BadRequestException('File size exceeds 10MB');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Only PDF and JPEG, PNG, WebP images are allowed');
    }
    const a = await this.getAgreementForAccess(agreementId, user);
    if (a.status === 'VOID') {
      throw new BadRequestException('Cannot upload to a voided agreement');
    }
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const originalName = this.safeOriginalName(file.originalname);
    const id = randomUUID();
    const ext = this.extFromNameOrMime(originalName, file.mimetype);
    const storageKey = `${a.companyId}/${agreementId}/${id}${ext}`;
    await this.ensureDir(a.companyId, agreementId);
    const dest = this.absPath(storageKey);
    const completedAt = new Date();
    await fsp.writeFile(dest, file.buffer);
    try {
      return await this.prisma.rentalAgreementAttachment.create({
        data: {
          id,
          companyId: a.companyId,
          rentalAgreementId: agreementId,
          originalName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          storage: 'LOCAL',
          uploadCompletedAt: completedAt,
          uploadedByUserId: user.sub,
        },
        select: attachmentListSelect,
      });
    } catch (e) {
      await fsp.rm(dest, { force: true });
      throw e;
    }
  }

  async createPresignedUpload(agreementId: string, body: AgreementAttachmentPresignBody, user: JwtUser) {
    if (!this.isS3Mode()) {
      throw new BadRequestException('Presigned upload is only available when STORAGE_MODE=s3');
    }
    if (!ALLOWED_MIME.has(body.mimeType)) {
      throw new BadRequestException('Only PDF and JPEG, PNG, WebP images are allowed');
    }
    const a = await this.getAgreementForAccess(agreementId, user);
    if (a.status === 'VOID') {
      throw new BadRequestException('Cannot upload to a voided agreement');
    }
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const originalName = this.safeOriginalName(body.originalName);
    const id = randomUUID();
    const ext = this.extFromNameOrMime(originalName, body.mimeType);
    const storageKey = `${a.companyId}/${agreementId}/${id}${ext}`;
    const row = await this.prisma.rentalAgreementAttachment.create({
      data: {
        id,
        companyId: a.companyId,
        rentalAgreementId: agreementId,
        originalName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        storageKey,
        storage: 'S3',
        uploadCompletedAt: null,
        uploadedByUserId: user.sub,
      },
      select: attachmentListSelect,
    });
    const uploadUrl = await this.s3.getPresignedPutUrl(storageKey, body.mimeType);
    return {
      attachment: row,
      uploadUrl,
      method: 'PUT' as const,
      headers: {
        'Content-Type': body.mimeType,
      },
    };
  }

  async completePresignedUpload(agreementId: string, attachmentId: string, user: JwtUser) {
    if (!this.isS3Mode()) {
      throw new BadRequestException('Not in S3 mode');
    }
    await this.getAgreementForAccess(agreementId, user);
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const att = await this.prisma.rentalAgreementAttachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.rentalAgreementId !== agreementId) {
      throw new NotFoundException('Attachment not found');
    }
    if (att.storage !== 'S3') {
      throw new BadRequestException('Not a presigned S3 attachment');
    }
    if (att.uploadCompletedAt) {
      return this.prisma.rentalAgreementAttachment.findUniqueOrThrow({
        where: { id: attachmentId },
        select: attachmentListSelect,
      });
    }
    let head;
    try {
      head = await this.s3.headObject(att.storageKey);
    } catch {
      throw new NotFoundException('Object not found in storage; upload may have failed or expired');
    }
    const len = head.ContentLength ?? 0;
    if (len < 1 || len > MAX_AGREEMENT_ATTACHMENT_BYTES) {
      await this.s3.deleteObject(att.storageKey);
      await this.prisma.rentalAgreementAttachment.delete({ where: { id: att.id } });
      throw new BadRequestException('Uploaded file size is invalid');
    }
    return this.prisma.rentalAgreementAttachment.update({
      where: { id: att.id },
      data: {
        sizeBytes: len,
        uploadCompletedAt: new Date(),
      },
      select: attachmentListSelect,
    });
  }

  fileAbsolutePath(attachment: { storageKey: string; storage: string }): string {
    if (attachment.storage !== 'LOCAL') {
      throw new BadRequestException('Not a local file');
    }
    return this.absPath(attachment.storageKey);
  }

  async getFileForDownload(agreementId: string, attachmentId: string, user: JwtUser) {
    await this.getAgreementForAccess(agreementId, user);
    const att = await this.prisma.rentalAgreementAttachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.rentalAgreementId !== agreementId) {
      throw new NotFoundException('Attachment not found');
    }
    if (att.storage === 'S3' && !att.uploadCompletedAt) {
      throw new NotFoundException('Upload not completed yet');
    }
    if (att.storage === 'S3') {
      const stream = await this.s3.getObjectStream(att.storageKey);
      return { attachment: att, createReadStream: () => stream };
    }
    const abs = this.absPath(att.storageKey);
    try {
      await fsp.access(abs);
    } catch {
      throw new NotFoundException('File missing on disk');
    }
    return { attachment: att, createReadStream: () => createReadStream(abs) };
  }

  async remove(agreementId: string, attachmentId: string, user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
    const a = await this.getAgreementForAccess(agreementId, user);
    if (a.status === 'SIGNED' || a.status === 'VOID') {
      throw new BadRequestException('Remove attachments only while the agreement is DRAFT (or use admin tools later)');
    }
    const att = await this.prisma.rentalAgreementAttachment.findUnique({ where: { id: attachmentId } });
    if (!att || att.rentalAgreementId !== agreementId) {
      throw new NotFoundException('Attachment not found');
    }
    if (att.storage === 'S3') {
      await this.s3.deleteObject(att.storageKey);
    } else {
      const abs = this.absPath(att.storageKey);
      try {
        await fsp.rm(abs, { force: true });
      } catch {
        // ignore
      }
    }
    await this.prisma.rentalAgreementAttachment.delete({ where: { id: attachmentId } });
    return { ok: true as const };
  }
}
