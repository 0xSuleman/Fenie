/**
 * ImageUtils — Downscales screenshots to stay within API token limits.
 */

/**
 * Downscale a base64 image to target width (default 720p).
 * Returns a Promise<string> with the compressed base64 data URI.
 */
function downscaleImage(base64DataUri, targetWidth = 1280) {
  return new Promise(async (resolve, reject) => {
    try {
      const response = await fetch(base64DataUri);
      const blob = await response.blob();
      const imgBitmap = await createImageBitmap(blob);
      
      const ratio = targetWidth / imgBitmap.width;
      const targetHeight = Math.round(imgBitmap.height * ratio);

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgBitmap, 0, 0, targetWidth, targetHeight);

      const outBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(outBlob);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Strip the data URI prefix to get raw base64.
 */
function stripDataUriPrefix(dataUri) {
  return dataUri.replace(/^data:image\/\w+;base64,/, '');
}

export { downscaleImage, stripDataUriPrefix };
