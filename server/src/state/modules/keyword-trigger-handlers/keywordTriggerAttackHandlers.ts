/**
 * keyword-trigger-handlers/keywordTriggerAttackHandlers.ts
 * Origin parent: server/src/state/modules/keyword-handlers.ts
 * Cluster moved: combat lookup helpers plus attack-trigger handleProwess through handleEnlist.
 * Public entry symbols: handleProwess, handleDethrone, handleEvolve, handleMelee, handleMyriad,
 * handleExalted, handleBattleCry, handleMentor, handleTraining, handleAnnihilator, handleAfflict,
 * handleFlanking, handleBushido, handleRampage, handleEnlist.
 */

import type { DetectedKeyword } from "../keyword-detection.js";
import type { KeywordTriggerResult, KeywordTriggerContext } from "./keywordTriggerTypes.js";
import { permanentHasKeyword } from "./keywordTriggerPermanentLookup.js";

function numericCombatPower(permanent: any): number {
  const raw = permanent?.effectivePower ?? permanent?.power ?? permanent?.basePower ?? permanent?.card?.power;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAttackingCreatures(ctx: KeywordTriggerContext): any[] {
  const fromSnapshot = Array.isArray(ctx.attackingCreatures)
    ? ctx.attackingCreatures.filter(Boolean)
    : [];
  const fromBattlefield = Array.isArray(ctx.battlefield)
    ? ctx.battlefield.filter((entry: any) => {
        if (!entry) return false;
        const typeLine = String(entry?.card?.type_line || '').toLowerCase();
        return typeLine.includes('creature') && Boolean(entry?.attacking || entry?.attackedThisTurn);
      })
    : [];
  return fromBattlefield.length > fromSnapshot.length ? fromBattlefield : (fromSnapshot.length > 0 ? fromSnapshot : fromBattlefield);
}

function getBlockingCreatureIds(ctx: KeywordTriggerContext): string[] {
  if (Array.isArray(ctx.blockingCreatureIds) && ctx.blockingCreatureIds.length > 0) {
    return ctx.blockingCreatureIds
      .map((value: any) => String(value || '').trim())
      .filter(Boolean);
  }

  if (Array.isArray(ctx.blockingCreatures) && ctx.blockingCreatures.length > 0) {
    return ctx.blockingCreatures
      .map((entry: any) => String(entry?.id || '').trim())
      .filter(Boolean);
  }

  const blockedBy = Array.isArray(ctx.permanent?.blockedBy)
    ? ctx.permanent.blockedBy
    : (ctx.permanent?.blockedBy ? [ctx.permanent.blockedBy] : []);

  return blockedBy
    .map((value: any) => String(value || '').trim())
    .filter(Boolean);
}

function getBlockingCreatures(ctx: KeywordTriggerContext): any[] {
  const blockingCreatureIds = getBlockingCreatureIds(ctx);
  if (blockingCreatureIds.length === 0) return [];

  const battlefield = Array.isArray(ctx.battlefield) ? ctx.battlefield : [];
  return blockingCreatureIds
    .map((blockingCreatureId) => battlefield.find((entry: any) => entry && String(entry.id || '') === blockingCreatureId))
    .filter(Boolean);
}

// ============================================================================
// Keyword-Specific Handlers
// ============================================================================

/**
 * Prowess - +1/+1 until end of turn when you cast a noncreature spell
 */
function handleProwess(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  return {
    keyword: 'prowess',
    processed: true,
    ptModification: { power: 1, toughness: 1, duration: 'end_of_turn' },
    chatMessage: `${cardName} gets +1/+1 until end of turn (Prowess)`,
  };
}

/**
 * Dethrone - +1/+1 counter when attacking player with most life
 */
function handleDethrone(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const defendingPlayer = ctx.defendingPlayer;
  
  // Check if defending player has the most life
  const players = ctx.players || [];
  const lifeTotals = players.map((p: any) => p.life ?? 40);
  const maxLife = Math.max(...lifeTotals);
  
  const defender = players.find((p: any) => p.id === defendingPlayer);
  const defenderLife = defender?.life ?? 40;
  
  if (defenderLife >= maxLife) {
    return {
      keyword: 'dethrone',
      processed: true,
      countersAdded: { type: '+1/+1', count: 1 },
      chatMessage: `${cardName} dethroned! Put a +1/+1 counter on it (attacking player with most life)`,
    };
  }
  
  return {
    keyword: 'dethrone',
    processed: true,
    chatMessage: `${cardName}'s Dethrone didn't trigger (not attacking player with most life)`,
  };
}

/**
 * Evolve - +1/+1 counter when larger creature enters
 */
function handleEvolve(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const entering = ctx.enteringCreature;
  
  if (!entering) {
    return { keyword: 'evolve', processed: false };
  }
  
  // Get current P/T
  const currentPower = ctx.permanent?.power ?? 0;
  const currentToughness = ctx.permanent?.toughness ?? 0;
  const enteringPower = entering.power ?? entering.card?.power ?? 0;
  const enteringToughness = entering.toughness ?? entering.card?.toughness ?? 0;
  
  if (enteringPower > currentPower || enteringToughness > currentToughness) {
    return {
      keyword: 'evolve',
      processed: true,
      countersAdded: { type: '+1/+1', count: 1 },
      chatMessage: `${cardName} evolved! Put a +1/+1 counter on it`,
    };
  }
  
  return { keyword: 'evolve', processed: true };
}

/**
 * Melee - +1/+1 for each opponent attacked this combat
 */
function handleMelee(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  // Count unique opponents being attacked
  const attackingCreatures = getAttackingCreatures(ctx);
  const attackedOpponents = new Set<string>();
  
  for (const attacker of attackingCreatures) {
    if (attacker.attacking && attacker.controller === ctx.controller) {
      attackedOpponents.add(attacker.attacking);
    }
  }
  
  const bonus = attackedOpponents.size;
  
  return {
    keyword: 'melee',
    processed: true,
    ptModification: { power: bonus, toughness: bonus, duration: 'end_of_turn' },
    chatMessage: `${cardName} gets +${bonus}/+${bonus} until end of turn (Melee - attacking ${bonus} opponent${bonus !== 1 ? 's' : ''})`,
  };
}

/**
 * Myriad - Create token copies attacking each other opponent
 */
function handleMyriad(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  // Get opponents not being attacked
  const attackedPlayer = ctx.defendingPlayer;
  const opponents = ctx.players?.filter((p: any) => 
    p.id !== ctx.controller && p.id !== attackedPlayer
  ) || [];
  
  if (opponents.length === 0) {
    return {
      keyword: 'myriad',
      processed: true,
      chatMessage: `${cardName}'s Myriad triggers but no other opponents to attack`,
    };
  }
  
  return {
    keyword: 'myriad',
    processed: true,
    tokensCreated: { count: opponents.length, type: 'copy' },
    requiresPlayerChoice: {
      type: 'myriad_tokens',
      options: opponents.map((p: any) => ({ id: p.id, name: p.name || p.id })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Myriad triggers - create ${opponents.length} token copies attacking other opponents`,
  };
}

/**
 * Exalted - +1/+1 to attacking creature when attacking alone
 * Note: Each permanent with exalted triggers separately (Rule 702.83b).
 * The caller (processKeywordTriggers) handles iterating over each permanent,
 * so this function returns the bonus from a single exalted trigger.
 * Multiple exalted permanents will each call this handler, stacking the bonuses.
 */
function handleExalted(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Permanent';
  const attackingCreatures = getAttackingCreatures(ctx);
  
  // Only triggers when exactly one creature attacks
  const myAttackers = attackingCreatures.filter((c: any) => c.controller === ctx.controller);
  
  if (myAttackers.length !== 1) {
    return { keyword: 'exalted', processed: true };
  }

  const targetAttackerId = String(myAttackers[0]?.id || '').trim();
  
  return {
    keyword: 'exalted',
    processed: true,
    ptModification: { power: 1, toughness: 1, duration: 'end_of_turn' },
    ...(targetAttackerId ? { affectedPermanentIds: [targetAttackerId] } : null),
    chatMessage: `${cardName}'s Exalted triggers - attacking creature gets +1/+1`,
  };
}

/**
 * Battle Cry - Each other attacking creature gets +1/+0
 */
function handleBattleCry(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const attackingCreatures = getAttackingCreatures(ctx);
  const myAttackers = attackingCreatures.filter((c: any) => 
    c.controller === ctx.controller && c.id !== ctx.permanent?.id
  );

  const affectedPermanentIds = myAttackers
    .map((creature: any) => String(creature?.id || '').trim())
    .filter(Boolean);

  if (affectedPermanentIds.length === 0) {
    return {
      keyword: 'battle_cry',
      processed: true,
      chatMessage: `${cardName}'s Battle Cry triggers but no other attacking creatures get +1/+0`,
    };
  }
  
  return {
    keyword: 'battle_cry',
    processed: true,
    ptModification: { power: 1, toughness: 0, duration: 'end_of_turn' },
    affectedPermanentIds,
    effect: `${affectedPermanentIds.length} creatures get +1/+0`,
    chatMessage: `${cardName}'s Battle Cry triggers - ${affectedPermanentIds.length} other attacking creatures get +1/+0`,
  };
}

/**
 * Mentor - Put +1/+1 counter on target attacking creature with lesser power
 */
function handleMentor(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const attackingCreatures = getAttackingCreatures(ctx);
  const mentorPower = numericCombatPower(ctx.permanent);
  
  // Find valid targets (attacking creatures with lesser power)
  const validTargets = attackingCreatures.filter((c: any) => {
    if (c.id === ctx.permanent?.id) return false;
    if (c.controller !== ctx.controller) return false;
    return numericCombatPower(c) < mentorPower;
  });
  
  if (validTargets.length === 0) {
    return {
      keyword: 'mentor',
      processed: true,
      chatMessage: `${cardName}'s Mentor triggers but no valid targets`,
    };
  }
  
  return {
    keyword: 'mentor',
    processed: true,
    requiresPlayerChoice: {
      type: 'target_creature',
      options: validTargets.map((t: any) => ({
        id: t.id,
        name: t.card?.name || 'Creature',
        power: t.power ?? t.card?.power,
      })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Mentor triggers - choose target attacking creature with lesser power`,
  };
}

/**
 * Training - +1/+1 counter when attacking with creature with greater power
 */
function handleTraining(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const attackingCreatures = getAttackingCreatures(ctx);
  const myPower = ctx.permanent?.power ?? ctx.permanent?.card?.power ?? 0;
  
  // Check if any other attacking creature has greater power
  const hasGreaterPower = attackingCreatures.some((c: any) => {
    if (c.id === ctx.permanent?.id) return false;
    if (c.controller !== ctx.controller) return false;
    const theirPower = c.power ?? c.card?.power ?? 0;
    return theirPower > myPower;
  });
  
  if (hasGreaterPower) {
    return {
      keyword: 'training',
      processed: true,
      countersAdded: { type: '+1/+1', count: 1 },
      chatMessage: `${cardName} trained! Put a +1/+1 counter on it`,
    };
  }
  
  return { keyword: 'training', processed: true };
}

/**
 * Annihilator N - Defending player sacrifices N permanents
 */
function handleAnnihilator(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const defendingPlayer = ctx.defendingPlayer;
  
  if (!defendingPlayer) {
    return { keyword: 'annihilator', processed: false };
  }
  
  return {
    keyword: 'annihilator',
    processed: true,
    sacrifice: { player: defendingPlayer, count: n },
    requiresPlayerChoice: {
      type: 'sacrifice_permanents',
      options: [], // Will be populated by socket handler
      playerId: defendingPlayer,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Annihilator ${n} triggers - defending player must sacrifice ${n} permanent${n > 1 ? 's' : ''}`,
  };
}

/**
 * Afflict N - Defending player loses N life when this creature becomes blocked
 */
function handleAfflict(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const defendingPlayer = String(
    ctx.defendingPlayer ||
      (typeof ctx.permanent?.attacking === 'string' ? ctx.permanent.attacking : '') ||
      ''
  ).trim();

  if (!defendingPlayer) {
    return { keyword: 'afflict', processed: false };
  }

  return {
    keyword: 'afflict',
    processed: true,
    lifeChange: { player: defendingPlayer, amount: -n },
    effect: `Defending player loses ${n} life`,
    chatMessage: `${cardName}'s Afflict ${n} triggers - defending player loses ${n} life`,
  };
}

/**
 * Flanking - Blocking creature without flanking gets -1/-1
 */
function handleFlanking(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const snapshotBlockingCreatureIds = Array.isArray(ctx.blockingCreatureIds) && ctx.blockingCreatureIds.length > 0
    ? ctx.blockingCreatureIds.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  const blockingCreatureIds = snapshotBlockingCreatureIds.length > 0
    ? snapshotBlockingCreatureIds
    : getBlockingCreatures(ctx)
        .filter((entry: any) => !permanentHasKeyword(entry, 'flanking'))
        .map((entry: any) => String(entry?.id || '').trim())
        .filter(Boolean);

  if (blockingCreatureIds.length === 0) {
    return {
      keyword: 'flanking',
      processed: true,
    };
  }
  
  return {
    keyword: 'flanking',
    processed: true,
    ptModification: { power: -1, toughness: -1, duration: 'end_of_turn' },
    affectedPermanentIds: blockingCreatureIds,
    effect: 'Blocking creature without flanking gets -1/-1 until end of turn',
    chatMessage: `${cardName}'s Flanking triggers - blocking creature gets -1/-1 until end of turn`,
  };
}

/**
 * Bushido N - +N/+N when blocking or blocked
 */
function handleBushido(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  
  return {
    keyword: 'bushido',
    processed: true,
    ptModification: { power: n, toughness: n, duration: 'end_of_turn' },
    chatMessage: `${cardName}'s Bushido ${n} triggers - gets +${n}/+${n} until end of turn`,
  };
}

/**
 * Rampage N - +N/+N for each creature blocking beyond the first
 */
function handleRampage(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  const n = keyword.value || 1;
  const blockingCreatureIds = getBlockingCreatureIds(ctx);
  const extraBlockers = Math.max(0, blockingCreatureIds.length - 1);
  const bonus = extraBlockers * n;

  if (bonus <= 0) {
    return {
      keyword: 'rampage',
      processed: true,
      chatMessage: `${cardName}'s Rampage ${n} triggers but no bonus is applied`,
    };
  }

  return {
    keyword: 'rampage',
    processed: true,
    ptModification: { power: bonus, toughness: bonus, duration: 'end_of_turn' },
    chatMessage: `${cardName}'s Rampage ${n} triggers - gets +${bonus}/+${bonus} until end of turn`,
  };
}

/**
 * Enlist - Tap another creature to add its power
 */
function handleEnlist(ctx: KeywordTriggerContext, keyword: DetectedKeyword): KeywordTriggerResult {
  const cardName = ctx.permanent?.card?.name || 'Creature';
  
  // Find valid creatures to tap (untapped, non-attacking creatures you control)
  const validCreatures = ctx.battlefield?.filter((p: any) => {
    if (p.controller !== ctx.controller) return false;
    if (p.id === ctx.permanent?.id) return false;
    if (p.tapped) return false;
    if (p.attacking) return false;
    const typeLine = (p.card?.type_line || '').toLowerCase();
    return typeLine.includes('creature');
  }) || [];
  
  if (validCreatures.length === 0) {
    return {
      keyword: 'enlist',
      processed: true,
      chatMessage: `${cardName}'s Enlist - no valid creatures to tap`,
    };
  }
  
  return {
    keyword: 'enlist',
    processed: true,
    requiresPlayerChoice: {
      type: 'tap_creature',
      options: validCreatures.map((c: any) => ({
        id: c.id,
        name: c.card?.name || 'Creature',
        power: c.power ?? c.card?.power ?? 0,
      })),
      playerId: ctx.controller,
      permanentId: ctx.permanent?.id,
    },
    chatMessage: `${cardName}'s Enlist - you may tap another creature to add its power`,
  };
}


export {
  handleProwess,
  handleDethrone,
  handleEvolve,
  handleMelee,
  handleMyriad,
  handleExalted,
  handleBattleCry,
  handleMentor,
  handleTraining,
  handleAnnihilator,
  handleAfflict,
  handleFlanking,
  handleBushido,
  handleRampage,
  handleEnlist,
};
