/** Line classification + family keys for static-replacement-census.ts. */
import { parseCopyEntryExceptions } from '../src/state/modules/copyEntryExceptions.js';

const ABILITY_WORD = /^\s*[A-Za-z][A-Za-z' ]{0,40}?\s+(?:\u2014|--?)\s+/;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function replaceSelfName(line: string, cardName: string): string {
  let s = line;
  const names = new Set<string>();
  for (const face of cardName.split(/\s*\/\/\s*/)) {
    if (face.length >= 3) names.add(face);
    const short = face.split(',')[0].trim();
    if (short.length >= 3) names.add(short);
  }
  for (const n of [...names].sort((a, b) => b.length - a.length)) s = s.replace(new RegExp(escapeRegex(n), 'g'), '~');
  return s;
}

/** Subsystems outside the Phase 5 declarative registries (not counted as gaps). */
const OTHER_SYSTEMS: Array<[string, RegExp]> = [
  // Readers added / verified in census batch 2-3 (tests: static-effect-spec-census-gaps-batch3.unit.test.ts).
  ['Theros god devotion type-loss (updateGodCreatureStatus)', /as long as your devotion to .+ is less than \w+, .+ isn't a creature/i],
  ['blocker-quality evasion (combatQualifierBlockRestriction)', /^(?:~|this creature|it)? ?can(?:not|'t) be blocked by (?:creatures with (?:power|toughness) \w+ or (?:greater|more|less)|creatures with (?:flying|reach|defender|first strike|deathtouch|haste|trample)|(?:artifact|enchantment|legendary|land|token|snow|colorless|multicolored) creatures|[a-z]+s)\s*\.?$/i],
  // Batch 19 readers (tests: batch19-replacements.unit.test.ts).
  ['per-draw replacement: skip / exile face up / graveyard return / opponent redirect (replacementBatch19DrawInstead)', /^if (?:a player would draw a card, that player (?:skips that draw|exiles that card face up) instead|you would draw a card, return a card from your graveyard to your hand instead|an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card)\.?$/i],
  // Batch 18 readers (tests: batch18-replacements.unit.test.ts).
  ['noncombat damage prevented [+ life / counters] (replacementBatch18NoncombatPrevention)', /^if noncombat damage would be dealt to (?:you|~|this creature), prevent that damage\.?$/i],
  ['opponent extra turn skipped (replacementBatch18ExtraTurnSkip via dropSkippedExtraTurns)', /^if an opponent would begin an extra turn, that player skips that turn instead\.?$/i],
  ['empty-library draw: counters / skip instead (replacementBatch18DrawInstead)', /^if you would draw a card while your library has no cards in it, (?:instead put (?:n|\w+) \+1\/\+1 counters? on ~|skip that draw instead)\.?$/i],
  // Batch 17 readers (tests: batch17-replacements.unit.test.ts).
  ['prevent damage, remove +1/+1 counters [+ tokens/rad] (replacementBatch17DamagePrevention)', /^if damage would be dealt to ~(?: while it has a \+1\/\+1 counter on it)?, prevent that damage, remove (?:an?|that many) \+1\/\+1 counters? from (?:it|~)(?:, and create that many 1\/1 colorless spirit creature tokens|, then give each player a rad counter for each \+1\/\+1 counter removed this way)?$/i],
  ['prevent damage, put that many counters (replacementBatch17DamagePrevention)', /^if damage would be dealt to ~, prevent that damage and put that many [+-]1\/[+-]1 counters on (?:it|him|her|~)$/i],
  ['prevent damage to you, counter on source (replacementBatch17DamagePrevention)', /^if a source would deal damage to you, prevent that damage and put an? [a-z]+ counter on (?:~|this enchantment)$/i],
  // Batch 16 readers (tests: batch16-replacements.unit.test.ts).
  ['activated "can attack as though no defender" this turn (temporaryEffects -> combatDefenderAttackPermission)', /^\{[^}]+\}(?:, \{t\})?: target creature with defender can attack this turn as though it didn't have defender\.?$/i],
  ['noncombat damage to opponents +N / double (replacementBatch16LongTail damage templates)', /^if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals (?:that much damage plus \d+|double that damage to that player or permanent) instead\.?$/i],
  ['own graveyard -> exile from anywhere (zone-change template)', /^if a card or token would be put into your graveyard from anywhere, exile it instead\.?$/i],
  ['damage becomes counters (damage side-effect template)', /^if damage would be dealt to (?:~|this creature), put that many [+-]1\/[+-]1 counters on (?:it|~|this creature) instead\.?$/i],
  ['extra Treasure (token template)', /^if you would create one or more treasure tokens, instead create those tokens plus an additional treasure token\.?$/i],
  ['regenerate instead of destroy (replacementBatch16LongTail)', /^if (?:~|this creature) would be destroyed, regenerate it\.?(?:\s*\(.*)?$/i],
  ['dice advantage (dieRollAdvantage)', /^if you would roll one or more dice, instead roll that many dice plus one and ignore the lowest roll\.?$/i],
  ['extra turn skipped (replacementBatch16LongTail via nextTurn)', /^if a player would begin an extra turn, that player skips that turn instead\.?$/i],
  ['land would enter: sacrifice lands instead (land-would-enter-replacement)', /^if (?:~|this land) would enter(?: the battlefield)?, sacrifice (?:two|three|an?|\d+) (?:untapped )?lands? instead\b/i],
  ['crew/saddle as though power were N greater (crewSaddlePowerBonus)', /^(?:~|this creature) (?:saddles mounts and crews vehicles|crews vehicles(?: and saddles mounts)?|saddles mounts) as though its power were (?:\d+|one|two|three) greater\.?$/i],
  // Batch 15 readers (tests: batch15-*.unit.test.ts).
  ['attack as though no defender, global/self/conditional (combatDefenderAttackPermission)', /^(?:as long as (?:you control (?:a|another) creature with power \d+ or greater|~ has an? [+-]\d+\/[+-]\d+ counter on it), )?(?:~|it|creatures you control|each creature you control) can attack as though (?:it|they) didn't have defender\.?$/i],
  ['activate abilities as though haste (gameActionsPermanentKeywordGrants)', /^you may activate abilities of creatures you control as though those creatures had haste\.?$/i],
  ['cowards can\'t block warriors (combatDefenderAttackPermission)', /^cowards can't block warriors\.?$/i],
  // Batch 14 readers (tests: batch14-*.unit.test.ts).
  ['"~ is all colors" CDA (selfAllColorsCDA via getEffectiveColors)', /^(?:~|this creature) is all colors\.?$/i],
  ['chosen-name activation lock (chosen-name-restrictions)', /^activated abilities of sources with the chosen name can't be activated(?: unless they're mana abilities)?\.?$/i],
  ['chosen-name cast lock (chosen-name-restrictions)', /^(?:(?:your opponents|players|each opponent) can't cast spells with the chosen name|spells with the chosen name can't be cast)\.?$/i],
  ['morph/disguise non-mana or mixed turn-face-up cost (turnFaceUpCostComponents)', /^(?:morph|megamorph|disguise)\s*[\u2014\u2013-]\s*(?:return (?:a|an|one|two) [^.]+ you control to (?:its|their) owners?'? hands?|sacrifice (?:a|an|one|two) [^.,]+|discard (?:a|an|one|two) (?:[a-z]+ )?cards?|(?:\{[^}]+\})+,? (?:and )?pay \d+ life)\.?(?:\s*\(.*)?$/i],
  // Batch 13 readers (tests: batch13-*.unit.test.ts).
  ['colour-sourced targeting restriction (colorSourceTargetingRestriction)', /^(?:~|this creature|it)? ?can't be the target of (?:white|blue|black|red|green) spells or abilities from (?:white|blue|black|red|green) sources\.?$/i],
  ['morph/megamorph/disguise turn-face-up cost (faceDownCasting)', /^(?:morph|megamorph|disguise)\s*[\u2014\u2013-]\s*(?:reveal an? (?:white|blue|black|red|green) card in your hand|pay \d+ life)\.?(?:\s*\(.*)?$/i],
  // Batch 12 readers (tests: batch12-*.unit.test.ts).
  ['evoke exile-a-card cost + evoke sacrifice (evokeKeyword)', /^evoke\s*[\u2014\u2013-]\s*exile an? (?:white|blue|black|red|green) card from your hand\.?(?:\s*\(.*)?$/i],
  ['graveyard targeting restriction (graveyardTargetingRestriction)', /^cards in (?:graveyards|your graveyard) can't be the targets of spells or abilities(?: your opponents control)?\.?$/i],
  // Batch 11 readers (tests: batch11-*.unit.test.ts).
  ['cumulative upkeep pay life / mana (cumulativeUpkeepPayment)', /^cumulative upkeep\s*(?:[\u2014\u2013-]\s*pay \d+ life|(?:\{[^}]+\})+(?: or (?:\{[^}]+\})+)*)\.?(?:\s*\(.*)?$/i],
  ['untap during each other player\'s untap step (turnPhaseUntapStepEffects)', /^untap (?:~|this (?:artifact|creature|land|permanent|enchantment|vehicle|card)) during each other player's untap step\.?$/i],
  ['attached/except color block restriction (combatExceptColorBlockRestriction)', /^(?:(?:enchanted|equipped) creature can't be blocked (?:except )?by|~ can't be blocked except by) (?:(?:white|blue|black|red|green)(?:,? (?:and\/or |or )?)?)+ creatures\.?$/i],
  ['draft-only text (not applicable to constructed play)', /^reveal (?:~|this card) as you draft it\b/i],
  // Batch 10 readers (tests: batch10-*.unit.test.ts).
  ['variable P/T color permanent count (variableColorPermanentCount)', /^~'s power and toughness are each equal to the number of (?:white|blue|black|red|green)(?: and\/or (?:white|blue|black|red|green))? (?:permanents|creatures) you control\.?$/i],
  ['discard-to-battlefield replacement (discardToBattlefieldReplacement)', /^if a spell or ability an opponent controls causes you to discard (?:~|this card), put it onto the battlefield(?: with (?:a|an|one|two|three|\d+) \+1\/\+1 counters? on it)? instead of putting it into your graveyard\.?$/i],
  ['partner family deck construction (partnerDeckValidation)', /^(?:partner(?: with [^.]+|\s*[\u2014\u2013-]\s*[^.]+)?|friends forever|choose a background|doctor's companion)\.?(?:\s*\(.*)?$/i],
  // Batch 9 readers (tests: batch9-locks-ai-loyalty-assist.unit.test.ts).
  ['power-only CDA (variablePowerOnlyCalculator)', /^~'s power is equal to the number of (?:(?:(?:white|blue|black|red|green) )?(?:creatures|artifacts|enchantments|lands) you control|(?:instant and sorcery|creature|artifact|land|enchantment) cards in your graveyard|cards in your hand)\.?$/i],
  ['variable P/T graveyard/artifact count (variablePTCalculator)', /^~'s power and toughness are each equal to the number of (?:creature cards in your graveyard|artifacts you control|enchantments you control)\.?$/i],
  ['self shuffle-into-library replacement (replacementEffectSpec)', /^if ~ would be put into a graveyard from anywhere, (?:reveal ~ and )?shuffle (?:it|~) into its owner's library instead\.?$/i],
  // Batch 8 readers (tests: batch8-locks-loyalty-paired-escape.unit.test.ts).
  ['planeswalker quoted loyalty grants (planeswalkerGrantedLoyaltyAbilities)', /^planeswalkers you control have "\[?[+\u2212\u2013\u2014-]?[\dx]+\]?:/i],
  ['paired P/T + quoted grants (PairedThresholdQuotedGrants)', /is paired with another creature, (?:each of those creatures|both creatures) (?:gets?|has|have)\b/i],
  ['global activation lock (staticActivationLockFromAttachments)', /^activated abilities of (?:artifacts|creatures|lands|planeswalkers|enchantments)(?:(?:,| and| or|, and|, or) (?:artifacts|creatures|lands|planeswalkers|enchantments))*(?: your opponents control)? can't be activated(?: unless they're mana abilities)?$/i],
  ['aura P/T + goad (goad-effects / calculateAllPTBonuses)', /^enchanted creature gets [+-]\w+\/[+-]\w+ and is goaded$/i],
  ['opponents must attack (attackRestrictionText)', /creatures your opponents control attack each combat if able/i],
  ['escape entry counters (detectEntersWithCounters)', /\bescapes? with (?:a|an|\w+) [^.]*counters? on it/i],
  ['assist (assistPayment)', /^assist\b/i],
  ['kicker incl. and/or two-cost kicker (kickerCostUtils)', /^kicker \{/i],
  // Batch 7 readers (tests: batch7-casting-combat-requirements-grants.unit.test.ts).
  // Batch 10 trim: these exclude forms parseStaticEffectSpecsFromOraclePermanent already handles.
  ['casting limits (staticCastingRestrictions + OracleExtras)', /your opponents can't cast spells during (?:your turn|combat)|(?:each player|your opponents|each opponent|you) can't cast more than \w+ (?:noncreature )?spells? each turn|you can cast no more than \w+ (?:noncreature )?spells? each turn/i],
  ['must block each combat (combatMustBlockEachCombat)', /(?:^|\W)~ (?:attacks or )?blocks each combat if able$|all creatures block each combat if able|(?:enchanted|equipped) creature (?:[^.]*\band )?(?:attacks or )?blocks each combat if able/i],
  ['must attack each combat (attackRequirementTextExtras)', /^(?!.*(?:gets [+-]\w+\/[+-]\w+, has |and can't attack you))(?:.*?)(?:(?:enchanted|equipped) creature (?:[^.()]*?\band )?attacks (?:or blocks )?each combat if able|(?:^|\W)~ attacks or blocks each combat if able|all creatures attack each combat if able)/i],
  ['day/night on enter (day-night ensureInitial)', /neither day nor night, it becomes (?:day|night) as ~ enters/i],
  ['protection from the chosen color (combat-mechanics getPermanentProtections)', /^(?:enchanted creature|~) has protection from the chosen color/i],
  ['attached activation lock (staticActivationLockFromAttachments)', /(?:enchanted|equipped) (?:creature|permanent|artifact|land)(?:'s| (?!can't (?:attack or )?block, and its activated)[^.]*\band its) activated abilities can't be activated/i],
  ['damage by toughness (turnCombatDamageByToughness)', /^(?!as long as enchanted creature has )(?:.*?)assigns? combat damage equal to (?:its|their) toughness rather than (?:its|their) power/i],
  ['paired / graveyard-count quoted grants (PairedThresholdQuotedGrants)', /is paired with another creature, each of those creatures has "/i],
  ['multikicker (multikickerCastUtils)', /^multikicker\b/i],
  // Batch 23 readers (tests: batch23-statics.unit.test.ts).
  ['enters prepared (prepared)', /^(?:~|this creature|it) enters prepared\b/i],
  ['amplify N (amplifyEntry)', /^amplify \d+\b/i],
  ['can\'t cast during your first turns (firstTurnsCastRestriction)', /^you can't cast (?:this spell|~) during your first(?:, second,)? (?:or (?:second|third) )?turns? of the game\b/i],
  ['maximum hand size set/increase/reduce (handSizeStaticModifiers)', /^(?:your|each opponent's|each player's) maximum hand size is (?:increased by |reduced by )?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|zero)\.?$/i],
  ['attack as though no defender, trailing/counter/type conditions (combatDefenderAttackPermission)', /^(?:as long as ~ has a counter on it, (?:~|it) can attack as though it didn't have defender|(?:~|it) can attack as though it didn't have defender as long as (?:you control an? [a-z]+|~ has a counter on it))\.?$/i],
  ['Fasting draw-step may-skip, OPTION_CHOICE (optionalDrawStepSkip)', /^if you would begin your draw step, you may skip that step instead\b/i],
  ['instant/sorcery damage cap (replacementBatch23DamageCap)', /^if an instant or sorcery source would deal \d+ or more damage to you, it deals \d+ damage to you instead\.?$/i],
  ['attack last-turn attackers despite defender (combatDefenderAttackPermission)', /^(?:~|this creature) can attack players who attacked you during their last turn as though it didn't have defender\b/i],
  ['granted vehicle crew N (crewGrantedVehicleCrew)', /^(?:vehicles you control have|each vehicle you control has) crew \d+\b/i],
  ['creature tokens you control have keyword (combat-mechanics token lord grants)', /^(?:during your turn, )?creature tokens you control have [a-z ,]+\b/i],
  ['self unblockable except by flying/reach (combatBatch25BlockRestrictions)', /^(?:~|this creature) can't be blocked except by creatures with (?:flying|reach)(?:,? (?:and\/or|or|and) (?:flying|reach))?\b/i],
  ['self unblockable while attacking alone (combatBatch25BlockRestrictions)', /^(?:~|this creature) can't be blocked as long as it's attacking alone\b/i],
  ['cast only if cast another spell this turn (castOnlyIfCastAnotherRestriction)', /^cast this spell only if you've cast another (?:[a-z]+ )?spell this turn\b/i],
  ['self unblockable while defender controls TYPE (combatDefenderControlsUnblockable)', /^(?:~|this creature) can't be blocked as long as defending player controls an? (?:artifact|enchantment|creature|planeswalker)\b/i],
  ['block SUBTYPE as though reach (combatBatch26BlockRestrictions)', /^(?:~|this creature) can block [a-z]+ as though (?:it|this creature) had reach\b/i],
  ['players can\'t draw cards (playersCantDrawCards)', /^(?:players|your opponents) can't draw cards\b/i],
  ['COLOR creatures / basic lands don\'t untap (turn-phases detectDoesntUntapEffects filters)', /^(?:white|blue|black|red|green) creatures don't untap during their controllers' untap steps\b|^(?:plains|islands|swamps|mountains|forests) don't untap during their controllers' untap steps\b/i],
  ['untap step cap N TYPE (untapStepLimits)', /^(?:as long as (?:~|this [a-z]+) is untapped, )?(?:players|your opponents|each player) can't untap more than (?:one|two|three|four|five|\d+) (?:artifact|land|creature|permanent)s? during their untap steps?\b/i],
  ['entering doesn\'t cause abilities to trigger (triggeredAbilitySuppression)', /^(?:artifacts?|creatures?|permanents?)(?:(?:,| and| or) (?:artifacts?|creatures?|permanents?))* entering(?: the battlefield)?(?: or dying)? (?:don't|doesn't) cause abilities to trigger\b/i],
  ['block shadow as though (blockAsThoughShadow)', /^(?:~|this creature|creatures you control) can block creatures with shadow as though (?:it|they) had shadow\b/i],
  ['enters untapped override (landsEnterUntappedOverride)', /^(?:basic )?(?:lands|permanents|creatures|artifacts) you control enter untapped\b/i],
  ['revealed hands/library top flags (revealedInformationFlags)', /^(?:(?:players|each player|your opponents|you) )?plays? with (?:their hands?|your hand|the top card of (?:their librar(?:y|ies)|your library)) revealed\b/i],
  ['escape graveyard cast (interactionGraveyardCastExecution)', /^escape\W/i],
  // Batch 6 readers (tests: batch6-redirect-lich-landwalk-mana.unit.test.ts).
  ['minimum blockers (combatMinimumBlockers)', /^~ can't be blocked except by (?:\w+) or more creatures$/i],
  ['mana retention (turnManaRetentionOracle)', /^(?:you don't lose unspent (?:white|blue|black|red|green) mana as steps and phases end|if you would lose unspent mana, that mana becomes (?:white|blue|black|red|green|colorless) instead)$/i],
  ['landwalk blockable-as-though (combatLandwalkOverrides)', /^creatures with (?:\w+walk|landwalk abilities) can be blocked as though they didn't have (?:\w+walk|those abilities)$/i],
  ['assign combat damage as though unblocked (combatAssignAsThoughUnblocked)', /(?:you may have ~ assign (?:its|his|her|their) combat damage|(?:enchanted|equipped) creature's controller may have it assign its combat damage|you may have that creature assign its combat damage) as though (?:it|he|she|they) weren't blocked/i],
  ['top card revealed (gameStateEffectsTopLibrary)', /^play with the top card of your library revealed$/i],
  ['damage can\'t be prevented (gameStateEffectsMillDamage canDamageBePrevented)', /^damage can't be prevented$/i],
  ['blocker capacity (combatBlockerCapacity)', /can block (?:an additional(?: \w+)? creatures?|any number of creatures)/i],
  ['skip draw step (turnStepDrawTurnAction)', /\bskip your draw step\b/i],
  ['attack needs defender land type (combatDefendingLandRestriction)', /can(?:not|'t) attack unless defending player controls an? /i],
  ['color can\'t-be-blocked-by (combatColorBlockRestriction)', /^(?:~|this creature|it)? ?can(?:not|'t) be blocked by (?:(?:white|blue|black|red|green)(?:,? (?:or )?)?)+ creatures\b/i],
  ['variable P/T count (variablePTCalculator)', /power and toughness are each equal to the number of (?:lands you control|cards in your hand|creatures you control)\b/i],
  ['control Aura layer 2 (staticEffectSpecAuraControl)', /\byou control enchanted (?:creature|permanent|artifact|land|planeswalker)\b/i],
  ['cost modification', /\bcosts? (?:\{[^}]+\}|\w+) (?:less|more)\b|\bcost (?:\{[^}]+\}|\w+) (?:less|more)\b|\brather than pay\b|\bwithout paying\b|as an additional cost/i],
  ['enters tapped / with counters / as-enters choice', /\benters? (?:the battlefield )?(?:tapped|with)\b|^as (?:~|this \w+) enters\b|\benters as a copy\b/i],
  ['cast/play permission', /\byou may (?:cast|play|look at)\b|\bcan be cast\b|\bflash as though\b|as though (?:it|they) had flash/i],
  ['uncounterable / timing', /\bcan't be countered\b|\bspend mana as though\b|\bmana of any type\b/i],
  ['commander / deck rules', /\bcan be your commander\b|\ba deck can have\b|\bpartner with\b|\bstart(?:ing)? hand\b|\bopening hand\b|\bcompanion\b/i],
  ['planeswalker loyalty / saga / class', /\bloyalty abilit|^(?:i|ii|iii|iv|v|vi)(?:, (?:i|ii|iii|iv|v|vi))* \u2014|\blevel \d|^chapter\b/i],
  ['mana ability text', /^add \{|\badd one mana\b/i],
  // Direct oracle readers (not the declarative registries), verified by git grep:
  // attached host P/T + keyword grants: gameActionsPermanentKeywordGrants.ts / combat-mechanics.ts / P/T calc.
  ['attached host P/T or keyword grant (oracle reader)', /^(?:equipped|enchanted|fortified) creature (?:gets [+-]\w+\/[+-]\w+(?: and has [a-z ,]+)?|has [a-z ,]+)$/i],
  // combatLegalityHelpers.ts / combat.ts / attackRestrictionText.ts / combatControl.ts
  ['combat evasion / requirement (oracle reader)', /^~ (?:can't be blocked(?: by more than one creature| by creatures with power \w+ or less| by creatures with greater power)?|attacks each combat if able|can block only creatures with flying|can't block)$/i],
  // turnActions.ts untap/hand-size readers
  ['untap restriction / hand size (oracle reader)', /doesn't untap during|choose not to untap|no maximum hand size/i],
  ['keyword with reminder (keywordAbilities/*)', /^(?:toxic|ward|living metal|tribute|read ahead|choose a background|exert|draft this card)\b|^you may exert\b/i],
  // B28 entries: families implemented in batch 28 or verified as already implemented.
  ['extra vote (voteAdditionalVotes)', /^while voting, you may vote an additional time$/i],
  ['drawn-cards conditional unblockable (combatBatch28ConditionalUnblockable)', /^~ can't be blocked as long as you've drawn \w+ or more cards this turn$/i],
  ['spell lifelink grant (spellLifelinkGrant)', /^instant and sorcery spells you control have lifelink$/i],
  ['enters under opponent control (triggers/control-change)', /^~ enters under the control of an opponent of your choice$/i],
  ['clone entry copy (asEntersCopyChoice)', /^you may have ~ enter as a copy of any creature on the battlefield$/i],
  ['source damage plus replacement (replacementBatch21DamageScaling)', /^if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus/i],
  // B29 entries: families implemented in batch 29 or verified as already implemented.
  ['exiled-card name cast lock (exiledCardNameCastLock)', /^(?:your opponents|players) can't cast spells with the same name as (?:the exiled cards?|a card exiled with ~)$/i],
  ['creatures don\'t untap (turn-phases all_creatures untap prevention)', /^creatures don't untap during (?:their controllers'|untap steps)/i],
  ['attached unblockable (combatBatch28ConditionalUnblockable)', /^(?:enchanted|equipped) creature (?:gets [+-]\d+\/[+-]\d+ and |has [a-z ,]+? and )?can't be blocked(?: this turn)?$/i],
  ['flagbearer targeting requirement (flagbearerTargeting)', /^while (?:an opponent is )?choosing targets as part of casting a spell .*flagbearer/i],
  // B30 entries: families implemented in batch 30 or verified as already implemented.
  ['maximum blockers (combatBatch30BlockLimits)', /^(?:~|each creature you control|creatures you control) can't be blocked by more than (?:one|two|three|\d+) creatures?$/i],
  ['graveyard-count attack gate (combatBatch30AttackRestrictions)', /^~ can't attack unless there are (?:\w+|\d+) or more cards in your graveyard$/i],
  ['attached block-only-flying (combatBatch30AttachedBlockRestrictions)', /^(?:enchanted|equipped) creature can block only creatures with flying$/i],
  ['sorcery-timing cast lock (opponentSorceryTimingLock)', /^(?:each opponent|your opponents|each player|players) can cast spells only any time (?:they|he or she) could cast a sorcery$/i],
  ['attached land type set (manaAbilityLandTypeModifiers)', /^enchanted land is (?:a|an) (?:plains|island|swamp|mountain|forest)(?: in addition to its other types)?$/i],
  ['lands are every basic land type (manaAbilityLandTypeModifiers)', /^lands you control are every basic land type in addition to their other types$/i],
  ['attached P/T and loses flying (permanentKeywordAbilities)', /^(?:enchanted|equipped) creature gets [+-]\d+\/[+-]\d+ and loses flying$/i],
  ['chosen type in addition (creatureTypeNow)', /is the chosen (?:creature )?type in addition to its other types$/i],
  // B31 entries: families implemented in batch 31.
  ['zone cast lock (batch31CastLocks)', /^(?:players|your opponents|each opponent) can't cast spells from (?:graveyards or libraries|libraries or graveyards|graveyards|libraries)$/i],
  ['opponent-turn cast lock (batch31CastLocks)', /^during your turn, (?:your opponents|each opponent) can't cast spells/i],
  ['artifact and/or color block restriction (combatBatch31BlockRestrictions)', /^~ can't be blocked except by artifact creatures and\/or (?:white|blue|black|red|green|color) creatures$/i],
  // B32 entries: families implemented in batch 32.
  ['opponent activation lock (opponentActivationLocks)', /^(?:during your turn, )?(?:your opponents|each opponent) can't (?:cast spells(?:,| or) )?activate (?:activated )?abilities of (?:artifacts|creatures|enchantments|planeswalkers|lands|battles|,| |or|and)+$/i],
  // B33 entries: families implemented or verified in batch 33.
  ['non-subtype creatures can\'t attack (combatBatch33AttackRestrictions)', /^non-[a-z]+ creatures you control can't attack$/i],
  ['control-count attack/block gate (combatBatch33AttackRestrictions)', /^~ can't (?:attack unless you control another (?:artifact|creature|enchantment|land|planeswalker)|attack unless you control more creatures than defending player|block unless you control more creatures than attacking player)$/i],
  ['equip pay life (equipNonManaCosts)', /^equip(?: [a-z ]+)?\u2014pay n life$/i],
  ['static convoke grant (casting-modifiers)', /^(?:creature |artifact )?spells you cast have convoke$/i],
  // B34 entries: families implemented or verified in batch 34.
  ['land play prohibition (playerActionProhibitions)', /^(?:players|you|your opponents|each player|each opponent) can't play lands$/i],
  ['self cast prohibition (playerActionProhibitions)', /^(?:you|players|each player) can't cast (?:noncreature )?spells$/i],
  ['cast-this-turn attack gate (combatBatch34AttackRestrictions)', /^~ can't attack unless you've cast a (?:creature|noncreature) spell this turn$/i],
  ['additional land each player (calculateMaxLandsPerTurn)', /^each player may play an additional land on each of their turns$/i],
  ['self damage unpreventable (canDamageBePrevented)', /^damage that would be dealt by ~ can't be prevented$/i],
  ['saga / modal bullet text', /^exile this saga|^\u2022/i],
];

export interface StaticCensusLineClass { scope: 'static' | 'replacement'; system?: string }

export function classifyStaticCensusLine(rawLine: string, cardName: string): StaticCensusLineClass | null {
  const line = String(rawLine || '').trim();
  if (!line || !/[.)"\u201d]$/.test(line)) return null; // keyword lines have no period
  // Batch 19: saga/chapter lines are chapter triggers (CR 714.2b), and keyword lines with reminder text ("Enchant creature (Target ...)") are keywords, not statics.
  if (/^(?:i|ii|iii|iv|v|vi|vii)(?:\s*,\s*(?:i|ii|iii|iv|v|vi|vii))*\s*(?:\u2014|--?)\s+/i.test(line)) return null;
  if (/^enchant [a-z ,]+\(/i.test(line)) return null;
  const body = line.replace(ABILITY_WORD, '');
  if (/^(?:when|whenever|at)\b/i.test(body)) return null;
  // Activated ability: a cost before a colon outside quotes (incl. loyalty +1:).
  const unquoted = body.replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, '""');
  if (/^[^.]*?:/.test(unquoted) && !/^(?:choose|as long as)/i.test(unquoted)) return null;
  if (/^\([^)]*\)$/.test(body)) return null;
  const replacement = /\binstead\b|\bif .{0,80} would\b|\bskip\b|\bas though\b|\bprevent\b/i.test(body);
  const scope: 'static' | 'replacement' = replacement ? 'replacement' : 'static';
  const lower = replaceSelfName(body, cardName).replace(/this (?:creature|artifact|enchantment|land|permanent|vehicle)/gi, '~').replace(/\.$/, '');
  // Batch 20: trailing reminder text ("... and is goaded. (It attacks each combat ...)") must not defeat anchored entries.
  const core = lower.replace(/\s*\([^()]*\)$/, '').replace(/\.$/, '');
  // R21: copy-entry exceptions are part of the layer-1 copy effect (copyEntryExceptions).
  if (/\benter as a copy of\b[^"]*, except\b/i.test(body) && parseCopyEntryExceptions(body)) return { scope, system: 'copy entry exceptions (copyEntryExceptions)' };
  // R21: CR 122.1 counter placement restriction (counterPlacementRestrictions, applied in updateCounters).
  if (/^~ can't have counters put on it$/i.test(core)) return { scope, system: 'counter placement restriction (counterPlacementRestrictions)' };
  for (const [system, re] of OTHER_SYSTEMS) if (re.test(lower) || (core !== lower && re.test(core))) return { scope, system };
  return { scope };
}

const COLORS = /\b(white|blue|black|red|green|colorless|multicolored|monocolored)\b/g;

export function staticFamilyKey(rawLine: string, cardName: string): string {
  let s = replaceSelfName(String(rawLine || '').trim().replace(ABILITY_WORD, ''), cardName).toLowerCase();
  s = s
    .replace(/this (?:creature|artifact|enchantment|land|permanent|vehicle|planeswalker|equipment|aura)/g, '~')
    .replace(/"[^"]*"|\u201c[^\u201d]*\u201d/g, '"…"')
    .replace(/[+-]?\d+\/[+-]?\d+/g, '±N/±N')
    .replace(/[+-]x\/[+-]x/g, '±N/±N')
    .replace(/\{[^}]+\}/g, '{M}')
    .replace(/\b\d+\b|\b(?:one|two|three|four|five|six|seven)\b/g, 'N')
    .replace(COLORS, 'COLOR');
  // First clause of the ability is the family.
  const cut = s.search(/[.;]/);
  if (cut > 0) s = s.slice(0, cut);
  return s.replace(/\s+/g, ' ').trim().slice(0, 110);
}