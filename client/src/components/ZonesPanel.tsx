import React from 'react';
import type { ClientGameView, KnownCardRef, PlayerID } from '../../../shared/src';
import { socket } from '../socket';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';

function CardThumb(props: { card: Partial<KnownCardRef> & { id: string; name?: string; image_uris?: any } }) {
  const { card } = props;
  const img = (card as any)?.image_uris?.small || (card as any)?.image_uris?.normal;
  const name = (card as any)?.name || card.id;
  return (
    <div
      onMouseEnter={(e) => { showCardPreview(e.currentTarget as HTMLElement, card as any, { prefer: 'above', anchorPadding: 0 }); }}
      onMouseLeave={() => hideCardPreview()}
      style={{
        width: 60,
        height: 84,
        borderRadius: 6,
        overflow: 'hidden',
        border: '1px solid #ccc',
        background: '#222',
        display: 'inline-block'
      }}
      title={name}
    >
      {img ? (
        <img src={img} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ color: '#fff', fontSize: 10, padding: 4, lineHeight: 1.1 }}>{name}</div>
      )}
    </div>
  );
}

export function ZonesPanel(props: {
  view: ClientGameView;
  you: PlayerID | null;
  isYouPlayer: boolean;
}) {
  const { view, you, isYouPlayer } = props;

  const quickDraw = (pid: PlayerID) => socket.emit('drawCards', { gameId: view.id, count: 1 });
  const quickShuffle = (pid: PlayerID) => socket.emit('shuffleLibrary', { gameId: view.id });

  return (
    <div style={{ marginTop: 16 }}>
      <h3>Zones</h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {view.players.map(p => {
          const z = view.zones?.[p.id];
          const gy = (z?.graveyard ?? []) as any as Array<Partial<KnownCardRef> & { id: string }>;
          const ex = (z?.exile ?? []) as any as Array<Partial<KnownCardRef> & { id: string }>;
          const libCount = z?.libraryCount ?? 0;
          const canAct = isYouPlayer && you === p.id;

          return (
            <div key={p.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Life: {view.life[p.id] ?? '-'}</div>
              </div>

              {/* Library */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                <div style={{
                  width: 40, height: 56, borderRadius: 6, border: '1px solid #444',
                  background: 'repeating-linear-gradient(135deg, #333, #333 4px, #222 4px, #222 8px)'
                }} title="Library" />
                <div>Library: {libCount}</div>
                {canAct && (
                  <>
                    <button onClick={() => quickDraw(p.id as PlayerID)}>Draw 1</button>
                    <button onClick={() => quickShuffle(p.id as PlayerID)}>Shuffle</button>
                  </>
                )}
              </div>

              {/* Graveyard */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Graveyard ({z?.graveyardCount ?? (gy?.length ?? 0)}):</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {gy.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Empty</div>}
                  {gy.map(c => <CardThumb key={c.id} card={c as any} />)}
                </div>
              </div>

              {/* Exile */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>Exile ({(ex?.length ?? 0)}):</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ex.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Empty</div>}
                  {ex.map(c => <CardThumb key={c.id} card={c as any} />)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}