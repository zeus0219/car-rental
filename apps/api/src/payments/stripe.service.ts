import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly client: Stripe | null;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    this.client = key ? new Stripe(key, { apiVersion: '2025-08-27.basil' }) : null;
  }

  get api(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException('Stripe is not configured (STRIPE_SECRET_KEY)');
    }
    return this.client;
  }

  isEnabled(): boolean {
    return this.client != null;
  }
}
