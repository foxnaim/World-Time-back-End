import { SubscriptionTier } from '@prisma/client';

/**
 * Tier feature matrix.
 *
 * Source of truth for seat caps, feature flags, and per-seat pricing. The
 * BillingService reads from here to compute effective limits; the
 * SeatLimitGuard reads `seatsLimit` to block invites past the cap. Prices
 * are in RUB per seat per month. ENTERPRISE is "contact sales" and therefore
 * has a null price — the checkout flow should route those to a contact form
 * rather than generating an invoice.
 */
export interface TierFeatures {
  seatsLimit: number;
  monthlyReports: boolean;
  sheetsExport: boolean;
  customBranding: boolean;
  pricePerSeat: number | null;
}

export const TIERS: Record<SubscriptionTier, TierFeatures> = {
  FREE: {
    seatsLimit: 5,
    monthlyReports: true,
    sheetsExport: false,
    customBranding: false,
    pricePerSeat: 0,
  },
  TEAM: {
    seatsLimit: 100,
    monthlyReports: true,
    sheetsExport: true,
    customBranding: false,
    pricePerSeat: 200,
  },
  ENTERPRISE: {
    seatsLimit: 10_000,
    monthlyReports: true,
    sheetsExport: true,
    customBranding: true,
    pricePerSeat: null,
  },
};
