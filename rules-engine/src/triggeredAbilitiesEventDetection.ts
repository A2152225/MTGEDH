export function detectTriggeredAbilityEvent<T extends string>(
  condition: string,
  triggerEventValues: Record<string, T>
): { event: T; filter?: string } {
  const text = condition.toLowerCase().replace(/\s+/g, ' ').trim();
  const putIntoGraveyardFromBattlefield =
    /\bis put into (?:(?:a|an|your|its owner's|their owner's)\s+)?graveyard from the battlefield\b/i.test(text);
  const putIntoGraveyardFromAnywhere =
    /\b(?:is|are) put into (?:(?:a|an|your|their|an opponent's|a player's)\s+)?graveyard from anywhere\b/i.test(text);
  const isDiesStyleTrigger =
    text.includes('dies') ||
    /\bdie\b/i.test(text) ||
    putIntoGraveyardFromBattlefield ||
    putIntoGraveyardFromAnywhere;

  if (
    /\bspell\b.*\b(?:is|was)\s+countered\b/.test(text) ||
    /\b(?:is|was)\s+countered\b.*\bspell\b/.test(text) ||
    /\bcounters a spell\b/.test(text) ||
    /\byou counter a spell\b/.test(text)
  ) {
    return { event: triggerEventValues.SPELL_COUNTERED, filter: text };
  }

  if (
    text.includes('second main phase') ||
    text.includes('postcombat main phase') ||
    text.includes('post-combat main phase')
  ) {
    return { event: triggerEventValues.BEGINNING_OF_POSTCOMBAT_MAIN, filter: text };
  }

  if (
    /\bthe beginning of your next(?: first)? main phase\b/.test(text) ||
    /\bthe beginning of the next main phase\b/.test(text)
  ) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (
    /\b(?:the )?first noncreature spell of a turn is cast\b/.test(text) ||
    /\b(?:the )?first spell of a turn is cast\b/.test(text)
  ) {
    return { event: triggerEventValues.NONCREATURE_SPELL_CAST, filter: text };
  }

  if (
    /\b(?:you|an opponent|opponent|a player|each opponent|enchanted player|the chosen player)\s+casts?\b/.test(text) ||
    /\byou next cast\b/.test(text) ||
    /\bcast(?:s)?\s+(?:their\s+first\s+)?(?:a\s+)?(?:noncreature\s+spell|creature\s+spell|instant or sorcery spell|spell)\b/.test(text) ||
    /\bcast(?:s)?\s+a\s+spell\s+with\s+the\s+chosen\s+name\b/.test(text) ||
    /\byou\s+cast\s+(?:a\s+)?(?:blue|green|red|white|black|cat|dog|kraken|pegasus|aura|lesson)\b/.test(text) ||
    /\bwhen you cast\b/.test(text)
  ) {
    if (text.includes('noncreature spell')) {
      return { event: triggerEventValues.NONCREATURE_SPELL_CAST, filter: text };
    }
    if (text.includes('creature spell')) {
      return { event: triggerEventValues.CREATURE_SPELL_CAST, filter: text };
    }
    if (text.includes('instant or sorcery spell') || /\binstant, sorcery\b/.test(text)) {
      return { event: triggerEventValues.INSTANT_OR_SORCERY_CAST, filter: text };
    }
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/\benters(?:\s+the\s+battlefield)?\s+or\s+attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^enchanted (?:forest|land) is tapped for mana\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^this vehicle becomes crewed\b/.test(text) || /^whenever this vehicle becomes crewed\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^this creature becomes saddled for the first time\b/.test(text) || /^whenever this creature becomes saddled\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^whenever a creature stations this spacecraft\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you attack\b/.test(text) || /^whenever you attack\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^you draw your second card each turn\b/.test(text)) {
    return { event: triggerEventValues.DRAWN, filter: text };
  }

  if (/^you cast your second spell each turn\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^you planeswalk here\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^the ring tempts you\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (
    text.includes('put onto the battlefield') ||
    text.includes('put into the battlefield')
  ) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (
    text.includes('enters the battlefield') ||
    text.includes('enters') ||
    text.includes('comes into play') ||
    /\b(?:one or more|another)\s+[\w\s]*\s+you control\s+enter\b/.test(text) ||
    /\bthis permanent\s+enter\b/.test(text)
  ) {
    if (text.includes('a land') || text.includes('land you control') || /\bforest you control enters\b/i.test(text)) {
      return { event: triggerEventValues.LANDFALL, filter: text };
    }
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
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
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/\bdeal(?:s)?\s+combat\s+damage\b/.test(text)) {
    if (text.includes('to a player') || text.includes('to an opponent')) {
      return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
    }
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE, filter: text };
  }

  if (/\battacks?\b/.test(text)) {
    if (/\battacks?\s+alone\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS_ALONE, filter: text };
    }
    if (/^this creature attacks or blocks\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS, filter: text };
    }
    if (/^a creature an opponent controls attacks\b/.test(text)) {
      return { event: triggerEventValues.ATTACKS, filter: text };
    }
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^this creature attacks or blocks\b/.test(text)) {
    return { event: triggerEventValues.BLOCKS, filter: text };
  }

  if (text.includes('blocks')) {
    return { event: triggerEventValues.BLOCKS, filter: text };
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

  if (/\bdeals?\s+(?:noncombat\s+)?damage\b/.test(text)) {
    return { event: triggerEventValues.DEALS_DAMAGE, filter: text };
  }

  if (/\bis dealt combat damage\b/.test(text)) {
    return { event: triggerEventValues.DEALT_COMBAT_DAMAGE, filter: text };
  }

  if (text.includes('beginning of each of your upkeeps') || text.includes('each of your upkeeps')) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: 'your' };
  }

  if (
    text.includes('beginning of your next upkeep') ||
    text.includes('beginning of your upkeep') ||
    /\byour upkeep\b/.test(text)
  ) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: text };
  }

  if (text.includes('beginning of each upkeep') || text.includes('each upkeep') || text.includes("each player's upkeep")) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: 'each' };
  }

  if (text.includes('upkeep')) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: text };
  }

  if (text.includes('beginning of combat on your turn') || text.includes('combat on your turn')) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: 'your' };
  }

  if (text.includes('beginning of each combat') || text.includes('each combat')) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: 'each' };
  }

  if (
    text.includes('beginning of the next combat phase') ||
    text.includes('next combat phase this turn')
  ) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: text };
  }

  if (text.includes('beginning of combat') || text === 'combat') {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT };
  }

  if (text.includes('beginning of your end step') || text.includes('your end step')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP, filter: text };
  }

  if (text.includes('beginning of each end step') || text.includes('each end step')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP, filter: text };
  }

  if (text.includes('end step') || text.includes('end of turn')) {
    return { event: triggerEventValues.BEGINNING_OF_END_STEP, filter: text };
  }

  if (text.includes('end of combat')) {
    return { event: triggerEventValues.END_OF_COMBAT };
  }

  if (
    /\bdraws? (?:their )?(?:second |a )?cards?\b/.test(text) ||
    text.includes('draws a card') ||
    text.includes('draw a card')
  ) {
    return { event: triggerEventValues.DRAWN, filter: text };
  }

  if (/\b(?:that creature|this creature|~|[\w ,']+?) is dealt damage\b/.test(text)) {
    return { event: triggerEventValues.DEALT_DAMAGE, filter: text };
  }

  if (
    /\bdiscards?\b/.test(text) ||
    /\bdiscard(?:s|ed)?\s+(?:a|one|two|three|\d+)\s+card/.test(text)
  ) {
    return { event: triggerEventValues.DISCARDED, filter: text };
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
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^another permanent leaves(?: the battlefield)?\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (text.includes('returned to') && text.includes('hand')) {
    return { event: triggerEventValues.RETURNED_TO_HAND };
  }

  if (text.includes('enters')) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/\b(?:you|opponent|player)\s+casts?\b/.test(text) || /\bcasts?\s+(?:a|an)\s+spell\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  // Delayed "When you do" riders (exert, attack costs, sacrifice choices, etc.)
  if (text === 'you do') {
    return { event: triggerEventValues.ATTACKS, filter: 'when_you_do' };
  }

  if (/\bregenerates?\s+this\s+way\b/.test(text)) {
    return { event: triggerEventValues.REGENERATED, filter: text };
  }

  if (/\b(?:is )?turned face up\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^the beginning of (?:your |each player's )?draw step\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_DRAW_STEP, filter: text };
  }

  if (/^the beginning of (?:your )?first main phase\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (/^the beginning of (?:your )?combat step\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: text };
  }

  if (/^you draw your (?:second|third|fourth) card (?:each turn|in a turn)\b/.test(text)) {
    return { event: triggerEventValues.DRAWN, filter: text };
  }

  if (/^you cycle(?:d)? (?:this card|a card)\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: 'you_cycle_this_card' };
  }

  if (/^this creature exploits a creature\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: 'exploit' };
  }

  if (/^you commit a crime\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: 'commit_a_crime' };
  }

  if (/^one or more \+1\/\+1 counters are put on this creature\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (
    /^one or more cards leave your graveyard\b/.test(text) ||
    /^one or more creature cards leave your graveyard\b/.test(text)
  ) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (text === 'you scry') {
    return { event: triggerEventValues.SCRIED, filter: text };
  }

  if (text === 'you surveil') {
    return { event: triggerEventValues.SURVEIL, filter: text };
  }

  if (text === 'chaos ensues') {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: 'chaos_ensues' };
  }

  if (/^you set this scheme in motion\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^this creature specializes\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^day becomes night or night becomes day\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^a player casts a (black|blue|green|red|white) spell\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^a player casts an instant or sorcery spell\b/.test(text)) {
    return { event: triggerEventValues.INSTANT_OR_SORCERY_CAST, filter: text };
  }

  if (/^a player casts their second spell each turn\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^a player cycles a card\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: 'player_cycles_a_card' };
  }

  if (/^one or more tokens you control enter\b/.test(text)) {
    return { event: triggerEventValues.TOKEN_CREATED, filter: text };
  }

  if (/^you proliferate\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^you exert a creature\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^the ring tempts you\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you planeswalk here\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you crank this contraption\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you unlock this door\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^this class becomes level \d+\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^enchanted land is tapped for mana\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^the beginning of each player's first main phase\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (/^one or more \+1\/\+1 counters are put on a creature you control\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^this card specializes from\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^you expend \d+\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you tap a land for mana\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^you're dealt damage\b/.test(text)) {
    return { event: triggerEventValues.DEALT_DAMAGE, filter: text };
  }

  if (/^you roll one or more dice\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you win a coin flip\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you pay this cost one or more times\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^you cycle another card\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: 'you_cycle_a_card' };
  }

  if (/^they do\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: 'when_you_do' };
  }

  if (/^this creature transforms into this permanent\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^this permanent is put into a graveyard from anywhere\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^you encounter this (?:permanent|phenomenon)\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you planeswalk (?:to|away from) this permanent\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^the beginning of the horde's first main phase\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (/^enchanted player is attacked\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^the fourth plan counter is put on this enchantment\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^a creature is put into an opponent's graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^a card is put into an opponent's graveyard from anywhere\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^a creature you control explores\b/.test(text)) {
    return { event: triggerEventValues.EXPLORED, filter: text };
  }

  if (/^one or more artifacts you control enter\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^one or more land cards are put into your graveyard from anywhere\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^this equipment becomes unattached from a permanent\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you complete a dungeon\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^this permanent comes into play\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^you activate an exhaust ability\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^this equipment becomes attached to a creature\b/.test(text)) {
    return { event: triggerEventValues.EQUIPPED, filter: text };
  }

  if (/^the beginning of that combat\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: text };
  }

  if (/^you activate an ability that isn't a mana ability\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^one or more other creatures you control enter\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^you put one or more (?:\+1\/\+1|-1\/-1) counters on a creature(?: you control)?\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^you tap an untapped creature an opponent controls\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^an opponent searches their library\b/.test(text)) {
    return { event: triggerEventValues.SEARCHED_LIBRARY, filter: text };
  }

  if (/^a land card is put into your graveyard from anywhere\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^one or more nonland cards are milled\b/.test(text)) {
    return { event: triggerEventValues.MILLED, filter: text };
  }

  if (/^a player loses the game\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^this creature phases in\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^you control no islands\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: text };
  }

  if (/^there are no creatures on the battlefield\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^one or more creature cards are put into your graveyard from your library\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^this creature crews a vehicle\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^enchanted artifact is put into a graveyard\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^(?:an opponent|a player) plays a land\b/.test(text)) {
    return { event: triggerEventValues.LANDFALL, filter: text };
  }

  if (/^you play a card(?: from exile)?\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^you play a card this way\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^a player casts an instant or sorcery card\b/.test(text)) {
    return { event: triggerEventValues.INSTANT_OR_SORCERY_CAST, filter: text };
  }

  if (/^players finish voting\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^the beginning of the game\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you roll a 6\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you become the monarch\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you clash\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you discover\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^you tap a creature for mana\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^you encounter this\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^an opponent activates an ability of an artifact\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^an ability of equipped creature is activated\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^you activate a loyalty ability of (?:a chandra planeswalker|enchanted planeswalker)\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^enchanted creature becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^enchanted land becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^enchanted creature becomes blocked\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_BLOCKED, filter: text };
  }

  if (/^a creature attacks or blocks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^a permanent is turned face up\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^a renowned creature you control deals combat damage to a player\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
  }

  if (/^a creature you control deals combat damage to a player\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
  }

  if (/^an artifact is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^enchanted creature is dealt damage\b/.test(text)) {
    return { event: triggerEventValues.DEALT_DAMAGE, filter: text };
  }

  if (/^excess damage is dealt\b/.test(text)) {
    return { event: triggerEventValues.DEALT_DAMAGE, filter: text };
  }

  if (/^another [\w]+ creature you control dies\b/.test(text)) {
    return { event: triggerEventValues.CONTROLLED_CREATURE_DIED, filter: text };
  }

  if (/^you crank this contraption\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^(?:equipped|enchanted) creature transforms\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^the chosen creature leaves(?: the battlefield)?\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^that (?:creature|permanent|land) attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^a player attacks with\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^that land becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^that creature dies\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^this aura is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^this creature transforms into\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^you reveal a (?:land|nonland) card this way\b/.test(text)) {
    return { event: triggerEventValues.DRAWN, filter: text };
  }

  if (/^this creature or another creature you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^this creature or another ally you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^this enchantment or another enchantment you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^this siege enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^another creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^one or more cards leave your graveyard\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^when you reveal a creature card this way\b/.test(text)) {
    return { event: triggerEventValues.DRAWN, filter: text };
  }

  if (/^when damage is prevented this way\b/.test(text)) {
    return { event: triggerEventValues.DEALS_DAMAGE, filter: text };
  }

  if (/^one or more creature cards are put into graveyards from anywhere\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^when there are (?:\w+|\d+) or more\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^the beginning of each of your draw steps\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_DRAW_STEP, filter: text };
  }

  if (/^this creature or another enchantment you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^a modified creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^an enchanted creature you control deals combat damage to a player\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
  }

  if (/^enchanted creature blocks\b/.test(text)) {
    return { event: triggerEventValues.BLOCKS, filter: text };
  }

  if (/^a creature blocks\b/.test(text)) {
    return { event: triggerEventValues.BLOCKS, filter: text };
  }

  if (/^you next activate an exhaust ability\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^you put one or more (?:\+1\/\+1|-1\/-1) counters on\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^this creature has flying\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^an enchanted creature dies\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_UPKEEP, filter: text };
  }

  if (/^a nontoken creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^a creature becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^enchanted artifact becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^equipped creature becomes blocked\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_BLOCKED, filter: text };
  }

  if (/^another artifact or creature is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^a legendary creature an opponent controls dies\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^the creature dies this turn\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^this creature or another artifact you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^a creature deals combat damage to a player\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
  }

  if (/^target creature deals damage\b/.test(text)) {
    return { event: triggerEventValues.DEALS_DAMAGE, filter: text };
  }

  if (/^a white creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^an enchantment you control is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^another artifact or creature you control is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^an enchantment is put into a graveyard from the battlefield\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^this enchantment or another nontoken enchantment you control enters\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^fortified land becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^enchanted permanent becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^equipped creature blocks or becomes blocked by a creature\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_BLOCKED, filter: text };
  }

  if (/^this creature becomes blocked\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_BLOCKED, filter: text };
  }

  if (/^that creature becomes blocked this turn\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_BLOCKED, filter: text };
  }

  if (/^you sacrifice this enchantment\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: text };
  }

  if (/^they rate the art\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^enchanted land becomes tapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^a creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^an equipped creature you control attacks\b/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: text };
  }

  if (/^this land deals combat damage to a creature\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE, filter: text };
  }

  if (/^target creature dies this turn\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^the beginning of the next combat phase\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_COMBAT, filter: text };
  }

  if (/^a creature is put onto the battlefield this way\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^an attacking creature dies\b/.test(text)) {
    return { event: triggerEventValues.DIES, filter: text };
  }

  if (/^that creature leaves(?: the battlefield)?\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^equipped creature becomes untapped\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_UNTAPPED, filter: text };
  }

  if (/^a creature becomes the target of\b/.test(text)) {
    return { event: triggerEventValues.TARGETED, filter: text };
  }

  if (/^an artifact creature you control deals combat damage to a player\b/.test(text)) {
    return { event: triggerEventValues.DEALS_COMBAT_DAMAGE_TO_PLAYER, filter: text };
  }

  if (/^you do,/.test(text)) {
    return { event: triggerEventValues.ATTACKS, filter: 'when_you_do' };
  }

  if (/^when you lose control of that equipment\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^whenever a land card is put into your graveyard from your library\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^whenever one or more creatures you control and\/or creature cards in your graveyard are put into exile\b/.test(text)) {
    return { event: triggerEventValues.EXILED, filter: text };
  }

  if (/^whenever a non-black creature is put into any graveyard from play\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^at the beginning of each of your main phases\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_PRECOMBAT_MAIN, filter: text };
  }

  if (/^whenever a forest is tapped for mana\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_TAPPED, filter: text };
  }

  if (/^whenever you untap one or more permanents during your untap step\b/.test(text)) {
    return { event: triggerEventValues.BECOMES_UNTAPPED, filter: text };
  }

  if (/^whenever one or more other creatures you control leave the battlefield\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^whenever one or more cards are put into exile from your hand\b/.test(text)) {
    return { event: triggerEventValues.EXILED, filter: text };
  }

  if (/^whenever you activate a ninjutsu ability\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^whenever you activate an ability of an artifact or creature that isn't a mana ability\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^whenever a creature or planeswalker an opponent controls is dealt excess(?: noncombat)? damage\b/.test(text)) {
    return { event: triggerEventValues.DEALT_DAMAGE, filter: text };
  }

  if (/^when enchanted land is put into a graveyard\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^whenever one or more loyalty counters are put on planeswalkers you control\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^whenever one or more \+1\/\+1 counters are put on another creature you control\b/.test(text)) {
    return { event: triggerEventValues.COUNTER_PLACED, filter: text };
  }

  if (/^when this creature's power is \d+ or greater\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: text };
  }

  if (/^whenever a permanent you control is put into a graveyard\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^when this card is put into your hand from your graveyard\b/.test(text)) {
    return { event: triggerEventValues.PUT_INTO_GRAVEYARD, filter: text };
  }

  if (/^at the beginning of the draw step of enchanted creature's controller\b/.test(text)) {
    return { event: triggerEventValues.BEGINNING_OF_DRAW, filter: text };
  }

  if (/^when you control a dwarf\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: text };
  }

  if (/^when an opponent controls a creature with power \d+ or greater\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^when a player other than this creature's owner controls it\b/.test(text)) {
    return { event: triggerEventValues.TARGETED, filter: text };
  }

  if (/^whenever you activate an ability of a [\w]+ planeswalker\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_ACTIVATED, filter: text };
  }

  if (/^whenever one or more creatures you control become the target of an activated ability\b/.test(text)) {
    return { event: triggerEventValues.TARGETED, filter: text };
  }

  if (/^whenever you pay an additional cost while casting a spell\b/.test(text)) {
    return { event: triggerEventValues.SPELL_CAST, filter: text };
  }

  if (/^whenever one or more cards an opponent owns are put into exile\b/.test(text)) {
    return { event: triggerEventValues.EXILED, filter: text };
  }

  if (/^whenever a permanent you control transforms into a non-human creature\b/.test(text)) {
    return { event: triggerEventValues.TRANSFORMED, filter: text };
  }

  if (/^whenever you attach a role to\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^whenever a creature stations this spacecraft\b/.test(text)) {
    return { event: triggerEventValues.ABILITY_TRIGGERED, filter: text };
  }

  if (/^whenever a creature you control is devoured\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: text };
  }

  if (/^whenever trial and error is countered or fizzles\b/.test(text)) {
    return { event: triggerEventValues.SPELL_COUNTERED, filter: text };
  }

  if (/^when the chosen finger isn't touching this creature\b/.test(text)) {
    return { event: triggerEventValues.SACRIFICED, filter: text };
  }

  if (/^when this aura falls off the chosen hand\b/.test(text)) {
    return { event: triggerEventValues.LEAVES_BATTLEFIELD, filter: text };
  }

  if (/^when mikey & mona enter\b/.test(text)) {
    return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: text };
  }

  if (/^enchanted creature attacks or blocks\b/.test(text)) {
    return { event: triggerEventValues.BLOCKS, filter: text };
  }

  return { event: triggerEventValues.ENTERS_BATTLEFIELD, filter: 'unknown_trigger_pattern' };
}
