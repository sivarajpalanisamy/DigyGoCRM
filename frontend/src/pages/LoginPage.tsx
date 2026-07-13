import { useState, useEffect } from 'react';
import { Eye, EyeOff, ArrowRight, Mail, Quote, Zap, MessageCircle, BarChart3 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBrandingStore } from '@/store/brandingStore';
import { toast } from 'sonner';

// Default product name for non-white-label (non-custom-domain) logins.
// Change this one constant to rebrand the login copy.
const PRODUCT_NAME = 'Hawcus CRM';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const currentUser = useAuthStore((s) => s.currentUser);
  const { isCustomDomain, tenantName, logoUrl, brandColor, bannerUrl, loginBgColor, loaded, fetchBranding } = useBrandingStore();

  // Super admins have no tenant dashboard, so /dashboard is blank for them - send them
  // to the admin panel instead (matches the AuthGuard redirect on refresh).
  const homePath = (role?: string) => (role === 'super_admin' ? '/admin' : '/dashboard');

  const brandName = isCustomDomain && tenantName ? tenantName : PRODUCT_NAME;

  useEffect(() => {
    fetchBranding().catch(() => null);
  }, []);

  // "Get OTP by email" resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  if (isAuthenticated) return <Navigate to={homePath(currentUser?.role)} replace />;

  // The password field is a single "secret": the account password, an admin-set PIN,
  // or a one-time PIN requested by email - any of them logs the user in.
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Enter your email and your password or PIN'); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400)); // brief animation
    const result = await login(email, password);
    setLoading(false);
    if (result.ok) {
      toast.success('Welcome back!');
      navigate(homePath(useAuthStore.getState().currentUser?.role));
    } else {
      setError('Invalid email or password/PIN');
    }
  };

  const handleGetOtp = async () => {
    if (resendCooldown > 0) return;
    if (!email) { setError('Enter your email first'); return; }
    setError('');
    await requestOtp(email);
    toast.success(`If an account exists for ${email}, a PIN has been emailed`);
    setResendCooldown(45);
  };

  const submitStyle = isCustomDomain && brandColor !== '#c2410c'
    ? { background: brandColor }
    : { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' };

  return (
    <div
      className="min-h-[100dvh] grid grid-cols-1 md:grid-cols-2 font-sans text-[#111318]"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* ── Left: brand / marketing panel (hidden on small screens) ───────────── */}
      <aside
        className="relative hidden md:flex flex-col justify-center overflow-hidden p-10 lg:p-16 text-white"
        style={{ background: 'linear-gradient(150deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
      >
        {/* White dot grid */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'radial-gradient(rgba(255,255,255,0.32) 1.3px, transparent 1.3px)',
            backgroundSize: '22px 22px',
            maskImage: 'radial-gradient(140% 120% at 30% 40%, #000 70%, transparent 100%)',
            WebkitMaskImage: 'radial-gradient(140% 120% at 30% 40%, #000 70%, transparent 100%)',
          }}
        />

        {/* Decorative ambient shapes */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-[12%] -left-[10%] w-[55%] h-[45%] rounded-full bg-white/10 blur-[90px]" />
          <div className="absolute bottom-[-10%] right-[-8%] w-[50%] h-[45%] rounded-full bg-black/10 blur-[90px]" />
        </div>

        {/* Scattered decorative icons */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <MessageCircle className="absolute top-[12%] right-[13%] w-16 h-16 text-white/15 -rotate-12" strokeWidth={1.5} />
          <BarChart3 className="absolute bottom-[15%] right-[20%] w-14 h-14 text-white/15 rotate-6" strokeWidth={1.5} />
          <Zap className="absolute bottom-[26%] left-[9%] w-12 h-12 text-white/15 rotate-12" strokeWidth={1.5} />
        </div>

        {/* Centered brand name + quote + about */}
        <div className="relative z-10 max-w-[480px]">
          {/* Logo on a clean white chip so the full-colour logo (incl. the orange dot) stays crisp */}
          <div className="inline-flex items-center rounded-xl bg-white px-5 py-2.5 shadow-[0_10px_34px_rgba(0,0,0,0.20)] mb-8">
            {isCustomDomain ? (
              loaded && logoUrl
                ? <img src={logoUrl} alt={tenantName ?? ''} className="h-11 lg:h-12 w-auto max-w-[220px] object-contain" />
                : <span className="font-headline text-3xl lg:text-4xl font-black tracking-tight text-[#111318]">{brandName}</span>
            ) : (
              <img src="/hawcus-logo.png" alt={brandName} className="h-11 lg:h-12 w-auto max-w-[260px] object-contain" />
            )}
          </div>

          <Quote className="w-9 h-9 text-white/40 mb-5" />
          <h2 className="font-headline text-[24px] lg:text-[28px] font-bold leading-[1.3] tracking-tight">
            Turn every lead into a conversation, and every conversation into a customer.
          </h2>
          <p className="mt-5 text-[15px] lg:text-[16px] leading-relaxed text-white/80">
            {brandName} brings your leads, pipelines, follow-ups, and WhatsApp conversations into one
            workspace - so your team spends time closing deals, not chasing tabs.
          </p>
        </div>

        {/* Footer pinned to bottom */}
        <p className="absolute bottom-8 left-10 lg:left-16 z-10 text-[13px] text-white/60">© 2026 {brandName}. All rights reserved.</p>
      </aside>

      {/* ── Right: login card ─────────────────────────────────────────────────── */}
      <main
        className="relative flex items-center justify-center bg-[var(--app-bg)] px-5 py-10"
        style={isCustomDomain && loginBgColor ? { background: loginBgColor } : undefined}
      >
        {/* Ambient blobs (only when no custom login background) */}
        {!(isCustomDomain && loginBgColor) && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden md:hidden">
            <div className="absolute -top-[5%] -left-[10%] w-[60%] h-[35%] rounded-full bg-primary/5 blur-[80px]" />
            <div className="absolute bottom-[8%] -right-[10%] w-[55%] h-[35%] rounded-full bg-[var(--accent-tint)]/30 blur-[80px]" />
          </div>
        )}

        <div className="relative z-10 w-full max-w-[400px]">
          {/* Banner image (custom domain) */}
          {isCustomDomain && bannerUrl && (
            <img src={bannerUrl} alt="" className="w-full h-auto rounded-2xl object-cover max-h-40 shadow-md mb-6" />
          )}

          {/* Mobile-only logo (left panel is hidden below md) */}
          <div className="md:hidden mb-6 flex justify-center">
            {isCustomDomain ? (
              loaded && logoUrl
                ? <img src={logoUrl} alt={tenantName ?? ''} className="h-12 max-w-[200px] object-contain drop-shadow" />
                : <span className="text-2xl font-bold text-[#111318]">{brandName}</span>
            ) : (
              <img src="/hawcus-logo.png" alt={brandName} className="w-40 h-auto object-contain drop-shadow" />
            )}
          </div>

          <div className="mb-7">
            <h1 className="font-headline text-[26px] font-bold tracking-tight text-[#111318]">Welcome back</h1>
            <p className="text-[#4a4f57] mt-1.5 text-[15px] leading-relaxed">
              Sign in to your {brandName} account to continue.
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div className="space-y-1.5">
              <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57] ml-1" htmlFor="email">
                Email Address
              </label>
              <div className="relative group">
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  required
                  autoFocus
                  className="pr-11"
                />
                <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#6b7280] group-focus-within:text-primary transition-colors">
                  <Mail size={18} />
                </div>
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between ml-1">
                <label className="block text-[12px] font-bold uppercase tracking-[0.08em] text-[#4a4f57]" htmlFor="password">
                  Password or PIN
                </label>
                <a href="/forgot-password" className="text-[12px] font-semibold text-primary hover:underline">Forgot password?</a>
              </div>
              <div className="relative group">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password, PIN, or one-time code"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  required
                  className="pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-4 flex items-center text-[#6b7280] hover:text-primary transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {/* Passwordless: email a one-time PIN to type above */}
              <button type="button" onClick={handleGetOtp} disabled={resendCooldown > 0}
                className="text-[12px] font-semibold text-primary hover:underline disabled:text-[#9ca3af] disabled:no-underline disabled:cursor-not-allowed ml-1">
                {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Get OTP by email'}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="px-3 py-2.5 bg-[#ffdad6] rounded-xl">
                <p className="text-[15px] text-[#ba1a1a] font-medium">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full h-[54px] rounded-xl text-white text-[16px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-70 shadow-lg"
              style={submitStyle}
            >
              <span>{loading ? 'Signing in…' : 'Sign In'}</span>
              {!loading && <ArrowRight size={20} />}
            </button>
          </form>

          {/* Footer - hidden on custom domains (full white-label) */}
          {!isCustomDomain && (
            <p className="mt-8 text-center text-[12px] text-[#9ca3af]">Powered by {PRODUCT_NAME} © 2026</p>
          )}
        </div>
      </main>
    </div>
  );
}
