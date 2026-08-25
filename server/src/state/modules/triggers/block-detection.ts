/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover detectBlockTriggers (merged into triggers/; leftover re-exports)
 * Public: detectBlockTriggers
 */

import type { BlockTrigger } from "./block-trigger-type.js";
import { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
import { isOracleIndexInsideParenthetical } from "./etb-detection-helpers.js";
import { findFirstRegexMatchAcrossOracleLines, timingTriggerEffect } from "./timing-effect-extraction.js";
export function detectBlockTriggers(card: any, permanent: any): BlockTrigger[] {
  const triggers: BlockTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  const blockKeywordReminderLinePattern = /^(?:afflict\s+\d+|bushido\s+\d+|flanking|rampage\s+\d+)\b/i;

  const findGenericBlockTriggerLine = (): RegExpMatchArray | null => {
    const blockNameVariants = buildCardNameRegexAlternatives(cardName);
    const blockSubjectPattern = `(?:~|this creature|this vehicle|(?:${blockNameVariants.join('|')}))`;
    return findFirstRegexMatchAcrossOracleLines(
      oracleText,
      (line) => blockKeywordReminderLinePattern.test(line),
      [
        new RegExp(`when(?:ever)?\\s+${blockSubjectPattern}\\s+blocks(?:\\s+a\\s+creature)?,?\\s*(.+)$`, 'i'),
      ],
    );
  };

  const anyCreatureBlocksMatch = oracleText.match(/whenever a creature blocks,?\s*([^.]+)/i);
  if (anyCreatureBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'any_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'any_creature_blocks' as any,
    } as BlockTrigger);
  }

  const opponentCreatureBlocksMatch = oracleText.match(
    /whenever a creature an opponent controls blocks,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'opponent_creature_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'opponent_creature_blocks' as any,
    } as BlockTrigger);
  }

  const equippedCreatureBlocksMatch = oracleText.match(/whenever equipped creature blocks a creature,?\s*([^.]+)/i);
  if (
    equippedCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'equipped_creature_blocks_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'equipped_creature_blocks_creature' as any,
    } as BlockTrigger);
  }

  const enchantedCreatureBecomesBlockedMatch = oracleText.match(
    /whenever a creature you control that's enchanted becomes blocked,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureBecomesBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const enchantedCreatureBlocksMatch = oracleText.match(/when(?:ever)? enchanted creature blocks,?\s*([^.]+)/i);
  if (enchantedCreatureBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_blocks' as any,
    } as BlockTrigger);
  }

  const controlledBecomeBlockedMatch = oracleText.match(
    /whenever one or more creatures you control become blocked,?\s*([^.]+)/i,
  );
  if (
    controlledBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creatures_become_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creatures_become_blocked' as any,
    } as BlockTrigger);
  }

  const menaceBecomeBlockedMatch = oracleText.match(
    /whenever a creature you control with menace becomes blocked,?\s*([^.]+)/i,
  );
  if (
    menaceBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'menace_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, menaceBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'menace_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const ringBearerBlockedMatch = oracleText.match(
    /whenever your ring-bearer becomes blocked by a creature,?\s*([^.]+)/i,
  );
  if (
    ringBearerBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'ring_bearer_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, ringBearerBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'ring_bearer_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const typedBecomeBlockedMatch = oracleText.match(
    /whenever a ([\w]+) becomes blocked,?\s*([^.]+)/i,
  );
  if (
    typedBecomeBlockedMatch &&
    !/\bcreature\b/i.test(String(typedBecomeBlockedMatch[1] || '')) &&
    !triggers.some((t) => (t as any).triggerType === 'typed_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedBecomeBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const typedAnotherBecomeBlockedMatch = oracleText.match(
    /whenever another ([\w]+) you control becomes blocked,?\s*([^.]+)/i,
  );
  if (
    typedAnotherBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'typed_another_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedAnotherBecomeBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_another_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const controlledCreatureBecomeBlockedMatch = oracleText.match(
    /whenever a creature you control becomes blocked,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const controlledCreatureAttacksOrBlocksMatch = oracleText.match(
    /whenever a creature you control attacks or blocks,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureAttacksOrBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const controlledCreatureBlocksMatch = oracleText.match(
    /whenever a creature you control blocks,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_blocks' as any,
    } as BlockTrigger);
  }

  const enchantedAttacksOrBlocksMatch = oracleText.match(
    /when(?:ever)? enchanted creature attacks or blocks,?\s*([^.]+)/i,
  );
  if (
    enchantedAttacksOrBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const blockNameVariantsEarly = buildCardNameRegexAlternatives(cardName);
  const attacksOrBlocksMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|this vehicle|(?:${blockNameVariantsEarly.join('|')})) attacks or blocks,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const chefRoleAttacksOrBlocksMatch = oracleText.match(
    /whenever a creature you control enchanted by a Chef Role attacks or blocks,?\s*([^.]+)/i,
  );
  if (chefRoleAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'chef_role_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, chefRoleAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'chef_role_attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedBlocksOrBecomesBlockedMatch = oracleText.match(
    /whenever equipped creature blocks or becomes blocked by one or more creatures,?\s*([^.]+)/i,
  );
  if (
    equippedBlocksOrBecomesBlockedMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_blocks_or_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedBlocksOrBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_blocks_or_becomes_blocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedBlocksOrBlockedByVampireMatch = oracleText.match(
    /whenever equipped creature blocks or becomes blocked by a Vampire,?\s*([^.]+)/i,
  );
  if (
    equippedBlocksOrBlockedByVampireMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_blocks_or_blocked_by_vampire')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedBlocksOrBlockedByVampireMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_blocks_or_blocked_by_vampire',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const defenderBlocksMatch = oracleText.match(
    /whenever a creature you control with defender blocks,?\s*([^.]+)/i,
  );
  if (defenderBlocksMatch && !triggers.some((t) => t.triggerType === 'defender_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, defenderBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'defender_creature_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Brimaz, King of Oreskos: "Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature."
  if (lowerName.includes("brimaz")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      effect: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      mandatory: true,
      createTokens: {
        count: 1,
        power: 1,
        toughness: 1,
        type: "Cat Soldier",
        color: "white",
        abilities: ["vigilance"],
      },
    });
  }

  const blocksMatch = findGenericBlockTriggerLine();

  if (blocksMatch && !triggers.some(t => t.permanentId === permanentId)) {
    const effectText = timingTriggerEffect(oracleText, blocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const anyCreatureAttacksOrBlocksBlockMatch = oracleText.match(/whenever a creature attacks or blocks,?\s*([^.]+)/i);
  if (anyCreatureAttacksOrBlocksBlockMatch && !triggers.some((t) => (t as any).triggerType === 'any_creature_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksOrBlocksBlockMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'any_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const blockNameVariants = buildCardNameRegexAlternatives(cardName);
  const typedBecomesBlockedMatch = oracleText.match(
    /whenever a ([\w]+) you control becomes blocked,?\s*([^.]+)/i,
  );
  if (typedBecomesBlockedMatch && !triggers.some((t) => (t as any).triggerType === 'typed_becomes_blocked')) {
    const effectText = timingTriggerEffect(oracleText, typedBecomesBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const selfOrEquippedBecomesBlockedMatch = oracleText.match(
    /whenever this creature or equipped creature becomes blocked,?\s*([^.]+)/i,
  );
  if (
    selfOrEquippedBecomesBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'self_or_equipped_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEquippedBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'self_or_equipped_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const becomesBlockedPatterns = [
    /when(?:ever)?\s+(?:~|this creature)\s+becomes blocked(?: this turn)?,?\s*([^.]+)/i,
    new RegExp(`when(?:ever)?\\s+(?:${blockNameVariants.join('|')})\\s+becomes blocked(?: this turn)?,?\\s*([^.]+)`, 'i'),
    /whenever\s+(?:~|this creature)\s+becomes blocked by (?:a |an )?creature,?\s*([^.]+)/i,
    /whenever\s+enchanted\s+creature\s+becomes\s+blocked,?\s*([^.]+)/i,
    /whenever\s+equipped\s+creature\s+becomes\s+blocked,?\s*([^.]+)/i,
    /whenever\s+equipped\s+creature\s+blocks\s+or\s+becomes\s+blocked\s+by\s+(?:a\s+)?creature,?\s*([^.]+)/i,
    /whenever\s+(?:~|this creature)\s+blocks\s+or\s+becomes\s+blocked,?\s*([^.]+)/i,
    /when\s+that\s+creature\s+becomes\s+blocked(?:\s+this\s+turn)?,?\s*([^.]+)/i,
  ];
  for (const pattern of becomesBlockedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    if (typeof match.index === 'number' && isOracleIndexInsideParenthetical(oracleText, match.index)) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}
