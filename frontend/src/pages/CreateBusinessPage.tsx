import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { ChevronDown } from 'lucide-react';

const PLANS = ['Monthly', 'Yearly'];
const SNAPSHOTS = ['Blank (Start fresh)', 'Sales Starter Pack', 'Real Estate Template', 'E-Commerce Template'];

export default function CreateBusinessPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', loginPin: '',
    phone: '', plan: '', snapshot: '',
    businessName: '', address: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: '' }));
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim())    e.firstName    = 'First name is required';
    if (!form.lastName.trim())     e.lastName     = 'Last name is required';
    if (!form.email.trim())        e.email        = 'Email is required';
    if (!form.phone.trim())        e.phone        = 'Phone number is required!';
    if (!form.plan)                e.plan         = 'Please select a plan';
    if (!form.businessName.trim()) e.businessName = 'Business name is required';
    if (!form.address.trim())      e.address      = 'Address is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      const password = form.loginPin.trim() || form.phone.replace(/\D/g, '').slice(-6) || Math.random().toString(36).slice(-8);
      await api.post('/api/auth/tenants', {
        businessName: form.businessName,
        adminName: `${form.firstName} ${form.lastName}`.trim(),
        email: form.email,
        password,
        plan: 'starter',
        billing_cycle: form.plan.toLowerCase(), // 'monthly' | 'yearly'
        phone: form.phone,
        address: form.address,
      });
      toast.success(`${form.businessName} created! Login: ${form.email} / ${password}`);
      navigate('/admin');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const inp = (hasErr?: string) =>
    `w-full px-3 py-2.5 rounded border text-[14px] text-[#1c1410] outline-none transition-all bg-white placeholder:text-gray-300 ${
      hasErr
        ? 'border-red-400 focus:border-red-400 focus:ring-2 focus:ring-red-100'
        : 'border-gray-200 focus:border-primary/50 focus:ring-2 focus:ring-primary/10'
    }`;

  const lbl = 'block text-[14px] font-semibold text-[#1c1410] mb-1.5';

  return (
    <div className="max-w-6xl mx-auto">

      {/* Page title */}
      <div className="mb-6">
        <h2 className="font-headline font-bold text-[22px] text-[#1c1410]">Create New Business</h2>
        <p className="text-[13px] text-[#7a6b5c] mt-1">Fill in the details to create a new business account.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 bg-white rounded-2xl border border-black/5 overflow-hidden"
          style={{ boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

          {/* ── LEFT: Seller Info ── */}
          <div className="p-8 lg:border-r border-black/[0.06] space-y-5">
            <h3 className="font-bold text-[18px] text-[#1c1410] mb-6">Owner Info</h3>

            {/* First + Last Name */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={lbl}>First Name <span className="text-red-500">*</span></label>
                <input
                  value={form.firstName}
                  onChange={set('firstName')}
                  className={inp(errors.firstName)}
                  placeholder=""
                />
                {errors.firstName && <p className="text-[12px] text-red-500 mt-1">{errors.firstName}</p>}
              </div>
              <div>
                <label className={lbl}>Last Name <span className="text-red-500">*</span></label>
                <input
                  value={form.lastName}
                  onChange={set('lastName')}
                  className={inp(errors.lastName)}
                  placeholder=""
                />
                {errors.lastName && <p className="text-[12px] text-red-500 mt-1">{errors.lastName}</p>}
              </div>
            </div>

            {/* Email */}
            <div>
              <label className={lbl}>Email <span className="text-red-500">*</span></label>
              <input
                type="email"
                value={form.email}
                onChange={set('email')}
                className={inp(errors.email)}
                placeholder=""
              />
              {errors.email && <p className="text-[12px] text-red-500 mt-1">{errors.email}</p>}
            </div>

            {/* Login Pin */}
            <div>
              <label className={lbl}>Login Pin</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={form.loginPin}
                onChange={(e) => { if (/^\d*$/.test(e.target.value)) set('loginPin')(e); }}
                className={inp()}
                placeholder=""
              />
              <p className="text-[13px] text-blue-500 mt-1.5 font-medium">Can be used instead of OTP</p>
            </div>

            {/* Phone */}
            <div>
              <label className={lbl}>Phone <span className="text-red-500">*</span></label>
              <div className={`flex items-center rounded border ${errors.phone ? 'border-red-400' : 'border-gray-200'} overflow-hidden focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 bg-white transition-all`}>
                <div className="flex items-center gap-1.5 px-3 py-2.5 border-r border-gray-200 bg-gray-50 shrink-0">
                  <span className="text-[16px]">🇮🇳</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-[13px] text-[#1c1410] font-medium">+91</span>
                </div>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="81234 56789"
                  className="flex-1 px-3 py-2.5 text-[14px] text-[#1c1410] outline-none bg-transparent placeholder:text-gray-300"
                />
              </div>
              {errors.phone && <p className="text-[12px] text-red-500 mt-1">{errors.phone}</p>}
            </div>

            {/* Selected Subscription */}
            <div>
              <label className={lbl}>Selected Subscription <span className="text-red-500">*</span></label>
              <div className="relative">
                <select
                  value={form.plan}
                  onChange={set('plan')}
                  className={`${inp(errors.plan)} appearance-none pr-9 ${!form.plan ? 'text-gray-400' : ''}`}
                >
                  <option value="" disabled>Select Plan</option>
                  {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {errors.plan && <p className="text-[12px] text-red-500 mt-1">{errors.plan}</p>}
            </div>

            {/* Snapshot */}
            <div>
              <label className={lbl}>Snapshot</label>
              <div className="relative">
                <select
                  value={form.snapshot}
                  onChange={set('snapshot')}
                  className={`${inp()} appearance-none pr-9 ${!form.snapshot ? 'text-gray-400' : 'text-[#1c1410]'}`}
                >
                  <option value="" disabled>Select Snapshot</option>
                  {SNAPSHOTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* ── RIGHT: General Info ── */}
          <div className="p-8 space-y-5 bg-white">
            <h3 className="font-bold text-[18px] text-[#1c1410] mb-6">General Info</h3>

            {/* Business Name */}
            <div>
              <label className={lbl}>Business Name <span className="text-red-500">*</span></label>
              <input
                value={form.businessName}
                onChange={set('businessName')}
                className={inp(errors.businessName)}
                placeholder=""
              />
              {errors.businessName && <p className="text-[12px] text-red-500 mt-1">{errors.businessName}</p>}
            </div>

            {/* Address */}
            <div>
              <label className={lbl}>Address <span className="text-red-500">*</span></label>
              <textarea
                value={form.address}
                onChange={set('address')}
                rows={5}
                className={`${inp(errors.address)} resize-none`}
                placeholder=""
              />
              {errors.address && <p className="text-[12px] text-red-500 mt-1">{errors.address}</p>}
            </div>

            {/* Submit */}
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={loading}
                className="px-8 py-3 rounded text-white text-[13px] font-bold uppercase tracking-wider transition-all disabled:opacity-60 hover:opacity-90 active:scale-[0.98]"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
              >
                {loading ? 'Creating…' : 'Create Business'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
