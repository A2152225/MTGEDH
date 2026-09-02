import React, { useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { getPrimaryCardImageUrl } from '../utils/cardImages';

export type PeekCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export function ScrySurveilModal(props: {
  mode: 'scry' | 'surveil' | 'bottom_order';
  cards: PeekCard[]; // current top→down order
  imagePref: ImagePref;
  onCancel: () => void;
  onConfirm: (payload: { keepTopOrder: string[]; bottomOrder?: string[]; toGraveyard?: string[] }) => void;
}) {
  const { mode, cards, imagePref, onCancel, onConfirm } = props;
  const isBottomOrder = mode === 'bottom_order';
  const [keep, setKeep] = useState<string[]>(() => (isBottomOrder ? [] : cards.map(c => c.id)));
  const [other, setOther] = useState<string[]>(() => (isBottomOrder ? cards.map(c => c.id) : []));

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);

  const moveOne = (id: string, toOther: boolean) => {
    if (toOther) {
      setKeep(prev => prev.filter(x => x !== id));
      setOther(prev => [...prev, id]);
    } else {
      setOther(prev => prev.filter(x => x !== id));
      setKeep(prev => [...prev, id]);
    }
  };
  const bump = (arr: string[], id: string, dir: -1 | 1) => {
    const idx = arr.indexOf(id);
    if (idx < 0) return arr;
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return arr;
    const next = arr.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    return next;
  };

  const CardBox = (p: { id: string; width?: number; height?: number }) => {
    const c = cardById.get(p.id);
    const name = String(c?.name || p.id);
    const img = c ? getPrimaryCardImageUrl(c, imagePref) : null;
    const width = p.width ?? undefined;
    const height = p.height ?? 140;
    return (
      <div
        key={p.id}
        onMouseEnter={(e) => c && showCardPreview(e.currentTarget as HTMLElement, c as any, { prefer: 'above', anchorPadding: 0 })}
        onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
        style={{
          position: 'relative',
          border: '1px solid #333',
          borderRadius: 6,
          background: '#111',
          width: width ?? '100%',
          height,
          overflow: 'hidden',
        }}
        title={name}
      >
        {img ? (
          <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : null}
        <div style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          padding: '4px 6px',
          background: img ? 'rgba(0,0,0,0.72)' : 'transparent',
          color: '#eee',
          fontSize: 11,
          lineHeight: 1.2,
          textAlign: 'center',
          display: 'flex',
          alignItems: img ? 'flex-end' : 'center',
          justifyContent: 'center',
          inset: img ? undefined : 0,
          height: img ? undefined : '100%',
          wordBreak: 'break-word',
        }}>
          {name}
        </div>
      </div>
    );
  };

  const confirm = () => {
    if (mode === 'surveil') onConfirm({ keepTopOrder: keep, toGraveyard: other });
    else if (isBottomOrder) onConfirm({ keepTopOrder: [], bottomOrder: other });
    else onConfirm({ keepTopOrder: keep, bottomOrder: other });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: '#fff',
        borderRadius: 8,
        width: isBottomOrder ? 'min(1600px, 98vw)' : 800,
        maxWidth: '98vw',
        padding: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ margin: 0 }}>{mode === 'surveil' ? 'Surveil' : mode === 'scry' ? 'Scry' : 'Put remaining cards on the bottom'}</h3>
          <div>
            <button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</button>
            <button onClick={confirm}>Confirm</button>
          </div>
        </div>
        {isBottomOrder ? (
          <>
            <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
              Left → right: first onto the bottom, then deeper. The rightmost card is the bottom-most. Use ← → to reorder.
            </div>
            <div style={{ marginTop: 12, overflowX: 'auto', overflowY: 'hidden', paddingBottom: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'row', flexWrap: 'nowrap', gap: 8, minWidth: 'min-content' }}>
                {other.map((id, idx) => {
                  const name = String(cardById.get(id)?.name || id);
                  return (
                    <div key={id} style={{ flex: '0 0 128px', width: 128 }}>
                      <CardBox id={id} width={128} height={168} />
                      <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginTop: 4 }}>
                        <button type="button" onClick={() => setOther(prev => bump(prev, id, -1))} disabled={idx === 0} title="Move left">←</button>
                        <button type="button" onClick={() => setOther(prev => bump(prev, id, +1))} disabled={idx === other.length - 1} title="Move right">→</button>
                      </div>
                      <div
                        style={{ fontSize: 11, textAlign: 'center', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        title={name}
                      >
                        {name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>Keep on top (top→down)</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6 }}>
                  {keep.map(id => (
                    <div key={id} style={{ position: 'relative' }}>
                      <CardBox id={id} />
                      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                        <button onClick={() => setKeep(prev => bump(prev, id, -1))} title="Up">↑</button>
                        <button onClick={() => setKeep(prev => bump(prev, id, +1))} title="Down">↓</button>
                        <button onClick={() => moveOne(id, true)} title={mode === 'surveil' ? 'Move to graveyard' : 'Move to bottom'}>→</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div />
              <div>
                <div style={{ fontSize: 12, marginBottom: 6 }}>{mode === 'surveil' ? 'To Graveyard (newest at bottom)' : 'Bottom (bottom→up order)'}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6 }}>
                  {other.map(id => (
                    <div key={id} style={{ position: 'relative' }}>
                      <CardBox id={id} />
                      <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                        <button onClick={() => setOther(prev => bump(prev, id, -1))} title="Up">↑</button>
                        <button onClick={() => setOther(prev => bump(prev, id, +1))} title="Down">↓</button>
                        <button onClick={() => moveOne(id, false)} title="Move back">←</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>
              Tip: In “Bottom”, order is bottom-most on the right; in Surveil, “To Graveyard” order sets arrival order (rightmost last).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
