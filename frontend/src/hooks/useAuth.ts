import { useAuthStore } from '@/store/authStore';

/**
 * Single typed hook for auth data.
 * Always use this instead of calling useAuthStore((s) => s.currentUser) directly -
 * it prevents typos like s.user (which silently returns undefined in non-strict TS).
 */
export function useAuth() {
  const currentUser   = useAuthStore((s) => s.currentUser);
  const permAll       = useAuthStore((s) => s.permAll);
  const permissions   = useAuthStore((s) => s.permissions);
  const isImpersonating = useAuthStore((s) => s.isImpersonating);

  const role          = currentUser?.role ?? 'staff';
  const isOwner       = role === 'owner';
  const isSuperAdmin  = role === 'super_admin';
  const isPrivileged  = isOwner || isSuperAdmin;
  const isManager     = !isPrivileged && permissions['staff:manage'] === true;

  return { currentUser, permAll, permissions, isImpersonating, role, isOwner, isSuperAdmin, isPrivileged, isManager };
}
