# Effect Program Resolution Todo

This is the implementation checklist for the Effect Program architecture described in [effect-program-resolution-architecture.md](./effect-program-resolution-architecture.md).

## Phase 1: Runtime Foundation

- [x] Define typed `EffectProgram` steps for conditions, commands, choices, keywords, and notes.
- [x] Add a pure runner that can execute deterministic commands, pause for choices, bind responses, and resume.
- [x] Lower optional Oracle IR clauses into a choice plus guarded command.
- [x] Convert generated `choiceRequest`s into concrete rules-engine `ChoiceEvent`s without caller glue.
- [x] Add reusable Oracle IR command handlers that delegate to the existing Oracle IR executor.

## Phase 2: Queue Boundary

- [x] Add a server adapter that queues EffectProgram choice pauses through the Resolution Queue.
- [x] Add tests proving queued effect-program prompts carry program id, cursor, step id, binding key, and clause metadata.
- [x] Add a centralized persistence helper for effect-program prompt snapshots.
- [x] Add response-binding helpers that convert `ResolutionStepResponse` back into `ChoiceResponse` and resume metadata.

## Phase 3: First Live Migration Surface

- [x] Add a server-side EffectProgram resolution service that starts programs, queues the first pause, and resumes from queue responses.
- [x] Route completed `effectProgramPrompt` steps through the existing `submitResolutionResponse` flow.
- [x] Pick one narrow existing effect family and switch its live queue creation to `startEffectProgramResolution(...)`.
- [x] Replace ad hoc continuation flags for that family with EffectProgram bindings.
- [x] Persist effect-program resume evidence in replay events.
- [x] Keep the existing client modal and `submitResolutionResponse` path.

Recommended first candidates:

- optional `you may` into deterministic follow-up;
- target-then-effect clauses;
- graveyard selection into zone movement;
- `when you do` follow-ups after sacrifice or discard choices.

## Phase 4: Keyword and Oracle Expansion

- [x] Add a semantic keyword registry entry shape.
- [x] Lower supported keywords into EffectProgram templates.
- [x] Add a new-set import audit that reports new or changed keyword definitions needing registry work.
- [x] Add corpus tests for keyword template expansion.

## Phase 5: Replay Hardening

- [x] Store effect-program identity and cursor separately from socket prompt payloads.
- [x] Store choice bindings by `bindingKey`, not by completed queue history.
- [x] Add replay tests for declined optional effects, accepted optional effects, target binding, and `when you do` continuations.
- [x] Retire migrated ad hoc prompt flags only after equivalent replay coverage is green.

Compatibility note: migrated optional triggered ability prompts now use `effectProgramFamily: "optional_triggered_ability"`. `optionalTriggeredAbilityPrompt` remains readable only as a legacy fallback for old persisted prompts and replay fixtures.

## Post-Foundation Hardening

- [x] Lower ability-level and ordinary Oracle IR conditions into executable EffectProgram condition steps.
- [x] Bind target, player, mode, color, creature-type, and card-name choices back into Oracle IR execution context.
- [x] Populate target creature and opponent choice prompts from current game state.
- [x] Constrain color prompts from Oracle IR mana options when available.
- [x] Keep unsupported choice-heavy Oracle IR and partial keyword steps as command-side automation gaps instead of generic prompts.
- [x] Preserve non-option EffectProgram prompt fields through the Resolution Queue boundary.
- [x] Normalize object-shaped Resolution Queue selections into stable EffectProgram choice ids.
- [x] Add dedicated EffectProgram prompt and binding support for deterministic `you scry/surveil N` top-library choices.
- [x] Add two-stage EffectProgram opponent choice plus ordering support for deterministic `you fateseal N` top-library choices.
- [x] Promote supported top-library keyword actions through Oracle IR EffectProgram lowering instead of generic keyword prompts.
- [x] Hydrate live EffectProgram runtimes from `game.libraries` and sync library mutations back without persisting hidden library snapshots on players.
- [x] Fold temporary EffectProgram graveyard snapshots into `state.zones` instead of leaving card lists on player records.
- [x] Export reusable Oracle IR EffectProgram handlers for server resolution-service migrations.
- [x] Add server-boundary coverage for Oracle IR top-library prompts using live `game.libraries` and the reusable handler factory.
- [x] Promote deterministic Explore through EffectProgram using the existing `explore_decision` queue prompt, including keyword-registry support, Oracle IR command execution, server adapter preservation, and focused rules-engine/server tests.
- [x] Promote Proliferate through EffectProgram using the existing `proliferate` queue prompt, including target discovery from live counters, selected-target command execution, keyword-registry support, server adapter preservation, and focused rules-engine/server tests.
- [x] Promote Clash through EffectProgram using the existing `clash` queue prompt, including opponent selection, per-player top/bottom decisions, `lastClashWon` binding for follow-up conditions, keyword-registry support, server adapter preservation, and focused rules-engine/server tests.
- [x] Promote amount-1 Populate through EffectProgram using the existing target-selection prompt, including live creature-token discovery, selected-token copy execution, keyword-registry support, and focused rules-engine tests.
