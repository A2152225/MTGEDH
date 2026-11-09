/**
 * Trigger condition IR.
 * Public: TriggerConditionIR, TriggerConditionAlternative, TriggerSubjectFilter,
 *   TriggerMatchPermanent, TriggerMatchSource.
 *
 * The event, the subject, the controller relation, and the source relation are
 * separate fields. Intervening-if, reflexive "when you do", and delayed
 * "next end step" riders are not this record.
 */

export type TriggerConditionEvent =
  | 'dies'
  | 'put_into_graveyard'
  | 'put_into_library'
  | 'enters'
  | 'attacks'
  | 'blocks'
  | 'becomes_tapped'
  | 'becomes_untapped'
  | 'spell_cast'
  /** A spell is copied (Magecraft copy half, "whenever you copy a spell"). */
  | 'spell_copied'
  /** "attacks alone". Needs context.attackerCount === 1. */
  | 'attacks_alone'
  /** Battalion: the source and at least minOtherAttackers others attack. Needs context.attackerCount. */
  | 'attacks_in_group'
  /** Becomes the target of a spell or ability. Needs context.targetingControllerId / targetingKind. */
  | 'becomes_target'
  /** "deals damage" (any kind unless damageKind says otherwise). */
  | 'deals_damage'
  /** A player commits a crime (targets an opponent or what they control or own). */
  | 'commits_crime'
  | 'beginning_of_upkeep'
  | 'beginning_of_draw_step'
  | 'beginning_of_combat'
  | 'beginning_of_end_step'
  | 'beginning_of_precombat_main'
  | 'beginning_of_postcombat_main'
  | 'each_of_your_main_phases'
  | 'end_of_combat'
  | 'gains_life'
  | 'loses_life'
  | 'sacrifices'
  | 'draws_card'
  | 'discards'
  | 'mills'
  | 'deals_combat_damage_to_player'
  | 'deals_combat_damage_to_creature'
  | 'counter_placed'
  | 'counter_removed'
  | 'last_counter_removed'
  | 'deals_combat_damage'
  | 'becomes_blocked'
  | 'cast_self'
  | 'searches_library'
  | 'shuffles_library'
  | 'pays_life'
  | 'creates_token'
  | 'exiled'
  | 'left_graveyard'
  | 'leaves_battlefield'
  | 'gains_control'
  | 'loses_control'
  | 'returned_to_hand'
  | 'spell_countered'
  | 'counters_spell'
  | 'put_on_stack'
  | 'cycles'
  | 'transforms'
  | 'mutates'
  | 'becomes_attached'
  | 'becomes_unattached'
  | 'becomes_monstrous'
  | 'becomes_crewed'
  | 'becomes_saddled'
  | 'attacks_unblocked'
  | 'dealt_damage'
  | 'plays_land'
  | 'unlocks_door'
  | 'turned_face_up'
  | 'phases_in'
  /** Standalone "When you/they do" rider; parent-scheduled, not a permanent detector. */
  | 'reflexive_do'
  | 'class_level'
  | 'tapped_for_mana'
  | 'controls_none'
  | 'room_fully_unlocked'
  | 'performs';

export type TriggerControllerRelation = 'any' | 'you' | 'not_you' | 'enchanted_player';

export type TriggerSourceRelation =
  | 'any'
  | 'another'
  | 'self'
  | 'self_or_another'
  | 'enchanted'
  | 'equipped';

export type TriggerCastZone = 'hand' | 'library' | 'exile' | 'graveyard' | 'not_hand';

export type TriggerOrdinal = 'first' | 'second' | 'third' | 'fourth' | 'fifth' | 'sixth' | 'seventh' | 'eighth' | 'ninth' | 'tenth' | 'twelfth';

/** 'self': the spell targets the trigger source (heroic). */
export type TriggerTargetRelation = 'you' | 'opponent' | 'self' | 'self_only' | 'creature' | 'creature_you_control' | 'creature_you_dont_control' | 'permanent' | 'you_or_creature_you_control' | 'opponent_or_creature_opponent_controls' | 'artifact_or_land' | 'single_creature_you_control' | 'single_creature_other' | 'creature_or_vehicle_you_control';

export type TriggerWhoseTurn =
  | 'you'
  | 'each_player'
  | 'each_opponent'
  | 'enchanted_player'
  | 'enchanted_controller'
  | 'exiled_card_owner'
  | 'monarch'
  | 'chosen_player'
  | 'each_other_player'
  | 'that_player';

export type TriggerTokenRestriction = 'any' | 'token' | 'nontoken';

/** One OR alternative of a subject: every listed card type AND every listed subtype. */
export interface TriggerSubjectGroup {
  readonly types: readonly string[];
  readonly subtypes: readonly string[];
}

export interface TriggerSubjectFilter {
  /** "a permanent" matches any object. Exclusions and supertypes still apply. */
  readonly anyObject: boolean;
  /** Outer list is OR. Each inner list is AND ("artifact creature"). */
  readonly typeGroups: readonly (readonly string[])[];
  /** "nonartifact", "non-Human". */
  readonly excludedWords: readonly string[];
  /** "legendary", "basic", "snow", "world". */
  readonly supertypes: readonly string[];
  /** Outer list is OR. Each inner list is AND ("Goblin Warrior"). */
  readonly subtypeGroups: readonly (readonly string[])[];
  /**
   * Authoritative OR list when present ("a Goblin or artifact" is [{subtypes:[goblin]}, {types:[artifact]}]).
   * typeGroups/subtypeGroups are kept as projections for older readers.
   */
  readonly groups?: readonly TriggerSubjectGroup[];
  /** "nonblack", "non-white": colour letters the object must not have. */
  readonly excludedColors?: readonly string[];
  /** "with flying". */
  readonly keywordsWith: readonly string[];
  /** "without flying". */
  readonly keywordsWithout: readonly string[];
  readonly token: TriggerTokenRestriction;
  /** "with a +1/+1 counter" or "with counters". */
  readonly counters?: readonly { readonly name?: string; readonly minimum: number }[];
  /** "with power 4 or greater". */
  readonly stats?: readonly { readonly stat: 'power' | 'toughness' | 'mana_value'; readonly op: 'gte' | 'lte'; readonly value: number }[];
  /** "of the chosen type". */
  readonly chosenType?: boolean;
  /** "of the chosen color". */
  readonly chosenColor?: boolean;
  /** "dealt damage by this creature / equipped creature this turn". */
  readonly dealtDamageBy?: 'source' | 'equipped';
  readonly faceDown?: boolean;
  readonly goaded?: boolean;
  /** "with power greater than its base power" (Round 41). Needs subject.power and subject.basePower. */
  readonly powerAboveBase?: boolean;
  /** "modified" (CR 700.9): counters, Equipment, or an Aura its controller controls. Needs subject.modified. */
  readonly modified?: boolean;
  readonly suspected?: boolean;
  readonly doubleFaced?: boolean;
  readonly excludeBasicLand?: boolean;
  readonly keywordsWithAny?: readonly string[];
  /** "an equipped creature". Needs subject.equipped. */
  readonly equipped?: boolean;
  readonly attackingOrBlocking?: boolean;
  /** "an attacking creature" / "a blocking creature"; dies uses last known information. */
  readonly combatRole?: 'attacking' | 'blocking';
  readonly commander?: boolean;
  /** "you own" / "you don't own". */
  readonly owner?: 'any' | 'you' | 'not_you';
  /** "historic". */
  readonly historic?: boolean;
  /** "a red spell". Letters w, u, b, r, g. Any one matches. */
  readonly colors?: readonly string[];
  /** "a multicolored spell", "a colorless spell", "a monocolored creature". */
  readonly colorCount?: 'multicolored' | 'monocolored' | 'colorless';
  /** "a kicked spell". */
  readonly kicked?: boolean;
}

export interface TriggerConditionAlternative {
  readonly controller: TriggerControllerRelation;
  readonly source: TriggerSourceRelation;
  readonly subject: TriggerSubjectFilter;
}

export interface TriggerConditionIR {
  readonly event: TriggerConditionEvent;
  readonly fromZone?: 'battlefield' | 'anywhere' | 'library' | 'hand' | 'graveyard' | 'exile' | 'not_hand' | 'hand_or_battlefield' | 'battlefield_or_graveyard' | 'library_or_graveyard';
  /** A second event in "create or sacrifice". The sacrifice emitter also queues it. */
  readonly pairedEvent?: TriggerConditionEvent;
  /** Zone the paired event must come from (graveyard half of "enters or is put into a graveyard from the battlefield"). */
  readonly pairedFromZone?: 'battlefield';
  /** "you surveil", "you scry", "you activate an ability". */
  readonly action?: string;
  /** "you expend 4": the mana total that must be reached. */
  readonly actionAmount?: number;
  /** "is dealt combat damage" versus any damage. Absent means any damage. */
  readonly damageKind?: 'any' | 'combat' | 'noncombat';
  /** Leave the battlefield without dying (bounce/exile/etc.). */
  readonly notDying?: boolean;
  /** End of the first combat phase (extra combats). */
  readonly firstCombat?: boolean;
  /** Delayed: fires on your/that player's next turn end step (one-shot rider). */
  readonly delayedNextTurn?: boolean;
  /** Standalone "When you/they do" actor. Match always fails; parents own the rider. */
  readonly reflexiveActor?: 'you' | 'they';
  /** Parent-scheduled delayed watcher (that creature dies this turn, next end step, …). */
  readonly delayedRider?: boolean;
  /** Untap trigger restricted to the untap step. */
  readonly duringUntapStep?: boolean;
  /** "whenever a red creature or spell": subject may be a spell on the stack. */
  readonly orSpellSubject?: boolean;
  /** "when you cast that spell" (referenced spell from parent effect). */
  readonly thatSpell?: boolean;
  /** "of that type" on next-cast riders. */
  readonly ofChosenType?: boolean;
  /** "one or more opponents each lose exactly N". */
  readonly eachOpponent?: boolean;
  /** Excess damage was dealt. */
  readonly requiresExcess?: boolean;
  /** "for the first time each turn". */
  readonly onceEachTurn?: boolean;
  /** Exact life lost/gained amount. */
  readonly lifeAmount?: number;
  /** Require exact lifeAmount (not at-least). */
  readonly exactLife?: boolean;
  /** "your graveyard" / "an opponent's graveyard". Absent or any is every graveyard. */
  readonly zoneOwner?: 'you' | 'not_you' | 'any';
  /** "your library" is the source's. "their library" is the actor's. */
  readonly libraryOwner?: 'source' | 'subject' | 'any';
  /** "one or more" is recorded for the emitter. The matcher still tests one object. */
  readonly quantity: 'one' | 'one_or_more';
  readonly alternatives: readonly TriggerConditionAlternative[];
  /** Spell cast only. Absent means any zone. */
  readonly castFromZone?: TriggerCastZone;
  /** "your first spell each turn". Absent means any spell that turn. */
  readonly ordinal?: TriggerOrdinal;
  /** "that targets you". */
  readonly targets?: TriggerTargetRelation;
  /** Phase steps. "your" / "each player's" / "each opponent's". */
  readonly whoseTurn?: TriggerWhoseTurn;
  /** "a +1/+1 counter is put on". Absent means any counter. */
  readonly placedCounter?: string;
  /** "attacks while saddled". Requires source.saddled. */
  readonly requiresSaddled?: boolean;
  /** "this land enters untapped". Fails closed unless source.tapped === false. */
  readonly requiresUntapped?: boolean;
  /** "to a player or planeswalker/battle": also fires when a planeswalker was the recipient. */
  readonly orPlaneswalkerRecipient?: boolean;
  /** Parsed for census and display only; a dedicated legacy runtime fires it, so the IR matcher fails closed. */
  readonly legacyRuntimeOnly?: boolean;
  /** "during combat": fails only when the context says the game is not in combat. */
  readonly duringCombat?: boolean;
  /** "with the chosen name". */
  readonly requiresChosenName?: boolean;
  /** "other than the first spell they cast each turn". */
  readonly excludeFirstSpellEachTurn?: boolean;
  /** Also fires when the subject is a spell copy. */
  readonly orSpellCopy?: boolean;
  /** "that has an Adventure". */
  readonly hasAdventure?: boolean;
  /** "you or a permanent you control becomes the target". */
  readonly orControllerPlayer?: boolean;
  /** "becomes attached to this creature": attachment host must be the trigger source. */
  readonly attachedToSource?: boolean;
  /** "the fourth plan counter": the Nth counter of placedCounter. */
  readonly counterOrdinal?: number;
  /** "while it's exiled". */
  readonly whileExiled?: boolean;
  /** "a spell or ability an opponent controls causes you to discard". */
  readonly causedByOpponent?: boolean;
  /** "a spell or ability you control exiles...". */
  readonly causedByYou?: boolean;
  /** "when you spend this mana to cast ..." — cast used mana from the source. */
  readonly requiresSourceMana?: boolean;
  /** "when you next cast ... this turn" (delayed, one-shot). */
  readonly nextSpellThisTurn?: boolean;
  /** "blocks or becomes blocked by a nonblack creature". Fails closed without context.blockPartner. */
  readonly blockPartner?: TriggerSubjectFilter;
  /** "creature with the same name" as the source. */
  readonly sameNameAsSource?: boolean;
  /** "becomes blocked by two or more creatures". */
  readonly minBlockers?: number;
  /** Block partner must have been dealt damage this turn. */
  readonly blockPartnerDealtDamageThisTurn?: boolean;
  /** "a creature that fought this way". */
  readonly foughtThisWay?: boolean;
  /** "a player other than this permanent's owner controls it". */
  readonly controllerNotOwner?: boolean;
  /** Attack batch excludes the source (non-~ / non-Name). */
  readonly excludeSourceFromAttackers?: boolean;
  /** Exclude creatures sharing the source's name word (non-Gideon). */
  readonly excludeAttackerName?: string;
  /** Opponent must control a permanent named X. */
  readonly requiresOpponentControlsNamed?: string;
  readonly requireSubjectName?: string;
  readonly lifeMaximum?: number;
  readonly lifeMinimum?: number;
  readonly hasKeyword?: string;
  readonly excludeSource?: boolean;
  readonly fromYou?: boolean;
  readonly attackDifferentPlayers?: boolean;
  readonly sagaSubject?: boolean;
  readonly delayedNextAttack?: boolean;
  readonly spellNotOwned?: boolean;
  /** "whenever a player kicks a spell". */
  readonly kickedSpell?: boolean;
  readonly requireEquippedAttacker?: boolean;
  readonly hasXInCost?: boolean;
  readonly dealtDamageBySource?: boolean;
  readonly requireToken?: boolean;
  readonly sourceIsDiscarded?: boolean;
  readonly upkeepOrdinal?: "first" | "second";
  readonly withoutBeingPlayed?: boolean;
  readonly noSharedCreatureTypeWithBattlefieldOrGraveyard?: boolean;
  readonly sharesColorOrManaValueWithExiled?: boolean;
  readonly sameNameAsExiledWithSource?: boolean;
  readonly linkedWithSource?: boolean;
  readonly putOntoBattlefieldWithSource?: boolean;
  readonly lifeGainCausedByWhiteInstantOrSorcery?: boolean;
  readonly abilitySourceNamed?: string;
  readonly abilitySourceType?: string;
  readonly chosenPowerOrToughness?: boolean;
  readonly thisTurn?: boolean;
  readonly minAttackers?: number;
  readonly thisWay?: boolean;
  readonly enchantedOpponent?: boolean;
  readonly targetsOnlyNonland?: boolean;
  readonly targetsOpponent?: boolean;
  readonly orHasKeyword?: string;
  readonly basicLand?: boolean;
  readonly nonland?: boolean;
  readonly includeSource?: boolean;
  readonly counterMinimum?: number;
  readonly sourceAmongAttackers?: boolean;
  readonly abilityResolves?: boolean;
  readonly resolveOrdinal?: number;
  readonly chosenPlayer?: boolean;
  readonly manaValueLessThanResult?: boolean;
  readonly powerBecomes?: number;
  readonly damageRecipientOwner?: boolean;
  readonly blockPartnerLesserPower?: boolean;
  readonly orPlayerSubject?: boolean;
  readonly minTotalPower?: number;
  readonly requireAttackerName?: string;
  readonly chosenName?: boolean;
  readonly spellManaValue?: number;
  readonly chosenManaValue?: boolean;
  readonly minDamageAmount?: number;
  readonly naturalRoll?: number;
  readonly exiledWithSource?: boolean;
  readonly manaValueEqualsChargeCounters?: boolean;
  readonly damagePrevented?: boolean;
  readonly cumulativeUpkeepUnpaid?: boolean;
  readonly losesGame?: 'chosen_player' | 'enchanted_player' | 'any' | 'not_you';
  readonly loyaltyMaximum?: number;
  readonly chargeCounterMinimum?: number;
  readonly emptyZone?: 'hand' | 'graveyard';
  readonly targetsOnlySubtype?: string;
  readonly destroyedByOpponent?: boolean;
  /** Battalion: how many other creatures must attack with the subject. */
  readonly minOtherAttackers?: number;
  /** "becomes level N" (Class). */
  readonly classLevel?: number;
  /** "attacks you or a planeswalker you control". Needs context.attackedPlayerId. */
  readonly attackedPlayer?: 'you' | 'enchanted' | 'opponent' | 'any';
  /** "attacks you": the attack must target the player, not a planeswalker or battle. Needs context.attackedTargetIsPlayer. */
  readonly attackedTargetType?: 'player';
  /** "deals combat damage to enchanted player". Needs context.damagedPlayerId. */
  readonly damagedPlayer?: 'enchanted' | 'you';
  /** "a land enchanted player controls enters". */
  readonly subjectControlledBy?: 'enchanted_player';
  /** Subject is a player ("you become the target"). Needs context.subjectIsPlayer. */
  readonly playerSubject?: boolean;
  /** "becomes the target of a spell or ability [you control | an opponent controls]". */
  readonly targetedBy?: { readonly controller: TriggerControllerRelation; readonly kind: 'spell' | 'ability' | 'spell_or_ability' };
  /** Ability word / keyword ability name on the targeting ability ("backup"). */
  readonly abilityWord?: string;
  /** "deals damage to an opponent / a player / a creature". */
  readonly damageRecipient?: 'any' | 'player' | 'opponent' | 'creature';
}

export interface TriggerMatchPermanent {
  readonly id: string;
  readonly name?: string;
  readonly typeLine: string;
  readonly controllerId: string;
  readonly isToken?: boolean;
  /** Changeling: every creature type. Does not add card types such as artifact. */
  readonly hasAllCreatureTypes?: boolean;
  /** Keywords the object currently has. Required for "with flying". */
  readonly keywords?: readonly string[];
  readonly counters?: Readonly<Record<string, number>>;
  readonly power?: number;
  /** Printed / base power, for "power greater than its base power". */
  readonly basePower?: number;
  /** CR 700.9 modified creature. */
  readonly modified?: boolean;
  /** Has Equipment attached. */
  readonly equipped?: boolean;
  readonly toughness?: number;
  readonly faceDown?: boolean;
  readonly goaded?: boolean;
  readonly attackingOrBlocking?: boolean;
  readonly attacking?: boolean;
  readonly blocking?: boolean;
  readonly isCommander?: boolean;
  readonly ownerId?: string;
  readonly colors?: readonly string[];
  /** Mana value (spells / permanents); required for "with mana value N or greater". */
  readonly manaValue?: number;
  /** The spell was kicked. */
  readonly kicked?: boolean;
  /** Spell/card has an Adventure half. */
  readonly hasAdventure?: boolean;
}

export interface TriggerMatchSource {
  readonly id: string;
  readonly controllerId: string;
  /** Aura or Equipment: the permanent it is attached to. */
  readonly attachedToId?: string;
  /** "of the chosen type". */
  readonly chosenCreatureType?: string;
  /** Mount currently saddled. */
  readonly saddled?: boolean;
  /** As-you-choose name (Curse of Silence). */
  readonly chosenCardName?: string;
  /** As-you-choose color letter (w/u/b/r/g). */
  readonly chosenColor?: string;
  /** Source is tapped now. Needed by requiresUntapped. */
  readonly tapped?: boolean;
}

export interface TriggerMatchContext {
  readonly castFromZone?: string;
  /** True during any combat step; undefined when the caller does not know. */
  readonly inCombat?: boolean;
  /** Permanent id the subject just attached to (becomes_attached). */
  readonly attachedToId?: string;
  /** 1 is the first spell that player has cast this turn. */
  readonly spellOrdinal?: number;
  /** Printed name of the cast/copied spell. */
  readonly spellName?: string;
  /** The event subject is a spell or ability copy. */
  readonly isSpellCopy?: boolean;
  /** Fallback chosen name when the source does not carry one. */
  readonly chosenCardName?: string;
  readonly targetControllerId?: string;
  /** Permanent ids the spell targets. Required for targets 'self'. */
  readonly targetPermanentIds?: readonly string[];
  /** Targeted permanents' type lines and controllers. Required for targets 'creature' / 'creature_you_control'. */
  readonly lifeAmount?: number;
  readonly targetPermanents?: readonly { readonly typeLine: string; readonly controllerId: string }[];
  readonly activePlayerId?: string;
  readonly enchantedPlayerId?: string;
  readonly monarchPlayerId?: string;
  readonly chosenPlayerId?: string;
  /** "dealt damage by this creature this turn". */
  readonly dealtDamageBySource?: boolean;
  /** "dealt damage by equipped creature this turn". */
  readonly dealtDamageByEquipped?: boolean;
  /** Library the search or shuffle acted on. */
  readonly libraryOwnerId?: string;
  /** Graveyard the card entered or left. */
  readonly zoneOwnerId?: string;
  /** Zone the object came from. "battlefield" is required for from-battlefield clauses. */
  readonly fromZone?: string;
  readonly damageKind?: string;
  readonly excessDamage?: boolean;
  readonly toZone?: string;
  readonly enchantedControllerId?: string;
  readonly exiledCardOwnerId?: string;
  /** The other creature in a block. Required for blockPartner filters. */
  readonly blockPartner?: TriggerMatchPermanent;
  /** Creatures declared as attackers this combat (attacks_alone / attacks_in_group). */
  readonly attackerCount?: number;
  /** Player the subject attacked (a planeswalker or battle resolves to its controller / protector). */
  readonly attackedPlayerId?: string;
  /** The subject attacked a player directly (not a planeswalker or battle). */
  readonly attackedTargetIsPlayer?: boolean;
  /** Player dealt combat damage (deals_combat_damage_to_player watchers). */
  readonly damagedPlayerId?: string;
  /** Ability word on the ability that targeted ("backup"). */
  readonly abilityWord?: string;
  /** Level a Class just reached (class_level). */
  readonly classLevel?: number;
  /** The event subject is a player (pseudo-subject), not a permanent. */
  readonly subjectIsPlayer?: boolean;
  /** A targeted object is a player (targets you / an opponent). */
  readonly targetIsPlayer?: boolean;
  /** Referenced / delayed-trigger player ("that player"). */
  readonly thatPlayerId?: string;
  readonly referencedPlayerId?: string;
  /** Controller of the targeting spell or ability, and which it is. */
  readonly targetingControllerId?: string;
  readonly targetingKind?: 'spell' | 'ability';
  /** Player dealt the damage, or the damaged permanent is a creature. */
  readonly damageRecipientPlayerId?: string;
  readonly damageRecipientIsCreature?: boolean;
  readonly blockerCount?: number;
  readonly blockPartnerDealtDamageThisTurn?: boolean;
  readonly foughtThisWay?: boolean;
  readonly controllerId?: string;
  readonly sourceControllerId?: string;
  readonly opponentControlsNamed?: readonly string[];
  readonly totalAttackerPower?: number;
  readonly damageAmount?: number;
  readonly naturalRoll?: number;
  readonly chargeCountersOnSource?: number;
  readonly damagePrevented?: boolean;
  readonly loyaltyCounters?: number;
  readonly spellManaValue?: number;
  readonly spellColors?: readonly string[];
  readonly abilityResolveCount?: number;
  readonly revealedManaValue?: number;
  readonly rollResult?: number;
  readonly subjectPower?: number;
  readonly chosenManaValue?: number;
  readonly playerLife?: number;
  readonly attackedPlayerIds?: readonly string[];
  readonly spellOwnerId?: string;
  readonly previousControllerId?: string;
  readonly upkeepOrdinal?: number | "first" | "second";
  readonly withoutBeingPlayed?: boolean;
  readonly exiledCardManaValue?: number;
  readonly exiledCardColors?: readonly string[];
  readonly exiledCardNames?: readonly string[];
  readonly sharesCreatureTypeWithBattlefield?: boolean;
  readonly sharesCreatureTypeWithGraveyard?: boolean;
  readonly lifeGainFromWhiteInstantOrSorcery?: boolean;
  readonly abilitySourceName?: string;
  readonly abilitySourceTypeLine?: string;
  readonly linkedToSource?: boolean;
  readonly spellPower?: number;
  readonly spellToughness?: number;
}
