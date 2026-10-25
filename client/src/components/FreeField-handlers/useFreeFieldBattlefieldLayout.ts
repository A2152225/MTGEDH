// Origin parent: client/src/components/FreeField.tsx
// Cluster moved: battlefieldLayout useMemo (grid placement + display items).
// Public entry symbols: useFreeFieldBattlefieldLayout.
// Leaf must not import FreeField.tsx or FreeField-handlers/index.ts.

import { useMemo, type MutableRefObject } from 'react';
import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../../../shared/src';
import type { ImagePref } from '../BattlefieldGrid';
import { isCurrentlyCreature } from '../../utils/creatureUtils';
import {
  assignPermanentsToCells,
  battlefieldGridContentHeight,
  buildDisplayPositions,
  columnCountFromWidth,
  computeRequiredGridRows,
  countOccupiedCells,
  createBattlefieldGridFromDimensions,
} from '../../utils/battlefieldGrid';
import { parsePT, readPermanentDamageMarked } from './freeFieldDisplayUtils';

export type FreeFieldBattlefieldLayoutArgs = {
  perms: BattlefieldPermanent[];
  allBattlefieldPerms?: BattlefieldPermanent[];
  imagePref: ImagePref;
  tileWidth: number;
  tileH: number;
  widthPx: number;
  layoutRevision: number;
  autoPositionCache: MutableRefObject<Map<string, { x: number; y: number }>>;
};

export function useFreeFieldBattlefieldLayout(args: FreeFieldBattlefieldLayoutArgs) {
  const {
    perms,
    allBattlefieldPerms,
    imagePref,
    tileWidth,
    tileH,
    widthPx,
    layoutRevision,
    autoPositionCache,
  } = args;
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

    // Keep emit-side token groups collapsed (Nx badge). Expanding them into N tiles
    // undoes TokenOptimization and lags every game-state broadcast (AI token swarms).
    const displayPerms = perms;

    for (const p of displayPerms) {
      const kc = ((p as any).revealedAtGameEnd && (p as any).faceUpCard ? (p as any).faceUpCard : p.card) as KnownCardRef;
      const img = kc?.image_uris?.[imagePref] || kc?.image_uris?.normal || kc?.image_uris?.small || null;
      const name = kc?.name || (kc as any)?.displayName || p.id;
      const tl = (kc?.type_line || '').toLowerCase();
      const isCreature = isCurrentlyCreature(p as any);
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
      const damageMarked = readPermanentDamageMarked(p);

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
  return battlefieldLayout;
}
