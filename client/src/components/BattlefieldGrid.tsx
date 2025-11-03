import React from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';

export type ImagePref = 'small' | 'normal' | 'art_crop';

export function BattlefieldGrid(props: {
  perms: BattlefieldPermanent[];
  imagePref: ImagePref;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
}) {
  const { perms, imagePref, onRemove, onCounter } = props;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
      {perms.map(p => {
        const kc = p.card as KnownCardRef;
        const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small;
        const name = kc?.name || p.id;
        const counters = p.counters || {};
        return (
          <div key={p.id} style={{ position: 'relative', border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden', background: '#f6f6f6' }}>
            {img ? (
              <img src={img} alt={name} style={{ width: '100%', display: 'block', aspectRatio: '0.72', objectFit: 'cover' }} />
            ) : (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, padding: 8 }}>{name}</div>
            )}
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, background: 'linear-gradient(transparent, rgba(0,0,0,0.6))', color: '#fff', fontSize: 12, padding: '6px 8px' }}>
              <div title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              {Object.keys(counters).length > 0 && (
                <div style={{ marginTop: 2 }}>
                  {Object.entries(counters).map(([k, v]) => <span key={k} style={{ marginRight: 8 }}>{k}:{v}</span>)}
                </div>
              )}
            </div>
            {(onCounter || onRemove) && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {onCounter && (
                  <>
                    <button onClick={() => onCounter(p.id, '+1/+1', +1)} title="+1/+1 +1">+1</button>
                    <button onClick={() => onCounter(p.id, '+1/+1', -1)} title="+1/+1 -1">-1</button>
                  </>
                )}
                {onRemove && <button onClick={() => onRemove(p.id)} title="Remove">✕</button>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}