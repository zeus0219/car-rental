import { createReadStream, promises as fsp, existsSync, mkdirSync } from 'node:fs';
import { join as pathJoin } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  damageReportPhotoPresignBodySchema,
  type PutReservationDamageInput,
  reservationOperationPhotoPresignBodySchema,
} from '@car-rental/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { JwtUser } from '../auth/types';
import { assertAgentReservationInScope, assertSameCompany } from '../auth/company-access';
import { ObjectStorageS3Service } from '../rental-agreement/object-storage-s3.service';
import { AuditService } from '../audit/audit.service';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

const opPhotoListSelect = {
  id: true,
  phase: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

const damagePhotoListSelect = {
  id: true,
  originalName: true,
  mimeType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

@Injectable()
export class ReservationOpsService implements OnModuleInit {
  private readonly root: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly s3: ObjectStorageS3Service,
    private readonly audit: AuditService,
  ) {
    this.root = this.config.get<string>('STORAGE_LOCAL_ROOT', pathJoin(process.cwd(), 'data', 'uploads'));
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
    return pathJoin(this.root, ...relativeKey.split('/'));
  }

  private async ensureDir(companyId: string, sub: string) {
    const p = pathJoin(this.root, companyId, 'reservation-ops', sub);
    await fsp.mkdir(p, { recursive: true });
  }

  private safeOriginalName(n: string): string {
    const b = n.replace(/[/\\]/g, '_').split('\0').join('').trim().slice(0, 200);
    return b || 'file';
  }

  private extFromMime(mime: string): string {
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

  private assertWriter(user: JwtUser) {
    if (user.role === 'READONLY_ACCOUNTING') {
      throw new ForbiddenException('Not allowed');
    }
  }

  private completedFilesWhere(): Prisma.ReservationOperationPhotoWhereInput {
    return { OR: [{ storage: 'LOCAL' }, { uploadCompletedAt: { not: null } }] };
  }

  private completedDamagePhotosWhere(): Prisma.DamageReportPhotoWhereInput {
    return { OR: [{ storage: 'LOCAL' }, { uploadCompletedAt: { not: null } }] };
  }

  private async getReservationForAccess(reservationId: string, user: JwtUser) {
    const r = await this.prisma.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, companyId: true, pickupStationId: true, returnStationId: true },
    });
    if (!r) {
      throw new NotFoundException(`Reservation not found: ${reservationId}`);
    }
    assertSameCompany(user, r.companyId, `Reservation not found: ${reservationId}`);
    assertAgentReservationInScope(
      user,
      r.pickupStationId,
      r.returnStationId,
      `Reservation not found: ${reservationId}`,
    );
    return r;
  }

  async listOperationPhotos(reservationId: string, user: JwtUser) {
    await this.getReservationForAccess(reservationId, user);
    return this.prisma.reservationOperationPhoto.findMany({
      where: { reservationId, ...this.completedFilesWhere() },
      orderBy: { createdAt: 'asc' },
      select: opPhotoListSelect,
    });
  }

  async presignOperationPhoto(
    reservationId: string,
    body: unknown,
    user: JwtUser,
  ) {
    this.assertWriter(user);
    const b = reservationOperationPhotoPresignBodySchema.parse(body);
    if (!this.isS3Mode()) {
      throw new BadRequestException('Presigned upload is only available when STORAGE_MODE=s3');
    }
    if (!ALLOWED_MIME.has(b.mimeType)) {
      throw new BadRequestException('Only JPEG, PNG, WebP images are allowed');
    }
    if (b.sizeBytes > MAX_PHOTO_BYTES) {
      throw new BadRequestException('File size exceeds 10MB');
    }
    const r = await this.getReservationForAccess(reservationId, user);
    const originalName = this.safeOriginalName(b.originalName);
    const id = randomUUID();
    const ext = this.extFromMime(b.mimeType);
    const storageKey = `${r.companyId}/reservation-ops/${reservationId}/op/${id}${ext}`;
    const row = await this.prisma.reservationOperationPhoto.create({
      data: {
        id,
        companyId: r.companyId,
        reservationId,
        phase: b.phase,
        originalName,
        mimeType: b.mimeType,
        sizeBytes: b.sizeBytes,
        storageKey,
        storage: 'S3',
        uploadCompletedAt: null,
        uploadedByUserId: user.sub,
      },
      select: opPhotoListSelect,
    });
    const uploadUrl = await this.s3.getPresignedPutUrl(storageKey, b.mimeType);
    return {
      photo: row,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': b.mimeType },
    };
  }

  async completeOperationPhoto(reservationId: string, photoId: string, user: JwtUser) {
    this.assertWriter(user);
    if (!this.isS3Mode()) {
      throw new BadRequestException('Not in S3 mode');
    }
    await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.reservationOperationPhoto.findUnique({ where: { id: photoId } });
    if (!ph || ph.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage !== 'S3') {
      throw new BadRequestException('Not a presigned S3 upload');
    }
    if (ph.uploadCompletedAt) {
      return this.prisma.reservationOperationPhoto.findUniqueOrThrow({
        where: { id: photoId },
        select: opPhotoListSelect,
      });
    }
    let head;
    try {
      head = await this.s3.headObject(ph.storageKey);
    } catch {
      throw new NotFoundException('Object not found in storage; upload may have failed or expired');
    }
    const len = head.ContentLength ?? 0;
    if (len < 1 || len > MAX_PHOTO_BYTES) {
      await this.s3.deleteObject(ph.storageKey);
      await this.prisma.reservationOperationPhoto.delete({ where: { id: ph.id } });
      throw new BadRequestException('Uploaded file size is invalid');
    }
    return this.prisma.reservationOperationPhoto.update({
      where: { id: ph.id },
      data: { sizeBytes: len, uploadCompletedAt: new Date() },
      select: opPhotoListSelect,
    });
  }

  async uploadOperationPhotoLocal(
    reservationId: string,
    phase: 'HANDOVER' | 'RETURN',
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    user: JwtUser,
  ) {
    this.assertWriter(user);
    if (this.isS3Mode()) {
      throw new BadRequestException(
        'Multipart upload to API is disabled when STORAGE_MODE=s3; use presigned upload from the client',
      );
    }
    if (!file?.buffer || file.size < 1) {
      throw new BadRequestException('File is empty');
    }
    if (file.size > MAX_PHOTO_BYTES) {
      throw new BadRequestException('File size exceeds 10MB');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, WebP images are allowed');
    }
    const r = await this.getReservationForAccess(reservationId, user);
    const originalName = this.safeOriginalName(file.originalname);
    const id = randomUUID();
    const ext = this.extFromMime(file.mimetype);
    const storageKey = `${r.companyId}/reservation-ops/${reservationId}/op/${id}${ext}`;
    await this.ensureDir(r.companyId, pathJoin(reservationId, 'op'));
    const dest = this.absPath(storageKey);
    const completedAt = new Date();
    await fsp.writeFile(dest, file.buffer);
    try {
      return await this.prisma.reservationOperationPhoto.create({
        data: {
          id,
          companyId: r.companyId,
          reservationId,
          phase,
          originalName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          storage: 'LOCAL',
          uploadCompletedAt: completedAt,
          uploadedByUserId: user.sub,
        },
        select: opPhotoListSelect,
      });
    } catch (e) {
      await fsp.rm(dest, { force: true });
      throw e;
    }
  }

  async getOperationPhotoFile(reservationId: string, photoId: string, user: JwtUser) {
    await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.reservationOperationPhoto.findUnique({ where: { id: photoId } });
    if (!ph || ph.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage === 'S3' && !ph.uploadCompletedAt) {
      throw new NotFoundException('Upload not completed yet');
    }
    if (ph.storage === 'S3') {
      const stream = await this.s3.getObjectStream(ph.storageKey);
      return { attachment: ph, createReadStream: () => stream };
    }
    const abs = this.absPath(ph.storageKey);
    try {
      await fsp.access(abs);
    } catch {
      throw new NotFoundException('File missing on disk');
    }
    return { attachment: ph, createReadStream: () => createReadStream(abs) };
  }

  async removeOperationPhoto(reservationId: string, photoId: string, user: JwtUser) {
    this.assertWriter(user);
    await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.reservationOperationPhoto.findUnique({ where: { id: photoId } });
    if (!ph || ph.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage === 'S3' && ph.uploadCompletedAt) {
      try {
        await this.s3.deleteObject(ph.storageKey);
      } catch {
        // ignore
      }
    }
    if (ph.storage === 'LOCAL') {
      try {
        await fsp.rm(this.absPath(ph.storageKey), { force: true });
      } catch {
        // ignore
      }
    } else if (ph.storage === 'S3' && !ph.uploadCompletedAt) {
      try {
        await this.s3.deleteObject(ph.storageKey);
      } catch {
        // ignore
      }
    }
    await this.prisma.reservationOperationPhoto.delete({ where: { id: ph.id } });
    return { ok: true as const };
  }

  async getDamage(reservationId: string, user: JwtUser) {
    await this.getReservationForAccess(reservationId, user);
    return this.prisma.damageReport.findUnique({
      where: { reservationId },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        photos: { where: this.completedDamagePhotosWhere(), orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async putDamage(reservationId: string, data: PutReservationDamageInput, user: JwtUser) {
    this.assertWriter(user);
    const r = await this.getReservationForAccess(reservationId, user);
    const existing = await this.prisma.damageReport.findUnique({ where: { reservationId } });
    const lineData = data.lines.map((l, i) => ({
      area: l.area.trim(),
      description: l.description.trim(),
      estimatedFeeCents: l.estimatedFeeCents ?? null,
      sortOrder: i,
    }));
    if (existing) {
      const dr = await this.prisma.$transaction(async (tx) => {
        await tx.damageLine.deleteMany({ where: { damageReportId: existing.id } });
        if (lineData.length) {
          await tx.damageLine.createMany({
            data: lineData.map((l) => ({ ...l, damageReportId: existing.id })),
          });
        }
        return tx.damageReport.update({
          where: { id: existing.id },
          data: {
            status: data.status,
            notes: data.notes ?? null,
            suggestedCaptureCents: data.suggestedCaptureCents ?? null,
          },
          include: {
            lines: { orderBy: { sortOrder: 'asc' } },
            photos: { where: this.completedDamagePhotosWhere(), orderBy: { createdAt: 'asc' } },
          },
        });
      });
      await this.audit.log({
        userId: user.sub,
        action: 'reservation.damage_report.update',
        entity: 'DamageReport',
        entityId: dr.id,
        metadata: {
          reservationId,
          lineCount: lineData.length,
          status: data.status,
          suggestedCaptureCents: dr.suggestedCaptureCents ?? null,
        },
      });
      return dr;
    }
    const dr = await this.prisma.damageReport.create({
      data: {
        companyId: r.companyId,
        reservationId,
        status: data.status,
        notes: data.notes ?? null,
        suggestedCaptureCents: data.suggestedCaptureCents ?? null,
        createdByUserId: user.sub,
        lines: lineData.length
          ? {
              create: lineData.map((l) => ({
                area: l.area,
                description: l.description,
                estimatedFeeCents: l.estimatedFeeCents,
                sortOrder: l.sortOrder,
              })),
            }
          : undefined,
      },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        photos: true,
      },
    });
    await this.audit.log({
      userId: user.sub,
      action: 'reservation.damage_report.create',
      entity: 'DamageReport',
      entityId: dr.id,
      metadata: {
        reservationId,
        lineCount: lineData.length,
        status: data.status,
        suggestedCaptureCents: dr.suggestedCaptureCents ?? null,
      },
    });
    return this.prisma.damageReport.findUniqueOrThrow({
      where: { id: dr.id },
      include: {
        lines: { orderBy: { sortOrder: 'asc' } },
        photos: { where: this.completedDamagePhotosWhere(), orderBy: { createdAt: 'asc' } },
      },
    });
  }

  async presignDamagePhoto(reservationId: string, body: unknown, user: JwtUser) {
    this.assertWriter(user);
    const b = damageReportPhotoPresignBodySchema.parse(body);
    if (!this.isS3Mode()) {
      throw new BadRequestException('Presigned upload is only available when STORAGE_MODE=s3');
    }
    if (!ALLOWED_MIME.has(b.mimeType) || b.sizeBytes > MAX_PHOTO_BYTES) {
      throw new BadRequestException('Invalid file');
    }
    const r = await this.getReservationForAccess(reservationId, user);
    const dr =
      (await this.prisma.damageReport.findUnique({ where: { reservationId } })) ??
      (await this.prisma.damageReport.create({
        data: {
          companyId: r.companyId,
          reservationId,
          status: 'DRAFT',
          createdByUserId: user.sub,
        },
      }));
    const originalName = this.safeOriginalName(b.originalName);
    const id = randomUUID();
    const ext = this.extFromMime(b.mimeType);
    const storageKey = `${r.companyId}/reservation-ops/${reservationId}/dmg/${id}${ext}`;
    const row = await this.prisma.damageReportPhoto.create({
      data: {
        id,
        companyId: r.companyId,
        damageReportId: dr.id,
        originalName,
        mimeType: b.mimeType,
        sizeBytes: b.sizeBytes,
        storageKey,
        storage: 'S3',
        uploadCompletedAt: null,
        uploadedByUserId: user.sub,
      },
      select: damagePhotoListSelect,
    });
    const uploadUrl = await this.s3.getPresignedPutUrl(storageKey, b.mimeType);
    return {
      photo: row,
      uploadUrl,
      method: 'PUT' as const,
      headers: { 'Content-Type': b.mimeType },
    };
  }

  async completeDamagePhoto(reservationId: string, photoId: string, user: JwtUser) {
    this.assertWriter(user);
    if (!this.isS3Mode()) {
      throw new BadRequestException('Not in S3 mode');
    }
    const r = await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.damageReportPhoto.findUnique({
      where: { id: photoId },
      include: { damageReport: true },
    });
    if (!ph || ph.companyId !== r.companyId || ph.damageReport.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage !== 'S3' || ph.uploadCompletedAt) {
      return this.prisma.damageReportPhoto.findUniqueOrThrow({
        where: { id: photoId },
        select: damagePhotoListSelect,
      });
    }
    let head;
    try {
      head = await this.s3.headObject(ph.storageKey);
    } catch {
      throw new NotFoundException('Object not found in storage; upload may have failed or expired');
    }
    const len = head.ContentLength ?? 0;
    if (len < 1 || len > MAX_PHOTO_BYTES) {
      await this.s3.deleteObject(ph.storageKey);
      await this.prisma.damageReportPhoto.delete({ where: { id: ph.id } });
      throw new BadRequestException('Uploaded file size is invalid');
    }
    return this.prisma.damageReportPhoto.update({
      where: { id: ph.id },
      data: { sizeBytes: len, uploadCompletedAt: new Date() },
      select: damagePhotoListSelect,
    });
  }

  async uploadDamagePhotoLocal(
    reservationId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    user: JwtUser,
  ) {
    this.assertWriter(user);
    if (this.isS3Mode()) {
      throw new BadRequestException(
        'Multipart upload to API is disabled when STORAGE_MODE=s3; use presigned upload from the client',
      );
    }
    if (!file?.buffer || file.size < 1 || file.size > MAX_PHOTO_BYTES || !ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException('Invalid file');
    }
    const r = await this.getReservationForAccess(reservationId, user);
    const dr =
      (await this.prisma.damageReport.findUnique({ where: { reservationId } })) ??
      (await this.prisma.damageReport.create({
        data: {
          companyId: r.companyId,
          reservationId,
          status: 'DRAFT',
          createdByUserId: user.sub,
        },
      }));
    const originalName = this.safeOriginalName(file.originalname);
    const id = randomUUID();
    const ext = this.extFromMime(file.mimetype);
    const storageKey = `${r.companyId}/reservation-ops/${reservationId}/dmg/${id}${ext}`;
    await this.ensureDir(r.companyId, pathJoin(reservationId, 'dmg'));
    const dest = this.absPath(storageKey);
    await fsp.writeFile(dest, file.buffer);
    try {
      return await this.prisma.damageReportPhoto.create({
        data: {
          id,
          companyId: r.companyId,
          damageReportId: dr.id,
          originalName,
          mimeType: file.mimetype,
          sizeBytes: file.size,
          storageKey,
          storage: 'LOCAL',
          uploadCompletedAt: new Date(),
          uploadedByUserId: user.sub,
        },
        select: damagePhotoListSelect,
      });
    } catch (e) {
      await fsp.rm(dest, { force: true });
      throw e;
    }
  }

  async getDamagePhotoFile(reservationId: string, photoId: string, user: JwtUser) {
    await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.damageReportPhoto.findUnique({
      where: { id: photoId },
      include: { damageReport: true },
    });
    if (!ph || ph.damageReport.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage === 'S3' && !ph.uploadCompletedAt) {
      throw new NotFoundException('Upload not completed yet');
    }
    if (ph.storage === 'S3') {
      const stream = await this.s3.getObjectStream(ph.storageKey);
      return { attachment: ph, createReadStream: () => stream };
    }
    const abs = this.absPath(ph.storageKey);
    try {
      await fsp.access(abs);
    } catch {
      throw new NotFoundException('File missing on disk');
    }
    return { attachment: ph, createReadStream: () => createReadStream(abs) };
  }

  async removeDamagePhoto(reservationId: string, photoId: string, user: JwtUser) {
    this.assertWriter(user);
    await this.getReservationForAccess(reservationId, user);
    const ph = await this.prisma.damageReportPhoto.findUnique({
      where: { id: photoId },
      include: { damageReport: true },
    });
    if (!ph || ph.damageReport.reservationId !== reservationId) {
      throw new NotFoundException('Photo not found');
    }
    if (ph.storage === 'S3' && ph.uploadCompletedAt) {
      try {
        await this.s3.deleteObject(ph.storageKey);
      } catch {
        // ignore
      }
    } else if (ph.storage === 'LOCAL') {
      try {
        await fsp.rm(this.absPath(ph.storageKey), { force: true });
      } catch {
        // ignore
      }
    } else {
      try {
        await this.s3.deleteObject(ph.storageKey);
      } catch {
        // ignore
      }
    }
    await this.prisma.damageReportPhoto.delete({ where: { id: ph.id } });
    return { ok: true as const };
  }
}
