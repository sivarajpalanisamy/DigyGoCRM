import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--app-bg)]">
      <div className="text-center px-5">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
          <span className="font-headline text-3xl font-extrabold text-primary">404</span>
        </div>
        <h1 className="font-headline text-[28px] font-extrabold text-[#1c1410] mb-2">Page not found</h1>
        <p className="text-[15px] text-[#7a6b5c] mb-8 max-w-[280px] mx-auto">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-6 py-3 rounded-xl text-white text-sm font-semibold active:scale-[0.97] transition-all shadow-lg shadow-primary/20"
          style={{ background: 'linear-gradient(135deg, var(--brand-dark) 0%, var(--brand) 55%, var(--brand-light) 100%)' }}
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  );
};

export default NotFound;
