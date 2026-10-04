export async function encodePlot(image: ImageBitmap) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  if (!context) throw Error('Canvas nicht verfügbar.');
  context.drawImage(image, 0, 0);
  return canvas.convertToBlob({type: 'image/png'});
}
