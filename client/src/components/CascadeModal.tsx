import React from 'react';
import type { KnownCardRef } from '../../../shared/src';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export interface CascadeModalProps {
  open: boolean;
  sourceName: string;
  cascadeNumber: number;
  totalCascades: number;
  hitCard: KnownCardRef;
  exiledCards: KnownCardRef[];
  onCast: () => void;
  onDecline: () => void;
}

export function CascadeModal({
  open,
  sourceName,
  cascadeNumber,
  totalCascades,
  hitCard,
  exiledCards,
  onCast,
  onDecline,
}: CascadeModalProps) {
  if (!open) return null;

  return (
    <div style={backdrop}>
      <div style={modal}>
        <h2 style={{ marginTop: 0, marginBottom: 8 }}>Cascade – {sourceName}</h2>
        <div style={{ color: '#a0aec0', marginBottom: 12 }}>
          Cascade {cascadeNumber} of {totalCascades}. You may cast the revealed card without paying its mana cost.
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
          <CardThumb card={hitCard} label="Revealed Card" />
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>{hitCard.name}</div>
            <div style={{ color: '#cbd5e0', fontSize: 13 }}>{hitCard.type_line}</div>
            <div style={{ color: '#a0aec0', fontSize: 13, marginTop: 4, whiteSpace: 'pre-wrap' }}>
              {hitCard.oracle_text || 'No oracle text available.'}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 8, fontWeight: 600 }}>Exiled cards (top first)</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 180, overflow: 'auto', padding: 6, background: '#111827', borderRadius: 8 }}>
          {exiledCards.map((c, idx) => (
            <CardThumb key={c.id} card={c} label={`#${idx + 1}`} />
          ))}
          {exiledCards.length === 0 && <div style={{ color: '#a0aec0' }}>No cards exiled.</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button onClick={onDecline}>Put on bottom</button>
          <button style={primaryButton} onClick={onCast}>Cast for free</button>
        </div>
      </div>
    </div>
  );
}

function CardThumb({ card, label }: { card: KnownCardRef; label?: string }) {
  const img = card.image_uris?.small || card.image_uris?.normal;
  return (
    <div
      style={{ width: 110, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid #374151', background: '#0f172a' }}
      onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, card as any, { prefer: 'right', anchorPadding: 8 })}
      onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
      title={card.name}
    >
      {label && (
        <div style={{ position: 'absolute', top: 4, left: 4, background: '#1f2937', color: '#e5e7eb', padding: '2px 6px', borderRadius: 6, fontSize: 11 }}>
          {label}
        </div>
      )}
      {img ? (
        <img src={img} alt={card.name} style={{ width: '100%', height: 150, objectFit: 'cover' }} />
      ) : (
        <div style={{ width: '100%', height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#e5e7eb', padding: 6, textAlign: 'center', fontSize: 12 }}>
          {card.name}
        </div>
      )}
    </div>
  );
}

const backdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.65)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10004,
};

const modal: React.CSSProperties = {
  background: '#111827',
  color: '#e5e7eb',
  borderRadius: 12,
  padding: 18,
  width: '90%',
  maxWidth: 720,
  maxHeight: '85vh',
  overflow: 'auto',
  border: '1px solid #374151',
  boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
};

const primaryButton: React.CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  padding: '8px 16px',
  borderRadius: 8,
  cursor: 'pointer',
};
