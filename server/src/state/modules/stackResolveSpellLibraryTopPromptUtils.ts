import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, cardManaValue } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { parseManaCost } from '../../socket/util.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import {
  detectTopCardsToExileSelectionSpell,
  detectTopCardsToHandSelectionSpell,
  getPonderConfig,
  isDanceWithCalamitySpell,
  isLimDulsVaultSpell,
  isPonderStyleSpell,
} from './oracleIrSpellLegacySpellShapeUtils.js';
import {
  queueTopLibraryExileSelectionPrompt,
  queueTopLibraryToHandSelectionPrompt,
} from './oracleIrSpellLegacyLibrarySelectionUtils.js';
import {
  shouldSkipLegacySpellBodyHandlers,
  skipRetiredSpellLegacyHandler,
} from './oracleIrSpellLegacyRouting.js';

function getRecordedManaSpentTotal(stackItem: any): number | null {
  const direct = Number(stackItem?.manaSpentTotal);
  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const manaCost = String(stackItem?.manaCost || '').trim();
  if (!manaCost) {
    return null;
  }

  const parsedCost = parseManaCost(manaCost);
  const coloredTotal = Object.values(parsedCost.colors || {}).reduce(
    (sum: number, amount: any) => sum + Number(amount || 0),
    0,
  );
  const hybridTotal = Array.isArray((parsedCost as any).hybrids) ? (parsedCost as any).hybrids.length : 0;
  const xTotal = parsedCost.hasX && Number.isFinite(Number(stackItem?.xValue))
    ? Math.max(0, Number(stackItem?.xValue || 0))
    : 0;

  return Number(parsedCost.generic || 0) + coloredTotal + hybridTotal + xTotal;
}


export function applyInstantSorceryLibraryTopCardPromptHandlers(
  ctx: GameContext,
  options: {
    controller: PlayerID;
    effectiveCard: any;
    item: any;
    oracleTextLower: string;
    spellXValue: unknown;
    targets: any[];
  },
): void {
  const spellName = String(options.effectiveCard?.name || 'spell');
  if (skipRetiredSpellLegacyHandler(options.oracleTextLower, spellName)) {
    return;
  }
  // P1c: IR primary owns look-top / Ponder-style compounds — skip legacy library prompts.
  if (shouldSkipLegacySpellBodyHandlers(options.oracleTextLower, spellName)) {
    return;
  }

  const state = (ctx as any).state;
  const controller = options.controller;
  const effectiveCard = options.effectiveCard;
  const item = options.item;
  const oracleTextLower = options.oracleTextLower;
  const spellXValue = options.spellXValue;
  const targets = options.targets;
  const bumpSeq = typeof (ctx as any).bumpSeq === 'function' ? (ctx as any).bumpSeq.bind(ctx) : undefined;

  // Handle Ponder-style effects (look at top N, reorder, optionally shuffle, then draw)
  // Pattern: "Look at the top N cards of your library, then put them back in any order"
  if (isPonderStyleSpell(effectiveCard.name, oracleTextLower)) {
    const ponderConfig = getPonderConfig(effectiveCard.name, oracleTextLower);

    const effectId = uid("ponder");
    const lib = (ctx as any).libraries?.get?.(controller) || [];
    const actualCount = Math.min(ponderConfig.cardCount || 3, Array.isArray(lib) ? lib.length : 0);
    const cards = Array.isArray(lib) ? lib.slice(0, actualCount) : [];

    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.PONDER_EFFECT,
      playerId: controller as PlayerID,
      description: `Ponder: ${effectiveCard.name || 'Look at top cards'}`,
      cards,
      variant: ponderConfig.variant || 'ponder',
      cardCount: actualCount,
      drawAfter: ponderConfig.drawAfter || false,
      mayShuffleAfter: ponderConfig.canShuffle !== false,
      targetPlayerId: controller,
      sourceId: effectId,
      sourceName: effectiveCard.name || 'Ponder',
      effectId,
    } as any);
    debug(2, `[resolveTopOfStack] Ponder-style spell ${effectiveCard.name} queued direct prompt (variant: ${ponderConfig.variant}, cards: ${actualCount})`);
  }

  const topCardsToHandInfo = detectTopCardsToHandSelectionSpell(oracleTextLower);
  if (topCardsToHandInfo) {
    const lookCount = topCardsToHandInfo.lookCount === 'mana_spent_total'
      ? getRecordedManaSpentTotal(item)
      : topCardsToHandInfo.lookCount;

    if (typeof lookCount === 'number' && lookCount > 0) {
      const queuedCount = queueTopLibraryToHandSelectionPrompt(ctx, controller as PlayerID, {
        sourceId: String(item.id || ''),
        sourceName: effectiveCard.name || 'Library Selection',
        sourceImage: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
        description: `${effectiveCard.name}: Look at the top ${lookCount} cards of your library. Put ${topCardsToHandInfo.pickCount === 1 ? 'one' : topCardsToHandInfo.pickCount} of them into your hand and the rest ${topCardsToHandInfo.remainderDestination === 'graveyard' ? 'into your graveyard' : 'on the bottom of your library in a random order'}.`,
        lookCount,
        pickCount: topCardsToHandInfo.pickCount,
        remainderDestination: topCardsToHandInfo.remainderDestination,
        remainderRandomOrder: topCardsToHandInfo.remainderRandomOrder,
      });
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} queued top-library hand selection (${queuedCount} card(s), look=${lookCount}, pick=${topCardsToHandInfo.pickCount})`);
    }
  }

  const topCardsToExileInfo = detectTopCardsToExileSelectionSpell(oracleTextLower);
  if (topCardsToExileInfo) {
    const targetOpponentId = String(Array.isArray(targets) ? (targets[0] as any) : '').trim();
    if (targetOpponentId) {
      const queuedCount = queueTopLibraryExileSelectionPrompt(ctx, controller as PlayerID, targetOpponentId as PlayerID, {
        sourceId: String(item.id || ''),
        sourceName: effectiveCard.name || 'Library Selection',
        sourceImage: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
        description: `${effectiveCard.name}: Look at the top ${topCardsToExileInfo.lookCount} cards of target opponent's library. Exile ${topCardsToExileInfo.pickCount === 1 ? 'one of them' : `${topCardsToExileInfo.pickCount} of them`} face down and put the rest on the bottom of that library.`,
        lookCount: topCardsToExileInfo.lookCount,
        pickCount: topCardsToExileInfo.pickCount,
        destinationFaceDown: topCardsToExileInfo.destinationFaceDown,
        remainderDestination: topCardsToExileInfo.remainderDestination,
        remainderRandomOrder: topCardsToExileInfo.remainderRandomOrder,
        grantPlayableFromExileControllerId: controller as PlayerID,
        grantPlayableFromExileSpendManaAsThoughAnyType: topCardsToExileInfo.grantPlayableFromExileSpendManaAsThoughAnyType,
      });
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} queued top-library exile selection (${queuedCount} card(s), owner=${targetOpponentId}, pick=${topCardsToExileInfo.pickCount})`);
    }
  }

  if (isLimDulsVaultSpell(effectiveCard.name, oracleTextLower)) {
    const currentLife = Number((state as any).life?.[controller] ?? state.startingLife ?? 40);
    const effectId = uid('lim_duls_vault');
    const lib = (ctx as any).libraries?.get?.(controller) || [];
    const actualCount = Math.min(5, Array.isArray(lib) ? lib.length : 0);
    if (actualCount > 0) {
      const cards = lib.slice(0, actualCount).map((card: any) => ({
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        imageUrl: card.image_uris?.normal || card.image_uris?.small,
        mana_cost: card.mana_cost,
        cmc: card.cmc,
      }));

      queueResolveTopOfStackPrompt(ctx, {
        type: ResolutionStepType.LIM_DULS_VAULT,
        playerId: controller as PlayerID,
        description: "Lim-Dul's Vault: Reorder these cards, then either pay 1 life to put them on the bottom or keep them as your final five.",
        mandatory: true,
        sourceId: effectId,
        sourceName: effectiveCard.name || "Lim-Dul's Vault",
        sourceImage: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
        cards,
        effectId,
        currentLife,
        totalLifePaid: 0,
      } as any);
      debug(2, `[resolveTopOfStack] ${effectiveCard.name} queued direct Lim-Dul's Vault prompt`);
    }
  }

  if (isDanceWithCalamitySpell(effectiveCard.name, oracleTextLower)) {
    if (typeof (ctx as any).shuffleLibrary === 'function') {
      (ctx as any).shuffleLibrary(controller);
    }

    const effectId = uid('dance_with_calamity');
    const lib = (ctx as any).libraries?.get?.(controller) || [];
    queueResolveTopOfStackPrompt(ctx, {
      type: ResolutionStepType.DANCE_WITH_CALAMITY,
      playerId: controller as PlayerID,
      description: `${effectiveCard.name || 'Dance with Calamity'}: Exile the top card, or stop and cast spells from among the exiled cards.`,
      mandatory: true,
      sourceId: effectId,
      sourceName: effectiveCard.name || 'Dance with Calamity',
      sourceImage: effectiveCard.image_uris?.normal || effectiveCard.image_uris?.small,
      effectId,
      exiledCards: [],
      totalManaValue: 0,
      canContinue: Array.isArray(lib) && lib.length > 0,
    } as any);
    debug(2, `[resolveTopOfStack] ${effectiveCard.name} queued direct Dance with Calamity prompt`);
  }

  // Handle Genesis Wave: Reveal top X, you may put any number of permanents with MV <= X onto battlefield, rest to graveyard
  if ((effectiveCard.name || '').toLowerCase().includes('genesis wave')) {
    const xVal = typeof spellXValue === 'number' ? spellXValue : 0;
    const lib = ctx.libraries?.get(controller) || [];
    const revealed: any[] = [];
    for (let i = 0; i < xVal && lib.length > 0; i++) {
      revealed.push(lib.shift() as any);
    }
    
    // Filter to only permanents with MV <= X
    const eligiblePermanents: any[] = [];
    const notEligible: any[] = [];
    for (const c of revealed) {
      const typeLine = (c.type_line || '').toLowerCase();
      const isPermanentCard = ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'].some(t => typeLine.includes(t));
      const mv = cardManaValue(c);
      if (isPermanentCard && mv <= xVal) {
        eligiblePermanents.push(c);
      } else {
        notEligible.push(c);
      }
    }
    
    // If there are eligible permanents, create a resolution step for player to choose which to put onto battlefield
    if (eligiblePermanents.length > 0) {
      const gameId = (ctx as any).gameId || 'unknown';
      
      // Skip adding resolution steps during replay to prevent infinite loops
      const isReplaying = !!(ctx as any).isReplaying;
      if (!isReplaying) {
        // Add resolution step using the generic LIBRARY_SEARCH type with Genesis Wave parameters
        queueResolveTopOfStackPrompt(ctx, {
          type: ResolutionStepType.LIBRARY_SEARCH,
          playerId: controller as PlayerID,
          description: `Genesis Wave (X=${xVal}): Choose any number of permanents to put onto the battlefield`,
          mandatory: false, // Optional - player may choose 0 permanents
          sourceId: item.id,
          sourceName: 'Genesis Wave',
          sourceImage: effectiveCard.image_uris?.small || effectiveCard.image_uris?.normal,
          searchCriteria: `Permanent cards with mana value ${xVal} or less`,
          minSelections: 0,
          maxSelections: eligiblePermanents.length,
          destination: 'battlefield' as const,
          reveal: true,
          shuffleAfter: false,
          remainderDestination: 'graveyard' as const, // Genesis Wave: rest go to graveyard
          remainderRandomOrder: false,
          availableCards: eligiblePermanents.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,  // Include full image_uris object for battlefield placement
            imageUrl: c.image_uris?.normal || c.image_uris?.small,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
            power: c.power,
            toughness: c.toughness,
            loyalty: c.loyalty,
            colors: c.colors,
          })),
          nonSelectableCards: notEligible.map((c: any) => ({
            id: c.id,
            name: c.name,
            type_line: c.type_line,
            oracle_text: c.oracle_text,
            image_uris: c.image_uris,  // Include full image_uris object
            imageUrl: c.image_uris?.normal || c.image_uris?.small,
            mana_cost: c.mana_cost,
            cmc: c.cmc,
          })),
          contextValue: xVal, // Store X value for display/reference
          entersTapped: false,
        });
      
      debug(2, `[resolveTopOfStack] Genesis Wave: Created LIBRARY_SEARCH step for ${eligiblePermanents.length} eligible permanents (X=${xVal})`);
      } else {
        debug(2, `[resolveTopOfStack] Genesis Wave: skipping resolution step during replay`);
      }
    } else {
      // No eligible permanents, just put everything to graveyard
      const zones = ctx.state.zones || {};
      const z = zones[controller] || { hand: [], handCount: 0, libraryCount: lib.length, graveyard: [], graveyardCount: 0 };
      zones[controller] = z;
      z.graveyard = z.graveyard || [];
      
      for (const c of revealed) {
        pushCardToPlayerGraveyardWithReplacements(ctx, String(controller), c, z.graveyard);
      }
      z.graveyardCount = z.graveyard.length;
      
      // Update library count
      z.libraryCount = lib.length;
      
      debug(2, `[resolveTopOfStack] Genesis Wave: No eligible permanents, put ${revealed.length} cards to graveyard (X=${xVal})`);
    }
    
    bumpSeq();
  }
}
