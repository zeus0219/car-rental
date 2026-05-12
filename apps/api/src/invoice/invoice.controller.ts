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
import { createInvoiceSchema, updateInvoiceSchema } from '@car-rental/shared';
import { z } from 'zod';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { JwtUser } from '../auth/types';
import { OPENAPI_JWT } from '../openapi.constants';
import { InvoiceService } from './invoice.service';

const listQuery = z
  .object({
    companyId: z.string().uuid().optional(),
    q: z.string().min(1).max(200).optional(),
    status: z.enum(['DRAFT', 'ISSUED', 'VOID']).optional(),
    kind: z.enum(['INVOICE', 'CREDIT_NOTE']).optional(),
    reservationId: z.string().uuid().optional(),
  })
  .strict();
const companyIdQuery = z.string().uuid().optional();

@ApiTags('Invoices')
@ApiBearerAuth(OPENAPI_JWT)
@Controller('invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  @ApiOperation({ summary: 'List invoices (companyId, q, status, kind, reservationId filters)' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  list(
    @CurrentUser() user: JwtUser,
    @Query('companyId') companyId: string | undefined,
    @Query('q') q: string | undefined,
    @Query('status') status: string | undefined,
    @Query('kind') kind: string | undefined,
    @Query('reservationId') reservationId: string | undefined,
  ) {
    const p = listQuery.safeParse({ companyId, q, status, kind, reservationId });
    if (!p.success) {
      throw new BadRequestException('Invalid query (filters / UUIDs / q max 200 chars)');
    }
    const c = p.data.companyId;
    const filters = {
      q: p.data.q,
      status: p.data.status,
      kind: p.data.kind,
      reservationId: p.data.reservationId,
    };
    if (c === undefined || c === '') {
      return this.invoices.findAll(undefined, filters, user);
    }
    const r = companyIdQuery.safeParse(c);
    if (!r.success) {
      throw new BadRequestException('Invalid companyId');
    }
    return this.invoices.findAll(r.data, filters, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get invoice by id' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT', 'READONLY_ACCOUNTING')
  getOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.invoices.findOne(id, user);
  }

  @Post()
  @ApiOperation({ summary: 'Create draft invoice' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  create(@Body() body: unknown, @CurrentUser() user: JwtUser) {
    const data = createInvoiceSchema.parse(body);
    return this.invoices.create(data, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update draft invoice' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser() user: JwtUser,
  ) {
    const data = updateInvoiceSchema.parse(body);
    return this.invoices.update(id, data, user);
  }

  @Post(':id/issue')
  @ApiOperation({ summary: 'Issue invoice' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  issue(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.invoices.issue(id, user);
  }

  @Post(':id/void')
  @ApiOperation({ summary: 'Void invoice' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(200)
  void(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    return this.invoices.void(id, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete draft invoice' })
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'BRANCH_MANAGER', 'AGENT')
  @HttpCode(204)
  async remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: JwtUser) {
    await this.invoices.remove(id, user);
  }
}
