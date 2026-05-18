import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CargosModule } from '../integrations/cargos/cargos.module';
import { AgreementAttachmentService } from './agreement-attachment.service';
import { ObjectStorageS3Service } from './object-storage-s3.service';
import { RentalAgreementController } from './rental-agreement.controller';
import { RentalAgreementPdfService } from './rental-agreement-pdf.service';
import { RentalAgreementService } from './rental-agreement.service';

@Module({
  imports: [AuthModule, CargosModule, AuditModule],
  controllers: [RentalAgreementController],
  providers: [
    RentalAgreementService,
    RentalAgreementPdfService,
    AgreementAttachmentService,
    ObjectStorageS3Service,
  ],
  exports: [RentalAgreementService, AgreementAttachmentService, ObjectStorageS3Service],
})
export class RentalAgreementModule {}
