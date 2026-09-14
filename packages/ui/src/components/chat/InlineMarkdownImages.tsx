import React from 'react';
import { createPortal } from 'react-dom';
import { MarkdownImageGallery } from './MarkdownImageGallery';
import type { ToolPopupContent } from './message/types';

export function InlineMarkdownImages({ container, sessionId, messageId, onShowPopup }: {
  container: React.RefObject<HTMLDivElement | null>; sessionId?: string; messageId: string;
  onShowPopup?: (content: ToolPopupContent) => void;
}) {
  const [slots, setSlots] = React.useState<HTMLElement[]>([]);
  React.useEffect(() => {
    const root = container.current;
    if (!root) return;
    const scan = () => {
      const next = Array.from(root.querySelectorAll<HTMLElement>('[data-openchamber-image-slot]'));
      setSlots(previous => previous.length === next.length && previous.every((node, i) => node === next[i]) ? previous : next);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [container]);
  return <>{slots.map((slot, index) => createPortal(<MarkdownImageGallery sessionId={sessionId} messageId={messageId} contents={[`![](<${slot.dataset.openchamberImageSlot || ''}>)`]} onShowPopup={onShowPopup} />, slot, String(index)))}</>;
}
