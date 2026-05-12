import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';

@Injectable()
export class ObjectStorageS3Service implements OnModuleInit {
  private client: S3Client | null = null;
  private bucket = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const mode = (this.config.get<string>('STORAGE_MODE') ?? 'local').toLowerCase();
    if (mode !== 's3') {
      return;
    }
    this.bucket = this.config.get<string>('S3_BUCKET') ?? '';
    const region = this.config.get<string>('S3_REGION') ?? 'us-east-1';
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = this.config.get<string>('S3_SECRET_ACCESS_KEY') ?? '';
    if (!this.bucket || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'STORAGE_MODE=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY',
      );
    }
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const forcePathStyle = this.config.get<string>('S3_USE_PATH_STYLE', 'true') === 'true';
    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle: forcePathStyle || Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  isS3Mode(): boolean {
    return this.client != null && Boolean(this.bucket);
  }

  getBucket(): string {
    return this.bucket;
  }

  async getPresignedPutUrl(key: string, contentType: string, expiresSeconds = 600): Promise<string> {
    if (!this.client) {
      throw new BadRequestException('S3 is not configured');
    }
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSeconds });
  }

  /** G3: short-lived GET for OCR / middleware adapters (same bucket as uploads). */
  async getPresignedGetUrl(key: string, expiresSeconds = 300): Promise<string> {
    if (!this.client) {
      throw new BadRequestException('S3 is not configured');
    }
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, cmd, { expiresIn: expiresSeconds });
  }

  async headObject(key: string) {
    if (!this.client) {
      throw new BadRequestException('S3 is not configured');
    }
    return this.client.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  getObjectStream(key: string): Promise<Readable> {
    if (!this.client) {
      throw new BadRequestException('S3 is not configured');
    }
    return this.client
      .send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      )
      .then((o) => {
        const b = o.Body;
        if (!b) {
          throw new BadRequestException('Empty object body');
        }
        return b as Readable;
      });
  }

  async deleteObject(key: string) {
    if (!this.client) {
      return;
    }
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );
    } catch {
      // ignore
    }
  }
}
