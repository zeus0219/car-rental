import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createCompanySchema, createCompanyPrivacyNoticeBodySchema, updateCompanySchema } from '@car-rental/shared';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { CompanyService } from './company.service';
import { CompanyPrivacyNoticeService } from './company-privacy-notice.service';

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('companies')
export class CompanyController {
  constructor(
    private readonly company: CompanyService,
    private readonly privacyNotices: CompanyPrivacyNoticeService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List companies (scoped by role)' })
  list(@CurrentUser() user: JwtUser) {
    return this.company.findAll(user);
  }

  @Get(':companyId/privacy-notices')
  @ApiOperation({ summary: 'B4 — list registered privacy notice versions (counsel reference)' })
  listPrivacyNotices(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.privacyNotices.list(companyId, user);
  }

  @Post(':companyId/privacy-notices')
  @ApiOperation({ summary: 'B4 — register a privacy notice version' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  createPrivacyNotice(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = createCompanyPrivacyNoticeBodySchema.parse(body);
    return this.privacyNotices.create(companyId, data, user);
  }

  @Delete(':companyId/privacy-notices/:noticeId')
  @ApiOperation({ summary: 'B4 — remove a privacy notice register row (does not change customers)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @HttpCode(200)
  deletePrivacyNotice(
    @Param('companyId', new ParseUUIDPipe()) companyId: string,
    @Param('noticeId', new ParseUUIDPipe()) noticeId: string,
    @CurrentUser() user: JwtUser,
  ) {
    return this.privacyNotices.remove(companyId, noticeId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company by id' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.company.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create company (ADMIN only)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  create(@Body() body: unknown) {
    const data = createCompanySchema.parse(body);
    return this.company.create(data);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update company (ADMIN or BRANCH_MANAGER)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateCompanySchema.parse(body);
    return this.company.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete company (ADMIN only)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.company.remove(id);
  }
}
