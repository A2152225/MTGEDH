import React, { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import type { BattlefieldPermanent, KnownCardRef } from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { showCardPreview, hideCardPreview } from './CardPreviewLayer';
import { CardContextMenu } from './CardContextMenu';
import { permanentIdsForPositionUpdate } from './FreeField-handlers/freeFieldDisplayUtils';
import { FreeFieldPermanentOverlays } from './FreeField-handlers/FreeFieldPermanentOverlays';
import { useFreeFieldBattlefieldLayout } from './FreeField-handlers/useFreeFieldBattlefieldLayout';
import { AbilitySelectionModal } from './AbilitySelectionModal';
import { parseActivatedAbilities, canActivateTapAbility, getConditionalManaAbilityStatus, getThresholdActivationStatus, type ParsedActivatedAbility, type ActivationContext } from '../utils/activatedAbilityParser';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayableCardHighlight } from '../utils/appearanceSettings';
import { hasCurrentHaste, isCurrentlyCreature } from '../utils/creatureUtils';
import {
  arrowKeyToShiftDirection,
  BATTLEFIELD_SCROLL_VISIBLE_ROWS,
  battlefieldGridContentHeightForRows,
  shiftCell,
  snapPixelToCell,
} from '../utils/battlefieldGrid';



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
  showAbilityBadges?: boolean;
  onToggleAbilityBadges?: () => void;
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
  currentStep?: string;
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
    showAbilityBadges = false,
    onToggleAbilityBadges,
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
    currentStep,
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

    // Parse abilities from the card (include quoted grants from attachments)
    const abilities = parseActivatedAbilities(kc, perm.grantedAbilities, {
      permanent: perm,
      battlefield: allBattlefieldPerms || perms,
    });
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
      currentStep,
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

  const battlefieldLayout = useFreeFieldBattlefieldLayout({
    perms,
    allBattlefieldPerms,
    imagePref,
    tileWidth,
    tileH,
    widthPx,
    layoutRevision,
    autoPositionCache,
  });

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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {showExpandControl && onToggleAbilityBadges && (
              <button
                type="button"
                onClick={onToggleAbilityBadges}
                style={{
                  minHeight: 32,
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid rgba(148, 163, 184, 0.45)',
                  background: showAbilityBadges ? 'rgba(16, 185, 129, 0.28)' : 'rgba(15, 23, 42, 0.85)',
                  color: '#e2e8f0',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title={showAbilityBadges ? 'Hide activated-ability badges on permanents' : 'Show activated-ability badges (click a badge to activate)'}
              >
                {showAbilityBadges ? 'Abilities: On' : 'Abilities: Off'}
              </button>
            )}
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

            <FreeFieldPermanentOverlays
              scale={scale}
              name={name}
              raw={raw}
              counters={counters}
              abilities={abilities}
              isGroupedTokens={isGroupedTokens}
              tokenCount={tokenCount}
              isToken={isToken}
              attackingPlayerName={attackingPlayerName}
              isBlocking={isBlocking}
              blocking={blocking}
              blockedBy={blockedBy}
              isTargeted={isTargeted}
              targetedBy={targetedBy}
              allBattlefieldPerms={allBattlefieldPerms}
              perms={perms}
              hasTemporaryEffects={hasTemporaryEffects}
              temporaryEffects={temporaryEffects}
              isAttached={isAttached}
              attachedToName={attachedToName}
              hasAttachments={hasAttachments}
              attachmentNames={attachmentNames}
              isCreature={isCreature}
              pDisp={pDisp}
              tDisp={tDisp}
              hasPTModifiers={hasPTModifiers}
              hasDamage={hasDamage}
              baseP={baseP}
              baseT={baseT}
              plusCounters={plusCounters}
              minusCounters={minusCounters}
              ptSources={ptSources}
              damageMarked={damageMarked}
              isPlaneswalker={isPlaneswalker}
              loyalty={loyalty}
              baseLoyalty={baseLoyalty}
              showActivatedAbilityButtons={showActivatedAbilityButtons}
              playerId={playerId}
              tileWidth={tileWidth}
              hasPriority={hasPriority}
              isOwnTurn={isOwnTurn}
              isMainPhase={isMainPhase}
              stackEmpty={stackEmpty}
              currentStep={currentStep}
              hasThousandYearElixirEffect={hasThousandYearElixirEffect}
              onActivateAbility={onActivateAbility}
            />
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
    </div>
  );
}
