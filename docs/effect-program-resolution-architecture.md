# Effect Program Resolution Architecture

## Design Goal

The long-term automation target is to translate Oracle text into executable card-effect programs. A card should be decomposed into clauses, intervening-if checks, targets, choices, keyword actions, references to prior choices, and deterministic state changes. The system should then resolve those pieces in order until the battlefield, stack, zones, and player state reflect the effect.

The existing Resolution Queue remains important, but its role should be narrower than the full effect engine. It should coordinate interactions with players and AI. The effect program should own the clause-level execution model.

## Layering

```text
Oracle text
-> Oracle IR / keyword expansions
-> EffectProgram clause steps
-> EffectProgramExecutor
-> ChoiceEvent pause when input is required
-> Resolution Queue prompt
-> ChoiceResponse binding
-> EffectProgramExecutor resumes
-> typed game-state commands apply changes
```

## Responsibilities

### Oracle IR and Keyword Registry

- Parse current Oracle text into structured clauses.
- Recognize keyword abilities and keyword actions from the imported Comprehensive Rules.
- Expand known keywords into semantic templates, not string snippets.
- Preserve raw clause text for audit and automation-gap reporting.

Examples:

- `vigilance` becomes a static combat restriction modifier.
- `annihilator N` becomes an attack trigger that asks the defending player to sacrifice N permanents.
- `collect evidence N` becomes an additional-cost choice over graveyard cards whose total mana value is at least N.
- `scry N`, `surveil N`, and `fateseal N` lower through the Oracle IR EffectProgram compiler when their player/opponent shape is deterministic enough for the current prompt contracts.
- New or changed keyword definitions from set updates should become registry updates plus tests before cards using the keyword are considered automated.

### EffectProgram

The EffectProgram is the executable representation of a card effect. It contains internal clause steps such as:

- `condition`: check intervening-if, ordinary if, where, or as-long-as clauses.
- `command`: apply deterministic operations such as draw, lose life, move zone, add counters, create tokens, or apply continuous effects.
- `choice`: pause for player or AI input through a rules-engine `ChoiceEvent`.
- `keyword`: expand or execute a known keyword template.

The EffectProgram should preserve bindings for choices and targets. Later clauses should refer to bindings instead of reparsing text or searching completed queue history.

Current foundation support includes semantic prompts for mode selection, target creature selection, player/opponent choice, color choice, creature-type choice, card-name choice, scry, surveil, and fateseal. These prompts bind their responses by `bindingKey`, and the Oracle IR runner derives target, player, mode, color, creature-type, card-name, and top-library ordering execution context from those bindings when later command steps run. Fateseal uses two bound choices: the opponent selection first, then the top-library ordering prompt for that opponent.

Choice-heavy Oracle IR steps that do not yet have a semantic prompt shape should remain command-side automation gaps rather than becoming generic yes/no prompts. Examples include search-library ordering and more complex top-library card selection. Those need dedicated prompt contracts before they should become live Resolution Queue choices. Scry, surveil, and fateseal now use dedicated queue prompt contracts and only lower automatically for deterministic `you scry/surveil/fateseal N` Oracle IR shapes. The keyword registry marks those keyword actions supported because it delegates their expansion back through the Oracle IR EffectProgram compiler instead of creating generic keyword prompts.

### Resolution Queue

The Resolution Queue is the interaction boundary. It should answer: which player must make which choice now?

It should continue to provide:

- socket delivery and reconnect prompting;
- AI response handling;
- APNAP ordering;
- prompt cancellation and validation;
- replay-safe persistence of prompts and responses.

It should not become the only representation of internal effect execution. Deterministic clauses do not need to become socket-visible queue steps.

### Replay and Persistence

Replay should eventually persist the effect program identity, cursor, choice step id, and bound response. Current prompt snapshots can continue to work during migration, but new effect-program prompts should carry metadata that lets replay resume from an explicit program point instead of reconstructing context from ad hoc flags.

Prompt snapshots should keep resume metadata in the `effectProgram` block. The serialized `queuedResolutionStep` should carry the user-facing prompt fields, while `effectProgramId`, `effectProgramCursor`, `effectProgramStepId`, `effectProgramBindingKey`, and `effectProgramPrompt` stay out of the socket-facing step snapshot.

When live server EffectPrograms need top-library information, the resolution service temporarily hydrates the runtime state from `game.libraries`. After execution, library changes are written back to `game.libraries`, temporary `player.library` snapshots are stripped from `game.state.players` unless that field already existed, and temporary `player.graveyard` snapshots are folded into `game.state.zones[playerId].graveyard`. This keeps EffectPrograms able to reason about real libraries without making full hidden libraries part of the normal socket-facing state shape.

Live migrations that execute Oracle IR through the server resolution service should use the exported Oracle EffectProgram handler factory. It supplies the default choice-event builder, conditional evaluator, and Oracle IR command handler so callers can pass one handler object into `startEffectProgramResolution(...)` instead of duplicating private runner glue.

## Migration Strategy

1. Keep all existing Resolution Queue behavior intact.
2. Introduce EffectProgram types and a pure runner in the rules engine.
3. Add a server adapter that turns an EffectProgram choice pause into a queued `ResolutionStep` with resume metadata.
4. Convert one narrow effect family at a time from ad hoc server flags to EffectProgram execution.
5. Centralize prompt persistence for effect-program pauses.
6. Expand the keyword registry and Oracle IR compiler as new mechanics are implemented.

## First Migration Candidates

Good first targets are effects that already have queue support but suffer from continuation flags:

- optional `you may` clauses that continue into a deterministic effect;
- target-then-effect clauses such as `destroy target ...`;
- `when you do` follow-up clauses after sacrifice, discard, or pay choices;
- graveyard selection into zone movement;
- modal effects where selected mode descriptions already constrain resolution.

Avoid starting with full casting, full combat, or replacement effects. Those touch too many existing replay and socket contracts at once.

## Non-Goals For The First Pass

- Do not replace the Resolution Queue.
- Do not migrate all card effects at once.
- Do not rely on Comprehensive Rules imports to auto-implement unknown keywords. Imports identify and describe mechanics; implementation still requires semantic registry entries and tests.
- Do not make deterministic internal EffectProgram steps visible to clients unless a player or AI choice is required.

## Success Criteria

- New card automation can be expressed as typed effect-program steps instead of socket-specific flags.
- Player choices are represented as `ChoiceEvent`s and queued through the existing queue.
- Choice responses bind named values that later clauses can reference.
- Replay can identify the program, cursor, choice step, and response used to resume.
- Existing queue-backed behavior remains compatible during migration.
