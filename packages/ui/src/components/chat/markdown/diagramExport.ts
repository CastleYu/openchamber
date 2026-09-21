const PNG_MIME = 'image/png';
const MAX_EDGE = 8192;
const MAX_PIXELS = 16_777_216;

export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The browser may consume the URL after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const diagramPng = async (svg: string): Promise<Blob> => {
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = parsed.documentElement;
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const width = box?.[2] ?? Number.parseFloat(root.getAttribute('width') ?? '');
  const height = box?.[3] ?? Number.parseFloat(root.getAttribute('height') ?? '');
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new Error('Invalid diagram dimensions');
  }
  const scale = Math.min(2, MAX_EDGE / width, MAX_EDGE / height, Math.sqrt(MAX_PIXELS / (width * height)));
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const image = new Image();
  // VS Code's image CSP allows data URLs, but reserves blob URLs for workers.
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(root))}`;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG export failed')), PNG_MIME);
  });
};
