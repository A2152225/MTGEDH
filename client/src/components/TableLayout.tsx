import React, { useMemo } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID } from '../../../shared/src';
import { BattlefieldGrid, type ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';

type PlayerBoard = {
  player: PlayerRef;
  permanents: BattlefieldPermanent[];
};

function polarPos(index: number, total: number, radius: number) {
  const angle = (index / total) * 2 * Math.PI - Math.PI / 2; // start at top, clockwise
  const x = radius * Math.cos(angle);
  const y = radius * Math.sin(angle);
  const rotateDeg = (angle * 180) / Math.PI + 90; // orient boards toward center
  return { x, y, rotateDeg };
}

export function TableLayout(props: {
  players: PlayerRef[];
  permanentsByPlayer: Map<PlayerID, BattlefieldPermanent[]>;
  imagePref: ImagePref;
  isYouPlayer: boolean;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  onBulkCounter?: (ids: string[], deltas: Record<string, number>) => void;
  groupTokensByCounters?: boolean;
}) {
  const { players, permanentsByPlayer, imagePref, isYouPlayer, onRemove, onCounter, onBulkCounter, groupTokensByCounters } = props;

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    return ps.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer]);

  // Build attachment index: which permanents have something attached to them
  const attachedToSet = useMemo(() => {
    const set = new Set<string>();
    for (const arr of permanentsByPlayer.values()) {
      for (const perm of arr) {
        if (perm.attachedTo) set.add(perm.attachedTo);
      }
    }
    return set;
  }, [permanentsByPlayer]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '72vh', border: '1px solid #ddd', borderRadius: 12, background: '#0b0b0b' }}>
      {/* center circle as “table” */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%', width: 160, height: 160, transform: 'translate(-50%, -50%)',
        borderRadius: '50%', background: '#1f1f1f', border: '2px solid #333', color: '#aaa',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12
      }}>
        Table
      </div>

      {ordered.map((pb, i) => {
        const total = ordered.length || 1;
        const { x, y, rotateDeg } = polarPos(i, total, Math.min(window.innerWidth, 900) / 2.4);
        const tokens = pb.permanents.filter(x => (x.card as any)?.type_line === 'Token');
        const nonTokens = pb.permanents.filter(x => (x.card as any)?.type_line !== 'Token');

        return (
          <div
            key={pb.player.id}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: `translate(-50%, -50%) rotate(${rotateDeg}deg)`,
              width: 420,
              pointerEvents: 'auto'
            }}
          >
            <div style={{
              transform: `rotate(${-rotateDeg}deg)`, // keep content upright
              background: 'rgba(255,255,255,0.04)',
              backdropFilter: 'blur(2px)',
              borderRadius: 10,
              padding: 8,
              border: '1px solid rgba(255,255,255,0.08)'
            }}>
              <div style={{ fontWeight: 700, color: '#fff', marginBottom: 6 }}>
                {pb.player.name} {isYouPlayer && pb.player.id === pb.player.id ? '' : ''}
              </div>
              {nonTokens.length > 0 && (
                <BattlefieldGrid
                  perms={nonTokens}
                  imagePref={imagePref}
                  onRemove={isYouPlayer ? onRemove : undefined}
                  onCounter={isYouPlayer ? onCounter : undefined}
                />
              )}
              {tokens.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <TokenGroups
                    tokens={tokens}
                    groupMode={groupTokensByCounters ? 'name+counters+pt+attach' : 'name+pt+attach'}
                    attachedToSet={attachedToSet}
                    onBulkCounter={(ids, deltas) => onBulkCounter?.(ids, deltas)}
                  />
                </div>
              )}
              {pb.permanents.length === 0 && <div style={{ color: '#999', fontSize: 12 }}>Empty</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}