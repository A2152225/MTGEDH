export function detectTriggeredAbilityEvent<T extends string>(
  condition: string,
  triggerEventValues: Record<string, T>
): { event: T; filter?: string } {
  const text = condition.toLowerCase().replace(/\s+/g, ' ').trim();
  const putIntoGraveyardFromBattlefield =
    /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield\b/i.test(text);
  const isDiesStyleTrigger = text.includes('dies') || /\bdie\b/i.test(text) || putIntoGraveyardFromBattlefield;

  if (text.includes('enters the battlefield') || text.includes('enters')) {
    if (text.includes('a land') || text.includes('land you control')) {
      return { event: triggerEventValues.LANDFALL };
    }
    return { event: triggerEventValues.ENTERS_BATTLEFIELD };
  }

  if (isDiesStyleTrigger) {
    const isControlledCreatureDiesTrigger =
      /^(?:(?:one or more|another)\s+)?(?:a|an)?\s*(?:(?:[^,]+?)\s+)?creatures?\s+you control(?:\s+but\s+(?:don't|dont|do not)\s+own)?(?:\s+(?:without\s+[^,]+|with\s+[^,]+(?:\s+on\s+it)?))?\s+dies?$/i.test(
        text
      );

    if (/^this (?:creature|permanent|card|artifact|enchantment|land|planeswalker|battle)\b/i.test(text)) {
      return { event: triggerEventValues.DIES, filter: text };
    }
    if (
      text.includes('enchanted creature') ||
      text.includes('equipped creature') ||
      text.includes('enchanted land') ||
      text.includes('enchanted permanent')
    ) {
      return { event: triggerEventValues.DIES, filter: text };
    }
    if (text.includes('dealt damage by')) {
      return { event: triggerEventValues.DIES, filter: text };
    }
    if (isControlledCreatureDiesTrigger) {
      return { event: triggerEventValues.CONTROLLED_CREATURE_DIED, filter: text };
    }
    if (
      text.includes('you control') ||
      text.includes("you don't control") ||
      text.includes('you do not control')
    ) {
      return { event: triggerEventValues.DIES, filter: text };
    }
    if (text.includes('another creature')) {
      return { event: triggerEventValues.DIES, filter: text };
    }
    return { event: triggerEventValues.DIES };
  }

  if (/\battacks?\b/.test(text)) {
    if (/\battacks?\s+alone\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS_ALONE };
    }
    return { event: triggerEventValues.ATTACKS };
  }

  if (text.includes('blocks')) {
    return { event: triggerEventValues.BLOCKS };
  }

  if (text.includes('becomes blocked')) {
    return { event: triggerEventValues.BECOMES_BLOCKED };
  }

  if (text.includes('mutates')) {
    return { event: triggerEventValues.MUTATES, filter: text };
  }

  if (text.includes('becomes monstrous')) {
    return { event: triggerEventValues.BECAME_MONSTROUS, filter: text };
  }

  if (text.includes('deals combat damage to a player') || text.includes('deals combat damage to an opponent')) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER };
  }

  if (text.includes('deals combat damage')) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE };
  }

  if (text.includes('deals damage')) {
    return { event: triggerEventValues.DEALS_DAMAGE };
  }

  if (text.includes('beginning of your upkeep') || text.includes('your upkeep')) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: 'your' };
  }

  if (text.includes('beginning of each upkeep') || text.includes('each upkeep') || text.includes("each player's upkeep")) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: 'each' };
  }

  if (text.includes('upkeep')) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP };
  }

  if (text.includes('beginning of combat on your turn') || text.includes('combat on your turn')) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: 'your' };
  }

  if (text.includes('beginning of each combat') || text.includes('each combat')) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: 'each' };
  }

  if (text.includes('beginning of combat') || text === 'combat') {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT };
  }

  if (text.includes('beginning of your end step') || text.includes('your end step')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP, filter: 'your' };
  }

  if (text.includes('beginning of each end step') || text.includes('each end step')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP, filter: 'each' };
  }

  if (text.includes('end step') || text.includes('end of turn')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP };
  }

  if (text.includes('end of combat')) {
    return { event: triggerEventValues.END_OF_COMBAT };
  }

  if (
    /\b(?:you|an opponent|opponent|a player|each player|each opponent|that player|they)\s+cast\b/.test(text) ||
    /\bcasts?\s+(?:their\s+first\s+)?(?:a\s+)?(?:noncreature\s+spell|creature\s+spell|instant or sorcery spell|spell)\b/.test(text)
  ) {
    if (text.includes('noncreature spell')) {
      return { event: triggerEventValues.NONCREATURE_SPELL_CAST };
    }
    if (text.includes('creature spell')) {
      return { event: triggerEventValues.CREATURE_SPELL_CAST };
    }
    if (text.includes('instant or sorcery spell')) {
      return { event: triggerEventValues.INSTANT_OR_SORCERY_CAST };
    }
    return { event: triggerEventValues.SPELL_CAST };
  }

  if (text.includes('draws a card') || text.includes('draw a card')) {
    return { event: triggerEventValues.DRAWN };
  }

  if (text.includes('discards a card') || text.includes('discard a card')) {
    return { event: triggerEventValues.DISCARDED };
  }

  if (text.includes('gains life') || text.includes('gain life')) {
    return { event: triggerEventValues.GAINED_LIFE };
  }

  if (text.includes('loses life') || text.includes('lose life')) {
    return { event: triggerEventValues.LOST_LIFE };
  }

  if (text.includes('sacrifice')) {
    if (text.includes('creature')) {
      return { event: triggerEventValues.CREATURE_SACRIFICED };
    }
    if (text.includes('artifact')) {
      return { event: triggerEventValues.ARTIFACT_SACRIFICED };
    }
    return { event: triggerEventValues.SACRIFICED };
  }

  if (text.includes('becomes tapped') || text.includes('taps')) {
    const needsFilter = !text.includes('this creature') && !text.includes('this permanent');
    return needsFilter
      ? { event: triggerEventValues.BECOMES_TAPPED, filter: text }
      : { event: triggerEventValues.BECOMES_TAPPED };
  }

  if (text.includes('becomes untapped') || text.includes('untaps')) {
    const needsFilter = !text.includes('this creature') && !text.includes('this permanent');
    return needsFilter
      ? { event: triggerEventValues.BECOMES_UNTAPPED, filter: text }
      : { event: triggerEventValues.BECOMES_UNTAPPED };
  }

  if (text.includes('counter') && text.includes('placed')) {
    return { event: triggerEventValues.COUNTER_PLACED };
  }

  if (text.includes('counter') && text.includes('removed')) {
    return { event: triggerEventValues.COUNTER_REMOVED };
  }

  if (text.includes('token') && (text.includes('created') || text.includes('enters'))) {
    return { event: triggerEventValues.TOKEN_CREATED };
  }

  if (text.includes('exiled') || text.includes('is exiled')) {
    return { event: triggerEventValues.EXILED };
  }

  if (text.includes('becomes the target') || text.includes('is targeted')) {
    return { event: triggerEventValues.TARGETED };
  }

  if (text.includes('leaves the battlefield') || text.includes('left the battlefield')) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD };
  }

  if (text.includes('returned to') && text.includes('hand')) {
    return { event: triggerEventValues.RETURNED_TO_HAND };
  }

  if (text.includes('enters')) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD };
  }

  return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: 'unknown_trigger_pattern' };
}
