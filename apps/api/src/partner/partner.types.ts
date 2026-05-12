import type { Request } from 'express';

export type PartnerRequestContext = {
  partnerApiKeyId: string;
  companyId: string;
};

export type RequestWithPartner = Request & { partner?: PartnerRequestContext };
