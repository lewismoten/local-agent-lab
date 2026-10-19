/** Keep generated images at their original dimensions in the portable image library. */
export async function imageLibraryPng(source: Blob): Promise<Blob> {
  if (!source.type.startsWith('image/') || !source.size || source.size > 50_000_000) throw new Error('Generated image is too large to save.');
  if (source.type === 'image/png' && source.size <= 20_000_000) return source;
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 4096 || bitmap.height > 4096 || bitmap.width * bitmap.height > 16_000_000)
      throw new Error('Generated image dimensions are too large to save.');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode generated PNG.')), 'image/png'));
    if (png.size > 20_000_000) throw new Error('Generated PNG exceeds 20 MB.');
    return png;
  } finally { bitmap.close(); }
}
