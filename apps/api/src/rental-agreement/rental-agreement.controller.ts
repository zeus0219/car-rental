import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express, Request } from 'express';
import { memoryStorage } from 'multer';
import {
  agreementAttachmentPresignBodySchema,
  createRentalAgreementSchema,
  signRentalAgreementSchema,
  updateRentalAgreementSchema,
} from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { AgreementAttachmentService } from './agreement-attachment.service';
import { RentalAgreementService } from './rental-agreement.service';

const memory = memoryStorage();
const maxUpload = 10 * 1024 * 1024;

@ApiTags('Agreements')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('agreements')
@UseGuards(RolesGuard)
export class RentalAgreementController {
  constructor(
    private readonly agreements: RentalAgreementService,
    private readonly attachments: AgreementAttachmentService,
  ) {}

  @Get('storage-config')
  @ApiOperation({ summary: 'Agreement attachment storage mode (local vs S3)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getStorageConfig() {
    return this.attachments.getStorageConfig();
  }

  @Get('by-reservation/:reservationId')
  @ApiOperation({ summary: 'Get agreement for a reservation' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getByReservation(
    @Param('reservationId', new ParseUUIDPipe()) reservationId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.agreements.getByReservationId(reservationId, user);
  }

  @Get(':id/attachments')
  @ApiOperation({ summary: 'List agreement attachments' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  listAttachments(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.attachments.list(id, user);
  }

  @Get(':id/attachments/:attachmentId/file')
  @ApiOperation({ summary: 'Download agreement attachment file' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  async download(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const { attachment, createReadStream } = await this.attachments.getFileForDownload(
      id,
      attachmentId,
      user,
    );
    return new StreamableFile(createReadStream(), {
      type: attachment.mimeType,
      disposition: `attachment; filename="${encodeURIComponent(attachment.originalName)}"`,
    });
  }

  @Post(':id/attachments/presign')
  @ApiOperation({ summary: 'Presign upload for agreement attachment' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  presign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.attachments.createPresignedUpload(id, agreementAttachmentPresignBodySchema.parse(body), user);
  }

  @Post(':id/attachments/:attachmentId/complete')
  @ApiOperation({ summary: 'Complete presigned agreement attachment upload' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  completePresigned(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.attachments.completePresignedUpload(id, attachmentId, user);
  }

  @Post(':id/attachments')
  @ApiOperation({ summary: 'Upload agreement attachment (multipart)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memory,
      limits: { fileSize: maxUpload },
    }),
  )
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  upload(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file (multipart field name: file)');
    }
    return this.attachments.upload(
      id,
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      user,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Remove agreement attachment' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('attachmentId', new ParseUUIDPipe()) attachmentId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.attachments.remove(id, attachmentId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get rental agreement by id' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.agreements.getById(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create rental agreement' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    return this.agreements.create(createRentalAgreementSchema.parse(body), user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update rental agreement' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.agreements.update(id, updateRentalAgreementSchema.parse(body), user);
  }

  @Post(':id/sign')
  @ApiOperation({
    summary:
      'Sign rental agreement (e-sign metadata); optional auto CaRGOS enqueue (CARGOS_AUTO_ENQUEUE_ON_SIGN)',
  })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  sign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
    @Req() req: Request,
  ) {
    return this.agreements.sign(id, signRentalAgreementSchema.parse(body), user, {
      clientIp: esignClientIp(req),
      userAgent: esignUserAgent(req),
    });
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void draft rental agreement' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  void(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.agreements.voidDraft(id, user);
  }
}

const ESIGN_UA_MAX = 2000;

function esignClientIp(req: Request): string | null {
  const raw = req.ip;
  if (raw && raw !== '::1') {
    return raw.length > 45 ? raw.slice(0, 45) : raw;
  }
  const sock = req.socket?.remoteAddress;
  if (sock) {
    return sock.length > 45 ? sock.slice(0, 45) : sock;
  }
  return null;
}

function esignUserAgent(req: Request): string | null {
  const ua = req.get('user-agent');
  if (!ua) {
    return null;
  }
  return ua.length > ESIGN_UA_MAX ? ua.slice(0, ESIGN_UA_MAX) : ua;
}
