/**
 * B2: delete customer KYC documents past `retentionUntil` (DB row + blob).
 * Mirrors API `CustomerDocumentService.remove` storage behaviour.
 */
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { promises as fsp } from 'node:fs';
import { join } from 'node:path';

type DocStorage = 'LOCAL' | 'S3';

function localRoot(): string {
  return process.env.STORAGE_LOCAL_ROOT ?? join(process.cwd(), 'data', 'uploads');
}

type S3Ctx = { client: S3Client; bucket: string };

let s3Init = false;
let s3Ctx: S3Ctx | null = null;

function getS3(): S3Ctx | null {
  if (s3Init) {
    return s3Ctx;
  }
  s3Init = true;
  const mode = (process.env.STORAGE_MODE ?? 'local').toLowerCase();
  if (mode !== 's3') {
    s3Ctx = null;
    return null;
  }
  const bucket = process.env.S3_BUCKET ?? '';
  const region = process.env.S3_REGION ?? 'us-east-1';
  const accessKeyId = process.env.S3_ACCESS_KEY_ID ?? '';
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY ?? '';
  if (!bucket || !accessKeyId || !secretAccessKey) {
    // eslint-disable-next-line no-console
    console.warn(
      '[worker] STORAGE_MODE=s3 but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY incomplete — S3 retention deletes skipped',
    );
    s3Ctx = null;
    return null;
  }
  const endpoint = process.env.S3_ENDPOINT;
  const forcePathStyle = process.env.S3_USE_PATH_STYLE !== 'false';
  const client = new S3Client({
    region,
    endpoint: endpoint || undefined,
    forcePathStyle: forcePathStyle || Boolean(endpoint),
    credentials: { accessKeyId, secretAccessKey },
  });
  s3Ctx = { client, bucket };
  return s3Ctx;
}

async function deleteBlob(storage: DocStorage, storageKey: string): Promise<void> {
  if (storage === 'S3') {
    const s3 = getS3();
    if (!s3) {
      throw new Error('S3 not configured');
    }
    await s3.client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: storageKey }));
    return;
  }
  const abs = join(localRoot(), ...storageKey.split('/'));
  await fsp.rm(abs, { force: true });
}

/**
 * @returns number of rows deleted from DB (and storage best-effort).
 */
export async function purgeExpiredCustomerDocuments(
  prisma: PrismaClient,
  batchSize: number,
): Promise<number> {
  if (batchSize < 1) {
    return 0;
  }
  const now = new Date();
  const rows = await prisma.customerDocument.findMany({
    where: {
      retentionUntil: { lte: now },
      OR: [{ storage: 'LOCAL' }, { uploadCompletedAt: { not: null } }],
    },
    select: { id: true, storageKey: true, storage: true },
    take: batchSize,
    orderBy: { retentionUntil: 'asc' },
  });

  let deleted = 0;
  for (const row of rows) {
    try {
      await deleteBlob(row.storage, row.storageKey);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (row.storage === 'S3') {
        // eslint-disable-next-line no-console
        console.warn(`[worker] retention: S3 delete failed id=${row.id}, will retry later: ${msg}`);
        continue;
      }
      // eslint-disable-next-line no-console
      console.warn(`[worker] retention: local delete id=${row.id} (${msg}); removing DB row anyway`);
    }
    await prisma.customerDocument.delete({ where: { id: row.id } });
    deleted += 1;
  }
  return deleted;
}
