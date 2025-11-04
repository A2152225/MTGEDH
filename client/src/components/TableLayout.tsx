import React, { useMemo, useRef } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID } from '../../../shared/src';
import { BattlefieldGrid, type ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';
import { AttachmentLines } from './AttachmentLines';

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
  // Targeting support
  highlightPermTargets?: ReadonlySet<string>;
  selectedPermTargets?: ReadonlySet<string>;
  onPermanentClick?: (id: string) => void;
  highlightPlayerTargets?: ReadonlySet<string>;
  selectedPlayerTargets?: ReadonlySet<string>;
  onPlayerClick?: (playerId: string) => void;
}) {
  const {
    players, permanentsByPlayer, imagePref, isYouPlayer, onRemove, onCounter, onBulkCounter, groupTokensByCounters,
    highlightPermTargets, selectedPermTargets, onPermanentClick,
    highlightPlayerTargets, selectedPlayerTargets, onPlayerClick
  } = props;

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    return ps.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer]);

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

        const canTargetPlayer = highlightPlayerTargets?.has(pb.player.id) ?? false;
        const isPlayerSelected = selectedPlayerTargets?.has(pb.player.id) ?? false;

        const sectionRef = useRef<HTMLDivElement>(null);

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
            <div
              ref={sectionRef}
              style={{
                position: 'relative',
                transform: `rotate(${-rotateDeg}deg)`,
                background: 'rgba(255,255,255,0.04)',
                backdropFilter: 'blur(2px)',
                borderRadius: 10,
                padding: 8,
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <div style={{ fontWeight: 700, color: '#fff' }}>
                  {pb.player.name}
                </div>
                {onPlayerClick && (
                  <button
                    onClick={() => onPlayerClick(pb.player.id)}
                    disabled={!canTargetPlayer}
                    style={{
                      border: '1px solid',
                      borderColor: isPlayerSelected ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#555',
                      color: isPlayerSelected ? '#2b6cb0' : canTargetPlayer ? '#38a169' : '#888',
                      background: 'transparent',
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontSize: 12
                    }}
                    title={canTargetPlayer ? 'Target player' : 'Not a valid player target'}
                  >
                    {isPlayerSelected ? 'Selected' : 'Target'}
                  </button>
                )}
              </div>

              {/* Attachments overlay */}
              <AttachmentLines containerRef={sectionRef as any} permanents={pb.permanents} opacity={0.5} />

              {nonTokens.length > 0 && (
                <BattlefieldGrid
                  perms={nonTokens}
                  imagePref={imagePref}
                  onRemove={isYouPlayer ? onRemove : undefined}
                  onCounter={isYouPlayer ? onCounter : undefined}
                  highlightTargets={highlightPermTargets}
                  selectedTargets={selectedPermTargets}
                  onCardClick={onPermanentClick}
                />
              )}

              {tokens.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <TokenGroups
                    tokens={tokens}
                    groupMode={groupTokensByCounters ? 'name+counters+pt+attach' : 'name+pt+attach'}
                    attachedToSet={attachedToSet}
                    onBulkCounter={(ids, deltas) => onBulkCounter?.(ids, deltas)}
                    highlightTargets={highlightPermTargets}
                    selectedTargets={selectedPermTargets}
                    onTokenClick={onPermanentClick}
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