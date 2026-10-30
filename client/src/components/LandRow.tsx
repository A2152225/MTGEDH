import React, { useMemo, useState, useCallback } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { CardContextMenu } from './CardContextMenu';
import { ActivatedAbilityButtons } from './ActivatedAbilityButtons';
import { AbilitySelectionModal } from './AbilitySelectionModal';
import { parseActivatedAbilities, getActivatedAbilityActivationStatus, type ParsedActivatedAbility, type ActivationContext } from '../utils/activatedAbilityParser';
import { getPlayableCardHighlight } from '../utils/appearanceSettings';
import { textAllowsAnyPlayerActivation } from '../../../shared/src/anyPlayerActivatedAbility';
import { resolvePlayerBadgeLabel } from '../utils/playerBadgeLabel';
import { faceDownPublicLabel } from '../utils/faceDownUi';

function canonicalLandKey(typeLine?: string, name?: string) {
  const tl = (typeLine || '').toLowerCase();
  if (/\bplains\b/.test(tl)) return 'plains';
  if (/\bisland\b/.test(tl)) return 'island';
  if (/\bswamp\b/.test(tl)) return 'swamp';
  if (/\bmountain\b/.test(tl)) return 'mountain';
  if (/\bforest\b/.test(tl)) return 'forest';
  if (/\bwastes\b/.test(tl)) return 'wastes';
  return (name || '').toLowerCase() || 'land';
}

/**
 * Parse numeric P/T from string like "2" or "*" -> number or undefined
 */
function parsePT(val?: string): number | undefined {
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

/**
 * Get effective P/T for a permanent (base + counters + buffs)
 */
function getEffectivePT(perm: BattlefieldPermanent): {
  baseP?: number;
  baseT?: number;
  p?: number;
  t?: number;
} {
  const kc = perm.card as KnownCardRef;
  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power ? String(kc.power) : undefined);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness ? String(kc.toughness) : undefined);

  // If server provided effective stats (includes counters + continuous buffs), prefer them.
  const effP = (perm as any).effectivePower as number | undefined;
  const effT = (perm as any).effectiveToughness as number | undefined;

  if (typeof effP === 'number' && typeof effT === 'number') {
    return { baseP, baseT, p: effP, t: effT };
  }

  // Fallback: base + (+1/+1 -1/-1) counters only (client-side approximation).
  if (typeof baseP === 'number' && typeof baseT === 'number') {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const delta = plus - minus;
    return { baseP, baseT, p: baseP + delta, t: baseT + delta };
  }

  return { baseP, baseT, p: undefined, t: undefined };
}

/**
 * Get badge colors based on P/T delta
 */
function ptBadgeColors(baseP?: number, baseT?: number, p?: number, t?: number): { bg: string; border: string } {
  if (typeof baseP === 'number' && typeof baseT === 'number' && typeof p === 'number' && typeof t === 'number') {
    const delta = (p - baseP) + (t - baseT);
    if (delta > 0) return { bg: 'rgba(56,161,105,0.85)', border: 'rgba(46,204,113,0.95)' }; // green
    if (delta < 0) return { bg: 'rgba(229,62,62,0.85)', border: 'rgba(245,101,101,0.95)' }; // red
  }
  return { bg: 'rgba(0,0,0,0.65)', border: 'rgba(255,255,255,0.25)' }; // neutral
}

export function LandRow(props: {
  lands: BattlefieldPermanent[];
  allBattlefieldPerms?: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth?: number;     // default 110
  overlapRatio?: number;  // consecutive same-type overlap (0..1), default 0.33 (33%)
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  // Context menu callbacks
  onTap?: (id: string) => void;
  onUntap?: (id: string) => void;
  onActivateAbility?: (permanentId: string, abilityId: string, ability?: ParsedActivatedAbility, xValue?: number) => void;
  onSacrifice?: (id: string) => void;
  canActivate?: boolean;
  playerId?: string;
  // Auto-pass ignore callbacks
  onIgnoreForAutoPass?: (permanentId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForAutoPass?: (permanentId: string) => void;
  ignoredForAutoPassIds?: Set<string>;
  // Game state for ability activation (for double-click feature)
  hasPriority?: boolean;
  isOwnTurn?: boolean;
  isMainPhase?: boolean;
  stackEmpty?: boolean;
  currentStep?: string;
  hasThousandYearElixirEffect?: boolean;
  showActivatedAbilityButtons?: boolean;
  playableCards?: string[];
  appearanceSettings?: any;
  players?: readonly { id?: string; name?: string }[];
}) {
  const {
    lands,
    allBattlefieldPerms,
    imagePref,
    tileWidth = 110,
    overlapRatio = 0.33,
    highlightTargets,
    selectedTargets,
    onCardClick,
    onRemove,
    onCounter,
    onTap, onUntap, onActivateAbility, onSacrifice,
    canActivate = true, playerId,
    onIgnoreForAutoPass, onUnignoreForAutoPass, ignoredForAutoPassIds,
    hasPriority = false,
    isOwnTurn = false,
    isMainPhase = false,
    stackEmpty = true,
    currentStep,
    hasThousandYearElixirEffect = false,
    showActivatedAbilityButtons = false,
    playableCards = [],
    appearanceSettings,
    players,
  } = props;

  const items = useMemo(() => lands.map(p => {
    const kc = p.card as KnownCardRef;
    const { baseP, baseT, p: dispP, t: dispT } = getEffectivePT(p);
    const isCreature = (kc?.type_line || '').toLowerCase().includes('creature');
    const colors = ptBadgeColors(baseP, baseT, dispP, dispT);
    const isGroupedTokens = (p as any).isGroupedTokens === true;
    const tokenCount = (p as any).tokenCount as number | undefined;
    const isToken = (p as any).isToken === true;
    return {
      id: p.id,
      name: faceDownPublicLabel(p) || kc?.name || (kc as any)?.displayName || p.id,
      typeLine: kc?.type_line || '',
      img: kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small,
      tapped: !!p.tapped,
      counters: p.counters || {},
      key: canonicalLandKey(kc?.type_line, kc?.name),
      perm: p,
      isCreature,
      baseP,
      baseT,
      dispP,
      dispT,
      colors,
      isGroupedTokens,
      tokenCount,
      isToken,
    };
  }), [lands, imagePref]);

  const [hovered, setHovered] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ permanent: BattlefieldPermanent; x: number; y: number } | null>(null);
  
  // State for ability selection modal (shown on double-click when multiple abilities exist)
  const [abilitySelectionModal, setAbilitySelectionModal] = useState<{
    permanent: BattlefieldPermanent;
    abilities: { ability: ParsedActivatedAbility; canActivate: boolean; reason?: string }[];
  } | null>(null);

  // Handle double-click on a land / mana-source tile
  const handleDoubleClick = useCallback((perm: BattlefieldPermanent) => {
    if (!onActivateAbility) {
      window.alert('Cannot activate: game not ready.');
      return;
    }
    const isOwnPermanent = String(perm.controller || '') === String(playerId || '');
    if (isOwnPermanent && !canActivate) {
      window.alert('Cannot activate: not your battlefield or game not ready.');
      return;
    }
    if (!isOwnPermanent && !hasPriority) {
      window.alert('Cannot activate: you need priority.');
      return;
    }

    const kc = perm.card as KnownCardRef;
    if (!kc) {
      window.alert('Cannot activate: card data missing on this permanent.');
      return;
    }

    // Parse abilities from the card (include granted lines / attachment grants)
    const parsed = parseActivatedAbilities(kc, perm.grantedAbilities, {
      permanent: perm,
      battlefield: allBattlefieldPerms || lands,
    });
    const abilities = isOwnPermanent ? parsed : parsed.filter((ability) => ability.anyPlayerMayActivate);
    if (abilities.length === 0) {
      window.alert(`No activated abilities found on ${kc.name || perm.id}.`);
      return;
    }

    // Mana rocks / lands in this row: no summoning sickness.
    // (Creature mana dorks still gated via isManaAbility + tap checks on FreeField.)
    const context: ActivationContext = {
      isTapped: !!perm.tapped,
      hasSummoningSickness: false,
      hasHaste: false,
      hasThousandYearElixirEffect: hasThousandYearElixirEffect,
      loyaltyCounters: undefined,
      controllerHasPriority: hasPriority,
      isMainPhase,
      isOwnTurn,
      stackEmpty,
      currentStep,
    };

    const annotatedAbilities = abilities.map(ability => {
      const status = getActivatedAbilityActivationStatus(
        ability,
        perm,
        context,
        allBattlefieldPerms || lands,
      );
      return { ability, canActivate: status.canActivate, reason: status.reason };
    });

    const activatableAbilities = annotatedAbilities.filter(a => a.canActivate);

    // Single activatable ability -> fire immediately (always emit)
    if (activatableAbilities.length === 1 && abilities.length === 1) {
      onActivateAbility(perm.id, activatableAbilities[0].ability.id, activatableAbilities[0].ability);
      return;
    }

    // Multiple abilities, OR single ability that cannot activate: show modal with reasons
    // (never silent-return — user must see why Add {C} is blocked).
    setAbilitySelectionModal({ permanent: perm, abilities: annotatedAbilities });
  }, [allBattlefieldPerms, canActivate, onActivateAbility, playerId, hasPriority, isMainPhase, isOwnTurn, stackEmpty, currentStep, hasThousandYearElixirEffect, lands]);

  // Handle ability selection from modal
  const handleAbilitySelect = useCallback((ability: ParsedActivatedAbility) => {
    if (abilitySelectionModal && onActivateAbility) {
      onActivateAbility(abilitySelectionModal.permanent.id, ability.id, ability);
    }
    setAbilitySelectionModal(null);
  }, [abilitySelectionModal, onActivateAbility]);

  return (
    <>
    <div
      style={{ display: 'flex', alignItems: 'flex-start', gap: 8, overflowX: 'auto', paddingBottom: 4, overscrollBehavior: 'contain' as any }}
      data-no-zoom
      onWheel={(e) => e.stopPropagation()}
    >
      {items.map((it, idx) => {
        const prev = items[idx - 1];
        const sameTypeAsPrev = prev && prev.key === it.key;
        const overlapPx = sameTypeAsPrev ? Math.floor(tileWidth * overlapRatio) : 0;

        const isHighlight = highlightTargets?.has(it.id) ?? false;
        const isSelected = selectedTargets?.has(it.id) ?? false;
        const isHovered = hovered === it.id;
        const isPlayable = playableCards.includes(it.id);

        const baseBorder = isSelected ? '#2b6cb0' : isHighlight ? '#38a169' : '#2b2b2b';
        const borderColor = isHovered && isHighlight && !isSelected ? '#2ecc71' : baseBorder;
        const boxShadow = isSelected
          ? '0 0 0 2px rgba(43,108,176,0.6)'
          : isHighlight
            ? '0 0 0 2px rgba(56,161,105,0.45)'
            : isPlayable
              ? getPlayableCardHighlight(appearanceSettings)
              : 'none';

        return (
          <div
            key={it.id}
            onMouseEnter={(e) => { setHovered(it.id); showCardPreview(e.currentTarget as HTMLElement, (it.perm.card as any), { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHovered(prev => prev === it.id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={onCardClick ? () => onCardClick(it.id) : undefined}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDoubleClick(it.perm);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ permanent: it.perm, x: e.clientX, y: e.clientY });
            }}
            style={{
              position: 'relative',
              width: tileWidth,
              aspectRatio: '0.72',
              overflow: 'hidden',
              border: `2px solid ${borderColor}`,
              borderRadius: 6,
              background: '#0f0f0f',
              transform: it.tapped ? 'rotate(14deg)' : 'none',
              marginLeft: overlapPx ? -overlapPx : undefined,
              boxShadow,
              cursor: onCardClick ? 'pointer' : 'default'
            }}
            title={it.name + (it.tapped ? ' (tapped)' : '')}
          >
            {it.img ? (
              <img src={it.img} alt={it.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {it.name}
              </div>
            )}
            <div style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
              color: '#fff', fontSize: 12, padding: '6px 8px',
              borderBottomLeftRadius: 6, borderBottomRightRadius: 6
            }}>
              <div title={it.name} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
            </div>

            {/* Token count badge - keep TokenOptimization groups collapsed (same as FreeField) */}
            {((it.isGroupedTokens && it.tokenCount && it.tokenCount > 1) || (it.isToken && it.tokenCount && it.tokenCount > 1)) && (
              <div style={{
                position: 'absolute',
                top: 6,
                left: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 24,
                height: 20,
                padding: '2px 6px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, rgba(147,51,234,0.95), rgba(126,34,206,0.95))',
                border: '2px solid rgba(255,255,255,0.4)',
                boxShadow: '0 2px 8px rgba(147,51,234,0.6), inset 0 1px 0 rgba(255,255,255,0.2)',
                zIndex: 25,
              }}>
                <span style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                }}>
                  {it.tokenCount}x
                </span>
              </div>
            )}

            {/* Tapped badge */}
            {it.tapped && (
              <div style={{
                position: 'absolute',
                top: ((it.isGroupedTokens && it.tokenCount && it.tokenCount > 1) || (it.isToken && it.tokenCount && it.tokenCount > 1)) ? 30 : 6,
                left: 6,
                background: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontSize: 10,
                padding: '2px 6px',
                borderRadius: 4
              }}>
                Tapped
              </div>
            )}

            {/* ETB Choice Badges - Show selected color, creature type, card name, player, or option */}
            {(() => {
              const badges = [];
              const itAny = it.perm as any;
              
              if (itAny.chosenColor) {
                const colorMap: Record<string, { bg: string; name: string }> = {
                  white: { bg: '#f9fafb', name: 'White' },
                  blue: { bg: '#3b82f6', name: 'Blue' },
                  black: { bg: '#1f2937', name: 'Black' },
                  red: { bg: '#ef4444', name: 'Red' },
                  green: { bg: '#22c55e', name: 'Green' },
                };
                const colorInfo = colorMap[itAny.chosenColor.toLowerCase()] || { bg: '#6b7280', name: itAny.chosenColor };
                badges.push(
                  <div
                    key="color"
                    style={{
                      background: colorInfo.bg,
                      color: itAny.chosenColor === 'white' ? '#000' : '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
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
              
              if (itAny.chosenCreatureType) {
                badges.push(
                  <div
                    key="creatureType"
                    style={{
                      background: 'rgba(139, 92, 246, 0.85)', // Purple
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen creature type: ${itAny.chosenCreatureType}`}
                  >
                    ⚔ {itAny.chosenCreatureType}
                  </div>
                );
              }
              
              if (itAny.chosenCardName) {
                badges.push(
                  <div
                    key="cardName"
                    style={{
                      background: 'rgba(234, 88, 12, 0.85)', // Orange
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      maxWidth: '80px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Named card: ${itAny.chosenCardName}`}
                  >
                    ✦ {itAny.chosenCardName}
                  </div>
                );
              }
              
              if (itAny.chosenPlayer) {
                const chosenPlayerLabel = resolvePlayerBadgeLabel(itAny.chosenPlayer, players, itAny.chosenPlayerName);
                badges.push(
                  <div
                    key="player"
                    style={{
                      background: 'rgba(236, 72, 153, 0.85)', // Pink
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
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
              
              if (itAny.chosenOption) {
                badges.push(
                  <div
                    key="option"
                    style={{
                      background: 'rgba(14, 165, 233, 0.85)', // Cyan
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
                      fontWeight: 655,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={`Chosen option: ${itAny.chosenOption}`}
                  >
                    ✓ {itAny.chosenOption}
                  </div>
                );
              }

              if (itAny.hideawayCard) {
                const hiddenCard = itAny.hideawayCard.card;
                badges.push(
                  <div
                    key="hideaway"
                    style={{
                      background: 'rgba(88, 28, 135, 0.9)',
                      color: '#fff',
                      fontSize: 9,
                      padding: '2px 5px',
                      borderRadius: 4,
                      fontWeight: 650,
                      border: '1px solid rgba(255,255,255,0.3)',
                      whiteSpace: 'nowrap',
                    }}
                    title={hiddenCard?.name ? `Hideaway: ${hiddenCard.name}` : 'A card is hidden here (Hideaway)'}
                    onMouseEnter={hiddenCard ? (e) => {
                      e.stopPropagation();
                      showCardPreview(e.currentTarget as HTMLElement, hiddenCard, { prefer: 'above', anchorPadding: 0 });
                    } : undefined}
                    onMouseLeave={hiddenCard ? (e) => {
                      e.stopPropagation();
                      showCardPreview(e.currentTarget as HTMLElement, (it.perm.card as any), { prefer: 'above', anchorPadding: 0 });
                    } : undefined}
                  >
                    Hideaway
                  </div>
                );
              }
              
              return badges.length > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    bottom: 42,
                    left: 6,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    maxWidth: '90%',
                    zIndex: 18,
                  }}
                >
                  {badges}
                </div>
              ) : null;
            })()}

            {/* P/T overlay for creatures with color-coded delta vs base */}
            {it.isCreature && typeof it.dispP === 'number' && typeof it.dispT === 'number' && (
              <div style={{
                position: 'absolute',
                right: 6,
                bottom: 26,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 2
              }}>
                <div style={{
                  padding: '2px 6px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  background: it.colors.bg,
                  border: `1px solid ${it.colors.border}`,
                  borderRadius: 6
                }}>
                  {it.dispP}/{it.dispT}
                </div>
                {(typeof it.baseP === 'number' && typeof it.baseT === 'number') && (
                  <div style={{ fontSize: 10, color: '#ddd', opacity: 0.9 }}>
                    base {it.baseP}/{it.baseT}
                  </div>
                )}
              </div>
            )}

            {/* Controls only when hovered */}
            {isHovered && (onCounter || onRemove) && (
              <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 4 }}>
                {onCounter && (<>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', +1); }} title="+1/+1 +1">+1</button>
                  <button onClick={(e) => { e.stopPropagation(); onCounter!(it.id, '+1/+1', -1); }} title="+1/+1 -1">-1</button>
                </>)}
                {onRemove && <button onClick={(e) => { e.stopPropagation(); onRemove!(it.id); }} title="Remove">✕</button>}
              </div>
            )}

            {showActivatedAbilityButtons && playerId && (() => {
              const permanent = lands.find((entry) => entry.id === it.id) || (it as any);
              if (!permanent) return null;
              const isOwn = String(permanent.controller || '') === String(playerId || '');
              if (!isOwn && !textAllowsAnyPlayerActivation(permanent.card?.oracle_text)) return null;
              return (
                <ActivatedAbilityButtons
                  perm={permanent}
                  battlefield={allBattlefieldPerms || lands}
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
                  maxVisible={4}
                  position="left"
                />
              );
            })()}
          </div>
        );
      })}
    </div>
    
    {/* Context Menu */}
    {contextMenu && (
      <CardContextMenu
        permanent={contextMenu.permanent}
        battlefield={allBattlefieldPerms || lands}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        onTap={onTap}
        onUntap={onUntap}
        onActivateAbility={onActivateAbility}
        onAddCounter={onCounter}
        onSacrifice={onSacrifice}
        onRemove={onRemove}
        onIgnoreForAutoPass={onIgnoreForAutoPass}
        onUnignoreForAutoPass={onUnignoreForAutoPass}
        isIgnoredForAutoPass={ignoredForAutoPassIds?.has(contextMenu.permanent.id) || false}
        canActivate={canActivate}
        playerId={playerId}
        hasPriority={hasPriority}
        isOwnTurn={isOwnTurn}
        isMainPhase={isMainPhase}
        stackEmpty={stackEmpty}
        currentStep={currentStep}
        hasThousandYearElixirEffect={hasThousandYearElixirEffect}
      />
    )}

    {/* Ability Selection Modal (for double-click with multiple abilities) */}
    {abilitySelectionModal && (
      <AbilitySelectionModal
        open={true}
        cardName={(abilitySelectionModal.permanent.card as KnownCardRef)?.name || 'Unknown'}
        cardImageUrl={(abilitySelectionModal.permanent.card as KnownCardRef)?.image_uris?.normal || 
                     (abilitySelectionModal.permanent.card as KnownCardRef)?.image_uris?.small}
        abilities={abilitySelectionModal.abilities}
        onSelect={handleAbilitySelect}
        onCancel={() => setAbilitySelectionModal(null)}
      />
    )}
    </>
  );
}
