/** A narrow color check for the fixed green-leaf test prompt, not a general image judge. */
export async function inspectGreenLeafTestImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('The test image could not be inspected.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let greenPixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const red = pixels[index];
      const green = pixels[index + 1];
      const blue = pixels[index + 2];
      if (green > 65 && green - red >= 12 && green - blue >= 8) greenPixels++;
    }
    const greenPercent = Number((greenPixels / (canvas.width * canvas.height) * 100).toFixed(2));
    return {
      width: bitmap.width,
      height: bitmap.height,
      greenPercent,
      passed: greenPercent >= 0.4,
    };
  } finally { bitmap.close(); }
}
