import React, { useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type FatesealCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export function FatesealModal(props: {
  opponentName: string;
  cards: FatesealCard[];
  imagePref: ImagePref;
  sourceName: string;
  onCancel: () => void;
  onConfirm: (payload: { keepTopOrder: string[]; bottomOrder: string[] }) => void;
}) {
  const { opponentName, cards, imagePref, sourceName, onCancel, onConfirm } = props;
  const [keep, setKeep] = useState<string[]>(() => cards.map(c => c.id));
  const [bottom, setBottom] = useState<string[]>([]);

  const cardById = useMemo(() => new Map(cards.map(c => [c.id, c])), [cards]);

  const moveOne = (id: string, toBottom: boolean) => {
    if (toBottom) {
      setKeep(prev => prev.filter(x => x !== id));
      setBottom(prev => [...prev, id]);
    } else {
      setBottom(prev => prev.filter(x => x !== id));
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

  const CardBox = (p: { id: string }) => {
    const c = cardById.get(p.id)!;
    const img = c.image_uris?.[imagePref] || c.image_uris?.normal || c.image_uris?.small;
    return (
      <div
        key={c.id}
        onMouseEnter={(e) => showCardPreview(e.currentTarget as HTMLElement, c as any, { prefer: 'above', anchorPadding: 0 })}
        onMouseLeave={(e) => hideCardPreview(e.currentTarget as HTMLElement)}
        style={{ position: 'relative', border: '1px solid #333', borderRadius: 6, background: '#111', height: 140, overflow: 'hidden' }}
        title={c.name}
      >
        {img ? (
          <img src={img} alt={c.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12 }}>
            {c.name}
          </div>
        )}
      </div>
    );
  };

  const confirm = () => {
    onConfirm({ keepTopOrder: keep, bottomOrder: bottom });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 800, maxWidth: '95vw', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>Fateseal - {opponentName}'s Library ({sourceName})</h3>
          <div>
            <button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</button>
            <button onClick={confirm}>Confirm</button>
          </div>
        </div>
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
                    <button onClick={() => moveOne(id, true)} title="Move to bottom">→</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div />
          <div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>Bottom (bottom→up order)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6 }}>
              {bottom.map(id => (
                <div key={id} style={{ position: 'relative' }}>
                  <CardBox id={id} />
                  <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button onClick={() => setBottom(prev => bump(prev, id, -1))} title="Up">↑</button>
                    <button onClick={() => setBottom(prev => bump(prev, id, +1))} title="Down">↓</button>
                    <button onClick={() => moveOne(id, false)} title="Move to top">←</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FatesealModal;
