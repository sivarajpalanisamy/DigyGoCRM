import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CompanyState {
  logoUrl: string | null;
  companyName: string;
  superfoneEnabled: boolean;   // per-tenant Calls/Superfone feature flag
  setLogo: (url: string | null) => void;
  setCompanyName: (name: string) => void;
  setSuperfoneEnabled: (v: boolean) => void;
}

export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      logoUrl: null,
      companyName: 'Hawcus CRM',
      superfoneEnabled: false,
      setLogo: (url) => set({ logoUrl: url }),
      setCompanyName: (name) => set({ companyName: name }),
      setSuperfoneEnabled: (v) => set({ superfoneEnabled: v }),
    }),
    { name: 'digygo-company' }
  )
);
