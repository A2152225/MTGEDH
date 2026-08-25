// Origin parent: client/src/components/TableLayout.tsx
// Cluster moved: player-seat header row (name, counters, designations, decks).
// Public entry symbols: TableLayoutPlayerSeatHeader.

import React from 'react';
import type {
  CommanderInfo,
  GameID,
  ManaPool,
  PlayerID,
  PlayerRef,
  PlayerZones,
} from '../../../../shared/src';
import { CommanderDamagePopover } from '../CommanderDamagePopover';
import { FloatingManaPool } from '../FloatingManaPool';
import { getTotalFloatingMana, type PlayerBoard } from './tableLayoutGeometry';

export type TableLayoutPlayerSeatHeaderProps = {
  pb: PlayerBoard;
  speed?: Record<PlayerID, number>;
  enduringStory?: Record<PlayerID, boolean>;
  players: PlayerRef[];
  commanderDamage?: Record<PlayerID, Record<string, number>>;
  commandZone?: Record<PlayerID, CommanderInfo | undefined>;
  format?: string;
  lifeVal: number;
  poisonVal: number;
  xpVal: number;
  energyVal: number;
  getSeatManaPool: (playerId: string, isYouSeat: boolean) => ManaPool | null;
  isYouThis: any;
  externalDeckMgrAnchorEl?: HTMLElement | null;
  decksBtnRef: any;
  setDeckMgrOpen: (open: boolean) => void;
  zObj?: PlayerZones;
  gameId?: GameID;
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  cityBlessing?: Record<PlayerID, boolean>;
  anyPlayerHasCityBlessing?: boolean;
  onPlayerClick?: (pid: string) => void;
  canTargetPlayer: boolean;
  isPlayerSelected: boolean;
};

export function TableLayoutPlayerSeatHeader({
  pb,
  speed,
  enduringStory,
  players,
  commanderDamage,
  commandZone,
  format,
  lifeVal,
  poisonVal,
  xpVal,
  energyVal,
  getSeatManaPool,
  isYouThis,
  externalDeckMgrAnchorEl,
  decksBtnRef,
  setDeckMgrOpen,
  zObj,
  gameId,
  monarch,
  initiative,
  cityBlessing,
  anyPlayerHasCityBlessing,
  onPlayerClick,
  canTargetPlayer,
  isPlayerSelected,
}: TableLayoutPlayerSeatHeaderProps) {
  return (
    <>
                        {/* Header row */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: 10,
                            paddingBottom: 8,
                            borderBottom: '1px solid rgba(255,255,255,0.08)'
                          }}
                        >
                          <div
                            style={{
                              fontWeight: 600,
                              color: '#fff',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12
                            }}
                          >
                            <span style={{ fontSize: 14 }}>{pb.player.name}</span>
                            {speed?.[pb.player.id] !== undefined ? (
                              <span title="Speed" style={{ fontSize: 12, color: '#fbbf24' }}>🏁 {speed[pb.player.id]}</span>
                            ) : null}
                            {enduringStory?.[pb.player.id] ? (
                              <span title="Enduring story" style={{ fontSize: 12, color: '#c4b5fd' }}>📖 Story</span>
                            ) : null}
                            {/* Enhanced Counter Display Panel */}
                            <div
                              style={{
                                display: 'flex',
                                gap: 10,
                                fontSize: 12,
                                background: 'linear-gradient(135deg, rgba(0,0,0,0.5) 0%, rgba(20,20,30,0.6) 100%)',
                                padding: '6px 12px',
                                borderRadius: 6,
                                border: '1px solid rgba(255,255,255,0.1)',
                                boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.3)'
                              }}
                            >
                              {/* Life Counter - hover/tap for commander damage breakdown in Commander games */}
                              <CommanderDamagePopover
                                victimPlayerId={pb.player.id}
                                victimPlayerName={pb.player.name}
                                players={players}
                                commanderDamage={commanderDamage}
                                commandZone={commandZone}
                                format={format}
                              >
                                <span
                                  style={{
                                    color: lifeVal <= 10 ? '#ef4444' : lifeVal <= 20 ? '#fbbf24' : '#4ade80',
                                    fontWeight: 700,
                                    fontSize: 14,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 3,
                                  }}
                                >
                                  ❤️ {lifeVal}
                                </span>
                              </CommanderDamagePopover>
                              {/* Separator */}
                              <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10 }}>|</span>
                              {/* Poison Counter - Critical warning at 7+ */}
                              <span
                                aria-label={`Poison Counters: ${poisonVal}`}
                                title={`Poison Counters (Lose at 10)`}
                                style={{
                                  color: poisonVal >= 7 ? '#dc2626' : poisonVal > 0 ? '#f87171' : 'rgba(136,136,136,0.6)',
                                  fontWeight: poisonVal > 0 ? 700 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3,
                                  animation: poisonVal >= 7 ? 'pulse 1.5s infinite' : 'none'
                                }}
                              >
                                ☠️ {poisonVal}{poisonVal >= 7 && <span style={{ fontSize: 9, marginLeft: 2 }}>⚠</span>}
                              </span>
                              {/* Experience Counter */}
                              <span
                                aria-label={`Experience Counters: ${xpVal}`}
                                title="Experience Counters"
                                style={{
                                  color: xpVal > 0 ? '#60a5fa' : 'rgba(136,136,136,0.6)',
                                  fontWeight: xpVal > 0 ? 600 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                ⭐ {xpVal}
                              </span>
                              {/* Energy Counter - Resource to spend */}
                              <span
                                aria-label={`Energy Counters: ${energyVal}`}
                                title="Energy Counters (Resource)"
                                style={{ 
                                  color: energyVal > 0 ? '#fbbf24' : 'rgba(136,136,136,0.6)',
                                  fontWeight: energyVal > 0 ? 600 : 400,
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 3
                                }}
                              >
                                ⚡ {energyVal}
                              </span>
                            </div>
                            {/* Floating Mana Pool - all seats when they have floating mana */}
                            {(() => {
                              const seatPool = getSeatManaPool(pb.player.id, Boolean(isYouThis));
                              return seatPool && getTotalFloatingMana(seatPool) > 0 ? (
                                <FloatingManaPool manaPool={seatPool} compact />
                              ) : null;
                            })()}
                            {isYouThis && !externalDeckMgrAnchorEl && (
                              <button
                                ref={decksBtnRef}
                                type="button"
                                onClick={() => setDeckMgrOpen(true)}
                                style={{ 
                                  fontSize: 12, 
                                  fontWeight: 600,
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  background: (zObj?.libraryCount || 0) === 0 
                                    ? 'linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)' 
                                    : 'rgba(59, 130, 246, 0.2)',
                                  border: (zObj?.libraryCount || 0) === 0 
                                    ? '2px solid #a78bfa'
                                    : '1px solid rgba(59, 130, 246, 0.4)',
                                  color: '#fff',
                                  cursor: 'pointer',
                                  boxShadow: (zObj?.libraryCount || 0) === 0 
                                    ? '0 0 20px rgba(124, 58, 237, 0.5), 0 4px 12px rgba(37, 99, 235, 0.4)' 
                                    : 'none',
                                  animation: (zObj?.libraryCount || 0) === 0 
                                    ? 'pulse 2s ease-in-out infinite' 
                                    : 'none',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                                title={gameId ? "Manage / Import Deck" : "Waiting for game to be ready"}
                                disabled={!gameId}
                              >
                                📚 {(zObj?.libraryCount || 0) === 0 ? 'Import Deck' : 'Decks'}
                              </button>
                            )}
                            {/* 
                              Special game designation badges (MTG Rules 724-730):
                              - Monarch (Rule 724): Player draws extra card at end step
                              - Initiative (Rule 725): Player ventures into Undercity at upkeep
                              - City's Blessing (Ascend): Permanent designation after controlling 10+ permanents
                            */}
                            {monarch === pb.player.id && (
                              <span
                                aria-label="This player is the Monarch"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(234,179,8,0.2)',
                                  border: '1px solid rgba(234,179,8,0.4)',
                                  color: '#eab308',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                👑 Monarch
                              </span>
                            )}
                            {initiative === pb.player.id && (
                              <span
                                aria-label="This player has the Initiative"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(168,85,247,0.2)',
                                  border: '1px solid rgba(168,85,247,0.4)',
                                  color: '#a855f7',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                🗡️ Initiative
                              </span>
                            )}
                            {cityBlessing?.[pb.player.id] ? (
                              <span
                                aria-label="This player has the City's Blessing"
                                title="City's Blessing (Ascend)"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(20,184,166,0.2)',
                                  border: '1px solid rgba(20,184,166,0.4)',
                                  color: '#14b8a6',
                                  fontSize: 11,
                                  fontWeight: 600
                                }}
                              >
                                🏛️ Ascended
                              </span>
                            ) : anyPlayerHasCityBlessing ? (
                              <span
                                aria-label="This player does not have the City's Blessing"
                                title="No City's Blessing"
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: 'rgba(100,116,139,0.15)',
                                  border: '1px solid rgba(148,163,184,0.25)',
                                  color: 'rgba(148,163,184,0.85)',
                                  fontSize: 11,
                                  fontWeight: 500
                                }}
                              >
                                🏛️ —
                              </span>
                            ) : null}
                          </div>
                          {onPlayerClick && (
                            <button
                              type="button"
                              onClick={() => onPlayerClick(pb.player.id)}
                              disabled={!canTargetPlayer}
                              style={{
                                border: '1px solid',
                                borderColor: isPlayerSelected
                                  ? '#2b6cb0'
                                  : canTargetPlayer
                                  ? '#38a169'
                                  : '#555',
                                background: 'transparent',
                                color: isPlayerSelected
                                  ? '#2b6cb0'
                                  : canTargetPlayer
                                  ? '#38a169'
                                  : '#888',
                                padding: '2px 8px',
                                borderRadius: 6,
                                fontSize: 12
                              }}
                            >
                              {isPlayerSelected ? 'Selected' : 'Target'}
                            </button>
                          )}
                        </div>

    </>
  );
}
