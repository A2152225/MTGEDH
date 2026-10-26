// Origin parent: client/src/components/TableLayout.tsx
// Cluster moved: ordered.map player-seat locals + remaining seat JSX.
// Public entry symbols: renderTableLayoutPlayerSeat.

import React from 'react';
import { revealedByLabel } from '../../utils/revealedInformationLabel';
import type {
  BattlefieldPermanent,
  CardCostAdjustment,
  CardRef,
  CommanderInfo,
  GameID,
  KnownCardRef,
  ManaPool,
  PlayerID,
  PlayerRef,
  PlayerZones,
} from '../../../../shared/src';
import type { ImagePref } from '../BattlefieldGrid';
import { AttachmentLines } from '../AttachmentLines';
import { HandGallery } from '../HandGallery';
import { LandRow } from '../LandRow';
import { ZonesPiles } from '../ZonesPiles';
import { FreeField } from '../FreeField';
import { TokenGroups } from '../TokenGroups';
import { socket } from '../../socket';
import type { AppearanceSettings } from '../../utils/appearanceSettings';
import type { ParsedActivatedAbility } from '../../utils/activatedAbilityParser';
import { showCardPreview, hideCardPreview } from '../CardPreviewLayer';
import type { ZoneType } from '../ZoneCardContextMenu';
import { shouldCollapseTokenGroups } from '../../utils/expandGroupedTokens';
import { isManaSource } from './tableLayoutManaSource';
import {
  isLandTypeLine,
  type HandCard,
  type PlayerBoard,
} from './tableLayoutGeometry';
import type { TableLayoutSeatPosition } from './useTableLayoutViewport';
import { TableLayoutPlayerSeatHeader } from './tableLayoutPlayerSeatHeader';
import { readPlayerRadCounters } from '../../utils/playerRadCounters';

const OPP_THUMB_W = 42;
const OPP_THUMB_H = 57;

export type RenderTableLayoutPlayerSeatArgs = {
  pb: PlayerBoard;
  i: number;
  seatPositions: TableLayoutSeatPosition[];
  splitLands: boolean;
  highlightPlayerTargets?: Set<string>;
  selectedPlayerTargets?: Set<string>;
  you?: PlayerID;
  enableReorderForYou: boolean;
  onPermanentClick?: (id: string) => void;
  zones?: Record<PlayerID, PlayerZones>;
  commandZone?: Record<PlayerID, CommanderInfo | undefined>;
  format?: string;
  life?: Record<PlayerID, number>;
  poisonCounters?: Record<PlayerID, number>;
  experienceCounters?: Record<PlayerID, number>;
  energyCounters?: Record<PlayerID, number>;
  energy?: Record<PlayerID, number>;
  BOARD_W: number;
  BOARD_H: number;
  playerBoardBg: React.CSSProperties;
  FREE_W: number;
  ZONES_W: number;
  speed?: Record<PlayerID, number>;
  enduringStory?: Record<PlayerID, boolean>;
  players: PlayerRef[];
  commanderDamage?: Record<PlayerID, Record<string, number>>;
  getSeatManaPool: (playerId: string, isYouSeat: boolean) => ManaPool | null;
  externalDeckMgrAnchorEl?: HTMLElement | null;
  decksBtnRef: any;
  setDeckMgrOpen: (open: boolean) => void;
  gameId?: GameID;
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  cityBlessing?: Record<PlayerID, boolean>;
  anyPlayerHasCityBlessing?: boolean;
  onPlayerClick?: (pid: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  highlightPermTargets?: Set<string>;
  selectedPermTargets?: Set<string>;
  allBattlefieldPerms: BattlefieldPermanent[];
  imagePref?: ImagePref;
  TILE_W: number;
  battlefieldViewportRows: number;
  yourBattlefieldExpanded: boolean;
  handleToggleYourBattlefieldExpanded: () => void;
  onUpdatePermPos?: (id: string, x: number, y: number, z: number) => void;
  emitBattlefieldAbilityActivation: (
    permanentId: string,
    abilityId: string | number,
    ability?: ParsedActivatedAbility,
    xValue?: number,
  ) => void;
  onRemove?: (id: string) => void;
  pendingTextSwapSource: string | null;
  setPendingTextSwapSource: React.Dispatch<React.SetStateAction<string | null>>;
  onIgnoreForAutoPass?: (permanentId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForAutoPass?: (permanentId: string) => void;
  propsIgnoredCardIds?: Set<string>;
  hasPriority: any;
  isOwnTurn: any;
  isMainPhase: boolean;
  stackEmpty: boolean;
  hasThousandYearElixirEffect: boolean;
  showAbilityBadges: boolean;
  handleToggleAbilityBadges: () => void;
  step?: string;
  playableCards?: string[];
  appearanceSettings?: AppearanceSettings;
  isYouPlayer?: boolean;
  showYourHandBelow: boolean;
  embedYourHand: boolean;
  onShuffleHand?: () => void;
  onPlayLandFromHand?: (cardId: string, fromZone?: 'hand' | 'graveyard' | 'exile' | 'library') => void;
  onCastFromHand?: (cardId: string) => void;
  setZoneContextMenu: React.Dispatch<React.SetStateAction<{ card: KnownCardRef; zone: ZoneType; x: number; y: number } | null>>;
  reasonCannotPlayLand?: (card: any) => string | null;
  reasonCannotCast?: (card: any) => string | null;
  costAdjustments?: Record<string, CardCostAdjustment>;
  onReorderHand?: (order: string[]) => void;
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
  onViewGraveyard?: (playerId: PlayerID) => void;
  onViewExile?: (playerId: PlayerID) => void;
  onUseTopOfLibrary?: () => void;
};

export function renderTableLayoutPlayerSeat({
  pb,
  i,
  seatPositions,
  splitLands,
  highlightPlayerTargets,
  selectedPlayerTargets,
  you,
  enableReorderForYou,
  onPermanentClick,
  zones,
  commandZone,
  format,
  life,
  poisonCounters,
  experienceCounters,
  energyCounters,
  energy,
  BOARD_W,
  BOARD_H,
  playerBoardBg,
  FREE_W,
  ZONES_W,
  speed,
  enduringStory,
  players,
  commanderDamage,
  getSeatManaPool,
  externalDeckMgrAnchorEl,
  decksBtnRef,
  setDeckMgrOpen,
  gameId,
  monarch,
  initiative,
  cityBlessing,
  anyPlayerHasCityBlessing,
  onPlayerClick,
  onCounter,
  highlightPermTargets,
  selectedPermTargets,
  allBattlefieldPerms,
  imagePref,
  TILE_W,
  battlefieldViewportRows,
  yourBattlefieldExpanded,
  handleToggleYourBattlefieldExpanded,
  onUpdatePermPos,
  emitBattlefieldAbilityActivation,
  onRemove,
  pendingTextSwapSource,
  setPendingTextSwapSource,
  onIgnoreForAutoPass,
  onUnignoreForAutoPass,
  propsIgnoredCardIds,
  hasPriority,
  isOwnTurn,
  isMainPhase,
  stackEmpty,
  hasThousandYearElixirEffect,
  showAbilityBadges,
  handleToggleAbilityBadges,
  step,
  playableCards,
  appearanceSettings,
  isYouPlayer,
  showYourHandBelow,
  embedYourHand,
  onShuffleHand,
  onPlayLandFromHand,
  onCastFromHand,
  setZoneContextMenu,
  reasonCannotPlayLand,
  reasonCannotCast,
  costAdjustments,
  onReorderHand,
  onCastCommander,
  onViewGraveyard,
  onViewExile,
  onUseTopOfLibrary,
}: RenderTableLayoutPlayerSeatArgs) {
                const pos = seatPositions[i];
                const perms = pb.permanents;
                // Separate lands from non-lands
                const lands = splitLands ? perms.filter(x => isLandTypeLine((x.card as any)?.type_line)) : [];
                // Separate mana sources (mana rocks/dorks) from other permanents
                const nonLands = splitLands ? perms.filter(x => !isLandTypeLine((x.card as any)?.type_line)) : perms;
                // Keep TokenOptimization groups collapsed in the mana-source row.
                // Server cast/equip/activate and ward payment resolve group_* refs to real members.
                const manaSources = nonLands.filter(x => isManaSource(x));
                // Separate tokens from non-token permanents (tokens have isToken: true)
                const nonManaSourceNonLands = nonLands.filter(x => !isManaSource(x));
                const tokens = nonManaSourceNonLands.filter(x => x.isToken === true);
                const others = nonManaSourceNonLands.filter(x => x.isToken !== true);
                // Count grouped tokenCount, not emit rows — a 20-stack is one row.
                const showCollapsedTokens = shouldCollapseTokenGroups(tokens);
                // If showing collapsed tokens, exclude them from FreeField; otherwise show all
                const permanentsForFreeField = showCollapsedTokens ? others : nonManaSourceNonLands;
                const canTargetPlayer = highlightPlayerTargets?.has(pb.player.id) ?? false;
                const isPlayerSelected = selectedPlayerTargets?.has(pb.player.id) ?? false;
                const isYouThis = you && pb.player.id === you;
                const allowReorderHere = Boolean(isYouThis && enableReorderForYou && !onPermanentClick);

                const zObj = zones?.[pb.player.id];
                const cmdObj = commandZone?.[pb.player.id];
                const isCommanderFormat = (format || '').toLowerCase() === 'commander';

                // unified hand objects for this player
                const playerHandCards: HandCard[] =
                  (zObj && Array.isArray(zObj.hand) ? (zObj.hand as any as HandCard[]) : []) || [];

                const playerHandCount =
                  typeof zObj?.handCount === 'number'
                    ? zObj.handCount
                    : playerHandCards.length;

                const yourHand: HandCard[] = isYouThis ? playerHandCards : [];

                const lifeVal =
                  life?.[pb.player.id] ??
                  pb.player.life ??
                  40;
                const isEliminated = Boolean(pb.player.hasLost) || Boolean(pb.player.eliminated) || lifeVal <= 0;
                const poisonVal = poisonCounters?.[pb.player.id] ?? 0;
                const xpVal = experienceCounters?.[pb.player.id] ?? 0;
                const radVal = readPlayerRadCounters(pb.player);
                const energyVal =
                  energyCounters?.[pb.player.id] ??
                  energy?.[pb.player.id] ??
                  0;
                return (
                  <div
                    key={pb.player.id}
                    style={{
                      position: 'absolute',
                      left: pos.x - BOARD_W / 2,
                      top: pos.y - BOARD_H / 2,
                      width: BOARD_W,
                      height: BOARD_H,
                      transform: `translate(0,0) rotate(${isYouThis ? 0 : pos.rotateDeg}deg)`,
                      transformOrigin: '50% 50%',
                      opacity: isEliminated ? 0.45 : 1,
                      filter: isEliminated ? 'grayscale(0.6)' : 'none',
                      pointerEvents: 'auto'
                    }}
                  >
                    <div
                      style={{
                        position: 'relative',
                        width: '100%',
                        minHeight: BOARD_H,
                        height: '100%',
                        boxSizing: 'border-box',
                        ...playerBoardBg,
                        backdropFilter: 'blur(4px)',
                        borderRadius: 12,
                        padding: 12,
                        border: '1px solid rgba(255,255,255,0.12)',
                        boxShadow: '0 4px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)',
                        display: 'grid',
                        gridTemplateColumns: `${FREE_W}px ${ZONES_W}px`,
                        columnGap: 12,
                        rowGap: 10
                      }}
                    >
                      <div>
                        <TableLayoutPlayerSeatHeader
                          pb={pb}
                          speed={speed}
                          enduringStory={enduringStory}
                          players={players}
                          commanderDamage={commanderDamage}
                          commandZone={commandZone}
                          format={format}
                          lifeVal={lifeVal}
                          poisonVal={poisonVal}
                          xpVal={xpVal}
                          energyVal={energyVal}
                          radVal={radVal}
                          getSeatManaPool={getSeatManaPool}
                          isYouThis={isYouThis}
                          externalDeckMgrAnchorEl={externalDeckMgrAnchorEl}
                          decksBtnRef={decksBtnRef}
                          setDeckMgrOpen={setDeckMgrOpen}
                          zObj={zObj}
                          gameId={gameId}
                          monarch={monarch}
                          initiative={initiative}
                          cityBlessing={cityBlessing}
                          anyPlayerHasCityBlessing={anyPlayerHasCityBlessing}
                          onPlayerClick={onPlayerClick}
                          canTargetPlayer={canTargetPlayer}
                          isPlayerSelected={isPlayerSelected}
                        />
                        <AttachmentLines
                          containerRef={{ current: null } as any}
                          permanents={pb.permanents}
                          opacity={0.5}
                        />

                        {/* Token Groups - collapsible token management when many tokens exist */}
                        {showCollapsedTokens && (
                          <div style={{ marginBottom: 8 }}>
                            <TokenGroups
                              tokens={tokens}
                              groupMode="name+pt+attach"
                              attachedToSet={new Set(perms.filter(p => p.attachedTo).map(p => p.attachedTo!))}
                              onBulkCounter={(ids, deltas) => {
                                // Apply counter changes to all tokens in the group
                                if (isYouThis && gameId) {
                                  for (const id of ids) {
                                    for (const [counterType, delta] of Object.entries(deltas)) {
                                      if (delta !== 0) {
                                        onCounter?.(id, counterType, delta);
                                      }
                                    }
                                  }
                                }
                              }}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onTokenClick={onPermanentClick}
                              onTapForMana={isYouThis && gameId
                                ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id })
                                : undefined}
                              onBulkTapForMana={isYouThis && gameId
                                ? (ids, count) => {
                                    socket.emit('bulkTapPermanentsForMana', {
                                      gameId,
                                      permanentIds: ids,
                                      count,
                                    });
                                    window.setTimeout(() => {
                                      socket.emit('getMyNextResolutionStep', { gameId });
                                    }, 0);
                                  }
                                : undefined}
                              collapsible={true}
                              defaultCollapsed={true}
                            />
                          </div>
                        )}

                        <FreeField
                          perms={permanentsForFreeField}
                          allBattlefieldPerms={allBattlefieldPerms}
                          imagePref={imagePref || 'small'}
                          tileWidth={TILE_W}
                          widthPx={FREE_W}
                          viewportRows={battlefieldViewportRows}
                          expanded={isYouThis ? yourBattlefieldExpanded : false}
                          onToggleExpanded={isYouThis ? handleToggleYourBattlefieldExpanded : undefined}
                          showExpandControl={!!isYouThis}
                          draggable={!!isYouThis}
                          onMove={(id, xx, yy, zz) =>
                            onUpdatePermPos?.(id, xx, yy, zz ?? 0)
                          }
                          highlightTargets={highlightPermTargets}
                          selectedTargets={selectedPermTargets}
                          onCardClick={onPermanentClick}
                          players={players.map(p => ({ id: p.id, name: p.name }))}
                          onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                          onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                          onActivateAbility={gameId ? emitBattlefieldAbilityActivation : undefined}
                          onAddCounter={isYouThis ? onCounter : undefined}
                          onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                          onRemove={isYouThis ? onRemove : undefined}
                          onExchangeTextBoxes={isYouThis && gameId ? (clickedId) => {
                            if (pendingTextSwapSource && pendingTextSwapSource !== clickedId) {
                              socket.emit('exchangeTextBoxes', { gameId, sourcePermanentId: pendingTextSwapSource, targetPermanentId: clickedId });
                              setPendingTextSwapSource(null);
                            } else if (pendingTextSwapSource === clickedId) {
                              setPendingTextSwapSource(null);
                            } else {
                              setPendingTextSwapSource(clickedId);
                              console.info('[exchangeTextBoxes] Select a second permanent to complete the text swap.');
                            }
                          } : undefined}
                          onIgnoreForAutoPass={isYouThis ? onIgnoreForAutoPass : undefined}
                          onUnignoreForAutoPass={isYouThis ? onUnignoreForAutoPass : undefined}
                          ignoredForAutoPassIds={propsIgnoredCardIds}
                          canActivate={!!(isYouThis || hasPriority)}
                          playerId={you}
                          hasPriority={hasPriority || false}
                          isOwnTurn={!!isOwnTurn}
                          isMainPhase={!!isMainPhase}
                          stackEmpty={stackEmpty}
                          hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                          showActivatedAbilityButtons={isYouThis ? showAbilityBadges : true}
                          showAbilityBadges={!!isYouThis && showAbilityBadges}
                          onToggleAbilityBadges={isYouThis ? handleToggleAbilityBadges : undefined}
                          currentStep={step}
                          playableCards={isYouThis ? playableCards : undefined}
                          appearanceSettings={appearanceSettings}
                        />

                        {/* Mana Sources Row (mana rocks, dorks) - positioned above lands */}
                        {manaSources.length > 0 && (
                          <div style={{ marginTop: 8 }} data-no-zoom>
                            <div
                              style={{
                                fontSize: 11,
                                opacity: 0.65,
                                marginBottom: 4,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6
                              }}
                            >
                              <span style={{ color: '#fbbf24' }}>💎</span>
                              <span>Mana Sources ({manaSources.length})</span>
                            </div>
                            <LandRow
                              lands={manaSources}
                              players={players}
                              allBattlefieldPerms={allBattlefieldPerms}
                              imagePref={imagePref || 'small'}
                              tileWidth={Math.round(TILE_W * 0.85)}
                              overlapRatio={0.4}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onCardClick={onPermanentClick}
                              onRemove={isYouPlayer ? onRemove : undefined}
                              onCounter={isYouPlayer ? onCounter : undefined}
                              onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                              onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                              onActivateAbility={gameId ? emitBattlefieldAbilityActivation : undefined}
                              onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                              onIgnoreForAutoPass={isYouThis ? onIgnoreForAutoPass : undefined}
                              onUnignoreForAutoPass={isYouThis ? onUnignoreForAutoPass : undefined}
                              ignoredForAutoPassIds={propsIgnoredCardIds}
                              canActivate={!!(isYouThis || hasPriority)}
                              playerId={you}
                              hasPriority={hasPriority || false}
                              isOwnTurn={!!isOwnTurn}
                              isMainPhase={!!isMainPhase}
                              stackEmpty={stackEmpty}
                              hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                              currentStep={step}
                              showActivatedAbilityButtons={isYouThis ? showAbilityBadges : true}
                              playableCards={isYouThis ? playableCards : undefined}
                              appearanceSettings={appearanceSettings}
                            />
                          </div>
                        )}

                        {/* Lands Row - positioned at bottom, just above hand */}
                        {lands.length > 0 && (
                          <div style={{ marginTop: 12 }} data-no-zoom>
                            <div
                              style={{
                                fontSize: 12,
                                opacity: 0.7,
                                marginBottom: 6
                              }}
                            >
                              Lands
                            </div>
                            <LandRow
                              lands={lands}
                              players={players}
                              allBattlefieldPerms={allBattlefieldPerms}
                              imagePref={imagePref || 'small'}
                              tileWidth={TILE_W}
                              overlapRatio={0.33}
                              highlightTargets={highlightPermTargets}
                              selectedTargets={selectedPermTargets}
                              onCardClick={onPermanentClick}
                              onRemove={isYouPlayer ? onRemove : undefined}
                              onCounter={isYouPlayer ? onCounter : undefined}
                              onTap={isYouThis && gameId ? (id) => socket.emit('tapPermanent', { gameId, permanentId: id }) : undefined}
                              onUntap={isYouThis && gameId ? (id) => socket.emit('untapPermanent', { gameId, permanentId: id }) : undefined}
                              onActivateAbility={gameId ? emitBattlefieldAbilityActivation : undefined}
                              onSacrifice={isYouThis && gameId ? (id) => socket.emit('sacrificePermanent', { gameId, permanentId: id }) : undefined}
                              onIgnoreForAutoPass={isYouThis ? onIgnoreForAutoPass : undefined}
                              onUnignoreForAutoPass={isYouThis ? onUnignoreForAutoPass : undefined}
                              ignoredForAutoPassIds={propsIgnoredCardIds}
                              canActivate={!!(isYouThis || hasPriority)}
                              playerId={you}
                              hasPriority={hasPriority || false}
                              isOwnTurn={!!isOwnTurn}
                              isMainPhase={!!isMainPhase}
                              stackEmpty={stackEmpty}
                              hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                              currentStep={step}
                              showActivatedAbilityButtons={isYouThis ? showAbilityBadges : true}
                              playableCards={isYouThis ? playableCards : undefined}
                              appearanceSettings={appearanceSettings}
                            />
                          </div>
                        )}

                        {/* YOUR hand (full details) */}
                        {isYouThis && showYourHandBelow && embedYourHand && (
                          <div
                            id={`hand-area-${pb.player.id}`}
                            style={{
                              marginTop: 12,
                              background: 'linear-gradient(180deg, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.85) 100%)',
                              border: '1px solid rgba(255,255,255,0.15)',
                              borderRadius: 10,
                              padding: 10,
                              maxHeight: '32vh',
                              overflowY: 'auto',
                              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)'
                            }}
                            data-no-zoom
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8
                              }}
                            >
                              <div
                                style={{ fontSize: 12, color: '#e5e5e5', fontWeight: 500 }}
                              >
                                Your Hand
                              </div>
                              {onShuffleHand && (
                                <button
                                  type="button"
                                  onClick={() => onShuffleHand()}
                                  style={{
                                    fontSize: 11,
                                    padding: '3px 10px',
                                    borderRadius: 4,
                                    background: 'rgba(255,255,255,0.1)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    color: '#ccc',
                                    cursor: 'pointer'
                                  }}
                                >
                                  Shuffle
                                </button>
                              )}
                            </div>
                            <HandGallery
                              cards={yourHand as CardRef[]}
                              imagePref={imagePref || 'small'}
                              onPlayLand={(cardId) =>
                                onPlayLandFromHand?.(cardId)
                              }
                              onCast={(cardId) =>
                                onCastFromHand?.(cardId)
                              }
                              reasonCannotPlayLand={(c) =>
                                reasonCannotPlayLand
                                  ? reasonCannotPlayLand(c)
                                  : null
                              }
                              reasonCannotCast={(c) =>
                                reasonCannotCast ? reasonCannotCast(c) : null
                              }
                              thumbWidth={TILE_W}
                              zoomScale={1}
                              // 7 cards per row for your own hand
                              layout="wrap7"
                              overlapPx={0}
                              rowGapPx={10}
                              enableReorder={allowReorderHere}
                              onReorder={onReorderHand}
                              playableCards={playableCards}
                              costAdjustments={costAdjustments}
                              appearanceSettings={appearanceSettings}
                              onContextMenu={(card, x, y) => setZoneContextMenu({ card, zone: 'hand', x, y })}
                            />
                          </div>
                        )}

                        {/* OPPONENTS' hand strip: thumbnails, larger + hover for known cards */}
                        {!isYouThis && playerHandCount > 0 && (
                          <div
                            style={{
                              marginTop: 8,
                              padding: 6,
                              borderRadius: 6,
                              background: 'rgba(0,0,0,0.8)',
                              border: '1px solid #4b5563',
                              color: '#e5e7eb',
                              fontSize: 11,
                              minHeight: OPP_THUMB_H + 16,
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                            data-no-zoom
                          >
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <span>Hand</span>
                              {revealedByLabel((zObj as any)?.handRevealedBy) && (
                                <span data-testid="hand-revealed-by" style={{ fontSize: 10, color: '#fbbf24' }}>
                                  {revealedByLabel((zObj as any)?.handRevealedBy)}
                                </span>
                              )}
                              <span>{playerHandCount} cards</span>
                            </div>
                            <div
                              style={{
                                display: 'flex',
                                gap: 4,
                                overflowX: 'hidden',
                                alignItems: 'center',
                                minHeight: OPP_THUMB_H,
                              }}
                            >
                              {playerHandCards.slice(0, 12).map((card, idx) => {
                                const visibleToYou =
                                  !!card.known && !card.faceDown;

                                if (!visibleToYou) {
                                  // hidden: card back
                                  return (
                                    <div
                                      key={card.id || idx}
                                      title="Hidden card"
                                      style={{
                                        width: OPP_THUMB_W,
                                        height: OPP_THUMB_H,
                                        borderRadius: 4,
                                        background:
                                          'linear-gradient(135deg, #111827, #020617)',
                                        border: '1px solid #9ca3af',
                                        boxShadow: '0 0 4px rgba(0,0,0,0.7)',
                                        flex: '0 0 auto'
                                      }}
                                    />
                                  );
                                }

                                // known/visible: small face-up thumbnail with preview support
                                const art =
                                  (card.image_uris &&
                                    (card.image_uris.small ||
                                      card.image_uris.normal)) ||
                                  undefined;
                                const previewPayload = JSON.stringify({
                                  id: card.id,
                                  name: card.name,
                                  type_line: card.type_line,
                                  image_uris: card.image_uris,
                                });

                                return (
                                  <div
                                    key={card.id || idx}
                                    title={card.name || ''}
                                    style={{
                                      width: OPP_THUMB_W,
                                      height: OPP_THUMB_H,
                                      borderRadius: 4,
                                      overflow: 'hidden',
                                      border: '1px solid #a3e635',
                                      boxShadow:
                                        '0 0 4px rgba(34,197,94,0.7)',
                                      flex: '0 0 auto',
                                      background: '#000',
                                      cursor: 'pointer',
                                    }}
                                    // Show card preview on hover
                                    onMouseEnter={(e) => {
                                      showCardPreview(e.currentTarget as HTMLElement, card, { prefer: 'above', anchorPadding: 0 });
                                    }}
                                    onMouseLeave={(e) => {
                                      hideCardPreview(e.currentTarget as HTMLElement);
                                    }}
                                  >
                                    {art ? (
                                      <img
                                        src={art}
                                        alt={card.name || ''}
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          objectFit: 'cover'
                                        }}
                                      />
                                    ) : (
                                      <div
                                        style={{
                                          width: '100%',
                                          height: '100%',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontSize: 9,
                                          padding: 2
                                        }}
                                      >
                                        {card.name || 'Known card'}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                              {playerHandCount > 12 && (
                                <div
                                  style={{
                                    alignSelf: 'center',
                                    marginLeft: 4,
                                    fontSize: 10,
                                    opacity: 0.8
                                  }}
                                >
                                  +{playerHandCount - 12} more
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'center'
                        }}
                      >
                        {zObj && (
                          <ZonesPiles
                            zones={zObj}
                            commander={cmdObj}
                            isCommanderFormat={isCommanderFormat}
                            showHandCount={
                              !isYouThis
                                ? zObj.handCount ??
                                  (Array.isArray(zObj.hand)
                                    ? zObj.hand.length
                                    : 0)
                                : undefined
                            }
                            hideHandDetails={!isYouThis}
                            canCastCommander={!!(isCommanderFormat && isYouThis && gameId)}
                            onCastCommander={(commanderId, commanderName, manaCost, tax) => {
                              if (!gameId) return;
                              // Use the callback if provided, otherwise emit directly
                              if (onCastCommander) {
                                onCastCommander(commanderId, commanderName, manaCost, tax);
                              } else {
                                socket.emit('requestCastSpell', {
                                  gameId,
                                  cardId: commanderId,
                                  fromZone: 'command',
                                });
                              }
                            }}
                            onViewGraveyard={onViewGraveyard ? () => onViewGraveyard(pb.player.id) : undefined}
                            onGraveyardContextMenu={isYouThis ? (card, x, y) => setZoneContextMenu({ card, zone: 'graveyard', x, y }) : undefined}
                            onViewExile={onViewExile ? () => onViewExile(pb.player.id) : undefined}
                            onUseTopOfLibrary={isYouThis ? onUseTopOfLibrary : undefined}
                            playableCards={isYouThis ? playableCards : undefined}
                            playerId={pb.player.id}
                            appearanceSettings={appearanceSettings}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                );
}
