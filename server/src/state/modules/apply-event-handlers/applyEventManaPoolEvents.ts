// server/src/state/modules/apply-event-handlers/applyEventManaPoolEvents.ts
// Extracted verbatim from server/src/state/modules/applyEvent.ts (applyEvent switch).
//
// Cluster: Fetchland activation, mana ability activation and mana pool add/remove/persistence.
// Public entry: applyManaPoolEvents(ctx, e) -> true when it handled the event.
//
// Handles: activateFetchland, addManaToPool, removeManaFromPool, setManaPoolDoesNotEmpty, removeManaPoolDoesNotEmpty, activateManaAbility
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { buildDiscardProvenanceFields } from "../graveyardEntryUtils.js";
import {
  generateDeterministicId,
  clearReplayQueuedStepById,
  normalizeRecordedManaMap,
  inferLegacyManaReplay,
  applyRecordedManaToPool,
  inferLegacyManaLifeEffect,
  consumeReplayManaActivationLifeCost,
  applyManaAbilityLifeLoss,
} from "../applyEventReplayZoneCommanderManaHelpers.js";
import {
  applyReplaySacrificedPermanent,
  consumeRecordedManaCostFromPool,
  extractReplayActivationCost,
} from "../applyEventReplayCardMoveLibraryHelpers.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { getOrInitManaPool, recordCreatureSpellHasteManaProduced } from "../../../socket/util.js";
import { getActivatedAbilityScopeText, parseSearchCriteria } from "../../../socket/interaction.js";

export function applyManaPoolEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {

      case "activateFetchland": {
        // Fetchland activation: sacrifice land, search for land, put on battlefield
        // The actual search/put is handled when the activated ability resolves.
        // Replay must restore both the paid activation costs and the unresolved stack item.
        const playerId = String((e as any).playerId || '').trim();
        const permId = String((e as any).permanentId || '').trim();
        const abilityId = String((e as any).abilityId || '').trim();
        const persistedStackId = String((e as any).stackId || '').trim();
        if (permId) {
          try {
            const stateAny = ctx.state as any;
            const battlefield = Array.isArray(ctx.state.battlefield) ? ctx.state.battlefield : [];
            const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permId);
            const card = (permanent as any)?.card || {};
            const cardName = String((e as any).cardName || card.name || '').trim();
            const oracleText = String(card.oracle_text || '').trim();
            const persistedAbilityText = String((e as any).activatedAbilityText || '').trim();
            const scopedActivatedAbility = getActivatedAbilityScopeText(oracleText.toLowerCase(), abilityId);
            const scopedAbilityText = String(scopedActivatedAbility.abilityText || '').trim();
            const scopedAbilityFullText = String(scopedActivatedAbility.fullAbilityText || scopedAbilityText || oracleText).trim();
            const replayAbilityText = persistedAbilityText || scopedAbilityFullText || oracleText;

            if (playerId && replayAbilityText) {
              const persistedManaCost = String((e as any).manaCost || '').trim();
              const { manaCost: derivedManaCost } = extractReplayActivationCost(replayAbilityText);
              const manaCost = persistedManaCost || derivedManaCost;
              stateAny.manaPool = stateAny.manaPool || {};
              stateAny.manaPool[playerId] = stateAny.manaPool[playerId] || {
                white: 0,
                blue: 0,
                black: 0,
                red: 0,
                green: 0,
                colorless: 0,
              };
              consumeRecordedManaCostFromPool(stateAny.manaPool[playerId], manaCost);

              const persistedLifeCost = Number((e as any).lifePaidForCost || 0);
              const lifeCostMatch = replayAbilityText.match(/pay\s+(\d+)\s+life/i);
              const derivedLifeCost = lifeCostMatch ? Math.max(0, Number(lifeCostMatch[1] || 0)) : 0;
              const lifeCost = persistedLifeCost > 0 ? persistedLifeCost : derivedLifeCost;
              if (lifeCost > 0) {
                stateAny.life = stateAny.life || {};
                (ctx as any).life = (ctx as any).life || {};
                const startingLife = Number(stateAny.startingLife || (ctx as any).startingLife || 40);
                const currentLife = Number(stateAny.life?.[playerId] ?? (ctx as any).life?.[playerId] ?? startingLife);
                const nextLife = Math.max(0, currentLife - lifeCost);
                stateAny.life[playerId] = nextLife;
                (ctx as any).life[playerId] = nextLife;
                stateAny.lifeLostThisTurn = stateAny.lifeLostThisTurn || {};
                stateAny.lifeLostThisTurn[String(playerId)] = ((stateAny.lifeLostThisTurn[String(playerId)] || 0) + lifeCost);

                const player = Array.isArray(stateAny.players)
                  ? stateAny.players.find((entry: any) => entry && String(entry.id || '') === playerId)
                  : null;
                if (player) {
                  player.life = nextLife;
                }
              }
            }

            applyReplaySacrificedPermanent(ctx, permId);

            if (playerId && replayAbilityText) {
              const persistedSearchParams = ((e as any).searchParams || {}) as any;
              const filter = persistedSearchParams.filter || parseSearchCriteria(replayAbilityText);
              let maxSelections = Number(persistedSearchParams.maxSelections || 0);
              if (!Number.isFinite(maxSelections) || maxSelections <= 0) {
                maxSelections = 1;
                const upToMatch = replayAbilityText.match(/search your library for up to (\w+)/i);
                if (upToMatch) {
                  const num = String(upToMatch[1] || '').toLowerCase();
                  if (num === 'two') maxSelections = 2;
                  else if (num === 'three') maxSelections = 3;
                  else if (num === 'four') maxSelections = 4;
                  else {
                    const parsed = parseInt(num, 10);
                    if (!isNaN(parsed)) maxSelections = parsed;
                  }
                }
              }

              const entersTapped = persistedSearchParams.entersTapped === true || /(?:put (?:it|them) onto|enters) the battlefield tapped/i.test(replayAbilityText);

              let searchDescription = String(persistedSearchParams.searchDescription || '').trim();
              if (!searchDescription) {
                searchDescription = 'Search your library for a land card';
                if (maxSelections > 1) {
                  searchDescription = `Search your library for up to ${maxSelections} land cards`;
                }
                if (filter.subtypes && filter.subtypes.length > 0) {
                  const landTypes = filter.subtypes
                    .filter((subtype: string) => !subtype.includes('basic'))
                    .map((subtype: string) => subtype.charAt(0).toUpperCase() + subtype.slice(1));
                  if (landTypes.length > 0) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections}` : 'Search for a';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                  if (filter.subtypes.includes('basic')) {
                    const prefix = maxSelections > 1 ? `Search for up to ${maxSelections} basic` : 'Search for a basic';
                    searchDescription = `${prefix} ${landTypes.join(' or ')} card${maxSelections > 1 ? 's' : ''}`;
                  }
                }
              }

              const stackId = persistedStackId || generateDeterministicId(ctx, 'ability_fetch', `${permId}:${abilityId || cardName || 'fetchland'}`);
              stateAny.stack = Array.isArray(stateAny.stack) ? stateAny.stack : [];
              const alreadyPresent = stateAny.stack.some((item: any) => item && String(item.id || '') === stackId);
              if (!alreadyPresent) {
                stateAny.stack.push({
                  id: stackId,
                  type: 'ability',
                  controller: playerId,
                  source: permId,
                  abilityId,
                  sourceName: cardName,
                  description: `${searchDescription}, put ${maxSelections > 1 ? 'them' : 'it'} onto the battlefield${entersTapped ? ' tapped' : ''}, then shuffle`,
                  activatedAbilityText: replayAbilityText,
                  abilityType: 'fetch-land',
                  searchParams: {
                    filter,
                    searchDescription,
                    isTrueFetch: persistedSearchParams.isTrueFetch === true || /pay\s+1\s+life/i.test(replayAbilityText),
                    maxSelections,
                    entersTapped,
                    cardImageUrl: persistedSearchParams.cardImageUrl || card?.image_uris?.small || card?.image_uris?.normal,
                  },
                });
              }
            }
          } catch (err) {
            debugWarn(1, "applyEvent(activateFetchland): failed", err);
          }
        }
        break;
      }

      case "addManaToPool": {
        const playerId = String((e as any).playerId || '').trim();
        const color = String((e as any).color || '').trim();
        const amount = Number((e as any).amount || 0);
        if (!playerId || !color || !Number.isFinite(amount) || amount <= 0) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          const restriction = (e as any).restriction;

          if (restriction) {
            pool.restricted = Array.isArray(pool.restricted) ? pool.restricted : [];
            pool.restricted.push({
              type: color,
              amount,
              restriction,
              restrictedTo: (e as any).restrictedTo,
              sourceId: (e as any).sourceId,
              sourceName: (e as any).sourceName,
            });
          } else {
            pool[color] = Number(pool[color] || 0) + amount;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(addManaToPool): failed', err);
        }
        break;
      }

      case "removeManaFromPool": {
        const playerId = String((e as any).playerId || '').trim();
        const color = String((e as any).color || '').trim();
        const amount = Number((e as any).amount || 0);
        if (!playerId || !color || !Number.isFinite(amount) || amount <= 0) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          const removedRestrictedMana = (e as any).removedRestrictedMana;

          if (removedRestrictedMana && typeof removedRestrictedMana === 'object') {
            const restricted = Array.isArray(pool.restricted) ? pool.restricted : [];
            const matchIndex = restricted.findIndex((entry: any) =>
              entry &&
              String(entry.type || '') === String((removedRestrictedMana as any).type || color) &&
              String(entry.restriction || '') === String((removedRestrictedMana as any).restriction || '') &&
              String(entry.restrictedTo || '') === String((removedRestrictedMana as any).restrictedTo || '') &&
              String(entry.sourceId || '') === String((removedRestrictedMana as any).sourceId || '') &&
              String(entry.sourceName || '') === String((removedRestrictedMana as any).sourceName || '') &&
              Number(entry.amount || 0) >= amount
            );

            if (matchIndex !== -1) {
              const entry = restricted[matchIndex];
              entry.amount = Number(entry.amount || 0) - amount;
              if (entry.amount <= 0) {
                restricted.splice(matchIndex, 1);
              }
              if (restricted.length > 0) pool.restricted = restricted;
              else delete pool.restricted;
            }
          } else {
            pool[color] = Math.max(0, Number(pool[color] || 0) - amount);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(removeManaFromPool): failed', err);
        }
        break;
      }

      case "setManaPoolDoesNotEmpty": {
        const playerId = String((e as any).playerId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        if (!playerId || !sourceId) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          pool.doesNotEmpty = true;

          const convertsTo = String((e as any).convertsTo || '').trim();
          if (convertsTo) {
            pool.convertsTo = convertsTo;
          } else if ((e as any).convertsToColorless === true) {
            pool.convertsTo = 'colorless';
            pool.convertsToColorless = true;
          }

          pool.noEmptySourceIds = Array.isArray(pool.noEmptySourceIds) ? pool.noEmptySourceIds : [];
          if (!pool.noEmptySourceIds.includes(sourceId)) {
            pool.noEmptySourceIds.push(sourceId);
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(setManaPoolDoesNotEmpty): failed', err);
        }
        break;
      }

      case "removeManaPoolDoesNotEmpty": {
        const playerId = String((e as any).playerId || '').trim();
        const sourceId = String((e as any).sourceId || '').trim();
        if (!playerId || !sourceId) break;

        try {
          const pool = getOrInitManaPool(ctx.state as any, playerId as any) as any;
          pool.noEmptySourceIds = Array.isArray(pool.noEmptySourceIds)
            ? pool.noEmptySourceIds.filter((id: any) => String(id || '') !== sourceId)
            : [];

          if (pool.noEmptySourceIds.length === 0) {
            delete pool.doesNotEmpty;
            delete pool.convertsTo;
            delete pool.convertsToColorless;
            delete pool.noEmptySourceIds;
          }

          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, 'applyEvent(removeManaPoolDoesNotEmpty): failed', err);
        }
        break;
      }

      case "activateManaAbility": {
        // Mana ability activation: tap permanent, add mana
        const permId = (e as any).permanentId;
        const manaColor = (e as any).manaColor;
        const playerId = (e as any).playerId != null ? String((e as any).playerId) : '';
        try {
          const rawQueuedStep = (e as any).queuedResolutionStep;
          const replayGameId = String((ctx as any).gameId || '').trim();
          clearReplayQueuedStepById(replayGameId, String((e as any).resolvedStepId || '').trim());

          const queuedStepType = String((rawQueuedStep as any)?.type || '').trim();
          if (replayGameId && rawQueuedStep && typeof rawQueuedStep === 'object' && !Array.isArray(rawQueuedStep) && queuedStepType) {
            try {
              const discardedForCost = Array.isArray((rawQueuedStep as any)?.discardedCardIdsForCost)
                ? ((rawQueuedStep as any).discardedCardIdsForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const exiledFromHandForCost = Array.isArray((rawQueuedStep as any)?.exiledCardIdsFromHandForCost)
                ? ((rawQueuedStep as any).exiledCardIdsFromHandForCost as any[]).map((value: any) => String(value || '').trim()).filter(Boolean)
                : [];
              const zones = ctx.state.zones || {};
              const z = zones[playerId];
              if (z && Array.isArray(z.hand)) {
                if (discardedForCost.length > 0) {
                  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
                  for (const discardId of discardedForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === discardId);
                    if (handIndex === -1) continue;
                    const [discardedCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.graveyard as any[]).push({
                      ...discardedCard,
                      zone: 'graveyard',
                      ...buildDiscardProvenanceFields(ctx.state, String(playerId)),
                    });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.graveyardCount = Array.isArray(z.graveyard) ? z.graveyard.length : z.graveyardCount;
                }
                if (exiledFromHandForCost.length > 0) {
                  z.exile = Array.isArray(z.exile) ? z.exile : [];
                  for (const exileId of exiledFromHandForCost) {
                    const handIndex = (z.hand as any[]).findIndex((entry: any) => entry && String(entry.id) === exileId);
                    if (handIndex === -1) continue;
                    const [exiledCard] = (z.hand as any[]).splice(handIndex, 1);
                    (z.exile as any[]).push({ ...exiledCard, zone: 'exile' });
                  }
                  z.handCount = Array.isArray(z.hand) ? z.hand.length : z.handCount;
                  z.exileCount = Array.isArray(z.exile) ? z.exile.length : z.exileCount;
                }
              }
            } catch {
              // best-effort only
            }

            const queue = ResolutionQueueManager.getQueue(replayGameId) as any;
            const queuedStepId = String((rawQueuedStep as any)?.id || '').trim();
            const alreadyPresent = Boolean(
              (queue?.activeStep && String((queue.activeStep as any)?.id || '') === queuedStepId) ||
              (Array.isArray(queue?.steps) && queue.steps.some((step: any) => String((step as any)?.id || '') === queuedStepId))
            );

            if (!alreadyPresent) {
              ResolutionQueueManager.addStep(replayGameId, {
                ...(rawQueuedStep as any),
                ...(queuedStepId ? { id: queuedStepId } : {}),
                type: queuedStepType as any,
                playerId: String((rawQueuedStep as any).playerId || playerId || '') as any,
                description: String((rawQueuedStep as any).description || ''),
                mandatory: (rawQueuedStep as any).mandatory !== false,
              } as any);
            }
          }

          // Replay-stable per-turn tracking for intervening-if templates like
          // "if you haven't added mana with this ability this turn".
          try {
            const stateAny = ctx.state as any;
            const abilityId = (e as any).abilityId;
            const playerKey = playerId;
            const permKey = permId != null ? String(permId) : '';
            const abilityKeyRaw = abilityId != null ? String(abilityId) : '';
            if (playerKey && permKey) {
              stateAny.addedManaWithThisAbilityThisTurn = stateAny.addedManaWithThisAbilityThisTurn || {};
              stateAny.addedManaWithThisAbilityThisTurn[playerKey] = stateAny.addedManaWithThisAbilityThisTurn[playerKey] || {};

              // Prefer an ability-specific key when available; otherwise fall back to permanent id.
              const k = abilityKeyRaw ? `${permKey}:${abilityKeyRaw}` : permKey;
              (stateAny.addedManaWithThisAbilityThisTurn[playerKey] as any)[k] = true;
            }
          } catch {
            // best-effort only
          }

          if (permId) {
            const battlefield = ctx.state.battlefield || [];
            const perm = battlefield.find((p: any) => p.id === permId);
            if (playerId) {
              const recordedMana = normalizeRecordedManaMap((e as any).addedMana);
              const manaToApply = Object.keys(recordedMana).length > 0
                ? recordedMana
                : (perm ? inferLegacyManaReplay(ctx.state, perm, playerId, manaColor, (e as any).abilityId) : {});
              applyRecordedManaToPool(ctx, playerId, manaToApply);
              if ((e as any).manaGrantsCreatureSpellHasteUntilEndOfTurn === true) {
                for (const [poolKey, rawAmount] of Object.entries(manaToApply || {})) {
                  const amount = Number(rawAmount || 0);
                  if (!Number.isFinite(amount) || amount <= 0) continue;
                  recordCreatureSpellHasteManaProduced(ctx.state, String(playerId), String(poolKey) as any, amount);
                }
              }

              const explicitLifeLost = Number((e as any).lifeLost || 0);
              const explicitLifeLossIsDamage = typeof (e as any).lifeLossIsDamage === 'boolean'
                ? Boolean((e as any).lifeLossIsDamage)
                : undefined;
              const replayActivationCostLifePaid = consumeReplayManaActivationLifeCost(ctx.state, playerId, permId, (e as any).abilityId);
              const inferredLifeEffect = perm ? inferLegacyManaLifeEffect(perm, manaColor) : { amount: 0, isDamage: false };
              const suppressLegacyLifeInference = replayActivationCostLifePaid > 0 && inferredLifeEffect.isDamage !== true;
              const replayLifeLost = explicitLifeLost > 0
                ? explicitLifeLost
                : (suppressLegacyLifeInference ? 0 : inferredLifeEffect.amount);
              applyManaAbilityLifeLoss(
                ctx,
                playerId,
                replayLifeLost,
                explicitLifeLossIsDamage ?? inferredLifeEffect.isDamage,
              );
            }

            if (perm) {
              (perm as any).tapped = true;
              
              // Yuna, Grand Summoner: "Grand Summon — {T}: Add one mana of any color. When you next cast a creature spell this turn, that creature enters with two additional +1/+1 counters on it."
              const cardName = ((perm as any).card?.name || '').toLowerCase();
              const oracleText = ((perm as any).card?.oracle_text || '').toLowerCase();
              if (cardName.includes('yuna') && cardName.includes('grand summoner') ||
                  (oracleText.includes('add one mana of any color') && 
                   oracleText.includes('next') && oracleText.includes('creature') && 
                   oracleText.includes('enters') && oracleText.includes('two additional +1/+1 counter'))) {
                // Set flag for next creature spell this turn
                const controllerId = (perm as any).controller;
                (ctx.state as any).yunaNextCreatureFlags = (ctx.state as any).yunaNextCreatureFlags || {};
                (ctx.state as any).yunaNextCreatureFlags[controllerId] = true;
                debug(2, `[activateManaAbility] Yuna, Grand Summoner's Grand Summon activated - next creature will enter with +2 counters`);
              }
            }
          }
          // Mana pool updates are typically ephemeral, but we bump seq for state sync
          ctx.bumpSeq();
        } catch (err) {
          debugWarn(1, "applyEvent(activateManaAbility): failed", err);
        }
        break;
      }

      default:
        return false;
  }

  return true;
}
