import { useState } from 'react';
import { Eye, EyeOff, ArrowRight, Mail } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError('Please fill in all fields'); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 400)); // brief animation
    const ok = await login(email, password);
    setLoading(false);
    if (ok) {
      toast.success('Welcome back!');
      navigate('/dashboard');
    } else {
      setError('Invalid email or password');
    }
  };

  return (
    <div
      className="min-h-[100dvh] flex flex-col items-center justify-center bg-[#faf8f6] font-sans text-[#1c1410]"
      style={{ WebkitTapHighlightColor: 'transparent' }}
    >
      {/* Ambient background blobs */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[5%] -left-[10%] w-[50%] h-[40%] rounded-full bg-[#c2410c]/5 blur-[80px]" />
        <div className="absolute bottom-[10%] -right-[10%] w-[45%] h-[40%] rounded-full bg-[#fed7aa]/30 blur-[80px]" />
      </div>

      {/* Content */}
      <div className="w-full max-w-md px-5 flex flex-col items-center relative z-10 pt-4 pb-0 mt-[-6vh]">

        {/* Logo */}
        <img src="/digygo-logo.png" alt="DigyGo CRM" className="w-44 h-auto object-contain drop-shadow-md mb-3" />

        {/* Form card */}
        <main className="w-full">
          <div className="bg-white rounded-2xl p-5 border border-black/5" style={{ boxShadow: '0 8px 32px -4px rgba(0,0,0,0.06)' }}>
            {/* Heading inside card */}
            <div className="text-center mb-4">
              <h1 className="font-headline text-xl font-bold tracking-tight text-[#1c1410]">Welcome back</h1>
              <p className="text-[#5c5245] mt-1 text-[13px] leading-relaxed">Sign in to your DigyGo CRM account</p>
            </div>
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
                <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] ml-1" htmlFor="password">
                  Password
                </label>
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
                className="w-full h-[54px] rounded-xl text-white text-[16px] font-bold flex items-center justify-center gap-2 active:scale-[0.97] transition-all disabled:opacity-70 shadow-lg shadow-primary/20"
                style={{ background: 'linear-gradient(135deg, #c2410c 0%, #ea580c 55%, #f97316 100%)' }}
              >
                <span>{loading ? 'Signing in…' : 'Sign In'}</span>
                {!loading && <ArrowRight size={20} />}
              </button>

            </form>
          </div>
        </main>

        {/* Footer */}
        <footer className="mt-3 text-center">
          <p className="text-[11px] text-[#b09e8d]">Powered by DigyGo CRM © 2026</p>
        </footer>
      </div>
    </div>
  );
}
