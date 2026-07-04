import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { getTokenImageUrls } from '../../services/tokens.js';
import { uid } from '../utils.js';
import { parseCreateTokenDescriptor } from '../planeswalker/templates/utils.js';
import { createToken, createCopyTokensOfCard, getTokenDoublerMultiplier } from './counters_tokens.js';
import {
  createCommonArtifactTokenFromText,
  isPredefinedTriggerArtifactTokenKind,
} from './oracleIrSpellLegacyArtifactTokenUtils.js';
import { applyMyriadTokenCopies } from './triggerMyriadTokenUtils.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { resolveTriggeredAbilityTargetPlayerId } from './triggerSourceUtils.js';
import { maybeApplyPreparedStateChange } from './triggerPreparedStateUtils.js';
import { skipRetiredTriggerLegacyHandler } from './oracleIrTriggerLegacyRouting.js';
import {
  queueSelfETBTriggersForPermanent,
  triggerETBEffectsForToken,
} from './triggerEtbEntryEffects.js';

export interface TriggerLegacyTokenParams {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly description: string;
  readonly triggerItem: any;
  readonly state: any;
}

const TOKEN_COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function parseTokenCountFromText(text: string): number {
  const countWord = text.match(/create (a|an|one|two|three|four|five|\d+)/i)?.[1]?.toLowerCase() || 'a';
  return TOKEN_COUNT_WORDS[countWord] || parseInt(countWord, 10) || 1;
}

const COMBAT_COLOR_MAP: Record<string, string> = {
  white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: '',
};

function parseCombatTokenParts(
  desc: string,
  tokenDescription: string,
  extraStopWords: string[] = [],
): { colors: string[]; creatureTypes: string[]; abilities: string[] } {
  const parts = tokenDescription.split(/\s+/);
  const colors: string[] = [];
  const creatureTypes: string[] = [];
  const stopWords = new Set([
    'creature', 'token', 'and', 'with', 'that', 'are', 'tapped', 'attacking', 'blocking',
    'that\'s', 'is', ...extraStopWords,
  ]);

  for (const part of parts) {
    const lowerPart = part.toLowerCase();
    if (COMBAT_COLOR_MAP[lowerPart] !== undefined) {
      if (COMBAT_COLOR_MAP[lowerPart]) colors.push(COMBAT_COLOR_MAP[lowerPart]);
    } else if (!stopWords.has(lowerPart)) {
      creatureTypes.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    }
  }

  const abilities: string[] = [];
  if (desc.includes('vigilance')) abilities.push('Vigilance');
  if (desc.includes('haste')) abilities.push('Haste');
  if (desc.includes('lifelink')) abilities.push('Lifelink');
  if (desc.includes('deathtouch')) abilities.push('Deathtouch');
  if (desc.includes('flying')) abilities.push('Flying');
  if (desc.includes('first strike')) abilities.push('First strike');
  if (desc.includes('trample')) abilities.push('Trample');
  if (desc.includes('menace')) abilities.push('Menace');
  if (desc.includes('reach')) abilities.push('Reach');

  return { colors, creatureTypes, abilities };
}

export function applyRetiredTriggerLegacyAttackTriggerCreateCreatureToken(
  params: TriggerLegacyTokenParams,
): boolean {
  const triggerType = (params.triggerItem as any)?.triggerType;
  if (triggerType !== 'attacks' && triggerType !== 'creature_attacks') {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const createTokenMatch = params.desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
  debug(2, `[executeTriggerEffect] ATTACK TRIGGER: createTokenMatch=${!!createTokenMatch}`);
  if (!createTokenMatch) {
    return false;
  }

  const tokenCount = parseTokenCountFromText(params.desc);
  const power = parseInt(createTokenMatch[2], 10);
  const toughness = parseInt(createTokenMatch[3], 10);
  const tokenDescription = createTokenMatch[4].trim();
  const tokensToCreate = tokenCount * getTokenDoublerMultiplier(params.controller, params.state);
  debug(2, `[executeTriggerEffect] Creating ${tokensToCreate} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(params.controller, params.state)})`);

  const entersAttacking = params.desc.includes('attacking') || params.desc.includes('that\'s attacking') || params.desc.includes('that is attacking');
  const shouldBeTapped = params.desc.includes('tapped and attacking') && !params.desc.includes('vigilance');
  const { colors, creatureTypes, abilities } = parseCombatTokenParts(params.desc, tokenDescription);

  const sourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const battlefield = params.state.battlefield || [];
  const attackingCreature = battlefield.find((p: any) => p?.id === sourceId);

  let attackTarget: string | undefined;
  if (entersAttacking && attackingCreature?.attacking) {
    attackTarget = attackingCreature.attacking;
    debug(2, `[executeTriggerEffect] Attack trigger tokens will attack ${attackTarget}`);
  }

  for (let i = 0; i < tokensToCreate; i++) {
    const tokenId = uid('token');
    const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
    const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;

    let tokenImageUrls: any;
    try {
      tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
    } catch (e) {
      debugWarn(1, '[executeTriggerEffect] getTokenImageUrls failed (continuing without image):', {
        tokenName, power, toughness, colors,
      }, e);
      tokenImageUrls = undefined;
    }

    const token = {
      id: tokenId,
      controller: params.controller,
      owner: params.controller,
      tapped: shouldBeTapped,
      counters: {},
      basePower: power,
      baseToughness: toughness,
      summoningSickness: !entersAttacking && !abilities.includes('Haste'),
      isToken: true,
      ...(attackTarget ? { attacking: attackTarget } : {}),
      card: {
        id: tokenId,
        name: tokenName,
        type_line: typeLine,
        power: String(power),
        toughness: String(toughness),
        colors,
        oracle_text: abilities.join(', '),
        keywords: abilities,
        zone: 'battlefield',
        image_uris: tokenImageUrls,
      },
    } as any;

    battlefield.push(token);
    debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${params.controller}${entersAttacking ? ` (attacking${shouldBeTapped ? ', tapped' : ''})` : ''}`);
    triggerETBEffectsForToken(params.ctx, token, params.controller);
  }

  return true;
}

export function applyRetiredTriggerLegacyBlockTriggerCreateCreatureToken(
  params: TriggerLegacyTokenParams,
): boolean {
  const triggerType = (params.triggerItem as any)?.triggerType;
  if (triggerType !== 'blocks') {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const triggerValue = (params.triggerItem as any).value || {};
  const createTokens = triggerValue.createTokens;
  const blockedCreatureId = triggerValue.blockedCreatureId;

  if (createTokens) {
    const { count, power, toughness, type, color, abilities } = createTokens;
    const sourceId = params.triggerItem.source || params.triggerItem.permanentId;
    const battlefield = params.state.battlefield || [];
    const blockingCreature = battlefield.find((p: any) => p?.id === sourceId);

    let blockingTarget: string | undefined;
    if (blockingCreature?.blocking && Array.isArray(blockingCreature.blocking)) {
      blockingTarget = blockingCreature.blocking[0];
    } else if (blockedCreatureId) {
      blockingTarget = blockedCreatureId;
    }

    const colors: string[] = color === 'white' ? ['W'] : color === 'red' ? ['R']
      : color === 'blue' ? ['U'] : color === 'black' ? ['B']
        : color === 'green' ? ['G'] : [];

    for (let i = 0; i < count; i++) {
      const tokenId = uid('token');
      const tokenName = type;
      const typeLine = `Token Creature — ${type}`;

      let tokenImageUrls: any;
      try {
        tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
      } catch (e) {
        debugWarn(1, '[executeTriggerEffect] getTokenImageUrls failed (continuing without image):', {
          tokenName, power, toughness, colors,
        }, e);
        tokenImageUrls = undefined;
      }

      const token = {
        id: tokenId,
        controller: params.controller,
        owner: params.controller,
        tapped: false,
        counters: {},
        basePower: power,
        baseToughness: toughness,
        summoningSickness: false,
        isToken: true,
        ...(blockingTarget ? { blocking: [blockingTarget] } : {}),
        card: {
          id: tokenId,
          name: tokenName,
          type_line: typeLine,
          power: String(power),
          toughness: String(toughness),
          colors,
          oracle_text: (abilities || []).join(', '),
          keywords: abilities || [],
          zone: 'battlefield',
          image_uris: tokenImageUrls,
        },
      } as any;

      if (blockingTarget) {
        const attackingCreature = battlefield.find((p: any) => p?.id === blockingTarget);
        if (attackingCreature) {
          attackingCreature.blockedBy = attackingCreature.blockedBy || [];
          attackingCreature.blockedBy.push(tokenId);
        }
      }

      battlefield.push(token);
      debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} token for ${params.controller} (blocking${blockingTarget ? ` ${blockingTarget}` : ''})`);
      triggerETBEffectsForToken(params.ctx, token, params.controller);
    }

    return true;
  }

  const createTokenMatch = params.desc.match(/create (?:a|an|one|two|three|four|five|(\d+)) (\d+)\/(\d+) ([^\.]+?)(?:\s+creature)?\s+tokens?/i);
  if (!createTokenMatch) {
    return false;
  }

  const tokenCount = parseTokenCountFromText(params.desc);
  const power = parseInt(createTokenMatch[2], 10);
  const toughness = parseInt(createTokenMatch[3], 10);
  const tokenDescription = createTokenMatch[4].trim();
  const tokensToCreate = tokenCount * getTokenDoublerMultiplier(params.controller, params.state);
  debug(2, `[executeTriggerEffect] Block trigger creating ${tokensToCreate} tokens (base: ${tokenCount}, multiplier: ${getTokenDoublerMultiplier(params.controller, params.state)})`);

  const entersBlocking = params.desc.includes('blocking that creature') || params.desc.includes('that\'s blocking');
  const { colors, creatureTypes, abilities } = parseCombatTokenParts(params.desc, tokenDescription, ['blocking']);

  const sourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const battlefield = params.state.battlefield || [];
  const blockingCreature = battlefield.find((p: any) => p?.id === sourceId);

  let blockingTarget: string | undefined;
  if (entersBlocking && blockingCreature?.blocking && Array.isArray(blockingCreature.blocking)) {
    blockingTarget = blockingCreature.blocking[0];
  }

  for (let i = 0; i < tokensToCreate; i++) {
    const tokenId = uid('token');
    const tokenName = creatureTypes.length > 0 ? creatureTypes.join(' ') : 'Token';
    const typeLine = `Token Creature — ${creatureTypes.join(' ')}`;

    let tokenImageUrls: any;
    try {
      tokenImageUrls = getTokenImageUrls(tokenName, power, toughness, colors);
    } catch (e) {
      debugWarn(1, '[executeTriggerEffect] getTokenImageUrls failed (continuing without image):', {
        tokenName, power, toughness, colors,
      }, e);
      tokenImageUrls = undefined;
    }

    const token = {
      id: tokenId,
      controller: params.controller,
      owner: params.controller,
      tapped: false,
      counters: {},
      basePower: power,
      baseToughness: toughness,
      summoningSickness: false,
      isToken: true,
      ...(blockingTarget ? { blocking: [blockingTarget] } : {}),
      card: {
        id: tokenId,
        name: tokenName,
        type_line: typeLine,
        power: String(power),
        toughness: String(toughness),
        colors,
        oracle_text: abilities.join(', '),
        keywords: abilities,
        zone: 'battlefield',
        image_uris: tokenImageUrls,
      },
    } as any;

    if (blockingTarget) {
      const attackingCreature = battlefield.find((p: any) => p?.id === blockingTarget);
      if (attackingCreature) {
        attackingCreature.blockedBy = attackingCreature.blockedBy || [];
        attackingCreature.blockedBy.push(tokenId);
      }
    }

    battlefield.push(token);
    debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${tokenName} block token for ${params.controller}`);
    triggerETBEffectsForToken(params.ctx, token, params.controller);
  }

  return true;
}

export function createEquippedCreatureCopyTokenFromEquipment(
  ctx: GameContext,
  controller: PlayerID,
  equipmentPermanentId: string,
  triggerDescription: string,
  grantsHasteFromStep = false,
): number {
  const state = (ctx as any).state;
  if (!state) return 0;

  const sourcePerm = (state.battlefield || []).find((p: any) => p?.id === equipmentPermanentId);
  if (!sourcePerm) {
    debug(2, `[executeTriggerEffect] Equipment source not found on battlefield - trigger fizzles`);
    return 0;
  }

  const attachedTo = sourcePerm.attachedTo;
  if (!attachedTo) {
    debug(2, `[executeTriggerEffect] Equipment ${sourcePerm.card?.name || 'equipment'} is not attached to anything - trigger fizzles`);
    return 0;
  }

  const equippedCreature = (state.battlefield || []).find((p: any) => p?.id === attachedTo);
  if (!equippedCreature?.card) {
    debug(2, `[executeTriggerEffect] No equipped creature found for copy token creation - trigger fizzles`);
    return 0;
  }

  const desc = String(triggerDescription || '').toLowerCase();
  const tokenId = uid('token');
  const originalCard = equippedCreature.card;
  const originalTypeLine = (originalCard.type_line || '').toLowerCase();

  let tokenTypeLine = originalCard.type_line || 'Token';
  tokenTypeLine = tokenTypeLine.replace(/\bLegendary\s+/i, '').replace(/\s+Legendary\b/i, '').trim();

  const originalHasHaste = (originalCard.oracle_text || '').toLowerCase().includes('haste') ||
    (Array.isArray(originalCard.keywords) &&
      originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste'));
  const triggerGrantsHaste = grantsHasteFromStep || /(?:gains|has|with)\s+haste/i.test(desc);
  const hasHaste = originalHasHaste || triggerGrantsHaste;
  const isCreature = originalTypeLine.includes('creature');

  const tokenCopy = {
    id: tokenId,
    controller,
    owner: controller,
    tapped: false,
    counters: { ...equippedCreature.counters },
    basePower: equippedCreature.basePower,
    baseToughness: equippedCreature.baseToughness,
    summoningSickness: isCreature && !hasHaste,
    isToken: true,
    card: {
      ...originalCard,
      id: tokenId,
      type_line: tokenTypeLine,
      zone: 'battlefield',
      oracle_text: triggerGrantsHaste && !originalHasHaste
        ? (originalCard.oracle_text || '') + (originalCard.oracle_text ? '\n' : '') + 'Haste'
        : originalCard.oracle_text,
      keywords: triggerGrantsHaste && Array.isArray(originalCard.keywords) && !originalCard.keywords.some((k: string) => k.toLowerCase() === 'haste')
        ? [...originalCard.keywords, 'Haste']
        : originalCard.keywords,
    },
  } as any;

  state.battlefield = state.battlefield || [];
  state.battlefield.push(tokenCopy);

  debug(2, `[executeTriggerEffect] Created token copy of ${originalCard.name || 'creature'} (not legendary${hasHaste ? ', with haste' : ''})`);
  queueSelfETBTriggersForPermanent(ctx, tokenCopy, controller as any);
  triggerETBEffectsForToken(ctx, tokenCopy, controller);
  return 1;
}

const IRREGULAR_PLURALS: Record<string, string> = {
  elves: 'elf',
  wolves: 'wolf',
  dwarves: 'dwarf',
  halves: 'half',
  leaves: 'leaf',
  knives: 'knife',
  lives: 'life',
  selves: 'self',
  calves: 'calf',
};

function colorsFromNamedColor(color: string | undefined): string[] {
  if (color === 'colorless') return [];
  if (color === 'white') return ['W'];
  if (color === 'red') return ['R'];
  if (color === 'blue') return ['U'];
  if (color === 'black') return ['B'];
  if (color === 'green') return ['G'];
  return [];
}

function normalizeCountType(countType: string): string {
  const lower = countType.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) return IRREGULAR_PLURALS[lower];
  if (lower.endsWith('s') && lower.length > 1) return lower.slice(0, -1);
  return lower;
}

function countControlledPermanentsOfType(
  battlefield: any[],
  controller: PlayerID,
  countType: string,
): number {
  const normalized = normalizeCountType(countType);
  return battlefield.filter((perm) => {
    if (!perm || perm.controller !== controller) return false;
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    return typeLine.includes(normalized);
  }).length;
}

function pushCountBasedCreatureToken(
  params: TriggerLegacyTokenParams,
  options: {
    power: number;
    toughness: number;
    tokenName: string;
    typeLine: string;
    colors: string[];
    summoningSickness?: boolean;
  },
): void {
  const tokenId = uid('token');
  let tokenImageUrls: any;
  try {
    tokenImageUrls = getTokenImageUrls(
      options.tokenName,
      options.power,
      options.toughness,
      options.colors.length > 0 ? options.colors : undefined,
    );
  } catch (e) {
    debugWarn(1, '[executeTriggerEffect] getTokenImageUrls failed (continuing without image):', {
      tokenName: options.tokenName,
      power: options.power,
      toughness: options.toughness,
      colors: options.colors,
    }, e);
    tokenImageUrls = undefined;
  }

  const token = {
    id: tokenId,
    controller: params.controller,
    owner: params.controller,
    tapped: false,
    counters: {},
    basePower: options.power,
    baseToughness: options.toughness,
    summoningSickness: options.summoningSickness !== false,
    isToken: true,
    card: {
      id: tokenId,
      name: options.tokenName,
      type_line: options.typeLine,
      power: String(options.power),
      toughness: String(options.toughness),
      colors: options.colors,
      oracle_text: '',
      keywords: [],
      zone: 'battlefield',
      image_uris: tokenImageUrls,
    },
  } as any;

  params.state.battlefield = params.state.battlefield || [];
  params.state.battlefield.push(token);
  triggerETBEffectsForToken(params.ctx, token, params.controller);
}

export function applyRetiredTriggerLegacyAttackCountBasedCreateCreatureToken(
  params: TriggerLegacyTokenParams,
): boolean {
  const triggerType = (params.triggerItem as any)?.triggerType;
  if (triggerType !== 'attacks' && triggerType !== 'creature_attacks') {
    return false;
  }

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const triggerValue = (params.triggerItem as any).value || (params.triggerItem as any).effectData;
  debug(2, `[executeTriggerEffect] COUNT-BASED CHECK: value=${JSON.stringify((params.triggerItem as any).value)}, effectData=${JSON.stringify((params.triggerItem as any).effectData)}, triggerValue.countType=${triggerValue?.countType}`);
  if (!triggerValue || typeof triggerValue !== 'object' || !triggerValue.countType) {
    return false;
  }

  const { countType, power, toughness, type, color, isArtifact } = triggerValue;
  const battlefield = params.state.battlefield || [];
  const count = countControlledPermanentsOfType(battlefield, params.controller, countType);

  if (count <= 0) {
    debug(2, `[executeTriggerEffect] ${params.sourceName}: No ${countType}s to count, no tokens created`);
    return true;
  }

  const colors = colorsFromNamedColor(color);
  for (let i = 0; i < count; i++) {
    const typeLine = `Token ${isArtifact ? 'Artifact ' : ''}Creature — ${type}`;
    pushCountBasedCreatureToken(params, {
      power,
      toughness,
      tokenName: type,
      typeLine,
      colors,
    });
    debug(2, `[executeTriggerEffect] Created ${power}/${toughness} ${type} token (${i + 1}/${count}) for ${params.controller}`);
  }

  debug(1, `[executeTriggerEffect] ${params.sourceName}: Created ${count} ${type} tokens based on ${countType} count`);
  return true;
}

function getNextEndStepFireTurnNumber(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const currentPhase = String(state?.phase ?? '').toLowerCase();
  const currentStepUpper = String(state?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  return inEnding ? currentTurn + 1 : currentTurn;
}

export function applyRetiredTriggerLegacyInterveningSubjectCopyToken(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const interveningSubjectPermanentIdForCopy = String((params.triggerItem as any)?.interveningIfSubjectPermanentId || '').trim();
  if (
    !interveningSubjectPermanentIdForCopy
    || !/create a token that['']s a copy of that creature/i.test(params.desc)
  ) {
    return false;
  }

  const enteringPermanent = (params.state.battlefield || []).find(
    (perm: any) => String(perm?.id || '') === interveningSubjectPermanentIdForCopy,
  );
  const enteringCard = enteringPermanent?.card;
  if (!enteringCard) {
    return true;
  }

  const createdIds = createCopyTokensOfCard(params.ctx, params.controller, enteringCard, 1);
  const fireAtTurnNumber = getNextEndStepFireTurnNumber(params.state);
  const grantsHaste = /\b(?:gains|has|with)\s+haste\b/i.test(params.desc);

  params.state.pendingExileAtNextEndStep = Array.isArray(params.state.pendingExileAtNextEndStep)
    ? params.state.pendingExileAtNextEndStep
    : [];

  for (const tokenId of createdIds) {
    const token = (params.state.battlefield || []).find((perm: any) => perm?.id === tokenId);
    if (token && grantsHaste) {
      (token as any).tempAbilities = Array.isArray((token as any).tempAbilities) ? (token as any).tempAbilities : [];
      if (!(token as any).tempAbilities.some((ability: any) => String(ability).toLowerCase() === 'haste')) {
        (token as any).tempAbilities.push('haste');
      }
      (token as any).summoningSickness = false;
    }

    params.state.pendingExileAtNextEndStep.push({
      permanentId: tokenId,
      fireAtTurnNumber,
      sourceName: params.sourceName,
      createdBy: params.controller,
    });
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName}: created ${createdIds.length} copy token(s) of ${enteringCard.name || 'creature'}${grantsHaste ? ' with haste' : ''}`);
  return true;
}

export function applyRetiredTriggerLegacyTappedAttackingCopyToken(params: {
  readonly ctx: GameContext;
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}): boolean {
  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {
    return false;
  }

  const tappedAttackingCopyMatch = params.desc.match(/^create a tapped and attacking token that's a copy of target creature you control\. sacrifice the token at the beginning of the next end step\.?$/i);
  if (!tappedAttackingCopyMatch || !(params.triggerItem as any).targets?.length) {
    return false;
  }

  const battlefield = Array.isArray(params.state.battlefield) ? params.state.battlefield : [];
  const [targetRef] = (params.triggerItem as any).targets || [];
  const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
  const targetCreature = battlefield.find((permanent: any) => String(permanent?.id || '') === String(targetId || ''));
  const existingCopyToken = battlefield.find(
    (permanent: any) =>
      permanent?.isToken === true
      && (
        String(permanent?.copiedFromPermanentId || '').trim() === String(targetId || '').trim()
        || (
          targetCreature?.card?.name
          && String(permanent?.card?.name || '').trim() === String(targetCreature.card.name).trim()
          && String(permanent?.controller || '') === String(params.controller || '')
        )
      ),
  );
  if (existingCopyToken) {
    return true;
  }
  const sourcePermanentId = params.triggerItem.source || params.triggerItem.permanentId;
  const sourcePermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === String(sourcePermanentId || ''));
  const defendingPlayerId = String(
    (params.triggerItem as any).defendingPlayer ||
    (sourcePermanent as any)?.attacking ||
    (params.triggerItem as any)?.sourcePermanentSnapshot?.attacking ||
    ''
  ).trim();

  if (!targetCreature || targetCreature.controller !== params.controller || !defendingPlayerId || defendingPlayerId.startsWith('perm_')) {
    return true;
  }

  const createdPermanentIds = applyMyriadTokenCopies(
    params.ctx,
    targetCreature,
    params.controller,
    [defendingPlayerId],
    [uid('curse_token')],
    params.sourceName,
  );

  if (createdPermanentIds.length === 0) {
    return true;
  }

  const stateAny = params.state as any;
  stateAny.pendingExileAtEndOfCombat = Array.isArray(stateAny.pendingExileAtEndOfCombat)
    ? stateAny.pendingExileAtEndOfCombat.filter(
        (entry: any) => !createdPermanentIds.includes(String(entry?.permanentId || '').trim()),
      )
    : [];
  stateAny.pendingSacrificeAtNextEndStep = Array.isArray(stateAny.pendingSacrificeAtNextEndStep)
    ? stateAny.pendingSacrificeAtNextEndStep
    : [];

  const fireAtTurnNumber = getNextEndStepFireTurnNumber(stateAny);

  for (const permanentId of createdPermanentIds) {
    const alreadyScheduled = (stateAny.pendingSacrificeAtNextEndStep as any[]).some(
      (entry: any) => String(entry?.permanentId || '').trim() === String(permanentId),
    );
    if (alreadyScheduled) {
      continue;
    }

    stateAny.pendingSacrificeAtNextEndStep.push({
      permanentId,
      fireAtTurnNumber,
      maxManaValue: 0,
      sourceName: params.sourceName,
      createdBy: String(params.controller),
    });
  }

  debug(2, `[executeTriggerEffect] ${params.sourceName}: created ${createdPermanentIds.length} tapped and attacking token copie(s) of ${targetCreature.card?.name || targetId} for ${defendingPlayerId}`);
  return true;
}
