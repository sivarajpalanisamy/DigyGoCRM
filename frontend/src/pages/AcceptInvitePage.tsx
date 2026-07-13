import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';

export default function AcceptInvitePage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) { toast.error('Invalid invite link - no token'); return; }
    if (password.length < 6) { toast.error('Password must be at least 6 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    try {
      const res = await api.post<{ token: string }>('/api/auth/setup-password', { token, password });
      setToken(res.token);
      // Re-bootstrap from the new access token
      const me = await api.get<any>('/api/auth/me');
      useAuthStore.setState({ currentUser: me, isAuthenticated: true });
      toast.success('Password set! Logging you in…');
      navigate('/dashboard');
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to set password. Link may be expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] p-4">
      <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
               style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand))' }}>
            <span className="text-white font-black text-xl">D</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#111318]">Set your password</h1>
          <p className="text-[15px] text-[#6b7280] mt-1">Choose a password to activate your account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[15px] font-medium text-[#111318] mb-1.5 block">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                className="w-full border border-[var(--hairline)] rounded-xl px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition pr-10"
                required
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[15px] font-medium text-[#111318] mb-1.5 block">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat your password"
              className="w-full border border-[var(--hairline)] rounded-xl px-4 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 transition"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl text-white font-bold text-[16px] transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
          >
            {loading ? 'Setting password…' : 'Activate Account'}
          </button>
        </form>
      </div>
    </div>
  );
}
