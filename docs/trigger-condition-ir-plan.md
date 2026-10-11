# Trigger condition IR

Detection is still a per-family regex. Effect IR already owns what a trigger does. This plan is only the **when**: one condition record and one matcher, migrated one event family at a time.

The live game does not use rules-engine `checkTrigger`. Server `detect*Triggers` plus family emitters do. A family is migrated only when that emitter calls the shared matcher. Parsing in the rules engine alone does not count.

## Record

```ts
{
  event: 'dies' | 'put_into_graveyard' | …,
  fromZone?: 'battlefield' | 'anywhere',
  quantity: 'one' | 'one_or_more',   // batching stays in the emitter
  alternatives: [{
    controller: 'any' | 'you' | 'not_you',
    source: 'any' | 'another' | 'self' | 'self_or_another',
    subject: {
      anyObject: boolean,
      typeGroups: string[][],       // inner AND, outer OR
      excludedWords: string[],      // nonartifact, non-Human
      supertypes: string[],         // legendary, basic, snow, world
      token: 'any' | 'token' | 'nontoken',
    },
  }],
}
```

Intervening-if stays a separate check (evaluated on trigger and on resolution). Reflexive “when you do”, delayed “at the beginning of the next end step”, undying, persist, storm, and hideaway stay keyword or delayed handlers.

Leave these fields empty until a family needs them: ordinal (“the second time”), cast zone, “targets you”, counters, power/toughness, “dealt damage by”, enchanted/equipped object, chosen type. A parser that cannot represent the whole clause returns null. The old detector keeps that clause. Do not add event names that smuggle the subject or the controller back into the event.

Compound lines (“enters or dies”) are two records sharing one effect.

## Matcher

`triggerConditionMatches(condition, subject, source)` compares the record to the event payload. It does not re-parse oracle text. Type words use word boundaries. Changeling counts as every creature type for an excluded subtype (`non-Human`), and does not invent card types (`nonartifact`).

## Migration ratchet

Same shape as effect IR:

1. Parser for that family’s subject clause. Null unless the clause is fully consumed.
2. Emitter calls the matcher when parse succeeds, otherwise the existing regex.
3. Tests for the axes (controller, another, token, AND/OR types, exclusion, supertype).
4. Run that family’s detection tests. Delete the family’s regex only after parity, not in the same change as the parser.

`npm run trigger:coverage` stays the corpus gate once a family is ready to drop its regex.

## Family order

| Order | Family | Why |
| --- | --- | --- |
| 1 | Dies subject clauses | Watcher scan already funnels through `deathTriggerClauseMatchesDyingCreature`. First slice parses only the four-axis clauses. |
| 2 | ETB | Same axes (`another`, `you control`, typed). |
| 3 | Attacks / blocks | Same axes, plus attack restrictions later. |
| 4 | Tap / untap | Aura and equipment relations. |
| 5 | Spell cast | Needs cast zone, “first this turn”, and “targets you” before it can leave the regex. |
| Last | Phase triggers | Whose step, not a subject filter. |

## Landed

Shared types, subject parser, and matcher: `rules-engine/src/triggerCondition/`. Family parsers: enters (including “under your control”), attacks, blocks, becomes tapped/untapped (enchanted and equipped), spell cast (zone, first/second, targets you), and phase steps (your / each player’s / each opponent’s).

Emitters call the matcher when the clause parses. Anything the record cannot represent stays on the old filter. Detection regexes are still in place.

| Family | Emitter |
| --- | --- |
| Dies | `deathTriggerClauseMatchesDyingCreature` |
| ETB | `shouldQueueTypedPermanentEtbTrigger`, `matchesRequiredTypePhrase` |
| Attacks | `planAttackWatcherQueue` for permanent / another / opponent / any / nontoken, plus typed phrases the subject parser accepts |
| Blocks | `getBlockTriggersForCreatures` watcher scan for any / you control / opponent / enchanted / equipped |
| Tap / untap | `getTapTriggers`, `getBecomesUntappedTriggers` for creature, permanent, enchanted, and equipped |
| Spell cast | `getSpellCastTriggers`, `getOpponentSpellCastTriggers`, spell-cast untap. `first_*` and tribal/color/historic stay on the old switch. Zone is checked when the opponent trigger already has `sourceZoneRequirement`. |
| Phase | `shouldQueuePhaseTriggerForActivePlayer` for controller, each, opponent, and other. Enchanted, monarch, and chosen player stay on the old switch. |

## Subject holes (landed)

The subject parser now accepts creature subtypes (`Goblin`, including changeling), `with` / `without` a keyword (`flying`, `first strike`), and `this … or another …` as two alternatives. A bare `this creature` still falls through to the old dies string matcher so self-dies stay on the self scan.

`parseTriggerEventSentence` also reads “becomes tapped/untapped”, “you/an opponent/a player casts …”, and “at the beginning of” upkeep, draw, combat, and end step, including “combat on your turn”. Those lines queue from upkeep, draw step, beginning of combat, end step, tap, untap, and spell cast when the family detector did not already queue the same effect.

Also in the record: counters (`with a +1/+1 counter`, `with counters`), power and toughness (`4 or greater` / `or less`), chosen type, dealt damage by this or equipped creature this turn, commander, face-down, goaded, attacking or blocking, you own / you don't own, historic, and spell color. Spell tribal, historic, color, and first-noncreature use the matcher. First spell this turn uses `spellOrdinalForCaster`. Phase steps include enchanted player, the monarch, and the chosen player.

“When you do” / “If you do” and “at the beginning of the next end step” are split off the queued effect. A delayed end-step rider is registered when that ability resolves. A “when you do” rider is put on the stack then, after an optional “you may” was accepted, or immediately when the effect is not optional. Undying and persist match the printed keyword outside reminder text.

Search, shuffle, pay life, create a token, counter removed, exile from the battlefield, put into a graveyard, and leave a graveyard sentences queue the same way when the family detector missed that effect. “Your library” is the source’s library and “their library” is the actor’s. Graveyard sentences record whose graveyard and, for put-into-graveyard, “from anywhere” or “from the battlefield”. “From your library” stays on the old detector.
