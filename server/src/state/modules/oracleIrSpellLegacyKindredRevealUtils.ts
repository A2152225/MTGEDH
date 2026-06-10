import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { uid, parsePT } from '../utils.js';
import { debug } from '../../utils/debug.js';
import { countControlledCreaturesOfChosenType } from './chosen-creature-type.js';
import { cardHasCreatureType, isCreatureNow, permanentHasCreatureTypeNow } from '../creatureTypeNow.js';
import { createCopyTokensOfCard } from './counters_tokens.js';

export function shuffleCards(cards: any[]): any[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function resolveKindredSummonsFromLibrary(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  sourceName: string,
): void {
  const state = ctx.state as any;
  const targetCount = countControlledCreaturesOfChosenType(state, controller, chosenType);
  if (targetCount <= 0) {
    debug(2, `[resolveKindredSummonsFromLibrary] ${sourceName}: no creatures of ${chosenType} controlled — X is 0`);
    return;
  }

  const lib = ctx.libraries?.get(controller) || [];
  const revealed: any[] = [];
  const toBattlefield: any[] = [];
  let found = 0;

  while (lib.length > 0 && found < targetCount) {
    const card = lib.shift();
    if (!card) break;
    revealed.push(card);
    const typeLine = String(card.type_line || '').toLowerCase();
    if (typeLine.includes('creature') && cardHasCreatureType(card, chosenType)) {
      toBattlefield.push(card);
      found += 1;
    }
  }

  const remainder = revealed.filter((card) => !toBattlefield.some((entry) => entry.id === card.id));
  if (remainder.length > 0) {
    lib.push(...shuffleCards(remainder));
  }
  ctx.libraries?.set(controller, lib);

  const battlefield = state.battlefield || [];
  for (const card of toBattlefield) {
    const typeLine = String(card.type_line || '').toLowerCase();
    const isCreature = typeLine.includes('creature');
    const isPlaneswalker = typeLine.includes('planeswalker');
    const newPermanent = {
      id: uid('perm'),
      controller,
      owner: controller,
      tapped: false,
      counters: {},
      basePower: isCreature ? parsePT((card as any).power) : undefined,
      baseToughness: isCreature ? parsePT((card as any).toughness) : undefined,
      summoningSickness: isCreature,
      card: { ...card, zone: 'battlefield' },
    } as any;

    if (isPlaneswalker && (card as any).loyalty) {
      const loyaltyValue = parseInt(String((card as any).loyalty), 10);
      if (Number.isFinite(loyaltyValue)) {
        newPermanent.counters = { loyalty: loyaltyValue };
        newPermanent.loyalty = loyaltyValue;
        newPermanent.baseLoyalty = loyaltyValue;
      }
    }

    battlefield.push(newPermanent);
  }
  state.battlefield = battlefield;

  debug(
    2,
    `[resolveKindredSummonsFromLibrary] ${sourceName}: ${controller} revealed ${revealed.length} card(s), put ${toBattlefield.length}/${targetCount} ${chosenType} creature(s) onto the battlefield`,
  );
}

export function resolveKindredChargeTokenCopies(
  ctx: GameContext,
  controller: PlayerID,
  chosenType: string,
  sourceName: string,
): void {
  const state = ctx.state as any;
  const battlefield = state.battlefield || [];
  const matching = battlefield.filter((perm: any) => {
    if (!perm || perm.controller !== controller) return false;
    if (!isCreatureNow(perm)) return false;
    return permanentHasCreatureTypeNow(perm, chosenType);
  });

  if (matching.length === 0) {
    debug(2, `[resolveKindredChargeTokenCopies] ${sourceName}: no ${chosenType} creatures controlled`);
    return;
  }

  const createdIds: string[] = [];
  for (const perm of matching) {
    const card = (perm as any)?.card;
    if (!card) continue;
    createdIds.push(...createCopyTokensOfCard(ctx, controller, card, 1));
  }

  if (createdIds.length === 0) return;

  const currentTurn = Number(state.turnNumber ?? 0) || 0;
  const currentPhase = String(state.phase ?? '').toLowerCase();
  const currentStepUpper = String(state.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  const fireAtTurnNumber = inEnding ? currentTurn + 1 : currentTurn;

  state.pendingExileAtNextEndStep = Array.isArray(state.pendingExileAtNextEndStep)
    ? state.pendingExileAtNextEndStep
    : [];

  for (const tokenId of createdIds) {
    const token = (state.battlefield || []).find((perm: any) => perm?.id === tokenId);
    if (token) {
      (token as any).tempAbilities = Array.isArray((token as any).tempAbilities) ? (token as any).tempAbilities : [];
      if (!(token as any).tempAbilities.some((ability: any) => String(ability).toLowerCase() === 'haste')) {
        (token as any).tempAbilities.push('haste');
      }
      (token as any).summoningSickness = false;
    }

    state.pendingExileAtNextEndStep.push({
      permanentId: tokenId,
      fireAtTurnNumber,
      sourceName,
      createdBy: controller,
    });
  }

  debug(2, `[resolveKindredChargeTokenCopies] ${sourceName}: created ${createdIds.length} ${chosenType} token cop(ies) with haste (exile next end step)`);
}

export function detectRevealUntilHandSpell(
  oracleText: string,
  chosenKind?: string,
): { revealKind: 'artifact' | 'creature' | 'land' | 'nonland' } | null {
  if (!oracleText) return null;

  const text = oracleText.toLowerCase();

  if (
    text.includes('choose land or nonland') &&
    text.includes('reveal cards from the top of your library until you reveal a card of the chosen kind')
  ) {
    const normalizedChoice = String(chosenKind || '').toLowerCase().trim();
    if (normalizedChoice === 'land' || normalizedChoice === 'nonland') {
      return { revealKind: normalizedChoice };
    }
    return null;
  }

  const fixedKindMatch = text.match(/reveal cards from the top of your library until you reveal an? (artifact|creature|land|nonland) card/);
  if (!fixedKindMatch) return null;

  const revealKind = String(fixedKindMatch[1] || '').toLowerCase();
  if (revealKind === 'artifact' || revealKind === 'creature' || revealKind === 'land' || revealKind === 'nonland') {
    return { revealKind };
  }

  return null;
}

export function cardMatchesRevealKind(card: any, revealKind: 'artifact' | 'creature' | 'land' | 'nonland'): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (revealKind === 'nonland') {
    return !typeLine.includes('land');
  }
  return typeLine.includes(revealKind);
}

export function summarizeLibraryCard(card: any): any {
  return {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    image_uris: card.image_uris,
    imageUrl: card.image_uris?.normal || card.image_uris?.small,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    colors: card.colors,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
  };
}
