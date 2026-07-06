import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) { toast.error('Enter a valid email'); return; }
    setLoading(true);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch {
      // endpoint always returns generic success; show the same to avoid leaking info
      setSent(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--app-bg)] p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8 space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
            <h1 className="text-2xl font-extrabold text-[#1c1410]">Check your email</h1>
            <p className="text-[14px] text-[#7a6b5c]">
              If an account exists for <strong>{email}</strong>, we've sent a password reset link.
              It expires in 1 hour.
            </p>
            <Link to="/login" className="inline-flex items-center gap-1.5 text-[14px] text-primary font-semibold hover:underline">
              <ArrowLeft className="w-4 h-4" /> Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center">
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
                   style={{ background: 'linear-gradient(135deg, var(--brand-dark), var(--brand))' }}>
                <Mail className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-2xl font-extrabold text-[#1c1410]">Forgot password?</h1>
              <p className="text-[14px] text-[#7a6b5c] mt-1">Enter your email and we'll send you a reset link</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-[#1c1410] mb-1.5 block">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-[14px] outline-none focus:border-primary"
                  required
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl text-white font-bold text-[15px] transition-all hover:-translate-y-0.5 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)', boxShadow: '0 4px 14px rgba(234,88,12,0.3)' }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <div className="text-center">
              <Link to="/login" className="inline-flex items-center gap-1.5 text-[14px] text-[#7a6b5c] hover:text-primary">
                <ArrowLeft className="w-4 h-4" /> Back to login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
