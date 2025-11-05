import React, { useMemo, useState } from 'react';
import type { KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

export type PeekCard = Pick<KnownCardRef, 'id' | 'name' | 'type_line' | 'oracle_text' | 'image_uris'>;

export function ScrySurveilModal(props: {
  mode: 'scry' | 'surveil';
  cards: PeekCard[]; // current top→down order
  imagePref: ImagePref;
  onCancel: () => void;
  onConfirm: (payload: { keepTopOrder: string[]; bottomOrder?: string[]; toGraveyard?: string[] }) => void;
}) {
  const { mode, cards, imagePref, onCancel, onConfirm } = props;
  const [keep, setKeep] = useState<string[]>(() => cards.map(c => c.id)); // start with all kept on top
  const [other, setOther] = useState<string[]>([]); // bottom for scry, GY for surveil

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
    if (mode === 'scry') onConfirm({ keepTopOrder: keep, bottomOrder: other });
    else onConfirm({ keepTopOrder: keep, toGraveyard: other });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{ background: '#fff', borderRadius: 8, width: 800, maxWidth: '95vw', padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>{mode === 'scry' ? 'Scry' : 'Surveil'}</h3>
          <div>
            <button onClick={onCancel} style={{ marginRight: 8 }}>Cancel</button>
            <button onClick={confirm}>Confirm</button>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 1fr', gap: 12, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>{mode === 'scry' ? 'Keep on top (top→down)' : 'Keep on top (top→down)'}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(120px,1fr))', gap: 6 }}>
              {keep.map(id => (
                <div key={id} style={{ position: 'relative' }}>
                  <CardBox id={id} />
                  <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                    <button onClick={() => setKeep(prev => bump(prev, id, -1))} title="Up">↑</button>
                    <button onClick={() => setKeep(prev => bump(prev, id, +1))} title="Down">↓</button>
                    <button onClick={() => moveOne(id, true)} title={mode === 'scry' ? 'Move to bottom' : 'Move to graveyard'}>→</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div />
          <div>
            <div style={{ fontSize: 12, marginBottom: 6 }}>{mode === 'scry' ? 'Bottom (bottom→up order)' : 'To Graveyard (newest at bottom)'}</div>
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
          Tip: In Scry, order in “Bottom” is bottom-most on the right; in Surveil, “To Graveyard” order sets arrival order (rightmost last).
        </div>
      </div>
    </div>
  );
}