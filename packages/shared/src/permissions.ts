export const orgRoles = ['OWNER', 'ADMIN', 'MANAGER', 'PAYMENT_MANAGER', 'MEMBER'] as const
export type OrgRole = (typeof orgRoles)[number]

export const actions = [
  'org:manage',
  'users:read',
  'users:write',
  'teams:write',
  'devices:read',
  'devices:revoke',
  'screenshots:read',
  'screenshots:delete',
  'policy:read',
  'policy:write',
  'audit:read',
  'desktop:use',
] as const

export type Action = (typeof actions)[number]

const grants: Record<OrgRole, readonly Action[]> = {
  OWNER: actions,
  ADMIN: [
    'users:read',
    'users:write',
    'teams:write',
    'devices:read',
    'devices:revoke',
    'screenshots:read',
    'screenshots:delete',
    'policy:read',
    'policy:write',
    'audit:read',
    'desktop:use',
  ],
  MANAGER: ['users:read', 'devices:read', 'screenshots:read', 'policy:read', 'desktop:use'],
  PAYMENT_MANAGER: ['policy:read', 'desktop:use', 'devices:read'],
  MEMBER: ['policy:read', 'desktop:use', 'devices:read'],
}

export function roleAllows(role: OrgRole, action: Action): boolean {
  return grants[role].includes(action)
}

/**
 * Screenshot explorer access is the intersection of the role grant and the
 * organization allow-list. OWNER is required to remain on that list so an
 * organization cannot lock every administrator out of its own images.
 */
export function canReadScreenshots(role: OrgRole, accessRoles: readonly OrgRole[]): boolean {
  return roleAllows(role, 'screenshots:read') && accessRoles.includes(role)
}
