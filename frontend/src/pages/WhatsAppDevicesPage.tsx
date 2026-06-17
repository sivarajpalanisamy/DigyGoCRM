import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Plus, Settings, QrCode, Pencil, UserPlus, Trash2, X, Check, RefreshCw, Wifi, WifiOff,
  MessageSquare, BarChart2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useCrmStore } from '@/store/crmStore';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';

type Device = {
  session_id: string;
  session_name: string;
  status: string;
  phone_number: string | null;
  connected_at: string | null;
  total_messages: number;
  assigned_staff: { id: string; name: string }[];
};

type Filter = 'all' | 'active' | 'inactive';

export default function WhatsAppDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const navigate = useNavigate();
  const { staff } = useCrmStore();

  // Modals
  const [renameDevice, setRenameDevice] = useState<Device | null>(null);
  const [renameName, setRenameName] = useState('');
  const [assignDevice, setAssignDevice] = useState<Device | null>(null);
  const [assignIds, setAssignIds] = useState<string[]>([]);
  const [qrDevice, setQrDevice] = useState<Device | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Device | null>(null);

  const loadDevices = async () => {
    try {
      const data = await api.get<Device[]>('/api/whatsapp-personal/devices');
      if (Array.isArray(data)) setDevices(data);
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadDevices(); }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [menuOpen]);

  const filtered = devices.filter((d) => {
    if (filter === 'active' && d.status !== 'connected') return false;
    if (filter === 'inactive' && d.status === 'connected') return false;
    if (search) {
      const q = search.toLowerCase();
      return d.session_name.toLowerCase().includes(q) || (d.phone_number ?? '').includes(q);
    }
    return true;
  });

  const activeCount = devices.filter((d) => d.status === 'connected').length;
  const inactiveCount = devices.length - activeCount;

  const addDevice = async () => {
    try {
      const { session_id } = await api.post<{ session_id: string }>('/api/whatsapp-personal/sessions', { name: `Device ${devices.length + 1}` });
      await loadDevices();
      const newDev = { session_id, session_name: `Device ${devices.length + 1}`, status: 'disconnected', phone_number: null, connected_at: null, total_messages: 0, assigned_staff: [] };
      setQrDevice(newDev);
    } catch (err: any) { toast.error(err.message ?? 'Failed to create device'); }
  };

  const removeDevice = async (d: Device) => {
    try {
      await api.delete(`/api/whatsapp-personal/sessions/${d.session_id}`);
      toast.success('Device removed');
      setRemoveTarget(null);
      loadDevices();
    } catch { toast.error('Failed to remove device'); }
  };

  const disconnectDevice = async (d: Device) => {
    try {
      await api.post(`/api/whatsapp-personal/sessions/${d.session_id}/disconnect`, {});
      toast.success('Disconnected');
      loadDevices();
    } catch { toast.error('Failed'); }
  };

  const saveRename = async () => {
    if (!renameDevice || !renameName.trim()) return;
    try {
      await api.patch(`/api/whatsapp-personal/sessions/${renameDevice.session_id}`, { name: renameName.trim() });
      toast.success('Renamed');
      setRenameDevice(null);
      loadDevices();
    } catch { toast.error('Failed to rename'); }
  };

  const saveAssign = async () => {
    if (!assignDevice) return;
    try {
      await api.patch(`/api/whatsapp-personal/sessions/${assignDevice.session_id}/staff`, { staff_ids: assignIds });
      toast.success('Staff updated');
      setAssignDevice(null);
      loadDevices();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-headline font-bold text-[17px] text-[#1c1410]">My Devices</h2>
          <p className="text-[12px] text-[#9e8e7e]">Manage your WhatsApp Personal devices connected via QR scan</p>
        </div>
        <button
          onClick={addDevice}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#128C7E] rounded-lg px-4 py-2 hover:bg-[#0f7a6d] transition-colors shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />Add New Device
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-3">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')} icon={<QrCode className="w-3 h-3" />} label={`${devices.length} All`} />
        <FilterPill active={filter === 'active'} onClick={() => setFilter('active')} icon={<Wifi className="w-3 h-3" />} label={`${activeCount} Active`} color="emerald" />
        <FilterPill active={filter === 'inactive'} onClick={() => setFilter('inactive')} icon={<WifiOff className="w-3 h-3" />} label={`${inactiveCount} Inactive`} color="red" />
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9e8e7e]" />
        <input
          className="w-full pl-9 pr-3 py-2 text-[13px] rounded-xl border border-black/10 bg-white outline-none focus:border-[#128C7E] transition-colors"
          placeholder="Search devices..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Count */}
      <p className="text-[12px] text-[#9e8e7e]">Showing {filtered.length} of {devices.length} devices</p>

      {/* Device grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20 text-[#9e8e7e]">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />Loading devices...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-[#9e8e7e]">
          <QrCode className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-[14px] font-semibold">No devices found</p>
          <p className="text-[12px] mt-1">{devices.length === 0 ? 'Add your first WhatsApp device to get started' : 'Try adjusting your search or filter'}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((d) => (
            <DeviceCard
              key={d.session_id}
              device={d}
              menuOpen={menuOpen === d.session_id}
              onMenuToggle={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === d.session_id ? null : d.session_id); }}
              onScan={() => { setMenuOpen(null); setQrDevice(d); }}
              onRename={() => { setMenuOpen(null); setRenameDevice(d); setRenameName(d.session_name); }}
              onAssignStaff={() => { setMenuOpen(null); setAssignDevice(d); setAssignIds(d.assigned_staff.map((s) => s.id)); }}
              onDisconnect={() => { setMenuOpen(null); disconnectDevice(d); }}
              onRemove={() => { setMenuOpen(null); setRemoveTarget(d); }}
              onViewAnalytics={() => { setMenuOpen(null); navigate('/settings/integrations/wa-personal'); }}
            />
          ))}
        </div>
      )}

      {/* Rename modal */}
      {renameDevice && (
        <ModalShell title="Edit Device Name" onClose={() => setRenameDevice(null)}>
          <div className="p-5 space-y-4">
            <input
              autoFocus
              className="w-full px-3 py-2 text-[13px] rounded-lg border border-black/10 outline-none focus:border-[#128C7E]"
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }}
              placeholder="Device name"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRenameDevice(null)} className="text-[12px] text-[#7a6b5c] px-4 py-1.5 rounded-lg border border-black/10 hover:bg-[var(--accent-tint)]">Cancel</button>
              <button onClick={saveRename} className="text-[12px] font-semibold text-white bg-[#128C7E] px-4 py-1.5 rounded-lg hover:bg-[#0f7a6d]">Save</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Assign staff modal */}
      {assignDevice && (
        <ModalShell title={`Assign Staff — ${assignDevice.session_name}`} onClose={() => setAssignDevice(null)}>
          <div className="p-5 space-y-4">
            <p className="text-[12px] text-[#9e8e7e]">Select staff members who can send messages from this device.</p>
            <div className="max-h-[250px] overflow-y-auto space-y-1.5">
              {staff.length === 0 && <p className="text-[12px] text-[#9e8e7e] py-4 text-center">No staff members found</p>}
              {staff.map((s) => (
                <label key={s.id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-[var(--accent-tint)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={assignIds.includes(s.id)}
                    onChange={() => setAssignIds((prev) => prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id])}
                    className="accent-[#128C7E] w-3.5 h-3.5"
                  />
                  <span className="text-[13px] text-[#1c1410]">{s.name}</span>
                </label>
              ))}
            </div>
            {/* Selected tags */}
            {assignIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {assignIds.map((id) => {
                  const s = staff.find((x) => x.id === id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 text-[11px] font-semibold bg-[#128C7E]/10 text-[#128C7E] px-2 py-0.5 rounded-full">
                      {s?.name ?? 'Unknown'}
                      <button onClick={() => setAssignIds((p) => p.filter((x) => x !== id))} className="hover:text-red-500">
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAssignDevice(null)} className="text-[12px] text-[#7a6b5c] px-4 py-1.5 rounded-lg border border-black/10 hover:bg-[var(--accent-tint)]">Cancel</button>
              <button onClick={saveAssign} className="text-[12px] font-semibold text-white bg-[#128C7E] px-4 py-1.5 rounded-lg hover:bg-[#0f7a6d]">Save</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* QR Scan modal */}
      {qrDevice && (
        <QrScanModal
          device={qrDevice}
          onClose={() => { setQrDevice(null); loadDevices(); }}
          onConnected={() => { setQrDevice(null); loadDevices(); }}
        />
      )}

      {removeTarget && (
        <ConfirmDeleteModal
          title="Remove Device?"
          message={<>Remove <span className="font-semibold text-[#1c1410]">"{removeTarget.session_name}"</span>? This will disconnect and delete all session data. This cannot be undone.</>}
          confirmLabel="Yes, Remove"
          onConfirm={() => removeDevice(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function FilterPill({ active, onClick, icon, label, color }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; color?: string;
}) {
  const colors = color === 'emerald'
    ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
    : color === 'red'
    ? 'bg-red-50 text-red-500 border-red-200'
    : 'bg-[#f5f0eb] text-[#7a6b5c] border-black/10';
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all',
        active ? colors : 'bg-white text-[#9e8e7e] border-black/5 hover:bg-[var(--accent-tint)]',
      )}
    >
      {icon}{label}
    </button>
  );
}

function DeviceCard({ device: d, menuOpen, onMenuToggle, onScan, onRename, onAssignStaff, onDisconnect, onRemove, onViewAnalytics }: {
  device: Device;
  menuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onScan: () => void;
  onRename: () => void;
  onAssignStaff: () => void;
  onDisconnect: () => void;
  onRemove: () => void;
  onViewAnalytics: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-black/5 p-5 flex flex-col gap-3 hover:shadow-sm transition-all relative">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <h3 className="text-[15px] font-bold text-[#1c1410] uppercase tracking-wide">{d.session_name}</h3>
        <div className="relative">
          <button onClick={onMenuToggle} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#9e8e7e]">
            <Settings className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-30 bg-white rounded-xl shadow-lg border border-black/10 py-1.5 w-[180px]" onClick={(e) => e.stopPropagation()}>
              {d.status !== 'connected' && (
                <MenuItem icon={<QrCode className="w-3.5 h-3.5" />} label="Scan" onClick={onScan} />
              )}
              {d.status === 'connected' && (
                <MenuItem icon={<WifiOff className="w-3.5 h-3.5" />} label="Disconnect" onClick={onDisconnect} />
              )}
              <MenuItem icon={<Pencil className="w-3.5 h-3.5" />} label="Edit Device Name" onClick={onRename} />
              <MenuItem icon={<UserPlus className="w-3.5 h-3.5" />} label="Assign to Staff" onClick={onAssignStaff} />
              <MenuItem icon={<BarChart2 className="w-3.5 h-3.5" />} label="View Analytics" onClick={onViewAnalytics} />
              <div className="border-t border-black/5 my-1" />
              <MenuItem icon={<Trash2 className="w-3.5 h-3.5" />} label="Remove Device" onClick={onRemove} danger />
            </div>
          )}
        </div>
      </div>

      {/* Phone */}
      <div className="text-[13px] text-[#1c1410]">
        <span className="text-[#9e8e7e]">Phone : </span>
        <span className="font-semibold">{d.phone_number || '—'}</span>
      </div>

      {/* Total Messages */}
      <div className="text-[13px] text-[#1c1410]">
        <span className="text-[#9e8e7e]">Total Messages: </span>
        <span className="font-semibold">{d.total_messages.toLocaleString()}</span>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-[#9e8e7e]">Status:</span>
        {d.status === 'connected' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
            Active
          </span>
        ) : d.status === 'connecting' ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-600 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
            Connecting
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#9e8e7e] bg-[#f5f0eb] px-2.5 py-0.5 rounded-full border border-black/10">
            Inactive
          </span>
        )}
      </div>

      {/* Assigned Staff */}
      <div className="text-[13px]">
        <span className="text-[#9e8e7e]">Assigned Staff:</span>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          {d.assigned_staff.length === 0 ? (
            <span className="text-[11px] text-[#9e8e7e] bg-[#f5f0eb] px-2.5 py-0.5 rounded-full border border-black/10">
              No staff assigned
            </span>
          ) : (
            d.assigned_staff.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#128C7E] bg-[#128C7E]/10 px-2.5 py-0.5 rounded-full">
                {s.name}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-4 py-2 text-[12px] hover:bg-[var(--accent-tint)] transition-colors text-left',
        danger ? 'text-red-500' : 'text-[#1c1410]',
      )}
    >
      {icon}{label}
    </button>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <p className="text-[15px] font-bold text-[#1c1410]">{title}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]"><X size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── QR Scan Modal ───────────────────────────────────────────────────────────

function QrScanModal({ device, onClose, onConnected }: { device: Device; onClose: () => void; onConnected: () => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [starting, setStarting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQrRef = useRef<string | null>(null);
  const sid = device.session_id;

  const clearTimers = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (countRef.current) clearInterval(countRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  };

  const onQrReceived = (qrData: string) => {
    setQr(qrData);
    if (qrData !== lastQrRef.current) {
      lastQrRef.current = qrData;
      setCountdown(60);
      setTimedOut(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    }
  };

  const startSession = async () => {
    clearTimers();
    setStarting(true);
    setQr(null);
    lastQrRef.current = null;
    setTimedOut(false);
    try {
      await api.post(`/api/whatsapp-personal/sessions/${sid}/connect`, {});
      setCountdown(60);
      timeoutRef.current = setTimeout(() => setTimedOut(true), 60_000);
      pollRef.current = setInterval(async () => {
        try {
          const data = await api.get<{ qr: string | null }>(`/api/whatsapp-personal/sessions/${sid}/qr`);
          if (data.qr) onQrReceived(data.qr);
        } catch {}
      }, 1500);
      countRef.current = setInterval(() => {
        setCountdown((c) => (c <= 1 ? 60 : c - 1));
      }, 1000);
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to start session');
    } finally { setStarting(false); }
  };

  useEffect(() => {
    const socket = getSocket();
    const qrHandler = (data: { qr: string; sessionId?: string }) => {
      if (data.sessionId && data.sessionId !== sid) return;
      if (data.qr) onQrReceived(data.qr);
    };
    const statusHandler = (data: { status: string; sessionId?: string }) => {
      if (data.sessionId && data.sessionId !== sid) return;
      if (data.status === 'connected') {
        setConnected(true);
        setQr(null);
        clearTimers();
        setTimeout(() => onConnected(), 1500);
      }
    };
    socket.on('wa:qr', qrHandler);
    socket.on('wa:status', statusHandler);
    startSession();
    return () => { socket.off('wa:qr', qrHandler); socket.off('wa:status', statusHandler); clearTimers(); };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-black/5 flex items-center justify-between">
          <p className="text-[15px] font-bold text-[#1c1410]">Scan QR — {device.session_name}</p>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--accent-tint)] text-[#7a6b5c]"><X size={15} /></button>
        </div>
        <div className="p-6 flex flex-col items-center gap-4">
          {connected ? (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check className="w-8 h-8 text-emerald-600" />
              </div>
              <p className="text-[14px] font-bold text-emerald-600">Connected!</p>
              <p className="text-[12px] text-[#7a6b5c] text-center">WhatsApp is now linked to your CRM.</p>
            </>
          ) : qr ? (
            <>
              <img src={qr} alt="WhatsApp QR Code" className="w-52 h-52 rounded-xl border border-black/10" />
              <div className="flex flex-col items-center gap-1">
                <p className="text-[13px] font-semibold text-[#1c1410]">Scan with WhatsApp on your phone</p>
                <p className="text-[11px] text-[#9e8e7e]">WhatsApp → Linked Devices → Link a Device</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <p className="text-[11px] text-[#9e8e7e]">QR refreshes in {countdown}s</p>
                </div>
              </div>
            </>
          ) : timedOut ? (
            <>
              <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center">
                <X className="w-7 h-7 text-red-400" />
              </div>
              <p className="text-[13px] font-semibold text-[#1c1410]">QR generation timed out</p>
              <p className="text-[11px] text-[#9e8e7e] text-center">Wait a few minutes then try again.</p>
              <button onClick={startSession} className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-white bg-[#128C7E] rounded-lg px-4 py-1.5 hover:bg-[#0f7a6d]">
                <RefreshCw className="w-3.5 h-3.5" />Try Again
              </button>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-[#f5f0eb] flex items-center justify-center">
                <RefreshCw className="w-7 h-7 text-[#9e8e7e] animate-spin" />
              </div>
              <p className="text-[13px] text-[#7a6b5c] text-center">
                {starting ? 'Starting session…' : 'Generating QR code…'}
              </p>
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t border-black/5 bg-[var(--app-bg)]">
          <p className="text-[10.5px] text-[#b09e8d] text-center leading-relaxed">
            Avoid mass messaging to prevent WhatsApp from banning the number.
          </p>
        </div>
      </div>
    </div>
  );
}
