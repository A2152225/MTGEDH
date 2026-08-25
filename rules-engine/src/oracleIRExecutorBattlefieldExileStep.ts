// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyExileStep.
// Public entry: applyExileStep.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import { buildZoneObjectWithRetainedCounters } from '../../shared/src/zoneRetainedCounters';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';
import { annotateBattlefieldExilesWithSource } from './oracleIRExecutorBattlefieldAnnotateExiles';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { getChosenObjectIdsFromContext } from './oracleIRExecutorBattlefieldCardZoneLocation';
import { readCharacteristicNumber } from './oracleIRExecutorBattlefieldCharacteristicNumber';
import { parseContextualBattlefieldReference } from './oracleIRExecutorBattlefieldContextualResolvers';
import { DISTRIBUTE_WORD_TO_NUMBER } from './oracleIRExecutorBattlefieldDistributeWordToNumber';
import {
  buildExileBattlefieldAppliedMetadata,
  exileAllOpponentGraveyards,
} from './oracleIRExecutorBattlefieldExileMetadataHelpers';
import {
  exileContextualSourceCardFromZone,
  exileContextualThatCardFromPlayerZones,
  exileTheChosenCardsFromPlayerZones,
  normalizeExileTargetReferenceText,
} from './oracleIRExecutorBattlefieldExileZoneHelpers';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import {
  buildPermanentCardWithStats,
  oracleIrBattlefieldRemovalOptions,
} from './oracleIRExecutorBattlefieldRemovalHelpers';
import { isSingularBattlefieldTargetText } from './oracleIRExecutorBattlefieldSingularTargetText';
import {
  exileSourceStackObject,
  exileSpellFromStackById,
  isNamedSelfSacrificeReference,
  isStackSpellExileTarget,
} from './oracleIRExecutorBattlefieldStackExileHelpers';
import { resolveSubtypeOrCompoundBattlefieldPermanents } from './oracleIRExecutorBattlefieldSubtypeCompoundResolvers';
import { normalizeBattlefieldTargetReferenceText } from './oracleIRExecutorBattlefieldTargetReferenceText';
import {
  finalizeBattlefieldRemoval,
  permanentMatchesSelector,
  permanentMatchesType,
} from './oracleIRExecutorBattlefieldOps';
import { resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils';
import { tryApplyExileTargetCardFromGraveyard } from './oracleIRExecutorExileGraveyardCardHandlers';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { parseReferencedPossessiveZonePhrase, resolveReferencedPlayerZone } from './oracleIRExecutorReferenceUtils';
import { trySpecialExileStep } from './oracleIRExecutorSpecialTargetHandlers';
import { bridgedZoneStepResult } from './oracleIRStepLedgerRuntime';

export function applyExileStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exile' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const graveyardTargetExile = tryApplyExileTargetCardFromGraveyard(state, step, ctx);
  if (graveyardTargetExile) return graveyardTargetExile;

  const special = trySpecialExileStep(state, step, ctx);
  if (special) return special;

  const exileRaw = String(step.raw || '').trim();
  if (/^for each opponent,\s+exile\s+/i.test(exileRaw)) {
    const controllerId = String(ctx.controllerId || '').trim() as PlayerID;
    const opponents = (state.players || [])
      .map((entry: any) => String(entry?.id || '').trim())
      .filter((id) => id && id !== controllerId);
    const chosenIds = getChosenObjectIdsFromContext(ctx);
    let workingState = state;
    const combinedLog: string[] = [];
    const exiledSnapshots: any[] = [];
    let battlefieldNow = [...((workingState.battlefield || []) as any[])];

    for (const opponentId of opponents) {
      const boundForOpponent = chosenIds.filter((id) => {
        const perm = battlefieldNow.find((p) => String(p?.id || '').trim() === id);
        return (
          perm &&
          String(perm?.controller || '').trim() === opponentId &&
          permanentMatchesType(perm, 'creature')
        );
      });
      const targetId =
        boundForOpponent[0] ||
        String(
          battlefieldNow.find(
            (p) =>
              String(p?.controller || '').trim() === opponentId && permanentMatchesType(p, 'creature'),
          )?.id || '',
        ).trim();
      if (!targetId) continue;
      const toRemove = battlefieldNow.filter((p) => String(p?.id || '').trim() === targetId);
      if (toRemove.length === 0) continue;
      const removedIds = new Set(toRemove.map((p) => String(p?.id || '').trim()));
      const kept = battlefieldNow.filter((p) => !removedIds.has(String(p?.id || '').trim()));
      const result = finalizeBattlefieldRemoval(
        workingState,
        toRemove,
        removedIds,
        kept,
        'exile',
        'exiled',
        oracleIrBattlefieldRemovalOptions(ctx, 'exile'),
      );
      workingState = result.state;
      battlefieldNow = [...((workingState.battlefield || []) as any[])];
      combinedLog.push(...(result.log || []));
      exiledSnapshots.push(...toRemove);
    }

    return {
      applied: true,
      state: workingState,
      log: combinedLog.length > 0 ? combinedLog : [`Exiled opponent creatures: ${exileRaw}`],
      lastMovedCards: exiledSnapshots,
    };
  }

  const normalizedExileTargetText = normalizeExileTargetReferenceText(
    String((step.target as any)?.text || step.raw || '')
  );
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  if (/^each opponent(?:'s)? graveyard$/i.test(normalizedExileTargetText)) {
    return exileAllOpponentGraveyards(state, ctx);
  }

  if (/^all opponents' graveyards$/i.test(normalizedExileTargetText)) {
    return exileAllOpponentGraveyards(state, ctx);
  }

  if (/^then exile that player's graveyard$/i.test(normalizedExileTargetText) || /^that player's graveyard$/i.test(normalizedExileTargetText)) {
    const playerId = String(
      ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2'
    ).trim() as PlayerID;
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
    const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
    if (graveyard.length === 0) {
      return { applied: true, state, log: [`No graveyard cards to exile for ${playerId}`] };
    }
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === playerId
        ? {
            ...entry,
            graveyard: [],
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...graveyard],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${graveyard.length} card(s) from ${playerId}'s graveyard`],
    };
  }

  if (/^(?:exile )?this permanent and each creature your opponents control$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || '').trim();
    const sourceId = String(ctx.sourceId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      const id = String((perm as any)?.id || '').trim();
      if (sourceId && id === sourceId) return true;
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      return permanentMatchesType(perm, 'creature');
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No permanents to exile'] };
    }
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(
      state,
      toRemove,
      removedIds,
      kept,
      'exile',
      'exiled',
      oracleIrBattlefieldRemovalOptions(ctx, 'exile')
    );
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^(?:exile )?all attacking creatures target player controls$/i.test(normalizedExileTargetText)) {
    const playerId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const toRemove = battlefield.filter(
      (perm: any) =>
        String((perm as any)?.controller || '').trim() === playerId &&
        permanentMatchesType(perm, 'creature') &&
        Boolean((perm as any)?.attacking || (perm as any)?.attackingPlayerId)
    );
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No attacking creatures to exile'] };
    }
    const removedIds = new Set(toRemove.map((perm: any) => String(perm?.id || '').trim()));
    const kept = battlefield.filter((perm: any) => !removedIds.has(String(perm?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(
      state,
      toRemove,
      removedIds,
      kept,
      'exile',
      'exiled',
      oracleIrBattlefieldRemovalOptions(ctx, 'exile')
    );
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^iii - exile any number of target players' graveyards$/i.test(normalizedExileTargetText)) {
    const boundPlayers = Array.from(
      new Set(
        [
          ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
          String(ctx.selectorContext?.targetPlayerId || ''),
          String(ctx.selectorContext?.targetOpponentId || ''),
        ]
          .map((id) => String(id || '').trim())
          .filter(Boolean)
      )
    );
    const playerIds = boundPlayers.length > 0 ? boundPlayers : ['p2'];
    let exiledCount = 0;
    const updatedPlayers = (state.players || []).map((entry: any) => {
      const playerId = String(entry?.id || '').trim();
      if (!playerIds.includes(playerId)) return entry;
      const graveyard = Array.isArray(entry?.graveyard) ? [...entry.graveyard] : [];
      if (graveyard.length === 0) return entry;
      exiledCount += graveyard.length;
      return {
        ...entry,
        graveyard: [],
        exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...graveyard],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${exiledCount} card(s) from ${playerIds.length} player graveyard(s)`],
    };
  }

  if (parseReferencedPossessiveZonePhrase(normalizedExileTargetText)) {
    const referencedZone = resolveReferencedPlayerZone(state, ctx, normalizedExileTargetText);
    const controllerId = String(referencedZone?.playerId || '').trim() as PlayerID;
    const zoneName = referencedZone?.zone;
    if (!controllerId || !zoneName) {
      return { applied: true, state, log: ['No referenced player zone to exile from'] };
    }
    const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === controllerId) as any;
    const zoneCards = Array.isArray(player?.[zoneName]) ? [...player[zoneName]] : [];
    if (zoneCards.length === 0) {
      return { applied: true, state, log: [`No ${zoneName} cards to exile`] };
    }
    const updatedPlayers = (state.players || []).map((entry: any) =>
      String(entry?.id || '').trim() === controllerId
        ? {
            ...entry,
            [zoneName]: [],
            exile: [...(Array.isArray(entry?.exile) ? entry.exile : []), ...zoneCards],
          }
        : entry
    );
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled ${zoneCards.length} card(s) from ${controllerId}'s ${zoneName}`],
    };
  }

  if (
    /^up to x target (?:artifacts and\/or creatures|creatures(?: and\/or artifacts)?)(?: you control)?$/i.test(
      normalizedExileTargetText
    )
  ) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const maxCount = Number.isFinite(Number(ctx.xValue)) ? Math.max(0, Number(ctx.xValue)) : 1;
    const boundIds = collectBoundBattlefieldIds(ctx);
    const controllerId = String(ctx.controllerId || '').trim();
    const requiresYouControl = /you control$/i.test(normalizedExileTargetText);
    const toRemove = battlefield
      .filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!boundIds.includes(id)) return false;
        if (!permanentMatchesType(perm, 'creature') && !permanentMatchesType(perm, 'artifact')) return false;
        if (requiresYouControl) return String(perm?.controller || '').trim() === controllerId;
        return true;
      })
      .slice(0, maxCount);
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching creatures to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  const upToArtifactsAndEnchantmentsMatch = normalizedExileTargetText.match(
    /^up to (one|two|three|four|five|\d+) target artifacts? and\/or enchantments?$/i
  );
  if (upToArtifactsAndEnchantmentsMatch) {
    const maxToken = String(upToArtifactsAndEnchantmentsMatch[1] || '1').toLowerCase();
    const maxCount = DISTRIBUTE_WORD_TO_NUMBER[maxToken] ?? Number.parseInt(maxToken, 10);
    const cappedMax = Number.isFinite(maxCount) && maxCount > 0 ? maxCount : 1;
    const battlefieldNow = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const toRemove = battlefieldNow
      .filter((perm: any) => {
        const id = String(perm?.id || '').trim();
        if (!boundIds.includes(id)) return false;
        return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'enchantment');
      })
      .slice(0, cappedMax);
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No artifacts or enchantments to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefieldNow.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  if (/^all creatures with power (\d+) or greater$/i.test(normalizedExileTargetText)) {
    const powerThreshold = Number(normalizedExileTargetText.match(/^all creatures with power (\d+) or greater$/i)?.[1] || 0);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'creature')) return false;
      const power = readCharacteristicNumber(
        (perm as any)?.effectivePower,
        (perm as any)?.basePower,
        (perm as any)?.card?.power,
        (perm as any)?.power
      );
      return power !== undefined && power >= powerThreshold;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching creatures to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^equipped creature$/i.test(normalizedExileTargetText)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const sourcePermanent = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const equippedId = String((sourcePermanent as any)?.equippedCreatureId || (sourcePermanent as any)?.attachedTo || '').trim();
    const equipped = equippedId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === equippedId
        )
      : undefined;
    if (!equipped) {
      return { applied: true, state, log: ['No equipped creature to exile'] };
    }
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const removedIds = new Set<string>([String((equipped as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [equipped], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^your hand$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      if (hand.length === 0) return player;
      return {
        ...player,
        hand: [],
        exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...hand],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled hand for ${controllerId}`],
    };
  }

  if (/^you may exile your hand$/i.test(normalizedExileTargetText)) {
    const controllerId = String(ctx.controllerId || 'p1').trim() as PlayerID;
    const updatedPlayers = (state.players || []).map((player: any) => {
      if (String(player?.id || '').trim() !== controllerId) return player;
      const hand = Array.isArray(player?.hand) ? player.hand : [];
      if (hand.length === 0) return player;
      return {
        ...player,
        hand: [],
        exile: [...(Array.isArray(player?.exile) ? player.exile : []), ...hand],
      };
    });
    return {
      applied: true,
      state: { ...(state as any), players: updatedPlayers as any } as GameState,
      log: [`Exiled hand for ${controllerId}`],
    };
  }

  if (/^a nontoken creature they control$/i.test(normalizedExileTargetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const candidate = battlefield.find((perm: any) => {
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !(perm as any)?.isToken;
    });
    if (!candidate) {
      return { applied: true, state, log: ['No nontoken creature for opponent to exile'] };
    }
    const removedIds = new Set<string>([String((candidate as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [candidate], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^target opponent exiles a nontoken creature they control$/i.test(normalizedExileTargetText)) {
    const opponentId = String(ctx.selectorContext?.targetOpponentId || 'p2').trim() as PlayerID;
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const candidate = battlefield.find((perm: any) => {
      if (String(perm?.controller || '').trim() !== opponentId) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return !(perm as any)?.isToken;
    });
    if (!candidate) {
      return { applied: true, state, log: ['No nontoken creature for opponent to exile'] };
    }
    const removedIds = new Set<string>([String((candidate as any)?.id || '').trim()]);
    const kept = battlefield.filter(perm => !removedIds.has(String(perm.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, [candidate], removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^two target permanents$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const boundIds = collectBoundBattlefieldIds(ctx);
    const toRemove = battlefield.filter((perm: any) =>
      boundIds.includes(String((perm as any)?.id || '').trim())
    ).slice(0, 2);
    if (toRemove.length === 0) {
      return {
        applied: false,
        message: `Skipped exile (unsupported target): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  // Generic: exile up to N target permanents [that are one or more colors]
  // (Ugin Eye of the Storms / similar). Empty bound set => legal no-op.
  {
    const upToExileMatch = normalizedExileTargetText.match(
      /^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+) target permanents?(?:\s+that(?:'s| is) one or more colors)?$/i,
    );
    if (upToExileMatch) {
      const wordToNumber: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
        six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      };
      const rawCount = String(upToExileMatch[1] || '').toLowerCase();
      const maxCount = wordToNumber[rawCount] ?? Number.parseInt(rawCount, 10);
      const requiresOneOrMoreColors = /one or more colors/i.test(normalizedExileTargetText);
      const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
      const boundIds = collectBoundBattlefieldIds(ctx);
      const colorLetters = new Set(['W', 'U', 'B', 'R', 'G', 'w', 'u', 'b', 'r', 'g', 'white', 'blue', 'black', 'red', 'green']);
      const permanentHasColor = (perm: any): boolean => {
        const printed = Array.isArray(perm?.colors)
          ? perm.colors
          : Array.isArray(perm?.card?.colors)
            ? perm.card.colors
            : [];
        const additions = Array.isArray(perm?.colorAdditions) ? perm.colorAdditions : [];
        return [...printed, ...additions].some((c) => colorLetters.has(String(c || '').trim()));
      };
      const toRemove = battlefield
        .filter((perm: any) => {
          const permanentId = String((perm as any)?.id || '').trim();
          if (!boundIds.includes(permanentId)) return false;
          if (requiresOneOrMoreColors && !permanentHasColor(perm)) return false;
          return true;
        })
        .slice(0, Number.isFinite(maxCount) ? Math.max(0, maxCount) : 0);
      if (toRemove.length === 0) {
        return { applied: true, state, log: ['No permanents chosen to exile (up to N)'] };
      }
      const removedIds = new Set<string>(toRemove.map((perm) => perm.id));
      const kept = battlefield.filter((perm) => !removedIds.has(perm.id));
      const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
      return { applied: true, state: result.state, log: result.log };
    }
  }

  const manaValueMassMatch = normalizedExileTargetText.match(
    /^all artifacts and creatures with mana value (\d+) or less$/i
  );
  if (manaValueMassMatch) {
    const maxManaValue = Number(manaValueMassMatch[1] || 0);
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const toRemove = battlefield.filter((perm: any) => {
      if (!permanentMatchesType(perm, 'artifact') && !permanentMatchesType(perm, 'creature')) {
        return false;
      }
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && manaValue <= maxManaValue;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildZoneObjectWithRetainedCounters((perm as any).card, perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
    };
  }

  if (/^any number of other target permanents you control$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const sourceId = String(ctx.sourceId || '').trim();
    const controllerId = String(ctx.controllerId || '').trim();
    const boundIds = new Set(collectBoundBattlefieldIds(ctx));
    const toRemove = battlefield.filter((perm: any) => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (sourceId && permanentId === sourceId) return false;
      if (!boundIds.has(permanentId)) return false;
      if (controllerId && String((perm as any)?.controller || '').trim() !== controllerId) return false;
      return true;
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No other target permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map((perm) => String((perm as any)?.id || '').trim()));
    const kept = battlefield.filter((perm) => !removedIds.has(String((perm as any)?.id || '').trim()));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter((perm) => !(perm as any).isToken)
      .map((perm) => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }

  if (/^any number of nontoken artifacts and\/or creatures you control$/i.test(normalizedExileTargetText)) {
    const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
    const controllerId = String(ctx.controllerId || '').trim();
    const toRemove = battlefield.filter((perm: any) => {
      if (String((perm as any)?.controller || '').trim() !== controllerId) return false;
      if ((perm as any)?.isToken) return false;
      return permanentMatchesType(perm, 'artifact') || permanentMatchesType(perm, 'creature');
    });
    if (toRemove.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    return { applied: true, state: result.state, log: result.log };
  }

  if (/^this card$/i.test(normalizedExileTargetText)) {
    const zoneExile = exileContextualSourceCardFromZone(state, ctx);
    if (zoneExile) {
      return zoneExile;
    }
  }

  if (/^(?:that card|it)$/i.test(normalizedExileTargetText)) {
    const contextualExile = exileContextualThatCardFromPlayerZones(state, ctx);
    if (contextualExile) return contextualExile;
  }

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (isStackSpellExileTarget({ kind: 'raw', text: normalizedExileTargetText }) && targetSpellId) {
    const stackExile = exileSpellFromStackById(state, targetSpellId, ctx);
    if (stackExile) {
      return { applied: true, state: stackExile.state, log: stackExile.log };
    }
  }

  const normalizedExileTarget = { ...(step.target as any), text: normalizedExileTargetText };

  if (/^target creature\b/i.test(normalizedExileTargetText)) {
    const targetIds = resolveCreatureTargetIds(state, normalizedExileTarget as any, ctx);
    const toRemove = battlefield.filter(perm => targetIds.includes(String(perm.id || '').trim()));
    if (toRemove.length > 0) {
      const removedIds = new Set<string>(toRemove.map(perm => perm.id));
      const kept = battlefield.filter(perm => !removedIds.has(perm.id));
      const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
      const movedCards = toRemove
        .filter(perm => !(perm as any).isToken)
        .map(perm => buildPermanentCardWithStats(perm, 'exile'));
      return {
        applied: true,
        state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
        log: result.log,
        ...(movedCards.length > 0
          ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
          : {}),
      };
    }
  }

  const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: normalizedExileTargetText } as any);
  if (selector) {
    let toRemove = battlefield.filter((perm: any) => permanentMatchesSelector(perm, selector, ctx));
    if (isSingularBattlefieldTargetText(normalizedExileTargetText) && toRemove.length > 1) {
      const boundIds = collectBoundBattlefieldIds(ctx);
      let candidates = toRemove.filter((perm: any) => boundIds.includes(String(perm?.id || '').trim()));
      if (candidates.length === 0) candidates = toRemove;
      if (/^target nonland permanent$/i.test(normalizedExileTargetText.trim())) {
        const nonCreatures = candidates.filter((perm: any) => !permanentMatchesType(perm, 'creature'));
        if (nonCreatures.length > 0) candidates = nonCreatures;
      }
      toRemove = candidates.slice(0, 1);
    }
    if (toRemove.length === 0) {
      return {
        applied: false,
        message: `Skipped exile (no deterministic target): ${step.raw}`,
        reason: 'no_deterministic_target',
      };
    }
    const removedIds = new Set<string>(toRemove.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = toRemove
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
      log: result.log,
      ...(movedCards.length > 0
        ? { lastMovedCards: movedCards, lastExiledCards: movedCards, lastExiledCardCount: movedCards.length }
        : {}),
    };
  }
  const subtypeMassTargets = resolveSubtypeOrCompoundBattlefieldPermanents(
    battlefield,
    normalizedExileTarget as any,
    ctx
  );
  if (subtypeMassTargets !== null) {
    if (subtypeMassTargets.length === 0) {
      return { applied: true, state, log: ['No matching permanents to exile'] };
    }
    const removedIds = new Set<string>(subtypeMassTargets.map(perm => perm.id));
    const kept = battlefield.filter(perm => !removedIds.has(perm.id));
    const result = finalizeBattlefieldRemoval(state, subtypeMassTargets, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
    const movedCards = subtypeMassTargets
      .filter(perm => !(perm as any).isToken)
      .map(perm => buildPermanentCardWithStats(perm, 'exile'));
    return {
      applied: true,
      state: annotateBattlefieldExilesWithSource(result.state, subtypeMassTargets, ctx),
      log: result.log,
      ...(movedCards.length > 0 ? { lastMovedCards: movedCards } : {}),
    };
  }

  if (/^(?:that card|it)$/i.test(normalizedExileTargetText)) {
    const contextualExile = exileContextualThatCardFromPlayerZones(state, ctx);
    if (contextualExile) return contextualExile;
  }

  if (/^the chosen cards$/i.test(normalizedExileTargetText)) {
    const chosenExile = exileTheChosenCardsFromPlayerZones(state, ctx);
    if (chosenExile) return chosenExile;
  }

  const toRemove = resolveDirectBattlefieldPermanents(battlefield, normalizedExileTarget as any, ctx);
  if (toRemove.length === 0) {
    const contextualTarget = parseContextualBattlefieldReference(normalizedExileTarget as any);
    const selfExileTarget =
      contextualTarget?.mode === 'self' ||
      isNamedSelfSacrificeReference(step.target as any, ctx) ||
      (step.target.kind === 'raw' &&
        /^(?:this card|this saga)$/i.test(
          normalizeBattlefieldTargetReferenceText(String((step.target as any).text || ''))
        ));
    if (selfExileTarget) {
      const stackExile = exileSourceStackObject(state, ctx);
      if (stackExile) {
        return { applied: true, state: stackExile.state, log: stackExile.log };
      }

      const zoneExile = exileContextualSourceCardFromZone(state, ctx);
      if (zoneExile) {
        return zoneExile;
      }
    }

    return {
      applied: false,
      message: `Skipped exile (unsupported target): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const removedIds = new Set<string>(toRemove.map(perm => perm.id));
  const kept = battlefield.filter(perm => !removedIds.has(perm.id));
  const result = finalizeBattlefieldRemoval(state, toRemove, removedIds, kept, 'exile', 'exiled', oracleIrBattlefieldRemovalOptions(ctx, 'exile'));
  return bridgedZoneStepResult(ctx, {
    applied: true,
    state: annotateBattlefieldExilesWithSource(result.state, toRemove, ctx),
    log: result.log,
    ...buildExileBattlefieldAppliedMetadata(toRemove),
  });
}

