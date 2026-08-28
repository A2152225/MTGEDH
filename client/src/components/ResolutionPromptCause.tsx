import React from 'react';
import { getCardPreviewHandlers } from './CardPreviewLayer';

export interface ResolutionPromptCauseInfo {
  causeName?: string;
  causeImage?: string;
  causeLabel?: string;
}

export function ResolutionPromptCause({
  causeName,
  causeImage,
  causeLabel,
}: ResolutionPromptCauseInfo) {
  const name = String(causeName || '').trim();
  if (!name) return null;

  const label = String(causeLabel || 'Triggered by').trim() || 'Triggered by';
  const imageUrl = String(causeImage || '').trim();
  const previewHandlers = imageUrl ? getCardPreviewHandlers({ imageUrl, name }) : {};

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
        color: '#93c5fd',
        fontSize: 13,
        lineHeight: 1.3,
      }}
      {...previewHandlers}
    >
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={name}
          style={{
            width: 28,
            height: 40,
            borderRadius: 4,
            objectFit: 'cover',
            flexShrink: 0,
            border: '1px solid rgba(147,197,253,0.45)',
          }}
        />
      ) : null}
      <span>
        {label}{' '}
        <strong style={{ color: '#e0f2fe', fontWeight: 700 }}>{name}</strong>
      </span>
    </div>
  );
}
