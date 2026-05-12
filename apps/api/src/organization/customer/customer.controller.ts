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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { anonymizeCustomerBodySchema, createCustomerSchema, mergeCustomerBodySchema, updateCustomerSchema } from '@car-rental/shared';
import { z } from 'zod';
import { CurrentUser } from '../../auth/current-user.decorator';
import { Roles } from '../../auth/roles.decorator';
import { RolesGuard } from '../../auth/roles.guard';
import { JwtUser } from '../../auth/types';
import { OPENAPI_JWT } from '../../openapi.constants';
import { CustomerService } from './customer.service';

const companyIdQuery = z.string().uuid().optional();
const listQuery = z
  .object({
    companyId: z.string().uuid().optional(),
    q: z.string().min(1).max(200).optional(),
    ocrPending: z
      .string()
      .optional()
      .transform((s) => {
        if (s == null || s === '') return false;
        const t = s.trim().toLowerCase();
        return t === '1' || t === 'true' || t === 'yes';
      }),
  })
  .strict();

@ApiTags('Organization')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('customers')
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get(':id/gdpr/export')
  @ApiOperation({ summary: 'Export GDPR data package for a customer' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  exportGdpr(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.customers.exportGdprPackage(id, user);
  }

  @Post(':id/gdpr/anonymize')
  @ApiOperation({ summary: 'Anonymize customer personal data (GDPR)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @HttpCode(200)
  anonymize(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const p = anonymizeCustomerBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.customers.anonymize(id, p.data, user);
  }

  @Post(':id/merge')
  @ApiOperation({
    summary:
      'B1 — merge duplicate customer: move reservations + KYC documents to another profile, delete this one (ADMIN/BRANCH)',
  })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER')
  @HttpCode(200)
  merge(
    @Param('id', new ParseUUIDPipe()) fromCustomerId: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const p = mergeCustomerBodySchema.safeParse(body);
    if (!p.success) {
      throw new BadRequestException(p.error.flatten().fieldErrors);
    }
    return this.customers.mergeInto(fromCustomerId, p.data.intoCustomerId, user);
  }

  @Get()
  @ApiOperation({
    summary:
      'List customers (optional companyId, search q, ocrPending=1 to restrict to profiles with a G3 OCR-queued document)',
  })
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('q') q: string | undefined,
    @Query('ocrPending') ocrPending: string | undefined,
  ) {
    const p = listQuery.safeParse({ companyId, q, ocrPending });
    if (!p.success) {
      throw new BadRequestException('Invalid query (companyId must be a UUID, q max 200 chars)');
    }
    const c = p.data.companyId;
    const ocrOpts = { ocrPending: p.data.ocrPending };
    if (c === undefined || c === '') {
      return this.customers.findAll(undefined, p.data.q, user, ocrOpts);
    }
    const r = companyIdQuery.safeParse(c);
    if (!r.success) {
      throw new BadRequestException('Invalid companyId');
    }
    return this.customers.findAll(r.data, p.data.q, user, ocrOpts);
  }

  @Get('lookup-by-email')
  @ApiOperation({ summary: 'B1 — same-company customer with this email (dedupe hint for desk)' })
  lookupByEmail(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('email') email: string | undefined,
    @Query('excludeCustomerId') excludeCustomerId: string | undefined,
  ) {
    const p = z
      .object({
        companyId: z.string().uuid(),
        email: z.string().min(1).max(320),
        excludeCustomerId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse({ companyId, email, excludeCustomerId });
    if (!p.success) {
      throw new BadRequestException('Invalid query (companyId must be a UUID, email required)');
    }
    const emailNorm = z
      .string()
      .email()
      .max(320)
      .transform((s) => s.trim().toLowerCase())
      .safeParse(p.data.email);
    if (!emailNorm.success) {
      return { match: null };
    }
    return this.customers.lookupByEmail(
      p.data.companyId,
      emailNorm.data,
      p.data.excludeCustomerId,
      user,
    );
  }

  @Get('lookup-by-fiscal-code')
  @ApiOperation({ summary: 'B1 — same-company customer with this codice fiscale (dedupe hint for desk)' })
  lookupByFiscalCode(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('fiscalCode') fiscalCode: string | undefined,
    @Query('excludeCustomerId') excludeCustomerId: string | undefined,
  ) {
    const p = z
      .object({
        companyId: z.string().uuid(),
        fiscalCode: z.string().min(1).max(32),
        excludeCustomerId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse({ companyId, fiscalCode, excludeCustomerId });
    if (!p.success) {
      throw new BadRequestException(
        'Invalid query (companyId must be a UUID, fiscalCode required, max 32 chars)',
      );
    }
    return this.customers.lookupByFiscalCode(
      p.data.companyId,
      p.data.fiscalCode,
      p.data.excludeCustomerId,
      user,
    );
  }

  @Get('lookup-by-vat')
  @ApiOperation({ summary: 'B1 — same-company customer with this Partita IVA (dedupe hint for desk)' })
  lookupByVat(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('vatNumber') vatNumber: string | undefined,
    @Query('excludeCustomerId') excludeCustomerId: string | undefined,
  ) {
    const p = z
      .object({
        companyId: z.string().uuid(),
        vatNumber: z.string().min(1).max(20),
        excludeCustomerId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse({ companyId, vatNumber, excludeCustomerId });
    if (!p.success) {
      throw new BadRequestException(
        'Invalid query (companyId must be a UUID, vatNumber required, max 20 chars)',
      );
    }
    return this.customers.lookupByVatNumber(
      p.data.companyId,
      p.data.vatNumber,
      p.data.excludeCustomerId,
      user,
    );
  }

  @Get('lookup-by-phone')
  @ApiOperation({ summary: 'B1 — same-company customer with this phone (digits match; dedupe hint for desk)' })
  lookupByPhone(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('phone') phone: string | undefined,
    @Query('excludeCustomerId') excludeCustomerId: string | undefined,
  ) {
    const p = z
      .object({
        companyId: z.string().uuid(),
        phone: z.string().min(1).max(40),
        excludeCustomerId: z.string().uuid().optional(),
      })
      .strict()
      .safeParse({ companyId, phone, excludeCustomerId });
    if (!p.success) {
      throw new BadRequestException(
        'Invalid query (companyId must be a UUID, phone required, max 40 chars)',
      );
    }
    return this.customers.lookupByPhone(
      p.data.companyId,
      p.data.phone,
      p.data.excludeCustomerId,
      user,
    );
  }

  @Get(':id/reservations')
  @ApiOperation({ summary: 'B1 — customer rental history (paginated, newest pickup first)' })
  listReservations(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: JwtUser,
    @Query('limit') limit: string | undefined,
    @Query('offset') offset: string | undefined,
  ) {
    const p = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        offset: z.coerce.number().int().min(0).max(50_000).default(0),
      })
      .strict()
      .safeParse({ limit, offset });
    if (!p.success) {
      throw new BadRequestException('Invalid query (limit 1–100, offset 0–50000)');
    }
    return this.customers.listReservations(id, user, p.data);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get customer by id' })
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.customers.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create customer' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createCustomerSchema.parse(body);
    return this.customers.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update customer' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateCustomerSchema.parse(body);
    return this.customers.update(id, data, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete customer' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.customers.remove(id, user);
  }
}
