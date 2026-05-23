export type ReplacementZone = 'battlefield' | 'graveyard' | 'exile' | 'hand' | 'library' | 'command' | 'stack';

export type ReplacementEvent = ZoneChangeReplacementEvent | BattlefieldEntryReplacementEvent | DamageReplacementEvent | LifeGainReplacementEvent | LibrarySearchReplacementEvent | TokenCreationReplacementEvent | CounterPlacementReplacementEvent | CardDrawReplacementEvent;

export interface ZoneChangeReplacementEvent {
  type: 'zone-change';
  object?: any;
  objectId?: string;
  sourceZone?: ReplacementZone;
  destinationZone: ReplacementZone;
  controller?: string;
  owner?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface BattlefieldEntryReplacementEvent {
  type: 'battlefield-entry';
  state?: any;
  card?: any;
  permanent?: any;
  controllerId: string;
  entersTapped?: boolean;
  entryCounters?: Record<string, number>;
  entersTransformed?: boolean;
  entersFaceDown?: boolean;
  copySourceId?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface DamageReplacementEvent {
  type: 'damage';
  state?: any;
  amount: number;
  replacementAmount?: number;
  source?: any;
  sourceId?: string;
  target?: any;
  targetId?: string;
  targetPlayerId?: string;
  combatDamage?: boolean;
  damageKind?: 'combat' | 'noncombat';
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface CardDrawReplacementEvent {
  type: 'card-draw';
  state?: any;
  playerId: string;
  count: number;
  drawIndex?: number;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface LifeGainReplacementEvent {
  type: 'life-gain';
  state?: any;
  playerId: string;
  amount: number;
  source?: any;
  sourceId?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface LibrarySearchReplacementEvent {
  type: 'library-search';
  game?: any;
  state?: any;
  searchingPlayerId: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface TokenCreationReplacementEvent {
  type: 'token-creation';
  state?: any;
  controllerId: string;
  count: number;
  tokenName?: string;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface CounterPlacementReplacementEvent {
  type: 'counter-placement';
  state?: any;
  targetPermanentId: string;
  controllerId?: string;
  deltas: Record<string, number>;
  modifiedDeltas?: Record<string, number>;
  cause?: string;
  metadata?: Record<string, unknown>;
}

export interface ReplacementEffectResult {
  applied: boolean;
  choiceRequired?: boolean;
  eventType: ReplacementEvent['type'];
  effectId?: string;
  sourceName?: string;
  originalDestination?: ReplacementZone;
  replacementDestination?: ReplacementZone;
  replacementOptions?: ReplacementZone[];
  originalAmount?: number;
  replacementAmount?: number;
  preventedAmount?: number;
  lifeGain?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type ReplacementEffectEvaluator = (event: ReplacementEvent) => ReplacementEffectResult | null;

const STACK_GRAVEYARD_EXILE_ABILITIES = new Set(['flashback', 'jump-start', 'escape', 'disturb', 'harmonize']);

const LIFE_GAIN_PREVENTION_CARDS: Record<string, {
  effect: string;
  affectsOpponents: boolean;
  affectsAll: boolean;
  isStatic: boolean;
}> = {
  "erebos, god of the dead": { effect: "Your opponents can't gain life", affectsOpponents: true, affectsAll: false, isStatic: true },
  "sulfuric vortex": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "leyline of punishment": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "tibalt, rakish instigator": { effect: "Your opponents can't gain life", affectsOpponents: true, affectsAll: false, isStatic: true },
  "stigma lasher": { effect: "Player dealt damage by ~ can't gain life for the rest of the game", affectsOpponents: false, affectsAll: false, isStatic: false },
  "everlasting torment": { effect: "Players can't gain life. Damage causes -1/-1 counters.", affectsOpponents: false, affectsAll: true, isStatic: true },
  "havoc festival": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "rain of gore": { effect: "If a spell or ability would cause its controller to gain life, that player loses that much life instead", affectsOpponents: false, affectsAll: true, isStatic: true },
  "witch hunt": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "forsaken wastes": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "rampaging ferocidon": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "archfiend of ifnir": { effect: "Your opponents can't gain life (during your turn)", affectsOpponents: true, affectsAll: false, isStatic: true },
  "kederekt parasite": { effect: "Whenever an opponent draws a card, if you control a red permanent, damage dealt", affectsOpponents: true, affectsAll: false, isStatic: false },
  "roiling vortex": { effect: "Players can't gain life", affectsOpponents: false, affectsAll: true, isStatic: true },
  "quakebringer": { effect: "Your opponents can't gain life (while in graveyard too)", affectsOpponents: true, affectsAll: false, isStatic: true },
};

const LIFE_GAIN_REVERSAL_CARDS: Record<string, {
  effect: string;
  affectsOpponents: boolean;
  affectsAll: boolean;
  isStatic: boolean;
}> = {
  "tainted remedy": { effect: "If an opponent would gain life, that player loses that much life instead", affectsOpponents: true, affectsAll: false, isStatic: true },
  "rain of gore": { effect: "If a spell or ability would cause its controller to gain life, that player loses that much life instead", affectsOpponents: false, affectsAll: true, isStatic: true },
  "archfiend of despair": { effect: "Your opponents can't gain life. At end of each end step, each opponent who lost life this turn loses that much life again.", affectsOpponents: true, affectsAll: false, isStatic: true },
  "false cure": { effect: "Until end of turn, whenever a player gains life, that player loses 2 life for each 1 life gained", affectsOpponents: false, affectsAll: true, isStatic: false },
};

const SEARCH_PREVENTION_CARDS: Record<string, { affectsOpponents: boolean; affectsSelf: boolean }> = {
  "stranglehold": { affectsOpponents: true, affectsSelf: false },
  "ashiok, dream render": { affectsOpponents: true, affectsSelf: false },
  "mindlock orb": { affectsOpponents: true, affectsSelf: true },
  "shadow of doubt": { affectsOpponents: true, affectsSelf: true },
  "leonin arbiter": { affectsOpponents: true, affectsSelf: true },
};

const SEARCH_LIMIT_CARDS: Record<string, { limit: number; affectsOpponents: boolean }> = {
  "aven mindcensor": { limit: 4, affectsOpponents: true },
};

const SEARCH_TRIGGER_CARDS: Record<string, { effect: string; affectsOpponents: boolean }> = {
  "ob nixilis, unshackled": { effect: "Sacrifice a creature and lose 10 life", affectsOpponents: true },
};

const SEARCH_CONTROL_CARDS = new Set(["opposition agent"]);

function normalizeDeltas(deltas: Record<string, number> | undefined): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [key, value] of Object.entries(deltas || {})) {
    const amount = Math.floor(Number(value || 0));
    if (amount !== 0) normalized[key] = amount;
  }
  return normalized;
}

function deltasDiffer(left: Record<string, number>, right: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (Number(left[key] || 0) !== Number(right[key] || 0)) return true;
  }
  return false;
}

function sumPositiveDeltas(deltas: Record<string, number>): number {
  return Object.values(deltas).reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0);
}

function hasPositiveDeltas(deltas: Record<string, number> | undefined): boolean {
  return Object.values(deltas || {}).some((value) => Number(value || 0) > 0);
}

function getCardName(card: any): string {
  return String(card?.name || '').trim();
}

function getCardTypeLine(card: any): string {
  return normalizeReplacementText(card?.type_line || card?.type || '');
}

function getCardOracleText(card: any): string {
  return normalizeReplacementText(card?.oracle_text || card?.text || '');
}

function getEventStateBattlefield(event: { state?: any; metadata?: Record<string, unknown> }): any[] {
  const stateBattlefield = Array.isArray(event.state?.battlefield) ? event.state.battlefield : [];
  if (stateBattlefield.length > 0) return stateBattlefield;
  const metadataBattlefield = Array.isArray(event.metadata?.battlefield) ? event.metadata?.battlefield : [];
  return metadataBattlefield;
}

function getDamageSourceColors(source: any): string[] {
  const rawColors = Array.isArray(source?.colors)
    ? source.colors
    : Array.isArray(source?.color_identity)
      ? source.color_identity
      : [];
  return rawColors.map((color: any) => String(color || '').trim().toUpperCase()).filter(Boolean);
}

function damageCannotBePrevented(event: DamageReplacementEvent): { sourceName?: string; reason: string } | null {
  if (event.metadata?.damageCanBePrevented === false) {
    return { reason: 'damage_prevention_disallowed' };
  }

  const sourceOracle = getCardOracleText(event.source?.card || event.source);
  if (sourceOracle.includes("damage can't be prevented")
    || (sourceOracle.includes("damage that would be dealt by") && sourceOracle.includes("can't be prevented"))) {
    return {
      sourceName: getCardName(event.source?.card || event.source),
      reason: 'source_damage_prevention_disallowed',
    };
  }

  for (const permanent of getEventStateBattlefield(event)) {
    const oracle = getCardOracleText(permanent?.card || permanent);
    if (!oracle.includes("damage can't be prevented")) continue;
    return {
      sourceName: getCardName(permanent?.card || permanent),
      reason: 'static_damage_prevention_disallowed',
    };
  }

  return null;
}

function replacementEffectModifiedAmount(originalAmount: number, rawEffects: unknown): { finalAmount: number; appliedEffects: string[] } | null {
  if (!Array.isArray(rawEffects) || rawEffects.length === 0) return null;

  let amount = originalAmount;
  const appliedEffects: string[] = [];
  for (const effect of rawEffects as any[]) {
    const type = normalizeReplacementText(effect?.type || effect?.kind || '');
    const source = String(effect?.source || effect?.sourceName || 'Damage replacement').trim();
    const before = amount;
    if (type === 'prevent') {
      amount = 0;
    } else if (type === 'double') {
      amount *= 2;
    } else if (type === 'triple') {
      amount *= 3;
    } else if (type === 'halve') {
      amount = Math.floor(amount / 2);
    } else if (type === 'halve_round_up' || type === 'halve round up') {
      amount = Math.ceil(amount / 2);
    } else if (type === 'add_flat' || type === 'add flat') {
      amount += Number(effect?.value || 1);
    } else {
      continue;
    }
    amount = Math.max(0, amount);
    appliedEffects.push(`${source}: ${type} (${before} -> ${amount})`);
  }

  return appliedEffects.length > 0 ? { finalAmount: amount, appliedEffects } : null;
}

function getDredgeOptions(event: CardDrawReplacementEvent): Array<{ cardId: string; cardName: string; dredge: number }> {
  const zone = event.state?.zones?.[event.playerId] || {};
  const graveyard = Array.isArray(zone.graveyard) ? zone.graveyard : [];
  const libraryCount = Array.isArray(event.state?.libraries?.[event.playerId])
    ? event.state.libraries[event.playerId].length
    : Number(zone.libraryCount || 0);
  const options: Array<{ cardId: string; cardName: string; dredge: number }> = [];

  for (const card of graveyard) {
    const oracle = getCardOracleText(card);
    const match = oracle.match(/\bdredge\s+(\d+)\b/i);
    if (!match) continue;
    const dredge = parseInt(match[1], 10);
    if (!Number.isFinite(dredge) || dredge <= 0 || libraryCount < dredge) continue;
    options.push({
      cardId: String(card?.id || '').trim(),
      cardName: getCardName(card) || 'Dredge card',
      dredge,
    });
  }

  return options;
}

function normalizeReplacementText(value: unknown): string {
  return String(value || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function normalizeCounterName(value: unknown): string {
  return normalizeReplacementText(value)
    .replace(/ counters?$/i, '')
    .replace(/^an?\s+/i, '')
    .trim();
}

function permanentHasCounter(permanent: any, counterName: string): boolean {
  const counters = permanent?.counters;
  if (!counters || typeof counters !== 'object' || Array.isArray(counters)) return false;
  const target = normalizeCounterName(counterName);
  for (const [name, amountRaw] of Object.entries(counters as Record<string, unknown>)) {
    if (normalizeCounterName(name) === target && Number(amountRaw || 0) > 0) {
      return true;
    }
  }
  return false;
}

function getReplacementSourceName(permanent: any): string | undefined {
  const value = String(permanent?.leaveBattlefieldReplacementSourceName || permanent?.card?.leaveBattlefieldReplacementSourceName || '').trim();
  return value || undefined;
}

function getReplacementLifeGain(permanent: any): number | undefined {
  const value = Number(permanent?.leaveBattlefieldReplacementLifeGain || permanent?.card?.leaveBattlefieldReplacementLifeGain || 0);
  return value > 0 ? value : undefined;
}

function getStackCastWithAbility(stackItem: any): string {
  return normalizeReplacementText(
    stackItem?.card?.castWithAbility
      || stackItem?.castWithAbility
      || stackItem?.alternativeCost
      || ''
  );
}

function stackItemExilesAfterResolution(stackItem: any): boolean {
  return stackItem?.exileAfterResolution === true
    || stackItem?.card?.exileAfterResolution === true
    || stackItem?.card?.card?.exileAfterResolution === true;
}

function getObjectCardId(object: any): string {
  return String(object?.card?.id || object?.id || '').trim();
}

function objectIsCommander(event: ZoneChangeReplacementEvent): boolean {
  const object = event.object;
  if (object?.isCommander === true || object?.card?.isCommander === true) return true;

  const commanderIds = Array.isArray(event.metadata?.commanderIds) ? event.metadata?.commanderIds : [];
  const cardId = getObjectCardId(object);
  return Boolean(cardId && commanderIds.some((id) => String(id || '') === cardId));
}

const leaveBattlefieldExileEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change' || event.sourceZone !== 'battlefield') return null;
  if (event.destinationZone === 'exile') return null;

  const permanent = event.object;
  const destination = event.destinationZone;
  const explicitDestination = normalizeReplacementText(
    permanent?.leaveBattlefieldReplacementDestination || permanent?.card?.leaveBattlefieldReplacementDestination || ''
  );

  if (explicitDestination === 'exile') {
    return {
      applied: true,
      eventType: event.type,
      effectId: 'leave-battlefield-exile-instead',
      sourceName: getReplacementSourceName(permanent),
      originalDestination: destination,
      replacementDestination: 'exile',
      lifeGain: getReplacementLifeGain(permanent),
      reason: 'explicit_leave_battlefield_replacement',
    };
  }

  if (destination !== 'graveyard') return null;

  const typeLine = normalizeReplacementText(permanent?.card?.type_line || permanent?.type_line || '');
  if (typeLine.includes('creature') && permanentHasCounter(permanent, 'finality')) {
    return {
      applied: true,
      eventType: event.type,
      effectId: 'finality-counter-exile-instead',
      originalDestination: destination,
      replacementDestination: 'exile',
      reason: 'finality_counter',
    };
  }

  return null;
};

const tokenLeaveBattlefieldEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change' || event.sourceZone !== 'battlefield') return null;
  if (event.destinationZone === 'battlefield') return null;
  if (event.object?.isToken !== true && event.object?.card?.isToken !== true) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'token-ceases-to-exist',
    originalDestination: event.destinationZone,
    reason: 'token_left_battlefield',
    metadata: {
      ceasesToExist: true,
    },
  };
};

const stackGraveyardExileEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change' || event.sourceZone !== 'stack' || event.destinationZone !== 'graveyard') return null;

  const stackItem = event.object;
  const castWithAbility = getStackCastWithAbility(stackItem);
  const explicitExileAfterResolution = stackItemExilesAfterResolution(stackItem);
  if (!explicitExileAfterResolution && !STACK_GRAVEYARD_EXILE_ABILITIES.has(castWithAbility)) {
    return null;
  }

  return {
    applied: true,
    eventType: event.type,
    effectId: explicitExileAfterResolution ? 'stack-exile-after-resolution' : 'stack-ability-exile-after-resolution',
    sourceName: String(stackItem?.card?.name || stackItem?.name || '').trim() || undefined,
    originalDestination: 'graveyard',
    replacementDestination: 'exile',
    reason: explicitExileAfterResolution ? 'exile_after_resolution' : 'cast_with_ability_exiles_after_resolution',
    metadata: {
      ...(castWithAbility ? { castWithAbility } : {}),
    },
  };
};

const commanderZoneChoiceEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'zone-change') return null;
  if (!['graveyard', 'exile', 'hand', 'library'].includes(event.destinationZone)) return null;
  if (!objectIsCommander(event)) return null;

  const object = event.object;
  const cardId = getObjectCardId(object);

  return {
    applied: false,
    choiceRequired: true,
    eventType: event.type,
    effectId: 'commander-zone-replacement-choice',
    sourceName: String(object?.card?.name || object?.name || '').trim() || undefined,
    originalDestination: event.destinationZone,
    replacementDestination: event.destinationZone,
    replacementOptions: ['command', event.destinationZone],
    reason: 'commander_zone_replacement_choice',
    metadata: {
      commandZoneChoice: true,
      ...(cardId ? { commanderId: cardId } : {}),
    },
  };
};

const battlefieldEntryReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'battlefield-entry') return null;

  const entryCounters = normalizeDeltas(event.entryCounters);
  const entersTapped = event.entersTapped === true;
  const entersTransformed = event.entersTransformed === true;
  const entersFaceDown = event.entersFaceDown === true;
  const copySourceId = String(event.copySourceId || '').trim();
  const hasEntryReplacement = entersTapped || hasPositiveDeltas(entryCounters) || entersTransformed || entersFaceDown || Boolean(copySourceId);
  if (!hasEntryReplacement) return null;

  const effects: string[] = [];
  if (entersTapped) effects.push('entersTapped');
  if (hasPositiveDeltas(entryCounters)) effects.push('entryCounters');
  if (entersTransformed) effects.push('entersTransformed');
  if (entersFaceDown) effects.push('entersFaceDown');
  if (copySourceId) effects.push('copy');

  return {
    applied: true,
    eventType: event.type,
    effectId: effects.length === 1 ? `battlefield-entry-${effects[0]}` : 'battlefield-entry-modified',
    sourceName: getCardName(event.card || event.permanent?.card) || undefined,
    reason: 'battlefield_entry_replacement',
    metadata: {
      controllerId: String(event.controllerId || ''),
      effects,
      entersTapped,
      entryCounters,
      entersTransformed,
      entersFaceDown,
      ...(copySourceId ? { copySourceId } : {}),
    },
  };
};

const damagePreventionDisallowedEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;
  const disallowed = damageCannotBePrevented(event);
  if (!disallowed) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'damage-prevention-disallowed',
    sourceName: disallowed.sourceName,
    originalAmount,
    replacementAmount: originalAmount,
    preventedAmount: 0,
    reason: disallowed.reason,
    metadata: {
      damageCanBePrevented: false,
      targetId: String(event.targetId || event.target?.id || event.targetPlayerId || '').trim(),
    },
  };
};

const shieldCounterDamagePreventionEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0 || !permanentHasCounter(event.target, 'shield')) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'shield-counter-prevent-damage',
    sourceName: String(event.target?.card?.name || event.target?.name || '').trim() || undefined,
    originalAmount,
    replacementAmount: 0,
    preventedAmount: originalAmount,
    reason: 'shield_counter',
    metadata: {
      targetId: String(event.targetId || event.target?.id || '').trim(),
    },
  };
};

const damagePreventionEffectEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const targetPlayerId = String(event.targetPlayerId || '').trim();
  const targetPermanentId = String(event.targetId || event.target?.id || '').trim();
  const normalizedSourceId = String(event.sourceId || event.source?.id || '').trim();
  const sourceColors = getDamageSourceColors(event.source?.card || event.source);
  const currentTurn = Number(event.state?.turnNumber ?? event.state?.turn ?? 0) || 0;
  const effects = Array.isArray(event.state?.damagePreventionEffects)
    ? event.state.damagePreventionEffects
    : Array.isArray(event.metadata?.damagePreventionEffects)
      ? event.metadata?.damagePreventionEffects
      : [];

  for (const effect of effects) {
    const targetSourceId = String(effect?.targetSourceId || '*').trim() || '*';
    if (targetSourceId !== '*' && targetSourceId !== normalizedSourceId) continue;

    const effectTargetPlayerId = String(effect?.targetPlayerId || '').trim();
    if (effectTargetPlayerId && effectTargetPlayerId !== targetPlayerId) continue;

    const effectTargetPermanentId = String(effect?.targetPermanentId || '').trim();
    if (effectTargetPermanentId && effectTargetPermanentId !== targetPermanentId) continue;

    const expiresAtTurn = Number(effect?.expiresAtTurn);
    if (Number.isFinite(expiresAtTurn) && expiresAtTurn !== currentTurn) continue;

    const requiredColors = Array.isArray(effect?.colors)
      ? effect.colors.map((color: any) => String(color || '').trim().toUpperCase()).filter(Boolean)
      : [];
    if (requiredColors.length > 0 && !requiredColors.some((color: string) => sourceColors.includes(color))) continue;

    const remainingAmount = Number(effect?.remainingAmount);
    const preventedAmount = Number.isFinite(remainingAmount)
      ? Math.min(originalAmount, Math.max(0, remainingAmount))
      : originalAmount;
    if (preventedAmount <= 0) continue;

    return {
      applied: true,
      eventType: event.type,
      effectId: 'damage-prevented-by-effect',
      sourceName: String(effect?.sourceName || effect?.source || '').trim() || undefined,
      originalAmount,
      replacementAmount: Math.max(0, originalAmount - preventedAmount),
      preventedAmount,
      reason: 'damage_prevention_effect',
      metadata: {
        effectId: String(effect?.id || '').trim(),
        targetId: targetPlayerId || targetPermanentId,
      },
    };
  }

  return null;
};

const damageAmountReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'damage') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const explicitReplacementAmount = Number(event.replacementAmount);
  if (Number.isFinite(explicitReplacementAmount) && Math.max(0, explicitReplacementAmount) !== originalAmount) {
    const replacementAmount = Math.max(0, explicitReplacementAmount);
    return {
      applied: true,
      eventType: event.type,
      effectId: replacementAmount === 0 ? 'damage-prevented' : 'damage-amount-modified',
      originalAmount,
      replacementAmount,
      preventedAmount: Math.max(0, originalAmount - replacementAmount),
      reason: 'damage_amount_replacement',
      metadata: { ...(event.metadata || {}) },
    };
  }

  const replacement = replacementEffectModifiedAmount(originalAmount, event.metadata?.replacementEffects);
  if (!replacement || replacement.finalAmount === originalAmount) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: replacement.finalAmount === 0 ? 'damage-prevented' : 'damage-amount-modified',
    originalAmount,
    replacementAmount: replacement.finalAmount,
    preventedAmount: Math.max(0, originalAmount - replacement.finalAmount),
    reason: 'damage_amount_replacement',
    metadata: {
      appliedEffects: replacement.appliedEffects,
    },
  };
};

const lifeGainPreventionEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'life-gain') return null;

  const originalAmount = Math.max(0, Number(event.amount || 0));
  if (originalAmount <= 0) return null;

  const battlefield = Array.isArray(event.state?.battlefield) ? event.state.battlefield : [];

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;

    const cardName = normalizeReplacementText(permanent.card.name || '');
    const controller = String(permanent.controller || '');
    const isOpponent = controller !== String(event.playerId || '');

    const prevention = LIFE_GAIN_PREVENTION_CARDS[cardName];
    if (prevention?.isStatic && (prevention.affectsAll || (prevention.affectsOpponents && isOpponent))) {
      return {
        applied: true,
        eventType: event.type,
        effectId: 'life-gain-prevented',
        sourceName: String(permanent.card.name || '').trim() || undefined,
        originalAmount,
        replacementAmount: 0,
        preventedAmount: originalAmount,
        reason: 'life_gain_prevented',
        metadata: {
          playerId: String(event.playerId || ''),
        },
      };
    }

    const reversal = LIFE_GAIN_REVERSAL_CARDS[cardName];
    if (reversal?.isStatic && (reversal.affectsAll || (reversal.affectsOpponents && isOpponent))) {
      return {
        applied: true,
        eventType: event.type,
        effectId: 'life-gain-reversed-to-loss',
        sourceName: String(permanent.card.name || '').trim() || undefined,
        originalAmount,
        replacementAmount: -originalAmount,
        preventedAmount: 0,
        reason: 'life_gain_reversed_to_loss',
        metadata: {
          playerId: String(event.playerId || ''),
          reversedToLoss: true,
        },
      };
    }
  }

  const lastingEffects = Array.isArray(event.state?.lastingEffects) ? event.state.lastingEffects : [];
  for (const effect of lastingEffects) {
    if (effect?.type === 'preventLifeGain' && String(effect?.targetPlayer || '') === String(event.playerId || '')) {
      return {
        applied: true,
        eventType: event.type,
        effectId: 'life-gain-prevented',
        sourceName: String(effect?.source || '').trim() || undefined,
        originalAmount,
        replacementAmount: 0,
        preventedAmount: originalAmount,
        reason: 'lasting_life_gain_prevention',
        metadata: {
          playerId: String(event.playerId || ''),
        },
      };
    }
  }

  return null;
};

const librarySearchReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'library-search') return null;

  const state = event.state || event.game?.state || {};
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const triggerEffects: { cardName: string; effect: string; controllerId: string }[] = [];
  let canSearch = true;
  let limitToTop: number | undefined;
  let controlledBy: string | undefined;
  let reason: string | undefined;
  let paymentRequired: { cardName: string; amount: string } | undefined;

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;

    const cardName = normalizeReplacementText(permanent.card.name || '');
    const controllerId = String(permanent.controller || '');
    const isOpponent = controllerId !== String(event.searchingPlayerId || '');

    for (const [name, info] of Object.entries(SEARCH_PREVENTION_CARDS)) {
      if (!cardName.includes(name)) continue;
      const applies = (isOpponent && info.affectsOpponents) || (!isOpponent && info.affectsSelf);
      if (!applies) continue;

      if (name === 'leonin arbiter') {
        paymentRequired = { cardName: permanent.card.name, amount: '{2}' };
      } else {
        canSearch = false;
        reason = `${permanent.card.name} prevents library searching`;
      }
    }

    for (const [name, info] of Object.entries(SEARCH_LIMIT_CARDS)) {
      if (cardName.includes(name) && isOpponent && info.affectsOpponents) {
        if (limitToTop === undefined || info.limit < limitToTop) {
          limitToTop = info.limit;
        }
      }
    }

    for (const [name, info] of Object.entries(SEARCH_TRIGGER_CARDS)) {
      if (cardName.includes(name) && isOpponent && info.affectsOpponents) {
        triggerEffects.push({
          cardName: permanent.card.name,
          effect: info.effect,
          controllerId,
        });
      }
    }

    if (SEARCH_CONTROL_CARDS.has(cardName) && isOpponent) {
      controlledBy = controllerId;
    }
  }

  const metadata = {
    canSearch,
    ...(limitToTop !== undefined ? { limitToTop } : {}),
    triggerEffects,
    ...(controlledBy ? { controlledBy } : {}),
    ...(reason ? { reason } : {}),
    ...(paymentRequired ? { paymentRequired } : {}),
  };

  if (!canSearch || limitToTop !== undefined || triggerEffects.length > 0 || controlledBy || paymentRequired) {
    return {
      applied: true,
      eventType: event.type,
      effectId: !canSearch
        ? 'library-search-prevented'
        : limitToTop !== undefined
          ? 'library-search-limited'
          : controlledBy
            ? 'library-search-controlled'
            : paymentRequired
              ? 'library-search-payment-required'
              : 'library-search-triggered',
      reason: reason || 'library_search_restriction',
      metadata,
    };
  }

  return null;
};

const tokenCreationReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'token-creation') return null;

  const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
  if (originalAmount <= 0) return null;

  const battlefield = Array.isArray(event.state?.battlefield) ? event.state.battlefield : [];
  let multiplier = 1;
  const sources: string[] = [];

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;

    const cardName = normalizeReplacementText(permanent.card.name || '');
    const oracleText = normalizeReplacementText(permanent.card.oracle_text || '');
    const controller = String(permanent.controller || '');

    if (cardName.includes('primal vigor')) {
      multiplier *= 2;
      sources.push(permanent.card.name || 'Primal Vigor');
      continue;
    }

    if (controller !== String(event.controllerId || '')) continue;

    if (cardName.includes('ojer taq') || (oracleText.includes('three times that many') && oracleText.includes('token'))) {
      multiplier *= 3;
      sources.push(permanent.card.name || 'Ojer Taq');
    }

    if (cardName.includes('anointed procession')
      || cardName.includes('parallel lives')
      || cardName.includes('doubling season')
      || cardName.includes('mondrak, glory dominus')
      || (cardName.includes('elspeth') && oracleText.includes('twice that many'))
      || (oracleText.includes('twice that many') && oracleText.includes('token'))) {
      multiplier *= 2;
      sources.push(permanent.card.name || 'Token doubler');
    }
  }

  if (multiplier <= 1) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'token-creation-multiplied',
    originalAmount,
    replacementAmount: originalAmount * multiplier,
    reason: 'token_creation_replacement',
    metadata: {
      controllerId: String(event.controllerId || ''),
      multiplier,
      sources,
      ...(event.tokenName ? { tokenName: event.tokenName } : {}),
    },
  };
};

const counterPlacementReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'counter-placement') return null;

  const originalDeltas = normalizeDeltas(event.deltas);
  const modifiedDeltas = normalizeDeltas(event.modifiedDeltas || event.deltas);
  if (!deltasDiffer(originalDeltas, modifiedDeltas)) return null;

  return {
    applied: true,
    eventType: event.type,
    effectId: 'counter-placement-modified',
    originalAmount: sumPositiveDeltas(originalDeltas),
    replacementAmount: sumPositiveDeltas(modifiedDeltas),
    reason: 'counter_placement_replacement',
    metadata: {
      targetPermanentId: String(event.targetPermanentId || ''),
      ...(event.controllerId ? { controllerId: String(event.controllerId) } : {}),
      originalDeltas,
      modifiedDeltas,
    },
  };
};

const cardDrawReplacementEvaluator: ReplacementEffectEvaluator = (event) => {
  if (event.type !== 'card-draw') return null;

  const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
  if (originalAmount <= 0) return null;

  const dredgeOptions = getDredgeOptions(event);
  if (dredgeOptions.length > 0) {
    return {
      applied: false,
      choiceRequired: true,
      eventType: event.type,
      effectId: 'dredge-draw-replacement-choice',
      originalAmount,
      replacementAmount: 0,
      reason: 'dredge_replacement_choice',
      metadata: {
        playerId: String(event.playerId || ''),
        dredgeOptions,
      },
    };
  }

  const isFirstDrawStepDraw = event.metadata?.isFirstDrawStepDraw === true;
  const battlefield = getEventStateBattlefield(event);
  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    if (String(permanent.controller || '') === String(event.playerId || '')) continue;

    const cardName = normalizeReplacementText(permanent.card.name || '');
    const oracle = getCardOracleText(permanent.card);
    if (cardName.includes('notion thief') || (oracle.includes('if an opponent would draw a card') && oracle.includes('instead you draw a card'))) {
      if (isFirstDrawStepDraw) continue;
      return {
        applied: true,
        eventType: event.type,
        effectId: 'draw-replaced-by-opponent',
        sourceName: getCardName(permanent.card) || undefined,
        originalAmount,
        replacementAmount: 0,
        reason: 'draw_replaced_by_opponent',
        metadata: {
          playerId: String(event.playerId || ''),
          replacementPlayerId: String(permanent.controller || ''),
        },
      };
    }

    if (originalAmount >= 2 && (cardName.includes('alms collector') || (oracle.includes('opponent would draw two or more cards') && oracle.includes('instead you and that player each draw a card')))) {
      return {
        applied: true,
        eventType: event.type,
        effectId: 'draw-replaced-by-shared-draw',
        sourceName: getCardName(permanent.card) || undefined,
        originalAmount,
        replacementAmount: 1,
        reason: 'draw_replaced_by_shared_draw',
        metadata: {
          playerId: String(event.playerId || ''),
          additionalDraws: [{ playerId: String(permanent.controller || ''), count: 1 }],
        },
      };
    }
  }

  return null;
};

const replacementEffectEvaluators: ReplacementEffectEvaluator[] = [
  leaveBattlefieldExileEvaluator,
  tokenLeaveBattlefieldEvaluator,
  stackGraveyardExileEvaluator,
  commanderZoneChoiceEvaluator,
  battlefieldEntryReplacementEvaluator,
  damagePreventionDisallowedEvaluator,
  shieldCounterDamagePreventionEvaluator,
  damagePreventionEffectEvaluator,
  damageAmountReplacementEvaluator,
  lifeGainPreventionEvaluator,
  librarySearchReplacementEvaluator,
  tokenCreationReplacementEvaluator,
  counterPlacementReplacementEvaluator,
  cardDrawReplacementEvaluator,
];

export function evaluateReplacementEvent(event: ReplacementEvent): ReplacementEffectResult {
  for (const evaluator of replacementEffectEvaluators) {
    const result = evaluator(event);
    if (result && (result.applied || result.choiceRequired)) {
      return result;
    }
  }

  if (event.type === 'zone-change') {
    return {
      applied: false,
      eventType: event.type,
      originalDestination: event.destinationZone,
      replacementDestination: event.destinationZone,
    };
  }

  if (event.type === 'library-search') {
    return {
      applied: false,
      eventType: event.type,
      metadata: { canSearch: true, triggerEffects: [] },
    };
  }

  if (event.type === 'battlefield-entry') {
    return {
      applied: false,
      eventType: event.type,
      metadata: {
        controllerId: String(event.controllerId || ''),
        entersTapped: false,
        entryCounters: {},
        entersTransformed: false,
        entersFaceDown: false,
      },
    };
  }

  if (event.type === 'card-draw') {
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    return {
      applied: false,
      eventType: event.type,
      originalAmount,
      replacementAmount: originalAmount,
      metadata: { playerId: String(event.playerId || '') },
    };
  }

  if (event.type === 'token-creation') {
    const originalAmount = Math.max(0, Math.floor(Number(event.count || 0)));
    return {
      applied: false,
      eventType: event.type,
      originalAmount,
      replacementAmount: originalAmount,
      metadata: { controllerId: String(event.controllerId || '') },
    };
  }

  if (event.type === 'counter-placement') {
    const originalDeltas = normalizeDeltas(event.deltas);
    return {
      applied: false,
      eventType: event.type,
      originalAmount: sumPositiveDeltas(originalDeltas),
      replacementAmount: sumPositiveDeltas(originalDeltas),
      metadata: {
        targetPermanentId: String(event.targetPermanentId || ''),
        originalDeltas,
        modifiedDeltas: originalDeltas,
      },
    };
  }

  const originalAmount = Math.max(0, Number(event.amount || 0));

  return {
    applied: false,
    eventType: event.type,
    originalAmount,
    replacementAmount: originalAmount,
    preventedAmount: 0,
  };
}

export function evaluateLeaveBattlefieldDestinationReplacement(
  permanent: any,
  destination: Extract<ReplacementZone, 'graveyard' | 'exile' | 'hand' | 'library'>,
  metadata?: Record<string, unknown>,
): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'zone-change',
    object: permanent,
    objectId: String(permanent?.id || permanent?.card?.id || ''),
    sourceZone: 'battlefield',
    destinationZone: destination,
    controller: permanent?.controller,
    owner: permanent?.owner,
    metadata,
  });
}

export function evaluateStackGraveyardDestinationReplacement(stackItem: any): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'zone-change',
    object: stackItem,
    objectId: String(stackItem?.id || stackItem?.card?.id || ''),
    sourceZone: 'stack',
    destinationZone: 'graveyard',
    controller: stackItem?.controller || stackItem?.playerId,
    owner: stackItem?.owner || stackItem?.card?.owner,
    cause: 'spell_resolution',
  });
}

export function evaluateDamageReplacementEvent(event: Omit<DamageReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'damage',
    ...event,
  });
}

export function evaluateBattlefieldEntryReplacementEvent(event: Omit<BattlefieldEntryReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'battlefield-entry',
    ...event,
  });
}

export function evaluateLifeGainReplacementEvent(event: Omit<LifeGainReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'life-gain',
    ...event,
  });
}

export function evaluateLibrarySearchReplacementEvent(event: Omit<LibrarySearchReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'library-search',
    ...event,
  });
}

export function evaluateTokenCreationReplacementEvent(event: Omit<TokenCreationReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'token-creation',
    ...event,
  });
}

export function evaluateCounterPlacementReplacementEvent(event: Omit<CounterPlacementReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'counter-placement',
    ...event,
  });
}

export function evaluateDrawReplacementEvent(event: Omit<CardDrawReplacementEvent, 'type'>): ReplacementEffectResult {
  return evaluateReplacementEvent({
    type: 'card-draw',
    ...event,
  });
}