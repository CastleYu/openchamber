// Sandboxed extension frames have an opaque origin. Refuse frame navigation
// that could carry data away in the destination URL before a request starts.
const LOCAL_SCHEMES = new Set(['about:', 'data:', 'blob:']);
const GUEST_PATH_PREFIX = '/api/guests/';

export const shouldBlockGuestFrameNavigation = ({ isMainFrame, frameOrigin, url, isAppOrigin }) => {
  if (isMainFrame || frameOrigin !== 'null') return false;
  let target;
  try {
    target = new URL(url);
  } catch {
    return true;
  }
  if (LOCAL_SCHEMES.has(target.protocol)) return false;
  if (isAppOrigin(url) && target.pathname.startsWith(GUEST_PATH_PREFIX)) return false;
  return true;
};
