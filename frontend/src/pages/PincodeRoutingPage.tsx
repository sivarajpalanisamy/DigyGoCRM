import { useState, useEffect, useRef } from 'react';
import { Trash2, Search, MapPin, RefreshCw, CheckCircle, AlertCircle, Download,
         ArrowRight, Plus, X, Eye, Upload, Edit2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import * as XLSX from 'xlsx';
import { formatDistanceToNow } from 'date-fns';
import CreateCustomFieldModal from '@/components/CreateCustomFieldModal';

interface RoutingSet {
  id: string;
  name: string;
  match_field: string;
  match_type: 'exact' | 'contains';
  row_count: number;
  times_used: number;
  created_at: string;
  updated_at: string;
}

interface RoutingRow {
  id: string;
  match_value: string;
  pipeline_name: string | null;
  district: string | null;
  state: string | null;
  meta?: Record<string, string> | null;
}

const MATCH_FIELD_LABELS: Record<string, string> = {
  pincode: 'Pincode', city: 'City', state: 'State', district: 'District',
  source: 'Source', product: 'Product', area: 'Area',
};

const slugify = (s: string) =>
  (s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 100) || 'field';

export default function PincodeRoutingPage() {
  const [sets, setSets] = useState<RoutingSet[]>([]);
  const [loading, setLoading] = useState(true);

  // Create set modal
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMatchField, setNewMatchField] = useState('pincode');
  const [newMatchType, setNewMatchType] = useState<'exact' | 'contains'>('exact');
  const [creating, setCreating] = useState(false);

  // Rename modal
  const [renamingSet, setRenamingSet] = useState<RoutingSet | null>(null);
  const [renameVal, setRenameVal] = useState('');

  // Upload state (per set)
  const [uploadingSetId, setUploadingSetId] = useState<string | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [previewFields, setPreviewFields] = useState<Array<{ slug: string; name: string }>>([]);
  const [pendingCreateFields, setPendingCreateFields] = useState<Array<{ name: string; slug: string }>>([]);
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [rawColumns, setRawColumns] = useState<string[]>([]);
  const [mapValue, setMapValue] = useState('');
  const [mapPipeline, setMapPipeline] = useState('');
  // Other sheet columns → destination: '' (ignore) | 'cf:<slug>' | 'new'
  const [extraDest, setExtraDest] = useState<Record<string, string>>({});
  const [customFields, setCustomFields] = useState<Array<{ name: string; slug: string }>>([]);
  const [creatingCol, setCreatingCol] = useState<string | null>(null);
  const [mapperOpen, setMapperOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview rows modal
  const [previewSet, setPreviewSet] = useState<RoutingSet | null>(null);
  const [previewRows, setPreviewRows] = useState<RoutingRow[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);

  // Test lookup (per set)
  const [testSetId, setTestSetId] = useState<string | null>(null);
  const [testVal, setTestVal] = useState('');
  const [testResult, setTestResult] = useState<any>(null);
  const [testing, setTesting] = useState(false);

  // Menu open state
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  // Track which set id is being uploaded — via ref so it's available synchronously
  const pendingSetIdRef = useRef<string | null>(null);

  const loadSets = async () => {
    try {
      const rows = await api.get<RoutingSet[]>('/api/field-routing/sets');
      setSets(rows ?? []);
    } catch { setSets([]); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSets(); }, []);

  // ── Create set ──────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newName.trim()) { toast.error('Name is required'); return; }
    setCreating(true);
    try {
      const s = await api.post<RoutingSet>('/api/field-routing/sets', {
        name: newName.trim(), match_field: newMatchField, match_type: newMatchType,
      });
      setSets((prev) => [s, ...prev]);
      setShowCreate(false); setNewName(''); setNewMatchField('pincode'); setNewMatchType('exact');
      toast.success('Routing set created');
    } catch { toast.error('Failed to create routing set'); }
    finally { setCreating(false); }
  };

  // ── Rename set ──────────────────────────────────────────────────────────────
  const handleRename = async () => {
    if (!renamingSet || !renameVal.trim()) return;
    try {
      await api.patch(`/api/field-routing/sets/${renamingSet.id}`, { name: renameVal.trim() });
      setSets((prev) => prev.map((s) => s.id === renamingSet.id ? { ...s, name: renameVal.trim() } : s));
      setRenamingSet(null);
      toast.success('Renamed');
    } catch { toast.error('Failed to rename'); }
  };

  // ── Delete set ──────────────────────────────────────────────────────────────
  const handleDelete = async (set: RoutingSet) => {
    if (!confirm(`Delete "${set.name}" and all its ${set.row_count} rows?`)) return;
    try {
      await api.delete(`/api/field-routing/sets/${set.id}`);
      setSets((prev) => prev.filter((s) => s.id !== set.id));
      toast.success('Routing set deleted');
    } catch { toast.error('Failed to delete routing set'); }
  };

  // ── File parsing ────────────────────────────────────────────────────────────
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Ensure uploadingSetId is set (fallback to ref in case state hasn't flushed yet)
    if (!uploadingSetId && pendingSetIdRef.current) {
      setUploadingSetId(pendingSetIdRef.current);
    }
    // Load existing custom fields so they can be picked as destinations.
    const cfs = await api.get<Array<{ name: string; slug: string }>>('/api/fields/custom').catch(() => []);
    setCustomFields(cfs ?? []);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (raw.length === 0) { toast.error('File is empty or unreadable'); return; }

        const cols = Object.keys(raw[0]);
        const find = (candidates: string[]) =>
          cols.find((k) => candidates.includes(k.toLowerCase().trim())) ?? '';

        const valueKey    = find(['value', 'match_value', 'pincode', 'city', 'district', 'source', 'product', 'area', 'field', 'key']);
        const pipelineKey = find(['pipeline', 'pipeline_name', 'pipeline name']);

        // Every other column gets a destination: auto-map to an existing custom
        // field by name, else default to "create new field" so nothing is dropped.
        const dest: Record<string, string> = {};
        for (const col of cols) {
          if (col === valueKey || col === pipelineKey) continue;
          const match = (cfs ?? []).find((c) => c.slug === slugify(col) || c.name.toLowerCase() === col.trim().toLowerCase());
          dest[col] = match ? `cf:${match.slug}` : 'new';
        }

        setRawColumns(cols);
        setRawRows(raw);
        setMapValue(valueKey);
        setMapPipeline(pipelineKey);
        setExtraDest(dest);
        setMapperOpen(true);
      } catch { toast.error('Failed to read file. Use a valid .xlsx or .csv file.'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const setColDest = (col: string, d: string) => setExtraDest((m) => ({ ...m, [col]: d }));

  const applyColumnMap = () => {
    if (!mapValue || !mapPipeline) return;

    // Resolve each mapped column to a field slug + name (collect new ones to create).
    const fieldCols: Array<{ col: string; slug: string; name: string }> = [];
    const createFields: Array<{ name: string; slug: string }> = [];
    const taken = new Set<string>();
    for (const col of rawColumns) {
      if (col === mapValue || col === mapPipeline) continue;
      const d = extraDest[col] || '';
      if (d.startsWith('cf:')) {
        const slug = d.slice(3);
        fieldCols.push({ col, slug, name: (customFields.find((c) => c.slug === slug)?.name) ?? col });
        taken.add(slug);
      } else if (d === 'new') {
        let slug = slugify(col); const base = slug; let i = 2;
        while (taken.has(slug)) slug = `${base}_${i++}`;
        taken.add(slug);
        fieldCols.push({ col, slug, name: col.trim() || slug });
        createFields.push({ name: col.trim() || slug, slug });
      }
    }

    const rows = rawRows.map((r) => {
      const meta: Record<string, string> = {};
      for (const f of fieldCols) {
        const v = String(r[f.col] ?? '').trim();
        if (v) meta[f.slug] = v;
      }
      return {
        match_value:   String(r[mapValue] ?? '').trim(),
        pipeline_name: String(r[mapPipeline] ?? '').trim() || null,
        meta,
        // Backward-compat: if mapped to a district/state field, also fill the legacy
        // columns so existing features (e.g. auto-tag by district) keep working.
        district: meta.district ?? null,
        state: meta.state ?? null,
      };
    }).filter((r) => r.match_value);

    if (rows.length === 0) { toast.error('No valid rows found (match value column was empty)'); return; }
    setPreview(rows);
    setPreviewFields(fieldCols.map((f) => ({ slug: f.slug, name: f.name })));
    setPendingCreateFields(createFields);
    setMapperOpen(false);
    toast.success(`${rows.length} rows ready to upload`);
  };

  // Called after the rich field-creator persists a new custom field.
  const handleFieldCreated = (f: { name: string; slug: string }) => {
    setCustomFields((prev) => (prev.some((c) => c.slug === f.slug) ? prev : [...prev, { name: f.name, slug: f.slug }]));
    if (creatingCol) setColDest(creatingCol, `cf:${f.slug}`);
    setCreatingCol(null);
  };

  const handleUpload = async (replace: boolean) => {
    const targetId = uploadingSetId ?? pendingSetIdRef.current;
    if (!targetId || preview.length === 0) return;
    setUploading(true);
    try {
      const res = await api.post<any>(`/api/field-routing/sets/${targetId}/upload`, {
        rows: preview, replace, create_fields: pendingCreateFields,
      });
      toast.success(`Uploaded ${res.inserted} rows (${res.skipped} skipped)`);
      setPreview([]); setPreviewFields([]); setPendingCreateFields([]); setUploadingSetId(null);
      await loadSets();
    } catch { toast.error('Upload failed'); }
    finally { setUploading(false); }
  };

  const openUpload = (setId: string) => {
    pendingSetIdRef.current = setId;
    setUploadingSetId(setId);
    setPreview([]); setMapperOpen(false);
    fileRef.current?.click(); // must be synchronous — setTimeout breaks browser gesture chain
  };

  // ── Preview rows ────────────────────────────────────────────────────────────
  const loadPreviewRows = async (set: RoutingSet, page = 1, search = '') => {
    setPreviewLoading(true);
    try {
      const res = await api.get<any>(
        `/api/field-routing/sets/${set.id}/rows?page=${page}&limit=50&search=${encodeURIComponent(search)}`
      );
      setPreviewRows(res.rows ?? []);
      setPreviewTotal(res.total ?? 0);
      setPreviewPage(page);
    } catch { toast.error('Failed to load rows'); }
    finally { setPreviewLoading(false); }
  };

  const openPreview = (set: RoutingSet) => {
    setPreviewSet(set); setPreviewSearch(''); setPreviewPage(1);
    loadPreviewRows(set, 1, '');
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = async (set: RoutingSet) => {
    try {
      const rows = await api.get<any[]>(`/api/field-routing/sets/${set.id}/export`);
      const ws = XLSX.utils.json_to_sheet(rows.map((r) => ({
        value: r.match_value,
        pipeline: r.pipeline_name ?? '',
        ...(r.meta && typeof r.meta === 'object' ? r.meta : {}),
        ...(r.district ? { district: r.district } : {}),
        ...(r.state ? { state: r.state } : {}),
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Routing');
      XLSX.writeFile(wb, `${set.name.replace(/\s+/g, '_')}.xlsx`);
      toast.success('Exported');
    } catch { toast.error('Export failed'); }
  };

  // ── Test lookup ─────────────────────────────────────────────────────────────
  const handleTest = async () => {
    if (!testSetId || !testVal.trim()) return;
    const set = sets.find((s) => s.id === testSetId);
    setTesting(true); setTestResult(null);
    try {
      const res = await api.post<any>(`/api/field-routing/sets/${testSetId}/test`, {
        value: testVal.trim(), match_type: set?.match_type ?? 'exact',
      });
      setTestResult({ found: true, ...res });
    } catch { setTestResult({ found: false }); }
    finally { setTesting(false); }
  };

  // ── Download template ───────────────────────────────────────────────────────
  const downloadTemplate = (matchField: string) => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['value', 'pipeline', 'district', 'state'],
      [`Sample ${MATCH_FIELD_LABELS[matchField] ?? matchField} 1`, 'Pipeline Name', 'District', 'Tamil Nadu'],
      [`Sample ${MATCH_FIELD_LABELS[matchField] ?? matchField} 2`, 'Another Pipeline', 'District 2', 'Karnataka'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Routing');
    XLSX.writeFile(wb, `field_routing_template.xlsx`);
  };

  const uploading_set = sets.find((s) => s.id === uploadingSetId);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-headline font-bold text-[#1c1410]">Field Routing</h1>
          <p className="text-[13px] text-[#7a6b5c]">Named routing sets — map any field value to a pipeline</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}
          className="flex items-center gap-2 text-white"
        >
          <Plus className="w-4 h-4" /> New Routing Set
        </Button>
      </div>

      {/* Sets list */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sets.length === 0 ? (
        <div className="bg-white rounded-2xl border border-black/5 p-16 text-center">
          <MapPin className="w-12 h-12 text-[#c4b09e] mx-auto mb-3" />
          <p className="font-semibold text-[#1c1410]">No routing sets yet</p>
          <p className="text-[13px] text-[#7a6b5c] mt-1">Create a routing set to map field values to pipelines</p>
          <Button onClick={() => setShowCreate(true)} className="mt-4"
            style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
            <Plus className="w-4 h-4 mr-1" /> Create First Set
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sets.map((set) => (
            <div key={set.id} className="bg-white rounded-2xl border border-black/5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold text-[#1c1410] text-[15px]">{set.name}</h3>
                    <span className="px-2 py-0.5 bg-orange-50 text-orange-700 text-[11px] font-semibold rounded-full border border-orange-100">
                      {MATCH_FIELD_LABELS[set.match_field] ?? set.match_field}
                    </span>
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-[11px] font-semibold rounded-full border border-blue-100">
                      {set.match_type}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-1.5 text-[12px] text-[#7a6b5c]">
                    <span><strong className="text-[#1c1410]">{set.row_count.toLocaleString()}</strong> rows</span>
                    <span><strong className="text-[#1c1410]">{set.times_used}</strong> times used</span>
                    <span>Updated {formatDistanceToNow(new Date(set.updated_at), { addSuffix: true })}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => { setTestSetId(testSetId === set.id ? null : set.id); setTestVal(''); setTestResult(null); }}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded-lg border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => openPreview(set)}
                    className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                    title="Preview rows"
                  >
                    <Eye className="w-4 h-4 text-[#7a6b5c]" />
                  </button>
                  <button
                    onClick={() => openUpload(set.id)}
                    className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                    title="Upload data"
                  >
                    <Upload className="w-4 h-4 text-[#7a6b5c]" />
                  </button>
                  <button
                    onClick={() => handleExport(set)}
                    className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                    title="Download as Excel"
                  >
                    <Download className="w-4 h-4 text-[#7a6b5c]" />
                  </button>
                  <div className="relative">
                    <button
                      onClick={() => setMenuOpen(menuOpen === set.id ? null : set.id)}
                      className="p-1.5 rounded-lg border border-black/10 hover:bg-[var(--app-bg)] transition-colors"
                    >
                      <MoreVertical className="w-4 h-4 text-[#7a6b5c]" />
                    </button>
                    {menuOpen === set.id && (
                      <div className="absolute right-0 top-8 bg-white rounded-xl border border-black/10 shadow-lg z-20 py-1 min-w-[130px]">
                        <button
                          onClick={() => { setRenamingSet(set); setRenameVal(set.name); setMenuOpen(null); }}
                          className="w-full px-4 py-2 text-left text-[13px] hover:bg-[var(--app-bg)] flex items-center gap-2"
                        >
                          <Edit2 className="w-3.5 h-3.5" /> Rename
                        </button>
                        <button
                          onClick={() => { downloadTemplate(set.match_field); setMenuOpen(null); }}
                          className="w-full px-4 py-2 text-left text-[13px] hover:bg-[var(--app-bg)] flex items-center gap-2"
                        >
                          <Download className="w-3.5 h-3.5" /> Template
                        </button>
                        <button
                          onClick={() => { handleDelete(set); setMenuOpen(null); }}
                          className="w-full px-4 py-2 text-left text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline test panel */}
              {testSetId === set.id && (
                <div className="mt-4 pt-4 border-t border-black/5 space-y-2">
                  <p className="text-[12px] font-semibold text-[#1c1410]">Test a value</p>
                  <div className="flex gap-2">
                    <input
                      value={testVal}
                      onChange={(e) => setTestVal(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleTest()}
                      placeholder={`Enter ${MATCH_FIELD_LABELS[set.match_field] ?? set.match_field} value…`}
                      className="flex-1 border border-black/10 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40"
                    />
                    <Button onClick={handleTest} disabled={testing || !testVal.trim()} size="sm">
                      {testing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                    </Button>
                  </div>
                  {testResult && (
                    <div className={`flex items-start gap-2 p-3 rounded-xl text-[13px] ${testResult.found ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      {testResult.found
                        ? <><CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
                            <span className="text-green-800">
                              Pipeline: <strong>{testResult.pipeline_name ?? '-'}</strong>
                              {testResult.district ? ` · District: ${testResult.district}` : ''}
                              {testResult.state ? `, ${testResult.state}` : ''}
                            </span></>
                        : <><AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                            <span className="text-red-700">Value not found in this routing set</span></>
                      }
                    </div>
                  )}
                </div>
              )}

              {/* Upload panel (triggered by clicking upload icon) */}
              {uploadingSetId === set.id && (
                <div className="mt-4 pt-4 border-t border-black/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-[#1c1410]">
                      Upload data to "{uploading_set?.name}"
                    </p>
                    <button onClick={() => { setUploadingSetId(null); setPreview([]); setMapperOpen(false); }}
                      className="p-1 rounded-lg hover:bg-black/5">
                      <X className="w-4 h-4 text-[#7a6b5c]" />
                    </button>
                  </div>

                  {preview.length === 0 && !mapperOpen && (
                    <div
                      onClick={() => fileRef.current?.click()}
                      className="border-2 border-dashed border-[#e8ddd4] rounded-xl p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-[#faf5f0] transition-colors"
                    >
                      <Upload className="w-6 h-6 text-[#c4b09e] mx-auto mb-1.5" />
                      <p className="text-[13px] font-semibold text-[#1c1410]">Click to select Excel / CSV</p>
                      <p className="text-[11px] text-[#7a6b5c] mt-0.5">You'll map columns next — match value + pipeline, plus any extra columns to custom fields.</p>
                    </div>
                  )}

                  {mapperOpen && (
                    <div className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
                      <p className="text-[13px] font-semibold text-[#1c1410]">Map your columns</p>

                      {/* Required: match value + pipeline */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#1c1410] w-36 shrink-0">Match value<span className="text-red-500 ml-0.5">*</span></span>
                          <ArrowRight className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
                          <select value={mapValue} onChange={(e) => setMapValue(e.target.value)}
                            className="flex-1 border border-black/10 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-primary/40 bg-white">
                            <option value="">— Not mapped —</option>
                            {rawColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-[#1c1410] w-36 shrink-0">Pipeline<span className="text-red-500 ml-0.5">*</span></span>
                          <ArrowRight className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
                          <select value={mapPipeline} onChange={(e) => setMapPipeline(e.target.value)}
                            className="flex-1 border border-black/10 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-primary/40 bg-white">
                            <option value="">— Not mapped —</option>
                            {rawColumns.map((col) => <option key={col} value={col}>{col}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* Extra columns → custom fields */}
                      {rawColumns.filter((c) => c !== mapValue && c !== mapPipeline).length > 0 && (
                        <div className="space-y-2 pt-1 border-t border-amber-200/70">
                          <p className="text-[11px] font-semibold text-[#7a6b5c] uppercase tracking-wide">Other columns → fields</p>
                          {rawColumns.filter((c) => c !== mapValue && c !== mapPipeline).map((col) => (
                            <div key={col} className="flex items-center gap-2">
                              <span className="text-[12px] font-semibold text-[#5c5245] w-36 shrink-0 truncate" title={col}>{col}</span>
                              <ArrowRight className="w-3.5 h-3.5 text-[#b09e8d] shrink-0" />
                              <select
                                value={extraDest[col] ?? ''}
                                onChange={(e) => { if (e.target.value === 'new') { setCreatingCol(col); return; } setColDest(col, e.target.value); }}
                                className="flex-1 border border-black/10 rounded-lg px-3 py-1.5 text-[12px] outline-none focus:border-primary/40 bg-white"
                              >
                                <option value="">— Don't import —</option>
                                {customFields.length > 0 && (
                                  <optgroup label="Existing fields">
                                    {customFields.map((cf) => <option key={cf.slug} value={`cf:${cf.slug}`}>{cf.name}</option>)}
                                  </optgroup>
                                )}
                                <option value="new">➕ New custom field…</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setMapperOpen(false)}>Cancel</Button>
                        <Button size="sm" onClick={applyColumnMap}
                          disabled={!mapValue || !mapPipeline}
                          style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
                          Apply → Preview
                        </Button>
                      </div>
                    </div>
                  )}

                  {preview.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-[13px] font-semibold text-[#1c1410]">{preview.length} rows ready</p>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setPreview([])}>Cancel</Button>
                          <Button variant="outline" size="sm" onClick={() => handleUpload(false)} disabled={uploading}>
                            {uploading ? 'Uploading…' : 'Merge'}
                          </Button>
                          <Button size="sm" onClick={() => handleUpload(true)} disabled={uploading}
                            style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
                            {uploading ? 'Uploading…' : 'Replace All'}
                          </Button>
                        </div>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-black/5 max-h-48 overflow-y-auto">
                        <table className="w-full text-[12px]">
                          <thead className="bg-[var(--app-bg)] sticky top-0">
                            <tr>
                              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#7a6b5c]">Value</th>
                              <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#7a6b5c]">Pipeline</th>
                              {previewFields.map((f) => (
                                <th key={f.slug} className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-[#7a6b5c]">{f.name}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-black/[0.04]">
                            {preview.slice(0, 30).map((r, i) => (
                              <tr key={i} className="hover:bg-[var(--app-bg)]">
                                <td className="px-3 py-1.5 font-mono text-[#1c1410]">{r.match_value}</td>
                                <td className="px-3 py-1.5 text-[#1c1410]">{r.pipeline_name ?? '-'}</td>
                                {previewFields.map((f) => (
                                  <td key={f.slug} className="px-3 py-1.5 text-[#7a6b5c]">{r.meta?.[f.slug] ?? '-'}</td>
                                ))}
                              </tr>
                            ))}
                            {preview.length > 30 && (
                              <tr><td colSpan={2 + previewFields.length} className="px-3 py-2 text-center text-[11px] text-[#7a6b5c]">…and {preview.length - 30} more rows</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <p className="text-[11px] text-[#7a6b5c]">
                        <strong>Merge</strong> — adds new rows, updates existing by value.&nbsp;
                        <strong>Replace All</strong> — deletes all existing rows first.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />

      {/* Create custom field inline (for "➕ New custom field…" in the column mapper) */}
      {creatingCol !== null && (
        <CreateCustomFieldModal
          initialName={creatingCol}
          onClose={() => setCreatingCol(null)}
          onCreate={handleFieldCreated}
        />
      )}

      {/* ── Create Set Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setShowCreate(false)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-[#1c1410] text-lg">New Routing Set</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 hover:bg-black/5 rounded-lg">
                <X className="w-5 h-5 text-[#7a6b5c]" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-semibold text-[#1c1410] block mb-1">Name <span className="text-red-500">*</span></label>
                <input
                  value={newName} onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  placeholder="e.g. Tamil Nadu Pincodes, City Routing"
                  className="w-full border border-black/10 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[#1c1410] block mb-1">Match Field</label>
                <select
                  value={newMatchField} onChange={(e) => setNewMatchField(e.target.value)}
                  className="w-full border border-black/10 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40"
                >
                  {Object.entries(MATCH_FIELD_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                  <option value="custom">Custom field</option>
                </select>
                <p className="text-[11px] text-[#7a6b5c] mt-1">Which lead field's value will be looked up in this set</p>
              </div>
              <div>
                <label className="text-[12px] font-semibold text-[#1c1410] block mb-1">Match Type</label>
                <div className="flex gap-2">
                  {(['exact', 'contains'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setNewMatchType(t)}
                      className={`flex-1 py-2 text-[13px] rounded-xl border font-medium transition-colors ${newMatchType === t ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-black/10 text-[#7a6b5c] hover:bg-[var(--app-bg)]'}`}
                    >
                      {t === 'exact' ? 'Exact match' : 'Contains'}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-[#7a6b5c] mt-1">
                  {newMatchType === 'exact' ? 'Value must match exactly (case-insensitive)' : 'Value partially matches (e.g. "Chennai" matches "Chennai North")'}
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button className="flex-1" onClick={handleCreate} disabled={creating || !newName.trim()}
                style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>
                {creating ? 'Creating…' : 'Create Set'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Rename Modal ── */}
      {renamingSet && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setRenamingSet(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm space-y-4">
            <h2 className="font-bold text-[#1c1410]">Rename Routing Set</h2>
            <input
              value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              className="w-full border border-black/10 rounded-xl px-3 py-2 text-[13px] outline-none focus:border-primary/40"
              autoFocus
            />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setRenamingSet(null)}>Cancel</Button>
              <Button className="flex-1" onClick={handleRename} disabled={!renameVal.trim()}
                style={{ background: 'linear-gradient(135deg,var(--brand-dark),var(--brand))' }}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Preview Rows Modal ── */}
      {previewSet && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && setPreviewSet(null)}>
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-black/5">
              <div>
                <h2 className="font-bold text-[#1c1410]">{previewSet.name}</h2>
                <p className="text-[12px] text-[#7a6b5c]">{previewTotal.toLocaleString()} total rows</p>
              </div>
              <button onClick={() => setPreviewSet(null)} className="p-1 hover:bg-black/5 rounded-lg">
                <X className="w-5 h-5 text-[#7a6b5c]" />
              </button>
            </div>
            <div className="p-4 border-b border-black/5">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-[#b09e8d]" />
                <input
                  value={previewSearch}
                  onChange={(e) => { setPreviewSearch(e.target.value); loadPreviewRows(previewSet, 1, e.target.value); }}
                  placeholder="Search rows…"
                  className="pl-8 pr-3 py-2 text-[12px] border border-black/10 rounded-xl outline-none focus:border-primary/40 w-full"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {previewLoading ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-4 border-[var(--brand)] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="bg-[var(--app-bg)] sticky top-0">
                    <tr>{['Value', 'Pipeline', 'Fields'].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-[#7a6b5c]">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-black/[0.04]">
                    {previewRows.map((r) => {
                      const fields = { ...(r.meta ?? {}), ...(r.district ? { district: r.district } : {}), ...(r.state ? { state: r.state } : {}) };
                      const summary = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join(' · ');
                      return (
                        <tr key={r.id} className="hover:bg-[var(--app-bg)]">
                          <td className="px-4 py-2.5 font-mono text-[#1c1410]">{r.match_value}</td>
                          <td className="px-4 py-2.5 text-[#1c1410]">{r.pipeline_name ?? '-'}</td>
                          <td className="px-4 py-2.5 text-[#7a6b5c]">{summary || '-'}</td>
                        </tr>
                      );
                    })}
                    {previewRows.length === 0 && (
                      <tr><td colSpan={3} className="px-4 py-8 text-center text-[#7a6b5c]">No rows found</td></tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
            {previewTotal > 50 && (
              <div className="flex items-center justify-between p-4 border-t border-black/5">
                <span className="text-[12px] text-[#7a6b5c]">Page {previewPage} of {Math.ceil(previewTotal / 50)}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={previewPage <= 1}
                    onClick={() => { const p = previewPage - 1; loadPreviewRows(previewSet, p, previewSearch); }}>← Prev</Button>
                  <Button variant="outline" size="sm" disabled={previewPage >= Math.ceil(previewTotal / 50)}
                    onClick={() => { const p = previewPage + 1; loadPreviewRows(previewSet, p, previewSearch); }}>Next →</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Close menu on outside click */}
      {menuOpen && <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(null)} />}
    </div>
  );
}
