import React from 'react';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { FileLinkMenu } from './FileLinkMenu';
import { InlineMarkdownImages } from './InlineMarkdownImages';
import type { ToolPopupContent } from './message/types';

export function MarkdownFiles({ children, sessionId, messageId, streaming, onShowPopup }: {
  children: React.ReactNode; sessionId?: string; messageId: string; streaming?: boolean;
  onShowPopup?: (content: ToolPopupContent) => void;
}) {
  const container = React.useRef<HTMLDivElement>(null);
  const directory = useEffectiveDirectory() || '';
  return <FileLinkMenu directory={directory}><div ref={container} className="min-w-0">
    {children}
    {!streaming && <InlineMarkdownImages container={container} sessionId={sessionId} messageId={messageId} onShowPopup={onShowPopup} />}
  </div></FileLinkMenu>;
}
