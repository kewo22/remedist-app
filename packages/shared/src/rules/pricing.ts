// Session prices. Amounts are integer minor units: LKR 45,000.00 is 4500000, USD 200.00 is 20000.

export const CURRENCIES = ['LKR', 'USD'] as const;
export type Currency = (typeof CURRENCIES)[number];

/** contacts.residency: 'lk' pays in LKR, 'intl' in USD (set from nationality; see residencyForNationality). */
export type Residency = 'lk' | 'intl';

/** A slot or session type's prices; at least one is set. */
export interface SessionRates {
  rateLkrMinor: number | null;
  rateUsdMinor: number | null;
}

export interface Price {
  amountMinor: number;
  currency: Currency;
}

/**
 * What a slot costs this client. Sri Lankans pay the LKR price and everyone else the USD price; a
 * slot priced in only one currency charges that price to everyone. The one function for this, so
 * the price shown is the price charged.
 */
export function rateForResidency(rates: SessionRates, residency: Residency): Price {
  const lkr: Price | null = rates.rateLkrMinor === null ? null : { amountMinor: rates.rateLkrMinor, currency: 'LKR' };
  const usd: Price | null = rates.rateUsdMinor === null ? null : { amountMinor: rates.rateUsdMinor, currency: 'USD' };
  const price = residency === 'lk' ? (lkr ?? usd) : (usd ?? lkr);
  if (!price) {
    throw new Error('A slot needs a price in at least one currency');
  }
  return price;
}

/** The largest amount accepted, in minor units (LKR 100,000,000.00): a typo guard, not a business rule. */
export const MAX_RATE_MINOR = 10_000_000_000;

/** Minor units → major for display: 4500000 → 45000. Both currencies have 2 decimal places. */
export function toMajorUnits(amountMinor: number): number {
  return amountMinor / 100;
}
