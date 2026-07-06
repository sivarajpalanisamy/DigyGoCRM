import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { alertDialog } from '@/lib/confirm';

// ── Types (must mirror builder) ──────────────────────────────────────────────

interface Block { id: string; type: string; props: Record<string, any> }
interface Theme { name: string; primary: string; primaryText: string; bg: string; text: string; muted: string; accent: string }

const THEMES: Record<string, Theme> = {
  brand:  { name: 'Brand',   primary: '#ea580c', primaryText: '#fff', bg: '#ffffff', text: '#1c1410', muted: '#7a6b5c', accent: '#fff7f0' },
  ocean:  { name: 'Ocean',   primary: '#2563eb', primaryText: '#fff', bg: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#eff6ff' },
  forest: { name: 'Forest',  primary: '#16a34a', primaryText: '#fff', bg: '#ffffff', text: '#14532d', muted: '#6b7280', accent: '#f0fdf4' },
  royal:  { name: 'Royal',   primary: '#7c3aed', primaryText: '#fff', bg: '#ffffff', text: '#1e1b4b', muted: '#6b7280', accent: '#f5f3ff' },
  dark:   { name: 'Dark',    primary: '#f97316', primaryText: '#fff', bg: '#111111', text: '#f5f5f5', muted: '#a3a3a3', accent: '#1e1e1e' },
};

// ── Block renderer ───────────────────────────────────────────────────────────

function BlockContent({ block, theme, slug }: { block: Block; theme: Theme; slug: string }) {
  const p = block.props;
  const alignFlex = p.align === 'left' ? 'items-start text-left' : p.align === 'right' ? 'items-end text-right' : 'items-center text-center';

  switch (block.type) {
    case 'hero':
      return (
        <div className="px-6 sm:px-10 py-16 flex flex-col gap-5 items-center text-center" style={{
          background: p.bgStyle === 'gradient'
            ? `linear-gradient(135deg, ${theme.primary}20 0%, ${theme.accent} 100%)`
            : p.bgStyle === 'solid' ? theme.accent : theme.bg,
        }}>
          <h1 className="text-[28px] sm:text-[34px] font-extrabold leading-tight max-w-xl" style={{ color: theme.text }}>{p.headline}</h1>
          <p className="text-[15px] sm:text-[16px] max-w-lg leading-relaxed" style={{ color: theme.muted }}>{p.subtext}</p>
          {p.btnText && (
            <a href={p.btnUrl || '#'} className="mt-2 px-8 py-3.5 rounded-xl text-[15px] font-bold shadow-lg inline-block no-underline"
              style={{ background: theme.primary, color: theme.primaryText }}>{p.btnText}</a>
          )}
        </div>
      );

    case 'heading': {
      const sizes: Record<string, string> = { h1: 'text-[28px] sm:text-[30px]', h2: 'text-[22px] sm:text-[24px]', h3: 'text-[16px] sm:text-[18px]' };
      const Tag = (p.level ?? 'h2') as 'h1' | 'h2' | 'h3';
      return (
        <div className={`px-6 sm:px-10 py-5 flex flex-col ${alignFlex}`}>
          <Tag className={`${sizes[p.level] ?? 'text-[24px]'} font-bold leading-tight`} style={{ color: theme.text }}>{p.text}</Tag>
        </div>
      );
    }

    case 'paragraph':
      return (
        <div className={`px-6 sm:px-10 py-4 flex flex-col ${alignFlex}`}>
          <p className={`leading-relaxed max-w-2xl ${p.size === 'sm' ? 'text-[14px]' : p.size === 'lg' ? 'text-[18px]' : 'text-[15px]'}`}
            style={{ color: theme.muted }}>{p.text}</p>
        </div>
      );

    case 'button':
      return (
        <div className={`px-6 sm:px-10 py-5 flex ${alignFlex}`}>
          <a href={p.url || '#'} className="px-7 py-3 rounded-xl text-[15px] font-bold transition-all inline-block no-underline" style={
            p.style === 'primary' ? { background: theme.primary, color: theme.primaryText } :
            p.style === 'outline' ? { border: `2px solid ${theme.primary}`, color: theme.primary, background: 'transparent' } :
            { color: theme.primary, background: 'transparent', textDecoration: 'underline' }
          }>{p.text}</a>
        </div>
      );

    case 'image':
      return (
        <div className="px-6 sm:px-10 py-5">
          <img src={p.url} alt={p.alt} className={`w-full object-cover max-h-96 ${p.rounded ? 'rounded-2xl' : ''}`} />
          {p.caption && <p className="text-center text-[13px] mt-2" style={{ color: theme.muted }}>{p.caption}</p>}
        </div>
      );

    case 'divider':
      return (
        <div className="px-6 sm:px-10 py-3">
          <hr style={{ borderStyle: p.style, borderWidth: p.thickness, borderColor: theme.muted + '40' }} />
        </div>
      );

    case 'spacer':
      return <div style={{ height: p.height }} />;

    case 'features':
      return (
        <div className="px-6 sm:px-10 py-12">
          {p.title && <h2 className="text-[22px] font-bold text-center mb-8" style={{ color: theme.text }}>{p.title}</h2>}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {(p.items ?? []).map((item: any, i: number) => (
              <div key={i} className="flex flex-col gap-2 p-5 rounded-2xl" style={{ background: theme.accent }}>
                <span className="text-2xl">{item.icon}</span>
                <h4 className="font-bold text-[15px]" style={{ color: theme.text }}>{item.title}</h4>
                <p className="text-[13px] leading-relaxed" style={{ color: theme.muted }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'cta':
      return (
        <div className="px-6 sm:px-10 py-14 flex flex-col gap-4 items-center text-center" style={{ background: theme.primary }}>
          <h2 className="text-[24px] sm:text-[26px] font-extrabold" style={{ color: theme.primaryText }}>{p.headline}</h2>
          <p className="text-[15px] max-w-md opacity-90" style={{ color: theme.primaryText }}>{p.subtext}</p>
          {p.btnText && (
            <button className="mt-2 px-8 py-3.5 rounded-xl text-[15px] font-bold shadow-lg"
              style={{ background: theme.primaryText, color: theme.primary }}>{p.btnText}</button>
          )}
        </div>
      );

    case 'testimonial':
      return (
        <div className="px-6 sm:px-10 py-12 flex flex-col items-center text-center gap-5" style={{ background: theme.accent }}>
          <span className="text-4xl" style={{ color: theme.primary }}>&ldquo;</span>
          <p className="text-[16px] sm:text-[17px] font-medium max-w-xl leading-relaxed italic" style={{ color: theme.text }}>{p.quote}</p>
          <div>
            <p className="font-bold text-[15px]" style={{ color: theme.text }}>{p.name}</p>
            <p className="text-[13px] mt-0.5" style={{ color: theme.muted }}>{p.role}, {p.company}</p>
          </div>
        </div>
      );

    case 'stats':
      return (
        <div className="px-6 sm:px-10 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {(p.items ?? []).map((item: any, i: number) => (
              <div key={i} className="flex flex-col items-center gap-1 p-5 rounded-2xl" style={{ background: theme.accent }}>
                <span className="text-[28px] font-extrabold" style={{ color: theme.primary }}>{item.value}</span>
                <span className="text-[13px]" style={{ color: theme.muted }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'form':
      return <LeadForm block={block} theme={theme} slug={slug} />;

    default: return null;
  }
}

// ── Lead form (functional) ───────────────────────────────────────────────────

function LeadForm({ block, theme, slug }: { block: Block; theme: Theme; slug: string }) {
  const p = block.props;
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/page/${slug}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData['Name'] || '',
          email: formData['Email'] || '',
          phone: formData['Phone'] || '',
          message: formData['Message'] || '',
          company: formData['Company'] || '',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Submission failed');
      }
      setSubmitted(true);
    } catch (err: any) {
      await alertDialog({ title: 'Submission failed', message: err.message || 'Failed to submit. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="px-6 sm:px-10 py-10" style={{ background: theme.accent }}>
        <div className="max-w-sm mx-auto text-center py-8">
          <div className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl" style={{ background: theme.primary + '20' }}>
            ✓
          </div>
          <h3 className="text-[18px] font-bold mb-2" style={{ color: theme.text }}>Thank you!</h3>
          <p className="text-[15px]" style={{ color: theme.muted }}>We&apos;ll get back to you soon.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 sm:px-10 py-10" style={{ background: theme.accent }}>
      {p.title && <h3 className="text-[18px] font-bold mb-6 text-center" style={{ color: theme.text }}>{p.title}</h3>}
      <form onSubmit={handleSubmit} className="max-w-sm mx-auto flex flex-col gap-3">
        {(p.fields ?? []).map((field: string) => (
          field === 'Message' ? (
            <textarea key={field} placeholder={field} required rows={3}
              value={formData[field] || ''}
              onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border text-[14px] outline-none resize-none"
              style={{ borderColor: theme.muted + '40', color: theme.text, background: theme.bg }} />
          ) : (
            <input key={field} placeholder={field} required
              type={field === 'Email' ? 'email' : field === 'Phone' ? 'tel' : 'text'}
              value={formData[field] || ''}
              onChange={(e) => setFormData({ ...formData, [field]: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border text-[14px] outline-none"
              style={{ borderColor: theme.muted + '40', color: theme.text, background: theme.bg }} />
          )
        ))}
        <button type="submit" disabled={submitting}
          className="w-full py-3 rounded-xl text-[15px] font-bold mt-1 shadow-sm disabled:opacity-60"
          style={{ background: theme.primary, color: theme.primaryText }}>
          {submitting ? 'Sending...' : p.btnText}
        </button>
      </form>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PublicLandingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<any>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!slug) { setError(true); setLoading(false); return; }
    fetch(`/api/public/page/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(setPage)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !page) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-[24px] font-bold text-gray-800 mb-2">Page Not Found</h1>
          <p className="text-[15px] text-gray-500">This page doesn&apos;t exist or is no longer published.</p>
        </div>
      </div>
    );
  }

  const content = typeof page.content === 'string' ? JSON.parse(page.content) : (page.content ?? {});
  const blocks: Block[] = content.blocks ?? [];
  const themeKey = content.themeKey ?? 'brand';
  const theme = THEMES[themeKey] ?? THEMES.brand;

  return (
    <div className="min-h-screen" style={{ background: theme.bg }}>
      {blocks.map((block) => (
        <BlockContent key={block.id} block={block} theme={theme} slug={slug!} />
      ))}
      {blocks.length === 0 && (
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-[15px]" style={{ color: theme.muted }}>This page has no content yet.</p>
        </div>
      )}
    </div>
  );
}
