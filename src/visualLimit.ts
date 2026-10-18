export const VISUAL_PACKAGE_LIMIT_BYTES = 2_000_000_000;

export const visualPackageLimitMessage = (label: string, bytes: number) =>
  `${label} needs ${(bytes / 1e9).toFixed(2)} GB with its required engine; the 2 GB package limit prevents this download.`;
