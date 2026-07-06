import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { useLiveRefresh } from '@/hooks/useLiveRefresh';
import {
  Plus, Pencil, Trash2, Copy, Layout, X, Check, Globe, Eye,
  Users, Paintbrush,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { cn, copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

interface LandingPage {
  id: string;
  title: string;
  slug: string;
  template: string;
  views: number;
  leads: number;
  status: 'published' | 'draft';
  createdAt: string;
}

const TEMPLATES = ['Product Launch', 'Lead Capture', 'Webinar Registration', 'Free Trial', 'Contact Us'];

function mapPage(r: any): LandingPage {
  return {
    id: r.id,
    title: r.title,
    slug: r.slug,
    template: r.template ?? 'Lead Capture',
    views: r.views ?? 0,
    leads: r.leads ?? 0,
    status: r.status as 'published' | 'draft',
    createdAt: r.created_at ? r.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

function PageModal({ initial, onClose, onSave }: {
  initial?: LandingPage | null;
  onClose: () => void;
  onSave: (data: Pick<LandingPage, 'title' | 'slug' | 'template' | 'status'>) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [template, setTemplate] = useState(initial?.template ?? TEMPLATES[0]);
  const [status, setStatus] = useState<LandingPage['status']>(initial?.status ?? 'draft');

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleSave = () => {
    if (!title.trim()) { toast.error('Page title is required'); return; }
    onSave({ title: title.trim(), slug, template, status });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl border border-black/5 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h3 className="font-headline font-bold text-[#1c1410]">{initial ? 'Edit Page' : 'New Landing Page'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] mb-2">Page Title *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Free Demo Booking" />
            {title && (
              <p className="text-[11px] text-[#7a6b5c] mt-1.5 flex items-center gap-1">
                <Globe className="w-3 h-3" />
                <span className="font-mono">{window.location.host}/p/{slug}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-[0.08em] text-[#5c5245] mb-2">Start from template</label>
            <div className="space-y-2">
              {TEMPLATES.map((t) => (
                <button key={t} onClick={() => setTemplate(t)}
                  className={cn('w-full flex items-center gap-3 p-3 rounded-xl border text-sm font-medium transition-all text-left',
                    template === t ? 'border-primary/30 bg-primary/5 text-primary' : 'border-black/5 text-[#7a6b5c] hover:border-primary/20 hover:bg-[var(--accent-tint)] hover:text-primary')}>
                  <Layout className="w-4 h-4 shrink-0" />
                  {t}
                  {template === t && <Check className="w-4 h-4 ml-auto" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between py-3 border-t border-black/5">
            <div>
              <p className="text-[14px] font-semibold text-[#1c1410]">Publish Immediately</p>
              <p className="text-[11px] text-[#7a6b5c] mt-0.5">Make page live after saving</p>
            </div>
            <Switch checked={status === 'published'} onCheckedChange={(v) => setStatus(v ? 'published' : 'draft')} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-black/5">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>
            <Check className="w-4 h-4" /> {initial ? 'Save' : 'Create Page'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function LandingPagesPage() {
  const navigate = useNavigate();
  const [pages, setPages] = useState<LandingPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editPage, setEditPage] = useState<LandingPage | null>(null);

  const [liveTick, setLiveTick] = useState(0);
  // Live-refresh landing pages on any tenant data change (no manual reload).
  useLiveRefresh(() => setLiveTick((n) => n + 1));
  useEffect(() => {
    api.get<any[]>('/api/landing-pages')
      .then((rows) => setPages((rows ?? []).map(mapPage)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [liveTick]);

  const totalViews = pages.reduce((s, p) => s + p.views, 0);
  const totalLeads = pages.reduce((s, p) => s + p.leads, 0);
  const published = pages.filter((p) => p.status === 'published').length;

  const handleCreate = async (data: Pick<LandingPage, 'title' | 'slug' | 'template' | 'status'>) => {
    try {
      const created = await api.post<any>('/api/landing-pages', data);
      setPages((prev) => [mapPage(created), ...prev]);
      setShowModal(false);
      toast.success(`"${data.title}" created - open builder to design it`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create page');
    }
  };

  const handleEdit = async (data: Pick<LandingPage, 'title' | 'slug' | 'template' | 'status'>) => {
    if (!editPage) return;
    try {
      await api.patch(`/api/landing-pages/${editPage.id}`, data);
      setPages((prev) => prev.map((p) => p.id === editPage.id ? { ...p, ...data } : p));
      setEditPage(null);
      toast.success('Page updated');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update page');
    }
  };

  const toggleStatus = async (id: string) => {
    const page = pages.find((p) => p.id === id)!;
    const newStatus = page.status === 'published' ? 'draft' : 'published';
    try {
      await api.patch(`/api/landing-pages/${id}`, { status: newStatus });
      setPages((prev) => prev.map((p) => p.id === id ? { ...p, status: newStatus } : p));
      toast.success(`"${page.title}" ${newStatus === 'published' ? 'published' : 'unpublished'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to update status');
    }
  };

  const deletePage = async (id: string) => {
    const page = pages.find((p) => p.id === id);
    try {
      await api.delete(`/api/landing-pages/${id}`);
      setPages((prev) => prev.filter((p) => p.id !== id));
      toast.success(`"${page?.title}" deleted`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete page');
    }
  };

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="font-headline font-bold text-[#1c1410] text-[16px]">Landing Pages</h2>
          <p className="text-[13px] text-[#7a6b5c] mt-0.5">
            {published} live · {pages.length} total · {totalViews.toLocaleString()} views · {totalLeads} leads
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={() => navigate('/lead-generation/landing-pages/builder')} title="Create new page in builder">
            <Paintbrush className="w-3.5 h-3.5" /> Open Builder
          </Button>
          <Button size="sm" onClick={() => setShowModal(true)}>
            <Plus className="w-3.5 h-3.5" /> New Page
          </Button>
        </div>
      </div>

      {/* Page cards */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : pages.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 card-shadow px-8 py-16 text-center">
          <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Layout className="w-7 h-7 text-primary" />
          </div>
          <h3 className="font-headline font-bold text-[#1c1410] text-[15px] mb-1">No pages yet</h3>
          <p className="text-[14px] text-[#7a6b5c] mb-5 max-w-xs mx-auto">
            Create your first landing page and start capturing leads from any campaign.
          </p>
          <Button onClick={() => setShowModal(true)}><Plus className="w-4 h-4" /> Create your first page</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {pages.map((page) => {
            const conv = page.views > 0 ? ((page.leads / page.views) * 100).toFixed(1) : '0';
            return (
              <div key={page.id} className="bg-white rounded-2xl border border-black/5 card-shadow overflow-hidden group hover:-translate-y-0.5 transition-all duration-200">
                {/* Preview banner with gradient */}
                <div
                  className="h-20 flex items-center justify-center cursor-pointer relative"
                  style={{ background: 'linear-gradient(135deg, rgba(194,65,12,0.10) 0%, rgba(249,115,22,0.15) 100%)' }}
                  onClick={() => navigate(`/lead-generation/landing-pages/builder?id=${page.id}`)}
                >
                  <Layout className="w-9 h-9 text-primary/25" />
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-primary/5">
                    <div className="flex items-center gap-1.5 text-primary text-[13px] font-semibold bg-white px-3 py-1.5 rounded-xl shadow-sm border border-primary/20">
                      <Paintbrush className="w-3.5 h-3.5" /> Open Builder
                    </div>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Title + badge */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-headline font-bold text-[#1c1410] text-[15px] truncate">{page.title}</h3>
                      <p className="text-[10px] text-[#7a6b5c] font-mono truncate mt-0.5">/{page.slug}</p>
                    </div>
                    <Badge className={cn('border-0 text-[10px] font-semibold shrink-0',
                      page.status === 'published' ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--accent-tint)] text-[#7a6b5c]')}>
                      {page.status === 'published' ? 'Live' : 'Draft'}
                    </Badge>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Views', value: page.views.toLocaleString(), icon: Eye },
                      { label: 'Leads', value: page.leads, icon: Users },
                      { label: 'Conv.', value: `${conv}%`, icon: null },
                    ].map(({ label, value, icon: Icon }) => (
                      <div key={label} className="bg-[var(--app-bg)] rounded-xl p-2.5 text-center">
                        <p className="font-headline text-[16px] font-bold text-[#1c1410] leading-none">{value}</p>
                        <p className="text-[10px] text-[#7a6b5c] mt-0.5">{label}</p>
                      </div>
                    ))}
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Switch checked={page.status === 'published'} onCheckedChange={() => toggleStatus(page.id)} />
                      <span className="text-[11px] text-[#7a6b5c]">Live</span>
                    </div>
                    <div className="flex gap-0.5">
                      <button onClick={() => navigate(`/lead-generation/landing-pages/builder?id=${page.id}`)}
                        className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors" title="Edit in builder">
                        <Paintbrush className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => { copyToClipboard(`${window.location.origin}/p/${page.slug}`); toast.success('URL copied'); }}
                        className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors" title="Copy URL">
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => setEditPage(page)}
                        className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors" title="Edit details">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deletePage(page.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[#7a6b5c] hover:text-red-500 transition-colors" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {/* New page card */}
          <button onClick={() => setShowModal(true)}
            className="group bg-white rounded-2xl border-2 border-dashed border-black/10 p-6 flex flex-col items-center justify-center gap-2 text-center hover:border-primary hover:bg-primary/5 transition-all duration-200 min-h-[200px]">
            <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center group-hover:bg-primary/20 transition-colors">
              <Plus className="w-5 h-5 text-primary" />
            </div>
            <span className="text-[14px] font-semibold text-[#7a6b5c] group-hover:text-primary transition-colors">New Page</span>
          </button>
        </div>
      )}

      {showModal && <PageModal onClose={() => setShowModal(false)} onSave={handleCreate} />}
      {editPage && <PageModal initial={editPage} onClose={() => setEditPage(null)} onSave={handleEdit} />}
    </div>
  );
}
