import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';

export function ImagePreview({ src, name }: { src: string; name: string }) {
  const { t } = useI18n();
  const [zoom, setZoom] = React.useState<number | null>(null);
  const [failed, setFailed] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  return <div className="flex h-full min-h-48 flex-col gap-2 p-3">
    <div className="flex items-center justify-center gap-1">
      <Button variant="ghost" size="sm" onClick={() => { setZoom(null); void root.current?.parentElement?.requestFullscreen(); }}>{t('filesView.editor.fullscreen')}</Button>
      <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>100%</Button>
      <Button variant="ghost" size="sm" aria-label="−" onClick={() => setZoom(Math.max(0.1, (zoom ?? 1) / 1.25))}><Icon name="subtract" className="size-4" /></Button>
      <Button variant="ghost" size="sm" aria-label="+" onClick={() => setZoom(Math.min(8, (zoom ?? 1) * 1.25))}><Icon name="add" className="size-4" /></Button>
    </div>
    {failed ? <p>{t('fileOpening.previewFailed')}</p> : <div ref={root} className="flex-1 min-h-0 overflow-auto" onPointerDown={event => {
      if (!zoom || !root.current) return;
      drag.current = { x: event.clientX, y: event.clientY, left: root.current.scrollLeft, top: root.current.scrollTop };
      event.currentTarget.setPointerCapture(event.pointerId);
    }} onPointerMove={event => {
      if (!drag.current || !root.current) return;
      root.current.scrollLeft = drag.current.left + drag.current.x - event.clientX;
      root.current.scrollTop = drag.current.top + drag.current.y - event.clientY;
    }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      <img src={src} alt={name} draggable={false} onError={() => setFailed(true)} className={zoom ? 'max-w-none' : 'mx-auto max-w-full max-h-[70vh] object-contain'} style={zoom ? { zoom } : undefined} />
    </div>}
  </div>;
}
