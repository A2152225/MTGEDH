// Origin parent: client/src/components/FreeField.tsx
// Cluster moved: battlefield-tile overlay badges (token count, combat, abilities,
// counters, ETB choices, name ribbon, P/T, loyalty, activated-ability buttons).
// Public entry symbols: FreeFieldPermanentOverlays.
// Leaf must not import FreeField.tsx or FreeField-handlers/index.ts.

import React from 'react';
import type { BattlefieldPermanent } from '../../../../shared/src';
import {
  isCounterPreventingAttack,
  isCounterPreventingBlock,
} from '../../../../shared/src/counterCombatRestrictions';
import { textAllowsAnyPlayerActivation } from '../../../../shared/src/anyPlayerActivatedAbility';
import { resolvePlayerBadgeLabel } from '../../utils/playerBadgeLabel';
import { ActivatedAbilityButtons } from '../ActivatedAbilityButtons';
import {
  parseStationThreshold,
  type ParsedActivatedAbility,
} from '../../utils/activatedAbilityParser';
import {
  buildPTTooltip,
  getAbilityDisplay,
  getLoyaltyColor,
  getPTColor,
} from './freeFieldDisplayUtils';
import { ClassLevelBadge } from '../ClassLevelBadge';
import { PermanentRulesStatusBadges, isActivationFullyLocked, isActivationManaOnly, conditionalPtBonusLines, variablePtLines } from '../PermanentRulesStatusBadges';
import { FaceDownPermanentLayer } from '../FaceDownPermanentLayer';

export type FreeFieldPermanentOverlaysProps = {
  scale: number;
  name: string;
  raw: BattlefieldPermanent;
  counters: Record<string, number>;
  abilities?: readonly string[];
  isGroupedTokens?: boolean;
  tokenCount?: number;
  isToken?: boolean;
  attackingPlayerName: string | null;
  isBlocking: boolean;
  blocking?: string[];
  blockedBy?: string[];
  isTargeted: boolean;
  targetedBy?: string[];
  allBattlefieldPerms?: BattlefieldPermanent[];
  perms: BattlefieldPermanent[];
  hasTemporaryEffects: boolean;
  temporaryEffects?: readonly { id: string; description: string; icon?: string; expiresAt?: string; sourceName?: string }[];
  isAttached: boolean;
  attachedToName?: string;
  hasAttachments?: boolean;
  attachmentNames?: string[];
  isCreature: boolean;
  pDisp?: number;
  tDisp?: number;
  hasPTModifiers: boolean;
  hasDamage: boolean;
  baseP?: number;
  baseT?: number;
  plusCounters: number;
  minusCounters: number;
  ptSources?: { name: string; power: number; toughness: number }[];
  damageMarked?: number;
  isPlaneswalker: boolean;
  loyalty?: number;
  baseLoyalty?: number;
  showActivatedAbilityButtons?: boolean;
  playerId?: string;
  tileWidth: number;
  hasPriority?: boolean;
  isOwnTurn?: boolean;
  isMainPhase?: boolean;
  stackEmpty?: boolean;
  currentStep?: string;
  hasThousandYearElixirEffect?: boolean;
  onActivateAbility?: (permanentId: string, abilityId: string, ability?: ParsedActivatedAbility, xValue?: number) => void;
  players?: readonly { id: string; name?: string }[];
};

export function FreeFieldPermanentOverlays(props: FreeFieldPermanentOverlaysProps) {
  const {
    scale,
    name,
    raw,
    counters,
    abilities,
    isGroupedTokens,
    tokenCount,
    isToken,
    attackingPlayerName,
    isBlocking,
    blocking,
    blockedBy,
    isTargeted,
    targetedBy,
    allBattlefieldPerms,
    perms,
    hasTemporaryEffects,
    temporaryEffects,
    isAttached,
    attachedToName,
    hasAttachments,
    attachmentNames,
    isCreature,
    pDisp,
    tDisp,
    hasPTModifiers,
    hasDamage,
    baseP,
    baseT,
    plusCounters,
    minusCounters,
    ptSources,
    damageMarked,
    isPlaneswalker,
    loyalty,
    baseLoyalty,
    showActivatedAbilityButtons,
    playerId,
    tileWidth,
    hasPriority,
    isOwnTurn,
    isMainPhase,
    stackEmpty,
    currentStep,
    hasThousandYearElixirEffect,
    onActivateAbility,
    players,
  } = props;
  const activationFullyLocked = isActivationFullyLocked(raw);
  const viewerId = String(playerId || '');
  const controllerId = String(raw.controller || '');
  const showOwnAbilityButtons = !!showActivatedAbilityButtons && !!viewerId && controllerId === viewerId;
  const showAnyPlayerAbilityButtons = !!showActivatedAbilityButtons && !!viewerId
    && controllerId !== viewerId
    && textAllowsAnyPlayerActivation((raw.card as { oracle_text?: string } | undefined)?.oracle_text);
  const showNonPlaneswalkerAbilityButtons = (showOwnAbilityButtons || showAnyPlayerAbilityButtons) && !isPlaneswalker && !activationFullyLocked;
  return (
    <>
            {(raw as any)?.isFaceDown && <FaceDownPermanentLayer perm={raw} viewerId={playerId} scale={scale} />}
            {/* Token count badge - shown for grouped tokens or any token with count > 1 */}
            {((isGroupedTokens && tokenCount && tokenCount > 1) || (isToken && tokenCount && tokenCount > 1)) && (
              <div style={{
                position: 'absolute',
                top: Math.round(4 * scale),
                left: Math.round(4 * scale),
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: Math.round(24 * scale),
                height: Math.round(20 * scale),
                padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
                borderRadius: Math.round(10 * scale),
                background: 'linear-gradient(135deg, rgba(147,51,234,0.95), rgba(126,34,206,0.95))',
                border: '2px solid rgba(255,255,255,0.4)',
                boxShadow: '0 2px 8px rgba(147,51,234,0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
                zIndex: 25,
              }}>
                <span style={{
                  fontSize: Math.round(12 * scale),
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                }}>
                  {tokenCount}×
                </span>
              </div>
            )}

            {/* Attack indicator */}
            {attackingPlayerName && (
              <div style={{
                position: 'absolute',
                left: '50%',
                top: Math.round(-16 * scale),
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: Math.round(3 * scale),
                padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
                borderRadius: Math.round(4 * scale),
                background: 'linear-gradient(90deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))',
                border: '1px solid #fca5a5',
                boxShadow: '0 2px 8px rgba(239,68,68,0.5)',
                whiteSpace: 'nowrap',
                zIndex: 20,
              }}>
                <span style={{ fontSize: Math.round(10 * scale) }}>⚔️</span>
                <span style={{
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}>
                  → {attackingPlayerName}
                </span>
              </div>
            )}

            {/* Blocking indicator */}
            {isBlocking && (
              <div style={{
                position: 'absolute',
                left: '50%',
                top: Math.round(-16 * scale),
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: Math.round(3 * scale),
                padding: `${Math.round(2 * scale)}px ${Math.round(6 * scale)}px`,
                borderRadius: Math.round(4 * scale),
                background: 'linear-gradient(90deg, rgba(59,130,246,0.95), rgba(37,99,235,0.95))',
                border: '1px solid #93c5fd',
                boxShadow: '0 2px 8px rgba(59,130,246,0.5)',
                whiteSpace: 'nowrap',
                zIndex: 20,
              }}>
                <span style={{ fontSize: Math.round(10 * scale) }}>🛡️</span>
                <span style={{
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  color: '#fff',
                }}>
                  Blocking {blocking!.length}
                </span>
              </div>
            )}

            {/* Blocked by indicator */}
            {blockedBy && blockedBy.length > 0 && (
              <div style={{
                position: 'absolute',
                left: '50%',
                bottom: Math.round(-12 * scale),
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: Math.round(2 * scale),
                padding: `${Math.round(1 * scale)}px ${Math.round(4 * scale)}px`,
                borderRadius: Math.round(3 * scale),
                background: 'rgba(239,68,68,0.9)',
                fontSize: Math.round(8 * scale),
                color: '#fff',
                whiteSpace: 'nowrap',
                zIndex: 20,
              }}>
                ⛔ Blocked by {blockedBy.length}
              </div>
            )}

            {/* Targeted indicator */}
            {isTargeted && (
              <div style={{
                position: 'absolute',
                left: Math.round(4 * scale),
                top: Math.round(4 * scale),
                display: 'flex',
                alignItems: 'center',
                gap: Math.round(2 * scale),
                padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                borderRadius: Math.round(4 * scale),
                background: 'linear-gradient(90deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))',
                border: '1px solid #fcd34d',
                boxShadow: '0 0 8px rgba(245,158,11,0.6)',
                zIndex: 15,
              }}>
                <span style={{ fontSize: Math.round(10 * scale) }}>🎯</span>
                <span style={{
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  color: '#fff',
                }}>
                  {targetedBy!.length}
                </span>
              </div>
            )}

            {/* Granted abilities badges with reminder text tooltips */}
            {/* Position adjusts when targeted indicator is shown to avoid overlap */}
            {Array.isArray(abilities) && abilities.length > 0 ? (
              <div style={{ 
                position: 'absolute', 
                top: isTargeted ? Math.round(24 * scale) : Math.round(4 * scale), 
                right: Math.round(4 * scale), 
                display: 'flex', 
                flexWrap: 'wrap',
                gap: Math.round(2 * scale),
                maxWidth: '75%',
                justifyContent: 'flex-end',
              }}>
                {abilities.slice(0, 4).map((a) => {
                  const abilityInfo = getAbilityDisplay(a);
                  // Format tooltip like reminder text: "Flying (This creature can only be blocked by creatures with flying or reach.)"
                  const tooltipText = `${abilityInfo.term}\n(${abilityInfo.reminderText})`;
                  return (
                    <span 
                      key={a} 
                      title={tooltipText}
                      style={{
                        background: `${abilityInfo.color}dd`,
                        color: '#fff',
                        border: `1px solid ${abilityInfo.color}`,
                        borderRadius: Math.round(3 * scale),
                        fontSize: Math.round(8 * scale),
                        padding: `${Math.round(1 * scale)}px ${Math.round(3 * scale)}px`,
                        lineHeight: '1.1',
                        fontWeight: 600,
                        textShadow: '0 1px 1px rgba(0,0,0,0.4)',
                        cursor: 'help',
                      }}
                    >
                      {abilityInfo.short}
                    </span>
                  );
                })}
                {abilities.length > 4 && (
                  <span 
                    title={abilities.slice(4).map(a => {
                      const info = getAbilityDisplay(a);
                      return `${info.term}: ${info.reminderText}`;
                    }).join('\n\n')}
                    style={{
                      background: 'rgba(0,0,0,0.7)',
                      color: '#fff',
                      borderRadius: Math.round(3 * scale),
                      fontSize: Math.round(7 * scale),
                      padding: `${Math.round(1 * scale)}px ${Math.round(2 * scale)}px`,
                      cursor: 'help',
                    }}
                  >
                    +{abilities.length - 4}
                  </span>
                )}
              </div>
            ) : null}

            {/* Class level badge (the printed image shows every level) */}
            <ClassLevelBadge card={raw?.card} level={(raw as any)?.level} scale={scale} />

            {/* Rules status chips: abilities removed, locks, stolen control, added types, solved, paired, saddled */}
            <PermanentRulesStatusBadges perm={raw} scale={scale} players={players} allPerms={allBattlefieldPerms || perms} />

            {/* Charge counters — prominent badge for Station planets/spacecraft */}
            {(() => {
              const cardTypeLine = String(raw?.card?.type_line || '').toLowerCase();
              const oracleText = String(raw?.card?.oracle_text || '');
              const hasStation =
                cardTypeLine.includes('spacecraft') ||
                cardTypeLine.includes('planet') ||
                /\bstation\b/i.test(oracleText);
              const chargeCount = Number(counters['charge'] ?? 0);
              const stationThreshold = hasStation ? parseStationThreshold(oracleText) : undefined;
              const showBadge = chargeCount > 0 || (hasStation && typeof stationThreshold === 'number');
              if (!showBadge) return null;

              const reachedThreshold =
                typeof stationThreshold === 'number' && chargeCount >= stationThreshold;
              const counterLabel =
                typeof stationThreshold === 'number'
                  ? `${chargeCount}/${stationThreshold}`
                  : String(chargeCount);

              return (
                <div
                  title={`${chargeCount} charge counter${chargeCount === 1 ? '' : 's'}${
                    typeof stationThreshold === 'number' ? ` (Station ${stationThreshold}+)` : ''
                  }`}
                  style={{
                    position: 'absolute',
                    top: Math.round(4 * scale),
                    left: Math.round(4 * scale),
                    display: 'flex',
                    alignItems: 'center',
                    gap: Math.round(3 * scale),
                    padding: `${Math.round(3 * scale)}px ${Math.round(7 * scale)}px`,
                    borderRadius: Math.round(6 * scale),
                    background: reachedThreshold
                      ? 'linear-gradient(135deg, rgba(34,197,94,0.95), rgba(22,163,74,0.95))'
                      : 'linear-gradient(135deg, rgba(37,99,235,0.95), rgba(29,78,216,0.95))',
                    border: reachedThreshold
                      ? '1px solid rgba(134,239,172,0.8)'
                      : '1px solid rgba(147,197,253,0.8)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                    zIndex: 18,
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: Math.round(11 * scale) }}>⚡</span>
                  <span
                    style={{
                      fontSize: Math.round(11 * scale),
                      fontWeight: 700,
                      color: '#fff',
                      lineHeight: 1,
                    }}
                  >
                    {counterLabel}
                  </span>
                </div>
              );
            })()}

            {/* Bribery counters — Gwafa Hazid and similar static effects */}
            {(() => {
              const briberyCount = Number(counters['bribery'] ?? 0);
              if (briberyCount <= 0) return null;

              const battlefieldForCheck = allBattlefieldPerms || perms;
              const attackRestricted = isCounterPreventingAttack(raw, battlefieldForCheck).isPrevented;
              const blockRestricted = isCounterPreventingBlock(raw, battlefieldForCheck).isPrevented;
              const restrictionNote = attackRestricted && blockRestricted
                ? " — can't attack or block while Gwafa Hazid is on the battlefield"
                : '';

              return (
                <div
                  title={`${briberyCount} bribery counter${briberyCount === 1 ? '' : 's'}${restrictionNote}`}
                  style={{
                    position: 'absolute',
                    top: Math.round(4 * scale),
                    right: Math.round(4 * scale),
                    display: 'flex',
                    alignItems: 'center',
                    gap: Math.round(3 * scale),
                    padding: `${Math.round(3 * scale)}px ${Math.round(7 * scale)}px`,
                    borderRadius: Math.round(6 * scale),
                    background: 'linear-gradient(135deg, rgba(202,138,4,0.95), rgba(161,98,7,0.95))',
                    border: '1px solid rgba(253,224,71,0.8)',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
                    zIndex: 19,
                    pointerEvents: 'none',
                  }}
                >
                  <span style={{ fontSize: Math.round(11 * scale) }}>🪙</span>
                  <span
                    style={{
                      fontSize: Math.round(10 * scale),
                      fontWeight: 700,
                      color: '#fff',
                      lineHeight: 1,
                      textTransform: 'uppercase',
                      letterSpacing: '0.03em',
                    }}
                  >
                    {briberyCount}
                  </span>
                </div>
              );
            })()}

            {/* Temporary Effects Badge - shows when card has temporary effects applied */}
            {hasTemporaryEffects && (
              <div 
                style={{
                  position: 'absolute',
                  left: Math.round(4 * scale),
                  bottom: Math.round(28 * scale),
                  display: 'flex',
                  alignItems: 'center',
                  gap: Math.round(3 * scale),
                  padding: `${Math.round(3 * scale)}px ${Math.round(6 * scale)}px`,
                  borderRadius: Math.round(4 * scale),
                  background: 'linear-gradient(135deg, rgba(139,92,246,0.9), rgba(168,85,247,0.9))',
                  border: '1px solid rgba(196,181,253,0.5)',
                  boxShadow: '0 2px 6px rgba(139,92,246,0.4)',
                  zIndex: 16,
                  cursor: 'help',
                }}
                title={temporaryEffects!.map(e => 
                  `${e.icon || '✨'} ${e.description}${e.expiresAt ? ` (${e.expiresAt.replace(/_/g, ' ')})` : ''}${e.sourceName ? ` - from ${e.sourceName}` : ''}`
                ).join('\n')}
              >
                <span style={{ fontSize: Math.round(10 * scale) }}>✨</span>
                <span style={{
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  color: '#fff',
                }}>
                  {temporaryEffects!.length} Effect{temporaryEffects!.length !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            {/* Attached to indicator - shows what this aura/equipment is attached to */}
            {isAttached && attachedToName && (
              <div 
                style={{
                  position: 'absolute',
                  left: Math.round(4 * scale),
                  top: Math.round(4 * scale),
                  display: 'flex',
                  alignItems: 'center',
                  gap: Math.round(3 * scale),
                  padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                  borderRadius: Math.round(4 * scale),
                  background: 'rgba(139,92,246,0.85)',
                  border: '1px solid rgba(196,181,253,0.6)',
                  boxShadow: '0 2px 6px rgba(139,92,246,0.4)',
                  zIndex: 17,
                  maxWidth: '90%',
                  overflow: 'hidden',
                }}
                title={`Attached to: ${attachedToName}`}
              >
                <span style={{ 
                  fontSize: Math.round(9 * scale),
                  fontWeight: 600,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  ↗ {attachedToName}
                </span>
              </div>
            )}

            {/* Has Attachments badge - shows on creatures that have equipment/auras attached */}
            {hasAttachments && attachmentNames && attachmentNames.length > 0 && (
              <div 
                style={{
                  position: 'absolute',
                  right: Math.round(4 * scale),
                  bottom: Math.round(56 * scale), // Moved up to not overlap P/T badge (was 28)
                  display: 'flex',
                  alignItems: 'center',
                  gap: Math.round(3 * scale),
                  padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                  borderRadius: Math.round(4 * scale),
                  background: 'rgba(124,58,237,0.9)',
                  border: '1px solid rgba(167,139,250,0.6)',
                  boxShadow: '0 2px 6px rgba(124,58,237,0.5)',
                  zIndex: 17,
                  maxWidth: '70%',
                }}
                title={`Equipped/Enchanted by: ${attachmentNames.join(', ')}`}
              >
                <span style={{ fontSize: Math.round(10 * scale) }}>⚔️</span>
                <span style={{ 
                  fontSize: Math.round(8 * scale),
                  fontWeight: 600,
                  color: '#fff',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
                  {attachmentNames.length === 1 ? attachmentNames[0] : `${attachmentNames.length} attached`}
                </span>
              </div>
            )}

            {/* ETB Choice Badges - Show selected color, creature type, card name, player, or option */}
            {(() => {
              const badges = [];
              const pAny = raw as any;
              
              if (pAny.chosenColor) {
                const colorMap: Record<string, { bg: string; name: string }> = {
                  white: { bg: '#f9fafb', name: 'White' },
                  blue: { bg: '#3b82f6', name: 'Blue' },
                  black: { bg: '#1f2937', name: 'Black' },
                  red: { bg: '#ef4444', name: 'Red' },
                  green: { bg: '#22c55e', name: 'Green' },
                };
                const colorInfo = colorMap[pAny.chosenColor.toLowerCase()] || { bg: '#6b7280', name: pAny.chosenColor };
                badges.push(
                  <div
                    key="color"
                    style={{
                      background: colorInfo.bg,
                      color: pAny.chosenColor === 'white' ? '#000' : '#fff',
                      fontSize: Math.round(9 * scale),
                      padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                      borderRadius: Math.round(4 * scale),
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen color: ${colorInfo.name}`}
                  >
                    ◆ {colorInfo.name}
                  </div>
                );
              }
              
              if (pAny.chosenCreatureType) {
                badges.push(
                  <div
                    key="creatureType"
                    style={{
                      background: 'rgba(139, 92, 246, 0.85)', // Purple
                      color: '#fff',
                      fontSize: Math.round(9 * scale),
                      padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                      borderRadius: Math.round(4 * scale),
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen creature type: ${pAny.chosenCreatureType}`}
                  >
                    ⚔ {pAny.chosenCreatureType}
                  </div>
                );
              }
              
              if (pAny.chosenCardName) {
                badges.push(
                  <div
                    key="cardName"
                    style={{
                      background: 'rgba(234, 88, 12, 0.85)', // Orange
                      color: '#fff',
                      fontSize: Math.round(9 * scale),
                      padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                      borderRadius: Math.round(4 * scale),
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      maxWidth: Math.round(80 * scale),
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Named card: ${pAny.chosenCardName}`}
                  >
                    ✦ {pAny.chosenCardName}
                  </div>
                );
              }
              
              if (pAny.chosenPlayer) {
                const chosenPlayerLabel = resolvePlayerBadgeLabel(pAny.chosenPlayer, players, pAny.chosenPlayerName);
                badges.push(
                  <div
                    key="player"
                    style={{
                      background: 'rgba(236, 72, 153, 0.85)', // Pink
                      color: '#fff',
                      fontSize: Math.round(9 * scale),
                      padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                      borderRadius: Math.round(4 * scale),
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen player: ${chosenPlayerLabel}`}
                  >
                    👤 {chosenPlayerLabel}
                  </div>
                );
              }
              
              if (pAny.chosenOption) {
                badges.push(
                  <div
                    key="option"
                    style={{
                      background: 'rgba(14, 165, 233, 0.85)', // Cyan
                      color: '#fff',
                      fontSize: Math.round(9 * scale),
                      padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                      borderRadius: Math.round(4 * scale),
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen option: ${pAny.chosenOption}`}
                  >
                    ✓ {pAny.chosenOption}
                  </div>
                );
              }
              
              return badges.length > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    bottom: Math.round(42 * scale),
                    left: Math.round(6 * scale),
                    display: 'flex',
                    flexDirection: 'column',
                    gap: Math.round(2 * scale),
                    maxWidth: '90%',
                    zIndex: 18,
                  }}
                >
                  {badges}
                </div>
              ) : null;
            })()}

            {/* Name ribbon */}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
              color: '#fff', fontSize: Math.round(11 * scale), padding: `${Math.round(6 * scale)}px ${Math.round(6 * scale)}px`,
              borderBottomLeftRadius: 4, borderBottomRightRadius: 4, pointerEvents: 'none'
            }}>
              <div title={name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
              {/* Counter badges */}
              {Object.keys(counters).length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                  {Object.entries(counters).filter(([k]) => k !== 'loyalty').map(([k, v]) => (
                    <span key={k} style={{
                      fontSize: Math.round(8 * scale),
                      background: 'rgba(255,255,255,0.15)',
                      padding: `0 ${Math.round(3 * scale)}px`,
                      borderRadius: 2,
                    }}>{k}:{v as number}</span>
                  ))}
                </div>
              )}
            </div>

            {/* P/T overlay for creatures - positioned in lower right like real MTG cards */}
            {isCreature && typeof pDisp === 'number' && typeof tDisp === 'number' && (
              <div style={{
                position: 'absolute', 
                right: Math.round(4 * scale), 
                bottom: Math.round(4 * scale),
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: Math.round(2 * scale),
                zIndex: 20,
              }}>
                {/* Main P/T badge */}
                <div 
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: Math.round(2 * scale),
                    padding: `${Math.round(3 * scale)}px ${Math.round(8 * scale)}px`,
                    borderRadius: Math.round(6 * scale),
                    background: 'linear-gradient(135deg, rgba(40,40,50,0.95), rgba(25,25,35,0.98))',
                    border: hasPTModifiers 
                      ? '2px solid rgba(255,215,0,0.7)' 
                      : hasDamage 
                        ? '2px solid rgba(239,68,68,0.7)' 
                        : '2px solid rgba(200,200,200,0.4)',
                    boxShadow: hasPTModifiers 
                      ? '0 2px 8px rgba(255,215,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' 
                      : hasDamage
                        ? '0 2px 8px rgba(239,68,68,0.3), inset 0 1px 0 rgba(255,255,255,0.1)'
                        : '0 2px 6px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.1)',
                    cursor: (hasPTModifiers || hasDamage) ? 'help' : 'default',
                    minWidth: Math.round(36 * scale),
                    justifyContent: 'center',
                  }}
                  title={buildPTTooltip({
                    baseP,
                    baseT,
                    plusCounters,
                    minusCounters,
                    ptSources,
                    damageMarked,
                    effectiveToughness: tDisp,
                    conditionalLines: conditionalPtBonusLines(raw),
                    variableLines: variablePtLines(raw),
                  })}
                >
                  <span style={{
                    fontSize: Math.round(14 * scale),
                    fontWeight: 700,
                    color: getPTColor(baseP, pDisp),
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  }}>
                    {pDisp}
                  </span>
                  <span style={{
                    fontSize: Math.round(11 * scale),
                    color: '#9ca3af',
                    fontWeight: 600,
                  }}>/</span>
                  <span style={{
                    fontSize: Math.round(14 * scale),
                    fontWeight: 700,
                    color: getPTColor(baseT, tDisp),
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  }}>
                    {tDisp}
                  </span>
                </div>

                {/* Sustained damage indicator */}
                {hasDamage && tDisp !== undefined && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: Math.round(2 * scale),
                    padding: `${Math.round(2 * scale)}px ${Math.round(5 * scale)}px`,
                    borderRadius: Math.round(4 * scale),
                    background: 'linear-gradient(135deg, rgba(239,68,68,0.9), rgba(185,28,28,0.9))',
                    border: '1px solid rgba(252,165,165,0.6)',
                    boxShadow: '0 2px 6px rgba(239,68,68,0.4)',
                  }}>
                    <span style={{ fontSize: Math.round(8 * scale) }}>💔</span>
                    <span style={{
                      fontSize: Math.round(10 * scale),
                      fontWeight: 600,
                      color: '#fff',
                      textShadow: '0 1px 1px rgba(0,0,0,0.3)',
                    }}>
                      {damageMarked}/{tDisp}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Loyalty display for planeswalkers - positioned in lower right corner */}
            {isPlaneswalker && loyalty !== undefined && (
              <div style={{
                position: 'absolute',
                right: Math.round(4 * scale),
                bottom: Math.round(4 * scale),
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: Math.round(3 * scale),
                zIndex: 20,
              }}>
                {/* Loyalty shield badge - reduced 20% from original 32x36 */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: Math.round(26 * scale),
                  height: Math.round(29 * scale),
                  background: 'linear-gradient(180deg, rgba(80,60,120,0.95) 0%, rgba(50,30,80,0.98) 100%)',
                  border: '2px solid #a78bfa',
                  borderRadius: `${Math.round(3 * scale)}px ${Math.round(3 * scale)}px ${Math.round(13 * scale)}px ${Math.round(13 * scale)}px`,
                  boxShadow: '0 3px 10px rgba(139,92,246,0.5), inset 0 1px 0 rgba(255,255,255,0.2)',
                  position: 'relative',
                }}>
                  {/* Inner glow */}
                  <div style={{
                    position: 'absolute',
                    inset: 2,
                    background: 'radial-gradient(ellipse at center, rgba(168,139,250,0.3) 0%, transparent 70%)',
                    borderRadius: 'inherit',
                    pointerEvents: 'none',
                  }} />
                  <span style={{
                    fontSize: Math.round(11 * scale),
                    fontWeight: 700,
                    color: getLoyaltyColor(baseLoyalty, loyalty),
                    textShadow: '0 1px 3px rgba(0,0,0,0.6), 0 0 8px rgba(168,139,250,0.4)',
                    position: 'relative',
                    zIndex: 1,
                  }}>
                    {loyalty}
                  </span>
                </div>
                {baseLoyalty !== undefined && baseLoyalty !== loyalty && (
                  <span style={{
                    fontSize: Math.round(9 * scale),
                    color: '#c4b5fd',
                    fontWeight: 500,
                    textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                  }}>
                    start {baseLoyalty}
                  </span>
                )}
              </div>
            )}

            {/* Activated Ability Buttons - for non-planeswalkers or non-loyalty abilities */}
            {showNonPlaneswalkerAbilityButtons && (
              <ActivatedAbilityButtons
                perm={raw}
                battlefield={allBattlefieldPerms || perms}
                tileWidth={tileWidth}
                hasPriority={hasPriority}
                isOwnTurn={isOwnTurn}
                isMainPhase={isMainPhase}
                stackEmpty={stackEmpty}
                currentStep={currentStep}
                hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                onActivateAbility={onActivateAbility}
                viewerPlayerId={playerId}
                showOnHover={false}
                maxVisible={5}
                position="left"
                manaAbilitiesOnly={isActivationManaOnly(raw)}
              />
            )}

            {/* Planeswalker Loyalty Ability Buttons - inline on left side */}
            {showActivatedAbilityButtons && raw.controller === playerId && isPlaneswalker && !activationFullyLocked && !isActivationManaOnly(raw) && (
              <>
                <ActivatedAbilityButtons
                  perm={raw}
                  battlefield={allBattlefieldPerms || perms}
                  tileWidth={tileWidth}
                  hasPriority={hasPriority}
                  isOwnTurn={isOwnTurn}
                  isMainPhase={isMainPhase}
                  stackEmpty={stackEmpty}
                  currentStep={currentStep}
                  hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                  onActivateAbility={onActivateAbility}
                  showOnHover={false}
                  maxVisible={6}
                  position="loyalty-inline"
                  loyaltyAbilitiesOnly={true}
                />
              </>
            )}
    </>
  );
}
