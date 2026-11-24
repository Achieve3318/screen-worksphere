/**
 * Product branding. Feature code should read these values instead of hard-coding
 * the working name. The encrypted-file magic is a format identifier; change it
 * only together with a format version bump.
 */
export const brand = {
  productName: 'WorkSphere',
  productSlug: 'screenvault',
  fileExtension: 'svault',
  magic: 'SVAULT1',
  userAgent: 'WorkSphereDesktop',
  // Kept so existing local screenshots and settings stay in the same folder.
  dataDirName: 'ScreenVault',
} as const

export type Brand = typeof brand
