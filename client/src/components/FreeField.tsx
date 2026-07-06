import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { getKeywordInfo, KEYWORD_GLOSSARY } from '../utils/keywordGlossary';
import { CardContextMenu } from './CardContextMenu';
import { ActivatedAbilityButtons } from './ActivatedAbilityButtons';
import { AbilitySelectionModal } from './AbilitySelectionModal';
import { parseActivatedAbilities, canActivateTapAbility, getConditionalManaAbilityStatus, getThresholdActivationStatus, parseStationThreshold, type ParsedActivatedAbility, type ActivationContext } from '../utils/activatedAbilityParser';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayableCardHighlight } from '../utils/appearanceSettings';
import { hasCurrentHaste, isCurrentlyCreature } from '../utils/creatureUtils';
import {
  assignPermanentsToCells,
  arrowKeyToShiftDirection,
  BATTLEFIELD_SCROLL_VISIBLE_ROWS,
  battlefieldGridContentHeight,
  battlefieldGridContentHeightForRows,
  buildDisplayPositions,
  columnCountFromWidth,
  computeRequiredGridRows,
  countOccupiedCells,
  createBattlefieldGridFromDimensions,
  shiftCell,
  snapPixelToCell,
} from '../utils/battlefieldGrid';

/** Resolve real server permanent IDs for layout moves (grouped tokens use synthetic display IDs). */
function permanentIdsForPositionUpdate(item: {
  id: string;
  isGroupedTokens?: boolean;
  groupedTokenIds?: string[];
}): string[] {
  const groupedIds = item.groupedTokenIds;
  if (item.isGroupedTokens && Array.isArray(groupedIds) && groupedIds.length > 0) {
    return groupedIds;
  }
  if (item.id.startsWith('group_')) {
    const suffix = item.id.slice('group_'.length);
    if (suffix) return [suffix];
  }
  return [item.id];
}

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
  /** Rows visible before scrolling when the playmat is collapsed. */
  viewportRows?: number;
  /** When true, the playmat grows to fit all rows (no scroll cap). */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  showExpandControl?: boolean;
  draggable?: boolean;
  onMove?: (id: string, x: number, y: number, z?: number) => void;
  highlightTargets?: ReadonlySet<string>;
  selectedTargets?: ReadonlySet<string>;
  onCardClick?: (id: string) => void;
  players?: { id: string; name: string }[];
  // Context menu callbacks
  onTap?: (id: string) => void;
  onUntap?: (id: string) => void;
  onActivateAbility?: (permanentId: string, abilityId: string, ability?: ParsedActivatedAbility, xValue?: number) => void;
  onAddCounter?: (id: string, kind: string, delta: number) => void;
  onSacrifice?: (id: string) => void;
  onRemove?: (id: string) => void;
  onExchangeTextBoxes?: (sourceId: string) => void;
  canActivate?: boolean;
  playerId?: string;
  // Auto-pass ignore callbacks
  onIgnoreForAutoPass?: (permanentId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForAutoPass?: (permanentId: string) => void;
  ignoredForAutoPassIds?: Set<string>;
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
    perms, allBattlefieldPerms, imagePref, tileWidth, widthPx,
    viewportRows = BATTLEFIELD_SCROLL_VISIBLE_ROWS,
    expanded = false,
    onToggleExpanded,
    showExpandControl = false,
    draggable = false, onMove, highlightTargets, selectedTargets, onCardClick,
    players = [],
    onTap, onUntap, onActivateAbility, onAddCounter, onSacrifice, onRemove,
    onExchangeTextBoxes,
    canActivate = true, playerId,
    onIgnoreForAutoPass, onUnignoreForAutoPass, ignoredForAutoPassIds,
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ permanent: BattlefieldPermanent; x: number; y: number } | null>(null);
  const fieldRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; grabOffsetX: number; grabOffsetY: number; z?: number } | null>(null);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [isPointerDragging, setIsPointerDragging] = useState(false);
  /** Stable grid slots for permanents without server-persisted positions (survives re-renders/reorders). */
  const autoPositionCache = useRef(new Map<string, { x: number; y: number }>());
  /** Bumped after keyboard moves so layout useMemo re-runs (cache alone does not re-render). */
  const [layoutRevision, setLayoutRevision] = useState(0);

  // State for ability selection modal (shown on double-click when multiple abilities exist)
  const [abilitySelectionModal, setAbilitySelectionModal] = useState<{
    permanent: BattlefieldPermanent;
    abilities: { ability: ParsedActivatedAbility; canActivate: boolean; reason?: string }[];
  } | null>(null);

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
    const abilities = parseActivatedAbilities(kc, perm.grantedAbilities);
    if (abilities.length === 0) return;

    // Build activation context
    const context: ActivationContext = {
      isTapped: !!perm.tapped,
      hasSummoningSickness: !!perm.summoningSickness && isCurrentlyCreature(perm),
      hasHaste: hasCurrentHaste(perm, allBattlefieldPerms || perms),
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
      const thresholdCheck = getThresholdActivationStatus(ability, perm);
      const conditionalManaCheck = getConditionalManaAbilityStatus(ability, perm, allBattlefieldPerms || perms);
      let canActivateAbility = tapCheck.canActivate && thresholdCheck.canActivate && conditionalManaCheck.canActivate;
      let reason = conditionalManaCheck.reason || thresholdCheck.reason || tapCheck.reason;

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
  }, [allBattlefieldPerms, canActivate, onActivateAbility, playerId, getLoyaltyCounters,
      hasPriority, isMainPhase, isOwnTurn, stackEmpty, hasThousandYearElixirEffect]);

  // Handle ability selection from modal
  const handleAbilitySelect = useCallback((ability: ParsedActivatedAbility) => {
    if (abilitySelectionModal && onActivateAbility) {
      onActivateAbility(abilitySelectionModal.permanent.id, ability.id, ability);
    }
    setAbilitySelectionModal(null);
  }, [abilitySelectionModal, onActivateAbility]);

  const battlefieldLayout = useMemo(() => {
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
      // Grouped token support
      isGroupedTokens?: boolean;
      tokenCount?: number;
      groupedTokenIds?: string[];
      isToken?: boolean;
      stackIndex?: number;
      stackTotal?: number;
      cellX?: number;
      cellY?: number;
    }> = [];

    const placementEntries: Array<{ id: string; preferred: { x: number; y: number; z?: number } | null }> = [];
    const permMeta = new Map<string, Omit<(typeof placed)[number], 'id' | 'pos' | 'stackIndex' | 'stackTotal' | 'cellX' | 'cellY'>>();

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

      // Debug logging for planeswalkers
      if (isPlaneswalker) {
        console.log('[PLANESWALKER DEBUG]', {
          name: kc?.name,
          isPlaneswalker,
          loyalty,
          baseLoyalty,
          'p.loyalty': p.loyalty,
          'p.baseLoyalty': p.baseLoyalty,
          'p.counters.loyalty': p.counters?.['loyalty'],
          'kc.loyalty': (kc as any)?.loyalty,
          hasOracleText: !!kc?.oracle_text,
          oracleTextPreview: kc?.oracle_text?.substring(0, 100),
        });
      }

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

      // Grouped token properties
      const isGroupedTokens = (p as any).isGroupedTokens === true;
      const tokenCount = (p as any).tokenCount as number | undefined;
      const groupedTokenIds = (p as any).groupedTokenIds as string[] | undefined;
      const isToken = (p as any).isToken === true;

      const counters = p.counters || {};
      const legacyPos = (p as any).pos;
      const existing =
        legacyPos && typeof legacyPos.x === 'number' && typeof legacyPos.y === 'number'
          ? { ...legacyPos }
          : typeof p.posX === 'number' && typeof p.posY === 'number'
            ? {
                x: p.posX,
                y: p.posY,
                ...(typeof p.posZ === 'number' ? { z: p.posZ } : {}),
              }
            : null;
      const cached = autoPositionCache.current.get(p.id);
      const preferred = cached
        ? {
            x: cached.x,
            y: cached.y,
            ...(typeof existing?.z === 'number' ? { z: existing.z } : {}),
          }
        : existing
          ? { ...existing }
          : null;

      placementEntries.push({ id: p.id, preferred });
      permMeta.set(p.id, {
        name,
        img,
        tapped: !!p.tapped,
        isCreature,
        isPlaneswalker,
        counters,
        baseP,
        baseT,
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
        isGroupedTokens,
        tokenCount,
        groupedTokenIds,
        isToken,
      });
    }

    const cols = columnCountFromWidth(widthPx, tileWidth);
    const rows = computeRequiredGridRows(placementEntries, cols, tileWidth);
    const grid = createBattlefieldGridFromDimensions(cols, rows, tileWidth);
    const cellPlacements = assignPermanentsToCells(placementEntries, grid);
    const displayById = buildDisplayPositions(cellPlacements, grid);
    const occupied = countOccupiedCells(cellPlacements);
    const totalSlots = grid.cols * grid.rows;

    for (const placement of cellPlacements) {
      const meta = permMeta.get(placement.permanentId);
      const display = displayById.get(placement.permanentId);
      if (!meta || !display) continue;

      autoPositionCache.current.set(placement.permanentId, {
        x: placement.cellX,
        y: placement.cellY,
      });

      placed.push({
        id: placement.permanentId,
        ...meta,
        pos: {
          x: display.x,
          y: display.y,
          ...(typeof placement.z === 'number' ? { z: placement.z } : {}),
        },
        cellX: placement.cellX,
        cellY: placement.cellY,
        stackIndex: display.stackIndex,
        stackTotal: display.stackTotal,
      });
    }
    // Evict stale auto-positions for permanents that are no longer on the battlefield.
    const currentIds = new Set(perms.map(p => p.id));
    for (const key of autoPositionCache.current.keys()) {
      if (!currentIds.has(key)) {
        autoPositionCache.current.delete(key);
      }
    }
    return {
      items: placed,
      gridLayout: grid,
      slotStats: { occupied, total: totalSlots, rows: grid.rows, cols: grid.cols },
      contentHeightPx: battlefieldGridContentHeight(grid),
    };
  }, [perms, allBattlefieldPerms, imagePref, tileWidth, tileH, widthPx, layoutRevision]);

  const items = battlefieldLayout.items;
  const gridLayout = battlefieldLayout.gridLayout;
  const slotStats = battlefieldLayout.slotStats;
  const contentHeightPx = battlefieldLayout.contentHeightPx;

  const viewportCapPx = useMemo(
    () => battlefieldGridContentHeightForRows(viewportRows, tileWidth),
    [viewportRows, tileWidth],
  );

  const needsScroll = !expanded && contentHeightPx > viewportCapPx;

  /** Map screen pointer coords to battlefield-local pixels (handles table zoom + scroll). */
  const pointerClientToFieldLocal = useCallback((clientX: number, clientY: number) => {
    const field = fieldRef.current;
    if (!field) return { x: 0, y: 0 };
    const rect = field.getBoundingClientRect();
    const scaleX = rect.width > 0 ? field.offsetWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? field.offsetHeight / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }, []);

  const autoScrollDuringDrag = useCallback((clientY: number) => {
    const scrollEl = scrollRef.current;
    if (!scrollEl || !needsScroll) return;
    const rect = scrollEl.getBoundingClientRect();
    const edgeZone = 56;
    const step = 16;
    const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
    if (clientY < rect.top + edgeZone) {
      scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - step);
    } else if (clientY > rect.bottom - edgeZone) {
      scrollEl.scrollTop = Math.min(maxScroll, scrollEl.scrollTop + step);
    }
  }, [needsScroll]);

  const updateDragPreviewFromPointer = useCallback((clientX: number, clientY: number) => {
    const active = drag.current;
    if (!active) return;
    autoScrollDuringDrag(clientY);
    const local = pointerClientToFieldLocal(clientX, clientY);
    const nx = Math.round(local.x - active.grabOffsetX);
    const ny = Math.round(local.y - active.grabOffsetY);
    const snapped = snapPixelToCell(
      clamp(nx, 0, Math.max(0, widthPx - tileWidth)),
      clamp(ny, 0, Math.max(0, contentHeightPx - tileH)),
      gridLayout,
    );
    setDragPreview({ id: active.id, x: snapped.x, y: snapped.y });
  }, [autoScrollDuringDrag, contentHeightPx, gridLayout, pointerClientToFieldLocal, tileH, tileWidth, widthPx]);

  const dragTargetCell = useMemo(() => {
    if (!dragPreview) return null;
    return snapPixelToCell(dragPreview.x, dragPreview.y, gridLayout);
  }, [dragPreview, gridLayout]);

  const keyboardTargetCell = useMemo(() => {
    if (!hoverId) return null;
    const item = items.find((entry) => entry.id === hoverId);
    if (!item) return null;
    const baseX = item.cellX ?? item.pos?.x ?? 0;
    const baseY = item.cellY ?? item.pos?.y ?? 0;
    return snapPixelToCell(baseX, baseY, gridLayout);
  }, [hoverId, items, gridLayout]);

  const moveCardByArrow = useCallback((permanentId: string, key: string): boolean => {
    if (!draggable || !onMove) return false;
    const direction = arrowKeyToShiftDirection(key);
    if (!direction) return false;

    const item = items.find((entry) => entry.id === permanentId);
    if (!item) return false;

    const baseX = item.cellX ?? item.pos?.x ?? 0;
    const baseY = item.cellY ?? item.pos?.y ?? 0;
    const current = snapPixelToCell(baseX, baseY, gridLayout);
    const next = shiftCell(current.col, current.row, direction, gridLayout);
    if (next.col === current.col && next.row === current.row) {
      return false;
    }

    autoPositionCache.current.set(permanentId, { x: next.x, y: next.y });
    for (const id of permanentIdsForPositionUpdate(item)) {
      onMove(id, next.x, next.y, item.pos?.z);
    }
    setLayoutRevision((v) => v + 1);
    return true;
  }, [draggable, onMove, items, gridLayout]);

  useEffect(() => {
    if (!draggable || !hoverId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = arrowKeyToShiftDirection(event.key);
      if (!direction) return;

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
      }

      if (moveCardByArrow(hoverId, event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [draggable, hoverId, moveCardByArrow]);

  const releaseFieldPointerCapture = useCallback((pointerId: number) => {
    const field = fieldRef.current;
    if (field?.hasPointerCapture(pointerId)) {
      field.releasePointerCapture(pointerId);
    }
  }, []);

  const finishDrag = useCallback((
    e?: { clientX: number; clientY: number; altKey?: boolean },
    commit = true,
  ) => {
    const active = drag.current;
    if (!active) {
      setDragPreview(null);
      setIsPointerDragging(false);
      return;
    }

    if (commit && e && onMove) {
      const local = pointerClientToFieldLocal(e.clientX, e.clientY);
      const nx = Math.round(local.x - active.grabOffsetX);
      const ny = Math.round(local.y - active.grabOffsetY);
      const snapped = snapPixelToCell(
        clamp(nx, 0, Math.max(0, widthPx - tileWidth)),
        clamp(ny, 0, Math.max(0, contentHeightPx - tileH)),
        gridLayout,
      );
      const bumpZ = e.altKey ? ((active.z ?? 0) + 1) : active.z;
      autoPositionCache.current.set(active.id, { x: snapped.x, y: snapped.y });
      const dragged = items.find((entry) => entry.id === active.id);
      const idsToUpdate = dragged ? permanentIdsForPositionUpdate(dragged) : [active.id];
      for (const id of idsToUpdate) {
        onMove(id, snapped.x, snapped.y, bumpZ);
      }
      setLayoutRevision((v) => v + 1);
    }

    drag.current = null;
    setDragPreview(null);
    setIsPointerDragging(false);
  }, [gridLayout, contentHeightPx, items, onMove, pointerClientToFieldLocal, tileH, tileWidth, widthPx]);

  const cancelDrag = useCallback(() => {
    finishDrag(undefined, false);
  }, [finishDrag]);

  useEffect(() => {
    if (!isPointerDragging) return;

    const onBlur = () => cancelDrag();
    const onGlobalPointerMove = (event: PointerEvent) => {
      if (!drag.current) return;
      if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
        releaseFieldPointerCapture(event.pointerId);
        cancelDrag();
        return;
      }
      event.preventDefault();
      updateDragPreviewFromPointer(event.clientX, event.clientY);
    };
    const onGlobalPointerUp = (event: PointerEvent) => {
      if (!drag.current) return;
      releaseFieldPointerCapture(event.pointerId);
      finishDrag(event, true);
    };
    const onGlobalPointerCancel = (event: PointerEvent) => {
      releaseFieldPointerCapture(event.pointerId);
      cancelDrag();
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('pointermove', onGlobalPointerMove, true);
    window.addEventListener('pointerup', onGlobalPointerUp);
    window.addEventListener('pointercancel', onGlobalPointerCancel);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointermove', onGlobalPointerMove, true);
      window.removeEventListener('pointerup', onGlobalPointerUp);
      window.removeEventListener('pointercancel', onGlobalPointerCancel);
    };
  }, [cancelDrag, finishDrag, isPointerDragging, releaseFieldPointerCapture, updateDragPreviewFromPointer]);

  const onPointerDown = (id: string, e: React.PointerEvent) => {
    if (!draggable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const item = items.find(x => x.id === id);
    if (!item) return;
    const local = pointerClientToFieldLocal(e.clientX, e.clientY);
    const baseX = item.cellX ?? item.pos?.x ?? 0;
    const baseY = item.cellY ?? item.pos?.y ?? 0;
    fieldRef.current?.setPointerCapture(e.pointerId);
    drag.current = {
      id,
      grabOffsetX: local.x - baseX,
      grabOffsetY: local.y - baseY,
      z: item.pos?.z,
    };
    setHoverId(id);
    setIsPointerDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
      releaseFieldPointerCapture(e.pointerId);
      cancelDrag();
      return;
    }
    e.preventDefault();
    updateDragPreviewFromPointer(e.clientX, e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    releaseFieldPointerCapture(e.pointerId);
    finishDrag(e, true);
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    releaseFieldPointerCapture(e.pointerId);
    cancelDrag();
  };

  const renderItems = useMemo(() => {
    if (!dragPreview) return items;
    const dragged = items.find((entry) => entry.id === dragPreview.id);
    if (!dragged) return items;
    return [...items.filter((entry) => entry.id !== dragPreview.id), dragged];
  }, [items, dragPreview]);

  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

  // Scale factor with minimum to ensure readability
  const rawScale = tileWidth / 110;
  const scale = Math.max(0.7, rawScale);

  return (
    <div style={{ width: widthPx }}>
      {(showExpandControl || slotStats.rows > viewportRows) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 6,
            fontSize: 11,
            color: '#cbd5e1',
          }}
        >
          <span>
            Battlefield: {slotStats.occupied}/{slotStats.total} slots
            {slotStats.rows > viewportRows && !expanded ? ` · ${slotStats.rows} rows` : ''}
          </span>
          {showExpandControl && onToggleExpanded && (
            <button
              type="button"
              onClick={onToggleExpanded}
              style={{
                minHeight: 32,
                padding: '4px 10px',
                borderRadius: 6,
                border: '1px solid rgba(148, 163, 184, 0.45)',
                background: expanded ? 'rgba(59, 130, 246, 0.25)' : 'rgba(15, 23, 42, 0.85)',
                color: '#e2e8f0',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
              title={expanded ? 'Collapse playmat to scrollable viewport' : 'Expand playmat to show all rows'}
            >
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        data-no-zoom
        style={{
          width: widthPx,
          maxHeight: expanded ? undefined : viewportCapPx,
          overflowY: needsScroll ? 'auto' : 'visible',
          overflowX: 'hidden',
          borderRadius: 8,
          border: '1px dashed rgba(255,255,255,0.15)',
          background: 'rgba(0,0,0,0.18)',
          WebkitOverflowScrolling: 'touch',
        }}
      >
    <div
      ref={fieldRef}
      style={{
        position: 'relative',
        width: widthPx,
        height: contentHeightPx,
        background: 'rgba(0,0,0,0.25)',
        overflow: 'visible', // Allow attack indicators to overflow
        touchAction: draggable ? 'none' : undefined,
      }}
      tabIndex={draggable ? 0 : undefined}
      onPointerMove={draggable ? onPointerMove : undefined}
      onPointerUp={draggable ? onPointerUp : undefined}
      onPointerCancel={draggable ? onPointerCancel : undefined}
      onMouseLeave={() => setHoverId(null)}
    >
      {draggable && hoverId && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 6,
            transform: 'translateX(-50%)',
            zIndex: 2000,
            pointerEvents: 'none',
            fontSize: 11,
            color: '#cbd5e1',
            background: 'rgba(15, 23, 42, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.45)',
            borderRadius: 6,
            padding: '4px 10px',
            whiteSpace: 'nowrap',
            boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
          }}
        >
          Arrow keys: move one tile · drop or move onto an occupied tile to stack
        </div>
      )}

      {/* Grid slot guides */}
      {Array.from({ length: gridLayout.rows }, (_, row) =>
        Array.from({ length: gridLayout.cols }, (_, col) => {
          const isDropTarget = dragTargetCell?.col === col && dragTargetCell?.row === row;
          const isKeyboardTarget = keyboardTargetCell?.col === col && keyboardTargetCell?.row === row;
          return (
            <div
              key={`grid-${col}-${row}`}
              style={{
                position: 'absolute',
                left: col * gridLayout.cellW,
                top: row * gridLayout.cellH,
                width: gridLayout.tileWidth,
                height: gridLayout.tileH,
                borderRadius: 6,
                border: isDropTarget || isKeyboardTarget
                  ? '2px dashed rgba(96, 165, 250, 0.75)'
                  : '1px dashed rgba(255, 255, 255, 0.07)',
                background: isDropTarget || isKeyboardTarget
                  ? 'rgba(59, 130, 246, 0.12)'
                  : 'rgba(255, 255, 255, 0.02)',
                pointerEvents: 'none',
                boxSizing: 'border-box',
              }}
            />
          );
        }),
      )}

      {renderItems.map(({ id, name, img, pos, tapped, isCreature, isPlaneswalker, counters, baseP, baseT, raw, effP, effT, abilities, attacking, blocking, blockedBy, baseLoyalty, loyalty, targetedBy, temporaryEffects, attachedTo, attachedToName, hasAttachments, attachmentNames, damageMarked, ptSources, isGroupedTokens, tokenCount, isToken, stackIndex, stackTotal }) => {
        const isDragging = dragPreview?.id === id;
        const x = clamp((isDragging ? dragPreview.x : pos?.x) ?? 0, 0, Math.max(0, widthPx - tileWidth));
        const y = clamp((isDragging ? dragPreview.y : pos?.y) ?? 0, 0, Math.max(0, contentHeightPx - tileH));
        const z = pos?.z ?? 0;
        const inStack = (stackTotal ?? 1) > 1;
        const isTopOfStack = inStack && stackIndex === (stackTotal ?? 1) - 1;

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
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            onPointerDown={(e) => onPointerDown(id, e)}
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
              if (drag.current) cancelDrag();
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
              zIndex: 10 + z + (stackIndex ?? 0) + (isDragging ? 1000 : 0) + (hovered ? 100 : 0) + (isAttacking ? 50 : 0),
              cursor: draggable ? 'grab' : (onCardClick ? 'pointer' : 'default'),
              border: `${borderWidth}px solid ${borderColor}`,
              borderRadius: 6,
              overflow: 'visible', // Allow indicators to overflow
              background: '#0f0f0f',
              transform: tapped ? 'rotate(14deg)' : 'none',
              opacity: inStack && !isDragging && (stackIndex ?? 0) < (stackTotal ?? 1) - 1 ? 0.92 : 1,
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
            title={
              name
              + (tapped ? ' (tapped)' : '')
              + (inStack ? ` (stack ${(stackIndex ?? 0) + 1}/${stackTotal})` : '')
              + (draggable && hoverId === id ? ' — Arrow keys: move tile' : '')
            }
          >
            {inStack && isTopOfStack && (
              <div
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  zIndex: 5,
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#e2e8f0',
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(148, 163, 184, 0.5)',
                  borderRadius: 4,
                  padding: '1px 5px',
                  pointerEvents: 'none',
                }}
              >
                {stackTotal} in tile
              </div>
            )}
            {img ? (
              <img
                src={img}
                alt={name}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 4, pointerEvents: 'none' }}
              />
            ) : (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#eee', fontSize: 12, padding: 8 }}>
                {name}
              </div>
            )}

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
                    title={`Chosen player: ${pAny.chosenPlayer}`}
                  >
                    👤 {pAny.chosenPlayer}
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
            {showActivatedAbilityButtons && raw.controller === playerId && !isPlaneswalker && (
              <ActivatedAbilityButtons
                perm={raw}
                battlefield={allBattlefieldPerms || perms}
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
              <>
                <ActivatedAbilityButtons
                  perm={raw}
                  battlefield={allBattlefieldPerms || perms}
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
              </>
            )}
          </div>
        );
      })}
    </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <CardContextMenu
          permanent={contextMenu.permanent}
          battlefield={allBattlefieldPerms || perms}
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
          onIgnoreForAutoPass={onIgnoreForAutoPass}
          onUnignoreForAutoPass={onUnignoreForAutoPass}
          isIgnoredForAutoPass={ignoredForAutoPassIds?.has(contextMenu.permanent.id) || false}
          canActivate={canActivate}
          playerId={playerId}
          hasPriority={hasPriority}
          isOwnTurn={isOwnTurn}
          isMainPhase={isMainPhase}
          stackEmpty={stackEmpty}
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
    </div>
  );
}
