/*
  Oracle IR Executor Coverage Audit

  Dry-runs Oracle IR execution against parsed triggered-ability effect text (and
  optionally full-card oracle IR) using a rich synthetic game fixture with
  pre-bound targets. Surfaces the gap between "parses cleanly" and "executes
  without skips" that the trigger-coverage audit does not measure.

  Run:
    npm run executor:coverage --workspace=server

  Optional env:
    EXECUTOR_COVERAGE_SCOPE=trigger_effects|full_card|both   (default: trigger_effects)
    EXECUTOR_COVERAGE_COMMANDER_ONLY=1|0                     (default: 1)
    EXECUTOR_COVERAGE_TOP=100
    EXECUTOR_COVERAGE_MAX_EXAMPLES=8
    EXECUTOR_COVERAGE_ONLY_GAPS=1
*/

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GameState, PlayerID } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../rules-engine/src/oracleIRExecutionTypes.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { getCopiedSpellReplaySteps } from '../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import type { TriggeredAbility } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  isIgnorableCardForIrGap,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outDir = path.join(__dirname, 'out');
const outPath = path.join(outDir, 'executor-coverage-audit.json');

type OracleCard = {
  oracle_id?: string;
  id?: string;
  name: string;
  type_line?: string;
  oracle_text?: string;
  card_faces?: Array<{ oracle_text?: string }>;
  games?: string[];
  digital?: boolean;
  oversized?: boolean;
  set_type?: string;
  border_color?: string;
  set?: string;
  legalities?: Record<string, string>;
};

export type ExecutorCoverageStatus =
  | 'fully_applied'
  | 'choice_required'
  | 'unsupported'
  | 'partial'
  | 'ir_gap'
  | 'no_steps'
  | 'impossible';

type Scope = 'trigger_effects' | 'full_card' | 'both';

type AuditArgs = {
  scope: Scope;
  commanderOnly: boolean;
  top: number;
  maxExamples: number;
  onlyGaps: boolean;
};

type StepCount = {
  total: number;
  unknown: number;
  recognized: number;
};

type ExecutionRecord = {
  status: ExecutorCoverageStatus;
  applied: number;
  skipped: number;
  choiceRequired: number;
  unsupported: number;
  impossible: number;
  reasonCodes: Record<string, number>;
  stepKinds: Record<string, number>;
};

type PatternRecord = {
  templateKey: string;
  event: string;
  count: number;
  statuses: ExecutorCoverageStatus[];
  exampleCards: string[];
  sampleEffect: string;
  topReasonCodes: string[];
  topSkippedKinds: string[];
};

type AuditStats = {
  cardsScanned: number;
  itemsScanned: number;
  byStatus: Record<ExecutorCoverageStatus, number>;
  byScope: Record<'trigger_effects' | 'full_card', number>;
  parseToExecuteGap: number;
};

function parseArgs(): AuditArgs {
  const scopeRaw = String(process.env.EXECUTOR_COVERAGE_SCOPE || 'trigger_effects').trim().toLowerCase();
  const scope: Scope =
    scopeRaw === 'full_card' || scopeRaw === 'both' ? scopeRaw : 'trigger_effects';

  return {
    scope,
    commanderOnly: String(process.env.EXECUTOR_COVERAGE_COMMANDER_ONLY ?? '1') !== '0',
    top: Math.max(1, Number(process.env.EXECUTOR_COVERAGE_TOP || 100) || 100),
    maxExamples: Math.max(1, Number(process.env.EXECUTOR_COVERAGE_MAX_EXAMPLES || 8) || 8),
    onlyGaps: String(process.env.EXECUTOR_COVERAGE_ONLY_GAPS || '') === '1',
  };
}

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = raw
    .replace(/\([^()]*\)/g, ' ')
    .replace(/\s+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 4 ? stripped : raw;
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function walkOracleSteps(
  steps: readonly OracleEffectStep[] | undefined,
  visit: (step: OracleEffectStep) => void
): void {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    visit(step);
    const record = step as Record<string, unknown>;
    if (Array.isArray(record.steps)) walkOracleSteps(record.steps as OracleEffectStep[], visit);
    if (Array.isArray(record.modes)) {
      for (const mode of record.modes as Array<{ steps?: readonly OracleEffectStep[] }>) {
        walkOracleSteps(mode?.steps, visit);
      }
    }
  }
}

export function countOracleSteps(steps: readonly OracleEffectStep[] | undefined): StepCount {
  let total = 0;
  let unknown = 0;
  walkOracleSteps(steps, (step) => {
    total += 1;
    if (String(step.kind || '') === 'unknown') unknown += 1;
  });
  return { total, unknown, recognized: Math.max(0, total - unknown) };
}

export function collectStepsFromIrText(text: string, cardName: string): readonly OracleEffectStep[] {
  const parsed = parseOracleTextToIR(effectTextForIrAudit(text), cardName);
  const out: OracleEffectStep[] = [];
  for (const ability of parsed.abilities || []) {
    for (const step of ability.steps || []) out.push(step);
  }
  return out;
}

export function effectTextForTriggeredDryRun(effect: string, interveningIf?: string): string {
  const trimmedEffect = String(effect || '').trim();
  const trimmedIf = String(interveningIf || '').trim();
  if (!trimmedEffect) return trimmedIf ? `If ${trimmedIf}` : '';
  if (!trimmedIf) return trimmedEffect;
  return `If ${trimmedIf}, ${trimmedEffect}`;
}

type AuditCardLike = {
  readonly name: string;
  readonly type_line?: string;
  readonly oracle_text?: string;
};

function collectCopySpellSteps(
  steps: readonly OracleEffectStep[]
): readonly Extract<OracleEffectStep, { kind: 'copy_spell' }>[] {
  const found: Extract<OracleEffectStep, { kind: 'copy_spell' }>[] = [];
  const visit = (step: OracleEffectStep): void => {
    if (step.kind === 'copy_spell') found.push(step);
    if (step.kind === 'conditional' && Array.isArray(step.steps)) {
      for (const nested of step.steps) visit(nested);
    }
    if (step.kind === 'choose_mode' && Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        for (const nested of Array.isArray(mode?.steps) ? mode.steps : []) visit(nested);
      }
    }
  };
  for (const step of steps) visit(step);
  return found;
}

function copyStepTargetsAbility(step: Extract<OracleEffectStep, { kind: 'copy_spell' }>): boolean {
  const targetText = step.target?.kind === 'raw' ? String(step.target.text || '').trim().toLowerCase() : '';
  return targetText.includes('ability');
}

export function enrichAuditStateAndContextForCopySteps(
  card: AuditCardLike,
  steps: readonly OracleEffectStep[],
  state: GameState,
  ctx: ReturnType<typeof buildOracleIRExecutionContext>
): { state: GameState; ctx: ReturnType<typeof buildOracleIRExecutionContext> } {
  const copySteps = collectCopySpellSteps(steps);
  if (copySteps.length === 0) return { state, ctx };

  let nextState = state;
  let nextCtx = ctx;
  const combinedOracle = String(card.oracle_text || getCombinedOracleText(card as any) || '').trim();

  if (copySteps.some((step) => step.subject === 'this_spell') && combinedOracle) {
    const replaySteps = getCopiedSpellReplaySteps({
      name: card.name,
      oracle_text: combinedOracle,
      type_line: card.type_line,
    });
    if (replaySteps.length > 0) {
      nextCtx = { ...nextCtx, copyReplaySteps: replaySteps };
    }
  }

  if (copySteps.some((step) => step.subject === 'target_spell')) {
    const wantsAbilityCopy = copySteps.some(copyStepTargetsAbility);
    if (wantsAbilityCopy) {
      nextCtx = {
        ...nextCtx,
        targetSpellId: 'stack-ability-1',
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          targetSpellId: 'stack-ability-1',
        },
      };
    }
  }

  if (copySteps.some((step) => step.subject === 'linked_exiled_cards')) {
    nextState = {
      ...(nextState as any),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const linkedSpell = {
          id: 'exile-linked-spell-1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          mana_cost: '{R}',
          cmc: 1,
          exiledWith: 'bf-source',
          exiledWithSourceId: 'bf-source',
        };
        if (!exile.some((entry: any) => String(entry?.id || '').trim() === linkedSpell.id)) {
          exile.unshift(linkedSpell);
        }
        return { ...player, exile };
      }),
    } as GameState;
  }

  if (copySteps.some((step) => step.subject === 'last_moved_card')) {
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [
        {
          id: 'gy-instant-1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          mana_cost: '{R}',
          cmc: 1,
        },
      ],
    };
  }

  return { state: nextState, ctx: nextCtx };
}

export function enrichAuditStateAndContextForTargets(
  steps: readonly OracleEffectStep[],
  state: GameState,
  ctx: ReturnType<typeof buildOracleIRExecutionContext>,
  options?: { readonly oracleText?: string }
): { state: GameState; ctx: ReturnType<typeof buildOracleIRExecutionContext> } {
  let nextCtx = ctx;
  let nextState = state;
  const needsX = steps.some((step) => /\bx\b/i.test(String(step.raw || '')));
  if (needsX && !Number.isFinite(Number(nextCtx.xValue))) {
    nextCtx = { ...nextCtx, xValue: 3 };
  }
  if (!Number.isFinite(Number(nextCtx.referenceAmount))) {
    nextCtx = { ...nextCtx, referenceAmount: 2 };
  }
  const needsVoteContext = steps.some((step) => /(?:sprout|strength) vote/i.test(String(step.raw || '')));
  if (needsVoteContext) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
      },
    };
  }

  let needsDiedCreatureCounters = false;
  walkOracleSteps(steps, (step) => {
    if (step.kind !== 'move_counters') return;
    const fromText = String((step as any).from?.text || '').trim().toLowerCase();
    const toText = String((step as any).to?.text || '').trim().toLowerCase();
    if (fromText === 'it' && /^this (?:creature|permanent)$/.test(toText)) {
      needsDiedCreatureCounters = true;
    }
  });
  if (needsDiedCreatureCounters) {
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: 'bf-creature-1',
          name: 'Grizzly Bears',
          type_line: 'Creature — Bear',
          power: 2,
          toughness: 2,
          counters: { '+1/+1': 2 },
        },
      ],
    } as typeof nextCtx;
  }

  const needsPutIntoGraveyardThisWay = steps.some((step) =>
    /put into your graveyard this way/i.test(String(step.raw || ''))
  );
  if (needsPutIntoGraveyardThisWay) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const updated = graveyard.map((card: any) => {
          const cardId = String(card?.id || '').trim();
          if (cardId !== 'gy-elf-1' && cardId !== 'gy-milled-1') return card;
          return { ...card, putIntoGraveyardTurn: 3 };
        });
        return { ...player, graveyard: updated };
      }),
    } as GameState;
  }

  const needsGerrardGyReturn = steps.some((step) =>
    /return to the battlefield all artifact and creature cards in your graveyard that were put there from the battlefield this turn/i.test(
      String(step.raw || '')
    )
  );
  if (needsGerrardGyReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const artifactCard = {
          id: 'gy-bf-artifact-1',
          name: 'Audit Artifact Return',
          type_line: 'Artifact',
          mana_cost: '{2}',
          cmc: 2,
          putIntoGraveyardTurn: 3,
        };
        if (graveyard.some((card: any) => String(card?.id || '').trim() === artifactCard.id)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, artifactCard] };
      }),
    } as GameState;
  }

  const needsWishesUnplayed = steps.some((step) =>
    /those cards you didn't play/i.test(String(step.raw || ''))
  );
  if (needsWishesUnplayed) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const wishCards = [
          {
            id: 'exile-wishes-played-1',
            name: 'Played Wish Card',
            type_line: 'Instant',
            playedFromWishes: true,
            wishesExileCandidate: true,
          },
          {
            id: 'exile-wishes-unplayed-1',
            name: 'Unplayed Wish Card',
            type_line: 'Sorcery',
            wishesExileCandidate: true,
          },
          {
            id: 'exile-wishes-unplayed-2',
            name: 'Unplayed Wish Land',
            type_line: 'Basic Land — Island',
            wishesExileCandidate: true,
          },
        ];
        const merged = [...exile];
        for (const card of wishCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
            merged.push(card);
          }
        }
        return { ...player, exile: merged };
      }),
    } as GameState;
  }

  const needsBothCardsOntoBattlefield = steps.some((step) =>
    /put both cards onto the battlefield/i.test(String(step.raw || ''))
  );
  if (needsBothCardsOntoBattlefield) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const ownedExile = {
          id: 'exile-owned-creature-1',
          name: 'Owned Audit Creature',
          type_line: 'Creature — Human',
          owner: 'p1',
        };
        const basicLand = {
          id: 'hand-basic-land-both-1',
          name: 'Plains',
          type_line: 'Basic Land — Plains',
        };
        return {
          ...player,
          hand: hand.some((card: any) => String(card?.id || '').trim() === basicLand.id)
            ? hand
            : [...hand, basicLand],
          exile: exile.some((card: any) => String(card?.id || '').trim() === ownedExile.id)
            ? exile
            : [...exile, ownedExile],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-owned-creature-1',
            'hand-basic-land-both-1',
          ])
        ),
      },
    };
  }

  const needsMorphFromHand = steps.some((step) =>
    /creature card with a morph ability from your hand/i.test(String(step.raw || ''))
  );
  if (needsMorphFromHand) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
        const morphCard = {
          id: 'hand-morph-1',
          name: 'Audit Morph Bear',
          type_line: 'Creature — Bear',
          oracle_text: 'Morph {2}',
          keywords: ['Morph'],
        };
        return {
          ...player,
          hand: hand.some((card: any) => String(card?.id || '').trim() === morphCard.id)
            ? hand
            : [...hand, morphCard],
        };
      }),
    } as GameState;
  }

  const needsThoseDragons = steps.some((step) => /one of those dragons/i.test(String(step.raw || '')));
  if (needsThoseDragons) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]),
        ...(((nextState.battlefield || []) as any[]).some((perm: any) =>
          String(perm?.type_line || perm?.card?.type_line || '')
            .toLowerCase()
            .includes('dragon')
        )
          ? []
          : [
              {
                id: 'bf-dragon-1',
                name: 'Audit Dragon',
                controller: 'p1',
                owner: 'p1',
                type_line: 'Creature — Dragon',
                card: { id: 'bf-dragon-1-card', name: 'Audit Dragon', type_line: 'Creature — Dragon' },
              },
            ]),
      ],
    } as GameState;
  }

  const needsSingleGraveyardSorceries = steps.some((step) =>
    /two target sorcery cards from a single graveyard/i.test(String(step.raw || ''))
  );
  if (needsSingleGraveyardSorceries) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const sorceries = [
          { id: 'gy-sorcery-1', name: 'Audit Sorcery One', type_line: 'Sorcery', cmc: 3 },
          { id: 'gy-sorcery-2', name: 'Audit Sorcery Two', type_line: 'Sorcery', cmc: 4 },
        ];
        const merged = [...graveyard];
        for (const card of sorceries) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
            merged.push(card);
          }
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-sorcery-1',
            'gy-sorcery-2',
          ])
        ),
      },
    };
  }

  const needsSameNameInGraveyard = steps.some((step) =>
    /a card with the same name is in a graveyard or a nontoken permanent with the same name is on the battlefield/i.test(
      String(step.raw || '')
    )
  );
  if (needsSameNameInGraveyard) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const duplicate = {
          id: 'gy-duplicate-spell-1',
          name: String(nextCtx.sourceName || 'Audit Source').trim(),
          type_line: 'Instant',
        };
        if (graveyard.some((card: any) => String(card?.name || '').trim() === duplicate.name)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, duplicate] };
      }),
    } as GameState;
  }

  const needsLesserMvThanDiedReturn = steps.some((step) =>
    /lesser mana value than the creature that died/i.test(String(step.raw || ''))
  );
  if (needsLesserMvThanDiedReturn) {
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: 'bf-died-reference',
          name: 'Dead Giant',
          type_line: 'Creature — Giant',
          cmc: 5,
          mana_cost: '{3}{G}{G}',
        },
      ],
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const lesserCreature = {
          id: 'gy-lesser-mv-1',
          name: 'Audit Cub',
          type_line: 'Creature — Bear',
          cmc: 2,
          mana_cost: '{1}{G}',
        };
        return {
          ...player,
          graveyard: graveyard.some((card: any) => String(card?.id || '').trim() === lesserCreature.id)
            ? graveyard
            : [...graveyard, lesserCreature],
        };
      }),
    } as GameState;
  }

  const needsUnderworldCerberusCompound = steps.some((step) =>
    /each player returns all creature cards from their graveyard to their hand/i.test(String(step.raw || ''))
  );
  if (needsUnderworldCerberusCompound) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (!playerId) return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const creatureCard = {
          id: `gy-${playerId}-cerberus-creature-1`,
          name: `Audit Creature ${playerId}`,
          type_line: 'Creature — Zombie',
          cmc: 2,
        };
        const hasSource =
          playerId === 'p1' &&
          graveyard.some((card: any) => {
            const cardId = String(card?.id || '').trim();
            return cardId === 'gy-source-self' || cardId.startsWith('gy-source');
          });
        const nextGraveyard = [...graveyard];
        if (playerId === 'p1' && !hasSource) {
          nextGraveyard.push({
            id: 'gy-source-self',
            name: String(nextCtx.sourceName || 'Audit Source').trim(),
            type_line: 'Creature — Dog',
            cmc: 3,
          });
        }
        if (!nextGraveyard.some((card: any) => String(card?.id || '').trim() === creatureCard.id)) {
          nextGraveyard.push(creatureCard);
        }
        return { ...player, graveyard: nextGraveyard };
      }),
    } as GameState;
  }

  const needsTargetNonlandTotalMvBounce = steps.some((step) =>
    /any number of target nonland permanents with total mana value/i.test(String(step.raw || ''))
  );
  if (needsTargetNonlandTotalMvBounce) {
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-treasure-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-treasure-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-1',
            'bf-treasure-1',
          ])
        ),
      },
    };
  }

  const needsDieRollContext = steps.some(
    step =>
      /\broll a d20\b/i.test(String(step.raw || '')) ||
      /equal to this vehicle's mana value/i.test(String((step as any).condition?.raw || step.raw || ''))
  );
  if (needsDieRollContext) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const vehicle = ((nextState.battlefield || []) as any[]).find(
      perm => String(perm?.id || '').trim() === sourceId
    );
    const vehicleMv = Number(vehicle?.cmc ?? vehicle?.card?.cmc ?? nextCtx.xValue ?? 3);
    nextState = {
      ...nextState,
      lastDieRoll: { playerId: 'p1', result: vehicleMv },
      lastDieRollByPlayer: { p1: { result: vehicleMv } },
    } as GameState;
  }

  const needsCommandZonePut = steps.some(step =>
    /\bfrom the command zone onto the battlefield\b/i.test(String(step.raw || ''))
  );
  if (needsCommandZonePut) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const commandZone = Array.isArray(player?.commandZone)
          ? [...player.commandZone]
          : Array.isArray(player?.command)
            ? [...player.command]
            : [];
        const entries = [
          {
            id: 'cmd-source-self',
            name: String(nextCtx.sourceName || 'Audit Commander').trim(),
            type_line: 'Legendary Creature — Human',
            cmc: 3,
            mana_cost: '{1}{U}{U}',
          },
          {
            id: String(nextCtx.sourceId || 'bf-source').trim(),
            name: String(nextCtx.sourceName || 'Audit Source').trim(),
            type_line: 'Legendary Creature — Bird Wizard',
            cmc: 3,
          },
        ];
        const merged = [...commandZone];
        for (const entry of entries) {
          if (!merged.some((card: any) => String(card?.id || '').trim() === entry.id)) {
            merged.push(entry);
          }
        }
        return { ...player, commandZone: merged, command: merged };
      }),
    } as GameState;
  }

  const needsCraftExileCard = steps.some(step => /used to craft this permanent/i.test(String(step.raw || '')));
  if (needsCraftExileCard) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const craftCreature = {
          id: 'exile-craft-creature-1',
          name: 'Crafted Pirate',
          type_line: 'Creature — Pirate',
          cmc: 2,
          exiledWith: sourceId,
          exiledWithSourceId: sourceId,
        };
        if (exile.some((entry: any) => String(entry?.id || '').trim() === craftCreature.id)) {
          return player;
        }
        return { ...player, exile: [...exile, craftCreature] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-craft-creature-1',
          ])
        ),
      },
    };
  }

  const needsMyraAttractionClause = steps.some(step =>
    /choose an attraction you control that doesn't have a midway counter on it/i.test(String(step.raw || ''))
  );
  if (needsMyraAttractionClause) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]),
        ...(((nextState.battlefield || []) as any[]).some((perm: any) =>
          String(perm?.type_line || '').toLowerCase().includes('attraction')
        )
          ? []
          : [
              {
                id: 'bf-attraction-1',
                name: 'Audit Attraction',
                controller: 'p1',
                owner: 'p1',
                type_line: 'Artifact — Attraction',
                card: {
                  id: 'bf-attraction-1-card',
                  name: 'Audit Attraction',
                  type_line: 'Artifact — Attraction',
                },
              },
            ]),
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const instant = {
          id: 'gy-myra-instant-1',
          name: 'Audit Instant',
          type_line: 'Instant',
          cmc: Number(nextCtx.xValue ?? 3),
        };
        if (graveyard.some((card: any) => String(card?.id || '').trim() === instant.id)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, instant] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-myra-instant-1',
          ])
        ),
      },
    };
  }

  const needsRingBearerTempt = steps.some(step =>
    /ring-bearer and the ring has tempted you two or more times/i.test(
      String((step as any).condition?.raw || step.raw || '')
    )
  );
  if (needsRingBearerTempt) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        return {
          ...player,
          ringTemptations: 2,
          ringBearerId: String(nextCtx.sourceId || 'bf-source'),
        };
      }),
    } as GameState;
  }

  const needsSharesTypeAmongThem = steps.some(step =>
    /shares a creature type with it from among them/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsSharesTypeAmongThem) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-among-them-1',
          ])
        ),
      },
    };
  }

  const needsTotalMvGyReanimate = steps.some(step =>
    /target creature cards with total mana value x or less from graveyards/i.test(String(step.raw || ''))
  );
  if (needsTotalMvGyReanimate) {
    nextCtx = { ...nextCtx, xValue: Number(nextCtx.xValue ?? 6) };
  }

  const needsAttachPirateTarget = steps.some(
    step => step.kind === 'attach' && /target pirate you control/i.test(String(step.raw || ''))
  );
  if (needsAttachPirateTarget) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]),
        ...(((nextState.battlefield || []) as any[]).some((perm: any) =>
          String(perm?.type_line || '').toLowerCase().includes('pirate')
        )
          ? []
          : [
              {
                id: 'bf-pirate-1',
                name: 'Audit Pirate',
                controller: 'p1',
                owner: 'p1',
                type_line: 'Creature — Pirate',
                power: 2,
                toughness: 2,
                card: { id: 'bf-pirate-1-card', name: 'Audit Pirate', type_line: 'Creature — Pirate' },
              },
            ]),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-pirate-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-pirate-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-pirate-1',
          ])
        ),
      },
    };
  }

  const needsAuraReattach = steps.some(
    step =>
      step.kind === 'attach' &&
      /target aura attached to a creature|all auras enchanting target permanent/i.test(String(step.raw || ''))
  );
  if (needsAuraReattach) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).map((perm: any) => {
          if (String(perm?.id || '').trim() !== 'bf-enchantment-1') return perm;
          return { ...perm, attachedTo: 'bf-creature-1' };
        }),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-creature-1',
      targetCreatureId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-creature-1',
        targetCreatureId: 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-enchantment-1',
            'bf-creature-2',
          ])
        ),
      },
    };
  }

  const needsContextualThemSplit = steps.some(
    step =>
      step.kind === 'move_zone' &&
      /(?:any number of them|(?:two|three|four|five) of them|(?:two|three|four|five) of those cards)/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsContextualThemSplit) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player?.library) ? [...player.library] : [];
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const revealedCards = [
          { id: 'exile-split-1', name: 'Split Card One', type_line: 'Instant', cmc: 2 },
          { id: 'exile-split-2', name: 'Split Card Two', type_line: 'Sorcery', cmc: 3 },
          { id: 'exile-split-3', name: 'Split Land', type_line: 'Basic Land — Forest' },
          {
            id: 'exile-split-4',
            name: 'Split Creature',
            type_line: 'Creature — Human',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
          {
            id: 'exile-split-5',
            name: 'Split Vehicle',
            type_line: 'Artifact — Vehicle',
            cmc: 3,
            power: '3',
            toughness: '3',
          },
          { id: 'exile-revealed-artifact-1', name: 'Revealed Artifact', type_line: 'Artifact', cmc: 2 },
          {
            id: 'exile-revealed-creature-1',
            name: 'Revealed Bear',
            type_line: 'Creature — Bear',
            cmc: 2,
            power: '2',
            toughness: '2',
          },
          { id: 'exile-revealed-assassin-1', name: 'Revealed Assassin', type_line: 'Creature — Assassin', cmc: 2 },
          { id: 'exile-revealed-pirate-1', name: 'Revealed Pirate', type_line: 'Creature — Pirate', cmc: 2 },
        ];
        for (const card of revealedCards) {
          if (!exile.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
            exile.push(card);
          }
        }
        return { ...player, library, exile };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [
        { id: 'gy-milled-land-1', name: 'Milled Plains', type_line: 'Basic Land — Plains' },
        { id: 'gy-milled-1', name: 'Milled This Turn', type_line: 'Creature — Zombie', cmc: 2, milledTurn: 3 },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-split-1',
            'exile-split-2',
            'exile-split-3',
            'exile-split-4',
            'exile-split-5',
            'exile-revealed-artifact-1',
            'exile-revealed-creature-1',
            'exile-revealed-assassin-1',
            'exile-revealed-pirate-1',
            'gy-milled-land-1',
            'gy-milled-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsMilledLandToHand = steps.some(step =>
    /a land card from among the milled cards/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsMilledLandToHand) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const milledLand = {
          id: 'gy-milled-land-1',
          name: 'Milled Plains',
          type_line: 'Basic Land — Plains',
          milledTurn: 3,
        };
        if (graveyard.some((card: any) => String(card?.id || '').trim() === milledLand.id)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, milledLand] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [
        { id: 'gy-milled-land-1', name: 'Milled Plains', type_line: 'Basic Land — Plains', milledTurn: 3 },
        { id: 'gy-milled-1', name: 'Milled This Turn', type_line: 'Creature — Zombie', cmc: 2, milledTurn: 3 },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-milled-land-1',
          ])
        ),
      },
    };
  }

  const needsAmongThemReveal = steps.some(step =>
    /from among them/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsAmongThemReveal) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const revealedCards = [
          { id: 'exile-among-green-1', name: 'Green Bear', type_line: 'Creature — Bear', colors: ['G'], cmc: 2 },
          { id: 'exile-among-green-2', name: 'Green Elf', type_line: 'Creature — Elf', colors: ['G'], cmc: 1 },
          { id: 'exile-revealed-assassin-1', name: 'Revealed Assassin', type_line: 'Creature — Assassin', cmc: 2 },
          { id: 'exile-revealed-pirate-1', name: 'Revealed Pirate', type_line: 'Creature — Pirate', cmc: 2 },
          {
            id: 'exile-revealed-vehicle-1',
            name: 'Revealed Vehicle',
            type_line: 'Artifact — Vehicle',
            cmc: 3,
            power: '4',
            toughness: '4',
          },
        ];
        for (const card of revealedCards) {
          if (!exile.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
            exile.push(card);
          }
        }
        return { ...player, exile };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-among-green-1',
            'exile-revealed-assassin-1',
            'exile-revealed-pirate-1',
            'exile-revealed-vehicle-1',
          ])
        ),
      },
    };
  }

  let needsDiscardedThisWay = false;
  let needsBuybackPaid = false;
  walkOracleSteps(steps, (step) => {
    const conditionRaw = String((step as any).condition?.raw || '').trim().toLowerCase();
    const stepRaw = String(step.raw || '').trim().toLowerCase();
    if (/discarded this way/.test(conditionRaw) || /discarded this way/.test(stepRaw)) {
      needsDiscardedThisWay = true;
    }
    if (/buyback cost was paid/.test(conditionRaw) || /buyback cost was paid/.test(stepRaw)) {
      needsBuybackPaid = true;
    }
  });

  const oracleText = String(options?.oracleText || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .toLowerCase();
  if (oracleText) {
    if (/discarded this way/.test(oracleText)) {
      needsDiscardedThisWay = true;
    }
  }

  if (needsDiscardedThisWay) {
    nextCtx = {
      ...nextCtx,
      lastDiscardedCards: [
        {
          id: 'audit-discard-creature-1',
          name: 'Discarded Creature',
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'audit-discard-noncreature-1',
          name: 'Discarded Instant',
          type_line: 'Instant',
          cmc: 1,
        },
      ],
    };
  }

  let needsContextualCardAmount = false;
  let needsSacrificedAmount = false;
  let needsThatSpellAmount = false;
  walkOracleSteps(steps, (step) => {
    const text = String(step.raw || '')
      .replace(/[\u2019]/g, "'")
      .trim()
      .toLowerCase();
    if (/that (?:card|creature)(?:'|\u2019)?s (?:mana value|power|toughness)|equal to that card/i.test(text)) {
      needsContextualCardAmount = true;
    }
    if (/sacrificed (?:creature|permanent)/i.test(text)) {
      needsSacrificedAmount = true;
    }
    if (/that spell(?:'|\u2019)?s mana value/i.test(text)) {
      needsThatSpellAmount = true;
    }
  });

  const oracleTextForAmounts = oracleText;
  if (oracleTextForAmounts) {
    if (/that (?:card|creature)(?:'|\u2019)?s (?:mana value|power|toughness)|equal to that card/i.test(oracleTextForAmounts)) {
      needsContextualCardAmount = true;
    }
    if (/sacrificed (?:creature|permanent)/i.test(oracleTextForAmounts)) {
      needsSacrificedAmount = true;
    }
    if (/that spell(?:'|\u2019)?s mana value/i.test(oracleTextForAmounts)) {
      needsThatSpellAmount = true;
    }
  }

  const needsGyReturnThatCardAmount = steps.some((step) =>
    /return target creature card from your graveyard/i.test(String(step.raw || ''))
  ) || /return target creature card from your graveyard/i.test(oracleTextForAmounts);
  if (needsGyReturnThatCardAmount) {
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [
        {
          id: 'gy-creature-1',
          name: 'Gravecrawler',
          type_line: 'Creature — Zombie',
          cmc: 2,
          mana_cost: '{B}',
        },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: [
          'gy-creature-1',
          ...((nextCtx.selectorContext?.chosenObjectIds || []) as readonly string[]).filter(
            (id) => String(id || '').trim() !== 'gy-antecedent-1'
          ),
        ],
      },
    } as typeof nextCtx;
  }

  if (needsContextualCardAmount) {
    const contextualCard = {
      id: 'audit-context-card-1',
      name: 'Context Card',
      type_line: 'Instant',
      cmc: 3,
      mana_cost: '{1}{U}',
      power: 4,
      toughness: 3,
    };
    nextCtx = {
      ...nextCtx,
      lastMovedCards: Array.isArray(nextCtx.lastMovedCards) ? nextCtx.lastMovedCards : [contextualCard],
      lastDiscardedCards: Array.isArray((nextCtx as any).lastDiscardedCards)
        ? (nextCtx as any).lastDiscardedCards
        : [contextualCard],
    } as typeof nextCtx;
  }

  if (needsSacrificedAmount) {
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: 'bf-sacrificed-1',
          name: 'Sacrificed Creature',
          typeLine: 'Creature — Human',
          type_line: 'Creature — Human',
          power: 5,
          toughness: 4,
          manaValue: 3,
          cmc: 3,
          mana_cost: '{2}{G}',
        },
      ],
    } as typeof nextCtx;
  }

  if (needsThatSpellAmount) {
    nextCtx = {
      ...nextCtx,
      lastCastSpellManaValue: 4,
      targetSpellManaValue: 4,
    } as typeof nextCtx;
  }

  const needsChosenLetter = steps.some(
    (step) =>
      (step.kind === 'player_choice' && (step as any).choice === 'letter') ||
      /choose a letter|begins with the chosen letter/i.test(String(step.raw || ''))
  ) || /choose a letter|begins with the chosen letter/i.test(oracleTextForAmounts);
  if (needsChosenLetter) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenLetter: 'A',
      },
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
        return {
          ...perm,
          stickers: [
            { type: 'name', text: 'Audit Sticker A' },
            { type: 'name', text: 'Beta Sticker B' },
          ],
        };
      }),
    } as GameState;
  }

  const needsPayMana = steps.some((step) => step.kind === 'pay_mana');
  if (needsPayMana) {
    nextState = {
      ...nextState,
      manaPool: {
        p1: { white: 8, blue: 8, black: 8, red: 8, green: 8, colorless: 8 },
      },
      players: (nextState.players || []).map((player: any) =>
        String(player?.id || '').trim() === 'p1'
          ? {
              ...player,
              energy: Math.max(10, Number(player?.energy || 0)),
              energyCounters: Math.max(10, Number(player?.energyCounters || 0)),
              counters: {
                ...(player?.counters || {}),
                energy: Math.max(10, Number(player?.counters?.energy || 0)),
              },
            }
          : player
      ),
    } as GameState;
  }

  const classLevelSteps = steps.filter((step) => step.kind === 'gain_class_level');
  if (classLevelSteps.length > 0) {
    const maxTargetLevel = Math.max(...classLevelSteps.map((step) => Number((step as any).level) || 1));
    const seedLevel = Math.max(1, maxTargetLevel - 1);
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) =>
        String(perm?.id || '').trim() === String(nextCtx.sourceId || 'bf-source').trim()
          ? { ...perm, level: seedLevel }
          : perm
      ),
    } as GameState;
  }

  const needsTurnAmountStats = steps.some((step) =>
    /tokens you created this turn|exiled under your opponents' control this turn|mounts and\/or vehicles that entered|instant and sorcery spells you've cast this turn|opponents who control more lands|opponents with four or more cards in hand|counters it had on it|abilities from among flying|number of forests you control|creature in your party|blood token|looked at while scrying this way|cards? discarded this way|nonland cards? revealed this way|creature cards? put into your graveyard this way|color of mana spent to cast that spell|lore counter on this artifact|commander from the command zone this game|card in your hand until end of turn/i.test(
      String(step.raw || '')
    )
  );
  if (needsTurnAmountStats) {
    nextState = {
      ...nextState,
      tokensCreatedThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
      creaturesExiledUnderOpponentsControlThisTurn: { p1: 0, p2: 1, p3: 0, p4: 0 },
      mountsAndVehiclesEnteredBattlefieldThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
      instantAndSorcerySpellsCastThisTurn: { p1: 2, p2: 1, p3: 0, p4: 0 },
      scryLookedAtThisWay: 2,
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastScryLookedAtCount: 2,
      lastDiscardedCardCount: 2,
      lastRevealedCardCount: 2,
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() === 'bf-source') {
          return {
            ...perm,
            counters: { ...(perm?.counters || {}), '+1/+1': 2, lore: 2 },
            stickers: [
              { type: 'name', text: 'Audit Sticker A' },
              { type: 'name', text: 'Audit Sticker B' },
            ],
          };
        }
        if (String(perm?.id || '').trim() === 'bf-creature-1') {
          return {
            ...perm,
            attacking: true,
            counters: { ...(perm?.counters || {}), blood: 1 },
            oracle_text: 'Flying, first strike, lifelink',
            keywords: ['Flying', 'First Strike', 'Lifelink'],
          };
        }
        return perm;
      }),
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p2') {
          return {
            ...player,
            hand: [
              ...(Array.isArray(player.hand) ? player.hand : []),
              { id: 'hand-p2-extra', name: 'Extra Card', type_line: 'Instant' },
              { id: 'hand-p2-extra-2', name: 'Extra Card 2', type_line: 'Instant' },
              { id: 'hand-p2-extra-3', name: 'Extra Card 3', type_line: 'Instant' },
              { id: 'hand-p2-extra-4', name: 'Extra Card 4', type_line: 'Instant' },
            ],
          };
        }
        return player;
      }),
    } as GameState;
  }

  if (needsBuybackPaid) {
    nextState = {
      ...(nextState as any),
      buybackPaid: { p1: true },
      battlefield: ((nextState as any).battlefield || []).map((perm: any) =>
        String(perm?.id || '').trim() === String(nextCtx.sourceId || 'bf-source').trim()
          ? { ...perm, buybackPaid: true, paidBuyback: true }
          : perm
      ),
    } as GameState;
  }

  const needsEnchantedLand = steps.some(
    (step) =>
      /enchanted land/i.test(String(step.raw || '')) ||
      (step.kind === 'set_basic_land_type' && /enchanted land/i.test(String(step.raw || '')))
  );
  const needsEnchantedCreatureSacrifice = steps.some((step) =>
    /sacrifice enchanted creature|enchanted creature's controller sacrifices it/i.test(String(step.raw || ''))
  );
  const needsEnchantedCreatureRestriction = steps.some((step) =>
    /enchanted creature can't|enchanted permanent doesn't untap|its activated abilities can't be activated/i.test(String(step.raw || ''))
  );
  const needsCopyTokenSource = steps.some((step) =>
    step.kind === 'create_token' &&
    /copy of (?:that artifact or creature|that aura|one of those creatures|(?:it\b|this equipment|this enchantment|that artifact|enchanted creature|one of them|one of those permanents|blighted creature))/i.test(String(step.raw || ''))
  );
  const needsStackArtifactCreatureCopy = steps.some((step) =>
    step.kind === 'create_token' &&
    /copy of that artifact or creature/i.test(String(step.raw || ''))
  );
  const needsOneOfThoseCreaturesCopy = steps.some((step) =>
    step.kind === 'create_token' &&
    /copy of one of those creatures/i.test(String(step.raw || ''))
  );
  const needsThatAuraCopy = steps.some((step) =>
    step.kind === 'create_token' &&
    /copy of that aura/i.test(String(step.raw || ''))
  );
  const needsExchangeControl = steps.some((step) => step.kind === 'exchange_control');
  const needsPutOnBottom = steps.some((step) => step.kind === 'put_on_bottom');
  const needsInvestigateWhere = steps.some((step) =>
    step.kind === 'investigate' && /\bwhere x is\b/i.test(String(step.raw || ''))
  );
  const needsMinusOneCounterCantBlock = steps.some((step) =>
    step.kind === 'cant_block' && /-1\/-1 counters on them/i.test(String(step.raw || ''))
  );
  if (needsEnchantedLand || needsEnchantedCreatureSacrifice || needsEnchantedCreatureRestriction || needsCopyTokenSource) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return {
          ...perm,
          attachedTo: needsEnchantedLand ? 'bf-land-1' : 'bf-creature-1',
          type_line: needsEnchantedCreatureSacrifice || needsEnchantedCreatureRestriction || needsCopyTokenSource
            ? perm?.type_line || 'Enchantment — Aura'
            : perm?.type_line,
        };
      }),
    } as GameState;
  }

  if (needsMinusOneCounterCantBlock) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-opponent-creature') return perm;
        return { ...perm, counters: { ...(perm?.counters || {}), '-1/-1': 1 } };
      }),
    } as GameState;
  }

  if (needsCopyTokenSource) {
    nextCtx = {
      ...nextCtx,
      lastMovedBattlefieldPermanentIds: needsOneOfThoseCreaturesCopy
        ? ['bf-opponent-creature', 'bf-creature-2']
        : ['bf-opponent-artifact'],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: needsOneOfThoseCreaturesCopy
          ? ['bf-opponent-creature', 'bf-creature-1']
          : needsThatAuraCopy
            ? ['bf-creature-1', 'bf-enchantment-1']
            : ['bf-opponent-artifact', 'bf-creature-1'],
      },
    } as typeof nextCtx;
  }

  if (needsThatAuraCopy) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return {
          ...perm,
          attachedTo: 'bf-creature-1',
          type_line: 'Enchantment — Aura',
        };
      }),
    } as GameState;
  }

  if (needsStackArtifactCreatureCopy) {
    nextState = {
      ...nextState,
      stack: ((nextState.stack || []) as any[]).map((item: any) => {
        if (String(item?.id || '').trim() !== 'stack-spell-1') return item;
        return {
          ...item,
          card: {
            ...(item.card || {}),
            name: 'Audit Golem',
            type_line: 'Artifact Creature — Golem',
            power: 3,
            toughness: 3,
            colors: [],
          },
        };
      }),
    } as GameState;
  }

  if (needsExchangeControl) {
    const wantsNeitherOwn = steps.some(
      (step) => step.kind === 'exchange_control' && /neither own nor control/i.test(String(step.raw || ''))
    );
    const wantsYouControlCreature = steps.some(
      (step) => step.kind === 'exchange_control' && /creature you control/i.test(String(step.raw || ''))
    );
    const wantsNonlandPermanent = steps.some(
      (step) => step.kind === 'exchange_control' && /target nonland permanent/i.test(String(step.raw || ''))
    );
    nextCtx = {
      ...nextCtx,
      targetPermanentId: wantsNeitherOwn || wantsNonlandPermanent ? 'bf-opponent-artifact' : 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: wantsYouControlCreature
          ? ['bf-creature-1', 'bf-opponent-creature']
          : [
              String(nextCtx.sourceId || 'bf-source'),
              wantsNonlandPermanent || wantsNeitherOwn ? 'bf-opponent-artifact' : 'bf-opponent-creature',
            ],
      },
    } as typeof nextCtx;
  }

  if (needsPutOnBottom) {
    const player = (nextState.players || []).find((entry: any) => String(entry?.id || '').trim() === 'p1') as any;
    const library = Array.isArray(player?.library) ? player.library.slice(0, 3) : [];
    nextCtx = {
      ...nextCtx,
      lastMovedCards: library,
      lastRevealedCardCount: library.length,
    } as typeof nextCtx;
  }

  if (needsInvestigateWhere) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p2') return { ...player, investigatedThisWay: true };
        return player;
      }),
    } as GameState;
  }

  const needsBaitCounter = steps.some((step) => /bait counter from this equipment/i.test(String(step.raw || '')));
  if (needsBaitCounter) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return {
          ...perm,
          type_line: perm?.type_line || 'Artifact — Equipment',
          counters: { ...(perm?.counters || {}), bait: 1 },
        };
      }),
    } as GameState;
  }

  const needsMagnetCounters = steps.some((step) => /magnet counters on them/i.test(String(step.raw || '')));
  if (needsMagnetCounters) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-creature-1') return perm;
        return { ...perm, counters: { ...(perm?.counters || {}), magnet: 1 } };
      }),
    } as GameState;
  }

  const needsEtBCounterFromMv = steps.some((step) => /mana value minus 4/i.test(String(step.raw || '')));
  if (needsEtBCounterFromMv) {
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [
        {
          id: 'bf-creature-2',
          name: 'Merfolk Looter',
          type_line: 'Creature — Merfolk Rogue',
          cmc: 6,
          mana_cost: '{2}{U}{U}{U}',
        },
      ],
      targetCreatureId: 'bf-creature-2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-2',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-2',
          ])
        ),
      },
    };
  }

  const needsAssimilationCopy = steps.some((step) =>
    /creature card exiled with this equipment/i.test(String(step.raw || ''))
  );
  if (needsAssimilationCopy) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return { ...perm, attachedTo: 'bf-creature-1', type_line: perm?.type_line || 'Artifact — Equipment' };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastExiledCards: [
        {
          id: 'exile-assimilation-copy-1',
          name: 'Audit Exiled Copy',
          type_line: 'Creature — Human',
          cmc: 3,
        },
      ],
    };
  }

  const needsThoseCardsZoneChain = steps.some((step) =>
    /puts? those cards into their graveyard|return those cards to the battlefield under their owners?'? control/i.test(
      String(step.raw || '')
    )
  );
  if (needsThoseCardsZoneChain) {
    const milledCards = [
      { id: 'gy-milled-chain-1', name: 'Milled Chain 1', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-milled-chain-2', name: 'Milled Chain 2', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        for (const card of milledCards) {
          if (!graveyard.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
            graveyard.push(card);
          }
        }
        return { ...player, graveyard };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: milledCards,
      lastMilledCards: milledCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-milled-chain-1',
            'gy-milled-chain-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLifeGainedWhere = steps.some((step) =>
    /life you gained this turn|amount of life you gained/i.test(
      String((step as any).condition?.raw || step.raw || '')
    )
  );
  if (needsLifeGainedWhere) {
    nextState = {
      ...nextState,
      lifeGainedThisTurn: { p1: 4, p2: 0, p3: 0, p4: 0 },
    } as GameState;
  }

  const needsCopyTokenFixtures = steps.some((step) =>
    step.kind === 'create_token' &&
    /non-?saga token you control|nonlegendary enchantment you control|enchanted artifact|that wizard|quest counter on it|cursed role token attached to it|sorcerer role token attached to it/i.test(
      String(step.raw || '')
    )
  );
  if (needsCopyTokenFixtures) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]),
        {
          id: 'bf-audit-non-saga-token',
          controller: 'p1',
          owner: 'p1',
          isToken: true,
          type_line: 'Token Creature — Soldier',
          power: '1',
          toughness: '1',
        },
        {
          id: 'bf-audit-nonlegendary-enchantment',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment',
        },
        {
          id: 'bf-audit-wizard',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human Wizard',
          power: '2',
          toughness: '2',
        },
        {
          id: 'bf-audit-enchanted-artifact',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Artifact',
        },
      ],
    } as GameState;
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return {
          ...perm,
          attachedTo: 'bf-audit-enchanted-artifact',
          type_line: perm?.type_line || 'Enchantment — Aura',
          counters: { ...(perm?.counters || {}), quest: 2 },
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-creature-1',
      targetCreatureId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-creature-1',
        targetCreatureId: 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-audit-non-saga-token',
            'bf-audit-nonlegendary-enchantment',
            'bf-audit-wizard',
            'bf-audit-enchanted-artifact',
            'bf-creature-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTappedCreaturePowerWhere = steps.some(
    (step) => step.kind === 'modify_pt' && /power of the creature tapped this way/i.test(String(step.raw || ''))
  );
  if (needsTappedCreaturePowerWhere) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['bf-creature-1'],
      },
    } as typeof nextCtx;
  }

  const needsOpportunisticDragon = steps.some((step) =>
    /gain control of that permanent, it loses all abilities/i.test(String(step.raw || ''))
  );
  if (needsOpportunisticDragon) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-opponent-creature',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-opponent-creature',
        targetCreatureId: 'bf-opponent-creature',
        chosenObjectIds: ['bf-opponent-creature'],
      },
    } as typeof nextCtx;
  }

  const needsDragonGyExtrema = steps.some(
    (step) =>
      step.kind === 'modify_pt' &&
      /other dragons you control and dragons in your graveyard/i.test(String(step.raw || ''))
  );
  if (needsDragonGyExtrema) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        if (!graveyard.some((entry: any) => String(entry?.id || '').trim() === 'gy-dragon-audit-1')) {
          graveyard.push({
            id: 'gy-dragon-audit-1',
            name: 'Audit Dragon',
            type_line: 'Creature — Dragon',
            power: '7',
            toughness: '7',
          });
        }
        return { ...player, graveyard };
      }),
    } as GameState;
  }

  const needsOwnerCreatesQuestToken = steps.some(
    (step) =>
      step.kind === 'create_token' &&
      /its owner creates.*for each quest counter on it/i.test(String(step.raw || ''))
  );
  if (needsOwnerCreatesQuestToken) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return { ...perm, counters: { ...(perm?.counters || {}), quest: 3 } };
      }),
    } as GameState;
  }

  let needsGraveyardExileTarget = false;
  let needsAttachToControlledCreature = false;
  let needsCastFromGraveyard = false;
  let needsModifyGraveyardPermissions = false;
  const sourceCounterSeeds: Record<string, number> = {};

  walkOracleSteps(steps, (step) => {
    const raw = String(step.raw || '').replace(/\s+/g, ' ').trim();
    if (step.kind === 'move_zone') {
      const whatText = String((step as any).what?.text || raw).trim().toLowerCase();
      if (
        /\bfrom a graveyard\b|\bfrom graveyards\b|\bfrom your graveyard\b|\bfrom target player'?s graveyard\b/i.test(
          whatText
        ) &&
        /\btarget\b|\bup to\b/i.test(whatText)
      ) {
        needsGraveyardExileTarget = true;
      }
      if (
        step.to === 'battlefield' &&
        /\bcreature card from (?:your|a|target player'?s) graveyard\b/i.test(whatText)
      ) {
        needsGraveyardExileTarget = true;
      }
    }
    if (step.kind === 'attach' && /target creature you control/i.test(raw)) {
      needsAttachToControlledCreature = true;
    }
    if (step.kind === 'grant_graveyard_permission' && /from your graveyard/i.test(raw)) {
      needsCastFromGraveyard = true;
    }
    if (step.kind === 'modify_graveyard_permissions') {
      needsModifyGraveyardPermissions = true;
    }
    if (step.kind === 'remove_counter') {
      const counter = String((step as any).counter || '').trim();
      const targetText = String((step as any).target?.text || raw).trim().toLowerCase();
      if (counter && /this (?:creature|permanent|land|artifact|enchantment|equipment|vehicle|planeswalker)\b/.test(targetText)) {
        sourceCounterSeeds[counter] = Math.max(sourceCounterSeeds[counter] || 0, 2);
      }
    }
  });

  if (needsGraveyardExileTarget) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-creature-1',
          ])
        ),
      },
    };
  }

  if (needsAttachToControlledCreature) {
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-1',
          ])
        ),
      },
    };
  }

  if (Object.keys(sourceCounterSeeds).length > 0) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        const counters = { ...(perm?.counters || {}) };
        for (const [counter, amount] of Object.entries(sourceCounterSeeds)) {
          counters[counter] = Math.max(Number(counters[counter] || 0), amount);
        }
        return { ...perm, counters };
      }),
    } as GameState;
  }

  if (needsCastFromGraveyard || needsModifyGraveyardPermissions) {
    const sourceName = String(nextCtx.sourceName || 'Audit Source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        if (graveyard.some((card: any) => String(card?.id || '').trim() === 'gy-source-self')) {
          return player;
        }
        graveyard.unshift({
          id: 'gy-source-self',
          name: sourceName,
          type_line: 'Creature',
          transformable: true,
          canTransformFromGraveyard: true,
        });
        return { ...player, graveyard };
      }),
    } as GameState;
  }

  return { state: nextState, ctx: nextCtx };
}

export function collectAutoSelectedModeIds(steps: readonly OracleEffectStep[]): string[] {
  const ids: string[] = [];
  walkOracleSteps(steps, (step) => {
    if (step.kind !== 'choose_mode') return;
    const modes = Array.isArray((step as any).modes) ? (step as any).modes : [];
    const minModes = Math.max(0, Number((step as any).minModes) || 0);
    const pickCount = minModes > 0 ? minModes : 1;
    for (let i = 0; i < pickCount && i < modes.length; i += 1) {
      const label = String(modes[i]?.label || '').trim();
      if (label) ids.push(label);
    }
  });
  return ids;
}

export function buildAuditFixtureState(cardName?: string, typeLine?: string): GameState {
  const resolvedTypeLine = String(typeLine || 'Creature').trim() || 'Creature';
  const isCreatureCard = /\bCreature\b/i.test(resolvedTypeLine);
  const isArtifactOnly = /\bArtifact\b/i.test(resolvedTypeLine) && !isCreatureCard;
  const sourceCmc = isArtifactOnly ? 8 : 2;
  const sourceManaCost = isArtifactOnly ? '{6}{W}{W}' : '{2}{U}';
  const sourceFaceUpCard =
    isCreatureCard && cardName
      ? {
          id: 'bf-source-face-up',
          name: cardName,
          type_line: resolvedTypeLine,
          power: '3',
          toughness: '3',
        }
      : null;
  const sourceGraveyardCard = cardName
    ? {
        id: 'gy-source-self',
        name: cardName,
        type_line: resolvedTypeLine,
        colors: [],
        ...(sourceFaceUpCard
          ? {
              faceDown: true,
              faceUpCard: sourceFaceUpCard,
            }
          : {}),
      }
    : null;
  const gyAntecedent = {
    id: 'gy-antecedent-1',
    name: 'Antecedent Creature',
    type_line: 'Creature — Bear',
    colors: ['G'],
  };
  const gySplitCards = [
    { id: 'gy-split-1', name: 'Split Card A', type_line: 'Creature', colors: ['U'], cmc: 2 },
    { id: 'gy-split-2', name: 'Split Card B', type_line: 'Creature', colors: ['B'] },
    { id: 'gy-split-3', name: 'Split Card C', type_line: 'Instant', colors: ['R'] },
  ];
  const gyCreature = {
    id: 'gy-creature-1',
    name: 'Gravecrawler',
    type_line: 'Creature — Zombie',
    mana_cost: '{B}',
    power: '2',
    toughness: '2',
    colors: ['B'],
  };
  const gyInstant = {
    id: 'gy-instant-1',
    name: 'Lightning Bolt',
    type_line: 'Instant',
    mana_cost: '{R}',
    colors: ['R'],
    cmc: 1,
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
  };
  const gyBlackInstant = {
    id: 'gy-black-spell-1',
    name: 'Dark Ritual',
    type_line: 'Instant',
    colors: ['B'],
    cmc: 0,
    oracle_text: 'Add {B}{B}{B}.',
  };
  const gyLegendaryRat = {
    id: 'gy-legendary-rat-1',
    name: 'Audit Legendary Rat',
    type_line: 'Legendary Creature — Rat',
    colors: ['B'],
    cmc: 2,
    oracle_text: 'When Audit Legendary Rat enters the battlefield, draw a card.',
  };
  const gyNoncreatureNonland = {
    id: 'gy-artifact-spell-1',
    name: 'Mind Stone',
    type_line: 'Artifact',
    cmc: 2,
    oracle_text: '{T}: Add {C}.',
  };
  const linkedExileSpell = {
    id: 'exile-linked-spell-1',
    name: 'Lightning Bolt',
    type_line: 'Instant',
    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
    mana_cost: '{R}',
    cmc: 1,
    exiledWith: 'bf-source',
    exiledWithSourceId: 'bf-source',
  };

  return {
    id: 'executor-audit-game',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        energy: 10,
        energyCounters: 10,
        counters: { energy: 10 },
        library: [
          { id: 'lib-plains-1', name: 'Plains', type_line: 'Basic Land — Plains' },
          { id: 'lib-land-1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'lib-1', name: 'Audit Spell', type_line: 'Instant', cmc: 2 },
          { id: 'lib-2', name: 'Audit Creature', type_line: 'Creature', cmc: 2 },
          { id: 'lib-3', name: 'Audit Artifact', type_line: 'Artifact', cmc: 2 },
        ],
        hand: [
          { id: 'hand-1', name: 'Opt', type_line: 'Instant' },
          { id: 'hand-land-1', name: 'Forest', type_line: 'Basic Land — Forest' },
          { id: 'hand-creature-1', name: 'Audit Hand Creature', type_line: 'Creature — Human', mana_cost: '{1}', cmc: 1 },
          { id: 'hand-artifact-1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}', cmc: 2 },
          { id: 'hand-equipment-1', name: 'Sword of Feast and Famine', type_line: 'Artifact — Equipment', mana_cost: '{3}', cmc: 3 },
          { id: 'hand-aura-1', name: 'Pacifism', type_line: 'Enchantment — Aura', mana_cost: '{1}{W}', cmc: 2 },
          { id: 'hand-vampire-1', name: 'Vampire Lacerator', type_line: 'Creature — Vampire Warrior', mana_cost: '{B}', cmc: 1 },
          { id: 'hand-x-spell-1', name: 'Bonfire of the Damned', type_line: 'Sorcery', mana_cost: '{X}{X}{R}', cmc: 0 },
          { id: 'hand-source-card', name: cardName, type_line: 'Creature', mana_cost: '{3}', cmc: 3 },
        ],
        graveyard: [
          gyCreature,
          gyInstant,
          gyBlackInstant,
          gyLegendaryRat,
          gyNoncreatureNonland,
          {
            id: 'gy-doctor-1',
            name: 'Audit Doctor Graveyard',
            type_line: 'Creature — Doctor',
            mana_cost: '{2}',
            cmc: 2,
          },
          {
            id: 'gy-rat-1',
            name: 'Audit Rat',
            type_line: 'Creature — Rat',
            mana_cost: '{1}',
            cmc: 1,
          },
          {
            id: 'gy-milled-1',
            name: 'Milled This Turn',
            type_line: 'Creature — Zombie',
            mana_cost: '{2}',
            cmc: 2,
            milledTurn: 3,
          },
          {
            id: 'gy-aura-1',
            name: 'Unstable Mutation',
            type_line: 'Enchantment — Aura',
            mana_cost: '{U}',
            cmc: 1,
          },
          {
            id: 'gy-elf-1',
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            mana_cost: '{G}',
            cmc: 1,
          },
          gyAntecedent,
          ...gySplitCards,
          ...(sourceGraveyardCard ? [sourceGraveyardCard] : []),
        ],
        exile: sourceGraveyardCard
          ? [
              {
                id: 'exile-source-self',
                name: cardName || 'Audit Source',
                type_line: resolvedTypeLine,
              },
              {
                id: 'exile-linked-1',
                name: 'Linked Exile Card',
                type_line: 'Creature',
                faceDown: true,
                faceUpCard: {
                  id: 'exile-linked-1-face-up',
                  name: 'Linked Exile Creature',
                  type_line: 'Creature',
                  power: '2',
                  toughness: '2',
                },
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
              linkedExileSpell,
              {
                id: 'exile-opponent-owned-1',
                name: 'Opponent Owned Exile',
                type_line: 'Creature',
                owner: 'p2',
              },
              {
                id: 'exile-goblin-1',
                name: 'Goblin Guide',
                type_line: 'Creature — Goblin Scout',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-goblin-2',
                name: 'Siege-Gang Commander',
                type_line: 'Creature — Goblin',
                mana_cost: '{3}{R}{R}',
                cmc: 5,
              },
              {
                id: 'exile-among-them-1',
                name: 'Among Them Human',
                type_line: 'Creature — Human',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-land-1',
                name: 'Revealed Forest',
                type_line: 'Basic Land — Forest',
              },
              {
                id: 'exile-dwarf-1',
                name: 'Dwarven Trader',
                type_line: 'Creature — Dwarf',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-doctor-1',
                name: 'Audit Doctor',
                type_line: 'Creature — Doctor',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-zombie-1',
                name: 'Audit Zombie',
                type_line: 'Creature — Zombie',
                mana_cost: '{B}',
                cmc: 1,
              },
              {
                id: 'exile-island-1',
                name: 'Revealed Island',
                type_line: 'Basic Land — Island',
              },
              {
                id: 'exile-vote-1',
                name: 'Vote Winner A',
                type_line: 'Creature',
              },
              {
                id: 'exile-linked-2',
                name: 'Linked Exile Permanent',
                type_line: 'Artifact',
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
            ]
          : [
              {
                id: 'exile-opponent-owned-1',
                name: 'Opponent Owned Exile',
                type_line: 'Creature',
                owner: 'p2',
              },
              {
                id: 'exile-goblin-1',
                name: 'Goblin Guide',
                type_line: 'Creature — Goblin Scout',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-goblin-2',
                name: 'Siege-Gang Commander',
                type_line: 'Creature — Goblin',
                mana_cost: '{3}{R}{R}',
                cmc: 5,
              },
              {
                id: 'exile-among-them-1',
                name: 'Among Them Human',
                type_line: 'Creature — Human',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-land-1',
                name: 'Revealed Forest',
                type_line: 'Basic Land — Forest',
              },
              {
                id: 'exile-dwarf-1',
                name: 'Dwarven Trader',
                type_line: 'Creature — Dwarf',
                mana_cost: '{R}',
                cmc: 1,
              },
              {
                id: 'exile-doctor-1',
                name: 'Audit Doctor',
                type_line: 'Creature — Doctor',
                mana_cost: '{2}',
                cmc: 2,
              },
              {
                id: 'exile-zombie-1',
                name: 'Audit Zombie',
                type_line: 'Creature — Zombie',
                mana_cost: '{B}',
                cmc: 1,
              },
              {
                id: 'exile-island-1',
                name: 'Revealed Island',
                type_line: 'Basic Land — Island',
              },
              {
                id: 'exile-vote-1',
                name: 'Vote Winner A',
                type_line: 'Creature',
              },
              {
                id: 'exile-linked-2',
                name: 'Linked Exile Permanent',
                type_line: 'Artifact',
                exiledWith: 'bf-source',
                exiledWithSourceId: 'bf-source',
              },
            ],
        manaPool: { white: 5, blue: 5, black: 5, red: 5, green: 5, colorless: 5 },
      },
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [
          { id: 'lib-p2-1', name: 'Audit Spell', type_line: 'Instant', cmc: 2 },
          { id: 'lib-p2-2', name: 'Island', type_line: 'Basic Land — Island' },
        ],
        hand: [
          { id: 'hand-p2-1', name: 'Shock', type_line: 'Instant' },
          { id: 'hand-p2-2', name: 'Counterspell', type_line: 'Instant' },
          { id: 'hand-p2-3', name: 'Island', type_line: 'Basic Land — Island' },
          { id: 'hand-p2-4', name: 'Audit Elf', type_line: 'Creature — Elf' },
          { id: 'hand-p2-5', name: 'Divination', type_line: 'Sorcery' },
          { id: 'hand-p2-6', name: 'Opt', type_line: 'Instant' },
          { id: 'hand-p2-7', name: 'Swords to Plowshares', type_line: 'Instant' },
          { id: 'hand-p2-8', name: 'Path to Exile', type_line: 'Instant' },
          { id: 'hand-p2-9', name: 'Brainstorm', type_line: 'Instant' },
        ],
        graveyard: [
          { id: 'gy-p2-1', name: 'Counterspell', type_line: 'Instant', cmc: 2, oracle_text: 'Counter target spell.' },
          { id: 'gy-p2-instant-1', name: 'Shock', type_line: 'Instant', cmc: 1, oracle_text: 'Shock deals 2 damage to any target.' },
          { id: 'gy-p2-land-1', name: 'Island', type_line: 'Basic Land — Island' },
          {
            id: 'gy-p2-creature-1',
            name: 'Defending Bear',
            type_line: 'Creature — Bear',
            cmc: 2,
            putIntoGraveyardTurn: 3,
          },
        ],
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
      {
        id: 'p3',
        name: 'P3',
        seat: 2,
        life: 40,
        library: [{ id: 'lib-p3-1' }],
        hand: [],
        graveyard: [],
      },
      {
        id: 'p4',
        name: 'P4',
        seat: 3,
        life: 40,
        library: [{ id: 'lib-p4-1' }],
        hand: [],
        graveyard: [],
      },
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40, p3: 40, p4: 40 },
    turnPlayer: 'p1',
    turnNumber: 3,
    priority: 'p1',
    phase: 'main1',
    active: true,
    stack: [
      {
        id: 'stack-spell-1',
        type: 'spell',
        controller: 'p2',
        owner: 'p2',
        card: {
          id: 'stack-card-1',
          name: 'Divination',
          type_line: 'Sorcery',
          colors: ['U'],
          cmc: 3,
          manaValue: 3,
          mana_cost: '{2}{U}',
          oracle_text:
            'Search your library for up to two basic land cards, reveal those cards, put one onto the battlefield tapped and the other into your hand, then shuffle.',
        },
      } as any,
      {
        id: 'stack-ability-1',
        type: 'ability',
        controller: 'p1',
        abilityText: 'Draw a card.',
      } as any,
    ],
    battlefield: [
      {
        id: 'bf-source',
        name: cardName || 'Audit Source',
        controller: 'p1',
        owner: 'p1',
        type_line: resolvedTypeLine,
        power: /\bCreature\b/i.test(resolvedTypeLine) ? 3 : undefined,
        toughness: /\bCreature\b/i.test(resolvedTypeLine) ? 3 : undefined,
        tapped: false,
        wasKicked: true,
        sneakCostPaid: true,
        counters: { quest: 4, verse: 7, age: 2, growth: 3, '+1/+1': 2 },
        colors: ['U'],
        mana_cost: sourceManaCost,
        cmc: sourceCmc,
        card: {
          id: 'bf-source-card',
          name: cardName || 'Audit Source',
          type_line: resolvedTypeLine,
          colors: ['U'],
          mana_cost: sourceManaCost,
          cmc: sourceCmc,
          manaSpentTotal: 5,
          wasKicked: true,
          manaSpent: { blue: 1, white: 0, black: 0, red: 0, green: 0, colorless: 0 },
          ...(sourceFaceUpCard ? { faceDown: true } : {}),
        },
        manaSpentTotal: 5,
        manaSpent: { blue: 1, white: 0, black: 0, red: 0, green: 0, colorless: 0 },
        ...(/\b(?:Aura|Equipment)\b/i.test(resolvedTypeLine) ? { attachedTo: 'bf-creature-1' } : {}),
        ...(/\bVehicle\b/i.test(resolvedTypeLine) ? { lastCrewedCreatureId: 'bf-creature-1' } : {}),
        ...(sourceFaceUpCard ? { faceUpCard: sourceFaceUpCard } : {}),
      },
      {
        id: 'bf-vehicle-1',
        name: 'Audit Vehicle',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Vehicle',
        tapped: false,
        lastCrewedCreatureId: 'bf-creature-1',
        card: { id: 'bf-vehicle-1-card', name: 'Audit Vehicle', type_line: 'Artifact — Vehicle' },
      },
      {
        id: 'bf-treasure-1',
        name: 'Audit Treasure',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Treasure',
        tapped: false,
        card: { id: 'bf-treasure-1-card', name: 'Audit Treasure', type_line: 'Artifact — Treasure' },
      },
      {
        id: 'bf-wolf-1',
        name: 'Audit Wolf',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Wolf',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-wolf-1-card', name: 'Audit Wolf', type_line: 'Creature — Wolf' },
      },
      {
        id: 'bf-creature-1',
        name: 'Grizzly Bears',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
        tapped: false,
        attackedThisTurn: true,
        counters: { '+1/+1': 2 },
        colors: ['G'],
        mana_cost: '{1}{G}',
        cmc: 2,
        card: { id: 'bf-creature-1-card', name: 'Grizzly Bears', type_line: 'Creature — Bear', colors: ['G'], mana_cost: '{1}{G}', cmc: 2 },
      },
      {
        id: 'bf-legendary-creature',
        name: 'Rafiq of the Many',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Legendary Creature — Human Knight',
        power: 3,
        toughness: 3,
        tapped: false,
        colors: ['W', 'U', 'G'],
        mana_cost: '{1}{W}{U}',
        cmc: 3,
        card: {
          id: 'bf-legendary-creature-card',
          name: 'Rafiq of the Many',
          type_line: 'Legendary Creature — Human Knight',
          colors: ['W', 'U', 'G'],
          mana_cost: '{1}{W}{U}',
          cmc: 3,
        },
      },
      {
        id: 'bf-creature-2',
        name: 'Merfolk Looter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Merfolk Rogue',
        power: 1,
        toughness: 1,
        tapped: true,
        colors: ['U'],
        card: { id: 'bf-creature-2-card', name: 'Merfolk Looter', type_line: 'Creature — Merfolk Rogue', colors: ['U'] },
      },
      {
        id: 'bf-spider-1',
        name: 'Audit Spider',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Spider',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-spider-1-card', name: 'Audit Spider', type_line: 'Creature — Spider' },
      },
      {
        id: 'bf-villain-1',
        name: 'Audit Villain',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Villain',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-villain-1-card', name: 'Audit Villain', type_line: 'Creature — Human Villain' },
      },
      {
        id: 'bf-token-1',
        name: 'Audit Spirit Token',
        controller: 'p1',
        owner: 'p1',
        isToken: true,
        type_line: 'Token Creature — Spirit',
        power: 1,
        toughness: 1,
        tapped: false,
        card: { id: 'bf-token-1-card', name: 'Audit Spirit Token', type_line: 'Token Creature — Spirit' },
      },
      {
        id: 'bf-blue-black-creature',
        name: 'Nightveil Specter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Specter',
        power: 2,
        toughness: 3,
        tapped: false,
        colors: ['U', 'B'],
        card: {
          id: 'bf-blue-black-creature-card',
          name: 'Nightveil Specter',
          type_line: 'Creature — Specter',
          colors: ['U', 'B'],
        },
      },
      {
        id: 'bf-high-power-creature',
        name: 'Audit Colossus',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Giant',
        power: 8,
        toughness: 8,
        tapped: false,
        colors: ['R'],
        card: { id: 'bf-high-power-creature-card', name: 'Audit Colossus', type_line: 'Creature — Giant', colors: ['R'] },
      },
      {
        id: 'bf-opponent-creature',
        name: 'Runeclaw Bear',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Bear',
        power: 2,
        toughness: 2,
        tapped: false,
        attackedLastTurn: true,
        colors: ['G'],
        counters: { prey: 1 },
        card: { id: 'bf-opponent-creature-card', name: 'Runeclaw Bear', type_line: 'Creature — Bear', colors: ['G'] },
      },
      {
        id: 'bf-opponent-nonbasic-land',
        name: 'Rogue\'s Passage',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Land',
        tapped: false,
        card: { id: 'bf-opponent-nonbasic-land-card', name: 'Rogue\'s Passage', type_line: 'Land' },
      },
      {
        id: 'bf-curse-1',
        name: 'Curse of Audit',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Enchantment — Aura Curse',
        enchantedPlayerId: 'p1',
        card: { id: 'bf-curse-1-card', name: 'Curse of Audit', type_line: 'Enchantment — Aura Curse' },
      },
      {
        id: 'bf-opponent-land',
        name: 'Mountain',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Basic Land — Mountain',
        tapped: false,
        card: { id: 'bf-opponent-land-card', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      },
      {
        id: 'bf-opponent-artifact',
        name: 'Mind Stone',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Artifact',
        tapped: false,
        card: { id: 'bf-opponent-artifact-card', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}', cmc: 2 },
      },
      {
        id: 'bf-opponent-enchantment',
        name: 'Pacifism',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Enchantment — Aura',
        tapped: false,
        attachedTo: 'bf-opponent-creature',
        card: { id: 'bf-opponent-enchantment-card', name: 'Pacifism', type_line: 'Enchantment — Aura', mana_cost: '{1}{W}', cmc: 2 },
      },
      {
        id: 'bf-land-1',
        name: 'Island',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Basic Land — Island',
        tapped: false,
        card: { id: 'bf-land-1-card', name: 'Island', type_line: 'Basic Land — Island' },
      },
      {
        id: 'bf-land-2',
        name: 'Forest',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Basic Land — Forest',
        tapped: false,
        card: { id: 'bf-land-2-card', name: 'Forest', type_line: 'Basic Land — Forest' },
      },
      {
        id: 'bf-red-creature',
        name: 'Goblin Piker',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Goblin',
        power: 4,
        toughness: 1,
        tapped: false,
        attacking: true,
        attackedThisTurn: true,
        colors: ['R'],
        card: {
          id: 'bf-red-creature-card',
          name: 'Goblin Piker',
          type_line: 'Creature — Goblin',
          colors: ['R'],
        },
      },
      {
        id: 'bf-artifact-1',
        name: 'Sol Ring',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact',
        tapped: false,
        card: { id: 'bf-artifact-1-card', name: 'Sol Ring', type_line: 'Artifact' },
      },
      {
        id: 'bf-equipment-1',
        name: 'Sword of Feast and Famine',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Equipment',
        tapped: false,
        card: {
          id: 'bf-equipment-1-card',
          name: 'Sword of Feast and Famine',
          type_line: 'Artifact — Equipment',
          mana_cost: '{3}',
          cmc: 3,
        },
      },
      {
        id: 'bf-enchantment-1',
        name: 'Curiosity',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Enchantment — Aura',
        tapped: false,
        attachedTo: 'bf-creature-1',
        card: { id: 'bf-enchantment-1-card', name: 'Curiosity', type_line: 'Enchantment — Aura' },
      },
      {
        id: 'bf-planeswalker-1',
        name: 'Jace, the Mind Sculptor',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Legendary Planeswalker — Jace',
        loyalty: 4,
        counters: { flood: 3 },
        card: { id: 'bf-planeswalker-1-card', name: 'Jace, the Mind Sculptor', type_line: 'Legendary Planeswalker — Jace' },
      },
      {
        id: 'bf-party-cleric',
        name: 'Audit Cleric',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Cleric',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Cleric', type_line: 'Creature — Human Cleric' },
      },
      {
        id: 'bf-party-rogue',
        name: 'Audit Rogue',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Rogue',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Rogue', type_line: 'Creature — Human Rogue' },
      },
      {
        id: 'bf-party-warrior',
        name: 'Audit Warrior',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Warrior',
        power: 1,
        toughness: 1,
        attacking: true,
        attackedThisTurn: true,
        card: { name: 'Audit Warrior', type_line: 'Creature — Human Warrior' },
      },
      {
        id: 'bf-clue-1',
        name: 'Audit Clue',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Clue',
        tapped: false,
        card: { id: 'bf-clue-1-card', name: 'Audit Clue', type_line: 'Artifact — Clue' },
      },
      {
        id: 'bf-clue-2',
        name: 'Audit Clue Two',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Clue',
        tapped: false,
        card: { id: 'bf-clue-2-card', name: 'Audit Clue Two', type_line: 'Artifact — Clue' },
      },
      {
        id: 'bf-wall-opponent',
        name: 'Audit Wall',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Wall',
        power: 0,
        toughness: 4,
        tapped: false,
        card: { id: 'bf-wall-opponent-card', name: 'Audit Wall', type_line: 'Creature — Wall' },
      },
      {
        id: 'bf-zombie-1',
        name: 'Audit Zombie',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Zombie',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-zombie-1-card', name: 'Audit Zombie', type_line: 'Creature — Zombie' },
      },
      {
        id: 'bf-dinosaur-1',
        name: 'Audit Dinosaur',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Dinosaur',
        power: 4,
        toughness: 4,
        tapped: false,
        card: { id: 'bf-dinosaur-1-card', name: 'Audit Dinosaur', type_line: 'Creature — Dinosaur' },
      },
      {
        id: 'bf-spirit-1',
        name: 'Audit Spirit',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Spirit',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-spirit-1-card', name: 'Audit Spirit', type_line: 'Creature — Spirit' },
      },
      {
        id: 'bf-snake-1',
        name: 'Audit Snake',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Snake',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-snake-1-card', name: 'Audit Snake', type_line: 'Creature — Snake' },
      },
      {
        id: 'bf-flying-1',
        name: 'Audit Griffin',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Griffin',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-flying-1-card', name: 'Audit Griffin', type_line: 'Creature — Griffin', keywords: ['Flying'] },
      },
      {
        id: 'bf-elemental-1',
        name: 'Audit Elemental',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elemental',
        power: 3,
        toughness: 3,
        tapped: false,
        card: { id: 'bf-elemental-1-card', name: 'Audit Elemental', type_line: 'Creature — Elemental' },
      },
      {
        id: 'bf-cat-1',
        name: 'Audit Cat',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Cat',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-cat-1-card', name: 'Audit Cat', type_line: 'Creature — Cat' },
      },
      {
        id: 'bf-defender-1',
        name: 'Audit Wall Defender',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Wall',
        power: 0,
        toughness: 5,
        tapped: false,
        card: { id: 'bf-defender-1-card', name: 'Audit Wall Defender', type_line: 'Creature — Wall', keywords: ['Defender'] },
      },
      {
        id: 'bf-rebel-1',
        name: 'Audit Rebel',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Rebel',
        power: 2,
        toughness: 2,
        tapped: false,
        card: { id: 'bf-rebel-1-card', name: 'Audit Rebel', type_line: 'Creature — Human Rebel' },
      },
      {
        id: 'bf-party-wizard',
        name: 'Audit Wizard',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human Wizard',
        power: 1,
        toughness: 1,
        card: { name: 'Audit Wizard', type_line: 'Creature — Human Wizard' },
      },
    ],
    commandZone: {} as any,
    attackersDeclaredThisCombatByPlayer: { p1: ['bf-creature-1', 'bf-red-creature'], p2: [] },
    attackedDefendingPlayersThisCombatByPlayer: { p1: ['p2'] },
    permanentLeftBattlefieldThisTurn: { p1: true, p2: false },
    spellWarpedThisTurn: { p1: true, p2: false },
    handAtBeginningOfTurn: { p1: 0, p2: 8, p3: 0, p4: 0 },
    combatPhasesThisTurn: { p1: 1, p2: 0, p3: 0, p4: 0 },
    creaturesDiedThisTurnByController: { p1: 1, p2: 1, p3: 1, p4: 0 },
    lifeLostThisTurn: { p1: 0, p2: 3, p3: 0, p4: 0 },
    castFromGraveyardThisTurn: { p1: true, p2: false, p3: false, p4: false },
    foodEnteredThisTurn: { p1: true, p2: false, p3: false, p4: false },
    creaturesEnteredThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
    citysBlessing: { p1: true, p2: false, p3: false, p4: false },
    lastNotedLifeTotal: { 'bf-source': 30 },
    poisonCounters: { p1: 0, p2: 3, p3: 0, p4: 0 },
    experienceCounters: { p1: 6, p2: 0, p3: 0, p4: 0 },
    spellsCastThisTurn: { p1: 2, p2: 1 },
    permanentCardsPutIntoYourGraveyardThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
    descendedThisTurn: { p1: true, p2: false, p3: false, p4: false },
    noncreatureSpellsCastThisTurn: { p1: 1, p2: 1 },
    commanderCastsFromCommandZoneThisGame: { p1: 2, p2: 0, p3: 0, p4: 0 },
    lastVoteResults: { sprout: 2, strength: 2 },
    manaPool: { p1: { white: 8, blue: 8, black: 8, red: 8, green: 8, colorless: 8 } },
  } as GameState;
}

export function buildAuditExecutionContext(cardName: string): ReturnType<typeof buildOracleIRExecutionContext> {
  const controllerId = 'p1' as PlayerID;
  const selectorContext = {
    targetCreatureId: 'bf-legendary-creature',
    targetPermanentId: 'bf-legendary-creature',
    targetSpellId: 'stack-spell-1',
    combatOpponentCreatureId: 'bf-opponent-creature',
    targetOpponentId: 'p2' as PlayerID,
    targetPlayerId: 'p2' as PlayerID,
    chosenCreatureType: 'Zombie',
    chosenCardName: 'Lightning Bolt',
    chosenLetter: 'A',
    chosenBasicLandType: 'Island',
    chosenMana: '{R}',
    unlessPaysLifeChoice: 'decline' as const,
    unlessPaysManaChoice: 'decline' as const,
    tapOrUntapChoice: 'tap' as const,
    eachOfThoseOpponents: ['p2', 'p3', 'p4'] as PlayerID[],
    chosenObjectIds: [
      'gy-antecedent-1',
      'gy-split-1',
      'gy-split-2',
      'gy-split-3',
      'hand-land-1',
      'hand-creature-1',
      'hand-artifact-1',
      'hand-equipment-1',
      'hand-aura-1',
      'gy-aura-1',
      'bf-enchantment-1',
      'gy-split-1',
      'gy-split-2',
      'bf-creature-1',
      'bf-creature-2',
      'bf-spider-1',
      'bf-villain-1',
      'bf-token-1',
      'bf-treasure-1',
      'bf-wolf-1',
      'gy-p2-1',
      'gy-creature-1',
      'gy-instant-1',
      'gy-black-spell-1',
      'gy-legendary-rat-1',
      'gy-artifact-spell-1',
      'gy-source-self',
      'exile-linked-1',
      'exile-opponent-owned-1',
      'hand-p2-1',
      'bf-blue-black-creature',
      'bf-opponent-creature',
      'bf-opponent-land',
      'bf-opponent-artifact',
      'bf-opponent-enchantment',
      'bf-vehicle-1',
      'bf-planeswalker-1',
      'bf-equipment-1',
      'bf-legendary-creature',
      'exile-source-self',
      'exile-goblin-1',
      'exile-goblin-2',
      'exile-among-them-1',
      'exile-land-1',
      'exile-dwarf-1',
      'exile-doctor-1',
      'gy-p2-land-1',
      'gy-aura-1',
      'exile-zombie-1',
      'hand-vampire-1',
      'gy-doctor-1',
      'gy-milled-1',
      'exile-island-1',
      'exile-vote-1',
      'exile-linked-2',
      'hand-x-spell-1',
      'hand-source-card',
      'bf-land-1',
      'bf-land-2',
      'bf-red-creature',
      'bf-rebel-1',
      'gy-rat-1',
      'gy-p2-creature-1',
      'bf-clue-1',
      'bf-clue-2',
      'bf-wall-opponent',
      'bf-party-warrior',
      'bf-dinosaur-1',
      'bf-spirit-1',
      'bf-snake-1',
      'bf-flying-1',
      'bf-elemental-1',
      'bf-artifact-1',
      'bf-cat-1',
      'bf-defender-1',
      'bf-rebel-1',
      'hand-source-card',
      'gy-rat-1',
    ],
  };

  return buildOracleIRExecutionContext(
    {
      controllerId,
      sourceId: 'bf-source',
      sourceName: cardName,
      sourceObjectType: 'ability',
      xValue: 3,
      referenceAmount: 2,
      giftPromised: true,
      abilityResolveCountThisTurn: 2,
      referenceSpellManaValue: 5,
      lastClashWon: true,
      wonCoinFlip: false,
      winningVoteChoice: null,
      voteChoiceCounts: {
        grace: 2,
        condemnation: 2,
        life: 2,
        death: 2,
        yes: 2,
        no: 2,
      },
      targetCreatureId: 'bf-legendary-creature',
      targetPermanentId: 'bf-legendary-creature',
      targetSpellId: 'stack-spell-1',
      unlessPaysLifeChoice: 'decline',
      unlessPaysManaChoice: 'decline',
      tapOrUntapChoice: 'tap',
      selectorContext,
    },
    {
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetSpellId: 'stack-spell-1',
      targetPermanentId: 'bf-creature-1',
      chosenObjectIds: [
      'gy-antecedent-1',
      'gy-split-1',
      'gy-split-2',
      'gy-split-3',
      'hand-land-1',
      'hand-creature-1',
      'hand-artifact-1',
      'hand-equipment-1',
      'hand-aura-1',
      'gy-aura-1',
      'bf-enchantment-1',
      'gy-split-1',
      'gy-split-2',
      'bf-creature-1',
      'bf-creature-2',
      'bf-spider-1',
      'bf-villain-1',
      'bf-token-1',
      'bf-treasure-1',
      'bf-wolf-1',
      'gy-p2-1',
      'gy-creature-1',
      'gy-instant-1',
      'gy-black-spell-1',
      'gy-legendary-rat-1',
      'gy-artifact-spell-1',
      'gy-source-self',
      'exile-linked-1',
      'exile-opponent-owned-1',
      'hand-p2-1',
      'bf-blue-black-creature',
      'bf-opponent-creature',
      'bf-opponent-land',
      'bf-opponent-artifact',
      'bf-opponent-enchantment',
      'bf-vehicle-1',
      'bf-planeswalker-1',
      'bf-equipment-1',
      'bf-legendary-creature',
      'exile-source-self',
      'exile-goblin-1',
      'exile-goblin-2',
      'exile-among-them-1',
      'exile-land-1',
      'exile-dwarf-1',
      'exile-doctor-1',
      'gy-p2-land-1',
      'gy-aura-1',
      'exile-zombie-1',
      'hand-vampire-1',
      'gy-doctor-1',
      'gy-milled-1',
      'exile-island-1',
      'exile-vote-1',
      'exile-linked-2',
      'hand-x-spell-1',
      'hand-source-card',
      'bf-land-1',
      'bf-land-2',
      'bf-red-creature',
      'bf-rebel-1',
      'gy-rat-1',
      'gy-p2-creature-1',
      'bf-clue-1',
      'bf-clue-2',
      'bf-wall-opponent',
      'bf-party-warrior',
      'bf-dinosaur-1',
      'bf-spirit-1',
      'bf-snake-1',
      'bf-flying-1',
      'bf-elemental-1',
      'bf-artifact-1',
      'bf-cat-1',
      'bf-defender-1',
      'bf-rebel-1',
      'hand-source-card',
      'gy-rat-1',
    ],
      chosenCreatureType: 'Zombie',
      chosenCardName: 'Lightning Bolt',
      chosenMana: '{R}',
      unlessPaysLifeChoice: 'decline',
      unlessPaysManaChoice: 'decline',
      tapOrUntapChoice: 'tap',
      affectedOpponentIds: ['p2', 'p3', 'p4'],
      opponentsDealtDamageIds: ['p2'],
      referenceAmount: 2,
      spellCastCountThisTurn: 2,
      noncreatureSpellCastCountThisTurn: 1,
      spellManaValue: 5,
      giftPromised: true,
    }
  );
}

export function classifyExecutionResult(
  result: OracleIRExecutionResult,
  stepCount: StepCount,
  irGaps: readonly string[]
): ExecutionRecord {
  const reasonCodes: Record<string, number> = {};
  const stepKinds: Record<string, number> = {};

  for (const gap of result.automationGaps || []) {
    const code = String(gap.reasonCode || 'unknown_reason');
    reasonCodes[code] = (reasonCodes[code] || 0) + 1;
    const kind = String(gap.stepKind || 'unknown');
    stepKinds[kind] = (stepKinds[kind] || 0) + 1;
  }

  let choiceRequired = 0;
  let unsupported = 0;
  let impossible = 0;
  for (const [code, count] of Object.entries(reasonCodes)) {
    if (code === 'player_choice_required') choiceRequired += count;
    else if (code === 'impossible_action' || code === 'invalid_input') impossible += count;
    else unsupported += count;
  }

  const applied = result.appliedSteps?.length || 0;
  const skipped = result.skippedSteps?.length || 0;

  let status: ExecutorCoverageStatus;
  if (irGaps.length > 0) {
    status = 'ir_gap';
  } else if (stepCount.recognized === 0) {
    status = 'no_steps';
  } else if (skipped === 0 && applied > 0) {
    status = 'fully_applied';
  } else if (skipped > 0 && applied === 0 && choiceRequired > 0 && unsupported === 0 && impossible === 0) {
    status = 'choice_required';
  } else if (skipped > 0 && applied === 0 && impossible > 0 && choiceRequired === 0) {
    status = 'impossible';
  } else if (skipped > 0 && applied === 0 && unsupported > 0) {
    status = 'unsupported';
  } else if (applied > 0 && skipped > 0) {
    status = choiceRequired > 0 && unsupported === 0 ? 'choice_required' : 'partial';
  } else if (unsupported > 0) {
    status = 'unsupported';
  } else if (choiceRequired > 0) {
    status = 'choice_required';
  } else {
    status = 'partial';
  }

  return {
    status,
    applied,
    skipped,
    choiceRequired,
    unsupported,
    impossible,
    reasonCodes,
    stepKinds,
  };
}

export function dryRunOracleSteps(
  steps: readonly OracleEffectStep[],
  card: OracleCard | string,
  irGaps: readonly string[],
  options?: { readonly typeLine?: string }
): ExecutionRecord {
  const cardName = typeof card === 'string' ? card : card.name;
  const typeLine = options?.typeLine ?? (typeof card === 'string' ? undefined : card.type_line);
  const stepCount = countOracleSteps(steps);
  if (irGaps.length > 0 || stepCount.recognized === 0) {
    return classifyExecutionResult(
      { state: buildAuditFixtureState(cardName, typeLine), log: [], appliedSteps: [], skippedSteps: [], automationGaps: [], pendingOptionalSteps: [] },
      stepCount,
      irGaps
    );
  }

  const cardRecord: AuditCardLike =
    typeof card === 'string'
      ? { name: card, type_line: typeLine }
      : { name: card.name, type_line: card.type_line, oracle_text: getCombinedOracleText(card) };

  let state = buildAuditFixtureState(cardName, typeLine);
  let ctx = buildAuditExecutionContext(cardName);
  const enriched = enrichAuditStateAndContextForCopySteps(cardRecord, steps, state, ctx);
  const targetEnriched = enrichAuditStateAndContextForTargets(steps, enriched.state, enriched.ctx, {
    oracleText: cardRecord.oracle_text,
  });
  state = targetEnriched.state;
  ctx = targetEnriched.ctx;
  const selectedModeIds = collectAutoSelectedModeIds(steps);
  const result = applyOracleIRStepsToGameState(state, steps, ctx, {
    allowOptional: true,
    ...(selectedModeIds.length > 0 ? { selectedModeIds } : {}),
  });

  return classifyExecutionResult(result, stepCount, irGaps);
}

function buildTemplateKey(trigger: TriggeredAbility): string {
  const event = String(trigger.event || 'unknown');
  const condition = normalizeText(trigger.condition || trigger.triggerFilter || '')
    .toLowerCase()
    .replace(/\b\d+\b/g, '<N>')
    .replace(/\bthis (?:creature|permanent|enchantment|artifact|planeswalker|land|vehicle)\b/g, 'this permanent')
    .slice(0, 120);
  const ifSuffix = trigger.interveningIfClause ? ', if <if>' : '';
  return `${event}|${condition || '<unknown-condition>'}${ifSuffix}`;
}

function pushExample(target: string[], value: string, limit: number): void {
  if (!value || target.includes(value)) return;
  if (target.length < limit) target.push(value);
}

function topKeys(record: Record<string, number>, n = 3): string[] {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([key]) => key);
}

async function main(): Promise<void> {
  const args = parseArgs();
  await loadEffectIrParser();

  const oraclePath = path.join(repoRoot, 'oracle-cards.json');
  if (!fs.existsSync(oraclePath)) {
    console.error(`oracle-cards.json not found at ${oraclePath}`);
    process.exit(1);
  }

  const cards = JSON.parse(fs.readFileSync(oraclePath, 'utf8')) as OracleCard[];
  const patterns = new Map<string, PatternRecord>();
  const gapCards = new Set<string>();

  const stats: AuditStats = {
    cardsScanned: 0,
    itemsScanned: 0,
    byStatus: {
      fully_applied: 0,
      choice_required: 0,
      unsupported: 0,
      partial: 0,
      ir_gap: 0,
      no_steps: 0,
      impossible: 0,
    },
    byScope: { trigger_effects: 0, full_card: 0 },
    parseToExecuteGap: 0,
  };

  const reasonTotals: Record<string, number> = {};
  const skippedKindTotals: Record<string, number> = {};

  const assessItem = (
    card: OracleCard,
    scope: 'trigger_effects' | 'full_card',
    text: string,
    trigger?: TriggeredAbility
  ): void => {
    const irGaps = hasUnknownIRSteps(text, card.name);
    const steps = collectStepsFromIrText(text, card.name);
    const record = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });

    stats.itemsScanned += 1;
    stats.byScope[scope] += 1;
    stats.byStatus[record.status] += 1;

    if (irGaps.length === 0 && record.status !== 'fully_applied' && record.status !== 'choice_required') {
      stats.parseToExecuteGap += 1;
      gapCards.add(card.name);
    }

    for (const [code, count] of Object.entries(record.reasonCodes)) {
      reasonTotals[code] = (reasonTotals[code] || 0) + count;
    }
    for (const [kind, count] of Object.entries(record.stepKinds)) {
      skippedKindTotals[kind] = (skippedKindTotals[kind] || 0) + count;
    }

    const templateKey =
      scope === 'trigger_effects' && trigger
        ? buildTemplateKey(trigger)
        : `${scope}|${normalizeText(text).toLowerCase().slice(0, 80)}`;

    const existing = patterns.get(templateKey);
    if (!existing) {
      patterns.set(templateKey, {
        templateKey,
        event: trigger ? String(trigger.event || 'unknown') : scope,
        count: 1,
        statuses: [record.status],
        exampleCards: [card.name],
        sampleEffect: normalizeText(text).slice(0, 160),
        topReasonCodes: topKeys(record.reasonCodes),
        topSkippedKinds: topKeys(record.stepKinds),
      });
      return;
    }

    existing.count += 1;
    if (!existing.statuses.includes(record.status)) existing.statuses.push(record.status);
    pushExample(existing.exampleCards, card.name, args.maxExamples);
    existing.topReasonCodes = topKeys({
      ...Object.fromEntries(existing.topReasonCodes.map((k) => [k, 1])),
      ...record.reasonCodes,
    });
    existing.topSkippedKinds = topKeys({
      ...Object.fromEntries(existing.topSkippedKinds.map((k) => [k, 1])),
      ...record.stepKinds,
    });
  };

  const seenOracleIds = new Set<string>();

  for (const card of cards) {
    if (!isEligible(card)) continue;
    if (args.commanderOnly && !isCommanderLegalCard(card)) continue;

    const oracleId = String(card.oracle_id || card.id || `${card.name}:${getCombinedOracleText(card)}`);
    if (seenOracleIds.has(oracleId)) continue;
    seenOracleIds.add(oracleId);
    stats.cardsScanned += 1;

    const oracle = getCombinedOracleText(card);
    if (!oracle) continue;

    if (args.scope === 'trigger_effects' || args.scope === 'both') {
      const triggers = parseTriggeredAbilitiesFromText(oracle, card.name);
      for (const trigger of triggers) {
        const effect = String(trigger.effect || '').trim();
        if (!effect) continue;
        if (isIgnorableCardForIrGap(card) && hasUnknownIRSteps(effect, card.name).length > 0) continue;
        assessItem(card, 'trigger_effects', effect, trigger);
      }
    }

    if (args.scope === 'full_card' || args.scope === 'both') {
      if (isIgnorableCardForIrGap(card)) continue;
      const parsed = parseOracleTextToIR(oracle, card.name);
      for (const ability of parsed.abilities || []) {
        const text = String(ability.effectText || ability.text || '').trim();
        if (!text) continue;
        assessItem(card, 'full_card', text);
      }
    }
  }

  const gapPatterns = [...patterns.values()]
    .filter((pattern) => !pattern.statuses.every((s) => s === 'fully_applied' || s === 'choice_required'))
    .sort((a, b) => b.count - a.count);

  const topPatterns = (args.onlyGaps ? gapPatterns : [...patterns.values()].sort((a, b) => b.count - a.count)).slice(
    0,
    args.top
  );

  const topReasonCodes = topKeys(reasonTotals, 25);
  const topSkippedKinds = topKeys(skippedKindTotals, 25);

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      scope: args.scope,
      commanderOnly: args.commanderOnly,
      fixture: 'assisted (pre-bound targets, allowOptional=true, auto first-mode for choose_mode)',
      top: args.top,
      maxExamples: args.maxExamples,
      onlyGaps: args.onlyGaps,
    },
    stats,
    topReasonCodes: topReasonCodes.map((code) => ({ code, count: reasonTotals[code] || 0 })),
    topSkippedStepKinds: topSkippedKinds.map((kind) => ({ kind, count: skippedKindTotals[kind] || 0 })),
    topGapPatterns: topPatterns,
    gapCardCount: gapCards.size,
    gapCardSamples: [...gapCards].slice(0, args.maxExamples),
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const applied = stats.byStatus.fully_applied;
  const choice = stats.byStatus.choice_required;
  const executable = applied + choice;
  const rate = stats.itemsScanned > 0 ? Math.round((executable / stats.itemsScanned) * 1000) / 10 : 0;

  console.log('Oracle IR Executor Coverage Audit');
  console.log('================================');
  console.log(`Scope: ${args.scope}`);
  console.log(`Commander-legal only: ${args.commanderOnly ? 'yes' : 'no'}`);
  console.log(`Cards scanned: ${stats.cardsScanned}`);
  console.log(`Items dry-run: ${stats.itemsScanned}`);
  console.log(`Fully applied: ${applied}`);
  console.log(`Choice required (expected UI): ${choice}`);
  console.log(`Parse→execute gaps: ${stats.parseToExecuteGap} items on ${gapCards.size} cards`);
  console.log(`Assisted execution rate: ${rate}% (${executable}/${stats.itemsScanned})`);
  console.log('');
  console.log('By status:');
  for (const [status, count] of Object.entries(stats.byStatus)) {
    if (count > 0) console.log(`  ${status}: ${count}`);
  }
  console.log('');
  console.log('Top skip reason codes:');
  for (const entry of report.topReasonCodes.slice(0, 12)) {
    console.log(`  ${entry.code}: ${entry.count}`);
  }
  console.log('');
  console.log('Top gap patterns:');
  for (const pattern of topPatterns.slice(0, 15)) {
    console.log(
      `  [${pattern.count}] ${pattern.event} — ${pattern.statuses.join(', ')} — ${pattern.sampleEffect.slice(0, 90)}`
    );
    if (pattern.exampleCards.length > 0) {
      console.log(`       e.g. ${pattern.exampleCards.slice(0, 3).join(', ')}`);
    }
  }
  console.log('');
  console.log(`Wrote report: ${outPath}`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
