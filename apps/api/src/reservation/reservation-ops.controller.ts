import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { memoryStorage } from 'multer';
import {
  damageReportPhotoPresignBodySchema,
  putReservationDamageBodySchema,
} from '@car-rental/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { ReservationOpsService } from './reservation-ops.service';

const memory = memoryStorage();
const maxUpload = 10 * 1024 * 1024;
const photoPhaseQ = new Set(['HANDOVER', 'RETURN']);

@ApiTags('Reservations')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('reservations')
@UseGuards(RolesGuard)
export class ReservationOpsController {
  constructor(private readonly ops: ReservationOpsService) {}

  @Get(':id/ops/storage-config')
  @ApiOperation({ summary: 'Attachment storage mode (local / s3)' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  opsStorageConfig() {
    return this.ops.getStorageConfig();
  }

  @Get(':id/ops/operation-photos')
  @ApiOperation({ summary: 'List handover/return condition photos' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  listOpPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.listOperationPhotos(id, user);
  }

  @Post(':id/ops/operation-photos/presign')
  @ApiOperation({ summary: 'Presign S3 upload for operation photo' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  presignOp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.presignOperationPhoto(id, body, user);
  }

  @Post(':id/ops/operation-photos/:photoId/complete')
  @ApiOperation({ summary: 'Complete S3 operation photo upload' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  completeOp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.completeOperationPhoto(id, photoId, user);
  }

  @Post(':id/ops/operation-photos')
  @ApiOperation({ summary: 'Upload operation photo (local storage)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memory,
      limits: { fileSize: maxUpload },
    }),
  )
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  uploadOp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('phase') phase: string | undefined,
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!phase || !photoPhaseQ.has(phase)) {
      throw new BadRequestException('Set query ?phase=HANDOVER or ?phase=RETURN');
    }
    if (!file) {
      throw new BadRequestException('Missing file (multipart field name: file)');
    }
    return this.ops.uploadOperationPhotoLocal(
      id,
      phase as 'HANDOVER' | 'RETURN',
      {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      user,
    );
  }

  @Get(':id/ops/operation-photos/:photoId/file')
  @ApiOperation({ summary: 'Download operation photo file' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  async downloadOp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const { attachment, createReadStream } = await this.ops.getOperationPhotoFile(id, photoId, user);
    return new StreamableFile(createReadStream(), {
      type: attachment.mimeType,
      disposition: `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
    });
  }

  @Delete(':id/ops/operation-photos/:photoId')
  @ApiOperation({ summary: 'Delete operation photo' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  removeOp(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.removeOperationPhoto(id, photoId, user);
  }

  @Get(':id/ops/damage')
  @ApiOperation({ summary: 'Get damage report' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getDamage(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.ops.getDamage(id, user);
  }

  @Put(':id/ops/damage')
  @ApiOperation({ summary: 'Create or replace damage report' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  putDamage(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.putDamage(id, putReservationDamageBodySchema.parse(body), user);
  }

  @Post(':id/ops/damage/photos/presign')
  @ApiOperation({ summary: 'Presign S3 upload for damage photo' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  presignDmg(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.presignDamagePhoto(id, body, user);
  }

  @Post(':id/ops/damage/photos/:photoId/complete')
  @ApiOperation({ summary: 'Complete S3 damage photo upload' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  completeDmg(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.completeDamagePhoto(id, photoId, user);
  }

  @Post(':id/ops/damage/photos')
  @ApiOperation({ summary: 'Upload damage photo (local storage)' })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memory,
      limits: { fileSize: maxUpload },
    }),
  )
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  uploadDmg(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('Missing file (multipart field name: file)');
    }
    return this.ops.uploadDamagePhotoLocal(
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

  @Get(':id/ops/damage/photos/:photoId/file')
  @ApiOperation({ summary: 'Download damage photo file' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  async downloadDmg(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    const { attachment, createReadStream } = await this.ops.getDamagePhotoFile(id, photoId, user);
    return new StreamableFile(createReadStream(), {
      type: attachment.mimeType,
      disposition: `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
    });
  }

  @Delete(':id/ops/damage/photos/:photoId')
  @ApiOperation({ summary: 'Delete damage photo' })
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  removeDmg(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.ops.removeDamagePhoto(id, photoId, user);
  }
}
