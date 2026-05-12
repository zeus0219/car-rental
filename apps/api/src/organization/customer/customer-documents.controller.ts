import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { memoryStorage } from 'multer';
import type { Request } from 'express';
import {
  applyCustomerDocumentOcrBodySchema,
  customerDocumentPresignBodySchema,
  customerDocumentTypeValues,
  customerDocumentVerificationBodySchema,
  MAX_CUSTOMER_DOCUMENT_BYTES,
} from '@car-rental/shared';
import { z } from 'zod';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import type { CustomerDocumentType } from '@prisma/client';
import { CustomerDocumentService } from './customer-document.service';

const memory = memoryStorage();

const multipartMetaSchema = z.object({
  docType: z.enum(customerDocumentTypeValues),
  retentionUntil: z.coerce.date().nullable().optional(),
});

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('customers')
@UseGuards(RolesGuard)
export class CustomerDocumentsController {
  constructor(private readonly documents: CustomerDocumentService) {}

  /** Same storage mode as agreement attachments (`STORAGE_MODE`, bucket, local root). */
  @Get('documents/storage-config')
  @ApiOperation({ summary: 'Customer document storage mode (local vs S3)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getStorageConfig() {
    return this.documents.getStorageConfig();
  }

  @Get(':customerId/documents')
  @ApiOperation({ summary: 'List documents for a customer' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  list(@Param('customerId', new ParseUUIDPipe()) customerId: string, @CurrentUser() user: JwtUser) {
    return this.documents.list(customerId, user);
  }

  @Get(':customerId/documents/:documentId/file')
  @ApiOperation({ summary: 'Download customer document file' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  async download(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    const { attachment, createReadStream } = await this.documents.getFileForDownload(customerId, documentId, user, {
      ip: typeof req.ip === 'string' ? req.ip : undefined,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return new StreamableFile(createReadStream(), {
      type: attachment.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
    });
  }

  @Post(':customerId/documents/presign')
  @ApiOperation({ summary: 'Presign upload for direct-to-storage customer document' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  presign(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = customerDocumentPresignBodySchema.parse(body);
    return this.documents.createPresignedUpload(customerId, data, user);
  }

  @Post(':customerId/documents/:documentId/complete')
  @ApiOperation({ summary: 'Complete presigned customer document upload' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  complete(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documents.completePresignedUpload(customerId, documentId, user);
  }

  @Post(':customerId/documents/:documentId/ocr/mock')
  @ApiOperation({
    summary: 'G3: run mock OCR (demo vendor)',
    description:
      'Populates `ocrSuggestionJson` only. Does not change the customer profile until staff calls apply.',
  })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  runMockOcr(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documents.runMockOcr(customerId, documentId, user);
  }

  @Post(':customerId/documents/:documentId/ocr/apply')
  @ApiOperation({
    summary: 'G3: apply selected OCR suggestion fields to customer',
    description:
      'Explicit staff action; merges name/fiscal code and/or appends doc#/expiry lines to customer notes.',
  })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  applyOcr(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = applyCustomerDocumentOcrBodySchema.parse(body);
    return this.documents.applyOcrSuggestion(customerId, documentId, data, user);
  }

  @Delete(':customerId/documents/:documentId/ocr/suggestion')
  @ApiOperation({ summary: 'G3: clear OCR suggestion without applying (before apply only)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(200)
  dismissOcr(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documents.dismissOcrSuggestion(customerId, documentId, user);
  }

  @Patch(':customerId/documents/:documentId/verification')
  @ApiOperation({ summary: 'Mark customer KYC document as staff-verified (or clear verification)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  setVerification(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = customerDocumentVerificationBodySchema.parse(body);
    return this.documents.setVerification(customerId, documentId, data.verified, user);
  }

  @Post(':customerId/documents')
  @ApiOperation({ summary: 'Upload customer document (multipart)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memory,
      limits: { fileSize: MAX_CUSTOMER_DOCUMENT_BYTES },
    }),
  )
  async upload(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('docType') docTypeRaw: string,
    @Body('retentionUntil') retentionUntilRaw: string | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) {
      throw new BadRequestException('file is required');
    }
    const meta = multipartMetaSchema.safeParse({
      docType: docTypeRaw,
      retentionUntil: retentionUntilRaw === '' || retentionUntilRaw === undefined ? undefined : retentionUntilRaw,
    });
    if (!meta.success) {
      throw new BadRequestException('Invalid docType or retentionUntil');
    }
    const retention = meta.data.retentionUntil as Date | null | undefined;
    return this.documents.upload(
      customerId,
      file,
      meta.data.docType as CustomerDocumentType,
      retention,
      user,
    );
  }

  @Delete(':customerId/documents/:documentId')
  @ApiOperation({ summary: 'Remove customer document' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  remove(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documents.remove(customerId, documentId, user);
  }
}
