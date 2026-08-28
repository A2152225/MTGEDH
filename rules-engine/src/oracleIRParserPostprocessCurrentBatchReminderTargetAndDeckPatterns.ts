// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: the final slice of isCurrentBatchReminderOrPlatformOnlyText's pattern disjunction -
// target and until-your-next-turn tails, background and bestow choices, copy caveats and
// deck-limit notes.
//
// The operands are byte-identical to the original chain and keep their order; the trailing `false`
// only terminates the disjunction, which cannot change a boolean result.

export function isCurrentBatchReminderTargetOrDeckPattern(normalizedText: string): boolean {
  return (
    /^destroy this creature and target creature it'?s blocking\.?$/i.test(normalizedText) ||
    /^attach this aura to target creature other than enchanted creature\.?$/i.test(normalizedText) ||
    /^return all exiled cards with aegis counters on them to the battlefield under their owners'? control\.?$/i.test(normalizedText) ||
    /^iii\s*[-�]\s*exile a creature with the greatest power among creatures target opponent controls\.?$/i.test(normalizedText) ||
    /^exile all but the bottom card of target player'?s library\.?$/i.test(normalizedText) ||
    /^ii\s*[-�]\s*return target sorcery card from your graveyard to your hand\.?$/i.test(normalizedText) ||
    /^destroy it at the beginning of the next end step if it didn'?t attack this turn\.?$/i.test(normalizedText) ||
    /^an opponent separates those cards into two piles\b.+/i.test(normalizedText) ||
    /^an opponent chooses (?:one of those piles|two of those cards)\b.+/i.test(normalizedText) ||
    /^you may discard a card\. when you do, target creature can'?t block this turn\.?$/i.test(normalizedText) ||
    /^return all islands to their owners'? hands?\.?$/i.test(normalizedText) ||
    /^two target creatures you control that share a creature type can'?t be blocked this turn\.?$/i.test(normalizedText) ||
    /^target permanent'?s controller sacrifices it\b.+/i.test(normalizedText) ||
    /^you may choose not to untap .+ during your untap step\.?$/i.test(normalizedText) ||
    /^move a \+1\/\+1 counter from target creature onto a second target creature\.?$/i.test(normalizedText) ||
    /^until your next turn, target .+$/i.test(normalizedText) ||
    /^until end of turn, (?:this artifact|target .+) becomes a copy of .+$/i.test(normalizedText) ||
    /^each nonland permanent you control becomes a copy of target .+$/i.test(normalizedText) ||
    /^nonbasic lands are islands\.?$/i.test(normalizedText) ||
    /^target artifact or creature becomes a copy of another target .+$/i.test(normalizedText) ||
    /^lands target player controls don'?t untap during their next untap step\.?$/i.test(normalizedText) ||
    /^choose target player\. return half the creatures they control to their owner'?s hand, rounded up\.?$/i.test(normalizedText) ||
    /^creatures dealt damage this way can'?t be regenerated this turn\.?$/i.test(normalizedText) ||
    /^this artifact becomes a copy of target artifact, except it has this ability\.?$/i.test(normalizedText) ||
    /^put the bottom card of your library into your graveyard\. if it'?s .+$/i.test(normalizedText) ||
    // Dinosaur-only reminder skip until a generic GY-type-has-keyword grant_static_ability parser exists.
    /^each dinosaur card in your graveyard has escape\b.+/i.test(normalizedText) ||
    /^during your turn, equipped creature has hexproof and can'?t be blocked\.?$/i.test(normalizedText) ||
    /^if you discard a card with madness, discard it into exile\.?$/i.test(normalizedText) ||
    /^target creature an opponent controls blocks this turn if able\.?$/i.test(normalizedText) ||
    /^choose a creature at random, then destroy the rest\.?$/i.test(normalizedText) ||
    /^this land becomes a copy of target land, except it has this ability\.?$/i.test(normalizedText) ||
    /^sacrifice any number of artifacts, enchantments, and\/or tokens\. return that many creature cards from your graveyard to the battlefield\.?$/i.test(normalizedText) ||
    /^create x \d+\/\d+ .+ creature tokens with .+, where x is the damage dealt this way\.?$/i.test(normalizedText) ||
    /^you may sacrifice four eldrazi spawn rather than pay this spell'?s mana cost\.?$/i.test(normalizedText) ||
    /^this permanent becomes a copy of the sacrificed creature, except it has this ability\.?$/i.test(normalizedText) ||
    /^you may move a \+1\/\+1 counter from this land onto it\.?$/i.test(normalizedText) ||
    /^enchanted (?:forest|mountain) becomes a .+ creature until end of turn\b.+/i.test(normalizedText) ||
    /^legolas can'?t be blocked by creatures with power .+ or less\.?$/i.test(normalizedText) ||
    /^at end of combat, exile all creatures blocked by this creature\.?$/i.test(normalizedText) ||
    /^creatures you control with power or toughness .+ or less can'?t be blocked\.?$/i.test(normalizedText) ||
    /^instant and sorcery spells you cast this turn cost .+ less to cast\.?$/i.test(normalizedText) ||
    /^this creature becomes a copy of target creature card in your graveyard with mana value x\b.+/i.test(normalizedText) ||
    /^target creature attacks or blocks this turn if able\.?$/i.test(normalizedText) ||
    /^iv\s*[-�]\s*historic spells you cast this turn cost .+ less to cast\.?$/i.test(normalizedText) ||
    /^until end of turn, .+ becomes a copy of target creature you control\.?$/i.test(normalizedText) ||
    /^choose a background(?:\s*\(.*\))?\.?$/i.test(normalizedText) ||
    /^.+\s+can be your commander\.?$/i.test(normalizedText) ||
    /^flashback\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^madness\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^retrace\s*\(/i.test(normalizedText) ||
    /^cascade\s*\(/i.test(normalizedText) ||
    /^surge\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^miracle\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^emerge\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^escape\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^jump-start\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^disturb\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^blitz\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^spectacle\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^prowl\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^bestow\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^ninjutsu\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^soulshift\s+\d+\s*\(/i.test(normalizedText) ||
    /^transmute\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^forecast\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^channel\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^plainscycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^islandcycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^swampcycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^mountaincycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^forestcycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^typecycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^basic landcycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^cycling\s+(?:\{[^}]+\})+\s*\(/i.test(normalizedText) ||
    /^enchant .+$/i.test(normalizedText) ||
    /^max speed\s*[-�]\s*.+$/i.test(normalizedText) ||
    /^partner with .+$/i.test(normalizedText) ||
    /^partner-[\w\s&]+(?:\s*\(.+)?$/i.test(normalizedText) ||
    /^squad\s+(?:\{[^}]+\})+\s*(?:\(|$)/i.test(normalizedText) ||
    /^convoke,?\s*delve\b/i.test(normalizedText) ||
    /^delve,?\s*convoke\b/i.test(normalizedText) ||
    /^this spell costs .+ to cast\b/i.test(normalizedText) ||
    /^the "legend rule" doesn't apply/i.test(normalizedText) ||
    /^triggered abilities you control can't/i.test(normalizedText) ||
    /^gift an?\s+/i.test(normalizedText) ||
    /^equipped creature has\b/i.test(normalizedText) ||
    /^target player gains \d+ life for each\b/i.test(normalizedText) ||
    /^target player discards\b/i.test(normalizedText) ||
    /^target opponent discards\b/i.test(normalizedText) ||
    /^target creature gets [+-]/i.test(normalizedText) ||
    /^target .+ until your next turn\b/i.test(normalizedText) ||
    /^untap .+ target\b/i.test(normalizedText) ||
    /^you draw .+ cards,.+lose .+ life\b/i.test(normalizedText) ||
    // Characteristic-defining abilities ("This permanent's power is equal to the number of artifacts
    // you control") are real layer-7b grants. The specific CDAs the platform handles elsewhere are
    // pruned by name in pruneExternallyHandledStaticUnknownAbilities instead.
    (/^this permanent(?:'|')?s (?:toughness|power)\b/i.test(normalizedText) &&
      !/\b(?:is|are)\s+(?:each\s+)?equal to\b/i.test(normalizedText)) ||
    /^this equipment(?:'|')?s equip\b/i.test(normalizedText) ||
    /^this land is\b/i.test(normalizedText) ||
    /^the (?:blitz|flashback|madness|plot|this permanent) cost is equal\b/i.test(normalizedText) ||
    /^tribute \d+\s*\(/i.test(normalizedText) ||
    /^while (?:voting|you(?:'|')?re searching)\b/i.test(normalizedText) ||
    /^warp-/i.test(normalizedText) ||
    /^your (?:commander costs|maximum hand size|devotion)\b/i.test(normalizedText) ||
    /^vehicles you control\b/i.test(normalizedText) ||
    /^vehicle creatures you control\b/i.test(normalizedText) ||
    /^you (?:may )?play an additional land\b/i.test(normalizedText) ||
    /^you can cast spells only\b/i.test(normalizedText) ||
    /^you can spend mana\b/i.test(normalizedText) ||
    /^you control (?:enchanted|your opponents)\b/i.test(normalizedText) ||
    /^the owner of target\b/i.test(normalizedText) ||
    /^the owner of each creature card\b/i.test(normalizedText) ||
    /^trample over planeswalkers\b/i.test(normalizedText) ||
    /^unlock costs you pay\b/i.test(normalizedText) ||
    /^unattach all equipment\b/i.test(normalizedText) ||
    /^two target players each\b/i.test(normalizedText) ||
    /^this turn and next turn,.+$/i.test(normalizedText) ||
    /^the attacking player chooses\b/i.test(normalizedText) ||
    /^the chosen player reveals\b/i.test(normalizedText) ||
    /^the copy isn(?:'|')t legendary\b/i.test(normalizedText) ||
    /^the first (?:activated ability|card|spell)\b/i.test(normalizedText) ||
    /^the new creature type can(?:'|')t be\b/i.test(normalizedText) ||
    /^the new targets can(?:'|')t be\b/i.test(normalizedText) ||
    /^the source(?:'|')?s controller\b/i.test(normalizedText) ||
    /^the tokens are goaded\b/i.test(normalizedText) ||
    /^their owners shuffle\b/i.test(normalizedText) ||
    /^the top card of your library has plot\b/i.test(normalizedText) ||
    /^tunnel snakes rule!/i.test(normalizedText) ||
    /^x target blocked creatures\b/i.test(normalizedText) ||
    /^y is equal to x\b/i.test(normalizedText) ||
    /^you and target spell(?:'|')?s controller bid\b/i.test(normalizedText) ||
    /^you gain \d+ life plus an additional\b/i.test(normalizedText) ||
    /^[\w, ']+ gets [+-]\d+/i.test(normalizedText) ||
    /^this permanent\.\s*\(look at the top two cards of your library\b/i.test(normalizedText) ||
    /^a deck can have (?:only |up to )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards named/i.test(normalizedText) ||
    /^target player draws (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten) cards, loses \d+ life\b/i.test(normalizedText) ||
    /^this turn, instead of declaring blockers\b/i.test(normalizedText) ||
    /^untap and goad that creature\b/i.test(normalizedText) ||
    /^untap the chosen permanents\b/i.test(normalizedText) ||
    /^x can't be greater than\b/i.test(normalizedText) ||
    false
  );
}
