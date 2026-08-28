/**
 * Battlefield / player watchers for detectDealtDamageTriggers templates.
 *
 * Self "whenever this is dealt damage" redirects stay in damage-received.ts.
 * Enrage fight and other self non-redirects use processSelfDealtDamageNonRedirectTriggers.
 * This module also covers other permanents watching the damaged object, plus
 * "whenever an opponent / you is dealt damage" from resolvePlayerDamage.
 */
import type { GameContext } from '../../context.js';
import { detectDealtDamageTriggers } from './dealt-damage-detection.js';
import { parseAnyTargetThatIsntCreatureType } from './damage-redirect-target-type.js';
import { permanentHasCreatureTypeNow } from '../../creatureTypeNow.js';
import { isInterveningIfSatisfied } from './intervening-if.js';
import { orderTriggersByAPNAP } from './ordering.js';
import { queueGenericTriggeredAbility } from '../triggerEmissionFamilyUtils.js';
import {
  DelayedTriggerTiming,
  checkDelayedTriggers,
  createDelayedTriggerRegistry,
} from '../../../../../rules-engine/src/delayedTriggeredAbilities.js';

const CARD_TYPE_WORDS = new Set([
  'creature',
  'artifact',
  'enchantment',
  'land',
  'planeswalker',
  'battle',
  'kindred',
  'tribal',
]);

export type DamageReceivedEffectMode = 'gain_life' | 'gain_life_and_attacking_player_loses_life';

export interface InferredDamageReceivedEffect {
  targetType: string;
  targetRestriction: string;
  effect: string;
  effectMode?: DamageReceivedEffectMode;
}

export function inferDamageReceivedEffectFromOracle(oracleText: string): InferredDamageReceivedEffect {
  const text = String(oracleText || '').toLowerCase();
  let targetType = 'any';
  let targetRestriction = '';
  let effectMode: DamageReceivedEffectMode | undefined;

  if (text.includes('you gain that much life and attacking player loses that much life')) {
    targetType = 'none';
    effectMode = 'gain_life_and_attacking_player_loses_life';
  } else if (text.includes('you gain that much life')) {
    targetType = 'none';
    effectMode = 'gain_life';
  }

  if (targetType !== 'none' && text.includes('target opponent or planeswalker')) {
    targetType = 'opponent_or_planeswalker';
    targetRestriction = 'opponent or planeswalker';
  } else if (targetType !== 'none' && text.includes('target opponent')) {
    targetType = 'opponent';
    targetRestriction = 'opponent';
  } else if (targetType !== 'none' && text.includes('each opponent')) {
    targetType = 'each_opponent';
    targetRestriction = 'each opponent';
  } else if (targetType !== 'none') {
    const anyNonType = parseAnyTargetThatIsntCreatureType(text);
    if (anyNonType) {
      targetType = anyNonType.targetType;
      targetRestriction = anyNonType.targetRestriction;
    } else if (text.includes('the chosen player')) {
      targetType = 'chosen_player';
      targetRestriction = 'chosen player';
    } else if (text.includes('target player')) {
      targetType = 'any';
      targetRestriction = 'player';
    }
  }

  let effect = 'Deals that much damage to target';
  if (effectMode === 'gain_life_and_attacking_player_loses_life') {
    effect = 'You gain that much life and attacking player loses that much life';
  } else if (effectMode === 'gain_life') {
    effect = 'You gain that much life';
  } else if (text.includes('deals that much damage to')) {
    const match = text.match(/deals that much damage to ([^.]+)/);
    if (match) {
      effect = `Deals that much damage to ${match[1]}`;
    }
  }

  return { targetType, targetRestriction, effect, effectMode };
}

export function isThatMuchDamageRedirectOracle(oracleText: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  return text.includes('deals that much damage') || text.includes('you gain that much life');
}

export function isSelfDealtDamageClause(oracleText: string, cardName: string): boolean {
  const text = String(oracleText || '').toLowerCase();
  const name = String(cardName || '').toLowerCase();
  if (/whenever this (?:creature|permanent) is dealt (?:combat )?damage/.test(text)) return true;
  if (name && text.includes(`whenever ${name} is dealt damage`)) return true;
  if (name && text.includes(`whenever ${name} is dealt combat damage`)) return true;
  // Donna Noble-style: "~ or a creature it's paired with is dealt damage"
  if (name && new RegExp(`whenever\\s+${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s+or\\s+a\\s+creature\\s+it'?s\\s+paired\\s+with\\s+is\\s+dealt\\s+damage`, 'i').test(text)) {
    return true;
  }
  if (/whenever this creature or a creature it'?s paired with is dealt damage/.test(text)) return true;
  if (/deals damage to this creature/.test(text)) return true;
  return false;
}

function oracleLower(permanent: any): string {
  return String(permanent?.card?.oracle_text || '').toLowerCase();
}

function typeLineLower(permanent: any): string {
  return String(permanent?.card?.type_line || '').toLowerCase();
}

function permanentHasKeywordNow(permanent: any, keyword: string): boolean {
  const needle = String(keyword || '').toLowerCase();
  if (!needle) return false;
  const oracle = oracleLower(permanent);
  if (new RegExp(`\\b${needle}\\b`, 'i').test(oracle)) return true;
  const lists = [permanent?.keywords, permanent?.card?.keywords, permanent?.grantedKeywords];
  for (const list of lists) {
    if (Array.isArray(list) && list.some((entry) => String(entry || '').toLowerCase() === needle)) {
      return true;
    }
  }
  return false;
}

function permanentMatchesTypePhrase(permanent: any, typePhrase: string): boolean {
  const phrase = String(typePhrase || '').trim().toLowerCase();
  if (!phrase) return false;
  if (CARD_TYPE_WORDS.has(phrase)) {
    return typeLineLower(permanent).includes(phrase);
  }
  return permanentHasCreatureTypeNow(permanent, phrase);
}

function isPairedWith(watcher: any, damaged: any): boolean {
  const watcherId = String(watcher?.id || '');
  const damagedId = String(damaged?.id || '');
  if (!watcherId || !damagedId || watcherId === damagedId) return false;
  const watcherPair = String(watcher?.pairedWith || watcher?.pairedTo || watcher?.soulbondPair || '');
  const damagedPair = String(damaged?.pairedWith || damaged?.pairedTo || damaged?.soulbondPair || '');
  return watcherPair === damagedId || damagedPair === watcherId;
}

function isPlayerDamageOnlyClause(clause: string): boolean {
  return (
    /whenever an opponent is dealt (?:combat )?damage/.test(clause)
    || /whenever damage is dealt to you/.test(clause)
    || /deals damage to you/.test(clause)
    || /deals noncombat damage to (?:a creature|an opponent)/.test(clause)
    || /enchanted player is dealt damage/.test(clause)
    || /deathtouch deals damage to (?:a player|an opponent)/.test(clause)
  );
}

function isDelayedThatCreatureClause(clause: string): boolean {
  return /whenever that creature is dealt damage(?: this turn)?/.test(clause)
    && !/paired with/.test(clause);
}

/**
 * Whether a watcher permanent's dealt-damage oracle applies to this damaged permanent.
 * Self-only clauses return false — redirects stay on getDamageReceivedTrigger;
 * Enrage fight and other self non-redirects use processSelfDealtDamageNonRedirectTriggers.
 */
export function dealtDamageWatcherAppliesToPermanent(
  watcher: any,
  damaged: any,
): boolean {
  if (!watcher?.card || !damaged) return false;
  const watcherId = String(watcher.id || '');
  const damagedId = String(damaged.id || '');
  if (!watcherId || !damagedId) return false;

  const clause = oracleLower(watcher);
  if (!clause || isDelayedThatCreatureClause(clause) || isPlayerDamageOnlyClause(clause)) {
    return false;
  }

  const damagedIsCreature = typeLineLower(damaged).includes('creature');
  const damagedIsPlaneswalker = typeLineLower(damaged).includes('planeswalker');
  const watcherController = String(watcher.controller || '');
  const damagedController = String(damaged.controller || '');
  const youControl = Boolean(watcherController && damagedController && watcherController === damagedController);
  const opponentControls = Boolean(watcherController && damagedController && watcherController !== damagedController);

  if (/enchanted creature is dealt/.test(clause) || /equipped creature is dealt/.test(clause)) {
    return String(watcher.attachedTo || '') === damagedId;
  }

  if (/or a creature it'?s paired with is dealt damage/.test(clause)) {
    return isPairedWith(watcher, damaged);
  }

  if (watcherId === damagedId) {
    return false;
  }

  if (/creature or planeswalker an opponent controls with a bounty counter/.test(clause)) {
    const bounty = Number(damaged?.counters?.bounty || damaged?.counters?.Bounty || 0);
    return opponentControls && (damagedIsCreature || damagedIsPlaneswalker) && bounty > 0;
  }
  if (/creature an opponent controls is dealt/.test(clause)) {
    return opponentControls && damagedIsCreature;
  }
  if (/creature you control with (?:flash or haste|haste or flash) is dealt/.test(clause)) {
    return youControl && damagedIsCreature
      && (permanentHasKeywordNow(damaged, 'flash') || permanentHasKeywordNow(damaged, 'haste'));
  }
  if (/creature you control is dealt/.test(clause)) {
    return youControl && damagedIsCreature;
  }

  const typedYouControl = clause.match(/whenever a ([a-z][\w\s/-]*?) you control is dealt/);
  if (typedYouControl) {
    const typePhrase = String(typedYouControl[1] || '').trim();
    if (typePhrase === 'creature') {
      return youControl && damagedIsCreature;
    }
    return youControl && permanentMatchesTypePhrase(damaged, typePhrase);
  }

  if (/whenever (?:a |an )?creature is dealt damage/.test(clause)) {
    return damagedIsCreature;
  }

  return false;
}

/**
 * Queue self "whenever this is dealt damage" abilities that are not
 * that-much-damage / gain-life redirects (Apex Altisaur Enrage fight, etc.).
 */
export function processSelfDealtDamageNonRedirectTriggers(
  ctx: GameContext,
  damagedPermanent: any,
  damageAmount: number,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!damagedPermanent?.card || damageAmount <= 0) return [];

  const oracle = String(damagedPermanent.card?.oracle_text || '');
  if (!oracle || isThatMuchDamageRedirectOracle(oracle)) return [];

  const detected = detectDealtDamageTriggers(damagedPermanent.card, damagedPermanent)
    .filter((trigger) => trigger.triggerType === 'dealt_damage');
  if (detected.length === 0) return [];

  const ordered = orderTriggersByAPNAP(
    ctx,
    detected.map((trigger) => ({
      ...trigger,
      controllerId: String(damagedPermanent.controller || trigger.controllerId || ''),
    })),
  );

  const queued: any[] = [];
  for (const trigger of ordered) {
    if (!evaluateWatcherInterveningIf(ctx, trigger, 'Whenever this creature is dealt damage', damagedPermanent)) {
      continue;
    }
    const item = queueGenericTriggeredAbility(ctx, {
      ...trigger,
      controllerId: String(damagedPermanent.controller || trigger.controllerId || ''),
      permanentId: String(damagedPermanent.id || trigger.permanentId || ''),
      cardName: String(damagedPermanent.card?.name || trigger.cardName || ''),
    }, 'dealt_damage', {
      damagedPermanentId: String(damagedPermanent.id || ''),
      damagedPermanentName: String(damagedPermanent.card?.name || ''),
      damageAmount,
    });
    if (item) queued.push(item);
  }
  return queued;
}

function sourceMatchesTypePhrase(sourcePermanent: any, typePhrase: string): boolean {
  if (!sourcePermanent) return false;
  return permanentMatchesTypePhrase(sourcePermanent, typePhrase);
}

function sourceHasChosenColor(sourcePermanent: any, watcher: any): boolean {
  const chosen = String(
    watcher?.chosenColor
    || watcher?.chosenColorWord
    || watcher?.card?.chosenColor
    || watcher?.card?.chosenColorWord
    || '',
  ).trim().toLowerCase();
  if (!chosen) return false;

  const colorCode: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    w: 'W',
    u: 'U',
    b: 'B',
    r: 'R',
    g: 'G',
  };
  const code = colorCode[chosen] || chosen.toUpperCase();
  const colors = [
    ...(Array.isArray(sourcePermanent?.card?.colors) ? sourcePermanent.card.colors : []),
    ...(Array.isArray(sourcePermanent?.colors) ? sourcePermanent.colors : []),
    ...(Array.isArray(sourcePermanent?.card?.color_identity) ? sourcePermanent.card.color_identity : []),
  ].map((entry) => String(entry || '').toUpperCase());
  return colors.includes(code);
}

export function dealtDamageWatcherAppliesToPlayer(
  watcher: any,
  damagedPlayerId: string,
  options: {
    isCombatDamage?: boolean;
    sourcePermanent?: any;
    sourceControllerId?: string;
  } = {},
): boolean {
  if (!watcher?.card || !damagedPlayerId) return false;
  const clause = oracleLower(watcher);
  if (!clause || isDelayedThatCreatureClause(clause)) return false;

  const watcherController = String(watcher.controller || '');
  const damagedIsYou = watcherController && watcherController === damagedPlayerId;
  const damagedIsOpponent = watcherController && watcherController !== damagedPlayerId;
  const sourceController = String(options.sourceControllerId || options.sourcePermanent?.controller || '');
  const sourceIsCreature = typeLineLower(options.sourcePermanent).includes('creature');
  const sourceYouControl = Boolean(sourceController && watcherController && sourceController === watcherController);
  const sourceOpponentControls = Boolean(sourceController && watcherController && sourceController !== watcherController);

  if (/enchanted player is dealt damage/.test(clause)) {
    const attachedTo = String(watcher.attachedTo || watcher.enchanting || '');
    return attachedTo === damagedPlayerId;
  }

  if (/opponent is dealt combat damage by one or more creatures you control/.test(clause)) {
    return Boolean(options.isCombatDamage) && damagedIsOpponent && sourceYouControl && sourceIsCreature;
  }
  if (/whenever an opponent is dealt damage/.test(clause)) {
    return Boolean(damagedIsOpponent);
  }
  if (/source you control deals noncombat damage to an opponent/.test(clause)) {
    return !options.isCombatDamage && damagedIsOpponent && sourceYouControl;
  }
  if (/source of the chosen color deals damage to you/.test(clause)) {
    return Boolean(damagedIsYou) && sourceHasChosenColor(options.sourcePermanent, watcher);
  }
  if (/source an opponent controls deals damage to you/.test(clause)) {
    return Boolean(damagedIsYou) && sourceOpponentControls;
  }
  if (/whenever a creature deals damage to you/.test(clause)) {
    return Boolean(damagedIsYou) && sourceIsCreature;
  }
  const typedDealsToYou = clause.match(/whenever a ([a-z][\w\s/-]*?) deals damage to you/);
  if (typedDealsToYou) {
    const typePhrase = String(typedDealsToYou[1] || '').trim();
    return Boolean(damagedIsYou) && sourceMatchesTypePhrase(options.sourcePermanent, typePhrase);
  }
  if (/whenever damage is dealt to you/.test(clause)) {
    return Boolean(damagedIsYou);
  }

  return false;
}

function evaluateWatcherInterveningIf(
  ctx: GameContext,
  trigger: any,
  prefix: string,
  sourcePermanent: any,
): boolean {
  const raw = String(trigger.effect || trigger.description || '').trim();
  let textForEval = raw;
  if (textForEval && !/^(?:when|whenever|at)\b/i.test(textForEval)) {
    textForEval = `${prefix}, ${textForEval}`;
  }
  const ok = isInterveningIfSatisfied(
    ctx as any,
    String(trigger.controllerId || sourcePermanent?.controller || ''),
    textForEval,
    sourcePermanent,
  );
  return ok !== false;
}

export interface ThatMuchDamageWatcherHit {
  watcher: any;
  effect: string;
  inferred: InferredDamageReceivedEffect;
}

/**
 * Scan the battlefield for permanents watching this damaged permanent.
 * That-much redirects are returned for the existing DamageTriggerInfo path;
 * other effects are queued as generic triggered abilities.
 */
export function processPermanentDealtDamageWatchers(
  ctx: GameContext,
  damagedPermanent: any,
  damageAmount: number,
  onThatMuch?: (hit: ThatMuchDamageWatcherHit) => void,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!damagedPermanent || damageAmount <= 0) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];
  const candidates = [...battlefield];
  const seen = new Set<string>();

  const hits: Array<{ watcher: any; trigger: any }> = [];
  for (const permanent of candidates) {
    if (!permanent?.card) continue;
    const key = `${String(permanent.id || '')}:${String(permanent.card?.name || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!dealtDamageWatcherAppliesToPermanent(permanent, damagedPermanent)) continue;

    const detected = detectDealtDamageTriggers(permanent.card, permanent)
      .filter((trigger) => trigger.triggerType === 'dealt_damage');
    for (const trigger of detected) {
      hits.push({ watcher: permanent, trigger });
    }
  }

  const ordered = orderTriggersByAPNAP(
    ctx,
    hits.map(({ watcher, trigger }) => ({
      ...trigger,
      controllerId: String(watcher.controller || trigger.controllerId || ''),
      _watcher: watcher,
    })),
  );

  for (const trigger of ordered) {
    const watcher = (trigger as any)._watcher;
    if (!evaluateWatcherInterveningIf(ctx, trigger, 'Whenever a creature is dealt damage', watcher)) {
      continue;
    }
    const oracle = String(watcher?.card?.oracle_text || '');
    const effect = String(trigger.effect || trigger.description || '').trim();
    if (isThatMuchDamageRedirectOracle(oracle) && onThatMuch) {
      onThatMuch({
        watcher,
        effect,
        inferred: inferDamageReceivedEffectFromOracle(oracle),
      });
      continue;
    }
    const item = queueGenericTriggeredAbility(ctx, {
      ...trigger,
      controllerId: String(watcher.controller || trigger.controllerId || ''),
      permanentId: String(watcher.id || trigger.permanentId || ''),
      cardName: String(watcher.card?.name || trigger.cardName || ''),
    }, 'dealt_damage', {
      damagedPermanentId: String(damagedPermanent.id || ''),
      damagedPermanentName: String(damagedPermanent.card?.name || ''),
      damageAmount,
    });
    if (item) queued.push(item);
  }

  return queued;
}

export function processPlayerDealtDamageTriggers(
  ctx: GameContext,
  options: {
    damagedPlayerId: string;
    damageAmount: number;
    isCombatDamage?: boolean;
    sourcePermanent?: any;
    sourceControllerId?: string;
  },
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  const damagedPlayerId = String(options.damagedPlayerId || '').trim();
  const damageAmount = Number(options.damageAmount || 0);
  if (!damagedPlayerId || damageAmount <= 0) return [];

  const state = (ctx as any).state;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const queued: any[] = [];
  const hits: Array<{ watcher: any; trigger: any }> = [];

  for (const permanent of battlefield) {
    if (!permanent?.card) continue;
    if (!dealtDamageWatcherAppliesToPlayer(permanent, damagedPlayerId, options)) continue;
    const detected = detectDealtDamageTriggers(permanent.card, permanent)
      .filter((trigger) => trigger.triggerType === 'dealt_damage');
    for (const trigger of detected) {
      hits.push({ watcher: permanent, trigger });
    }
  }

  const ordered = orderTriggersByAPNAP(
    ctx,
    hits.map(({ watcher, trigger }) => ({
      ...trigger,
      controllerId: String(watcher.controller || trigger.controllerId || ''),
      _watcher: watcher,
    })),
  );

  for (const trigger of ordered) {
    const watcher = (trigger as any)._watcher;
    if (!evaluateWatcherInterveningIf(ctx, trigger, 'Whenever a player is dealt damage', watcher)) {
      continue;
    }
    const item = queueGenericTriggeredAbility(ctx, {
      ...trigger,
      controllerId: String(watcher.controller || trigger.controllerId || ''),
      permanentId: String(watcher.id || trigger.permanentId || ''),
      cardName: String(watcher.card?.name || trigger.cardName || ''),
    }, 'dealt_damage', {
      damagedPlayerId,
      damageAmount,
      isCombatDamage: options.isCombatDamage === true,
      sourcePermanentId: String(options.sourcePermanent?.id || ''),
    });
    if (item) queued.push(item);
  }

  return queued;
}

/**
 * Fire repeating delayed "whenever that creature is dealt damage this turn" watchers
 * (Arcbond-style). These live on state.delayedTriggerRegistry, not battlefield oracle.
 */
export function processDelayedDealtDamageWatchers(
  ctx: GameContext,
  damagedPermanent: any,
  damageAmount: number,
): any[] {
  if ((ctx as any)?.isReplaying) return [];
  if (!damagedPermanent || damageAmount <= 0) return [];

  const state = (ctx as any).state;
  if (!state) return [];

  const permanentId = String(damagedPermanent.id || '').trim();
  if (!permanentId) return [];

  const registry = (state.delayedTriggerRegistry || createDelayedTriggerRegistry()) as ReturnType<
    typeof createDelayedTriggerRegistry
  >;
  const watched = registry.triggers.filter(
    (trigger) =>
      trigger.timing === DelayedTriggerTiming.WHEN_DEALT_DAMAGE
      && String(trigger.watchingPermanentId || '').trim() === permanentId,
  );
  if (watched.length === 0) return [];

  const delayedCheck = checkDelayedTriggers(registry, {
    type: 'dealt_damage',
    permanentId,
    playerId: String(damagedPermanent.controller || '') || undefined,
  });

  state.delayedTriggerRegistry = {
    ...registry,
    triggers: delayedCheck.remainingTriggers,
    firedTriggerIds: [
      ...registry.firedTriggerIds,
      ...delayedCheck.triggersToFire.map((trigger) => trigger.id),
    ],
  };

  const queued: any[] = [];
  for (const delayed of delayedCheck.triggersToFire) {
    const effect = String(delayed.effect || '').trim();
    if (!effect) continue;
    const item = queueGenericTriggeredAbility(
      ctx,
      {
        permanentId,
        controllerId: delayed.controllerId,
        cardName: delayed.sourceName,
        effect,
        description: effect,
        mandatory: true,
      },
      'dealt_damage',
      {
        damagedPermanentId: permanentId,
        damagedPermanentName: String(damagedPermanent.card?.name || ''),
        damageAmount,
        delayedTriggerId: delayed.id,
        delayedSourceId: delayed.sourceId,
      },
    );
    if (item) {
      item.source = permanentId;
      item.damageAmount = damageAmount;
      item.referenceAmount = damageAmount;
      queued.push(item);
    }
  }

  return queued;
}

/**
 * Drop this-turn repeating dealt-damage delayed watchers during cleanup.
 */
export function expireDelayedDealtDamageWatchers(state: any): number {
  if (!state) return 0;
  const registry = state.delayedTriggerRegistry as ReturnType<typeof createDelayedTriggerRegistry> | undefined;
  if (!registry || !Array.isArray(registry.triggers) || registry.triggers.length === 0) return 0;

  const delayedCheck = checkDelayedTriggers(registry, { type: 'cleanup' });
  const before = registry.triggers.length;
  state.delayedTriggerRegistry = {
    ...registry,
    triggers: delayedCheck.remainingTriggers,
  };
  return Math.max(0, before - delayedCheck.remainingTriggers.length);
}
