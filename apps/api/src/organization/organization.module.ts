import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RentalAgreementModule } from '../rental-agreement/rental-agreement.module';
import { CompanyController } from './company/company.controller';
import { CompanyService } from './company/company.service';
import { CustomerController } from './customer/customer.controller';
import { CustomerDocumentService } from './customer/customer-document.service';
import { CustomerDocumentsController } from './customer/customer-documents.controller';
import { CustomerService } from './customer/customer.service';
import { CompanyPrivacyNoticeService } from './company/company-privacy-notice.service';
import { StationController } from './station/station.controller';
import { StationService } from './station/station.service';
import { StaffController } from './staff/staff.controller';
import { StaffService } from './staff/staff.service';

@Module({
  imports: [AuthModule, RentalAgreementModule],
  controllers: [
    CompanyController,
    CustomerController,
    CustomerDocumentsController,
    StationController,
    StaffController,
  ],
  providers: [
    CompanyService,
    CompanyPrivacyNoticeService,
    CustomerService,
    CustomerDocumentService,
    StationService,
    StaffService,
  ],
  exports: [CustomerDocumentService],
})
export class OrganizationModule {}
