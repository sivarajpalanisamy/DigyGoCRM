import { useState, useEffect } from 'react';
import { Eye, EyeOff, ArrowRight, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useBrandingStore } from '@/store/brandingStore';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState('');
  const [rememberDevice, setRememberDevice] = useState(true);
  const [challenge, setChallenge] = useState('');
  const [hasSetPin, setHasSetPin] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const requestPin = useAuthStore((s) => s.requestPin);
  const verifyPin = useAuthStore((s) => s.verifyPin);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { isCustomDomain, tenantName, logoUrl, brandColor, bannerUrl, loginBgColor, loaded, fetchBranding } = useBrandingStore();

  useEffect(() => {
    fetchBranding().catch(() => null);
  }, []);

  // "Get PIN by email" resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields'); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400)); // brief animation
    const result = await login(email, password);
    setLoading(false);
    if (result.pinRequired) {
      setChallenge(result.challenge ?? '');
      setHasSetPin(!!result.hasSetPin);
      setOtpStep(true);
      setError('');
    } else if (result.ok) {
      toast.success('Welcome back!');
      navigate('/dashboard');
    } else {
      setError('Invalid email or password');
    }
  };

  const handleGetPin = async () => {
    if (resendCooldown > 0 || !challenge) return;
    const r = await requestPin(challenge);
    if (r.ok) {
      toast.success(`PIN sent to ${email}`);
      setResendCooldown(45);
    } else {
      setError(r.error ?? 'Could not send PIN');
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otp.trim().length !== 4) { setError('Enter your 4-digit PIN'); return; }
    setLoading(true);
    const r = await verifyPin(challenge, otp.trim(), rememberDevice);
    setLoading(false);
    if (r.ok) {
      toast.success('Welcome back!');
      navigate('/dashboard');
    } else {
      setError(r.error ?? 'Incorrect PIN');
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[var(--app-bg)] font-sans text-[#1c1410]"
      style={{ WebkitTapHighlightColor: 'transparent', ...(isCustomDomain && loginBgColor ? { background: loginBgColor } : {}) }}
    >
      {/* Ambient background blobs — hidden when a custom login background is set */}
      {!(isCustomDomain && loginBgColor) && (
        <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-[5%] -left-[10%] w-[50%] h-[40%] rounded-full bg-primary/5 blur-[80px]" />
          <div className="absolute bottom-[10%] -right-[10%] w-[45%] h-[40%] rounded-full bg-[var(--accent-tint)]/30 blur-[80px]" />
        </div>
      )}

      {/* Banner image (custom domain) */}
      {isCustomDomain && bannerUrl && (
        <div className="w-full max-w-md px-5 relative z-10 mb-4">
          <img src={bannerUrl} alt="" className="w-full h-auto rounded-2xl object-cover max-h-40 shadow-md" />
        </div>
      )}

      {/* Content */}
      <div className="w-full max-w-md px-5 flex flex-col items-center relative z-10 pt-4 pb-0 mt-[-6vh]">

        {/* Logo — show tenant logo/name on custom domain, DigyGo logo otherwise */}
        {isCustomDomain ? (
          loaded ? (
            logoUrl
              ? <img src={logoUrl} alt={tenantName ?? ''} className="h-14 max-w-[220px] object-contain drop-shadow-md mb-0" />
              : <span className="text-2xl font-bold text-[#1c1410] mb-2">{tenantName}</span>
          ) : (
            <div className="w-44 h-12 bg-gray-200 rounded-lg animate-pulse mb-0" />
          )
        ) : (
          <img src="/digygo-logo.png" alt="DigyGo CRM" className="w-44 h-auto object-contain drop-shadow-md mb-0" />
        )}

        {/* Form card */}
        <main className="w-full">
          <div className="bg-white rounded-2xl p-5 border border-black/5" style={{ boxShadow: '0 8px 32px -4px rgba(0,0,0,0.06)' }}>
            {/* Heading inside card */}
            <div className="text-center mb-4">
              <h1 className="font-headline text-xl font-bold tracking-tight text-[#1c1410]">{otpStep ? 'Enter your PIN' : 'Welcome back'}</h1>
              <p className="text-[#5c5245] mt-1 text-[13px] leading-relaxed">
                {otpStep
                  ? 'Enter the PIN your admin gave you, or get a one-time PIN by email.'
                  : `Sign in to your ${isCustomDomain && tenantName ? tenantName : 'DigyGo CRM'} account`}
              </p>
            </div>

            {otpStep ? (
              <form onSubmit={handleVerifyPin} className="space-y-4">
                <input
                  inputMode="numeric"
                  autoFocus
                  maxLength={4}
                  value={otp}
                  onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(''); }}
                  placeholder="••••"
                  className="w-full text-center tracking-[0.5em] text-2xl font-bold h-[54px] rounded-xl border border-[#e8ddd4] outline-none focus:border-primary"
                />
                <button type="button" onClick={handleGetPin} disabled={resendCooldown > 0}
                  className="w-full text-center text-[13px] font-semibold text-primary hover:text-[var(--brand-dark)] disabled:text-[#b09e8d] disabled:cursor-not-allowed">
                  {resendCooldown > 0 ? `Resend PIN in ${resendCooldown}s` : 'Get PIN by email'}
                </button>
                <label className="flex items-center gap-2 text-[13px] text-[#5c5245] cursor-pointer">
                  <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} />
                  Remember this device for 30 days
                </label>
                {error && (
                  <div className="px-3 py-2.5 bg-[#ffdad6] rounded-xl"><p className="text-sm text-[#ba1a1a] font-medium">{error}</p></div>
                )}
                <button type="submit" disabled={loading}
                  className="w-full h-[54px] rounded-xl text-white text-[16px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-70 shadow-lg"
                  style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}>
                  {loading ? 'Verifying…' : 'Verify & Continue'}
                </button>
                <button type="button" onClick={() => { setOtpStep(false); setOtp(''); setError(''); setChallenge(''); }}
                  className="w-full text-center text-[12px] text-[#7a6b5c] hover:text-primary">← Back to login</button>
              </form>
            ) : (
            <form onSubmit={handleLogin} className="space-y-4">

              {/* Email */}
              <div className="space-y-1.5">
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] ml-1" htmlFor="email">
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
                  <div className="absolute inset-y-0 right-4 flex items-center pointer-events-none text-[#7a6b5c] group-focus-within:text-primary transition-colors">
                    <Mail size={18} />
                  </div>
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between ml-1">
                  <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245]" htmlFor="password">
                    Password
                  </label>
                  <a href="/forgot-password" className="text-[11px] font-semibold text-primary hover:underline">Forgot password?</a>
                </div>
                <div className="relative group">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(''); }}
                    required
                    className="pr-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-4 flex items-center text-[#7a6b5c] hover:text-primary transition-colors"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="px-3 py-2.5 bg-[#ffdad6] rounded-xl">
                  <p className="text-sm text-[#ba1a1a] font-medium">{error}</p>
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full h-[54px] rounded-xl text-white text-[16px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-70 shadow-lg"
                style={isCustomDomain && brandColor !== '#c2410c'
                  ? { background: brandColor }
                  : { background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }
                }
              >
                <span>{loading ? 'Signing in…' : 'Sign In'}</span>
                {!loading && <ArrowRight size={20} />}
              </button>

            </form>
            )}
          </div>
        </main>

        {/* Footer — hidden on custom domains (full white-label) */}
        {!isCustomDomain && (
          <footer className="mt-3 text-center">
            <p className="text-[11px] text-[#b09e8d]">Powered by DigyGo CRM © 2026</p>
          </footer>
        )}
      </div>
    </div>
  );
}
