'use client';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { PostMedia } from '@/launch-ad/lib/types';

/** Plays a post's media: videos with controls, images, and every item of a carousel with arrows. */
export function MediaView({ media, autoPlay = false }: { media: PostMedia[]; autoPlay?: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [media]);
  const m = media[Math.min(i, media.length - 1)];
  if (!m) return null;
  return (
    <div className="media-view">
      <div className="media-stage">
        {m.type === 'video' ? (
          // key: switching items loads the new video instead of keeping the old one
          <video key={m.url} src={m.url} poster={m.poster || undefined} controls playsInline autoPlay={autoPlay} preload="metadata" />
        ) : (
          <img src={m.url} alt="" />
        )}
        {media.length > 1 ? (
          <>
            <button type="button" className="nav" style={{ left: 8 }} aria-label="Previous item" onClick={() => setI((i - 1 + media.length) % media.length)}><ChevronLeft size={16} /></button>
            <button type="button" className="nav" style={{ right: 8 }} aria-label="Next item" onClick={() => setI((i + 1) % media.length)}><ChevronRight size={16} /></button>
          </>
        ) : null}
      </div>
      {media.length > 1 ? <div className="hint" style={{ textAlign: 'center', marginTop: 6 }}>{i + 1} of {media.length}</div> : null}
    </div>
  );
}

export function MediaModal({ media, caption, onClose }: { media: PostMedia[]; caption?: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Post media" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="zoom-box">
        <button type="button" className="icon-btn zoom-close" aria-label="Close" onClick={onClose}><X size={18} /></button>
        <MediaView media={media} autoPlay />
        {caption ? <p className="hint" style={{ margin: '4px 4px 0', whiteSpace: 'pre-wrap' }}>{caption.slice(0, 400)}</p> : null}
      </div>
    </div>
  );
}
