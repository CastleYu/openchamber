const VIDEO = new Set(['mp4', 'm4v', 'webm', 'mkv', 'mov']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus']);

export function mediaKind(path: string): 'video' | 'audio' | 'zip' | 'image' | 'pdf' | null {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (VIDEO.has(ext)) return 'video';
  if (AUDIO.has(ext)) return 'audio';
  return ext === 'zip' ? 'zip' : null;
}
