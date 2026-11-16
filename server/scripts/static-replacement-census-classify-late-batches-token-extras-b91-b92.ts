/**
 * Named-token extra classifiers (mutagen / frog) plus B91–B92 census entries
 * that live at the front of LATE_BATCH_OTHER_SYSTEMS_B80_B90. Kept in this
 * barrel (not the later B91–B93 module) so first-match order is unchanged.
 * Lines are lowercased with the card name replaced by "~" before matching.
 */
export const LATE_BATCH_OTHER_SYSTEMS_TOKEN_EXTRAS_B91_B92: Array<[string, RegExp]> = [
  ['tokens plus a mutagen token (replacementEffectSpecTokenOracleTemplates)', /^if one or more tokens would be created under your control, those tokens plus a mutagen token are created instead\.?$/i],
  ['tokens plus a frog creature token (replacementEffectSpecTokenOracleTemplates)', /^if one or more tokens would be created under your control, those tokens plus a 1\/1 green frog creature token are created instead\.?$/i],
  // B92 entries: families implemented or verified in batch 92.
  ['draw reveal creature to graveyard else draw (replacementBatch92)', /^if you would draw a card, reveal the top card of your library instead(?:\. if it's a creature card, put it into your graveyard\. otherwise, draw a card)?\.?$/i],
  ['empty library return creature or lose (replacementBatch92)', /^if you would draw a card while your library has no cards in it, instead return a creature card from your graveyard to the battlefield(?:\. if you can't, you lose the game)?\.?$/i],
  ['prevent shared color creature damage (replacementBatch92)', /^prevent all damage that would be dealt to a creature by another creature if they share a color\.?$/i],
  ['modular triggered p1p1 plus n (replacementBatch92)', /^if a(?:n? modular )?triggered ability would put one or more \+1\/\+1 counters on a creature you control, that many plus (?:one|two|three|four|five|\d+) \+1\/\+1 counters are put on it instead\.?$/i],
  ['self die return hand instead (replacementBatch92)', /^if (?:this creature|~) would die, return it to its owner's hand instead(?:\. until that player's next turn, that player plays with that card revealed in their hand and can't play it)?\.?$/i],
  ['damaged by controller source die exile (replacementBatch92)', /^if a creature dealt damage this turn by a source you controlled would die, exile it instead\.?$/i],
  ['exhaust reuse during your turn (batch92LongTailStatics)', /^during your turn, as long as you haven't activated an exhaust ability this turn, you may activate exhaust abilities as though they haven't been activated\.?$/i],
  ['self conditional quoted ability (batch92LongTailStatics)', /^as long as .+ is enchanted, equipped, and has a counter on it, .+ has "[^"]+"\.?$/i],
  ['each creature quoted ability (batch92LongTailStatics)', /^each creature has "[^"]+"\.?$/i],
  ['attached cant be attacked and quoted ability (batch92LongTailStatics)', /^as long as .+ is attached to a creature, .+ can't be attacked and has "[^"]+"\.?$/i],
  ['attacks most life unless named (batch92LongTailStatics)', /^.+ attacks an opponent with the most life among your opponents each combat if able unless you control an? creatures? named .+\.?$/i],
  ['spend only creature produced mana (batch92LongTailStatics)', /^spend only mana produced by creatures to cast this spell\.?$/i],
  ['commander deck any land cards (batch92DeckConstruction)', /^(?:rulebreaker\s*[—–-]\s*)?a deck with this commander can have any land cards\.?$/i],
  ['commander deck creatures mv any identity (batch92DeckConstruction)', /^(?:rulebreaker\s*[—–-]\s*)?a deck with this commander can have creature cards with mana value \d+ or greater of any color identity(?: and any basic land cards)?\.?$/i],
  ['assemble contraption times n (replacementBatch92)', /^if an? [a-z]+ you control would assemble an? [a-z]+, it assembles (?:two|three|four|twice|\d+) [a-z]+s? instead\.?$/i],
  ['serum powder mulligan action (batch92SerumPowder)', /^any time you could mulligan and this card is in your hand, you may exile all the cards from your hand, then draw that many cards(?:\..*)?$/i],
  ['play with hand revealed (batch92LongTailStatics)', /^play with your hand revealed\.?$/i],
  // B91 entries: families implemented or verified in batch 91.
  ['proliferate twice/n times (replacementBatch91)', /^if you would proliferate, proliferate (?:twice|two times|three times|four times|\d+ times) instead\.?$/i],
  ['draw look-at-top put one (replacementBatch91)', /^if you would draw a card, look at the top (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of your library instead(?:\. put one of those cards into your hand and the rest on the bottom of your library in any order)?\.?$/i],
  ['first extra draw becomes n (replacementBatch91)', /^the first time you would draw a card each turn except the first card you draw during each of your draw steps, you draw (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards instead\.?$/i],
  ['lose-game exile source reset life (replacementBatch91)', /^if you would lose the game, instead exile (?:this creature|~) and your life total becomes equal to your starting life total\.?$/i],
  ['prevent x damage to player equal to clerics (replacementBatch91)', /^if a source would deal damage to a player, you may prevent x of that damage, where x is the number of clerics you control\.?$/i],
  ['prevent combat damage to self exile library (replacementBatch91)', /^if combat damage would be dealt to (?:this creature|~), prevent that damage and exile that many cards from the top of your library\.?$/i],
  ['scry plus n (replacementBatch91)', /^if you would scry a number of cards, scry that many cards plus (?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) instead\.?$/i],
  ['opponent creature die exile power counters (replacementBatch91)', /^if a creature an opponent controls would die, instead exile it and put a number of \+1\/\+1 counters equal to that creature's power on (?:this creature|~)\.?$/i],
  ['creature spells mv has blitz (batch91LongTailStatics)', /^each creature spell you cast with mana value (?:\d+|[a-z]+) or greater has blitz(?:\. the blitz cost is equal to its mana cost)?\.?$/i],
  ['blitz cost commander-cast discount (batch91LongTailStatics)', /^blitz costs you pay cost \{1\} less for each time you've cast your commander from the command zone this game\.?$/i],
  ['any-token identity substitution (replacementBatch91)', /^if (?:one or more|\d+ or more) tokens would be created under your control, (?:that many|those tokens are) \d+\s*\/\s*\d+ .+ tokens?(?: with .+)?(?: are created)? instead\.?$/i],
  ['named token identity substitution (replacementBatch91)', /^if you would create an? [a-z][a-z'-]* tokens?, create an? \d+\s*\/\s*\d+ .+ tokens?(?: with .+)? instead\.?$/i],
];
