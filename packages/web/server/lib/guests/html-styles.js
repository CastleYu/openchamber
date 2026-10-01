import { GUEST_SCROLLBAR_CSS, GUEST_SCROLLBAR_SCRIPT } from '@openchamber/sdk';

const GUEST_COLOR_SCHEME_META = '<meta name="color-scheme" content="light dark">';
const LEADING_DOCTYPE = /^\s*<!doctype[^>]*>/i;

const declareColorScheme = (html) => {
  const doctype = LEADING_DOCTYPE.exec(html)?.[0] ?? '';
  return `${doctype}${GUEST_COLOR_SCHEME_META}${html.slice(doctype.length)}`;
};

/** Append after authored HTML so tag-like strings in scripts and comments remain untouched. */
export const injectGuestDocumentStyles = (html) => `${declareColorScheme(html)}\n<style data-openchamber-guest-styles>${GUEST_SCROLLBAR_CSS}</style>\n<script data-openchamber-guest-scrollbar>${GUEST_SCROLLBAR_SCRIPT}</script>`;
