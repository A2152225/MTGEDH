/*
  Shared board-context checks for spell casts.

  Used by:
  - AI (`isAISpellContextuallyUseful`) so it does not cast spells that will
    NO_VALID_TARGETS or resolve into a no-op given the current table
  - Live IR soak (`provisionSpellCastBoardContext`) so the same gaps are filled
    before a scripted free-cast
*/

import type { PlayerID } from '../../../shared/src/index.js';
import { parseTargetRequirements } from '../rules-engine/targeting.js';
import { buildSpellTargetListFromRequirements } from './game-actions.js';

export type SpellCastBoardGap =
  | 'no_creature_target'
  | 'no_permanent_target'
  | 'no_stack_spell_target'
  | 'no_hand_cards'
  | 'no_hostile_combat'
  | 'no_attacking_creature';

export type SpellCastBoardInspectOptions = {
  /** Card id to ignore when counting the caster's hand (the spell about to leave). */
  excludeCardId?: string;
};

function oracleAndType(card: any): { oracleText: string; typeLine: string } {
  return {
    oracleText: String(card?.oracle_text || card?.oracleText || ''),
    typeLine: String(card?.type_line || card?.typeLine || ''),
  };
}

function getAttackingPermanents(game: any): any[] {
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  return battlefield.filter((permanent: any) =>
    Boolean(permanent?.attacking) || permanent?.isAttacking === true,
  );
}

function isHostileAttackAgainstPlayer(game: any, playerId: string, attacker: any): boolean {
  if (String(attacker?.controller || '') === String(playerId)) return false;
  if (attacker?.attacking === true || attacker?.isAttacking === true) return true;
  const attackedId = String(attacker?.attacking || attacker?.defendingPlayerId || '').trim();
  if (!attackedId) return true;
  if (attackedId === String(playerId)) return true;
  const battlefield = Array.isArray(game?.state?.battlefield) ? game.state.battlefield : [];
  return battlefield.some(
    (permanent: any) =>
      String(permanent?.id || '') === attackedId
      && String(permanent?.controller || '') === String(playerId),
  );
}

function handCardsFor(game: any, playerId: string, excludeCardId?: string): any[] {
  const zoneHand = game?.state?.zones?.[playerId]?.hand;
  const player = (game?.state?.players || []).find((entry: any) => String(entry?.id) === String(playerId));
  const hand = Array.isArray(zoneHand) ? zoneHand : (Array.isArray(player?.hand) ? player.hand : []);
  const exclude = String(excludeCardId || '').trim();
  if (!exclude) return hand;
  return hand.filter((card: any) => String(card?.id || '') !== exclude);
}

function isEachPlayerDiscardHandEffect(oracleText: string): boolean {
  const text = oracleText.toLowerCase();
  return (
    /\beach player discards (their hand|their hands|all (?:the )?cards? in their hand)\b/.test(text)
    || /\bdiscard your hand, then draw\b/.test(text)
  );
}

function classifyTargetGap(targetTypes: readonly string[]): SpellCastBoardGap {
  const joined = targetTypes.map((type) => String(type || '').toLowerCase()).join(' ');
  if (
    joined.includes('spell')
    || joined.includes('instant')
    || joined.includes('sorcery')
  ) {
    return 'no_stack_spell_target';
  }
  if (joined.includes('creature')) return 'no_creature_target';
  return 'no_permanent_target';
}

function makeCreaturePermanent(controller: string, id: string) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    card: {
      id: `${id}-card`,
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      power: '2',
      toughness: '2',
      zone: 'battlefield',
    },
  };
}

function makeStackInstant(controller: string, id: string) {
  return {
    id,
    type: 'spell',
    controller,
    card: {
      id: `${id}-card`,
      name: 'Lightning Bolt',
      type_line: 'Instant',
      oracle_text: 'Lightning Bolt deals 3 damage to any target.',
      mana_cost: '{R}',
    },
  };
}

function putHandFiller(game: any, playerId: string, count: number, tag: string) {
  const state = game.state as any;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || { hand: [], handCount: 0 };
  const hand = Array.isArray(state.zones[playerId].hand) ? state.zones[playerId].hand : (state.zones[playerId].hand = []);
  const player = (state.players || []).find((entry: any) => String(entry.id) === String(playerId));
  for (let i = 0; i < count; i += 1) {
    const card = {
      id: `${tag}-${playerId}-${i}`,
      name: 'Island',
      type_line: 'Basic Land — Island',
      oracle_text: '',
      zone: 'hand',
    };
    hand.push(card);
    if (player) {
      player.hand = Array.isArray(player.hand) ? player.hand : [];
      player.hand.push(card);
    }
  }
  state.zones[playerId].handCount = hand.length;
}

export function getSpellCastBoardGaps(
  game: any,
  playerId: PlayerID | string,
  card: any,
  options: SpellCastBoardInspectOptions = {},
): SpellCastBoardGap[] {
  const gaps: SpellCastBoardGap[] = [];
  const { oracleText, typeLine } = oracleAndType(card);
  const oracleLower = oracleText.toLowerCase();
  const typeLower = typeLine.toLowerCase();
  const attacking = getAttackingPermanents(game);
  const hasHostileAttack = attacking.some((attacker) => isHostileAttackAgainstPlayer(game, String(playerId), attacker));

  const isCombatDamageFog =
    /\bprevent all combat damage\b/.test(oracleLower)
    || /\bcreatures? (?:deal|deals) no combat damage\b/.test(oracleLower);
  if (isCombatDamageFog && !hasHostileAttack) {
    gaps.push('no_hostile_combat');
  }

  const isPersonalDamagePreventionFlash =
    typeLower.includes('creature')
    && /\bflash\b/.test(oracleLower)
    && /\bprevent all damage that would be dealt to you\b/.test(oracleLower);
  if (isPersonalDamagePreventionFlash && !hasHostileAttack) {
    const stack = Array.isArray(game?.state?.stack) ? game.state.stack : [];
    const stackThreat = stack.some((entry: any) => {
      const text = String(entry?.oracle_text || entry?.card?.oracle_text || entry?.effectText || '').toLowerCase();
      if (!/\bdamage\b/.test(text)) return false;
      return /\byou\b|\btarget (?:player|opponent|creature or player|any target)\b/.test(text);
    });
    if (!stackThreat) gaps.push('no_hostile_combat');
  }

  if (/\btarget (?:player|opponent) sacrifices an? attacking creature\b/.test(oracleLower)) {
    const hasOppAttacker = attacking.some((attacker: any) => String(attacker?.controller || '') !== String(playerId));
    if (!hasOppAttacker) gaps.push('no_attacking_creature');
  }

  if (isEachPlayerDiscardHandEffect(oracleText)) {
    const players = Array.isArray(game?.state?.players) ? game.state.players : [];
    const anyoneHasCards = players.some((player: any) => {
      const exclude = String(player.id) === String(playerId) ? options.excludeCardId : undefined;
      return handCardsFor(game, String(player.id), exclude).length > 0;
    });
    if (!anyoneHasCards) gaps.push('no_hand_cards');
  }

  const isAura = typeLower.includes('aura') && /^enchant\s+/im.test(oracleText);
  const targetReqs = parseTargetRequirements(oracleText, {
    gameState: game?.state,
    controllerId: String(playerId),
    sourceName: String(card?.name || ''),
  });
  const minTargets = isAura ? 1 : Number(targetReqs?.minTargets || 0);
  const needsTargets = isAura || (Boolean(targetReqs?.needsTargets) && minTargets > 0);
  if (needsTargets) {
    const reqs = isAura && (!targetReqs?.targetTypes || targetReqs.targetTypes.length === 0)
      ? { needsTargets: true, targetTypes: ['creature'], minTargets: 1, maxTargets: 1, targetDescription: 'enchanted creature' }
      : targetReqs;
    const valid = buildSpellTargetListFromRequirements(game, String(playerId), reqs);
    if (valid.length < minTargets) {
      gaps.push(classifyTargetGap(reqs?.targetTypes || ['permanent']));
    }
  }

  return gaps;
}

export function isSpellCastBoardContextUseful(
  game: any,
  playerId: PlayerID | string,
  card: any,
  options: SpellCastBoardInspectOptions = {},
): boolean {
  return getSpellCastBoardGaps(game, playerId, card, options).length === 0;
}

export function provisionSpellCastBoardContext(
  game: any,
  playerId: PlayerID | string,
  card: any,
  options: SpellCastBoardInspectOptions & { opponentIds?: readonly string[] } = {},
): SpellCastBoardGap[] {
  const state = game.state as any;
  const opponents = (options.opponentIds && options.opponentIds.length > 0)
    ? [...options.opponentIds]
    : (state.players || [])
      .map((player: any) => String(player.id))
      .filter((id: string) => id && id !== String(playerId));
  const opponentId = opponents[0] || String(playerId);
  const tag = `board-${String(card?.name || 'spell').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;

  const applyGap = (gap: SpellCastBoardGap) => {
    if (gap === 'no_creature_target' || gap === 'no_permanent_target' || gap === 'no_attacking_creature') {
      state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
      const creature = makeCreaturePermanent(opponentId, `${tag}-creature`);
      if (gap === 'no_attacking_creature') {
        (creature as any).attacking = playerId;
        state.phase = state.phase || 'combat';
        state.step = state.step || 'DECLARE_ATTACKERS';
        state.combat = state.combat || { attackers: [creature.id] };
      }
      state.battlefield.push(creature);
      return;
    }
    if (gap === 'no_stack_spell_target') {
      state.stack = Array.isArray(state.stack) ? state.stack : [];
      state.stack.push(makeStackInstant(opponentId, `${tag}-stack`));
      return;
    }
    if (gap === 'no_hand_cards') {
      const players = (state.players || []).map((player: any) => String(player.id)).filter(Boolean);
      for (const pid of players) {
        putHandFiller(game, pid, 2, `${tag}-hand`);
      }
      return;
    }
    if (gap === 'no_hostile_combat') {
      state.battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
      const attacker = makeCreaturePermanent(opponentId, `${tag}-atk`);
      (attacker as any).attacking = playerId;
      state.battlefield.push(attacker);
      state.phase = 'combat';
      state.step = 'DECLARE_ATTACKERS';
      state.combat = { attackers: [attacker.id] };
    }
  };

  let guard = 0;
  let gaps = getSpellCastBoardGaps(game, playerId, card, options);
  while (gaps.length > 0 && guard < 6) {
    applyGap(gaps[0]);
    guard += 1;
    gaps = getSpellCastBoardGaps(game, playerId, card, options);
  }
  return gaps;
}
