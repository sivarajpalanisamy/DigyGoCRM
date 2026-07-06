import { useAuthStore } from '@/store/authStore';

export type UserLevel = 'owner' | 'manager' | 'staff';

/**
 * Single source of truth for user level across the entire app.
 *
 * owner   - super_admin or owner (permAll = true)
 * manager - staff with staff:manage permission
 * staff   - everyone else
 *
 * Use this instead of scattering `permAll`, `isPrivileged`, `isManager`
 * logic across individual components.
 */
export function useUserLevel(): UserLevel {
  const permAll     = useAuthStore((s) => s.permAll);
  const permissions = useAuthStore((s) => s.permissions);
  if (permAll) return 'owner';
  if (permissions['staff:manage'] === true) return 'manager';
  return 'staff';
}
