import React, { useMemo, useState } from 'react';

import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { hideCardPreview, showCardPreview } from './CardPreviewLayer';

type VaultCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export function LimDulsVaultModal(props: {
  cards: VaultCard[];
  cardName: string;
  cardImageUrl?: string;
  imagePref: ImagePref;
  currentLife: number;
  totalLifePaid: number;
  onContinue: (orderedIds: string[]) => void;
  onFinish: (orderedIds: string[]) => void;
}) {
  const { cards, cardName, cardImageUrl, imagePref, currentLife, totalLifePaid, onContinue, onFinish } = props;
  const [orderedIds, setOrderedIds] = useState<string[]>(() => cards.map((card) => card.id));

  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);

  const moveCard = (id: string, direction: -1 | 1) => {
    setOrderedIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const nextIdx = idx + direction;
      if (nextIdx < 0 || nextIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
      return next;
    });
  };

  const canContinue = currentLife > 1;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.78)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        background: '#161827',
        borderRadius: 12,
        width: 840,
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: 20,
        border: '2px solid #60a5fa',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {cardImageUrl ? (
            <img src={cardImageUrl} alt={cardName} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover' }} />
          ) : null}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 22 }}>{cardName}</h2>
            <div style={{ color: '#bfdbfe', fontSize: 14, marginTop: 4 }}>
              Reorder these cards. Choose whether to pay 1 life and put them on the bottom, or keep them as your final five and shuffle the rest underneath.
            </div>
          </div>
          <div style={{ textAlign: 'right', color: '#e5e7eb', fontSize: 13 }}>
            <div>Life: {currentLife}</div>
            <div>Paid so far: {totalLifePaid}</div>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}>
          {orderedIds.map((id, index) => {
            const card = cardById.get(id);
            if (!card) return null;
            const imageUrl = card.image_uris?.[imagePref] || card.image_uris?.normal || card.image_uris?.small;

            return (
              <div
                key={id}
                onMouseEnter={(event) => showCardPreview(event.currentTarget as HTMLElement, card as any, { prefer: 'above', anchorPadding: 0 })}
                onMouseLeave={(event) => hideCardPreview(event.currentTarget as HTMLElement)}
                style={{
                  position: 'relative',
                  border: index === 0 ? '2px solid #22c55e' : '1px solid #374151',
                  borderRadius: 8,
                  background: '#0f172a',
                  overflow: 'hidden',
                  minHeight: 182,
                  boxShadow: index === 0 ? '0 0 14px rgba(34, 197, 94, 0.25)' : 'none',
                }}
              >
                <div style={{
                  position: 'absolute',
                  top: 6,
                  left: 6,
                  zIndex: 2,
                  background: index === 0 ? '#22c55e' : '#475569',
                  color: '#fff',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 700,
                }}>
                  #{index + 1}
                </div>
                {imageUrl ? (
                  <img src={imageUrl} alt={card.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 8, textAlign: 'center' }}>
                    {card.name}
                  </div>
                )}
                <div style={{ position: 'absolute', right: 6, bottom: 6, display: 'flex', gap: 4, zIndex: 2 }}>
                  <button
                    onClick={() => moveCard(id, -1)}
                    disabled={index === 0}
                    style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: index === 0 ? '#334155' : '#2563eb', color: '#fff', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.5 : 1 }}
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveCard(id, 1)}
                    disabled={index === orderedIds.length - 1}
                    style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: index === orderedIds.length - 1 ? '#334155' : '#2563eb', color: '#fff', cursor: index === orderedIds.length - 1 ? 'not-allowed' : 'pointer', opacity: index === orderedIds.length - 1 ? 0.5 : 1 }}
                  >
                    ↓
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 16 }}>
          The displayed order is top to bottom if you keep these cards. If you pay 1 life, the cards move to the bottom preserving this same relative order, so the last card shown becomes the bottom-most card.
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => onContinue(orderedIds)}
            disabled={!canContinue}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 8,
              border: 'none',
              background: canContinue ? '#b91c1c' : '#3f3f46',
              color: '#fff',
              fontWeight: 700,
              cursor: canContinue ? 'pointer' : 'not-allowed',
              opacity: canContinue ? 1 : 0.6,
            }}
          >
            Pay 1 Life and Put on Bottom
          </button>
          <button
            onClick={() => onFinish(orderedIds)}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 8,
              border: 'none',
              background: '#2563eb',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Keep These and Finish
          </button>
        </div>
      </div>
    </div>
  );
}