import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Eye, EyeOff, Lock, UserPlus, Shield } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { ConfirmDeleteModal } from '@/components/ui/ConfirmDeleteModal';

interface AdminUser {
  id: string;
  name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export default function SuperAdminTeamPage() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [showChangePw, setShowChangePw] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const data = await api.get<AdminUser[]>('/api/auth/admin-users');
      setUsers(data);
    } catch { toast.error('Failed to load admin users'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/auth/admin-users/${deleteTarget.id}`);
      setUsers((u) => u.filter((x) => x.id !== deleteTarget.id));
      toast.success('User deleted');
    } catch (err: any) { toast.error(err.message ?? 'Failed to delete'); }
    setDeleteTarget(null);
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="font-headline font-bold text-[22px] text-[#111318]">Admin Team</h2>
          <p className="text-[15px] text-[#6b7280] mt-1">Manage users who can access the super admin panel.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowChangePw(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[15px] font-semibold text-[#111318] bg-white border border-[var(--hairline)] hover:bg-[var(--surface-2)] active:scale-[0.98] transition"
          >
            <Lock className="w-4 h-4" /> Change Password
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-gradient flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-[15px] font-bold active:scale-[0.98] transition hover:opacity-90"
          >
            <UserPlus className="w-4 h-4" /> Add Admin User
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-[var(--hairline)] card-shadow overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-[var(--hairline)] bg-[var(--surface-2)]">
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">#</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Name</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Email</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Status</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Last Login</th>
              <th className="text-left px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Created</th>
              <th className="text-right px-5 py-3 text-[12px] font-semibold text-[#9ca3af] uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[15px] text-[#9ca3af]">Loading...</td></tr>
            )}
            {!loading && users.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-[15px] text-[#9ca3af]">No admin users found.</td></tr>
            )}
            {!loading && users.map((u, i) => {
              const isMe = u.id === currentUser?.id;
              return (
                <tr key={u.id} className="border-b border-[var(--hairline)] hover:bg-[var(--surface-2)] transition-colors">
                  <td className="px-5 py-3.5 text-[15px] text-[#6b7280]">{i + 1}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                        <Shield className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <p className="text-[15px] font-semibold text-[#111318]">
                          {u.name}
                          {isMe && <span className="ml-1.5 text-[11px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">YOU</span>}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-[15px] text-[#111318]">{u.email}</td>
                  <td className="px-5 py-3.5">
                    <span className={cn(
                      'text-[12px] font-semibold px-2.5 py-1 rounded-full',
                      u.is_active ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
                    )}>
                      {u.is_active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-[15px] text-[#6b7280]">
                    {u.last_login_at ? format(new Date(u.last_login_at), 'dd MMM yyyy, hh:mm a') : 'Never'}
                  </td>
                  <td className="px-5 py-3.5 text-[15px] text-[#6b7280]">
                    {format(new Date(u.created_at), 'dd MMM yyyy')}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditUser(u)}
                        className="p-1.5 rounded-xl text-[#6b7280] hover:bg-[var(--surface-2)] hover:text-primary transition"
                        title="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {!isMe && (
                        <button
                          onClick={() => setDeleteTarget(u)}
                          className="p-1.5 rounded-xl text-[#6b7280] hover:bg-red-50 hover:text-red-600 transition"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {/* Add / Edit Modal */}
      {(showAddModal || editUser) && (
        <AdminUserModal
          user={editUser}
          onClose={() => { setShowAddModal(false); setEditUser(null); }}
          onSaved={(saved) => {
            if (editUser) {
              setUsers((u) => u.map((x) => x.id === saved.id ? { ...x, ...saved } : x));
            } else {
              setUsers((u) => [...u, saved]);
            }
            setShowAddModal(false);
            setEditUser(null);
          }}
        />
      )}

      {/* Delete Confirm */}
      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete ${deleteTarget.name}?`}
          message={`This will permanently remove "${deleteTarget.email}" from the admin team. They will no longer be able to access the super admin panel.`}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* Change Password Modal */}
      {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
    </div>
  );
}

// ── Add / Edit Admin User Modal ──────────────────────────────────────────────

function AdminUserModal({ user, onClose, onSaved }: {
  user: AdminUser | null;
  onClose: () => void;
  onSaved: (u: AdminUser) => void;
}) {
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    is_active: user?.is_active ?? true,
  });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim() || !form.email.trim()) { toast.error('Name and email are required'); return; }
    if (!user && (!form.password || form.password.length < 6)) { toast.error('Password must be at least 6 characters'); return; }
    setSaving(true);
    try {
      if (user) {
        const body: any = { name: form.name, email: form.email, is_active: form.is_active };
        if (form.password) body.password = form.password;
        const updated = await api.patch<AdminUser>(`/api/auth/admin-users/${user.id}`, body);
        toast.success('User updated');
        onSaved(updated);
      } else {
        const created = await api.post<AdminUser>('/api/auth/admin-users', {
          name: form.name, email: form.email, password: form.password,
        });
        toast.success('Admin user created');
        onSaved(created);
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to save');
    } finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[var(--hairline)] text-[16px] text-[#111318] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 bg-white placeholder:text-gray-300 transition';
  const lbl = 'block text-[15px] font-semibold text-[#111318] mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--hairline)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
          <h3 className="text-[16px] font-bold text-[#111318]">{user ? 'Edit Admin User' : 'Add Admin User'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[var(--surface-2)] transition flex items-center justify-center"><X className="w-4 h-4 text-[#6b7280]" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={lbl}>Name <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" />
          </div>
          <div>
            <label className={lbl}>Email <span className="text-red-500">*</span></label>
            <input className={inputCls} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="admin@example.com" />
          </div>
          <div>
            <label className={lbl}>{user ? 'New Password' : 'Password'} {!user && <span className="text-red-500">*</span>}</label>
            <div className="relative">
              <input
                className={`${inputCls} pr-10`}
                type={showPw ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={user ? 'Leave blank to keep current' : 'Min 6 characters'}
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <label className="text-[15px] font-semibold text-[#111318]">Active</label>
              <button
                type="button"
                onClick={() => setForm({ ...form, is_active: !form.is_active })}
                className={cn(
                  'relative w-10 h-5 rounded-full transition-colors',
                  form.is_active ? 'bg-green-500' : 'bg-gray-300'
                )}
              >
                <span className={cn(
                  'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                  form.is_active ? 'left-5' : 'left-0.5'
                )} />
              </button>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-[var(--hairline)]">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[15px] font-semibold text-[#111318] bg-white hover:bg-[var(--surface-2)] border border-[var(--hairline)] active:scale-[0.98] transition">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-gradient flex-1 py-2.5 rounded-xl text-[15px] font-bold text-white active:scale-[0.98] transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Saving...' : user ? 'Save Changes' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Change Password Modal ────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ current: '', newPw: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.current) { toast.error('Enter your current password'); return; }
    if (form.newPw.length < 6) { toast.error('New password must be at least 6 characters'); return; }
    if (form.newPw !== form.confirm) { toast.error('Passwords do not match'); return; }
    setSaving(true);
    try {
      await api.post('/api/auth/change-password', {
        current_password: form.current,
        new_password: form.newPw,
      });
      toast.success('Password changed successfully');
      onClose();
    } catch (err: any) {
      toast.error(err.message ?? 'Failed to change password');
    } finally { setSaving(false); }
  };

  const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-[var(--hairline)] text-[16px] text-[#111318] outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20 bg-white placeholder:text-gray-300 transition';
  const lbl = 'block text-[15px] font-semibold text-[#111318] mb-1.5';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-[var(--hairline)]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--hairline)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center"><Lock className="w-4 h-4 text-primary" /></div>
            <h3 className="text-[16px] font-bold text-[#111318]">Change Password</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl hover:bg-[var(--surface-2)] transition flex items-center justify-center"><X className="w-4 h-4 text-[#6b7280]" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className={lbl}>Current Password</label>
            <div className="relative">
              <input className={`${inputCls} pr-10`} type={showPw ? 'text' : 'password'} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} placeholder="Enter current password" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <div>
            <label className={lbl}>New Password</label>
            <input className={inputCls} type={showPw ? 'text' : 'password'} value={form.newPw} onChange={(e) => setForm({ ...form, newPw: e.target.value })} placeholder="Min 6 characters" />
          </div>
          <div>
            <label className={lbl}>Confirm New Password</label>
            <input className={inputCls} type={showPw ? 'text' : 'password'} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} placeholder="Re-enter new password" />
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-[var(--hairline)]">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-[15px] font-semibold text-[#111318] bg-white hover:bg-[var(--surface-2)] border border-[var(--hairline)] active:scale-[0.98] transition">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="btn-gradient flex-1 py-2.5 rounded-xl text-[15px] font-bold text-white active:scale-[0.98] transition hover:opacity-90 disabled:opacity-60"
          >
            {saving ? 'Changing...' : 'Change Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
