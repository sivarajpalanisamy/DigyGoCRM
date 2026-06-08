import { create } from 'zustand';

export interface BillingInfo {
  status?: string | null;
  business_name?: string | null;
  billing_cycle?: string | null;
  expires_at?: string | null;
  amount_due?: number | null;
  grace_days?: number | null;
}

interface BillingState {
  blocked: boolean;
  info: BillingInfo | null;
  setBlocked: (info: BillingInfo) => void;
  clear: () => void;
}

// Set by: (a) the api.ts 402 interceptor, and (b) the login/me tenant payload.
// AuthGuard renders the Payment Due overlay whenever `blocked` is true.
export const useBillingStore = create<BillingState>((set) => ({
  blocked: false,
  info: null,
  setBlocked: (info) => set({ blocked: true, info }),
  clear: () => set({ blocked: false, info: null }),
}));
