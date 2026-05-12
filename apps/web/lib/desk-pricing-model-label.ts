import type { PublicMessageKey } from './public-messages';

const PRICING_MODEL_KEYS: Record<string, PublicMessageKey> = {
  PER_CLASS_DAY_24H: 'desk.fleet.quote.pricingModel.PER_CLASS_DAY_24H',
};

export function formatDeskPricingModel(
  model: string,
  t: (key: PublicMessageKey) => string,
): string {
  const key = PRICING_MODEL_KEYS[model];
  return key ? t(key) : model;
}
