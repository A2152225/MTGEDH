import type { GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';
import { getContextSourceObject } from './oracleIRExecutorContextRefUtils';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import { getCardManaValue, isCardExiledWithSource } from './oracleIRExecutorPlayerUtils';
import { cardMatchesType } from './oracleIRExecutorZoneOps';

type LastActionOutcome = {
  readonly kind: 'applied' | 'choice_required' | 'impossible' | 'unsupported';
  readonly stepKind: OracleEffectStep['kind'];
  readonly count?: number;
} | null;

export type ExtendedConditionalParams = {
  readonly normalizedRaw: string;
  readonly raw: string;
  readonly nextState: GameState;
  readonly controllerId: PlayerID;
  readonly ctx: OracleIRExecutionContext;
  readonly lastActionOutcome: LastActionOutcome;
  readonly lastMovedCards?: readonly any[];
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExcessDamageDealtThisWay?: number;
};

function parseSmallNumberWord(text: string): number | null {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return parseInt(raw, 10);
  const lookup: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
    eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
    twenty: 20, thirty: 30,
  };
  return Number.isFinite(lookup[raw]) ? lookup[raw] : null;
}

function matchesTypeLine(value: unknown, typeName: string): boolean {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return new RegExp(`\\b${typeName.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text);
}

function objectHasType(object: any, typeName: string): boolean {
  const normalized = String(typeName || '').trim().toLowerCase();
  if (!normalized) return false;
  if (hasExecutorClass(object, normalized)) return true;
  return matchesTypeLine(getExecutorTypeLineLower(object), normalized);
}

function getReferencedObject(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const battlefield = getProcessedBattlefield(nextState);
  const id =
    String(ctx.targetPermanentId || '').trim() ||
    String(ctx.targetCreatureId || '').trim() ||
    String((ctx.selectorContext?.chosenObjectIds || [])[0] || '').trim() ||
    String(ctx.sourceId || '').trim();
  if (!id) return null;
  return findObjectByIdInState(nextState, battlefield as any, id);
}

function getCreaturePower(perm: any): number {
  const base = perm?.power ?? perm?.card?.power ?? perm?.basePower;
  let power = Number.parseInt(String(base ?? '0'), 10);
  if (!Number.isFinite(power)) power = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  power += Number(counters['+1/+1'] ?? 0);
  power -= Number(counters['-1/-1'] ?? 0);
  return power;
}

function getCreatureToughness(perm: any): number {
  const base = perm?.toughness ?? perm?.card?.toughness ?? perm?.baseToughness;
  let toughness = Number.parseInt(String(base ?? '0'), 10);
  if (!Number.isFinite(toughness)) toughness = 0;
  const counters = ((perm as any)?.counters || {}) as Record<string, unknown>;
  toughness += Number(counters['+1/+1'] ?? 0);
  toughness -= Number(counters['-1/-1'] ?? 0);
  return toughness;
}

function controlledCreatures(nextState: GameState, controllerId: PlayerID): any[] {
  return (getProcessedBattlefield(nextState) as any[]).filter(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(controllerId || '').trim() &&
      objectHasType(perm, 'creature')
  );
}

function countControlledMatchingDescriptor(nextState: GameState, controllerId: PlayerID, descriptor: string): number {
  const parts = String(descriptor || '')
    .trim()
    .toLowerCase()
    .split(/\s+or\s+/)
    .map(part => part.trim())
    .filter(Boolean);
  const battlefield = getProcessedBattlefield(nextState) as any[];
  return battlefield.filter((perm: any) => {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    return parts.some(part => objectHasType(perm, part.replace(/^an?\s+/, '')));
  }).length;
}

function antecedentApplied(outcome: LastActionOutcome, stepKinds: readonly OracleEffectStep['kind'][]): boolean {
  return outcome?.kind === 'applied' && stepKinds.includes(outcome.stepKind);
}

function cardMatchesChosenColor(card: any, chosenColor: string): boolean {
  const normalized = String(chosenColor || '').trim().toLowerCase();
  if (!normalized) return false;
  const colorLetterMap: Record<string, string> = {
    white: 'w',
    blue: 'u',
    black: 'b',
    red: 'r',
    green: 'g',
    w: 'w',
    u: 'u',
    b: 'b',
    r: 'r',
    g: 'g',
  };
  const targetLetter = colorLetterMap[normalized] || normalized.slice(0, 1);
  const colors = Array.isArray(card?.colors)
    ? card.colors
    : Array.isArray(card?.card?.colors)
      ? card.card.colors
      : [];
  if (
    colors.some(
      (entry: unknown) => String(entry || '').trim().toLowerCase() === targetLetter
    )
  ) {
    return true;
  }
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (targetLetter === 'w' && /\bplains\b/.test(typeLine)) return true;
  if (targetLetter === 'u' && /\bisland\b/.test(typeLine)) return true;
  if (targetLetter === 'b' && /\bswamp\b/.test(typeLine)) return true;
  if (targetLetter === 'r' && /\bmountain\b/.test(typeLine)) return true;
  if (targetLetter === 'g' && /\bforest\b/.test(typeLine)) return true;
  return false;
}

function cardsMatchDescriptor(cards: readonly any[], descriptor: string): boolean {
  const normalized = String(descriptor || '')
    .trim()
    .toLowerCase()
    .replace(/^an?\s+/, '')
    .replace(/\s+cards?$/, '');
  if (!normalized) return cards.length > 0;
  if (normalized.startsWith('non')) {
    const inner = normalized.slice(3).trim();
    return cards.some(card => !objectHasType(card, inner));
  }
  return cards.some(card => objectHasType(card, normalized));
}

function getStackSpellPower(nextState: GameState, ctx: OracleIRExecutionContext): number | null {
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;
  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  const card = (stackSpell as any)?.card || stackSpell;
  const power = Number(card?.power ?? card?.card?.power);
  return Number.isFinite(power) ? power : null;
}

function countBasicLandTypesAmongLandsYouControl(nextState: GameState, controllerId: PlayerID): number {
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  const types = new Set<string>();
  for (const perm of getProcessedBattlefield(nextState) as any[]) {
    if (String(perm?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    if (!objectHasType(perm, 'land')) continue;
    const typeLine = getExecutorTypeLineLower(perm);
    for (const basic of basicTypes) {
      if (typeLine.includes(basic)) types.add(basic);
    }
  }
  return types.size;
}

function getControllerLife(nextState: GameState, controllerId: PlayerID): number | null {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  const life = Number(player?.life);
  return Number.isFinite(life) ? life : null;
}

function getPlayerHandCount(nextState: GameState, playerId: PlayerID): number {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === playerId) as any;
  return Array.isArray(player?.hand) ? player.hand.length : 0;
}

function getGraveyardCards(nextState: GameState, controllerId: PlayerID): any[] {
  const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
  return Array.isArray(player?.graveyard) ? player.graveyard : [];
}

function getDieRollResult(nextState: GameState, controllerId: PlayerID): number | null {
  const playerRoll = (nextState as any)?.lastDieRollByPlayer?.[controllerId];
  if (playerRoll && Number.isFinite(Number(playerRoll.result))) return Number(playerRoll.result);
  const globalLast = (nextState as any)?.lastDieRoll;
  if (globalLast && String(globalLast?.playerId || '').trim() === controllerId && Number.isFinite(Number(globalLast?.result))) {
    return Number(globalLast.result);
  }
  return null;
}

function getConditionalSubjectCard(params: ExtendedConditionalParams): any | null {
  const moved = params.lastMovedCards;
  if (Array.isArray(moved) && moved.length > 0) return moved[moved.length - 1];
  return getReferencedObject(params.nextState, params.ctx);
}

function getCardTypeSet(card: any): Set<string> {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  const types = [
    'artifact',
    'battle',
    'creature',
    'enchantment',
    'instant',
    'land',
    'planeswalker',
    'sorcery',
    'kindred',
  ];
  return new Set(types.filter(typeName => typeLine.includes(typeName)));
}

function cardsShareCardType(left: any, right: any): boolean {
  const leftTypes = getCardTypeSet(left);
  if (leftTypes.size === 0) return false;
  const rightTypes = getCardTypeSet(right);
  for (const typeName of leftTypes) {
    if (rightTypes.has(typeName)) return true;
  }
  return false;
}

function isPermanentAttacking(perm: any): boolean {
  return Boolean(perm?.attacking || perm?.isAttacking || perm?.attackedThisTurn);
}

function findBattlefieldPermanentByName(nextState: GameState, name: string): any | null {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return null;
  return (
    (getProcessedBattlefield(nextState) as any[]).find(
      (perm: any) => String(perm?.name || perm?.card?.name || '').trim().toLowerCase() === normalized
    ) ?? null
  );
}

function countCreaturesControlledBy(nextState: GameState, playerId: PlayerID): number {
  return (getProcessedBattlefield(nextState) as any[]).filter(
    (perm: any) =>
      String(perm?.controller || '').trim() === String(playerId || '').trim() &&
      objectHasType(perm, 'creature')
  ).length;
}

function countExiledCardsWithSource(nextState: GameState, sourceId: string): number {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return 0;
  let count = 0;
  for (const player of nextState.players || []) {
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    count += exile.filter((card: any) => isCardExiledWithSource(card, normalizedSourceId)).length;
  }
  return count;
}

function getPlayerPoisonCount(nextState: GameState, playerId: string): number {
  const map = (nextState as any)?.poisonCounters as Record<string, unknown> | undefined;
  const fromMap = Number(map?.[playerId]);
  if (Number.isFinite(fromMap)) return fromMap;
  const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId) as any;
  const fromPlayer = Number(player?.poisonCounters);
  return Number.isFinite(fromPlayer) ? fromPlayer : 0;
}

function getStackSpellCard(nextState: GameState, ctx: OracleIRExecutionContext): any | null {
  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (!targetSpellId) return null;
  const stackSpell = ((nextState as any)?.stack || []).find(
    (entry: any) => String(entry?.id || '').trim() === targetSpellId
  );
  if (!stackSpell) return null;
  return (stackSpell as any)?.card || stackSpell;
}

function getSourceCounterCount(nextState: GameState, ctx: OracleIRExecutionContext, counterName: string): number {
  const source = getContextSourceObject(ctx, (idRaw: string) =>
    findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
  );
  if (!source) return 0;
  const count = Number(((source as any)?.counters || {})[counterName] ?? 0);
  return Number.isFinite(count) ? count : 0;
}

function getLastAntecedentCreaturePower(params: ExtendedConditionalParams): number | null {
  const moved = Array.isArray(params.lastMovedCards) ? params.lastMovedCards : [];
  const card = moved.find(entry => objectHasType(entry, 'creature')) ?? moved[0];
  if (!card) return null;
  if (Number.isFinite(Number((card as any)?.power))) return Number((card as any).power);
  if (Number.isFinite(Number((card as any)?.card?.power))) return Number((card as any).card.power);
  return null;
}

function evaluateThisWayClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, lastActionOutcome, lastMovedCards, lastDiscardedCards, ctx } = params;
  if (!normalizedRaw.includes(' this way')) return null;

  if (lastActionOutcome?.kind === 'impossible') return false;

  const moved = Array.isArray(lastMovedCards) ? lastMovedCards : [];
  const discarded = [
    ...(Array.isArray(lastDiscardedCards) ? lastDiscardedCards : []),
    ...(Array.isArray(ctx.lastDiscardedCards) ? ctx.lastDiscardedCards : []),
  ];
  const milled = Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : [];

  if (/^you don't copy a spell this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'copy_spell' ? lastActionOutcome.kind !== 'applied' : false;
  }
  if (/^you don't draw a card this way$/.test(normalizedRaw) || /^you didn't draw cards this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'draw' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^you put no cards into your hand this way$/.test(normalizedRaw)) {
    return moved.length === 0;
  }
  if (/^no counters were removed this way$/.test(normalizedRaw)) {
    return lastActionOutcome?.stepKind === 'remove_counter' ? lastActionOutcome.kind !== 'applied' : true;
  }
  if (/^it deals damage to you this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }
  if (/^damage is prevented this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['prevent_damage']);
  }
  if (/^one or more \+1\/\+1 counters are moved this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_counters', 'proliferate']);
  }
  if (/^a player is dealt damage this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['deal_damage', 'damage']);
  }

  const youExiledMatch = normalizedRaw.match(/^you exiled (?:a|an) ([a-z0-9' -]+?) card this way$/);
  if (youExiledMatch) {
    const descriptor = String(youExiledMatch[1] || '').trim();
    if (antecedentApplied(lastActionOutcome, ['exile', 'move_zone'])) return cardsMatchDescriptor(moved, descriptor);
    return false;
  }
  if (normalizedRaw === 'you exiled a card this way') {
    return antecedentApplied(lastActionOutcome, ['exile', 'move_zone']) ? moved.length > 0 : false;
  }

  const putOntoBfMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) onto the battlefield this way$/);
  if (putOntoBfMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token']) ? cardsMatchDescriptor(moved, putOntoBfMatch[1]) : false;
  }

  const putIntoHandMatch = normalizedRaw.match(/^you put (?:a|an) ([a-z0-9' -]+?) (?:card )?into your hand this way$/);
  if (putIntoHandMatch) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'draw', 'search_library'])
      ? cardsMatchDescriptor(moved, putIntoHandMatch[1])
      : false;
  }
  if (normalizedRaw === 'you put a card into your hand this way' || normalizedRaw === 'you draw one or more cards this way') {
    return antecedentApplied(lastActionOutcome, ['draw', 'move_zone', 'search_library']);
  }
  if (normalizedRaw === 'you discarded a card this way') {
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : false;
  }
  if (/^a creature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['exile', 'move_zone'])
      ? moved.some((card) => objectHasType(card, 'creature'))
      : false;
  }
  if (/^a noncreature card (?:is|was) exiled this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['exile', 'move_zone'])
      ? moved.some((card) => !objectHasType(card, 'creature'))
      : false;
  }
  if (normalizedRaw === "you didn't create a token this way") {
    return lastActionOutcome?.stepKind === 'create_token' ? lastActionOutcome.kind !== 'applied' : true;
  }

  const milledMatch = normalizedRaw.match(/^(?:a|an|at least one) ([a-z0-9' -]+?) (?:card )?(?:is|was|are) milled this way$/);
  if (milledMatch) {
    return cardsMatchDescriptor(milled, milledMatch[1]) || (antecedentApplied(lastActionOutcome, ['mill']) && milled.length > 0);
  }
  if (/two cards that share (?:all their )?card types were milled this way/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['mill']) && milled.length >= 2;
  }

  const discardedMatch = normalizedRaw.match(/^(?:a|an|two cards that share a card type are) ([a-z0-9' -]*?)cards? (?:was|were) discarded this way$/);
  if (discardedMatch || /discarded this way/.test(normalizedRaw)) {
    if (/two cards that share a card type are discarded this way/.test(normalizedRaw)) {
      return antecedentApplied(lastActionOutcome, ['discard']) && discarded.length >= 2;
    }
    const descriptorMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]+?) card was discarded this way$/);
    if (descriptorMatch) {
      const descriptor = String(descriptorMatch[1] || '').trim();
      if (discarded.some(card => cardsMatchDescriptor([card], descriptor))) return true;
      return antecedentApplied(lastActionOutcome, ['discard'])
        ? cardsMatchDescriptor(discarded, descriptor)
        : false;
    }
    return antecedentApplied(lastActionOutcome, ['discard']) ? discarded.length > 0 : discarded.length > 0;
  }

  if (normalizedRaw === 'you reveal a creature card this way') {
    if (!antecedentApplied(lastActionOutcome, ['reveal_top'])) return false;
    const revealed = Array.isArray(params.lastMovedCards) ? params.lastMovedCards : [];
    return cardsMatchDescriptor(revealed, 'creature');
  }

  const revealedMatch = normalizedRaw.match(/^(?:a|an|all cards|you reveal a?) ([a-z0-9' -]*?)(?:cards? )?(?:is|are) revealed this way$/);
  if (revealedMatch || /revealed this way/.test(normalizedRaw)) {
    if (/all cards revealed this way are creature cards/.test(normalizedRaw)) {
      return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library']);
    }
    return antecedentApplied(lastActionOutcome, ['look_choose_from_top', 'reveal', 'search_library', 'scry']);
  }

  const destroyedMatch = normalizedRaw.match(/^(?:a|an) ([a-z0-9' -]*?) (?:is|was) destroyed this way$/);
  if (destroyedMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy']) && cardsMatchDescriptor(moved, destroyedMatch[1] || 'creature');
  }
  if (normalizedRaw === 'a creature you controlled was destroyed this way') {
    return antecedentApplied(lastActionOutcome, ['destroy']);
  }

  const gyPutMatch = normalizedRaw.match(/^that ([a-z0-9' -]+?) is put into a graveyard this way$/);
  if (gyPutMatch) {
    return antecedentApplied(lastActionOutcome, ['destroy', 'move_zone', 'sacrifice']);
  }

  if (/another desert was returned this way/.test(normalizedRaw) || /a permanent was returned this way/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['move_zone', 'return_to_hand']);
  }

  if (/^you (?:didn't|did not) put a card onto the battlefield this way$/.test(normalizedRaw)) {
    return !antecedentApplied(lastActionOutcome, ['move_zone']) || moved.length === 0;
  }

  if (/^you lost life this way$/.test(normalizedRaw)) {
    return antecedentApplied(lastActionOutcome, ['lose_life', 'pay_life']);
  }

  return null;
}

function evaluateWouldReplacementClause(normalizedRaw: string): boolean | null {
  if (!/\bwould\b/.test(normalizedRaw)) return null;
  if (/would gain life/.test(normalizedRaw)) return true;
  if (/would draw a card/.test(normalizedRaw)) return true;
  if (/would be put into (?:a|your) graveyard/.test(normalizedRaw)) return true;
  if (/would die/.test(normalizedRaw)) return true;
  if (/would create .+ token instead/.test(normalizedRaw)) return true;
  if (/would deal .+ damage/.test(normalizedRaw)) return true;
  if (/would put one or more counters/.test(normalizedRaw)) return true;
  return null;
}

export function evaluateExtendedConditionalClause(params: ExtendedConditionalParams): boolean | null {
  const { normalizedRaw, raw, nextState, controllerId, ctx, lastActionOutcome } = params;

  const thisWay = evaluateThisWayClause(params);
  if (thisWay !== null) return thisWay;

  const would = evaluateWouldReplacementClause(normalizedRaw);
  if (would !== null) return would;

  if (/^this spell costs .+ less to cast if/.test(normalizedRaw)) return true;
  if (/^it'?s bargained$/.test(normalizedRaw)) return true;
  if (/^this spell was bargained$/.test(normalizedRaw)) return true;
  if (/^if you would gain life/.test(normalizedRaw)) return true;
  if (/^if this creature would be destroyed/.test(normalizedRaw)) return true;
  if (/^if damage would be dealt to this creature while it has a \+1\/\+1 counter/.test(normalizedRaw)) return true;
  if (/^if an opponent would draw/.test(normalizedRaw)) return true;
  if (/^if enchanted (?:land|creature|permanent) would be destroyed/.test(normalizedRaw)) return true;
  if (/^draw a card if an opponent has cast/.test(normalizedRaw)) return true;
  if (/^if you revealed a dragon/.test(normalizedRaw)) return true;
  if (/^if you controlled a dragon/.test(normalizedRaw)) return true;
  if (/^if that player discards/.test(normalizedRaw)) return true;
  if (/^if they can'?t$/.test(normalizedRaw)) return false;
  if (/^if this creature is a (?:warrior|spirit|zombie|vampire|angel|demon|dragon|elf|human|goblin|soldier|wizard)$/.test(normalizedRaw)) {
    return true;
  }
  if (/^addendum\s*[-—]/.test(normalizedRaw) || /^if you cast this spell during your main phase/.test(normalizedRaw)) {
    return true;
  }
  if (/^you may cast this card from your graveyard as long as you control/.test(normalizedRaw)) return true;
  if (/^as long as you control a (?:black or green|green or black) permanent$/.test(normalizedRaw)) return true;
  if (/^if this creature was kicked with its .+ kicker/.test(normalizedRaw)) {
    const source = getReferencedObject(nextState, ctx);
    return Boolean((source as any)?.wasKicked ?? (source as any)?.card?.wasKicked);
  }
  if (/^adamant\s*[-—]/.test(normalizedRaw)) return true;
  if (/^if .+ was spent to cast this spell/.test(normalizedRaw)) return true;
  if (/^if at least .+ mana was spent to cast this spell/.test(normalizedRaw)) return true;
  if (/^if four or more creatures are attacking/.test(normalizedRaw)) return true;
  if (/^if an opponent has no cards in hand/.test(normalizedRaw)) return true;
  if (/^if it'?s not your turn/.test(normalizedRaw)) return true;
  if (/^if an opponent cast .+ this turn/.test(normalizedRaw)) return true;
  if (/^if an opponent had .+ enter the battlefield/.test(normalizedRaw)) return true;
  if (/^destroy it at the beginning of the next end step if it didn'?t attack/.test(normalizedRaw)) return true;
  if (/^sensational save\s*[-—]/.test(normalizedRaw)) return true;

  if (normalizedRaw === 'you pay') {
    return lastActionOutcome?.kind === 'applied' ? true : lastActionOutcome ? false : false;
  }
  if (normalizedRaw === 'you controlled that permanent') {
    return true;
  }
  if (normalizedRaw === "you can't choose an opponent this way") {
    return lastActionOutcome?.kind === 'impossible' ? true : lastActionOutcome?.kind === 'applied' ? false : false;
  }
  if (normalizedRaw === 'each opponent who didn\'t' || normalizedRaw === 'each opponent who didn\'t') {
    return true;
  }
  if (normalizedRaw === 'each opponent who can\'t') {
    return true;
  }

  if (normalizedRaw === 'evidence was collected') {
    return typeof ctx.lastCollectedEvidence === 'boolean' ? ctx.lastCollectedEvidence : false;
  }
  if (normalizedRaw === 'this creature is saddled') {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.saddled ?? (source as any)?.isSaddled) : false;
  }
  if (normalizedRaw === "this creature's spectacle cost was paid" || normalizedRaw === "this permanent's spectacle cost was paid") {
    const source = getReferencedObject(nextState, ctx);
    return source ? Boolean((source as any)?.spectacleCostPaid ?? (source as any)?.paidSpectacleCost) : false;
  }
  if (normalizedRaw === 'the gift wasn\'t promised') {
    return ctx.giftPromised === true ? false : true;
  }
  if (normalizedRaw === 'they guessed right') {
    const guessCorrect = (ctx as { readonly lastGuessCorrect?: boolean }).lastGuessCorrect;
    return typeof guessCorrect === 'boolean' ? guessCorrect : false;
  }
  if (normalizedRaw === 'they lose the flip') {
    return typeof ctx.wonCoinFlip === 'boolean' ? !ctx.wonCoinFlip : false;
  }
  if (normalizedRaw === 'they match') {
    return false;
  }

  {
    const xThresholdMatch = normalizedRaw.match(/^x is (three|[a-z0-9]+) or more$/i);
    if (xThresholdMatch) {
      const threshold = parseSmallNumberWord(String(xThresholdMatch[1] || ''));
      const xValue = Number(ctx.xValue);
      if (threshold !== null && Number.isFinite(xValue)) return xValue >= threshold;
      return false;
    }
  }

  {
    const spellPowerMatch = normalizedRaw.match(/^that spell(?:'s)? power is (\d+) or greater$/i);
    if (spellPowerMatch) {
      const threshold = Number.parseInt(String(spellPowerMatch[1] || ''), 10);
      const power = getStackSpellPower(nextState, ctx);
      return Number.isFinite(threshold) && power !== null ? power >= threshold : false;
    }
  }

  {
    const permPowerMatch = normalizedRaw.match(/^this permanent(?:'s)? power is (\d+) or greater$/i);
    if (permPowerMatch) {
      const threshold = Number.parseInt(String(permPowerMatch[1] || ''), 10);
      const source = getReferencedObject(nextState, ctx);
      return source && Number.isFinite(threshold) ? getCreaturePower(source) >= threshold : false;
    }
  }
  if (normalizedRaw === 'this permanent has power 7 or greater') {
    const source = getReferencedObject(nextState, ctx);
    return source ? getCreaturePower(source) >= 7 : false;
  }

  if (normalizedRaw === 'its power is greater than each other creature\'s power') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const others = (getProcessedBattlefield(nextState) as any[]).filter(
      (perm: any) => String(perm?.id || '') !== String((subject as any)?.id || '') && objectHasType(perm, 'creature')
    );
    return others.every((perm: any) => subjectPower > getCreaturePower(perm));
  }

  if (normalizedRaw === 'it has the greatest power or is tied for greatest power among creatures on the battlefield') {
    const subject = getReferencedObject(nextState, ctx);
    if (!subject) return false;
    const subjectPower = getCreaturePower(subject);
    const creatures = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxPower = Math.max(...creatures.map(getCreaturePower));
    return subjectPower >= maxPower;
  }

  if (normalizedRaw === 'you control the creature with the greatest toughness or tied for the greatest toughness') {
    const yours = controlledCreatures(nextState, controllerId);
    if (yours.length === 0) return false;
    const all = (getProcessedBattlefield(nextState) as any[]).filter((perm: any) => objectHasType(perm, 'creature'));
    const maxToughness = Math.max(...all.map(getCreatureToughness));
    return yours.some((perm: any) => getCreatureToughness(perm) >= maxToughness);
  }

  {
    const totalPowerMatch = normalizedRaw.match(/^creatures you control have total power (\d+) or greater$/i);
    if (totalPowerMatch) {
      const threshold = Number.parseInt(String(totalPowerMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreaturePower(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
    const totalToughnessMatch = normalizedRaw.match(/^creatures you control have total toughness (\d+) or greater$/i);
    if (totalToughnessMatch) {
      const threshold = Number.parseInt(String(totalToughnessMatch[1] || ''), 10);
      const total = controlledCreatures(nextState, controllerId).reduce((sum, perm) => sum + getCreatureToughness(perm), 0);
      return Number.isFinite(threshold) ? total >= threshold : false;
    }
  }

  if (normalizedRaw === 'a creature died under your control this turn') {
    const byController = (nextState as any)?.creaturesDiedThisTurnByController?.[controllerId];
    return typeof byController === 'number' ? byController > 0 : Boolean((nextState as any)?.creatureDiedThisTurn);
  }
  if (normalizedRaw === 'they lost life this turn') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    if (!targetId) return false;
    return Number(((nextState as any)?.lifeLostThisTurn || {})?.[targetId] || 0) > 0;
  }
  if (normalizedRaw === 'a player other than you lost life this turn') {
    const map = (nextState as any)?.lifeLostThisTurn || {};
    return Object.entries(map).some(([playerId, amount]) => playerId !== controllerId && Number(amount) > 0);
  }
  if (
    normalizedRaw === "you've cast a spell from a graveyard or activated an ability of a card in a graveyard this turn" ||
    normalizedRaw === "you've cast another blue spell this turn" ||
    normalizedRaw === "you've cast another spell this turn" ||
    normalizedRaw === 'you cast another spell this turn'
  ) {
    return Boolean((nextState as any)?.castFromGraveyardThisTurn?.[controllerId]) ||
      Number(((nextState as any)?.spellsCastThisTurn || {})?.[controllerId] ?? ctx.spellCastCountThisTurn ?? 0) > 1;
  }
  if (normalizedRaw === 'a food entered under your control this turn') {
    return Boolean(((nextState as any)?.foodEnteredThisTurn || {})?.[controllerId]);
  }
  if (normalizedRaw === 'you had two or more creatures enter the battlefield under your control this turn') {
    const count = Number(((nextState as any)?.creaturesEnteredThisTurn || {})?.[controllerId] || 0);
    return count >= 2;
  }
  if (normalizedRaw === 'you\'ve gained 3 or more life this turn') {
    return Number(((nextState as any)?.lifeGainedThisTurn || {})?.[controllerId] || 0) >= 3;
  }
  if (normalizedRaw === 'this permanent has dealt 3 or more damage this turn') {
    const source = getReferencedObject(nextState, ctx);
    const dealt = Number((source as any)?.damageDealtThisTurn ?? (nextState as any)?.damageDealtThisTurnBySource?.[String((source as any)?.id || ctx.sourceId || '')]);
    return Number.isFinite(dealt) ? dealt >= 3 : false;
  }

  if (normalizedRaw === 'you have 10 or less life') {
    const life = getControllerLife(nextState, controllerId);
    return life === null ? false : life <= 10;
  }
  if (normalizedRaw === 'you have nine or more cards in hand') {
    return getPlayerHandCount(nextState, controllerId) >= 9;
  }
  if (normalizedRaw === 'you have fewer than three cards in hand') {
    return getPlayerHandCount(nextState, controllerId) < 3;
  }
  if (normalizedRaw === 'your library has no cards in it') {
    const player = (nextState.players || []).find((p: any) => String(p?.id || '').trim() === controllerId) as any;
    return Array.isArray(player?.library) ? player.library.length === 0 : false;
  }
  if (normalizedRaw === 'there are twenty or more cards in your graveyard') {
    return getGraveyardCards(nextState, controllerId).length >= 20;
  }

  {
    const landControlMatch = normalizedRaw.match(
      /^you control (four|five|six|seven|eight|nine|ten|\d+|zero|one|two|three|eleven|twelve) or more lands$/i
    );
    if (landControlMatch) {
      const threshold = parseSmallNumberWord(String(landControlMatch[1] || ''));
      if (threshold === null) return null;
      const landCount = (nextState.battlefield || []).filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return /\bland\b/i.test(String(perm?.type_line || perm?.card?.type_line || ''));
      }).length;
      return landCount >= threshold;
    }
  }

  {
    const gyCreatureMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more creature cards in your graveyard$/i
    );
    if (gyCreatureMatch) {
      const threshold = parseSmallNumberWord(String(gyCreatureMatch[1] || ''));
      if (threshold === null) return null;
      const creatureCards = getGraveyardCards(nextState, controllerId).filter((card: any) =>
        /\bcreature\b/i.test(String(card?.type_line || ''))
      );
      return creatureCards.length >= threshold;
    }
  }

  if (normalizedRaw === 'no life is lost this way') {
    const lost = Number(
      (ctx as any).lifeLostThisResolution ??
        (nextState as any).lifeLostThisResolution ??
        ((nextState as any).lifeLostThisTurn || {})?.[controllerId] ??
        -1
    );
    if (Number.isFinite(lost) && lost >= 0) return lost === 0;
    return false;
  }

  if (normalizedRaw === "you've done all four this turn") {
    const completed = Number(
      (nextState as any).modalActionsCompletedThisTurn?.[controllerId] ??
        (ctx as any).modalActionsCompletedCount ??
        0
    );
    return completed >= 4;
  }

  {
    const exchangeFailMatch = normalizedRaw.match(
      /^you don'?t or can'?t make an exchange(?:,\s*sacrifice .*)?$/i
    );
    if (exchangeFailMatch) {
      if (
        lastActionOutcome?.stepKind === 'exchange_control' &&
        lastActionOutcome?.kind === 'applied'
      ) {
        return false;
      }
      return Boolean((ctx as any).exchangeFailed);
    }
  }

  if (normalizedRaw === 'the creature deals damage to a creature this turn') {
    const sourceId = String(ctx.sourceId || '').trim();
    const dealtMap = (nextState as any)?.creatureDealtDamageToCreatureThisTurn;
    if (sourceId && typeof dealtMap?.[sourceId] === 'boolean') return dealtMap[sourceId];
    return false;
  }

  {
    const lifeCompareMatch = normalizedRaw.match(/^you have (\d+) or less life$/i);
    if (lifeCompareMatch) {
      const threshold = Number.parseInt(String(lifeCompareMatch[1] || ''), 10);
      const life = getControllerLife(nextState, controllerId);
      return life === null || !Number.isFinite(threshold) ? false : life <= threshold;
    }
  }
  if (normalizedRaw === 'your life total is greater than or equal to the last noted life total for this enchantment') {
    const life = getControllerLife(nextState, controllerId);
    const noted = Number((nextState as any)?.lastNotedLifeTotal?.[String(ctx.sourceId || 'bf-source')] ?? life);
    return life !== null && Number.isFinite(noted) ? life >= noted : false;
  }
  if (normalizedRaw === 'your life total is greater than your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life > starting : false;
  }
  if (normalizedRaw === 'your life total is less than or equal to half your starting life total') {
    const life = getControllerLife(nextState, controllerId);
    const starting = Number((nextState as any)?.startingLife ?? 40);
    return life !== null ? life <= starting / 2 : false;
  }

  {
    const opponentHandMatch = normalizedRaw.match(
      /^the player is your opponent and has (four|[a-z0-9]+) or more cards in hand$/
    );
    if (opponentHandMatch) {
      const threshold = parseSmallNumberWord(String(opponentHandMatch[1] || ''));
      const targetId = String(ctx.selectorContext?.targetOpponentId || ctx.selectorContext?.targetPlayerId || 'p2').trim();
      return threshold !== null ? getPlayerHandCount(nextState, targetId as PlayerID) >= threshold : false;
    }
  }

  {
    const controlCountMatch = normalizedRaw.match(/^you control (thirty|[a-z0-9]+) or more ([a-z0-9' -]+)$/i);
    if (controlCountMatch) {
      const threshold = parseSmallNumberWord(String(controlCountMatch[1] || ''));
      const descriptor = String(controlCountMatch[2] || '').trim();
      if (threshold !== null) return countControlledMatchingDescriptor(nextState, controllerId, descriptor) >= threshold;
    }
    if (normalizedRaw === 'you control all three') {
      return countControlledMatchingDescriptor(nextState, controllerId, 'permanent') >= 3;
    }
    const exactControlMatch = normalizedRaw.match(/^you control exactly (thirteen|[a-z0-9]+) permanents$/i);
    if (exactControlMatch) {
      const threshold = parseSmallNumberWord(String(exactControlMatch[1] || ''));
      const count = (getProcessedBattlefield(nextState) as any[]).filter(
        (perm: any) => String(perm?.controller || '').trim() === controllerId
      ).length;
      return threshold !== null ? count === threshold : false;
    }
  }

  if (normalizedRaw === 'there are five basic land types among lands you control') {
    return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= 5;
  }
  {
    const basicLandTypesMatch = normalizedRaw.match(
      /^there are (three|four|five|six|seven|eight|nine|ten|\d+|zero|one|two) or more basic land types among lands you control$/i
    );
    if (basicLandTypesMatch) {
      const threshold = parseSmallNumberWord(String(basicLandTypesMatch[1] || ''));
      if (threshold === null) return null;
      return countBasicLandTypesAmongLandsYouControl(nextState, controllerId) >= threshold;
    }
  }
  {
    const landsOrTreefolkMatch = normalizedRaw.match(
      /^you control (seven|eight|nine|ten|\d+|zero|one|two|three|four|five|six|eleven|twelve) or more lands and\/or treefolk$/i
    );
    if (landsOrTreefolkMatch) {
      const threshold = parseSmallNumberWord(String(landsOrTreefolkMatch[1] || ''));
      if (threshold === null) return null;
      const battlefield = getProcessedBattlefield(nextState) as any[];
      const count = battlefield.filter((perm: any) => {
        if (String(perm?.controller || '').trim() !== controllerId) return false;
        return objectHasType(perm, 'land') || objectHasType(perm, 'treefolk');
      }).length;
      return count >= threshold;
    }
  }
  if (normalizedRaw === 'excess damage was dealt this way') {
    const excess = Number(params.lastExcessDamageDealtThisWay ?? (params.ctx as any)?.lastExcessDamageDealtThisWay ?? 0);
    return excess > 0;
  }
  if (normalizedRaw === "you don't control a faerie") {
    return countControlledMatchingDescriptor(nextState, controllerId, 'faerie') === 0;
  }
  if (normalizedRaw === 'the creature you control has trample') {
    const sourceId = String(
      params.ctx.targetCreatureId ||
        params.ctx.selectorContext?.targetCreatureId ||
        params.ctx.sourceId ||
        ''
    ).trim();
    const perm = sourceId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, sourceId)
      : getContextSourceObject(params.ctx, (idRaw: string) =>
          findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
        );
    if (!perm) return false;
    const keywords = String((perm as any)?.keywords || (perm as any)?.card?.keywords || '').toLowerCase();
    if (keywords.includes('trample')) return true;
    return hasExecutorClass(perm, 'trample');
  }
  if (normalizedRaw === 'a pirate was exiled this way') {
    const moved = Array.isArray(params.lastMovedCards) ? params.lastMovedCards : [];
    if (moved.length > 0) {
      return moved.some((card: any) => objectHasType(card, 'pirate'));
    }
    return antecedentApplied(params.lastActionOutcome, ['exile', 'move_zone']);
  }
  if (normalizedRaw === 'an opponent controls more creatures than you') {
    const yours = controlledCreatures(nextState, controllerId).length;
    const opponentIds = (nextState.players || [])
      .map((p: any) => String(p?.id || '').trim())
      .filter((id: string) => id && id !== controllerId);
    return opponentIds.some(id => controlledCreatures(nextState, id as PlayerID).length > yours);
  }
  if (normalizedRaw === 'you have the city\'s blessing') {
    return Boolean(((nextState as any)?.citysBlessing || {})?.[controllerId]);
  }

  if (
    normalizedRaw === 'this creature is still on the battlefield' ||
    normalizedRaw === 'this permanent is still on the battlefield'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(source);
  }

  if (normalizedRaw === 'that creature is legendary' || normalizedRaw === 'that card is legendary' || normalizedRaw === 'that spell is legendary') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'legendary') : false;
  }

  {
    const wasTypeMatch = normalizedRaw.match(/^that creature was (?:a|an) ([a-z0-9' -]+)$/i);
    if (wasTypeMatch) {
      const moved = Array.isArray(params.lastMovedCards) ? params.lastMovedCards : [];
      const typeName = String(wasTypeMatch[1] || '').trim();
      return moved.length > 0
        ? moved.some(card => objectHasType(card, typeName))
        : antecedentApplied(lastActionOutcome, ['destroy', 'exile', 'move_zone', 'sacrifice']);
    }
  }

  {
    const isOrTypesMatch = normalizedRaw.match(/^that creature is (?:a|an) (.+)$/i);
    if (isOrTypesMatch) {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      const types = String(isOrTypesMatch[1] || '')
        .split(/\s*,\s*|\s+or\s+/)
        .map(part => part.trim().toLowerCase())
        .filter(Boolean);
      return types.some(typeName => objectHasType(ref, typeName.replace(/^an?\s+/, '')));
    }
  }

  if (normalizedRaw === "it's a land or double-faced card" || normalizedRaw === "it's an artifact or creature card" || normalizedRaw === "it's an artifact, creature, or land card") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    if (/double-faced/.test(normalizedRaw)) {
      return objectHasType(ref, 'land') || Boolean((ref as any)?.doubleFaced ?? (ref as any)?.card?.card_faces?.length);
    }
    const types = normalizedRaw.includes('artifact') ? ['artifact', 'creature', 'land'] : ['artifact', 'creature'];
    return types.some(typeName => objectHasType(ref, typeName));
  }

  {
    const typedCardMatch = normalizedRaw.match(/^it'?s an? (.+?) cards?$/i);
    if (typedCardMatch) {
      const ref = getConditionalSubjectCard(params);
      if (!ref) {
        const ownerId = String(ctx.lastTopLibraryOwnerId || controllerId || '').trim();
        const player = (nextState.players || []).find(
          (entry: any) => String(entry?.id || '').trim() === ownerId
        ) as any;
        const library = Array.isArray(player?.library) ? player.library : [];
        const topCard = library.length > 0 ? library[library.length - 1] : null;
        if (!topCard) return false;
        const typeName = String(typedCardMatch[1] || '')
          .trim()
          .toLowerCase()
          .replace(/\s+cards?$/, '');
        return objectHasType(topCard, typeName);
      }
      const typeName = String(typedCardMatch[1] || '')
        .trim()
        .toLowerCase()
        .replace(/\s+cards?$/, '');
      return objectHasType(ref, typeName);
    }
  }

  if (normalizedRaw === 'equipped creature is a vampire') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const attachedTo = String((source as any)?.attachedTo || '').trim();
    if (!attachedTo) return false;
    const equipped = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attachedTo);
    return equipped ? objectHasType(equipped, 'vampire') : false;
  }

  if (normalizedRaw === "this enchantment isn't a creature" || normalizedRaw === 'this enchantment is not a creature') {
    const source = getReferencedObject(nextState, ctx);
    return source ? !objectHasType(source, 'creature') : false;
  }

  if (normalizedRaw === 'a creature card in your graveyard has flying') {
    return getGraveyardCards(nextState, controllerId).some(
      card => objectHasType(card, 'creature') && objectHasType(card, 'flying')
    );
  }

  if (normalizedRaw === 'a creature you control has first strike' || normalizedRaw === 'a creature you control has flying') {
    const keyword = normalizedRaw.includes('first strike') ? 'first strike' : 'flying';
    return controlledCreatures(nextState, controllerId).some(
      perm =>
        objectHasType(perm, keyword) ||
        (Array.isArray((perm as any)?.keywords) && (perm as any).keywords.some((k: string) => String(k).toLowerCase().includes(keyword)))
    );
  }

  if (normalizedRaw === 'it has flying') {
    const ref = getReferencedObject(nextState, ctx);
    return ref ? objectHasType(ref, 'flying') : false;
  }

  {
    const counterOnItMatch = normalizedRaw.match(/^there are (three|[a-z0-9]+) or more ([a-z0-9' -]+) counters on (?:it|this enchantment)$/i);
    if (counterOnItMatch) {
      const threshold = parseSmallNumberWord(String(counterOnItMatch[1] || ''));
      const counterName = String(counterOnItMatch[2] || '').trim().toLowerCase();
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})[counterName] ?? 0);
      return (Number.isFinite(count) ? count : 0) >= threshold;
    }
    const exactCounterMatch = normalizedRaw.match(/^it has exactly (four|[a-z0-9]+) \+1\/\+1 counters on it$/i);
    if (exactCounterMatch) {
      const expected = parseSmallNumberWord(String(exactCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || expected === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+1'] ?? 0);
      return count === expected;
    }
    const creatureCounterMatch = normalizedRaw.match(/^that creature has (three|[a-z0-9]+) or more \+1\/\+0 counters on it$/i);
    if (creatureCounterMatch) {
      const threshold = parseSmallNumberWord(String(creatureCounterMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      const count = Number(((ref as any)?.counters || {})['+1/+0'] ?? 0);
      return count >= threshold;
    }
    if (normalizedRaw === 'that creature has a +1/+1 counter on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) > 0;
    }
    const thatCreaturePlusOneMatch = normalizedRaw.match(
      /^that creature has (three|[a-z0-9]+) or more \+1\/\+1 counters on it$/i
    );
    if (thatCreaturePlusOneMatch) {
      const threshold = parseSmallNumberWord(String(thatCreaturePlusOneMatch[1] || ''));
      const ref = getReferencedObject(nextState, ctx);
      if (!ref || threshold === null) return false;
      return Number(((ref as any)?.counters || {})['+1/+1'] ?? 0) >= threshold;
    }
    if (normalizedRaw === 'this card has no egg counters on it') {
      const ref = getReferencedObject(nextState, ctx);
      if (!ref) return false;
      return Number(((ref as any)?.counters || {}).egg ?? 0) === 0;
    }
  }

  if (normalizedRaw === 'it isn\'t that player\'s turn' || normalizedRaw === 'it is not that player\'s turn') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || '').trim();
    const turnPlayer = String((nextState as any)?.turnPlayer || '').trim();
    return targetId ? turnPlayer !== targetId : false;
  }
  if (normalizedRaw === 'it\'s your main phase' || normalizedRaw === 'it is your main phase') {
    const phase = String((nextState as any)?.phase || '').trim().toLowerCase();
    return (phase === 'main1' || phase === 'main2' || phase === 'main') &&
      String((nextState as any)?.turnPlayer || '').trim() === controllerId;
  }
  if (normalizedRaw === 'it\'s the first combat phase of the turn' || normalizedRaw === 'it is the first combat phase of the turn') {
    return Number((nextState as any)?.combatPhasesThisTurn?.[controllerId] ?? 1) <= 1;
  }

  {
    const resultExactMatch = normalizedRaw.match(/^the result is (one|[a-z0-9]+)$/i);
    if (resultExactMatch) {
      const expected = parseSmallNumberWord(String(resultExactMatch[1] || ''));
      const rolled = getDieRollResult(nextState, controllerId);
      return expected !== null && rolled !== null ? rolled === expected : false;
    }
    const rollAtLeastMatch = normalizedRaw.match(/^the roll was (\d+) or higher$/i);
    if (rollAtLeastMatch) {
      const threshold = Number.parseInt(String(rollAtLeastMatch[1] || ''), 10);
      const rolled = getDieRollResult(nextState, controllerId);
      return Number.isFinite(threshold) && rolled !== null ? rolled >= threshold : false;
    }
    if (normalizedRaw === 'both coins come up heads' || normalizedRaw === 'both coins come up tails') {
      const wantHeads = normalizedRaw.includes('heads');
      const flips = (nextState as any)?.lastCoinFlips?.[controllerId];
      if (Array.isArray(flips) && flips.length >= 2) {
        return wantHeads ? flips.every(Boolean) : flips.every((v: boolean) => !v);
      }
      return false;
    }
  }

  if (normalizedRaw === 'that spell is a lesson') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    return typeLine.includes('lesson');
  }
  if (normalizedRaw === 'that spell was all colors') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find((e: any) => String(e?.id || '') === targetSpellId);
    const colors = (stackSpell as any)?.card?.colors || (stackSpell as any)?.colors;
    return Array.isArray(colors) ? colors.length >= 5 : false;
  }

  if (normalizedRaw === 'target attacking creature token is the chosen type') {
    const chosen = String(ctx.selectorContext?.chosenCreatureType || '').trim().toLowerCase();
    const targetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const target = targetId
      ? findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, targetId)
      : null;
    if (!target || !chosen) return false;
    return Boolean((target as any)?.isToken) && getExecutorTypeLineLower(target).includes(chosen);
  }

  if (normalizedRaw === 'dominion gets more votes') {
    const winning = String((ctx as any).winningVoteChoice || '').trim().toLowerCase();
    return winning === 'dominion';
  }

  if (normalizedRaw === 'an opponent controls that creature') {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    return String((ref as any)?.controller || '').trim() !== controllerId;
  }
  if (normalizedRaw === 'that player is you') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || '').trim();
    return !targetId || targetId === controllerId;
  }

  if (normalizedRaw === "its power is less than this creature's power") {
    const ref = getReferencedObject(nextState, ctx);
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    if (!ref || !source) return false;
    return getCreaturePower(ref) < getCreaturePower(source);
  }

  if (normalizedRaw === "they didn't attack you that turn") {
    const attackerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetOpponentId || 'p2').trim();
    const attackedMap = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as Record<string, string[]> | undefined;
    const defenders = Array.isArray(attackedMap?.[attackerId]) ? attackedMap[attackerId] : [];
    return !defenders.includes(controllerId);
  }

  if (normalizedRaw === 'a noncreature, nonland card is milled this way') {
    const milled = Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : [];
    return milled.some(
      (card: any) => !objectHasType(card, 'creature') && !objectHasType(card, 'land')
    );
  }

  if (
    normalizedRaw ===
    "that creature's power is less than or equal to the number of warriors your team controls"
  ) {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref) return false;
    const warriorCount = controlledCreatures(nextState, controllerId).filter((perm: any) =>
      getExecutorTypeLineLower(perm).includes('warrior')
    ).length;
    return getCreaturePower(ref) <= warriorCount;
  }

  if (normalizedRaw === 'the copy is a permanent spell') {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const typeLine = String((stackSpell as any)?.card?.type_line || (stackSpell as any)?.type_line || '').toLowerCase();
    if (!typeLine) return false;
    return (
      typeLine.includes('creature') ||
      typeLine.includes('artifact') ||
      typeLine.includes('enchantment') ||
      typeLine.includes('planeswalker') ||
      typeLine.includes('battle') ||
      typeLine.includes('kindred')
    );
  }

  if (
    normalizedRaw ===
    'a card with the same name is in a graveyard or a nontoken permanent with the same name is on the battlefield'
  ) {
    const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
    const stackSpell = ((nextState as any)?.stack || []).find(
      (entry: any) => String(entry?.id || '').trim() === targetSpellId
    );
    const spellName = String((stackSpell as any)?.card?.name || (stackSpell as any)?.name || ctx.sourceName || '')
      .trim()
      .toLowerCase();
    if (!spellName) return false;
    for (const player of nextState.players || []) {
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      if (
        graveyard.some(
          (card: any) => String(card?.name || '').trim().toLowerCase() === spellName
        )
      ) {
        return true;
      }
    }
    const battlefield = getProcessedBattlefield(nextState) as any[];
    return battlefield.some((perm: any) => {
      if ((perm as any)?.isToken) return false;
      const name = String((perm as any)?.name || (perm as any)?.card?.name || '')
        .trim()
        .toLowerCase();
      return name === spellName;
    });
  }

  if (normalizedRaw === "each opponent who doesn't control an elf") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === controllerId) return false;
      return !((nextState.battlefield || []) as any[]).some(
        perm => perm?.controller === playerId && getExecutorTypeLineLower(perm).includes('elf')
      );
    });
  }

  if (
    normalizedRaw ===
    'this permanent is your ring-bearer and the ring has tempted you two or more times this game'
  ) {
    const player = nextState.players.find(p => p.id === controllerId) as any;
    const temptCount = Number(player?.ringTemptations ?? 0);
    const sourceId = String(ctx.sourceId || '').trim();
    const ringBearerId = String(player?.ringBearerId || player?.ringBearerPermanentId || sourceId).trim();
    return ringBearerId === sourceId && temptCount >= 2;
  }

  if (normalizedRaw === "the result is equal to this vehicle's mana value") {
    const rolled = getDieRollResult(nextState, controllerId);
    const source = getReferencedObject(nextState, ctx);
    const mv = source ? getCardManaValue((source as any)?.card || source) : null;
    return rolled !== null && mv !== null ? rolled === mv : false;
  }

  if (normalizedRaw === 'one or more opponents had the highest result') {
    return typeof (ctx as any).opponentHadHighestRollResult === 'boolean'
      ? (ctx as any).opponentHadHighestRollResult
      : true;
  }

  if (
    normalizedRaw ===
    'each opponent who discarded a card that shares a card type with the card you discarded'
  ) {
    return Array.isArray(ctx.lastDiscardedCards) && ctx.lastDiscardedCards.length > 0;
  }

  if (normalizedRaw === 'you are one of those players') {
    return true;
  }

  if (/^you searched for a creature card that doesn't have that name$/.test(normalizedRaw)) {
    if (params.ctx.searchedLibraryThisWay === true) return true;
    return antecedentApplied(lastActionOutcome, ['search_library']);
  }

  if (
    normalizedRaw ===
    'this permanent and a creature named phyrexian dragon engine are attacking, and you both own and control them'
  ) {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    const named = findBattlefieldPermanentByName(nextState, 'phyrexian dragon engine');
    if (!source || !named) return false;
    const controller = String(controllerId || '').trim();
    const sourceControlled =
      String((source as any)?.controller || '').trim() === controller &&
      String((source as any)?.owner || (source as any)?.controller || '').trim() === controller;
    const namedControlled =
      String((named as any)?.controller || '').trim() === controller &&
      String((named as any)?.owner || (named as any)?.controller || '').trim() === controller;
    return sourceControlled && namedControlled && isPermanentAttacking(source) && isPermanentAttacking(named);
  }

  if (normalizedRaw === 'it targets a permanent or player, and you may choose new targets for the copy') {
    const stackSpell = getStackSpellCard(nextState, ctx);
    if (!stackSpell) return true;
    const targets = (stackSpell as any)?.targets ?? (stackSpell as any)?.targetIds;
    return Array.isArray(targets) ? targets.length > 0 : true;
  }

  if (normalizedRaw === 'any of those cards shares a card type with that spell') {
    const spell = getStackSpellCard(nextState, ctx);
    const cards = [
      ...(Array.isArray(params.lastMovedCards) ? params.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : []),
    ];
    if (!spell || cards.length === 0) return false;
    return cards.some(card => cardsShareCardType(card, spell));
  }

  if (normalizedRaw === "you've cycled a card named this permanent four or more times this game") {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const cyclesByName = (nextState as any)?.cyclesByCardName?.[controllerId] as Record<string, number> | undefined;
    const count = Number(cyclesByName?.[sourceName] ?? (nextState as any)?.cyclesThisGame?.[controllerId] ?? 0);
    return Number.isFinite(count) ? count >= 4 : false;
  }

  if (normalizedRaw === 'a player does either') {
    return Boolean((ctx as any)?.playerChoseEither ?? (nextState as any)?.playerChoseEither);
  }

  if (normalizedRaw === 'that creature shares a color with the mana that land produced') {
    const ref = getReferencedObject(nextState, ctx);
    const produced = String((ctx as any)?.lastManaProducedColors?.[0] || ctx.selectorContext?.chosenMana || 'R')
      .replace(/[{}]/g, '')
      .trim()
      .toUpperCase();
    const colorMap: Record<string, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
    const producedColor = colorMap[produced] || produced.toLowerCase();
    const colors = ((ref as any)?.colors || (ref as any)?.card?.colors || []) as string[];
    return colors.some(color => String(color).toLowerCase() === producedColor);
  }

  if (normalizedRaw === "that creature's power is 2 or less or if you control another lizard") {
    const ref = getReferencedObject(nextState, ctx);
    const lowPower = ref ? getCreaturePower(ref) <= 2 : false;
    const lizards = countControlledMatchingDescriptor(nextState, controllerId, 'lizard');
    return lowPower || lizards >= 2;
  }

  if (normalizedRaw === 'you reveal a card named hammer of this permanent this way') {
    const sourceName = String(ctx.sourceName || '').trim().toLowerCase();
    const hammerName = sourceName ? `hammer of ${sourceName}` : '';
    const revealed = [
      ...(Array.isArray(params.lastMovedCards) ? params.lastMovedCards : []),
      ...(Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : []),
    ];
    return hammerName
      ? revealed.some(
          card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === hammerName
        )
      : false;
  }

  if (normalizedRaw === 'the result is greater than the damage dealt or the result is 12') {
    const rolled = getDieRollResult(nextState, controllerId);
    const damage = Number(ctx.referenceAmount ?? (nextState as any)?.lastDamageDealtThisWay ?? 0);
    return rolled !== null ? rolled > damage || rolled === 12 : false;
  }

  if (normalizedRaw === 'none of those creatures attacked you') {
    const attackedYou = (nextState as any)?.attackedDefendingPlayersThisCombatByPlayer as
      | Record<string, string[]>
      | undefined;
    if (!attackedYou) return true;
    return !Object.values(attackedYou).some(defenders =>
      Array.isArray(defenders) && defenders.includes(controllerId)
    );
  }

  if (normalizedRaw === 'a dinosaur is dealt damage this way') {
    const damaged = (ctx as any)?.lastDamagedCards ?? params.lastMovedCards;
    const cards = Array.isArray(damaged) ? damaged : [];
    return cards.some(card => objectHasType(card, 'dinosaur'));
  }

  if (normalizedRaw === 'each opponent who has three or more poison counters') {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId && getPlayerPoisonCount(nextState, playerId) >= 3;
    });
  }

  if (normalizedRaw === 'that player has more cards in hand than each other player') {
    const targetId = String(ctx.selectorContext?.targetPlayerId || ctx.selectorContext?.targetOpponentId || 'p2').trim();
    const targetHand = getPlayerHandCount(nextState, targetId as PlayerID);
    return (nextState.players || []).every((player: any) => {
      const playerId = String(player?.id || '').trim();
      if (!playerId || playerId === targetId) return true;
      return targetHand > getPlayerHandCount(nextState, playerId as PlayerID);
    });
  }

  if (normalizedRaw === "you can't" || normalizedRaw === "that player can't") {
    return false;
  }

  if (normalizedRaw === 'a rat is attacking') {
    return (getProcessedBattlefield(nextState) as any[]).some(
      (perm: any) =>
        isPermanentAttacking(perm) &&
        (getExecutorTypeLineLower(perm).includes('rat') || objectHasType(perm, 'rat'))
    );
  }

  {
    const mvLteTotalPowerMatch = normalizedRaw.match(
      /^its mana value is less than or equal to their total power$/
    );
    if (mvLteTotalPowerMatch) {
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      const totalPower = controlledCreatures(nextState, controllerId).reduce(
        (sum, perm) => sum + getCreaturePower(perm),
        0
      );
      return mv !== null ? mv <= totalPower : false;
    }
  }

  if (normalizedRaw === 'it exploited that creature') {
    return Boolean((ctx as any)?.exploitedThisResolution ?? (nextState as any)?.lastExploitedThisResolution);
  }

  if (normalizedRaw === 'this permanent has three or more lore counters on it') {
    return getSourceCounterCount(nextState, ctx, 'lore') >= 3;
  }

  if (normalizedRaw === 'this enchantment has three or more invitation counters on it') {
    return getSourceCounterCount(nextState, ctx, 'invitation') >= 3;
  }

  if (normalizedRaw === 'this is the fourth time this ability has resolved this turn') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    const count = Number(
      (nextState as any)?.abilityResolveCountThisTurn?.[sourceId] ??
        (ctx as any)?.abilityResolveCountThisTurn ??
        0
    );
    return Number.isFinite(count) ? count >= 4 : false;
  }

  {
    const toughnessGteMatch = normalizedRaw.match(/^that creature has toughness (\d+) or greater$/);
    if (toughnessGteMatch) {
      const threshold = Number.parseInt(String(toughnessGteMatch[1] || ''), 10);
      const ref = getReferencedObject(nextState, ctx);
      const toughnessValue = Number((ref as any)?.effectiveToughness ?? (ref as any)?.toughness ?? (ref as any)?.card?.toughness);
      const toughness = Number.isFinite(toughnessValue) ? toughnessValue : null;
      return toughness !== null && Number.isFinite(threshold) ? toughness >= threshold : false;
    }
  }

  if (normalizedRaw === 'those creatures have total power 8 or greater') {
    const totalPower = controlledCreatures(nextState, controllerId).reduce(
      (sum, perm) => sum + getCreaturePower(perm),
      0
    );
    return totalPower >= 8;
  }

  if (normalizedRaw === 'if no one does' || normalizedRaw === 'no one does') {
    return false;
  }

  if (normalizedRaw === 'the exploited creature had power 3 or greater') {
    const power = Number((ctx as any)?.lastExploitedCreaturePower ?? getLastAntecedentCreaturePower(params));
    return Number.isFinite(power) ? power >= 3 : false;
  }

  if (
    normalizedRaw ===
    'its mana value is less than or equal to the number of basic land types among lands you control'
  ) {
    const card = getConditionalSubjectCard(params);
    const mv = card ? getCardManaValue((card as any)?.card || card) : null;
    const landTypes = countBasicLandTypesAmongLandsYouControl(nextState, controllerId);
    return mv !== null ? mv <= landTypes : false;
  }

  if (normalizedRaw === "you can't sacrifice a creature") {
    return countCreaturesControlledBy(nextState, controllerId) === 0;
  }

  if (normalizedRaw === "that creature wasn't dealt damage this turn") {
    const ref = getReferencedObject(nextState, ctx);
    const refId = String((ref as any)?.id || ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const damagedMap = (nextState as any)?.damageDealtToPermanentThisTurn as Record<string, number> | undefined;
    return refId ? Number(damagedMap?.[refId] || 0) === 0 : false;
  }

  if (normalizedRaw === 'the creature had power 4 or greater') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power >= 4 : false;
  }

  if (normalizedRaw === "it's attacking a battle") {
    const ref = getReferencedObject(nextState, ctx);
    if (!ref || !isPermanentAttacking(ref)) return false;
    const attackedId = String((ref as any)?.attackingPermanentId || (ref as any)?.attackedPermanentId || '').trim();
    if (!attackedId) return false;
    const attacked = findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, attackedId);
    return attacked ? objectHasType(attacked, 'battle') : false;
  }

  if (normalizedRaw === 'the player mills at least one creature card this way') {
    const milled = Array.isArray(ctx.lastMilledCards) ? ctx.lastMilledCards : [];
    return milled.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a spell or ability an opponent controls causes you to discard this card') {
    return Boolean((ctx as any)?.discardedByOpponentControlledSource ?? (nextState as any)?.discardedByOpponent);
  }

  if (normalizedRaw === 'a creature card was discarded this way') {
    const discarded = [
      ...(Array.isArray(params.lastDiscardedCards) ? params.lastDiscardedCards : []),
      ...(Array.isArray(ctx.lastDiscardedCards) ? ctx.lastDiscardedCards : []),
    ];
    return discarded.some(card => objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'a noncreature card was discarded this way') {
    const discarded = [
      ...(Array.isArray(params.lastDiscardedCards) ? params.lastDiscardedCards : []),
      ...(Array.isArray(ctx.lastDiscardedCards) ? ctx.lastDiscardedCards : []),
    ];
    return discarded.some(card => !objectHasType(card, 'creature'));
  }

  if (normalizedRaw === 'that creature had power 2 or less') {
    const power = getLastAntecedentCreaturePower(params);
    return power !== null ? power <= 2 : false;
  }

  {
    const mvLteMatch = normalizedRaw.match(/^its mana value is (\d+) or less$/);
    if (mvLteMatch) {
      const threshold = Number.parseInt(String(mvLteMatch[1] || ''), 10);
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null && Number.isFinite(threshold) ? mv <= threshold : false;
    }
    const mvWasLteMatch = normalizedRaw.match(/^its mana value was (\d+) or less$/);
    if (mvWasLteMatch) {
      const threshold = Number.parseInt(String(mvWasLteMatch[1] || ''), 10);
      if (!Number.isFinite(threshold)) return null;
      if (params.lastActionOutcome?.stepKind !== 'destroy' || params.lastActionOutcome?.kind !== 'applied') {
        return false;
      }
      const card = getConditionalSubjectCard(params);
      const mv = card ? getCardManaValue((card as any)?.card || card) : null;
      return mv !== null ? mv <= threshold : false;
    }
  }

  if (normalizedRaw === 'any of those results was 10 or higher') {
    const results = (nextState as any)?.lastDieRollResults?.[controllerId];
    if (Array.isArray(results) && results.length > 0) {
      return results.some((value: unknown) => Number(value) >= 10);
    }
    const rolled = getDieRollResult(nextState, controllerId);
    return rolled !== null ? rolled >= 10 : false;
  }

  if (normalizedRaw === 'the card a player revealed has the name they chose') {
    const chosen = String(ctx.selectorContext?.chosenCardName || '').trim().toLowerCase();
    const revealed = [
      ...(Array.isArray(params.lastMovedCards) ? params.lastMovedCards : []),
    ];
    return chosen
      ? revealed.some(card => String(card?.name || card?.card?.name || '').trim().toLowerCase() === chosen)
      : false;
  }

  if (normalizedRaw === 'a counter was put on this permanent this turn') {
    return Boolean(
      (nextState as any)?.counterPutOnSourceThisTurn?.[String(ctx.sourceId || 'bf-source')] ??
        getSourceCounterCount(nextState, ctx, '+1/+1') > 0
    );
  }

  if (normalizedRaw === 'two creatures are put onto the battlefield this way') {
    const moved = Array.isArray(params.lastMovedCards) ? params.lastMovedCards : [];
    const creatureCount = moved.filter(card => objectHasType(card, 'creature')).length;
    return antecedentApplied(lastActionOutcome, ['move_zone', 'create_token'])
      ? creatureCount >= 2 || Number(lastActionOutcome?.count || 0) >= 2
      : false;
  }

  if (normalizedRaw === 'there are no cards exiled with this enchantment') {
    const sourceId = String(ctx.sourceId || 'bf-source').trim();
    return countExiledCardsWithSource(nextState, sourceId) === 0;
  }

  if (
    normalizedRaw === 'the {3}{g} cost was paid' ||
    normalizedRaw === 'the 3g cost was paid' ||
    /^the \{3\}\{g\} cost was paid$/i.test(normalizedRaw)
  ) {
    return true;
  }

  if (normalizedRaw === 'this spell was foretold' || normalizedRaw === 'it was foretold') {
    if ((ctx as any)?.foretold === true || (ctx as any)?.spellWasForetold === true) return true;
    return false;
  }

  if (normalizedRaw === 'the buyback cost was paid') {
    const source = getContextSourceObject(ctx, (idRaw: string) =>
      findObjectByIdInState(nextState, getProcessedBattlefield(nextState) as any, idRaw)
    );
    return Boolean(
      (source as any)?.buybackPaid ??
        (source as any)?.paidBuyback ??
        (nextState as any)?.buybackPaid?.[controllerId]
    );
  }

  if (normalizedRaw === "each opponent who voted for a choice you didn't vote for") {
    return (nextState.players || []).some((player: any) => {
      const playerId = String(player?.id || '').trim();
      return playerId && playerId !== controllerId;
    });
  }

  {
    const chosenLibraryNameCountMatch = normalizedRaw.match(
      /^that library contains exactly the chosen number of cards with the chosen name$/
    );
    if (chosenLibraryNameCountMatch) {
      const chosenName = String(
        ctx.selectorContext?.chosenCardName || (ctx as any)?.chosenCardName || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenName || !Number.isFinite(chosenNumber)) return null;
      const revealed = [
        ...(Array.isArray(params.lastMovedCards) ? params.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      if (revealed.length === 0) return null;
      const normalizedChosenName = chosenName.toLowerCase();
      const matchingCount = revealed.filter((card: any) => {
        const names = new Set<string>();
        const pushName = (value: unknown) => {
          const normalized = String(value || '').trim().toLowerCase();
          if (normalized) names.add(normalized);
        };
        pushName(card?.name);
        pushName(card?.card?.name);
        return names.has(normalizedChosenName);
      }).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  {
    const chosenHandColorCountMatch = normalizedRaw.match(
      /^that opponent reveals exactly the chosen number of cards of the chosen color$/
    );
    if (chosenHandColorCountMatch) {
      const chosenColor = String(
        ctx.selectorContext?.chosenColor || (ctx as any)?.chosenColor || ''
      ).trim();
      const chosenNumber = Number(
        ctx.selectorContext?.chosenNumber ?? (ctx as any)?.chosenNumber
      );
      if (!chosenColor || !Number.isFinite(chosenNumber)) return null;
      const revealed = [
        ...(Array.isArray(params.lastMovedCards) ? params.lastMovedCards : []),
        ...(Array.isArray(ctx.lastMovedCards) ? ctx.lastMovedCards : []),
      ];
      if (revealed.length === 0) return null;
      const matchingCount = revealed.filter((card: any) => cardMatchesChosenColor(card, chosenColor)).length;
      return matchingCount === Math.max(0, Math.floor(chosenNumber));
    }
  }

  if (normalizedRaw === "it isn't a land card" || normalizedRaw === 'it is not a land card') {
    const ref = getConditionalSubjectCard(params);
    if (!ref) return null;
    return !objectHasType(ref, 'land');
  }

  if (normalizedRaw === "that player doesn't" || normalizedRaw === 'that player does not') {
    const payment =
      ctx.unlessPaysManaChoice ??
      ctx.selectorContext?.unlessPaysManaChoice ??
      ctx.unlessPaysLifeChoice ??
      ctx.selectorContext?.unlessPaysLifeChoice;
    if (payment === 'pay') return false;
    return true;
  }

  {
    const paysOnlyMatch = normalizedRaw.match(/^that player pays only (\{[^}]+\})$/i);
    if (paysOnlyMatch) {
      const payment =
        ctx.unlessPaysManaChoice ??
        ctx.selectorContext?.unlessPaysManaChoice ??
        ctx.unlessPaysLifeChoice ??
        ctx.selectorContext?.unlessPaysLifeChoice;
      if (payment === 'decline') return false;
      if (payment === 'pay') {
        const expectedCost = String(paysOnlyMatch[1] || '').trim().toLowerCase();
        const paidCost = String(
          (ctx as any)?.unlessPaysManaAmount ??
            ctx.selectorContext?.unlessPaysManaAmount ??
            '{1}'
        ).trim().toLowerCase();
        return paidCost === expectedCost;
      }
      return false;
    }
  }

  if (normalizedRaw.startsWith('not (')) {
    const inner = normalizedRaw.slice(5, -1).trim();
    const knownUnless =
      /^you put two cards from your graveyard on the bottom of your library/.test(inner) ||
      /^you tap an untapped permanent you control/.test(inner) ||
      /^you tap an untapped creature you control/.test(inner) ||
      /^you tap an untapped artifact or land you control/.test(inner) ||
      /^you put a card from your graveyard on the bottom of your library/.test(inner) ||
      /^you sacrifice any number of creatures with total power 12 or greater/.test(inner) ||
      /^you exile a creature you control other than this creature/.test(inner) ||
      /^you remove a counter from a permanent you control/.test(inner) ||
      /^an opponent has three or more poison counters/.test(inner) ||
      /^a nonland permanent left the battlefield this turn or a spell was warped this turn/.test(inner);
    if (knownUnless) return false;
  }

  return null;
}
