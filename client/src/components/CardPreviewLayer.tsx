import React, { useEffect, useRef, useState, useCallback } from 'react';
import type { KnownCardRef, CardFace } from '../../../shared/src';

// A lightweight, global, fixed-position overlay that shows a readable
// card image near a hovered element. It avoids covering the hovered card
// itself by default (prefers 'above' with the preview bottom aligned to
// the anchor's top). It also handles rapid hover transitions across rows
// without flicker or stale positioning.

// Storage key for preview scale preference
const PREVIEW_SCALE_KEY = 'mtgedh:previewScale';
const DEFAULT_PREVIEW_SCALE = 1.0;
const MIN_PREVIEW_SCALE = 0.5;
const MAX_PREVIEW_SCALE = 1.5;

// Read initial scale from localStorage
function getInitialPreviewScale(): number {
  try {
    const stored = localStorage.getItem(PREVIEW_SCALE_KEY);
    if (stored) {
      const val = parseFloat(stored);
      if (!isNaN(val) && val >= MIN_PREVIEW_SCALE && val <= MAX_PREVIEW_SCALE) {
        return val;
      }
    }
  } catch {
    // Ignore localStorage errors
  }
  return DEFAULT_PREVIEW_SCALE;
}

// Gap between cards when showing multiple faces
const MULTI_FACE_GAP = 8;

type CardLike = {
  name?: string;
  type_line?: string;
  image_uris?: KnownCardRef['image_uris'];
  faceDown?: boolean;
  card_faces?: CardFace[];
  layout?: string;
};

type ShowDetail = {
  element: HTMLElement;
  card: CardLike;
  prefer?: 'left' | 'right' | 'above' | 'below' | 'auto';
  // For 'above', anchorPadding shifts the preview vertically relative to the anchor's top
  // (positive = further up, negative = closer down). 0 means bottom aligns to anchor top.
  anchorPadding?: number;
};

type HideDetail = {
  element?: HTMLElement;
};

const SHOW_EVT = 'card-preview:show';
const HIDE_EVT = 'card-preview:hide';

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Public API: request a preview anchored to a UI element.
// Will only render if the viewer has a known face (image_uris present or card_faces with images).
export function showCardPreview(
  element: HTMLElement,
  card: CardLike,
  opts?: { prefer?: 'left' | 'right' | 'above' | 'below' | 'auto'; anchorPadding?: number }
) {
  if (!element || !card) return;
  // Check main image_uris
  const hasMainImg = !!(card.image_uris?.normal || card.image_uris?.small || card.image_uris?.art_crop);
  // Check card_faces for double-faced cards
  const hasFaceImg = card.card_faces?.some(f => f.image_uris?.normal || f.image_uris?.small || f.image_uris?.art_crop);
  if (!hasMainImg && !hasFaceImg) return;
  const evt = new CustomEvent<ShowDetail>(SHOW_EVT, {
    detail: { element, card, prefer: opts?.prefer, anchorPadding: opts?.anchorPadding },
  });
  window.dispatchEvent(evt);
}

export function hideCardPreview(element?: HTMLElement) {
  const evt = new CustomEvent<HideDetail>(HIDE_EVT, { detail: { element } });
  window.dispatchEvent(evt);
}

export function CardPreviewLayer() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [meta, setMeta] = useState<{ 
    name?: string; 
    type_line?: string; 
    url?: string;
    faces?: Array<{ name?: string; url: string }>;
  } | null>(null);
  const [prefer, setPrefer] = useState<'left' | 'right' | 'above' | 'below' | 'auto'>('above');
  const [anchorPadding, setAnchorPadding] = useState<number>(0);
  
  // Scale control for popup card size
  const [previewScale, setPreviewScale] = useState<number>(getInitialPreviewScale);
  const [showScaleSlider, setShowScaleSlider] = useState(false);

  // Position state (causes re-render when updated)
  const [pos, setPos] = useState<{ left: number; top: number; w: number; h: number }>({ left: 0, top: 0, w: 0, h: 0 });

  // Token to guard against stale async updates during rapid hover transitions
  const tokenRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  
  // Handle scale change and persist to localStorage
  const handleScaleChange = useCallback((newScale: number) => {
    const clamped = clamp(newScale, MIN_PREVIEW_SCALE, MAX_PREVIEW_SCALE);
    setPreviewScale(clamped);
    try {
      localStorage.setItem(PREVIEW_SCALE_KEY, clamped.toString());
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Check if we have multiple faces to display
  const hasFaces = meta?.faces && meta.faces.length > 1;
  const faceCount = hasFaces ? meta!.faces!.length : 1;

  const pickAndSetPosition = useCallback((tkn: number) => {
    if (!anchor) return;
    // Ignore if a newer show was processed
    if (tkn !== tokenRef.current) return;

    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Readable preview size; MTG portrait aspect ~0.72 (w/h) - apply scale
    // For double-faced cards, show two cards side by side
    const basePreviewW = 360;
    const singleCardW = Math.round(basePreviewW * previewScale);
    // Use smaller scale for double-faced cards to fit both on screen
    const adjustedScale = faceCount > 1 ? 0.7 : 1;
    const cardW = Math.round(singleCardW * adjustedScale);
    const cardGap = faceCount > 1 ? MULTI_FACE_GAP : 0;
    const previewW = cardW * faceCount + cardGap * (faceCount - 1);
    const previewH = Math.round(cardW / 0.72);
    const gap = 12;   // gap used for non-above placements
    const margin = 8; // viewport margin

    const spaceRight = vw - rect.right - gap - margin;
    const spaceLeft = rect.left - gap - margin;
    const spaceBelow = vh - rect.bottom - gap - margin;

    const fitsRight = spaceRight >= previewW;
    const fitsLeft = spaceLeft >= previewW;
    const fitsBelow = spaceBelow >= previewH;

    // Horizontally center over anchor (clamped to viewport)
    const centerX = () => clamp(rect.left + (rect.width - previewW) / 2, margin, vw - previewW - margin);

    // Exact above: bottom of preview sits at anchor's top.
    const placeAboveExact = () => {
      const top = rect.top - previewH - (anchorPadding || 0);
      const left = centerX();
      setPos({ left, top, w: previewW, h: previewH });
    };

    const placeBelow = () => {
      const top = rect.bottom + gap;
      const left = centerX();
      setPos({ left, top, w: previewW, h: previewH });
    };

    const placeRight = () => {
      const left = rect.right + gap;
      const top = clamp(rect.top + (anchorPadding || 0), margin, vh - previewH - margin);
      setPos({ left, top, w: previewW, h: previewH });
    };

    const placeLeft = () => {
      const left = rect.left - gap - previewW;
      const top = clamp(rect.top + (anchorPadding || 0), margin, vh - previewH - margin);
      setPos({ left, top, w: previewW, h: previewH });
    };

    // Try preferred + fallbacks
    const tryOrder = (order: Array<'above' | 'below' | 'right' | 'left'>) => {
      for (const side of order) {
        if (side === 'above') {
          placeAboveExact();
          return true;
        }
        if (side === 'below' && fitsBelow) { placeBelow(); return true; }
        if (side === 'right' && fitsRight) { placeRight(); return true; }
        if (side === 'left'  && fitsLeft)  { placeLeft();  return true; }
      }
      return false;
    };

    let tried = false;
    switch (prefer) {
      case 'above': tried = tryOrder(['above', 'below', 'right', 'left']); break;
      case 'below': tried = tryOrder(['below', 'above', 'right', 'left']); break;
      case 'left':  tried = tryOrder(['left', 'right', 'above', 'below']); break;
      case 'right': tried = tryOrder(['right', 'left', 'above', 'below']); break;
      case 'auto':
      default:      tried = tryOrder(['above', 'below', spaceRight >= spaceLeft ? 'right' : 'left', spaceRight >= spaceLeft ? 'left' : 'right']); break;
    }

    // Fallback: ensure we do not cover the anchor; default to above exact
    if (!tried) placeAboveExact();
  }, [anchor, anchorPadding, prefer, previewScale, faceCount]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const myToken = tokenRef.current;
    rafRef.current = requestAnimationFrame(() => pickAndSetPosition(myToken));
  }, [pickAndSetPosition]);

  useEffect(() => {
    const onShow = (e: Event) => {
      const ce = e as CustomEvent<ShowDetail>;
      const el = ce.detail?.element;
      const card = ce.detail?.card;
      if (!el || !card) return;
      
      // Check for double-faced card with card_faces
      const faces: Array<{ name?: string; url: string }> = [];
      if (card.card_faces && card.card_faces.length > 1) {
        for (const face of card.card_faces) {
          const faceUrl = face.image_uris?.normal || face.image_uris?.small || face.image_uris?.art_crop;
          if (faceUrl) {
            faces.push({ name: face.name, url: faceUrl });
          }
        }
      }
      
      // Get primary image URL
      const url = card.image_uris?.normal || card.image_uris?.small || card.image_uris?.art_crop;
      
      // If no main URL and no faces, skip
      if (!url && faces.length === 0) return;

      // Bump token to invalidate any in-flight updates from previous anchor
      tokenRef.current++;
      setAnchor(el);
      setPrefer(ce.detail?.prefer ?? 'above');
      setAnchorPadding(Number.isFinite(ce.detail?.anchorPadding as number) ? (ce.detail?.anchorPadding as number) : 0);
      setMeta({ 
        name: card.name, 
        type_line: card.type_line, 
        url: url || faces[0]?.url,
        faces: faces.length > 1 ? faces : undefined,
      });

      // Compute immediately for crisp transitions
      pickAndSetPosition(tokenRef.current);
    };

    const onHide = (e: Event) => {
      const ce = e as CustomEvent<HideDetail>;
      const fromEl = ce.detail?.element;
      // Only hide if not superseded by a newer anchor, or if the hide request
      // comes from the same element currently anchored.
      if (fromEl && anchor && fromEl !== anchor) return;
      tokenRef.current++;
      setAnchor(null);
      setMeta(null);
    };

    window.addEventListener(SHOW_EVT, onShow as any);
    window.addEventListener(HIDE_EVT, onHide as any);

    const onScrollOrResize = () => {
      if (!anchor) return;
      scheduleUpdate();
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);

    const ticker = window.setInterval(scheduleUpdate, 120);

    return () => {
      window.removeEventListener(SHOW_EVT, onShow as any);
      window.removeEventListener(HIDE_EVT, onHide as any);
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.clearInterval(ticker);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // Only re-run when anchor, positioning preferences, or scale changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, prefer, anchorPadding, previewScale]);

  // Render nothing if no preview is active - but keep scale slider accessible via settings
  if (!anchor || !meta?.url) {
    return (
      <PreviewScaleSlider
        scale={previewScale}
        onScaleChange={handleScaleChange}
        show={showScaleSlider}
        onToggle={() => setShowScaleSlider(s => !s)}
      />
    );
  }

  return (
    <>
      <PreviewScaleSlider
        scale={previewScale}
        onScaleChange={handleScaleChange}
        show={showScaleSlider}
        onToggle={() => setShowScaleSlider(s => !s)}
      />
      <div
        style={{
          position: 'fixed',
          left: pos.left,
          top: pos.top,
          width: pos.w,
          height: pos.h,
          zIndex: 12000,
          pointerEvents: 'none',
          filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.6))',
          display: 'flex',
          gap: hasFaces ? MULTI_FACE_GAP : 0,
        }}
      >
        {hasFaces ? (
          // Render multiple faces side by side
          meta.faces!.map((face, idx) => {
            const cardW = (pos.w - MULTI_FACE_GAP * (meta.faces!.length - 1)) / meta.faces!.length;
            return (
              <div
                key={idx}
                style={{
                  width: cardW,
                  height: '100%',
                  position: 'relative',
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                <img
                  src={face.url}
                  alt={face.name || ''}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: 10,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    bottom: 0,
                    padding: '4px 8px',
                    fontSize: 10,
                    color: '#fff',
                    textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                    background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                    borderBottomLeftRadius: 10,
                    borderBottomRightRadius: 10,
                  }}
                >
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {face.name || (idx === 0 ? 'Front' : 'Back')}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          // Render single card
          <>
            <img
              src={meta.url}
              alt={meta.name || ''}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: 10,
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                padding: '6px 10px',
                fontSize: 12,
                color: '#fff',
                textShadow: '0 1px 2px rgba(0,0,0,0.8)',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                borderBottomLeftRadius: 10,
                borderBottomRightRadius: 10,
              }}
            >
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{meta.name}</div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Scale slider component for adjusting popup card size
 */
function PreviewScaleSlider({
  scale,
  onScaleChange,
  show,
  onToggle,
}: {
  scale: number;
  onScaleChange: (scale: number) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        right: 8,
        zIndex: 12001,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 4,
        pointerEvents: 'auto',
      }}
    >
      {show && (
        <div
          style={{
            background: 'rgba(20, 20, 30, 0.9)',
            borderRadius: 8,
            padding: '10px 14px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            color: '#fff',
            fontSize: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            minWidth: 180,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>Card Preview Size</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ opacity: 0.7, fontSize: 11 }}>Small</span>
            <input
              type="range"
              min={MIN_PREVIEW_SCALE}
              max={MAX_PREVIEW_SCALE}
              step={0.05}
              value={scale}
              onChange={(e) => onScaleChange(parseFloat(e.target.value))}
              style={{
                flex: 1,
                accentColor: '#3b82f6',
              }}
            />
            <span style={{ opacity: 0.7, fontSize: 11 }}>Large</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11, opacity: 0.8 }}>
            {Math.round(scale * 100)}%
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: show ? '#3b82f6' : 'rgba(30, 30, 40, 0.9)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '6px 10px',
          color: '#fff',
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        title="Adjust card preview size"
      >
        🔍 Preview Size
      </button>
    </div>
  );
}