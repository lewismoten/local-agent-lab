export type StorageCapacity = { kind: 'browser'; availableBytes: number; quotaBytes: number; usedBytes: number } |
  { kind: 'external-or-unknown'; availableBytes: null };

/** StorageManager estimates origin storage, not the free bytes on a chosen USB drive. */
export async function storageCapacity(folder: FileSystemDirectoryHandle): Promise<StorageCapacity> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory || !navigator.storage?.estimate || !folder.isSameEntry)
    return { kind: 'external-or-unknown', availableBytes: null };
  try {
    const opfs = await navigator.storage.getDirectory();
    const browserFolder = await opfs.getDirectoryHandle('local-agent-lab');
    if (!await folder.isSameEntry(browserFolder)) return { kind: 'external-or-unknown', availableBytes: null };
    const { quota, usage } = await navigator.storage.estimate();
    if (!Number.isFinite(quota) || !Number.isFinite(usage) || quota === undefined || usage === undefined)
      return { kind: 'external-or-unknown', availableBytes: null };
    return { kind: 'browser', availableBytes: Math.max(0, quota - usage), quotaBytes: quota, usedBytes: usage };
  } catch {
    // A revoked folder permission or unavailable estimate must not masquerade
    // as zero free space. The actual write will report its own error.
    return { kind: 'external-or-unknown', availableBytes: null };
  }
}

/** Check only the additional bytes required when replacing an existing file. */
export async function assertBrowserStorageRoom(folder: FileSystemDirectoryHandle, newBytes: number, oldBytes = 0): Promise<void> {
  const additionalBytes = Math.max(0, newBytes - oldBytes);
  if (!additionalBytes) return;
  const capacity = await storageCapacity(folder);
  if (capacity.kind === 'browser' && additionalBytes > capacity.availableBytes)
    throw new DOMException(`Browser storage has about ${capacity.availableBytes.toLocaleString()} bytes available; this save needs ${additionalBytes.toLocaleString()} more bytes. Connect a drive or free browser storage.`, 'QuotaExceededError');
}
