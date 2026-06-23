import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
  DragOverlay, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft, Monitor, Tablet, Smartphone, Check, Zap, GripVertical, Trash2,
  Plus, ChevronDown, ChevronUp, AlignLeft, MousePointerClick, LayoutGrid,
  Quote, BarChart2, ClipboardList, Minus, ChevronsUpDown, Layout, Megaphone,
  Heading1, Settings2, Palette, Image as ImageIcon, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ── Types ─────────────────────────────────────────────────────────────────────

type BlockType =
  | 'hero' | 'heading' | 'paragraph' | 'button' | 'image'
  | 'divider' | 'spacer' | 'features' | 'cta' | 'testimonial' | 'stats' | 'form';

interface Block { id: string; type: BlockType; props: Record<string, any> }
interface Theme { name: string; primary: string; primaryText: string; bg: string; text: string; muted: string; accent: string }

// ── Themes ────────────────────────────────────────────────────────────────────

const THEMES: Record<string, Theme> = {
  brand:  { name: 'Brand',   primary: '#ea580c', primaryText: '#fff', bg: '#ffffff', text: '#1c1410', muted: '#7a6b5c', accent: '#fff7f0' },
  ocean:  { name: 'Ocean',   primary: '#2563eb', primaryText: '#fff', bg: '#ffffff', text: '#0f172a', muted: '#64748b', accent: '#eff6ff' },
  forest: { name: 'Forest',  primary: '#16a34a', primaryText: '#fff', bg: '#ffffff', text: '#14532d', muted: '#6b7280', accent: '#f0fdf4' },
  royal:  { name: 'Royal',   primary: '#7c3aed', primaryText: '#fff', bg: '#ffffff', text: '#1e1b4b', muted: '#6b7280', accent: '#f5f3ff' },
  dark:   { name: 'Dark',    primary: '#f97316', primaryText: '#fff', bg: '#111111', text: '#f5f5f5', muted: '#a3a3a3', accent: '#1e1e1e' },
};
const SWATCHES = { brand: '#ea580c', ocean: '#2563eb', forest: '#16a34a', royal: '#7c3aed', dark: '#111111' };

// ── Default props ─────────────────────────────────────────────────────────────

function defaultProps(type: BlockType): Record<string, any> {
  switch (type) {
    case 'hero':        return { headline: 'Grow Your Business Faster', subtext: 'The all-in-one platform that helps you capture leads, automate follow-ups, and close more deals.', btnText: 'Get Started Free', btnUrl: '#', bgStyle: 'gradient', align: 'center' };
    case 'heading':     return { text: 'Why Choose Us', level: 'h2', align: 'center' };
    case 'paragraph':   return { text: 'We help thousands of businesses streamline their lead management process and grow revenue faster than ever before.', align: 'center', size: 'md' };
    case 'button':      return { text: 'Start Free Trial', style: 'primary', align: 'center', url: '#' };
    case 'image':       return { url: 'https://images.unsplash.com/photo-1551434678-e076c223a692?w=1200&q=80', alt: 'Team working', caption: '', rounded: true };
    case 'divider':     return { style: 'solid', thickness: 1 };
    case 'spacer':      return { height: 48 };
    case 'features':    return { title: 'Everything you need', items: [{ icon: '⚡', title: 'Lightning Fast', desc: 'Set up in minutes, not months. No technical skills required.' }, { icon: '🎯', title: 'Laser Focused', desc: 'Capture the right leads at the right time with smart targeting.' }, { icon: '📈', title: 'Scale Effortlessly', desc: 'Grow from 10 to 10,000 leads without changing your workflow.' }] };
    case 'cta':         return { headline: 'Ready to get started?', subtext: 'Join over 10,000 businesses already using DigyGo CRM.', btnText: 'Start Free Today' };
    case 'testimonial': return { quote: 'DigyGo CRM transformed our lead generation. We saw a 3x increase in conversions within the first month!', name: 'Priya Sharma', role: 'CEO', company: 'TechWave Solutions' };
    case 'stats':       return { items: [{ value: '10,000+', label: 'Happy Customers' }, { value: '3x', label: 'More Leads' }, { value: '98%', label: 'Satisfaction' }, { value: '24/7', label: 'Support' }] };
    case 'form':        return { title: 'Get in Touch', fields: ['Name', 'Email', 'Phone'], btnText: 'Send Message' };
  }
}

// ── Block library ─────────────────────────────────────────────────────────────

const BLOCK_LIBRARY = [
  { category: 'Layout', items: [
    { type: 'hero' as BlockType, label: 'Hero Section', icon: Layout, desc: 'Full-width with CTA' },
    { type: 'cta' as BlockType, label: 'CTA Banner', icon: Megaphone, desc: 'Bold action strip' },
    { type: 'divider' as BlockType, label: 'Divider', icon: Minus, desc: 'Horizontal line' },
    { type: 'spacer' as BlockType, label: 'Spacer', icon: ChevronsUpDown, desc: 'Vertical gap' },
  ]},
  { category: 'Content', items: [
    { type: 'heading' as BlockType, label: 'Heading', icon: Heading1, desc: 'H1, H2 or H3' },
    { type: 'paragraph' as BlockType, label: 'Text Block', icon: AlignLeft, desc: 'Body paragraph' },
    { type: 'image' as BlockType, label: 'Image', icon: ImageIcon, desc: 'Photo + caption' },
    { type: 'button' as BlockType, label: 'Button', icon: MousePointerClick, desc: 'CTA button' },
  ]},
  { category: 'Sections', items: [
    { type: 'features' as BlockType, label: 'Features', icon: LayoutGrid, desc: '3-column cards' },
    { type: 'testimonial' as BlockType, label: 'Testimonial', icon: Quote, desc: 'Customer quote' },
    { type: 'stats' as BlockType, label: 'Stats', icon: BarChart2, desc: 'Key metrics' },
    { type: 'form' as BlockType, label: 'Lead Form', icon: ClipboardList, desc: 'Capture info' },
  ]},
];

// ── Block renderer ────────────────────────────────────────────────────────────

function BlockContent({ block, theme }: { block: Block; theme: Theme }) {
  const p = block.props;
  const alignFlex = p.align === 'left' ? 'items-start text-left' : p.align === 'right' ? 'items-end text-right' : 'items-center text-center';

  switch (block.type) {
    case 'hero':
      return (
        <div className="px-10 py-16 flex flex-col gap-5 items-center text-center" style={{
          background: p.bgStyle === 'gradient'
            ? `linear-gradient(135deg, ${theme.primary}20 0%, ${theme.accent} 100%)`
            : p.bgStyle === 'solid' ? theme.accent : theme.bg,
        }}>
          <h1 className="text-[34px] font-extrabold leading-tight max-w-xl" style={{ color: theme.text }}>{p.headline}</h1>
          <p className="text-[16px] max-w-lg leading-relaxed" style={{ color: theme.muted }}>{p.subtext}</p>
          <button className="mt-2 px-8 py-3.5 rounded-xl text-[14px] font-bold shadow-lg"
            style={{ background: theme.primary, color: theme.primaryText }}>{p.btnText}</button>
        </div>
      );

    case 'heading': {
      const sizes: Record<string, string> = { h1: 'text-[30px]', h2: 'text-[24px]', h3: 'text-[18px]' };
      const Tag = (p.level ?? 'h2') as 'h1' | 'h2' | 'h3';
      return (
        <div className={`px-10 py-5 flex flex-col ${alignFlex}`}>
          <Tag className={`${sizes[p.level] ?? 'text-[24px]'} font-bold leading-tight`} style={{ color: theme.text }}>{p.text}</Tag>
        </div>
      );
    }

    case 'paragraph':
      return (
        <div className={`px-10 py-4 flex flex-col ${alignFlex}`}>
          <p className={`leading-relaxed max-w-2xl ${p.size === 'sm' ? 'text-[13px]' : p.size === 'lg' ? 'text-[18px]' : 'text-[15px]'}`}
            style={{ color: theme.muted }}>{p.text}</p>
        </div>
      );

    case 'button':
      return (
        <div className={`px-10 py-5 flex ${alignFlex}`}>
          <button className="px-7 py-3 rounded-xl text-[14px] font-bold transition-all" style={
            p.style === 'primary' ? { background: theme.primary, color: theme.primaryText } :
            p.style === 'outline' ? { border: `2px solid ${theme.primary}`, color: theme.primary, background: 'transparent' } :
            { color: theme.primary, background: 'transparent', textDecoration: 'underline' }
          }>{p.text}</button>
        </div>
      );

    case 'image':
      return (
        <div className="px-10 py-5">
          <img src={p.url} alt={p.alt} className={`w-full object-cover max-h-72 ${p.rounded ? 'rounded-2xl' : ''}`} />
          {p.caption && <p className="text-center text-[12px] mt-2" style={{ color: theme.muted }}>{p.caption}</p>}
        </div>
      );

    case 'divider':
      return (
        <div className="px-10 py-3">
          <hr style={{ borderStyle: p.style, borderWidth: p.thickness, borderColor: theme.muted + '40' }} />
        </div>
      );

    case 'spacer':
      return <div style={{ height: p.height }} />;

    case 'features':
      return (
        <div className="px-10 py-12">
          {p.title && <h2 className="text-[22px] font-bold text-center mb-8" style={{ color: theme.text }}>{p.title}</h2>}
          <div className="grid grid-cols-3 gap-5">
            {p.items.map((item: any, i: number) => (
              <div key={i} className="flex flex-col gap-2 p-5 rounded-2xl" style={{ background: theme.accent }}>
                <span className="text-2xl">{item.icon}</span>
                <h4 className="font-bold text-[14px]" style={{ color: theme.text }}>{item.title}</h4>
                <p className="text-[12px] leading-relaxed" style={{ color: theme.muted }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      );

    case 'cta':
      return (
        <div className="px-10 py-14 flex flex-col gap-4 items-center text-center" style={{ background: theme.primary }}>
          <h2 className="text-[26px] font-extrabold" style={{ color: theme.primaryText }}>{p.headline}</h2>
          <p className="text-[14px] max-w-md opacity-90" style={{ color: theme.primaryText }}>{p.subtext}</p>
          <button className="mt-2 px-8 py-3.5 rounded-xl text-[14px] font-bold shadow-lg"
            style={{ background: theme.primaryText, color: theme.primary }}>{p.btnText}</button>
        </div>
      );

    case 'testimonial':
      return (
        <div className="px-10 py-12 flex flex-col items-center text-center gap-5" style={{ background: theme.accent }}>
          <span className="text-4xl" style={{ color: theme.primary }}>"</span>
          <p className="text-[17px] font-medium max-w-xl leading-relaxed italic" style={{ color: theme.text }}>{p.quote}</p>
          <div>
            <p className="font-bold text-[14px]" style={{ color: theme.text }}>{p.name}</p>
            <p className="text-[12px] mt-0.5" style={{ color: theme.muted }}>{p.role}, {p.company}</p>
          </div>
        </div>
      );

    case 'stats':
      return (
        <div className="px-10 py-10">
          <div className="grid grid-cols-4 gap-4">
            {p.items.map((item: any, i: number) => (
              <div key={i} className="flex flex-col items-center gap-1 p-5 rounded-2xl" style={{ background: theme.accent }}>
                <span className="text-[28px] font-extrabold" style={{ color: theme.primary }}>{item.value}</span>
                <span className="text-[12px]" style={{ color: theme.muted }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      );

    case 'form':
      return (
        <div className="px-10 py-10" style={{ background: theme.accent }}>
          {p.title && <h3 className="text-[18px] font-bold mb-6 text-center" style={{ color: theme.text }}>{p.title}</h3>}
          <div className="max-w-sm mx-auto flex flex-col gap-3">
            {p.fields.map((field: string) => (
              <input key={field} placeholder={field} readOnly
                className="w-full px-4 py-2.5 rounded-xl border text-[13px] outline-none"
                style={{ borderColor: theme.muted + '40', color: theme.text, background: theme.bg }} />
            ))}
            <button className="w-full py-3 rounded-xl text-[14px] font-bold mt-1 shadow-sm"
              style={{ background: theme.primary, color: theme.primaryText }}>{p.btnText}</button>
          </div>
        </div>
      );

    default: return null;
  }
}

// ── Sortable block wrapper ─────────────────────────────────────────────────────

function SortableBlock({
  block, theme, selected, onSelect, onDelete, onMoveUp, onMoveDown, isFirst, isLast,
}: {
  block: Block; theme: Theme; selected: boolean;
  onSelect: () => void; onDelete: () => void;
  onMoveUp: () => void; onMoveDown: () => void;
  isFirst: boolean; isLast: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative flex group', isDragging && 'opacity-0')}
    >
      {/* Left gutter — drag handle + actions, no layout shift */}
      <div className="w-9 shrink-0 flex flex-col items-center py-3 gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="p-1.5 rounded-lg hover:bg-black/8 cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder"
        >
          <GripVertical className="w-4 h-4 text-[#b09e8d]" />
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          disabled={isFirst}
          className="p-1 rounded-lg hover:bg-black/8 disabled:opacity-20 transition-colors"
          title="Move up"
        >
          <ChevronUp className="w-3.5 h-3.5 text-[#b09e8d]" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          disabled={isLast}
          className="p-1 rounded-lg hover:bg-black/8 disabled:opacity-20 transition-colors"
          title="Move down"
        >
          <ChevronDown className="w-3.5 h-3.5 text-[#b09e8d]" />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="p-1 rounded-lg hover:bg-red-50 transition-colors mt-1"
          title="Delete block"
        >
          <Trash2 className="w-3.5 h-3.5 text-[#b09e8d] hover:text-red-500" />
        </button>
      </div>

      {/* Block content — zero layout shift */}
      <div
        className={cn(
          'flex-1 min-w-0 cursor-pointer rounded-xl overflow-hidden transition-all duration-150',
          selected
            ? 'ring-2 ring-primary ring-offset-2 shadow-lg'
            : 'hover:ring-1 hover:ring-primary/40 hover:shadow-md'
        )}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        {/* Block type badge — top-left corner on select/hover */}
        {selected && (
          <div className="absolute left-9 top-0 z-10 px-2 py-0.5 bg-primary text-white text-[9px] font-bold uppercase tracking-wider rounded-b-lg">
            {block.type}
          </div>
        )}
        <BlockContent block={block} theme={theme} />
      </div>
    </div>
  );
}

// ── Properties panel ──────────────────────────────────────────────────────────

function PropsPanel({ block, onChange }: { block: Block; onChange: (props: Record<string, any>) => void }) {
  const p = block.props;
  const set = (k: string, v: any) => onChange({ ...p, [k]: v });

  const textInput = (label: string, key: string, multiline = false) => (
    <div key={key}>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-1">{label}</label>
      {multiline
        ? <textarea value={p[key] ?? ''} onChange={(e) => set(key, e.target.value)} rows={3}
            className="w-full px-3 py-2 rounded-xl border border-black/10 text-[12px] text-[#1c1410] bg-[var(--app-bg)] outline-none focus:border-primary/40 resize-none" />
        : <input type="text" value={p[key] ?? ''} onChange={(e) => set(key, e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-black/10 text-[12px] text-[#1c1410] bg-[var(--app-bg)] outline-none focus:border-primary/40" />
      }
    </div>
  );

  const seg = (label: string, key: string, opts: { value: string; label: string }[]) => (
    <div key={key}>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-1">{label}</label>
      <div className="flex gap-0.5 p-1 bg-[var(--accent-tint)] rounded-xl">
        {opts.map((o) => (
          <button key={o.value} onClick={() => set(key, o.value)}
            className={cn('flex-1 px-1.5 py-1 rounded-lg text-[11px] font-semibold transition-all',
              p[key] === o.value ? 'bg-white text-primary shadow-sm' : 'text-[#7a6b5c] hover:text-primary')}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  const toggle = (label: string, key: string) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-[12px] font-semibold text-[#1c1410]">{label}</span>
      <button onClick={() => set(key, !p[key])}
        className={cn('w-9 h-5 rounded-full transition-colors relative', p[key] ? 'bg-primary' : 'bg-black/10')}>
        <span className={cn('absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', p[key] ? 'translate-x-4' : 'translate-x-0.5')} />
      </button>
    </div>
  );

  const slider = (label: string, key: string, min: number, max: number) => (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-1">{label}: {p[key]}{key === 'height' ? 'px' : ''}</label>
      <input type="range" min={min} max={max} value={p[key] ?? min}
        onChange={(e) => set(key, Number(e.target.value))}
        className="w-full accent-primary" />
    </div>
  );

  switch (block.type) {
    case 'hero': return <div className="space-y-4 p-4">
      {textInput('Headline', 'headline')}
      {textInput('Subtext', 'subtext', true)}
      {textInput('Button Text', 'btnText')}
      {textInput('Button URL', 'btnUrl')}
      {seg('Background', 'bgStyle', [{ value: 'gradient', label: 'Gradient' }, { value: 'solid', label: 'Solid' }, { value: 'none', label: 'White' }])}
    </div>;

    case 'heading': return <div className="space-y-4 p-4">
      {textInput('Text', 'text')}
      {seg('Level', 'level', [{ value: 'h1', label: 'H1' }, { value: 'h2', label: 'H2' }, { value: 'h3', label: 'H3' }])}
      {seg('Align', 'align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }])}
    </div>;

    case 'paragraph': return <div className="space-y-4 p-4">
      {textInput('Text', 'text', true)}
      {seg('Size', 'size', [{ value: 'sm', label: 'Small' }, { value: 'md', label: 'Med' }, { value: 'lg', label: 'Large' }])}
      {seg('Align', 'align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }])}
    </div>;

    case 'button': return <div className="space-y-4 p-4">
      {textInput('Button Text', 'text')}
      {textInput('URL / Anchor', 'url')}
      {seg('Style', 'style', [{ value: 'primary', label: 'Filled' }, { value: 'outline', label: 'Outline' }, { value: 'ghost', label: 'Ghost' }])}
      {seg('Align', 'align', [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }])}
    </div>;

    case 'image': return <div className="space-y-4 p-4">
      {textInput('Image URL', 'url')}
      {textInput('Alt Text', 'alt')}
      {textInput('Caption (optional)', 'caption')}
      {toggle('Rounded Corners', 'rounded')}
    </div>;

    case 'divider': return <div className="space-y-4 p-4">
      {seg('Style', 'style', [{ value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' }, { value: 'dotted', label: 'Dotted' }])}
      {slider('Thickness', 'thickness', 1, 4)}
    </div>;

    case 'spacer': return <div className="space-y-4 p-4">
      {slider('Height', 'height', 8, 200)}
    </div>;

    case 'cta': return <div className="space-y-4 p-4">
      {textInput('Headline', 'headline')}
      {textInput('Subtext', 'subtext', true)}
      {textInput('Button Text', 'btnText')}
    </div>;

    case 'features': return <div className="space-y-4 p-4">
      {textInput('Section Title', 'title')}
      <div className="space-y-3">
        {(p.items as any[]).map((item, i) => (
          <div key={i} className="p-3 rounded-xl bg-[var(--app-bg)] border border-black/5 space-y-2">
            <div className="flex gap-2">
              <input type="text" value={item.icon} onChange={(e) => { const items = [...p.items]; items[i] = { ...item, icon: e.target.value }; set('items', items); }}
                className="w-10 px-2 py-1 rounded-lg border border-black/10 text-center text-[13px] bg-white outline-none" />
              <input type="text" value={item.title} onChange={(e) => { const items = [...p.items]; items[i] = { ...item, title: e.target.value }; set('items', items); }}
                placeholder="Title" className="flex-1 px-2 py-1 rounded-lg border border-black/10 text-[12px] bg-white outline-none" />
            </div>
            <textarea value={item.desc} rows={2} onChange={(e) => { const items = [...p.items]; items[i] = { ...item, desc: e.target.value }; set('items', items); }}
              placeholder="Description" className="w-full px-2 py-1 rounded-lg border border-black/10 text-[11px] bg-white outline-none resize-none" />
          </div>
        ))}
      </div>
    </div>;

    case 'testimonial': return <div className="space-y-4 p-4">
      {textInput('Quote', 'quote', true)}
      {textInput('Name', 'name')}
      {textInput('Role', 'role')}
      {textInput('Company', 'company')}
    </div>;

    case 'stats': return <div className="space-y-4 p-4">
      <div className="space-y-2">
        {(p.items as any[]).map((item, i) => (
          <div key={i} className="flex gap-2">
            <input type="text" value={item.value} placeholder="Value" onChange={(e) => { const items = [...p.items]; items[i] = { ...item, value: e.target.value }; set('items', items); }}
              className="w-20 px-2 py-1.5 rounded-lg border border-black/10 text-[12px] font-bold bg-[var(--app-bg)] outline-none" />
            <input type="text" value={item.label} placeholder="Label" onChange={(e) => { const items = [...p.items]; items[i] = { ...item, label: e.target.value }; set('items', items); }}
              className="flex-1 px-2 py-1.5 rounded-lg border border-black/10 text-[12px] bg-[var(--app-bg)] outline-none" />
          </div>
        ))}
      </div>
    </div>;

    case 'form': return <div className="space-y-4 p-4">
      {textInput('Form Title', 'title')}
      {textInput('Submit Button Text', 'btnText')}
      <div>
        <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c] mb-2">Fields</label>
        <div className="space-y-1.5">
          {['Name', 'Email', 'Phone', 'Message', 'Company'].map((field) => (
            <label key={field} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={p.fields.includes(field)} className="accent-primary"
                onChange={(e) => set('fields', e.target.checked ? [...p.fields, field] : p.fields.filter((f: string) => f !== field))} />
              <span className="text-[12px] text-[#1c1410]">{field}</span>
            </label>
          ))}
        </div>
      </div>
    </div>;

    default: return <div className="p-4 text-[12px] text-[#7a6b5c]">No editable properties.</div>;
  }
}

// ── Starter blocks ────────────────────────────────────────────────────────────

const STARTER: Block[] = [
  { id: 'b1', type: 'hero',        props: defaultProps('hero') },
  { id: 'b2', type: 'features',    props: defaultProps('features') },
  { id: 'b3', type: 'stats',       props: defaultProps('stats') },
  { id: 'b4', type: 'testimonial', props: defaultProps('testimonial') },
  { id: 'b5', type: 'cta',         props: defaultProps('cta') },
  { id: 'b6', type: 'form',        props: defaultProps('form') },
];

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LandingPageBuilderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const pageId = searchParams.get('id');
  const [blocks, setBlocks] = useState<Block[]>(STARTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [themeKey, setThemeKey] = useState('brand');
  const [device, setDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [pageName, setPageName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [showThemes, setShowThemes] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [loadingPage, setLoadingPage] = useState(!!pageId);

  // Load existing page data when editing
  useEffect(() => {
    if (!pageId) { setPageName('Untitled Page'); return; }
    api.get<any>(`/api/landing-pages/${pageId}`)
      .then((page) => {
        setPageName(page.title ?? 'Untitled Page');
        const content = typeof page.content === 'string' ? JSON.parse(page.content) : page.content;
        if (content?.blocks?.length) setBlocks(content.blocks);
        if (content?.themeKey && THEMES[content.themeKey]) setThemeKey(content.themeKey);
      })
      .catch(() => { toast.error('Failed to load page'); setPageName('Untitled Page'); })
      .finally(() => setLoadingPage(false));
  }, [pageId]);

  const theme = THEMES[themeKey];
  const selectedBlock = blocks.find((b) => b.id === selectedId) ?? null;
  const activeBlock = blocks.find((b) => b.id === activeId) ?? null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIdx = blocks.findIndex((b) => b.id === active.id);
      const newIdx = blocks.findIndex((b) => b.id === over.id);
      setBlocks(arrayMove(blocks, oldIdx, newIdx));
    }
  };

  const addBlock = (type: BlockType) => {
    const newBlock: Block = { id: `b-${Date.now()}`, type, props: defaultProps(type) };
    if (selectedId) {
      const idx = blocks.findIndex((b) => b.id === selectedId);
      const next = [...blocks];
      next.splice(idx + 1, 0, newBlock);
      setBlocks(next);
    } else {
      setBlocks([...blocks, newBlock]);
    }
    setSelectedId(newBlock.id);
    toast.success(`${type} block added`);
  };

  const deleteBlock = (id: string) => {
    setBlocks(blocks.filter((b) => b.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const moveBlock = (id: string, dir: 'up' | 'down') => {
    const idx = blocks.findIndex((b) => b.id === id);
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= blocks.length) return;
    setBlocks(arrayMove(blocks, idx, newIdx));
  };

  const updateProps = (id: string, props: Record<string, any>) =>
    setBlocks(blocks.map((b) => b.id === id ? { ...b, props } : b));

  const canvasWidth = device === 'mobile' ? 390 : device === 'tablet' ? 768 : undefined;

  if (loadingPage) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#e8ddd5]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[#e8ddd5] overflow-hidden">

      {/* Top bar */}
      <div className="h-12 bg-white border-b border-black/8 flex items-center px-4 gap-3 shrink-0 z-20 shadow-sm">
        <button onClick={() => navigate('/lead-generation/landing-pages')}
          className="flex items-center gap-1 text-[12px] text-[#7a6b5c] hover:text-primary transition-colors shrink-0">
          <ArrowLeft className="w-3.5 h-3.5" /> Pages
        </button>

        <div className="w-px h-5 bg-black/10" />

        {editingName
          ? <input autoFocus value={pageName} onChange={(e) => setPageName(e.target.value)}
              onBlur={() => setEditingName(false)} onKeyDown={(e) => e.key === 'Enter' && setEditingName(false)}
              className="text-[13px] font-semibold text-[#1c1410] border-b border-primary outline-none bg-transparent min-w-[140px]" />
          : <button onClick={() => setEditingName(true)}
              className="text-[13px] font-semibold text-[#1c1410] hover:text-primary transition-colors">
              {pageName}
            </button>
        }

        <div className="flex-1" />

        {/* Theme picker */}
        <div className="relative">
          <button onClick={() => setShowThemes(!showThemes)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-black/10 text-[12px] font-medium text-[#1c1410] hover:border-primary/30 transition-colors">
            <span className="w-3 h-3 rounded-full border border-black/10" style={{ background: SWATCHES[themeKey as keyof typeof SWATCHES] }} />
            <Palette className="w-3.5 h-3.5 text-[#7a6b5c]" />
            <span className="hidden sm:inline">{theme.name}</span>
            <ChevronDown className="w-3 h-3 text-[#7a6b5c]" />
          </button>
          {showThemes && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowThemes(false)} />
              <div className="absolute top-9 right-0 z-20 bg-white rounded-2xl border border-black/8 shadow-xl p-2 w-40">
                {Object.entries(THEMES).map(([key, t]) => (
                  <button key={key} onClick={() => { setThemeKey(key); setShowThemes(false); }}
                    className={cn('w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors',
                      themeKey === key ? 'bg-primary/10 text-primary' : 'text-[#1c1410] hover:bg-[var(--app-bg)]')}>
                    <span className="w-3.5 h-3.5 rounded-full border border-black/10 shrink-0"
                      style={{ background: SWATCHES[key as keyof typeof SWATCHES] }} />
                    {t.name}
                    {themeKey === key && <Check className="w-3 h-3 ml-auto" />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Device toggle */}
        <div className="flex items-center gap-0.5 p-0.5 bg-[var(--accent-tint)] rounded-lg">
          {([['desktop', Monitor], ['tablet', Tablet], ['mobile', Smartphone]] as const).map(([d, Icon]) => (
            <button key={d} onClick={() => setDevice(d)}
              className={cn('p-1.5 rounded-md transition-all', device === d ? 'bg-white text-primary shadow-sm' : 'text-[#7a6b5c] hover:text-primary')}>
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <Button size="sm" disabled={publishing} onClick={async () => {
          const content = { blocks, themeKey };
          setPublishing(true);
          try {
            if (pageId) {
              await api.patch(`/api/landing-pages/${pageId}`, { title: pageName, content, status: 'published' });
            } else {
              await api.post('/api/landing-pages', {
                title: pageName,
                slug: pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
                template: 'Custom',
                status: 'published',
                content,
              });
            }
            toast.success('Page published successfully!');
            navigate('/lead-generation/landing-pages');
          } catch (err: any) {
            toast.error(err?.message ?? 'Failed to publish');
          } finally {
            setPublishing(false);
          }
        }}>
          <Zap className="w-3.5 h-3.5" /> {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left sidebar */}
        <div className="w-52 bg-white border-r border-black/8 flex flex-col shrink-0 overflow-y-auto">
          <div className="px-4 py-3 border-b border-black/5 sticky top-0 bg-white z-10">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c]">Blocks</p>
            <p className="text-[10px] text-[#b09e8d] mt-0.5">Click to add · drag to reorder</p>
          </div>
          <div className="flex-1 pb-4">
            {BLOCK_LIBRARY.map((cat) => (
              <div key={cat.category}>
                <p className="px-4 pt-4 pb-1 text-[9px] font-bold uppercase tracking-widest text-[#b09e8d]">{cat.category}</p>
                {cat.items.map((item) => (
                  <button key={item.type} onClick={() => addBlock(item.type)}
                    className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--app-bg)] transition-colors group text-left">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 group-hover:bg-primary/20 transition-colors">
                      <item.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-[#1c1410] truncate">{item.label}</p>
                      <p className="text-[10px] text-[#b09e8d] truncate">{item.desc}</p>
                    </div>
                    <Plus className="w-3 h-3 text-[#c4b09e] opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1 overflow-y-auto py-8 flex justify-center" onClick={() => setSelectedId(null)}>
          <div
            className="transition-all duration-300 rounded-2xl overflow-hidden shadow-2xl self-start"
            style={{ width: canvasWidth, maxWidth: '100%', minWidth: canvasWidth ? canvasWidth : 320, background: theme.bg, minHeight: 500 }}
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
                <div>
                  {blocks.map((block, idx) => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      theme={theme}
                      selected={selectedId === block.id}
                      onSelect={() => setSelectedId(block.id)}
                      onDelete={() => deleteBlock(block.id)}
                      onMoveUp={() => moveBlock(block.id, 'up')}
                      onMoveDown={() => moveBlock(block.id, 'down')}
                      isFirst={idx === 0}
                      isLast={idx === blocks.length - 1}
                    />
                  ))}
                </div>
              </SortableContext>

              {/* Drag ghost — follows the cursor cleanly */}
              <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
                {activeBlock && (
                  <div
                    className="rounded-xl overflow-hidden shadow-2xl ring-2 ring-primary opacity-95 pointer-events-none"
                    style={{ background: theme.bg }}
                  >
                    <BlockContent block={activeBlock} theme={theme} />
                  </div>
                )}
              </DragOverlay>
            </DndContext>

            {blocks.length === 0 && (
              <div className="flex flex-col items-center justify-center h-80 gap-3 text-center px-8">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                  <Plus className="w-6 h-6 text-primary" />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: theme.text }}>Add your first block</p>
                <p className="text-[12px]" style={{ color: theme.muted }}>Click any block from the left sidebar.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div className="w-60 bg-white border-l border-black/8 flex flex-col shrink-0 overflow-y-auto">
          {selectedBlock ? (
            <>
              <div className="px-4 py-3 border-b border-black/5 flex items-center justify-between sticky top-0 bg-white z-10">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[#7a6b5c]">Properties</p>
                  <p className="text-[12px] font-semibold text-[#1c1410] mt-0.5 capitalize">{selectedBlock.type}</p>
                </div>
                <button onClick={() => setSelectedId(null)}
                  className="p-1 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c] hover:text-primary transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <PropsPanel block={selectedBlock} onChange={(props) => updateProps(selectedBlock.id, props)} />
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-5">
              <Settings2 className="w-8 h-8 text-[#d4c4b4]" />
              <p className="text-[12px] text-[#b09e8d] font-medium leading-relaxed">
                Click any block on the canvas to edit its content and style
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
