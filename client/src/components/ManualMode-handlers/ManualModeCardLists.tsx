// Origin parent: client/src/components/ManualModeControl.tsx
// Cluster: hover-preview card lists and drag-reorder piles for Manual Mode.
// Public entry symbols: ManualCardInfo, ManualModeObjectPicker, ManualModePeekPiles.

import React, { useRef, useState } from 'react';
import { colors, fontSize, radii, spacing } from '../../theme';
import { hideCardPreview, showCardPreview } from '../CardPreviewLayer';
import { getPrimaryCardImageUrl } from '../../utils/cardImages';

export type ManualCardInfo = {
  id: string;
  name: string;
  label?: string;
  zone?: string;
  type_line?: string;
  image_uris?: { small?: string; normal?: string; art_crop?: string };
  card_faces?: Array<{ name?: string; image_uris?: { small?: string; normal?: string; art_crop?: string } }>;
  hidden?: boolean;
};

type PileId = 'keep' | 'other';

const listBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 220,
  overflow: 'auto',
  padding: 4,
  borderRadius: radii.sm,
  border: `1px solid ${colors.border}`,
  background: '#111',
};

const pileLabel: React.CSSProperties = {
  fontSize: fontSize.xxs,
  color: colors.textSecondary,
  fontWeight: 700,
  marginBottom: 4,
};

function previewOf(card: ManualCardInfo) {
  if (card.hidden) return null;
  if (!getPrimaryCardImageUrl(card, 'small') && !getPrimaryCardImageUrl(card, 'normal')) return null;
  return { name: card.name, type_line: card.type_line, image_uris: card.image_uris, card_faces: card.card_faces };
}

function bindHover(card: ManualCardInfo) {
  return {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      const preview = previewOf(card);
      if (!preview) return;
      showCardPreview(e.currentTarget, preview, { prefer: 'left', anchorPadding: 8 });
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      hideCardPreview(e.currentTarget);
    },
  };
}

function CardRow(props: {
  card: ManualCardInfo;
  selected?: boolean;
  highlighted?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  trailing?: React.ReactNode;
}): React.ReactElement {
  const thumb = props.card.hidden ? null : getPrimaryCardImageUrl(props.card, 'small');
  return (
    <div
      {...bindHover(props.card)}
      draggable={props.draggable === true}
      onDragStart={props.draggable ? (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', props.card.id);
        props.onDragStart?.();
      } : undefined}
      onDragEnd={props.draggable ? props.onDragEnd : undefined}
      onDragOver={props.onDragOver}
      onDrop={props.onDrop}
      onClick={props.onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minHeight: 40,
        padding: '4px 6px',
        borderRadius: radii.sm,
        border: props.highlighted
          ? `1px dashed ${colors.accent}`
          : props.selected ? `1px solid ${colors.accent}` : `1px solid ${colors.borderSubtle}`,
        background: props.selected ? colors.accentSoft : 'transparent',
        cursor: props.draggable ? 'grab' : props.onClick ? 'pointer' : 'default',
        color: colors.textPrimary,
        fontSize: fontSize.sm,
      }}
    >
      {thumb ? (
        <img
          src={thumb}
          alt=""
          draggable={false}
          style={{ width: 26, height: 36, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 26,
            height: 36,
            borderRadius: 3,
            background: colors.surfaceTransparent,
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
          {props.card.hidden ? 'Hidden card' : (props.card.name || 'Card')}
        </div>
        {props.card.label && (
          <div style={{ fontSize: fontSize.xxs, color: colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {props.card.label}
          </div>
        )}
      </div>
      {props.trailing}
    </div>
  );
}

export function ManualModeObjectPicker(props: {
  cards: ManualCardInfo[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  emptyLabel?: string;
}): React.ReactElement {
  const multiple = props.multiple !== false;
  const toggle = (id: string) => {
    if (!multiple) {
      props.onChange(props.selectedIds[0] === id ? [] : [id]);
      return;
    }
    props.onChange(
      props.selectedIds.includes(id)
        ? props.selectedIds.filter((entry) => entry !== id)
        : [...props.selectedIds, id],
    );
  };

  if (props.cards.length === 0) {
    return (
      <div style={{ ...listBox, color: colors.textMuted, fontSize: fontSize.xs }}>
        {props.emptyLabel || 'No cards in view.'}
      </div>
    );
  }

  return (
    <div style={listBox}>
      {props.cards.map((card) => (
        <CardRow
          key={`${card.zone || 'z'}-${card.id}`}
          card={card}
          selected={props.selectedIds.includes(card.id)}
          onClick={() => toggle(card.id)}
        />
      ))}
    </div>
  );
}

function bump(ids: string[], id: string, dir: -1 | 1): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return ids;
  const nextIndex = index + dir;
  if (nextIndex < 0 || nextIndex >= ids.length) return ids;
  const next = ids.slice();
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

const iconBtn: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  background: colors.surfaceTransparent,
  color: colors.textPrimary,
  borderRadius: radii.sm,
  padding: '2px 6px',
  cursor: 'pointer',
  fontSize: fontSize.xxs,
  lineHeight: 1.2,
};

export function ManualModePeekPiles(props: {
  cards: ManualCardInfo[];
  keepIds: string[];
  otherIds?: string[];
  onKeepChange: (ids: string[]) => void;
  onOtherChange?: (ids: string[]) => void;
  keepLabel: string;
  otherLabel?: string;
  reorderable?: boolean;
}): React.ReactElement {
  const reorderable = props.reorderable !== false;
  const hasOther = Boolean(props.otherLabel && props.onOtherChange);
  const cardById = new Map(props.cards.map((card) => [card.id, card]));
  const drag = useRef<{ pile: PileId; id: string } | null>(null);
  const [over, setOver] = useState<{ pile: PileId; id: string | null } | null>(null);

  const idsOf = (pile: PileId) => (pile === 'keep' ? props.keepIds : (props.otherIds || []));
  const setPile = (pile: PileId, ids: string[]) => {
    if (pile === 'keep') props.onKeepChange(ids);
    else props.onOtherChange?.(ids);
  };

  const dropOn = (destPile: PileId, beforeId: string | null) => {
    const source = drag.current;
    if (!source) return;
    const fromIds = idsOf(source.pile).filter((id) => id !== source.id);
    if (source.pile !== destPile) setPile(source.pile, fromIds);
    const dest = (source.pile === destPile ? fromIds : idsOf(destPile).filter((id) => id !== source.id)).slice();
    const found = beforeId ? dest.indexOf(beforeId) : -1;
    dest.splice(found < 0 ? dest.length : found, 0, source.id);
    setPile(destPile, dest);
    drag.current = null;
    setOver(null);
  };

  const renderPile = (pile: PileId, ids: string[], label: string) => (
    <div
      onDragOver={(e) => {
        if (!reorderable) return;
        e.preventDefault();
        setOver({ pile, id: null });
      }}
      onDrop={(e) => {
        e.preventDefault();
        dropOn(pile, null);
      }}
      style={{
        ...listBox,
        minHeight: 52,
        outline: over?.pile === pile && !over.id ? `1px dashed ${colors.accent}` : undefined,
      }}
    >
      <div style={pileLabel}>{label}</div>
      {ids.length === 0 && (
        <div style={{ fontSize: fontSize.xxs, color: colors.textMuted, padding: '6px 4px' }}>
          {reorderable ? 'Drop cards here' : 'None'}
        </div>
      )}
      {ids.map((id, index) => {
        const card = cardById.get(id) || { id, name: id };
        return (
          <CardRow
            key={`${pile}-${id}`}
            card={card}
            highlighted={over?.pile === pile && over.id === id}
            draggable={reorderable}
            onDragStart={() => { drag.current = { pile, id }; }}
            onDragEnd={() => {
              window.setTimeout(() => {
                drag.current = null;
                setOver(null);
              }, 0);
            }}
            onDragOver={(e) => {
              if (!reorderable) return;
              e.preventDefault();
              e.stopPropagation();
              setOver({ pile, id });
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              dropOn(pile, id);
            }}
            trailing={reorderable ? (
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                <button type="button" style={iconBtn} title="Move up" onClick={(e) => { e.stopPropagation(); setPile(pile, bump(ids, id, -1)); }}>↑</button>
                <button type="button" style={iconBtn} title="Move down" onClick={(e) => { e.stopPropagation(); setPile(pile, bump(ids, id, 1)); }}>↓</button>
                {hasOther && (
                  <button
                    type="button"
                    style={iconBtn}
                    title={pile === 'keep' ? 'Move to other pile' : 'Keep on top'}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPile(pile, ids.filter((entry) => entry !== id));
                      const dest = pile === 'keep' ? 'other' : 'keep';
                      setPile(dest, [...idsOf(dest), id]);
                    }}
                  >
                    {pile === 'keep' ? '→' : '←'}
                  </button>
                )}
                <span style={{ fontSize: fontSize.xxs, color: colors.textMuted, padding: '0 2px' }}>{index + 1}</span>
              </div>
            ) : undefined}
          />
        );
      })}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: spacing.sm }}>
      {renderPile('keep', props.keepIds, props.keepLabel)}
      {hasOther && renderPile('other', props.otherIds || [], props.otherLabel || 'Other')}
    </div>
  );
}
