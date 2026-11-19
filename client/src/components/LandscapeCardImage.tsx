import React from 'react';

/** Planechase cards are 5" × 3.5" when you read them as landscape. */
export const PLANE_LANDSCAPE_ASPECT = 5 / 3.5;

export function planeLandscapeSize(height: number): { width: number; height: number } {
  const h = Math.max(1, Math.round(height));
  return { width: Math.round(h * PLANE_LANDSCAPE_ASPECT), height: h };
}

/**
 * Plane / phenomenon scans are portrait files of a landscape card.
 * Rotate 90 degrees clockwise inside a 5×3.5 frame so the effect text at the
 * bottom stays on screen instead of being cropped by overflow.
 */
export function LandscapeCardImage({
  src,
  alt = '',
  height = 168,
  width,
}: {
  src: string;
  alt?: string;
  height?: number;
  width?: number;
}) {
  const h = Math.max(1, Math.round(height));
  const w = Math.max(1, Math.round(width ?? h * PLANE_LANDSCAPE_ASPECT));
  return (
    <span
      style={{
        width: w,
        height: h,
        flex: '0 0 auto',
        position: 'relative',
        display: 'block',
        overflow: 'hidden',
        borderRadius: 3,
        background: '#0b1220',
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: h,
          height: w,
          maxWidth: 'none',
          objectFit: 'fill',
          transform: 'translate(-50%, -50%) rotate(90deg)',
          transformOrigin: 'center center',
        }}
      />
    </span>
  );
}
