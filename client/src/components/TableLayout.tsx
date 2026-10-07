// client/src/components/TableLayout.tsx
// Full TableLayout component — layout + pan/zoom + deck manager.
// Commander selection UI has been moved up into App.tsx, so this file no longer
// handles suggestCommanders or commander modals directly.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BattlefieldPermanent,
  PlayerRef,
  PlayerID,
  PlayerZones,
  CommanderInfo,
  GameID,
  KnownCardRef,
  ClientGameView,
  CardCostAdjustment,
  ManaPool,
} from '../../../shared/src';
import type { ImagePref } from './BattlefieldGrid';
import { DeckManagerModal } from './DeckManagerModal';
import { CentralStack } from './CentralStack';
import { XValueSelectionModal } from './XValueSelectionModal';
import { socket } from '../socket';
import { parseActivatedAbilities, type ParsedActivatedAbility } from '../utils/activatedAbilityParser';
import type { AppearanceSettings } from '../utils/appearanceSettings';
import { getPlayAreaGradientStyle, getBackgroundStyle } from '../utils/appearanceSettings';
import { battlefieldGridContentHeightForRows } from '../utils/battlefieldGrid';
import { useMobilePlayLayout } from '../hooks/useMobilePlayLayout';
import {
  clamp,
  getTotalFloatingMana,
  sidePlan,
  buildPositions,
  computeExtents,
  type PlayerBoard,
} from './TableLayout-handlers/tableLayoutGeometry';
import { useTableLayoutViewport } from './TableLayout-handlers/useTableLayoutViewport';
import { renderTableLayoutPlayerSeat } from './TableLayout-handlers/tableLayoutPlayerSeat';
import { TableLayoutZoneCardContextMenu } from './TableLayout-handlers/tableLayoutZoneCardContextMenu';


export function TableLayout(props: {
  players: PlayerRef[];
  permanentsByPlayer: Map<PlayerID, BattlefieldPermanent[]>;
  imagePref?: ImagePref;
  isYouPlayer?: boolean;
  splitLands?: boolean;
  enableReorderForYou?: boolean;
  you?: PlayerID;
  zones?: Record<PlayerID, PlayerZones>;
  commandZone?: Record<PlayerID, CommanderInfo | undefined>;
  format?: string;
  life?: Record<PlayerID, number>; // Life totals for each player
  commanderDamage?: Record<PlayerID, Record<string, number>>;
  poisonCounters?: Record<PlayerID, number>; // Poison counters for each player
  experienceCounters?: Record<PlayerID, number>; // Experience counters for each player
  showYourHandBelow?: boolean;
  onReorderHand?: (order: string[]) => void;
  onShuffleHand?: () => void;
  onRemove?: (id: string) => void;
  onCounter?: (id: string, kind: string, delta: number) => void;
  onBulkCounter?: (ids: string[], deltas: Record<string, number>) => void;
  highlightPermTargets?: Set<string> | undefined;
  selectedPermTargets?: Set<string> | undefined;
  onPermanentClick?: ((id: string) => void) | undefined;
  highlightPlayerTargets?: Set<string> | undefined;
  selectedPlayerTargets?: Set<string> | undefined;
  onPlayerClick?: ((pid: string) => void) | undefined;
  onPlayLandFromHand?: (cardId: string, fromZone?: 'hand' | 'graveyard' | 'exile' | 'library') => void;
  onCastFromHand?: (cardId: string) => void;
  onUseTopOfLibrary?: () => void;
  onCastCommander?: (commanderId: string, commanderName: string, manaCost?: string, tax?: number) => void;
  onGraveyardAbility?: (cardId: string, abilityId: string, card: any) => void;
  onExileAbility?: (cardId: string, abilityId: string, card: any) => void;
  reasonCannotPlayLand?: (card: any) => string | null;
  reasonCannotCast?: (card: any) => string | null;
  onImportDeckText?: (txt: string, name?: string) => void;
  onUseSavedDeck?: (deckId: string) => void;
  accountUser?: { id: string; username: string; displayName: string } | null;
  onLocalImportConfirmChange?: (open: boolean) => void;
  // External control for deck manager visibility
  externalDeckMgrOpen?: boolean;
  onDeckMgrOpenChange?: (open: boolean) => void;
  externalDeckMgrAnchorEl?: HTMLElement | null;
  focusedPlayerId?: PlayerID | null;
  gameId?: GameID;
  stackItems?: any[];
  importedCandidates?: KnownCardRef[]; // no longer used for commander UI, but kept for potential future UI
  energyCounters?: Record<PlayerID, number>;
  energy?: Record<PlayerID, number>;
  // Game view for stack overlay (CentralStack)
  chatView?: ClientGameView;
  // Special game designations (Rules 724-730)
  monarch?: PlayerID | null;
  initiative?: PlayerID | null;
  dayNight?: 'day' | 'night' | null;
  cityBlessing?: Record<PlayerID, boolean>;
  speed?: Record<PlayerID, number>;
  enduringStory?: Record<PlayerID, boolean>;
  // Game state for activated ability buttons
  priority?: PlayerID | null;
  phase?: string;
  step?: string;
  turnPlayer?: PlayerID | null;
  // Thousand-Year Elixir effect
  hasThousandYearElixirEffect?: boolean;
  // Appearance customization
  appearanceSettings?: AppearanceSettings;
  // Graveyard view handler
  onViewGraveyard?: (playerId: PlayerID) => void;
  onViewExile?: (playerId: PlayerID) => void;
  // Ignored trigger sources for auto-resolve shortcut
  ignoredTriggerSources?: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }>;
  onIgnoreTriggerSource?: (sourceId: string, sourceName: string, effect: string, imageUrl?: string) => void;
  onStopIgnoringSource?: (sourceKey: string) => void;
  // Mana pool for displaying floating mana (local player convenience + all seats)
  manaPool?: ManaPool | null;
  manaPools?: Record<PlayerID, ManaPool> | null;
  // Mulligan UI props - moved from App.tsx control bar
  showMulliganUI?: boolean;
  hasKeptHand?: boolean;
  mulligansTaken?: number;
  pendingBottomCount?: number;
  canKeepHand?: boolean;
  canMulligan?: boolean;
  // Playable cards highlighting (for current priority player)
  playableCards?: string[];
  // Cost adjustments for cards in hand (Aura of Silence, medallions, etc.)
  costAdjustments?: Record<string, CardCostAdjustment>;
  // Ignored cards for playability checks (auto-pass)
  ignoredCardIds?: Set<string>;
  // Callbacks for ignoring/unignoring cards for auto-pass from battlefield
  onIgnoreForAutoPass?: (permanentId: string, cardName: string, imageUrl?: string) => void;
  onUnignoreForAutoPass?: (permanentId: string) => void;
  isPreGame?: boolean;
  allPlayersKeptHands?: boolean;
  onKeepHand?: () => void;
  onMulligan?: () => void;
  onRandomizeStart?: () => void;
  // Legacy 3D/pan-zoom props (kept for backwards compatibility)
  threeD?: any;
  enablePanZoom?: boolean;
  tableCloth?: { imageUrl?: string };
  worldSize?: number;
  onUpdatePermPos?: (id: string, x: number, y: number, z: number) => void;
  /** When false, your hand is not rendered on the playmat (mobile external hand strip). */
  embedYourHand?: boolean;
  /** Extra bottom inset for fixed mobile chrome (hand strip + dock). */
  playAreaBottomInset?: number;
}) {
  const {
    players, permanentsByPlayer, imagePref, isYouPlayer,
    splitLands = true, enableReorderForYou = false,
    you, zones, commandZone, format, life, commanderDamage, poisonCounters, experienceCounters, showYourHandBelow = true,
    onRemove, onCounter, onBulkCounter,
    highlightPermTargets, selectedPermTargets, onPermanentClick,
    highlightPlayerTargets, selectedPlayerTargets, onPlayerClick,
    onPlayLandFromHand, onCastFromHand, onUseTopOfLibrary, onCastCommander, onGraveyardAbility, onExileAbility, reasonCannotPlayLand, reasonCannotCast,
    onReorderHand, onShuffleHand,
    threeD, enablePanZoom = true,
    tableCloth, worldSize, onUpdatePermPos,
    onImportDeckText, onUseSavedDeck, onLocalImportConfirmChange,
    externalDeckMgrOpen, onDeckMgrOpenChange, externalDeckMgrAnchorEl,
    focusedPlayerId,
    gameId, stackItems, importedCandidates, energyCounters, energy,
    chatView,
    monarch, initiative, dayNight, cityBlessing, speed, enduringStory,
    priority, phase, step, turnPlayer,
    hasThousandYearElixirEffect = false,
    appearanceSettings,
    onViewGraveyard, onViewExile,
    ignoredTriggerSources, onIgnoreTriggerSource, onStopIgnoringSource,
    manaPool,
    manaPools,
    // Mulligan UI props
    showMulliganUI, hasKeptHand, mulligansTaken = 0, pendingBottomCount = 0,
    canKeepHand, canMulligan, isPreGame, allPlayersKeptHands,
    onKeepHand, onMulligan, onRandomizeStart,
    // Playable cards highlighting
    playableCards,
    // Cost adjustments for hand cards
    costAdjustments,
    // Ignored cards for playability checks
    ignoredCardIds: propsIgnoredCardIds,
    // Auto-pass ignore callbacks for battlefield
    onIgnoreForAutoPass,
    onUnignoreForAutoPass,
    embedYourHand = true,
    playAreaBottomInset = 0,
  } = props;

  const ordered = useMemo<PlayerBoard[]>(() => {
    const ps = [...players].sort((a, b) => a.seat - b.seat);
    const idxYou = you ? ps.findIndex(p => p.id === you) : -1;
    const rotated = idxYou >= 0 ? [...ps.slice(idxYou), ...ps.slice(0, idxYou)] : ps;
    return rotated.map(p => ({ player: p, permanents: permanentsByPlayer.get(p.id) || [] }));
  }, [players, permanentsByPlayer, you]);

  const sideOrder = useMemo(() => sidePlan(ordered.length), [ordered.length]);

  // Compute game state for activated ability buttons
  const hasPriority = useMemo(() => you && priority === you, [you, priority]);
  const isOwnTurn = useMemo(() => you && turnPlayer === you, [you, turnPlayer]);
  const isMainPhase = useMemo(() => {
    const p = (phase || '').toLowerCase();
    return p.includes('main') || p.includes('precombat') || p.includes('postcombat');
  }, [phase]);
  const stackEmpty = useMemo(() => !stackItems || stackItems.length === 0, [stackItems]);
  const totalFloatingMana = useMemo(() => getTotalFloatingMana(manaPool), [manaPool]);
  const anyPlayerHasCityBlessing = useMemo(() => {
    if (!cityBlessing) return false;
    return Object.values(cityBlessing).some(Boolean);
  }, [cityBlessing]);
  const getSeatManaPool = useCallback((playerId: string, isYouSeat: boolean): ManaPool | null => {
    const fromMap = manaPools?.[playerId as PlayerID];
    if (fromMap) return fromMap;
    if (isYouSeat && manaPool) return manaPool;
    return null;
  }, [manaPools, manaPool]);
  const mobilePlayLayout = useMobilePlayLayout();

  // Layout constants — desktop defaults; compact sizing on touch when viewport < desktop breakpoint.
  const CARD_ASPECT_RATIO = 0.72;
  const TILE_W = mobilePlayLayout.battlefieldTileWidth;
  const tileH = Math.round(TILE_W / CARD_ASPECT_RATIO);
  const ZONES_W = mobilePlayLayout.zonesPanelWidth;
  const GRID_GAP = 12;
  const HAND_EXTRA_PADDING = mobilePlayLayout.handExtraPadding;
  const BOARD_SIDE_PADDING = mobilePlayLayout.isMobilePlay ? 24 : 40;
  const BOARD_HEIGHT_PADDING = mobilePlayLayout.boardHeightPadding;
  const BATTLEFIELD_TOOLBAR_HEIGHT = 34;
  const PLAY_AREA_TOP_OFFSET = mobilePlayLayout.playAreaTopOffset;
  const battlefieldViewportRows = mobilePlayLayout.battlefieldViewportRows;
  const battlefieldGridCols = mobilePlayLayout.battlefieldGridCols;

  const FREE_W = battlefieldGridCols * TILE_W + (battlefieldGridCols - 1) * GRID_GAP + HAND_EXTRA_PADDING;
  const FREE_FIELD_VIEWPORT_H = battlefieldGridContentHeightForRows(battlefieldViewportRows, TILE_W);
  const FREE_H = FREE_FIELD_VIEWPORT_H + BATTLEFIELD_TOOLBAR_HEIGHT;
  const BOARD_W = FREE_W + ZONES_W + BOARD_SIDE_PADDING;
  const BOARD_H = Math.round(FREE_H + tileH + BOARD_HEIGHT_PADDING);
  const SEAT_GAP_X = mobilePlayLayout.seatGapX;
  const SEAT_GAP_Y = mobilePlayLayout.seatGapY;
  const CENTER_CLEAR_X = mobilePlayLayout.isMobilePlay ? 120 : 160;
  const CENTER_CLEAR_Y = mobilePlayLayout.isMobilePlay ? 120 : 160;
  const SIDE_PAD = mobilePlayLayout.isMobilePlay ? 20 : 30;

  const seatPositions = useMemo(() => buildPositions({
    total: ordered.length,
    boardW: BOARD_W,
    boardH: BOARD_H,
    seatGapX: SEAT_GAP_X,
    seatGapY: SEAT_GAP_Y,
    centerClearX: CENTER_CLEAR_X,
    centerClearY: CENTER_CLEAR_Y,
    sidePad: SIDE_PAD,
    sideOrder
  }), [ordered.length, BOARD_W, BOARD_H, SEAT_GAP_X, SEAT_GAP_Y, CENTER_CLEAR_X, CENTER_CLEAR_Y, SIDE_PAD, sideOrder]);

  const { halfW, halfH } = useMemo(() => computeExtents(seatPositions, BOARD_W, BOARD_H), [seatPositions]);
  const focusedBoardIndex = useMemo(
    () => (focusedPlayerId ? ordered.findIndex((entry) => entry.player.id === focusedPlayerId) : -1),
    [focusedPlayerId, ordered]
  );
  const isFocusedView = focusedBoardIndex >= 0;
  const viewRotationDeg = focusedBoardIndex >= 0
    ? -(seatPositions[focusedBoardIndex]?.rotateDeg ?? 0)
    : 0;

  const {
    containerRef,
    container,
    cam,
    setCam,
    dragRef,
    panKey,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    yourBattlefieldExpanded,
    handleToggleYourBattlefieldExpanded,
    showAbilityBadges,
    handleToggleAbilityBadges,
    pendingTextSwapSource,
    setPendingTextSwapSource,
    pendingXActivation,
    setPendingXActivation,
    zoneContextMenu,
    setZoneContextMenu,
    ignoredCardsSet,
    setIgnoredCardsSet,
    centerOnYou,
  } = useTableLayoutViewport({
    enablePanZoom,
    viewRotationDeg,
    you,
    ordered,
    seatPositions,
    halfW,
    halfH,
    focusedPlayerId,
    mobilePlayLayout,
    BOARD_W,
    BOARD_H,
    propsIgnoredCardIds,
  });

  const attachedToSet = useMemo(() => {
    const s = new Set<string>();
    for (const arr of permanentsByPlayer.values()) {
      for (const perm of arr) {
        if ((perm as any).attachedTo) s.add((perm as any).attachedTo);
      }
    }
    return s;
  }, [permanentsByPlayer]);

  // Collect all battlefield permanents across all players
  // Used for looking up attachment targets (e.g., auras on opponent's creatures)
  const allBattlefieldPerms = useMemo(() => {
    const all: BattlefieldPermanent[] = [];
    for (const arr of permanentsByPlayer.values()) {
      all.push(...arr);
    }
    return all;
  }, [permanentsByPlayer]);

  const battlefieldCardNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const permanent of allBattlefieldPerms) {
      const card = permanent.card as KnownCardRef | undefined;
      names.set(permanent.id, card?.name || permanent.id);
    }
    return names;
  }, [allBattlefieldPerms]);

  const emitBattlefieldAbilityActivation = useCallback((
    permanentId: string,
    abilityId: string | number,
    ability?: ParsedActivatedAbility,
    xValue?: number,
  ) => {
    if (!gameId) {
      window.alert('Cannot activate ability: game id missing.');
      return;
    }

    const normalizedAbilityId = typeof abilityId === 'number' ? String(abilityId) : (abilityId || '0');
    if (!normalizedAbilityId) {
      window.alert('Cannot activate ability: missing ability id.');
      return;
    }

    // Prefer the caller's permanentId (expanded real member id). If the client still
    // holds a group_* / virtual ref, map to a real groupedTokenIds member when present.
    let emitPermanentId = String(permanentId || '');
    const direct = allBattlefieldPerms.find((entry) => entry.id === emitPermanentId);
    if (!direct) {
      const groupHit = allBattlefieldPerms.find((entry) => {
        const ids = (entry as any)?.groupedTokenIds;
        return Array.isArray(ids) && ids.some((id: unknown) => String(id) === emitPermanentId);
      });
      if (groupHit && Array.isArray((groupHit as any).groupedTokenIds)) {
        // Keep the real member id for emit — server BF has individuals, not group_*.
        emitPermanentId = emitPermanentId;
      } else if (emitPermanentId.includes('_virtual_') || emitPermanentId.startsWith('group_')) {
        const group = allBattlefieldPerms.find((entry) => {
          if (String(entry.id) === emitPermanentId) return true;
          if (emitPermanentId.startsWith(String(entry.id) + '_virtual_')) return true;
          if (String(entry.id) === emitPermanentId.replace(/_virtual_\d+$/, '')) return true;
          return false;
        });
        const ids = (group as any)?.groupedTokenIds as string[] | undefined;
        if (Array.isArray(ids) && ids.length > 0) {
          const virtualMatch = emitPermanentId.match(/_virtual_(\d+)$/);
          const idx = virtualMatch ? Number.parseInt(virtualMatch[1], 10) : 0;
          emitPermanentId = String(ids[Math.min(Math.max(idx, 0), ids.length - 1)] || ids[0]);
        }
      }
    }

    let resolvedAbility = ability;
    if (!resolvedAbility) {
      const perm =
        allBattlefieldPerms.find((entry) => entry.id === emitPermanentId)
        || allBattlefieldPerms.find((entry) => {
          const ids = (entry as any)?.groupedTokenIds;
          return Array.isArray(ids) && ids.some((id: unknown) => String(id) === emitPermanentId);
        });
      const card = perm?.card as KnownCardRef | undefined;
      if (card) {
        resolvedAbility = parseActivatedAbilities(card, (perm as any)?.grantedAbilities, {
          permanent: { ...(perm as any), id: emitPermanentId },
          battlefield: allBattlefieldPerms,
        }).find((entry) => entry.id === normalizedAbilityId);
      }
    }
    if (xValue === undefined && resolvedAbility?.hasXCost) {
      const xCount = Math.max(1, Number(resolvedAbility.xCount || 1));
      setPendingXActivation({
        permanentId: emitPermanentId,
        abilityId: normalizedAbilityId,
        cardName: battlefieldCardNames.get(emitPermanentId) || battlefieldCardNames.get(String(permanentId)) || resolvedAbility.label || 'Activated Ability',
        abilityText: resolvedAbility.effect || resolvedAbility.description,
        xCount,
        affordableXHint: totalFloatingMana > 0 ? Math.floor(totalFloatingMana / xCount) : undefined,
      });
      return;
    }

    // Always emit — even if the permanent is not in the emit-side grouped snapshot.
    socket.emit('activateBattlefieldAbility', {
      gameId,
      permanentId: emitPermanentId,
      abilityId: normalizedAbilityId,
      xValue,
    });
    window.setTimeout(() => {
      socket.emit('getMyNextResolutionStep', { gameId });
    }, 0);
  }, [allBattlefieldPerms, battlefieldCardNames, gameId, totalFloatingMana]);

  const handlePendingXActivationSelect = useCallback((xValue: number) => {
    if (!pendingXActivation || !gameId) return;
    if (pendingXActivation.cyclingCardId) {
      socket.emit('activateCycling', { gameId, cardId: pendingXActivation.cyclingCardId, abilityId: pendingXActivation.abilityId, xValue });
      setPendingXActivation(null);
      return;
    }
    socket.emit('activateBattlefieldAbility', {
      gameId,
      permanentId: pendingXActivation.permanentId,
      abilityId: pendingXActivation.abilityId,
      xValue,
    });
    window.setTimeout(() => {
      socket.emit('getMyNextResolutionStep', { gameId });
    }, 0);
    setPendingXActivation(null);
  }, [gameId, pendingXActivation]);

  const cameraTransform =
    `translate(${container.w / 2}px, ${container.h / 2}px) scale(${cam.z}) rotate(${viewRotationDeg}deg) translate(${-cam.x}px, ${-cam.y}px)`;
  const manualZoomStep = isFocusedView ? 1.04 : 1.12;

  // deck manager + import confirm
  const [deckMgrOpenInternal, setDeckMgrOpenInternal] = useState(false);
  // Use external prop if provided, otherwise use internal state
  const deckMgrOpen = externalDeckMgrOpen !== undefined ? externalDeckMgrOpen : deckMgrOpenInternal;
  const setDeckMgrOpen = (open: boolean) => {
    if (onDeckMgrOpenChange) {
      onDeckMgrOpenChange(open);
    } else {
      setDeckMgrOpenInternal(open);
    }
  };
  const decksBtnRef = useRef<HTMLButtonElement | null>(null);

  const tableHasContent = useMemo(() => {
    for (const arr of permanentsByPlayer.values()) {
      if (arr.length > 0) return true;
    }
    return false;
  }, [permanentsByPlayer]);

  const [importConfirmOpen, setImportConfirmOpen] = useState(false);
  const [importPending, setImportPending] = useState<
    { type: 'text'; text: string; name?: string } |
    { type: 'server'; deckId: string } |
    null
  >(null);

  function askServerImporterOnlyThen(action: () => void, fallbackOpenConfirm: () => void) {
    if (!props.gameId) {
      fallbackOpenConfirm();
      return;
    }

    let handled = false;
    const TIMEOUT_MS = 1200;
    const timer = window.setTimeout(() => {
      if (!handled) {
        handled = true;
        fallbackOpenConfirm();
      }
    }, TIMEOUT_MS);

    try {
      (socket as any).emit('canImportWithoutWipe', { gameId: props.gameId }, (resp: any) => {
        if (handled) return;
        handled = true;
        window.clearTimeout(timer as unknown as number);
        if (resp && resp.importerOnly) {
          action();
        } else {
          fallbackOpenConfirm();
        }
      });
    } catch (e) {
      if (!handled) {
        handled = true;
        window.clearTimeout(timer as unknown as number);
        fallbackOpenConfirm();
      }
    }
  }

  const handleRequestImportText = (text: string, name?: string) => {
    setImportPending({ type: 'text', text, name });

    askServerImporterOnlyThen(
      () => {
        try { if (typeof onImportDeckText === 'function') onImportDeckText(text, name); } catch (e) { console.warn("onImportDeckText failed:", e); }
        setImportPending(null);
        setDeckMgrOpen(false);
        onLocalImportConfirmChange?.(false);
      },
      () => {
        setImportConfirmOpen(true);
        onLocalImportConfirmChange?.(true);
      }
    );
  };

  const handleRequestUseSavedDeck = (deckId: string) => {
    setImportPending({ type: 'server', deckId });

    askServerImporterOnlyThen(
      () => {
        try { if (typeof onUseSavedDeck === 'function') onUseSavedDeck(deckId); } catch (e) { console.warn("onUseSavedDeck failed:", e); }
        setImportPending(null);
        setDeckMgrOpen(false);
        onLocalImportConfirmChange?.(false);
      },
      () => {
        setImportConfirmOpen(true);
        onLocalImportConfirmChange?.(true);
      }
    );
  };

  const confirmAndImport = () => {
    if (!importPending) { setImportConfirmOpen(false); onLocalImportConfirmChange?.(false); return; }
    if (importPending.type === 'text') {
      onImportDeckText?.(importPending.text, importPending.name);
    } else {
      onUseSavedDeck?.(importPending.deckId);
    }
    setImportPending(null);
    setImportConfirmOpen(false);
    onLocalImportConfirmChange?.(false);
    setDeckMgrOpen(false);
  };

  const cancelImportPending = () => {
    setImportPending(null);
    setImportConfirmOpen(false);
    onLocalImportConfirmChange?.(false);
  };

  // Table surface background (the large "tablecloth" area behind all player boards)
  // Uses tableBackground setting for the outer table surface
  const clothBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getBackgroundStyle(appearanceSettings.tableBackground);
    }
    // Legacy support for tableCloth prop
    if (props.tableCloth?.imageUrl) {
      return {
        backgroundImage: `url(${props.tableCloth.imageUrl})`,
        backgroundSize: 'cover',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      };
    }
    // Default dark background for table surface
    return {
      background: '#0a0a12',
    };
  }, [appearanceSettings, props.tableCloth?.imageUrl]);

  // Table container background (outer viewport container)
  const tableContainerBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getBackgroundStyle(appearanceSettings.tableBackground);
    }
    // Default dark background
    return { background: '#0a0a12' };
  }, [appearanceSettings]);

  // Player board background (the individual field sections where each player's cards are)
  // Uses playAreaBackground setting for per-player card areas
  const playerBoardBg: React.CSSProperties = useMemo(() => {
    if (appearanceSettings) {
      return getPlayAreaGradientStyle(appearanceSettings.playAreaBackground);
    }
    // Default semi-transparent gradient overlay
    return {
      background: 'linear-gradient(145deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
    };
  }, [appearanceSettings]);

  return (
    <>
      {/* Keyframes for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.03); }
        }
      `}</style>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={(e) => {
          e.preventDefault();
          // TODO: custom game-actions context menu can be triggered here
        }}
        style={{
          width: '100%',
          // Mobile chrome: fill the OUTER table frame (parent already reserves dock/hand
          // inset + status/seat chrome). Absolute 100dvh math over-counts because Join/
          // SeatStrip sit above this node — that made the frame taller than the viewport
          // and hid zoom +/- under the dock / off-screen.
          height: playAreaBottomInset > 0
            ? '100%'
            : `calc(100vh - ${PLAY_AREA_TOP_OFFSET}px)`,
          maxHeight: playAreaBottomInset > 0 ? '100%' : undefined,
          minHeight: playAreaBottomInset > 0 ? 240 : 500,
          flex: playAreaBottomInset > 0 ? '1 1 auto' : undefined,
          overflow: 'hidden',
          ...tableContainerBg,
          border: '1px solid #222',
          borderRadius: 12,
          userSelect: 'none',
          cursor: enablePanZoom ? (dragRef.current ? 'grabbing' : (panKey ? 'grab' : 'default')) : 'default',
          overscrollBehavior: 'none',
          // On touch devices, suppress browser pan/zoom on the board so our
          // pinch-zoom + two-finger pan handlers receive raw pointer events.
          // Desktop is unaffected because `pan-y` would never engage there.
          touchAction: 'none',
          position: 'relative'
        }}
      >
      {/* Mulligan UI overlay at top of play area */}
      {showMulliganUI && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 12,
            right: 12,
            zIndex: 200,
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            padding: '6px 12px',
            borderRadius: 8,
            border: !hasKeptHand && !isPreGame ? '2px solid #ef4444' : '1px solid rgba(167, 139, 250, 0.6)',
            background: !hasKeptHand && !isPreGame 
              ? 'rgba(239, 68, 68, 0.15)' 
              : 'rgba(30, 30, 50, 0.95)',
            backdropFilter: 'blur(8px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            color: '#fff',
            pointerEvents: 'auto',
          }}
        >
          {hasKeptHand ? (
            <span style={{ fontSize: 13, color: '#a78bfa', fontWeight: 500 }}>
              ✓ Hand kept{mulligansTaken > 0 ? ` (${7 - mulligansTaken} cards)` : ''}
            </span>
          ) : pendingBottomCount > 0 ? (
            <span style={{ fontSize: 13, color: '#fbbf24', fontWeight: 500 }}>
              Select {pendingBottomCount} card{pendingBottomCount !== 1 ? 's' : ''} to put on bottom...
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {!isPreGame && (
                  <span style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                    ⚠️ Keep your hand to continue!
                  </span>
                )}
                <span style={{ fontSize: 12, color: '#c4b5fd' }}>
                  Mulligans: {mulligansTaken}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                onClick={onKeepHand}
                disabled={!canKeepHand}
                style={{
                  background: canKeepHand ? '#10b981' : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: canKeepHand ? 'pointer' : 'not-allowed',
                  opacity: canKeepHand ? 1 : 0.5,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Keep Hand
              </button>
              <button
                onClick={onMulligan}
                disabled={!canMulligan}
                style={{
                  background: canMulligan ? '#f59e0b' : '#4b5563',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: canMulligan ? 'pointer' : 'not-allowed',
                  opacity: canMulligan ? 1 : 0.5,
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                Mulligan
              </button>
              {isPreGame && onRandomizeStart && (
                <button
                  onClick={onRandomizeStart}
                  style={{
                    background: '#8b5cf6',
                    color: 'white',
                    border: 'none',
                    borderRadius: 4,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                  title="Randomly select which player goes first"
                >
                  🎲 Random Start
                </button>
              )}
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ position: 'absolute', inset: 0, transform: cameraTransform, transformOrigin: '0 0', willChange: 'transform' }}>

        <div style={{ position: 'absolute', left: '50%', top: '50%', transformStyle: 'preserve-3d' }}>
          <div style={{ position: 'relative' }}>

            <div
              style={{
                position: 'absolute',
                left: -Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000) / 2,
                top: -Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000) / 2,
                width: Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000),
                height: Math.max(2 * (halfW + 120), props.worldSize ?? 0, 2000),
                ...clothBg,
                boxShadow: 'inset 0 0 60px rgba(0,0,0,0.4)',
                pointerEvents: 'none'
              }}
            />

            <div style={{ position: 'relative', zIndex: 2 }}>
              {ordered.map((pb, i) => {
                return renderTableLayoutPlayerSeat({
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
                });
              })}
            </div>

            <DeckManagerModal
              open={deckMgrOpen}
              onClose={() => setDeckMgrOpen(false)}
              onImportText={(txt, nm) => handleRequestImportText(txt, nm)}
              gameId={gameId}
              playerId={you}
              canServer={!!isYouPlayer}
              accountUser={props.accountUser ?? null}
              anchorEl={externalDeckMgrAnchorEl ?? decksBtnRef.current}
              wide
              onUseSavedDeck={(deckId) => handleRequestUseSavedDeck(deckId)}
            />
          </div>
        </div>
      </div>

      {enablePanZoom && (
        <div style={{
          position: 'absolute',
          left: 8,
          bottom: 8,
          zIndex: 12,
          display: 'inline-flex',
          gap: 6,
          alignItems: 'center',
          background: 'rgba(0,0,0,0.5)',
          color: '#fff',
          padding: '6px 8px',
          borderRadius: 6,
          fontSize: 12
        }}>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z * manualZoomStep, 0.2, 2.5) }))}>+</button>
          <button type="button" onClick={() => setCam(prev => ({ ...prev, z: clamp(prev.z / manualZoomStep, 0.15, 2.5) }))}>−</button>
          <button type="button" onClick={() => centerOnYou(true)}>Center You</button>
          <button
            type="button"
            onClick={() => {
              // "Fit All" uses a lower minimum zoom (0.15) than initial fit (MIN_INITIAL_ZOOM)
              // because the user explicitly wants to see the entire board
              const margin = 24;
              const zx = (container.w / 2 - margin) / (halfW + 40);
              const zy = (container.h / 2 - margin) / (halfH + 40);
              const fitZ = clamp(Math.min(zx, zy), 0.15, 2.5);
              centerOnYou(true);
              setCam(c => ({ x: c.x, y: c.y, z: fitZ }));
            }}
          >Fit All</button>
          <span style={{ opacity: 0.85 }}>Zoom: {cam.z.toFixed(2)}</span>
        </div>
      )}

      {/* Stack display - shows when stack is not empty */}
      {stackItems && stackItems.length > 0 && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 100, // Above other elements
            pointerEvents: 'none', // Allow clicks through container
          }}
        >
          <CentralStack
            stack={stackItems}
            battlefield={chatView?.battlefield}
            players={chatView?.players}
            you={you}
            priorityPlayer={chatView?.priority}
            onPass={() => {
              if (gameId && you) socket.emit('passPriority', { gameId, by: you });
            }}
            onResolveAll={() => {
              if (gameId && you) socket.emit('resolveAllTriggers', { gameId });
            }}
            ignoredSources={ignoredTriggerSources}
            onIgnoreTriggerSource={onIgnoreTriggerSource}
            onStopIgnoring={onStopIgnoringSource}
          />
        </div>
      )}

      {importConfirmOpen && (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.6)', zIndex: 8000
        }}>
          <div style={{ width: 520, background: '#1e1e1e', color: '#fff', padding: 16, borderRadius: 8 }}>
            <h3 style={{ marginTop: 0 }}>Confirm Import — wipe current table?</h3>
            <div style={{ marginBottom: 12 }}>
              Importing this deck will wipe the current playfield and reset decks for this game. Do you want to continue?
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button onClick={cancelImportPending}>Cancel</button>
              <button onClick={confirmAndImport} style={{ background: '#0a8', color: '#fff' }}>Yes, import and wipe</button>
            </div>
          </div>
        </div>
      )}

      {pendingXActivation && (
        <XValueSelectionModal
          isOpen={true}
          onClose={() => setPendingXActivation(null)}
          onSelect={handlePendingXActivationSelect}
          cardName={pendingXActivation.cardName}
          abilityText={pendingXActivation.abilityText}
          minValue={0}
          maxValue={20}
          xCount={pendingXActivation.xCount}
          affordableXHint={pendingXActivation.affordableXHint}
        />
      )}
      
            {zoneContextMenu && (
        <TableLayoutZoneCardContextMenu
          zoneContextMenu={zoneContextMenu}
          gameId={gameId}
          you={you}
          playableCards={playableCards}
          costAdjustments={costAdjustments}
          ignoredCardsSet={ignoredCardsSet}
          setIgnoredCardsSet={setIgnoredCardsSet}
          setZoneContextMenu={setZoneContextMenu}
          onPlayLandFromHand={onPlayLandFromHand}
          onCastFromHand={onCastFromHand}
          onCastCommander={onCastCommander}
          onGraveyardAbility={onGraveyardAbility}
          onExileAbility={onExileAbility}
          onCyclingNeedsX={(cardId, abilityId, card) => setPendingXActivation({
            permanentId: cardId,
            abilityId,
            cardName: card.name || 'Cycling',
            abilityText: 'Cycling: choose X',
            xCount: 1,
            affordableXHint: totalFloatingMana > 0 ? totalFloatingMana : undefined,
            cyclingCardId: cardId,
          })}
          reasonCannotPlayLand={reasonCannotPlayLand}
          reasonCannotCast={reasonCannotCast}
        />
      )}
    </div>
    </>
  );
}

export default TableLayout;
