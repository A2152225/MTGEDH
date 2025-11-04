import React, { useMemo, useRef } from 'react';
import type { BattlefieldPermanent, PlayerRef, PlayerID, PlayerZones } from '../../../shared/src';
import { BattlefieldGrid, type ImagePref } from './BattlefieldGrid';
import { TokenGroups } from './TokenGroups';
import { AttachmentLines } from './AttachmentLines';
import { HandGallery } from './HandGallery';

type PlayerBoard = {
  player: PlayerRef;
  permanents: BattlefieldPermanent[];
};

function isLandTypeLine(tl?: string) {
  return /\bland\b/i.test(tl || '');
}

function polarPos(index: number, total: number, radius: number, startAngleRad = Math.PI / 2) {
  // startAngleRad = π/2 puts index 0 at bottom (6 o'clock)
  const angle = startAngleRad + (index / total) * 2 * Math.PI;
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

  // New: table split and reordering
  splitLands?: boolean;
  enableReorderForYou?: boolean;

  // New: your identity and zones to render hand under your board
  you?: PlayerID | null;
  zones?: Record<PlayerID, PlayerZones>;
  showYourHandBelow?: boolean;

  // Existing actions
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  onBulkCounter?: (ids: string[], deltas: Record<string, number>) => void;

  // Targeting support
  highlightPermTargets?: ReadonlySet<string>;
  selectedPermTargets?: ReadonlySet<string>;
  onPermanentClick?: (id: string) => void;
  highlightPlayerTargets?: ReadonlySet<string>;
  selectedPlayerTargets?: ReadonlySet<string>;
  onPlayerClick?: (playerId: string) => void;

  // Hand actions (only for you)
  onPlayLandFromHand?: (cardId: string) => void;
  onCastFromHand?: (cardId: string) => void;
  reasonCannotPlayLand?: (card: { type_line?: string }) => string | null;
  reasonCannotCast?: (card: { type_line?: string }) => string | null;
}) {
  const {
    players, permanentsByPlayer, imagePref, isYouPlayer,
    splitLands = true, enableReorderForYou = false,
    you, zones, showYourHandBelow = true,
    onRemove, onCounter, onBulkCounter,
    highlightPermTargets, selectedPermTargets, onPermanentClick,
    highlightPlayerTargets, selectedPlayerTargets, onPlayerClick,
    onPlayLandFromHand, onCastFromHand, reasonCannotPlayLand, reasonCannotCast
  } = props;

  // Seat order: start at 'you' so index 0 is you; then we place index 0 at bottom via polarPos
  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    const idxYou = you ? ps.findIndex(p => p.id === you) : -1;
    const rotated = idxYou >= 0 ? [...ps.slice(idxYou), ...ps.slice(0, idxYou)] : ps;
    return rotated.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer, you]);

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
        const { x, y, rotateDeg } = polarPos(i, total, Math.min(window.innerWidth, 900) / 2.4, Math.PI / 2);

        const tokens = pb.permanents.filter(x => (x.card as any)?.type_line === 'Token');
        const nonTokens = pb.permanents.filter(x => (x.card as any)?.type_line !== 'Token');

        const lands = splitLands ? nonTokens.filter(x => isLandTypeLine((x.card as any)?.type_line)) : [];
        const others = splitLands ? nonTokens.filter(x => !isLandTypeLine((x.card as any)?.type_line)) : nonTokens;

        const canTargetPlayer = highlightPlayerTargets?.has(pb.player.id) ?? false;
        const isPlayerSelected = selectedPlayerTargets?.has(pb.player.id) ?? false;

        const sectionRef = useRef<HTMLDivElement>(null);

        const isYouThis = you && pb.player.id === you;
        const allowReorderHere = Boolean(isYouThis && enableReorderForYou && !onPermanentClick);

        // Your hand
        const yourHand = (isYouThis && zones?.[you!]?.hand ? (zones![you!].hand as any as Array<{
          id: string; name?: string; type_line?: string;
          image_uris?: { small?: string; normal?: string; art_crop?: string }; faceDown?: boolean;
        }>) : []) || [];

        return (
          <div
            key={pb.player.id}
            style={{
              position: 'absolute',
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: `translate(-50%, -50%) rotate(${rotateDeg}deg)`,
              width: 460,
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

              {others.length > 0 && (
                <>
                  {splitLands && <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Non-lands</div>}
                  <BattlefieldGrid
                    perms={others}
                    imagePref={imagePref}
                    onRemove={isYouPlayer ? onRemove : undefined}
                    onCounter={isYouPlayer ? onCounter : undefined}
                    highlightTargets={highlightPermTargets}
                    selectedTargets={selectedPermTargets}
                    onCardClick={onPermanentClick}
                    enableReorder={allowReorderHere}
                  />
                </>
              )}

              {lands.length > 0 && (
                <>
                  <div style={{ fontSize: 12, opacity: 0.7, margin: '12px 0 6px' }}>Lands</div>
                  <BattlefieldGrid
                    perms={lands}
                    imagePref={imagePref}
                    onRemove={isYouPlayer ? onRemove : undefined}
                    onCounter={isYouPlayer ? onCounter : undefined}
                    highlightTargets={highlightPermTargets}
                    selectedTargets={selectedPermTargets}
                    onCardClick={onPermanentClick}
                    enableReorder={allowReorderHere}
                  />
                </>
              )}

              {tokens.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <TokenGroups
                    tokens={tokens}
                    groupMode='name+pt+attach'
                    attachedToSet={attachedToSet}
                    onBulkCounter={(ids, deltas) => onBulkCounter?.(ids, deltas)}
                    highlightTargets={highlightPermTargets}
                    selectedTargets={selectedPermTargets}
                    onTokenClick={onPermanentClick}
                  />
                </div>
              )}

              {pb.permanents.length === 0 && <div style={{ color: '#999', fontSize: 12 }}>Empty</div>}

              {/* Your hand under your board (table view) */}
              {isYouThis && showYourHandBelow && zones && (
                <div style={{ marginTop: 10, background: '#0b0b0b', border: '1px solid #333', borderRadius: 8, padding: 6 }}>
                  <div style={{ fontSize: 12, color: '#ddd', marginBottom: 6 }}>Your Hand</div>
                  <HandGallery
                    cards={yourHand}
                    imagePref={imagePref}
                    onPlayLand={(cardId) => onPlayLandFromHand?.(cardId)}
                    onCast={(cardId) => onCastFromHand?.(cardId)}
                    reasonCannotPlayLand={(c) => reasonCannotPlayLand ? reasonCannotPlayLand(c) : null}
                    reasonCannotCast={(c) => reasonCannotCast ? reasonCannotCast(c) : null}
                    thumbWidth={95}
                    zoomScale={1}
                    enableReorder={enableReorderForYou && !onPermanentClick}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}