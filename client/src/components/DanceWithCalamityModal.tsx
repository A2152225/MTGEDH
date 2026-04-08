import React, { useMemo, useState } from 'react';

import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { hideCardPreview, showCardPreview } from './CardPreviewLayer';

type DanceCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris' | 'mana_cost' | 'cmc'>;

function getCardImageUrl(card: DanceCard, imagePref: ImagePref): string | undefined {
  return card.image_uris?.[imagePref] || card.image_uris?.normal || card.image_uris?.small;
}

function CardTile(props: {
  card: DanceCard;
  imagePref: ImagePref;
  badge?: string;
  selected?: boolean;
  onClick?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}) {
  const { card, imagePref, badge, selected, onClick, onMoveUp, onMoveDown, canMoveUp, canMoveDown } = props;
  const imageUrl = getCardImageUrl(card, imagePref);

  return (
    <div
      onClick={onClick}
      onMouseEnter={(event) => showCardPreview(event.currentTarget as HTMLElement, card as any, { prefer: 'above', anchorPadding: 0 })}
      onMouseLeave={(event) => hideCardPreview(event.currentTarget as HTMLElement)}
      style={{
        position: 'relative',
        border: selected ? '2px solid #60a5fa' : '1px solid #374151',
        borderRadius: 8,
        background: '#0f172a',
        overflow: 'hidden',
        minHeight: 182,
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: selected ? '0 0 14px rgba(96, 165, 250, 0.25)' : 'none',
      }}
    >
      {badge ? (
        <div style={{
          position: 'absolute',
          top: 6,
          left: 6,
          zIndex: 2,
          background: selected ? '#2563eb' : '#475569',
          color: '#fff',
          borderRadius: 4,
          padding: '2px 8px',
          fontSize: 11,
          fontWeight: 700,
        }}>
          {badge}
        </div>
      ) : null}
      {imageUrl ? (
        <img src={imageUrl} alt={card.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', padding: 8, textAlign: 'center' }}>
          {card.name}
        </div>
      )}
      <div style={{
        position: 'absolute',
        insetInline: 0,
        bottom: 0,
        padding: '10px 8px 8px',
        background: 'linear-gradient(to top, rgba(2,6,23,0.95), rgba(2,6,23,0.15))',
        color: '#fff',
        fontSize: 12,
        zIndex: 2,
      }}>
        <div style={{ fontWeight: 700 }}>{card.name}</div>
        <div style={{ opacity: 0.9 }}>MV {Number(card.cmc || 0)}</div>
      </div>
      {selected && (onMoveUp || onMoveDown) ? (
        <div style={{ position: 'absolute', right: 6, bottom: 48, display: 'flex', gap: 4, zIndex: 2 }}>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onMoveUp?.();
            }}
            disabled={!canMoveUp}
            style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: canMoveUp ? '#2563eb' : '#334155', color: '#fff', cursor: canMoveUp ? 'pointer' : 'not-allowed', opacity: canMoveUp ? 1 : 0.5 }}
          >
            ↑
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onMoveDown?.();
            }}
            disabled={!canMoveDown}
            style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: canMoveDown ? '#2563eb' : '#334155', color: '#fff', cursor: canMoveDown ? 'pointer' : 'not-allowed', opacity: canMoveDown ? 1 : 0.5 }}
          >
            ↓
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DanceWithCalamityModal(props: {
  cardName: string;
  cardImageUrl?: string;
  imagePref: ImagePref;
  exiledCards: DanceCard[];
  totalManaValue: number;
  canContinue: boolean;
  onContinue: () => void;
  onStop: () => void;
}) {
  const { cardName, cardImageUrl, imagePref, exiledCards, totalManaValue, canContinue, onContinue, onStop } = props;

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
        width: 900,
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        padding: 20,
        border: '2px solid #f97316',
        boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          {cardImageUrl ? (
            <img src={cardImageUrl} alt={cardName} style={{ width: 52, height: 52, borderRadius: 8, objectFit: 'cover' }} />
          ) : null}
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: 0, color: '#fff', fontSize: 22 }}>{cardName}</h2>
            <div style={{ color: '#fed7aa', fontSize: 14, marginTop: 4 }}>
              Exile the top card of your library as many times as you choose. If you stop at 13 or less total mana value, you may cast any number of the exiled spells.
            </div>
          </div>
          <div style={{ textAlign: 'right', color: '#e5e7eb', fontSize: 13 }}>
            <div>Total mana value: {totalManaValue}</div>
            <div>Cards exiled: {exiledCards.length}</div>
          </div>
        </div>

        {exiledCards.length > 0 ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
            gap: 10,
            marginBottom: 16,
          }}>
            {exiledCards.map((card, index) => (
              <CardTile
                key={card.id}
                card={card}
                imagePref={imagePref}
                badge={`#${index + 1}`}
              />
            ))}
          </div>
        ) : (
          <div style={{ color: '#cbd5e1', fontSize: 14, marginBottom: 16 }}>
            No cards have been exiled yet.
          </div>
        )}

        <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 16 }}>
          If the total ever goes above 13, the exiled cards stay in exile and you won't cast any of them.
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onContinue}
            disabled={!canContinue}
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 8,
              border: 'none',
              background: canContinue ? '#ea580c' : '#3f3f46',
              color: '#fff',
              fontWeight: 700,
              cursor: canContinue ? 'pointer' : 'not-allowed',
              opacity: canContinue ? 1 : 0.6,
            }}
          >
            Exile the Next Card
          </button>
          <button
            onClick={onStop}
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
            Stop Here
          </button>
        </div>
      </div>
    </div>
  );
}

export function DanceWithCalamityCastModal(props: {
  cardName: string;
  cardImageUrl?: string;
  imagePref: ImagePref;
  exiledCards: DanceCard[];
  spellCards: DanceCard[];
  totalManaValue: number;
  onConfirm: (orderedSpellIds: string[]) => void;
}) {
  const { cardName, cardImageUrl, imagePref, exiledCards, spellCards, totalManaValue, onConfirm } = props;
  const [orderedSpellIds, setOrderedSpellIds] = useState<string[]>([]);
  const spellCardById = useMemo(() => new Map(spellCards.map((card) => [card.id, card])), [spellCards]);

  const toggleSpell = (id: string) => {
    setOrderedSpellIds((prev) => prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id]);
  };

  const moveSpell = (id: string, direction: -1 | 1) => {
    setOrderedSpellIds((prev) => {
      const index = prev.indexOf(id);
      if (index < 0) return prev;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

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
        width: 980,
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
              Choose any number of exiled spells to cast, then set the order they should be offered.
            </div>
          </div>
          <div style={{ textAlign: 'right', color: '#e5e7eb', fontSize: 13 }}>
            <div>Total mana value: {totalManaValue}</div>
            <div>Exiled cards: {exiledCards.length}</div>
          </div>
        </div>

        <div style={{ color: '#cbd5e1', fontSize: 12, marginBottom: 12 }}>
          Lands stay in exile. You can still confirm with no selected spells if you want to cast none of them.
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
          gap: 10,
          marginBottom: 16,
        }}>
          {spellCards.map((card) => {
            const orderIndex = orderedSpellIds.indexOf(card.id);
            return (
              <CardTile
                key={card.id}
                card={card}
                imagePref={imagePref}
                badge={orderIndex >= 0 ? `Cast #${orderIndex + 1}` : undefined}
                selected={orderIndex >= 0}
                onClick={() => toggleSpell(card.id)}
                onMoveUp={orderIndex >= 0 ? () => moveSpell(card.id, -1) : undefined}
                onMoveDown={orderIndex >= 0 ? () => moveSpell(card.id, 1) : undefined}
                canMoveUp={orderIndex > 0}
                canMoveDown={orderIndex >= 0 && orderIndex < orderedSpellIds.length - 1}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => onConfirm(orderedSpellIds)}
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
            Confirm Cast Order
          </button>
        </div>
      </div>
    </div>
  );
}