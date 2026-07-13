import { useNavigate } from 'react-router-dom';
import { Eye, ArrowLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useCompanyStore } from '@/store/companyStore';

export default function ImpersonationBanner() {
  const { isImpersonating, currentUser, exitImpersonation } = useAuthStore();
  const companyName = useCompanyStore((s) => s.companyName);
  const navigate = useNavigate();

  if (!isImpersonating) return null;

  const handleExit = () => {
    // exitImpersonation() restores the CEO token from in-memory storage (never localStorage)
    // and clears the tenant session completely before navigating away
    exitImpersonation();
    navigate('/admin');
  };

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] h-10 flex items-center justify-between px-4 md:px-6 shrink-0"
      style={{ background: 'linear-gradient(90deg, #7c2d12 0%, var(--brand-dark) 50%, var(--brand) 100%)', boxShadow: '0 2px 12px rgba(194,65,12,0.4)' }}
    >
      {/* Left - what you're viewing */}
      <div className="flex items-center gap-2 text-white min-w-0">
        <Eye className="w-3.5 h-3.5 text-orange-200 shrink-0" />
        <span className="text-[14px] font-semibold text-orange-100 shrink-0 hidden sm:inline">Viewing as</span>
        <span className="text-[15px] font-bold text-white truncate">
          {companyName}
        </span>
        {currentUser?.email && (
          <span className="text-[12px] text-orange-200 truncate hidden md:inline">
            · {currentUser.name} ({currentUser.email})
          </span>
        )}
        <span className="hidden lg:inline text-[11px] text-orange-300 bg-orange-900/40 px-2 py-0.5 rounded-full shrink-0 border border-orange-700/50">
          IMPERSONATION SESSION
        </span>
      </div>

      {/* Right - exit button */}
      <button
        onClick={handleExit}
        className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[14px] font-bold text-white border border-orange-400/50 hover:bg-orange-900/50 transition-colors shrink-0 ml-3"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Back to Super Admin</span>
        <span className="sm:hidden">Exit</span>
      </button>
    </div>
  );
}
