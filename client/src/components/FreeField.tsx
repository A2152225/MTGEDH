import React, { useMemo, useRef, useState, useCallback } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { getKeywordInfo, KEYWORD_GLOSSARY } from '../utils/keywordGlossary';
import { CardContextMenu } from './CardContextMenu';
import { ActivatedAbilityButtons } from './ActivatedAbilityButtons';
import { AbilitySelectionModal } from './AbilitySelectionModal';
import { parseActivatedAbilities, canActivateTapAbility, type ParsedActivatedAbility, type ActivationContext } from '../utils/activatedAbilityParser';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayableCardHighlight } from '../utils/appearanceSettings';

function parsePT(raw?: string | number): number | undefined {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return parseInt(raw, 10);
  return undefined;
}

function computeDisplayPT(perm: BattlefieldPermanent): {
  baseP?: number;
  baseT?: number;
  p?: number;
  t?: number;
} {
  const kc = perm.card as KnownCardRef;
  const baseP = typeof perm.basePower === 'number' ? perm.basePower : parsePT(kc?.power);
  const baseT = typeof perm.baseToughness === 'number' ? perm.baseToughness : parsePT(kc?.toughness);

  const effP = (perm as any).effectivePower as number | undefined;
  const effT = (perm as any).effectiveToughness as number | undefined;

  if (typeof effP === 'number' && typeof effT === 'number') {
    return { baseP, baseT, p: effP, t: effT };
  }

  if (typeof baseP === 'number' && typeof baseT === 'number') {
    const plus = perm.counters?.['+1/+1'] ?? 0;
    const minus = perm.counters?.['-1/-1'] ?? 0;
    const delta = plus - minus;
    return { baseP, baseT, p: baseP + delta, t: baseT + delta };
  }
  return { baseP, baseT, p: undefined, t: undefined };
}

// Color coding for P/T changes
function getPTColor(base: number | undefined, effective: number | undefined): string {
  if (base === undefined || effective === undefined) return '#ffffff';
  if (effective > base) return '#22c55e'; // Green - increased
  if (effective < base) return '#ef4444'; // Red - decreased
  return '#d1d5db'; // Neutral gray - unchanged
}

// Color coding for loyalty changes
function getLoyaltyColor(base: number | undefined, current: number | undefined): string {
  if (base === undefined || current === undefined) return '#c084fc';
  if (current > base) return '#22c55e'; // Green - increased
  if (current < base) return '#ef4444'; // Red - decreased
  return '#c084fc'; // Purple - unchanged
}

/**
 * Build P/T tooltip content showing breakdown of modifiers and damage
 */
function buildPTTooltip(params: {
  baseP?: number;
  baseT?: number;
  plusCounters: number;
  minusCounters: number;
  ptSources?: { name: string; power: number; toughness: number }[];
  damageMarked?: number;
  effectiveToughness?: number;
}): string | undefined {
  const { baseP, baseT, plusCounters, minusCounters, ptSources, damageMarked, effectiveToughness } = params;
  
  const hasModifiers = plusCounters > 0 || minusCounters > 0 || (ptSources && ptSources.length > 0);
  const hasDamage = (damageMarked ?? 0) > 0;
  
  if (!hasModifiers && !hasDamage) {
    return undefined;
  }
  
  const lines: string[] = [];
  
  // Base P/T
  lines.push(`Base: ${baseP ?? '?'}/${baseT ?? '?'}`);
  
  // +1/+1 counters
  if (plusCounters > 0) {
    lines.push(`${plusCounters}× +1/+1`);
  }
  
  // -1/-1 counters
  if (minusCounters > 0) {
    lines.push(`${minusCounters}× -1/-1`);
  }
  
  // Other P/T sources
  if (ptSources && ptSources.length > 0) {
    for (const source of ptSources) {
      const pStr = source.power >= 0 ? `+${source.power}` : `${source.power}`;
      const tStr = source.toughness >= 0 ? `+${source.toughness}` : `${source.toughness}`;
      lines.push(`${source.name}: ${pStr}/${tStr}`);
    }
  }
  
  // Damage
  if (hasDamage && effectiveToughness !== undefined) {
    lines.push('');  // Empty line before damage
    lines.push(`💔 Damage: ${damageMarked}/${effectiveToughness}`);
  }
  
  return lines.join('\n');
}

// Get ability info from glossary, with fallback
function getAbilityDisplay(abilityName: string): { short: string; color: string; reminderText: string; term: string } {
  const info = getKeywordInfo(abilityName);
  if (info) {
    return {
      short: info.short,
      color: info.color,
      reminderText: info.reminderText,
      term: info.term,
    };
  }
  // Fallback for unknown abilities
  return {
    short: abilityName.slice(0, 3).toUpperCase(),
    color: '#6b7280',
    reminderText: abilityName,
    term: abilityName,
  };
}

export function FreeField(props: {
  perms: BattlefieldPermanent[];
  allBattlefieldPerms?: BattlefieldPermanent[]; // All permanents across all players (for attachment lookups)
  imagePref: ImagePref;
  tileWidth: number;
  widthPx: number;
  heightPx: number;
  draggable?: boolean;
  onMove?: (id: string, x: number, y: number, z?: number) => void;
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  players?: { id: string; name: string }[];
  // Context menu callbacks
  onTap?: (id: string) => void;
  onUntap?: (id: string) => void;
  onActivateAbility?: (permanentId: string, abilityId: string, ability?: ParsedActivatedAbility) => void;
  onAddCounter?: (id: string, kind: string, delta: number) => void;
  onSacrifice?: (id: string) => void;
  onRemove?: (id: string) => void;
  onExchangeTextBoxes?: (sourceId: string) => void;
  canActivate?: boolean;
  playerId?: string;
  // Game state for ability activation context
  hasPriority?: boolean;
  isOwnTurn?: boolean;
  isMainPhase?: boolean;
  stackEmpty?: boolean;
  // Thousand-Year Elixir and similar effects
  hasThousandYearElixirEffect?: boolean;
  // Display options for ability buttons
  showActivatedAbilityButtons?: boolean;
  // Playable cards highlighting
  playableCards?: string[];
  // Appearance settings for custom highlight color
  appearanceSettings?: AppearanceSettings;
}) {
  const {
    perms, allBattlefieldPerms, imagePref, tileWidth, widthPx, heightPx,
    draggable = false, onMove, highlightTargets, selectedTargets, onCardClick,
    players = [],
    onTap, onUntap, onActivateAbility, onAddCounter, onSacrifice, onRemove,
    onExchangeTextBoxes,
    canActivate = true, playerId,
    hasPriority = false,
    isOwnTurn = false,
    isMainPhase = false,
    stackEmpty = true,
    hasThousandYearElixirEffect = false,
    showActivatedAbilityButtons = true,
    playableCards = [],
    appearanceSettings,
  } = props;

  const tileH = Math.round(tileWidth / 0.72);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ permanent: BattlefieldPermanent; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; startX: number; startY: number; baseX: number; baseY: number; z?: number } | null>(null);
  
  // State for ability selection modal (shown on double-click when multiple abilities exist)
  const [abilitySelectionModal, setAbilitySelectionModal] = useState<{
    permanent: BattlefieldPermanent;
    abilities: { ability: ParsedActivatedAbility; canActivate: boolean; reason?: string }[];
  } | null>(null);

  // Check if a creature has haste (for summoning sickness check)
  const hasHaste = useCallback((perm: BattlefieldPermanent): boolean => {
    const abilities = perm.grantedAbilities || [];
    if (abilities.some(a => a.toLowerCase() === 'haste')) return true;
    const kc = perm.card as KnownCardRef;
    const oracleText = (kc?.oracle_text || '').toLowerCase();
    return oracleText.includes('haste');
  }, []);

  // Check if a permanent is a creature
  const isCreature = useCallback((perm: BattlefieldPermanent): boolean => {
    const kc = perm.card as KnownCardRef;
    const typeLine = (kc?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  }, []);

  // Get loyalty counters for planeswalkers
  const getLoyaltyCounters = useCallback((perm: BattlefieldPermanent): number | undefined => {
    if (perm.loyalty !== undefined) return perm.loyalty;
    if (perm.counters?.['loyalty'] !== undefined) return perm.counters['loyalty'];
    return undefined;
  }, []);

  // Handle double-click on a battlefield permanent
  const handleDoubleClick = useCallback((perm: BattlefieldPermanent) => {
    if (!canActivate || !onActivateAbility || perm.controller !== playerId) return;

    const kc = perm.card as KnownCardRef;
    if (!kc) return;

    // Parse abilities from the card
    const abilities = parseActivatedAbilities(kc);
    if (abilities.length === 0) return;

    // Build activation context
    const context: ActivationContext = {
      isTapped: !!perm.tapped,
      hasSummoningSickness: !!perm.summoningSickness && isCreature(perm),
      hasHaste: hasHaste(perm),
      hasThousandYearElixirEffect,
      loyaltyCounters: getLoyaltyCounters(perm),
      controllerHasPriority: hasPriority,
      isMainPhase,
      isOwnTurn,
      stackEmpty,
    };

    // Annotate abilities with activation status
    const annotatedAbilities = abilities.map(ability => {
      const tapCheck = canActivateTapAbility(ability.requiresTap, context, ability.isManaAbility);
      let canActivateAbility = tapCheck.canActivate;
      let reason = tapCheck.reason;

      // Check loyalty ability restrictions
      if (ability.isLoyaltyAbility) {
        if (!context.isMainPhase) {
          canActivateAbility = false;
          reason = 'Only during main phase';
        } else if (!context.isOwnTurn) {
          canActivateAbility = false;
          reason = 'Only on your turn';
        } else if (!context.stackEmpty) {
          canActivateAbility = false;
          reason = 'Stack must be empty';
        } else if (ability.loyaltyCost !== undefined && context.loyaltyCounters !== undefined) {
          if (ability.loyaltyCost < 0 && context.loyaltyCounters < Math.abs(ability.loyaltyCost)) {
            canActivateAbility = false;
            reason = 'Not enough loyalty';
          }
        }
      }

      // Check sorcery timing restriction
      if (ability.timingRestriction === 'sorcery') {
        if (!context.isMainPhase || !context.isOwnTurn || !context.stackEmpty) {
          canActivateAbility = false;
          reason = 'Sorcery timing required';
        }
      }

      // Need priority for non-mana abilities
      if (!ability.isManaAbility && !context.controllerHasPriority) {
        canActivateAbility = false;
        reason = 'No priority';
      }

      return { ability, canActivate: canActivateAbility, reason };
    });

    // Filter to only activatable abilities for direct activation
    const activatableAbilities = annotatedAbilities.filter(a => a.canActivate);

    // If only one ability and it can be activated, activate it directly
    if (abilities.length === 1) {
      if (activatableAbilities.length === 1) {
        onActivateAbility(perm.id, activatableAbilities[0].ability.id, activatableAbilities[0].ability);
      }
      return;
    }

    // If multiple abilities, show the selection modal
    setAbilitySelectionModal({ permanent: perm, abilities: annotatedAbilities });
  }, [canActivate, onActivateAbility, playerId, hasHaste, isCreature, getLoyaltyCounters,
      hasPriority, isMainPhase, isOwnTurn, stackEmpty, hasThousandYearElixirEffect]);

  // Handle ability selection from modal
  const handleAbilitySelect = useCallback((ability: ParsedActivatedAbility) => {
    if (abilitySelectionModal && onActivateAbility) {
      onActivateAbility(abilitySelectionModal.permanent.id, ability.id, ability);
    }
    setAbilitySelectionModal(null);
  }, [abilitySelectionModal, onActivateAbility]);

  const items = useMemo(() => {
    const placed: Array<{
      id: string;
      name: string;
      img?: string | null;
      tapped: boolean;
      isCreature: boolean;
      isPlaneswalker: boolean;
      counters: Record<string, number>;
      baseP?: number;
      baseT?: number;
      pos: { x: number; y: number; z?: number } | null;
      kc: KnownCardRef | null;
      raw: BattlefieldPermanent;
      effP?: number;
      effT?: number;
      abilities?: readonly string[];
      attacking?: PlayerID;
      blocking?: string[];
      blockedBy?: string[];
      baseLoyalty?: number;
      loyalty?: number;
      targetedBy?: string[];
      temporaryEffects?: readonly { id: string; description: string; icon?: string; expiresAt?: string; sourceName?: string }[];
      attachedTo?: string;
      attachedToName?: string;
      hasAttachments?: boolean;
      attachmentNames?: string[];
      damageMarked?: number;
      ptSources?: { name: string; power: number; toughness: number }[];
    }> = [];

    const gap = 10;
    const cols = Math.max(1, Math.floor((widthPx + gap) / (tileWidth + gap)));
    let autoIndex = 0;

    function nextAuto() {
      const i = autoIndex++;
      const row = Math.floor(i / cols);
      const col = i % cols;
      const x = Math.min(widthPx - tileWidth, col * (tileWidth + gap));
      const y = Math.min(heightPx - tileH, row * (tileH + gap));
      return { x, y };
    }

    for (const p of perms) {
      const kc = p.card as KnownCardRef;
      const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small || null;
      const name = kc?.name || p.id;
      const tl = (kc?.type_line || '').toLowerCase();
      const isCreature = /\bcreature\b/.test(tl);
      const isPlaneswalker = /\bplaneswalker\b/.test(tl);

      const baseP = typeof p.basePower === 'number' ? p.basePower : parsePT(kc?.power);
      const baseT = typeof p.baseToughness === 'number' ? p.baseToughness : parsePT(kc?.toughness);

      const effP = (p as any).effectivePower as number | undefined;
      const effT = (p as any).effectiveToughness as number | undefined;
      const abilities: readonly string[] | undefined = (p as any).grantedAbilities;

      // Combat state
      const attacking = p.attacking;
      const blocking = p.blocking;
      const blockedBy = p.blockedBy;

      // Planeswalker loyalty
      const baseLoyalty = p.baseLoyalty ?? parsePT((kc as any)?.loyalty);
      const loyalty = p.loyalty ?? p.counters?.['loyalty'];

      // Targeting
      const targetedBy = p.targetedBy;

      // Temporary effects
      const temporaryEffects = (p as any).temporaryEffects;

      // Attachment info - use allBattlefieldPerms to find cross-player attachments
      // This fixes the issue where auras attached to opponent's creatures couldn't show the badge
      const attachedTo = p.attachedTo;
      let attachedToName: string | undefined;
      if (attachedTo) {
        // First try allBattlefieldPerms (includes all players' permanents)
        const lookupPerms = allBattlefieldPerms || perms;
        const attachedPerm = lookupPerms.find(perm => perm.id === attachedTo);
        if (attachedPerm && attachedPerm.card) {
          const attachedCard = attachedPerm.card as any;
          if (typeof attachedCard.name === 'string') {
            attachedToName = attachedCard.name;
          }
        }
      }

      // Find equipment/auras attached TO this permanent
      const attachedEquipment = perms.filter(perm => perm.attachedTo === p.id);
      const hasAttachments = attachedEquipment.length > 0;
      const attachmentNames = attachedEquipment.map(eq => {
        const eqCard = eq.card as any;
        return typeof eqCard?.name === 'string' ? eqCard.name : 'Equipment';
      });

      // Damage marked on the creature
      const damageMarked = p.damageMarked ?? 0;

      // P/T bonus sources
      const ptSources = p.ptSources || [];

      const counters = p.counters || {};
      const existing = (p as any).pos || null;
      const pos = existing ? { ...existing } : nextAuto();
      placed.push({
        id: p.id,
        name,
        img,
        tapped: !!p.tapped,
        isCreature,
        isPlaneswalker,
        counters,
        baseP,
        baseT,
        pos,
        kc: kc || null,
        raw: p,
        effP,
        effT,
        abilities,
        attacking,
        blocking,
        blockedBy,
        baseLoyalty,
        loyalty,
        targetedBy,
        temporaryEffects,
        attachedTo,
        attachedToName,
        hasAttachments,
        attachmentNames,
        damageMarked,
        ptSources,
      });
    }
    return placed;
  }, [perms, allBattlefieldPerms, imagePref, tileWidth, tileH, widthPx, heightPx]);

  const onPointerDown = (id: string, e: React.PointerEvent) => {
    if (!draggable) return;
    const item = items.find(x => x.id === id);
    if (!item) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      baseX: item.pos?.x ?? 0,
      baseY: item.pos?.y ?? 0,
      z: item.pos?.z
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.preventDefault();
  };

  const onPointerUp = (id: string, e: React.PointerEvent) => {
    if (!drag.current) return;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    }
    const dx = e.clientX - drag.current.startX;
    const dy = e.clientY - drag.current.startY;
    let nx = Math.round(drag.current.baseX + dx);
    let ny = Math.round(drag.current.baseY + dy);
    nx = clamp(nx, 0, Math.max(0, widthPx - tileWidth));
    ny = clamp(ny, 0, Math.max(0, heightPx - tileH));
    const bumpZ = e.altKey ? ((drag.current.z ?? 0) + 1) : drag.current.z;
    onMove && onMove(drag.current.id, nx, ny, bumpZ);
    drag.current = null;
  };

  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

  // Scale factor with minimum to ensure readability
  const rawScale = tileWidth / 110;
  const scale = Math.max(0.7, rawScale);

  return (
    <div
      style={{
        position: 'relative',
        width: widthPx,
        height: heightPx,
        border: '1px dashed rgba(255,255,255,0.15)',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.25)',
        overflow: 'visible' // Allow attack indicators to overflow
      }}
    >
      {items.map(({ id, name, img, pos, tapped, isCreature, isPlaneswalker, counters, baseP, baseT, raw, effP, effT, abilities, attacking, blocking, blockedBy, baseLoyalty, loyalty, targetedBy, temporaryEffects, attachedTo, attachedToName, hasAttachments, attachmentNames, damageMarked, ptSources }) => {
        const x = clamp(pos?.x ?? 0, 0, Math.max(0, widthPx - tileWidth));
        const y = clamp(pos?.y ?? 0, 0, Math.max(0, heightPx - tileH));
        const z = pos?.z ?? 0;

        const isHighlight = highlightTargets?.has(id) ?? false;
        const isSelected = selectedTargets?.has(id) ?? false;
        const isAttacking = !!attacking;
        const isBlocking = blocking && blocking.length > 0;
        const isTargeted = targetedBy && targetedBy.length > 0;
        const hasTemporaryEffects = temporaryEffects && temporaryEffects.length > 0;
        const isAttached = !!attachedTo;

        // Check for P/T modifiers (counters or ptSources)
        const plusCounters = counters['+1/+1'] ?? 0;
        const minusCounters = counters['-1/-1'] ?? 0;
        const hasPTModifiers = plusCounters > 0 || minusCounters > 0 || (ptSources && ptSources.length > 0);
        const hasDamage = (damageMarked ?? 0) > 0;

        // Check if this card should be highlighted due to attachment hover
        // 1. If hovering an equipment/aura, highlight the creature it's attached to
        // 2. If hovering a creature, highlight equipment/auras attached to it
        const hoveredItem = hoverId ? items.find(i => i.id === hoverId) : null;
        const isAttachmentHighlighted = 
          // This card is the creature that the hovered equipment is attached to
          (hoveredItem?.attachedTo === id) ||
          // This card is equipment attached to the hovered creature
          (attachedTo && attachedTo === hoverId);

        // Border color based on state
        let borderColor = '#2b2b2b';
        let borderWidth = 2;
        if (isSelected) borderColor = '#2b6cb0';
        else if (isHighlight) borderColor = '#38a169';
        else if (isAttachmentHighlighted) { borderColor = '#a855f7'; borderWidth = 3; } // Bright purple for attachment highlight
        else if (isAttacking) borderColor = '#ef4444';
        else if (isBlocking) borderColor = '#3b82f6';
        else if (isTargeted) borderColor = '#f59e0b';
        else if (isAttached) borderColor = '#8b5cf6'; // Purple for attached
        else if (hasAttachments) borderColor = '#7c3aed'; // Violet for has attachments

        // Decide display PT
        let pDisp: number | undefined = effP;
        let tDisp: number | undefined = effT;

        if (typeof pDisp !== 'number' || typeof tDisp !== 'number') {
          if (typeof baseP === 'number' && typeof baseT === 'number') {
            const plus = counters['+1/+1'] ?? 0;
            const minus = counters['-1/-1'] ?? 0;
            const delta = plus - minus;
            pDisp = baseP + delta;
            tDisp = baseT + delta;
          }
        }

        const hovered = hoverId === id;
        const attackingPlayerName = attacking ? players.find(p => p.id === attacking)?.name || attacking : null;
        const isPlayable = playableCards.includes(id);

        return (
          <div
            key={id}
            onPointerDown={(e) => onPointerDown(id, e)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(id, e)}
            onMouseEnter={(e) => { setHoverId(id); showCardPreview(e.currentTarget as HTMLElement, raw.card as any, { prefer: 'above', anchorPadding: 0 }); }}
            onMouseLeave={(e) => { setHoverId(prev => prev === id ? null : prev); hideCardPreview(e.currentTarget as HTMLElement); }}
            onClick={() => onCardClick && onCardClick(id)}
            onDoubleClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleDoubleClick(raw);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ permanent: raw, x: e.clientX, y: e.clientY });
            }}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: tileWidth,
              aspectRatio: '0.72',
              userSelect: 'none',
              touchAction: 'none',
              zIndex: 10 + z + (hovered ? 100 : 0) + (isAttacking ? 50 : 0),
              cursor: draggable ? 'grab' : (onCardClick ? 'pointer' : 'default'),
              border: `${borderWidth}px solid ${borderColor}`,
              borderRadius: 6,
              overflow: 'visible', // Allow indicators to overflow
              background: '#0f0f0f',
              transform: tapped ? 'rotate(14deg)' : 'none',
              transformOrigin: '50% 50%',
              boxShadow: isPlayable
                ? getPlayableCardHighlight(appearanceSettings)
                : isAttachmentHighlighted
                  ? '0 0 16px rgba(168,85,247,0.7)' // Purple glow for attachment highlight
                  : isAttacking 
                    ? '0 0 12px rgba(239,68,68,0.6)' 
                    : isBlocking 
                      ? '0 0 12px rgba(59,130,246,0.6)' 
                      : isTargeted 
                        ? '0 0 8px rgba(245,158,11,0.5)' 
                        : hasAttachments
                          ? '0 0 6px rgba(139,92,246,0.4)' // Subtle glow for cards with attachments
                          : 'none',
            }}
            title={name + (tapped ? ' (tapped)' : '')}
          >
            {img ? (
              <img src={img} alt={name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4 }} />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {name}
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
            {Array.isArray(abilities) && abilities.length > 0 && (
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
            )}

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
                {/* Loyalty shield badge */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: Math.round(32 * scale),
                  height: Math.round(36 * scale),
                  background: 'linear-gradient(180deg, rgba(80,60,120,0.95) 0%, rgba(50,30,80,0.98) 100%)',
                  border: '2px solid #a78bfa',
                  borderRadius: `${Math.round(4 * scale)}px ${Math.round(4 * scale)}px ${Math.round(16 * scale)}px ${Math.round(16 * scale)}px`,
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
                    fontSize: Math.round(14 * scale),
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
            {showActivatedAbilityButtons && raw.controller === playerId && !isPlaneswalker && (
              <ActivatedAbilityButtons
                perm={raw}
                tileWidth={tileWidth}
                hasPriority={hasPriority}
                isOwnTurn={isOwnTurn}
                isMainPhase={isMainPhase}
                stackEmpty={stackEmpty}
                hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                onActivateAbility={onActivateAbility}
                showOnHover={false}
                maxVisible={5}
                position="left"
              />
            )}

            {/* Planeswalker Loyalty Ability Buttons - inline on left side */}
            {showActivatedAbilityButtons && raw.controller === playerId && isPlaneswalker && (
              <ActivatedAbilityButtons
                perm={raw}
                tileWidth={tileWidth}
                hasPriority={hasPriority}
                isOwnTurn={isOwnTurn}
                isMainPhase={isMainPhase}
                stackEmpty={stackEmpty}
                hasThousandYearElixirEffect={hasThousandYearElixirEffect}
                onActivateAbility={onActivateAbility}
                showOnHover={false}
                maxVisible={6}
                position="loyalty-inline"
                loyaltyAbilitiesOnly={true}
              />
            )}
          </div>
        );
      })}
      
      {/* Context Menu */}
      {contextMenu && (
        <CardContextMenu
          permanent={contextMenu.permanent}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onTap={onTap}
          onUntap={onUntap}
          onActivateAbility={onActivateAbility}
          onAddCounter={onAddCounter}
          onSacrifice={onSacrifice}
          onRemove={onRemove}
          onExchangeTextBoxes={onExchangeTextBoxes}
          canActivate={canActivate}
          playerId={playerId}
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
    </div>
  );
}
