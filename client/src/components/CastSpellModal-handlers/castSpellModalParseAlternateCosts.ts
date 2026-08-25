/**
 * Origin parent: client/src/components/CastSpellModal.tsx
 *
 * Cluster moved: parseAlternateCosts (oracle-text alternate-cost parse).
 *
 * Public entry symbols: AlternateCost, parseAlternateCosts.
 */

/**
 * Represents an alternate casting cost option
 */
export interface AlternateCost {
  id: string;
  label: string;
  description?: string;
  manaCost: string;
  additionalCost?: string; // e.g., "Discard a card", "Sacrifice a creature"
  isDefault?: boolean;
}

/**
 * Parse alternate costs from card oracle text
 */
export function parseAlternateCosts(oracleText: string, cardManaCost: string, cardName: string): AlternateCost[] {
  const costs: AlternateCost[] = [];
  const text = oracleText || '';
  const lowerText = text.toLowerCase();
  const lowerName = (cardName || '').toLowerCase();
  
  // Default cost is always first
  costs.push({
    id: 'normal',
    label: 'Normal Cost',
    manaCost: cardManaCost,
    isDefault: true,
  });
  
  // Flashback - cast from graveyard for alternate cost
  const flashbackMatch = text.match(/flashback[^(]*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (flashbackMatch) {
    costs.push({
      id: 'flashback',
      label: 'Flashback',
      description: 'Cast from graveyard',
      manaCost: flashbackMatch[1],
    });
  }
  
  // Overload - cast for alternate cost, affects all instead of target
  const overloadMatch = text.match(/overload\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (overloadMatch) {
    costs.push({
      id: 'overload',
      label: 'Overload',
      description: 'Affects all valid targets instead of one',
      manaCost: overloadMatch[1],
    });
  }
  
  // Surge - reduced cost if you or teammate cast another spell this turn
  const surgeMatch = text.match(/surge\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (surgeMatch) {
    costs.push({
      id: 'surge',
      label: 'Surge',
      description: 'If you or teammate cast another spell this turn',
      manaCost: surgeMatch[1],
    });
  }
  
  // Spectacle - alternate cost if opponent lost life this turn
  const spectacleMatch = text.match(/spectacle\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (spectacleMatch) {
    costs.push({
      id: 'spectacle',
      label: 'Spectacle',
      description: 'If an opponent lost life this turn',
      manaCost: spectacleMatch[1],
    });
  }
  
  // Mutate - cast for mutate cost
  const mutateMatch = text.match(/mutate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (mutateMatch) {
    costs.push({
      id: 'mutate',
      label: 'Mutate',
      description: 'Merge with target creature',
      manaCost: mutateMatch[1],
    });
  }
  
  // Dash - cast for dash cost, gains haste, returns to hand at end of turn
  const dashMatch = text.match(/dash\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (dashMatch) {
    costs.push({
      id: 'dash',
      label: 'Dash',
      description: 'Gains haste, returns to hand at end of turn',
      manaCost: dashMatch[1],
    });
  }
  
  // Evoke - cast for evoke cost, then sacrifice
  const evokeMatch = text.match(/evoke\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (evokeMatch) {
    costs.push({
      id: 'evoke',
      label: 'Evoke',
      description: 'ETB triggers, then sacrifice',
      manaCost: evokeMatch[1],
      additionalCost: 'Sacrifice when it enters',
    });
  }
  
  // Madness - cast for madness cost when discarded
  const madnessMatch = text.match(/madness\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (madnessMatch) {
    costs.push({
      id: 'madness',
      label: 'Madness',
      description: 'When discarded, may cast for this cost',
      manaCost: madnessMatch[1],
    });
  }
  
  // Miracle - if first card drawn this turn
  const miracleMatch = text.match(/miracle\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (miracleMatch) {
    costs.push({
      id: 'miracle',
      label: 'Miracle',
      description: 'If first card drawn this turn',
      manaCost: miracleMatch[1],
    });
  }
  
  // Prowl - if dealt combat damage with creature of same type
  const prowlMatch = text.match(/prowl\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (prowlMatch) {
    costs.push({
      id: 'prowl',
      label: 'Prowl',
      description: 'If you dealt combat damage with creature of same type',
      manaCost: prowlMatch[1],
    });
  }
  
  // Bestow - cast as aura
  const bestowMatch = text.match(/bestow\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (bestowMatch) {
    costs.push({
      id: 'bestow',
      label: 'Bestow',
      description: 'Cast as an Aura enchanting a creature',
      manaCost: bestowMatch[1],
    });
  }
  
  // Emerge - sacrifice a creature and pay reduced cost
  const emergeMatch = text.match(/emerge\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (emergeMatch) {
    costs.push({
      id: 'emerge',
      label: 'Emerge',
      description: 'Sacrifice a creature, reduce cost by its mana value',
      manaCost: emergeMatch[1],
      additionalCost: 'Sacrifice a creature',
    });
  }
  
  // Blitz - cast for blitz cost (creatures)
  const blitzMatch = text.match(/blitz\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (blitzMatch) {
    costs.push({
      id: 'blitz',
      label: 'Blitz',
      description: 'Gains haste, "When this dies, draw a card", sacrifice at end of turn',
      manaCost: blitzMatch[1],
    });
  }

  const sneakMatch = text.match(/sneak\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (sneakMatch) {
    costs.push({
      id: 'sneak',
      label: 'Sneak',
      description: 'Declare blockers step: return an unblocked attacker to hand',
      manaCost: sneakMatch[1],
      additionalCost: 'Return an unblocked attacking creature to hand',
    });
  }

  const mayhemMatch = text.match(/mayhem\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (mayhemMatch) {
    costs.push({
      id: 'mayhem',
      label: 'Mayhem',
      description: 'Cast from your graveyard if you discarded it this turn',
      manaCost: mayhemMatch[1],
    });
  }

  const webSlingingMatch = text.match(/web-slinging\s*[—-]?\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (webSlingingMatch) {
    costs.push({
      id: 'web_slinging',
      label: 'Web-slinging',
      description: 'Return a tapped creature you control to its owner’s hand',
      manaCost: webSlingingMatch[1],
      additionalCost: 'Return a tapped creature you control to its owner’s hand',
    });
  }

  // Warp - cast from hand for warp cost (exile at next end step; may recast from exile)
  const warpMatch = text.match(/warp\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (warpMatch) {
    costs.push({
      id: 'warp',
      label: 'Warp',
      description: 'Cast for warp cost; exile at the beginning of the next end step',
      manaCost: warpMatch[1],
    });
  }

  // Self-WUBRG (Bringers): pay {W}{U}{B}{R}{G} instead of this spell's mana cost
  if (
    lowerText.includes('{w}{u}{b}{r}{g}')
    && lowerText.includes('rather than pay')
    && lowerText.includes('this spell')
  ) {
    costs.push({
      id: 'wubrg_self',
      label: 'WUBRG Cost',
      description: 'Pay {W}{U}{B}{R}{G} instead of mana cost',
      manaCost: '{W}{U}{B}{R}{G}',
    });
  }
  
  // Prototype (smaller stats, cheaper cost) - Phyrexian construct cards
  const prototypeMatch = text.match(/prototype\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)\s*[-—]\s*(\d+)\/(\d+)/i);
  if (prototypeMatch) {
    costs.push({
      id: 'prototype',
      label: 'Prototype',
      description: `Cast as ${prototypeMatch[2]}/${prototypeMatch[3]}`,
      manaCost: prototypeMatch[1],
    });
  }
  
  // Disturb - cast transformed from graveyard
  const disturbMatch = text.match(/disturb\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (disturbMatch) {
    costs.push({
      id: 'disturb',
      label: 'Disturb',
      description: 'Cast transformed from graveyard',
      manaCost: disturbMatch[1],
    });
  }
  
  // Kicker - optional additional cost
  const kickerMatch = text.match(/kicker\s*(\{[^}]+\}(?:\s*(?:and\/or|or)\s*\{[^}]+\})*)/i);
  if (kickerMatch) {
    // Calculate kicked cost (normal + kicker)
    const kickerCost = kickerMatch[1];
    costs.push({
      id: 'kicker',
      label: 'With Kicker',
      description: 'Pay additional kicker cost for enhanced effect',
      manaCost: cardManaCost + kickerCost,
      additionalCost: `Kicker: ${kickerCost}`,
    });
  }
  
  // Multikicker - can be paid multiple times
  const multikickerMatch = text.match(/multikicker\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (multikickerMatch) {
    costs.push({
      id: 'multikicker',
      label: 'With Multikicker',
      description: 'Pay any number of times for enhanced effect',
      manaCost: cardManaCost, // Base cost, multikicker added separately
      additionalCost: `Multikicker: ${multikickerMatch[1]} (pay any number of times)`,
    });
  }
  
  // Buyback - return to hand instead of graveyard
  const buybackMatch = text.match(/buyback\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (buybackMatch) {
    costs.push({
      id: 'buyback',
      label: 'With Buyback',
      description: 'Return to hand instead of graveyard',
      manaCost: cardManaCost + buybackMatch[1],
      additionalCost: `Buyback: ${buybackMatch[1]}`,
    });
  }
  
  // Entwine - choose both modes
  const entwineMatch = text.match(/entwine\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (entwineMatch) {
    costs.push({
      id: 'entwine',
      label: 'With Entwine',
      description: 'Choose all modes instead of one',
      manaCost: cardManaCost + entwineMatch[1],
      additionalCost: `Entwine: ${entwineMatch[1]}`,
    });
  }
  
  // Replicate - copy spell
  const replicateMatch = text.match(/replicate\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (replicateMatch) {
    costs.push({
      id: 'replicate',
      label: 'With Replicate',
      description: 'Pay to copy the spell',
      manaCost: cardManaCost, // Base cost, replicate added separately
      additionalCost: `Replicate: ${replicateMatch[1]} (pay any number of times)`,
    });
  }
  
  // Echo - pay again on next upkeep or sacrifice
  const echoMatch = text.match(/echo\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (echoMatch) {
    // Echo isn't an alternate casting cost, but we note it for awareness
    // The echo cost is paid on the next upkeep, not when casting
    costs[0].additionalCost = `Echo: ${echoMatch[1]} (pay on your next upkeep or sacrifice)`;
  }

  // Foretell - exile face down, cast later for foretell cost
  const foretellMatch = text.match(/foretell\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (foretellMatch) {
    costs.push({
      id: 'foretell',
      label: 'Foretell',
      description: 'Cast from exile after foretelling',
      manaCost: foretellMatch[1],
    });
  }
  
  // Suspend - exile with time counters, cast for free when last counter removed
  if (lowerText.includes('suspend')) {
    const suspendMatch = text.match(/suspend\s+(\d+)[—\-]\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (suspendMatch) {
      costs.push({
        id: 'suspend',
        label: 'Suspend',
        description: `Exile with ${suspendMatch[1]} time counters, cast free when removed`,
        manaCost: suspendMatch[2],
        additionalCost: `Wait ${suspendMatch[1]} turns`,
      });
    }
  }
  
  // Craft - exile from battlefield with other materials
  const craftMatch = text.match(/craft with\s+([^{]+)\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (craftMatch) {
    costs.push({
      id: 'craft',
      label: 'Craft',
      description: `Transform by exiling with ${craftMatch[1].trim()}`,
      manaCost: craftMatch[2],
      additionalCost: `Exile ${craftMatch[1].trim()}`,
    });
  }
  
  // Cleave - remove bracketed text for alternate cost
  const cleaveMatch = text.match(/cleave\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (cleaveMatch) {
    costs.push({
      id: 'cleave',
      label: 'Cleave',
      description: 'Cast without bracketed text',
      manaCost: cleaveMatch[1],
    });
  }
  
  // Casualty - sacrifice creature with power N or greater
  const casualtyMatch = text.match(/casualty\s+(\d+)/i);
  if (casualtyMatch) {
    costs[0].additionalCost = (costs[0].additionalCost ? costs[0].additionalCost + '; ' : '') +
      `Casualty ${casualtyMatch[1]}: Sacrifice a creature with power ${casualtyMatch[1]}+ to copy`;
  }
  
  // Offering - sacrifice creature of type, reduce cost by its mana value
  const offeringMatch = text.match(/(\w+)\s+offering/i);
  if (offeringMatch) {
    costs.push({
      id: 'offering',
      label: `${offeringMatch[1]} Offering`,
      description: `Sacrifice a ${offeringMatch[1]}, reduce cost by its mana value`,
      manaCost: cardManaCost, // Reduced by sacrificed creature's MV
      additionalCost: `Sacrifice a ${offeringMatch[1]}`,
    });
  }
  
  // Ninjutsu - return attacking unblocked creature
  const ninjutsuMatch = text.match(/ninjutsu\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (ninjutsuMatch) {
    costs.push({
      id: 'ninjutsu',
      label: 'Ninjutsu',
      description: 'Return unblocked attacker to hand, put this onto battlefield attacking',
      manaCost: ninjutsuMatch[1],
      additionalCost: 'Return an unblocked attacking creature you control to hand',
    });
  }
  
  // Commander Ninjutsu
  const cmdNinjutsuMatch = text.match(/commander ninjutsu\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
  if (cmdNinjutsuMatch) {
    costs.push({
      id: 'commander-ninjutsu',
      label: 'Commander Ninjutsu',
      description: 'Return unblocked attacker, put commander onto battlefield attacking',
      manaCost: cmdNinjutsuMatch[1],
      additionalCost: 'Return an unblocked attacking creature you control to hand',
    });
  }
  
  // "You may pay X rather than pay this spell's mana cost" or similar
  const altCostMatch = text.match(/you may (?:pay\s+)?(\{[^}]+\}(?:\s*\{[^}]+\})*)\s+rather than pay/i);
  if (altCostMatch) {
    costs.push({
      id: 'alternate',
      label: 'Alternate Cost',
      description: 'Pay this instead of normal cost',
      manaCost: altCostMatch[1],
    });
  }
  
  // "You may cast ~ without paying its mana cost" (free cast)
  if (lowerText.includes('without paying its mana cost') || lowerText.includes('without paying the mana cost')) {
    const isCommanderFree =
      lowerText.includes('if you control') && lowerText.includes('commander');
    costs.push({
      id: 'free',
      label: 'Free Cast',
      description: isCommanderFree
        ? 'Cast for free (you control a commander)'
        : 'Cast without paying mana cost',
      manaCost: '{0}',
    });
  }

  // Force of Will / Force of Negation style alternate cost
  // Note: legality (blue card available, not-your-turn restriction, life payment) is validated server-side.
  const isForceOfWill = lowerName.includes('force of will');
  const isForceOfNegation = lowerName.includes('force of negation');
  const hasForceStyleText =
    (lowerText.includes('exile') && lowerText.includes('blue card') && lowerText.includes('from your hand') && lowerText.includes("rather than pay this spell's mana cost")) ||
    isForceOfWill ||
    isForceOfNegation;

  if (hasForceStyleText) {
    const requiresLife = isForceOfWill || (lowerText.includes('pay') && lowerText.includes('1 life'));
    costs.push({
      id: 'force_of_will',
      label: isForceOfNegation ? 'Force of Negation (Alternate Cost)' : isForceOfWill ? 'Force of Will (Alternate Cost)' : 'Alternate Cost (Exile Blue Card)',
      description: requiresLife
        ? 'Exile a blue card from your hand and pay 1 life.'
        : 'Exile a blue card from your hand.',
      manaCost: '{0}',
      additionalCost: requiresLife ? 'Exile a blue card; pay 1 life' : 'Exile a blue card',
    });
  }
  
  return costs;
}

