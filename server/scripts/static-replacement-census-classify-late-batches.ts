/**
 * B48+: census classifier entries for later batches (kept out of static-replacement-census-classify.ts for size).
 * Lines are lowercased with the card name replaced by "~" before matching. Add new batches at the top.
 */
export const LATE_BATCH_OTHER_SYSTEMS: Array<[string, RegExp]> = [
  // B52 entries: families implemented or verified in batch 52.
  ['scoped grant with trailing as-long-as condition (staticEffectSpecOracleParsingConditionalScopedGrants)', /^(?:artifacts and creatures|creatures and artifacts|creatures|artifacts|permanents) you control have [^.]+ as long as you control [^.]+\.?$/i],
  ['creatures attacking enchanted player have keywords (target_is_attacking_enchanted_player)', /^creatures attacking enchanted player have .+$/i],
  ['must attack + cannot attack owner or owner planeswalkers (attackRestrictionText)', /^~ attacks each combat if able and can't attack its owner(?: or planeswalkers its owner controls)?\.?$/i],
  // B51 entries: families implemented or verified in batch 51.
  ['reveal first draw each turn (firstDrawRevealStatic)', /^reveal the first card you draw (?:each turn|on each of your turns)\.?$/i],
  // B50 entries: families implemented or verified in batch 50.
  ['d20 result band line (oracle IR die_roll_results via oracleIRParserDieRollInlineBandTables)', /^\d+(?:\s*[-\u2013\u2014]\s*\d+)?\s*\|\s*.+$/i],
  // B49 entries: families implemented or verified in batch 49.
  ['defender permission after a type entered this turn (combatDefenderAttackPermission)', /^as long as an? (?:artifact|creature|land|enchantment|planeswalker|battle) entered the battlefield under your control this turn, ~ can attack as though it didn't have defender\.?$/i],
  ['enchanted destroy -> sacrifice aura + indestructible (enchantedPermanentDestroyReplacement)', /^if enchanted (land|creature|artifact|permanent|enchantment|planeswalker) would be destroyed, instead sacrifice (?:~|this aura) and that \1 gains indestructible until end of turn\.?$/i],
  ['turned face up counters (turnFaceUpCounterPlacement)', /^as ~ is turned face up, put (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (?:[+-]\d+\/[+-]\d+|[a-z]+) counters? on it\.?$/i],
  ['draft-only (Conspiracy draft matters; no in-game effect)', /^(?:draft ~ face up|during the draft, .+|as long as ~ is face up during the draft, .+)$/i],
  // B48 entries: families implemented or verified in batch 48.
  ['land play restriction (landPlayRestrictionFamilies)', /^(?:you can't play lands if (?:~ was cast|you cast (?:~|this spell)) this turn|(?:players|each player|you|your opponents|each opponent) can't play more than one land each turn)$/i],
  ['storage matrix untap choice (untapTypeChoiceRestriction)', /^as long as ~ is untapped, each player chooses artifact, creature, or land during their untap step(?:\. that player can untap only permanents of the chosen type this step)?$/i],
];
