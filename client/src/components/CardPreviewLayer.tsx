import React, { useEffect, useRef, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';

// A lightweight, global, fixed-position overlay that shows a readable
// card image near a hovered element. It avoids covering the hovered card
// itself by default (prefers 'above' with the preview bottom aligned to
// the anchor's top). It also handles rapid hover transitions across rows
// without flicker or stale positioning.

type CardLike = {
  name?: string;
  type_line?: string;
  image_uris?: KnownCardRef['image_uris'];
  faceDown?: boolean;
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
// Will only render if the viewer has a known face (image_uris present).
export function showCardPreview(
  element: HTMLElement,
  card: CardLike,
  opts?: { prefer?: 'left' | 'right' | 'above' | 'below' | 'auto'; anchorPadding?: number }
) {
  if (!element || !card) return;
  const hasImg = !!(card.image_uris?.normal || card.image_uris?.small || card.image_uris?.art_crop);
  if (!hasImg) return;
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
  const [meta, setMeta] = useState<{ name?: string; type_line?: string; url?: string } | null>(null);
  const [prefer, setPrefer] = useState<'left' | 'right' | 'above' | 'below' | 'auto'>('above');
  const [anchorPadding, setAnchorPadding] = useState<number>(0);

  // Position state (causes re-render when updated)
  const [pos, setPos] = useState<{ left: number; top: number; w: number; h: number }>({ left: 0, top: 0, w: 0, h: 0 });

  // Token to guard against stale async updates during rapid hover transitions
  const tokenRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const pickAndSetPosition = (tkn: number) => {
    if (!anchor) return;
    // Ignore if a newer show was processed
    if (tkn !== tokenRef.current) return;

    const rect = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Readable preview size; MTG portrait aspect ~0.72 (w/h)
    const previewW = 360;
    const previewH = Math.round(previewW / 0.72);
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
  };

  const scheduleUpdate = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const myToken = tokenRef.current;
    rafRef.current = requestAnimationFrame(() => pickAndSetPosition(myToken));
  };

  useEffect(() => {
    const onShow = (e: Event) => {
      const ce = e as CustomEvent<ShowDetail>;
      const el = ce.detail?.element;
      const card = ce.detail?.card;
      if (!el || !card) return;
      const url = card.image_uris?.normal || card.image_uris?.small || card.image_uris?.art_crop;
      if (!url) return;

      // Bump token to invalidate any in-flight updates from previous anchor
      tokenRef.current++;
      setAnchor(el);
      setPrefer(ce.detail?.prefer ?? 'above');
      setAnchorPadding(Number.isFinite(ce.detail?.anchorPadding as number) ? (ce.detail?.anchorPadding as number) : 0);
      setMeta({ name: card.name, type_line: card.type_line, url });

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, prefer, anchorPadding]);

  if (!anchor || !meta?.url) return null;

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: pos.w,
        height: pos.h,
        zIndex: 10000,
        pointerEvents: 'none',
        filter: 'drop-shadow(0 12px 24px rgba(0,0,0,0.6))',
      }}
    >
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
    </div>
  );
}