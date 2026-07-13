import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { downloadBlob } from '@/lib/api';

interface ExportField {
  key: string;
  label: string;
}

interface Props {
  title: string;
  fields: ExportField[];
  buildUrl: (selectedFields: string[], format: string) => string;
  filename?: string;
  onClose: () => void;
}

export function ExportModal({ title, fields, buildUrl, filename, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(fields.map((f) => f.key)));
  const [fmt, setFmt] = useState<'xlsx' | 'csv'>('xlsx');
  const [exporting, setExporting] = useState(false);

  const toggle = (key: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const handleExport = async () => {
    if (selected.size === 0) { toast.error('Select at least one field'); return; }
    setExporting(true);
    try {
      const url = buildUrl([...selected], fmt);
      await downloadBlob(url, filename ? `${filename}.${fmt}` : `export.${fmt}`);
      toast.success('Export downloaded');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-black/5">
          <h3 className="text-[16px] font-bold text-[#111318]">{title}</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#6b7280] hover:bg-[#f1f3f5] hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-[14px] font-semibold text-[#6b7280] uppercase tracking-wide mb-2.5">Select fields to export</p>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {fields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selected.has(f.key)}
                    onChange={() => toggle(f.key)}
                    className="w-4 h-4 rounded border-black/20 accent-primary"
                  />
                  <span className="text-[15px] text-[#111318] group-hover:text-primary transition-colors">{f.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-2.5">
              <button
                onClick={() => setSelected(new Set(fields.map((f) => f.key)))}
                className="text-[12px] text-primary hover:underline font-medium"
              >
                Select all
              </button>
              <span className="text-[12px] text-[#c3c8cf]">·</span>
              <button onClick={() => setSelected(new Set())} className="text-[12px] text-[#6b7280] hover:underline">
                Clear
              </button>
            </div>
          </div>
          <div>
            <p className="text-[14px] font-semibold text-[#6b7280] uppercase tracking-wide mb-2.5">Format</p>
            <div className="flex gap-4">
              {(['xlsx', 'csv'] as const).map((f) => (
                <label key={f} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="export-format"
                    value={f}
                    checked={fmt === f}
                    onChange={() => setFmt(f)}
                    className="accent-primary"
                  />
                  <span className="text-[15px] text-[#111318]">{f === 'xlsx' ? 'Excel (.xlsx)' : 'CSV (.csv)'}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5 flex gap-2.5">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-black/10 text-[15px] font-semibold text-[#6b7280] hover:bg-[#f1f3f5] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || selected.size === 0}
            className="flex-1 py-2.5 rounded-xl text-[15px] font-semibold text-white bg-primary hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {exporting ? 'Exporting…' : `Export ${selected.size} field${selected.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
