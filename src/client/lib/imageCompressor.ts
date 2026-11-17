/**
 * Compresses shopfloor camera photos client-side to ultra-lightweight JPEG (target ~20–35 KB, max 800px)
 * for instant upload to Google Drive over workshop Wi-Fi/4G while keeping part details sharp.
 */
export async function compressImageToDataUrl(
  file: File,
  maxWidth: number = 800,
  quality: number = 0.65
): Promise<string> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không thể đọc tệp ảnh.'));
    reader.readAsDataURL(file);
  });

  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return rawDataUrl;
  }

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;

        if (origW <= 0 || origH <= 0) {
          resolve(rawDataUrl);
          return;
        }

        const encodeAtScale = (targetMaxDim: number, q: number): string => {
          let w = origW;
          let h = origH;
          if (w > targetMaxDim || h > targetMaxDim) {
            if (w >= h) {
              h = Math.round((h * targetMaxDim) / w);
              w = targetMaxDim;
            } else {
              w = Math.round((w * targetMaxDim) / h);
              h = targetMaxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return rawDataUrl;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, w, h);
          return canvas.toDataURL('image/jpeg', q);
        };

        // Pass 1: 800px @ 0.65 quality (~25-40 KB for typical shopfloor photo)
        let compressed = encodeAtScale(maxWidth, quality);

        // Pass 2: If base64 length > 55,000 chars (~40 KB), step down quality to 0.52
        if (compressed.length > 55000) {
          compressed = encodeAtScale(maxWidth, 0.52);
        }

        // Pass 3: If still > 50,000 chars (~37 KB), step down dimension to 680px @ 0.48
        if (compressed.length > 50000) {
          compressed = encodeAtScale(680, 0.48);
        }

        resolve(compressed || rawDataUrl);
      } catch {
        resolve(rawDataUrl);
      }
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
}
