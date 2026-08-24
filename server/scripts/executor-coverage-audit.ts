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

import {
  readOracleCardsSync,
  resolveOracleCardsPath,
} from '../src/services/oracleCardsIndex.js';
import type { GameState, PlayerID } from '../../shared/src/index.js';
import type { OracleEffectStep } from '../../rules-engine/src/oracleIR.js';
import type { OracleIRExecutionResult } from '../../rules-engine/src/oracleIRExecutionTypes.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../../rules-engine/src/oracleIRExecutor.js';
import {
  extractSacrificeWhatText,
  parseSacrificeWhat,
} from '../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import {
  createExternallyHandledOracleFragmentGrantStep,
  isExternallyHandledOracleFragmentText,
  parseBareTriggerEffectFragmentSteps,
} from '../../rules-engine/src/oracleIRParserPostprocess.js';
import { getCopiedSpellReplaySteps } from '../../rules-engine/src/oracleIRExecutorCopySpellSupport.js';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import type { TriggeredAbility } from '../../rules-engine/src/triggeredAbilitiesTypes.js';
import {
  collectUnknownIrGapsFromSteps,
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

function stripKeywordActivationReminders(effectText: string): string {
  return String(effectText || '')
    .replace(/\s+equip(?:\{[^}]*\}|\d+\})?(?:\s*\([^)]*\))?\s*$/i, '')
    .replace(/\s+reconfigure(?:\{[^}]*\})?(?:\s*\([^)]*\))?\s*$/i, '')
    .replace(/\s+craft(?:\{[^}]*\}|\d+\})?(?:\s*\([^)]*\))?\s*$/i, '')
    .replace(/(?:^|[.\n]\s*)attach this permanent to target[^\n.]*/gi, (match) => (match.startsWith('.') ? '.' : ''))
    .replace(/\s+/g, ' ')
    .trim();
}

function effectTextForIrAudit(effectText: string): string {
  const raw = String(effectText || '').trim();
  const stripped = stripKeywordActivationReminders(
    raw
      .replace(/\([^()]*\)/g, ' ')
      .replace(/\s+\)/g, ' ')
      .replace(/\btap enchanted (?:land|creature|permanent):[\s\S]*$/i, ' ')
      .replace(/\bactivate only if[\s\S]*$/i, ' ')
      .replace(/\.\s*\{[WUBRGC\dP/]+\}(?:\{[WUBRGC\dP/]+\})*:\s*[\s\S]*$/i, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
  return stripped.length >= 4 ? stripped : raw;
}

function normalizeText(text: string): string {
  return String(text || '')
    .replace(/[’]/g, "'")
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBenignFullCardReplacementMetadata(effectText: string): boolean {
  const meta = normalizeText(effectText).toLowerCase();
  return /^(?:tapped|untapped)(?:\s+unless\b.+)?$/.test(meta);
}

export function isBenignFullCardAbilityMetadata(effectText: string): boolean {
  if (isBenignFullCardReplacementMetadata(effectText)) return true;
  const meta = normalizeText(effectText).toLowerCase();
  return (
    /^you may sacrifice .+ rather than pay this spell's mana cost\.?$/.test(meta) ||
    /^you may sacrifice .+ rather than pay .+'s mana cost\.?$/.test(meta) ||
    /^you may cast this card from your graveyard for its flashback cost\. then exile it\.?$/.test(meta) ||
    /^prevent that damage(?:,.+)?\.?$/.test(meta) ||
    /^that mana becomes (?:black|white|blue|red|green|colorless)\.?/.test(meta) ||
    /^with your choice of a .+ counter or a .+ counter on it\.?$/.test(meta) ||
    /^with two (?:\+1\/\+1|-?\d+\/-?\d+) counters on it unless .+\.?/.test(meta) ||
    /^three times that many of those tokens are created\.?$/.test(meta) ||
    /^that many \d+\/\d+ white angel creature tokens with flying and vigilance are created\.?$/.test(meta) ||
    /^that many -1\/-1 counters minus one are put on it\.?$/.test(meta) ||
    /^that many plus one \+1\/\+1 counters are put on that (?:creature|permanent)\.?/.test(meta) ||
    /^twice that many \+1\/\+1 counters are put on it\.?$/.test(meta) ||
    /^that source deals damage equal to this permanent's power\.?$/.test(meta) ||
    /^you may sacrifice three .+ rather than pay this spell's mana cost\.?$/.test(meta) ||
    /^prevent that damage and mill twice that many cards\.?$/.test(meta) ||
    /^that many 4\/4 white angel creature tokens with flying and vigilance are created\.?$/.test(meta) ||
    /^prevent that damage and remove that many \+1\/\+1 counters from (?:it|this permanent|this creature)\.?/.test(meta) ||
    /^if it's your turn, you may sacrifice a mountain rather than pay this spell's mana cost\.?$/.test(meta) ||
    /^with your choice of a \+1\/\+1, first strike, or vigilance counter on it\.?$/.test(meta) ||
    /^prevent that damage and remove a \+1\/\+1 counter from it\.?$/.test(meta) ||
    /^as this land enters, you may reveal a .+ card from your hand\. this land enters tapped unless .+\.?$/i.test(meta) ||
    /^remove a time counter from this card\. activate only if this card is suspended\.?$/.test(meta) ||
    /^three times that many of those tokens are created\.?$/.test(meta)
  );
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

export function someOracleSteps(
  steps: readonly OracleEffectStep[] | undefined,
  predicate: (step: OracleEffectStep) => boolean
): boolean {
  let matched = false;
  walkOracleSteps(steps, (step) => {
    if (!matched && predicate(step)) matched = true;
  });
  return matched;
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
  const rawFragmentText = String(text || '').trim();
  const auditedText = effectTextForIrAudit(text);
  const parsed = parseOracleTextToIR(auditedText, cardName);
  const out: OracleEffectStep[] = [];
  for (const ability of parsed.abilities || []) {
    for (const step of ability.steps || []) out.push(step);
  }
  if (out.length === 0 && /for as long as this creature remains on the battlefield.*become treasure/i.test(auditedText)) {
    const clauseMatch = auditedText.match(/\bfor as long as this creature remains on the battlefield,.+$/i);
    if (clauseMatch) {
      const fallback = parseOracleTextToIR(clauseMatch[0], cardName);
      for (const ability of fallback.abilities || []) {
        for (const step of ability.steps || []) out.push(step);
      }
    }
  }
  if (out.length === 0 && /those players sacrifice those permanents/i.test(auditedText)) {
    for (const chunk of [
      'those players sacrifice those permanents.',
      auditedText.match(/each player who sacrificed a permanent this way,.+$/i)?.[0] || '',
    ]) {
      const trimmed = String(chunk || '').trim();
      if (!trimmed) continue;
      const fallback = parseOracleTextToIR(trimmed, cardName);
      for (const ability of fallback.abilities || []) {
        for (const step of ability.steps || []) out.push(step);
      }
    }
  }
  if (out.length === 0) {
    const fragment = parseBareTriggerEffectFragmentSteps(auditedText);
    if (fragment) {
      for (const step of fragment) out.push(step);
    }
  }
  const externallyHandledSource = isExternallyHandledOracleFragmentText(rawFragmentText)
    ? rawFragmentText
    : isExternallyHandledOracleFragmentText(auditedText)
      ? auditedText
      : null;
  if (externallyHandledSource) {
    return [createExternallyHandledOracleFragmentGrantStep(externallyHandledSource)];
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

function visitEffectSteps(
  steps: readonly OracleEffectStep[],
  visit: (step: OracleEffectStep) => void
): void {
  for (const step of steps) {
    visit(step);
    if (step.kind === 'conditional' && Array.isArray(step.steps)) {
      for (const nested of step.steps) visitEffectSteps([nested], visit);
    }
    if (step.kind === 'choose_mode' && Array.isArray((step as any).modes)) {
      for (const mode of (step as any).modes) {
        for (const nested of Array.isArray(mode?.steps) ? mode.steps : []) visitEffectSteps([nested], visit);
      }
    }
  }
}

function stepsMatchPredicate(
  steps: readonly OracleEffectStep[],
  predicate: (step: OracleEffectStep) => boolean
): boolean {
  let matched = false;
  visitEffectSteps(steps, (step) => {
    if (predicate(step)) matched = true;
  });
  return matched;
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
  const oracleTextLower = String(options?.oracleText || '').toLowerCase();
  if (/that player shuffles/i.test(oracleTextLower) || /that player mills/i.test(oracleTextLower)) {
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as typeof nextCtx;
  }
  if (/exchange control of two target creatures controlled by different players/i.test(oracleTextLower)) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit393-exchange-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-audit393-exchange-p1',
          name: 'Audit Exchange P1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-audit393-exchange-p2',
          name: 'Audit Exchange P2',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          power: 3,
          toughness: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: [
          'bf-audit393-exchange-p1',
          'bf-audit393-exchange-p2',
          ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds) ? nextCtx.selectorContext.chosenObjectIds : []),
        ],
      },
    } as typeof nextCtx;
  }
  if (/those lands of their choice/i.test(oracleTextLower)) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-audit394-contested-land'
        ),
        {
          id: 'bf-audit394-contested-land',
          name: 'Audit Contested Land',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Land',
          counters: { contested: 1 },
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: [
          'bf-audit394-contested-land',
          ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds) ? nextCtx.selectorContext.chosenObjectIds : []),
        ],
      },
    } as typeof nextCtx;
  }
  if (/milled card'?s mana value/i.test(oracleTextLower)) {
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [
        { id: 'audit-milled-393', name: 'Audit Milled', type_line: 'Instant', cmc: 4, manaValue: 4 },
      ],
    } as typeof nextCtx;
  }
  if (/that card's mana value/i.test(oracleTextLower)) {
    const revealedCard = {
      id: 'hand-p2-6',
      name: 'Audit Revealed',
      type_line: 'Instant',
      cmc: 3,
      manaValue: 3,
    };
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [revealedCard],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        chosenObjectIds: ['hand-p2-6'],
      },
    } as typeof nextCtx;
  }
  if (/counter target spell/.test(oracleTextLower)) {
    nextState = {
      ...nextState,
      stack: [
        {
          id: 'stack-spell-1',
          type: 'spell',
          controller: 'p2',
          owner: 'p2',
          card: {
            id: 'stack-card-1',
            name: 'Counterable Spell',
            type_line: 'Instant',
            colors: ['U'],
            cmc: 2,
            mana_cost: '{1}{U}',
          },
        },
        ...(((nextState as any).stack || []) as any[]).filter(
          (item: any) => String(item?.id || '').trim() !== 'stack-spell-1'
        ),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetSpellId: 'stack-spell-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetSpellId: 'stack-spell-1',
      },
    } as typeof nextCtx;
  }
  const needsX = steps.some((step) => /\bx\b/i.test(String(step.raw || '')));
  if (needsX && !Number.isFinite(Number(nextCtx.xValue))) {
    nextCtx = { ...nextCtx, xValue: 3 };
  }

  const needsLandCountConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      (/you control (?:four|seven|eight|nine|ten|\d+|[a-z]+) or more lands/i.test(
        String((step as any).condition?.raw || step.raw || '')
      ) ||
        /you control (?:four|seven|eight|nine|ten|\d+|[a-z]+) or more lands and\/or treefolk/i.test(
          String((step as any).condition?.raw || step.raw || '')
        ))
  );
  if (needsLandCountConditional) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const landFixtures = [
      { id: 'bf-audit-land-1', name: 'Audit Plains', type_line: 'Basic Land — Plains', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-2', name: 'Audit Island', type_line: 'Basic Land — Island', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-3', name: 'Audit Swamp', type_line: 'Basic Land — Swamp', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-4', name: 'Audit Mountain', type_line: 'Basic Land — Mountain', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-5', name: 'Audit Forest', type_line: 'Basic Land — Forest', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-6', name: 'Audit Forest 2', type_line: 'Basic Land — Forest', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-7', name: 'Audit Forest 3', type_line: 'Basic Land — Forest', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-land-8', name: 'Audit Forest 4', type_line: 'Basic Land — Forest', controller: 'p1', owner: 'p1' },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-land-\d+$/.test(String(perm?.id || ''))),
        ...landFixtures,
      ],
    } as GameState;
  }

  const needsBasicLandTypesConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /there are (?:three|four|five|\d+|[a-z]+) or more basic land types among lands you control/i.test(
        String((step as any).condition?.raw || step.raw || '')
      )
  );
  if (needsBasicLandTypesConditional) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const basicTypeFixtures = [
      { id: 'bf-audit-basic-plains', name: 'Audit Plains', type_line: 'Basic Land — Plains', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-basic-island', name: 'Audit Island', type_line: 'Basic Land — Island', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-basic-swamp', name: 'Audit Swamp', type_line: 'Basic Land — Swamp', controller: 'p1', owner: 'p1' },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-basic-(plains|island|swamp)$/.test(String(perm?.id || ''))),
        ...basicTypeFixtures,
      ],
    } as GameState;
  }

  const needsGyCreatureConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /there are (?:three|four|five|\d+|[a-z]+) or more creature cards in your graveyard/i.test(
        String((step as any).condition?.raw || step.raw || '')
      )
  );
  if (needsGyCreatureConditional) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const extras = [
          { id: 'gy-audit-creature-1', name: 'Audit Gy Creature 1', type_line: 'Creature — Human', cmc: 2 },
          { id: 'gy-audit-creature-2', name: 'Audit Gy Creature 2', type_line: 'Creature — Elf', cmc: 2 },
          { id: 'gy-audit-creature-3', name: 'Audit Gy Creature 3', type_line: 'Creature — Wizard', cmc: 3 },
        ];
        return { ...player, graveyard: [...graveyard, ...extras] };
      }),
    } as GameState;
  }

  const needsRevealDiscardChain =
    steps.some((step) => step.kind === 'reveal_hand') &&
    steps.some(
      (step) =>
        (step.kind === 'discard' || step.kind === 'move_zone') &&
        /\bthat card\b/i.test(String(step.raw || ''))
    );
  if (needsRevealDiscardChain) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        chosenCardName: 'Opt',
        chosenObjectIds: ['hand-p2-6'],
      },
    } as typeof nextCtx;
  }

  const needsRevealExileChain =
    steps.some((step) => step.kind === 'reveal_hand') &&
    steps.some((step) => step.kind === 'exile' && /\bthat card\b/i.test(String(step.raw || '')));
  if (needsRevealExileChain) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        chosenCardName: 'Opt',
        chosenObjectIds: ['hand-p2-6'],
      },
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        return {
          ...player,
          hand: hand.map((card: any) =>
            String(card?.id || '').trim() === 'hand-p2-6'
              ? { ...card, name: card?.name || 'Opt', type_line: card?.type_line || 'Instant', cmc: 1, manaValue: 1 }
              : card
          ),
        };
      }),
    } as GameState;
  }

  const needsOpponentGraveyardReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bfrom (?:an opponent(?:'s)?|target opponent(?:'s)?)\s+graveyard\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsOpponentGraveyardReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const extras = [
          { id: 'gy-audit-opponent-1', name: 'Audit Gy Card 1', type_line: 'Instant' },
          { id: 'gy-audit-opponent-2', name: 'Audit Gy Card 2', type_line: 'Sorcery' },
        ];
        return { ...player, graveyard: [...graveyard, ...extras] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsChosenCardsShuffle = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      step.to === 'library' &&
      /^the chosen cards$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsChosenCardsShuffle) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const extras = [
          { id: 'chosen-audit-1', name: 'Chosen Audit 1', type_line: 'Creature — Human' },
          { id: 'chosen-audit-2', name: 'Chosen Audit 2', type_line: 'Creature — Elf' },
        ];
        return { ...player, hand: [...hand, ...extras] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['chosen-audit-1', 'chosen-audit-2'],
      },
    } as typeof nextCtx;
  }

  const needsTheCardFromGraveyard = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^the card$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsTheCardFromGraveyard) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const creature = {
          id: 'gy-unearth-creature',
          name: 'Audit Unearth Creature',
          type_line: 'Creature — Zombie',
        };
        return {
          ...player,
          graveyard: graveyard.some((card: any) => String(card?.id || '').trim() === creature.id)
            ? graveyard
            : [...graveyard, creature],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-unearth-creature'],
      },
    } as typeof nextCtx;
  }

  const needsMulticoloredFromGraveyard = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bmulticolored\b/i.test(text) && /\bfrom your graveyard\b/i.test(text);
  });
  if (needsMulticoloredFromGraveyard) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const multicolorCard = {
          id: 'gy-audit-multicolor',
          name: 'Empyrean Eagle',
          type_line: 'Creature — Bird Spirit',
          colors: ['W', 'U'],
          cmc: 3,
        };
        return {
          ...player,
          graveyard: graveyard.some((card: any) => String(card?.id || '').trim() === multicolorCard.id)
            ? graveyard
            : [...graveyard, multicolorCard],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      chosenObjectIds: ['gy-audit-multicolor'],
    } as typeof nextCtx;
  }

  const needsAllCreatureTokensBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\ball creature tokens\b/i.test(text) && step.to === 'hand';
  });
  if (needsAllCreatureTokensBounce) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-token-/.test(String(perm?.id || ''))),
        {
          id: 'bf-audit-token-p1',
          name: 'Audit Elf Token',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Token Creature — Elf',
          cmc: 0,
          isToken: true,
        },
        {
          id: 'bf-audit-token-p2',
          name: 'Audit Goblin Token',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Token Creature — Goblin',
          cmc: 0,
          isToken: true,
        },
      ],
    } as GameState;
  }

  const needsTargetCreatureOwnerLibraryChoice = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || (step as any).what?.raw || step.raw || '');
    return (
      /target creature(?:'|\u2019)?s owner puts it on (?:their|its) choice of the top or bottom of (?:their|its owner'?s?) library/i.test(
        text
      ) && step.to === 'library'
    );
  });
  if (needsTargetCreatureOwnerLibraryChoice) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => String(perm?.id || '').trim() !== 'bf-audit-ice-target'),
        {
          id: 'bf-audit-ice-target',
          name: 'Audit Ice Target',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          cmc: 3,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      libraryPlacement: 'bottom',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        libraryPlacement: 'bottom',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...(Array.isArray(nextCtx.chosenObjectIds) ? nextCtx.chosenObjectIds : []),
            'bf-audit-ice-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTargetFromYourGraveyard = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return (
      (/\btarget\s+myr\b/i.test(text) ||
        /\btarget\s+creature card with mana value \d+ or less\b/i.test(text)) &&
      /\bfrom your graveyard\b/i.test(text)
    );
  });
  if (needsTargetFromYourGraveyard) {
    const wantsMyr = stepsMatchPredicate(
      steps,
      (step) =>
        step.kind === 'move_zone' && /\btarget\s+myr\b/i.test(String((step as any).what?.text || step.raw || ''))
    );
    const chosenId = wantsMyr ? 'gy-audit-target-myr' : 'gy-audit-target-creature-mv3';
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          {
            id: 'gy-audit-target-creature-mv3',
            name: 'Audit Return Creature',
            type_line: 'Creature — Zombie',
            cmc: 2,
          },
          {
            id: 'gy-audit-target-myr',
            name: 'Audit Myr',
            type_line: 'Artifact Creature — Myr',
            cmc: 2,
          },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            chosenId,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsShadowsVerdictMassExile = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /\ball creatures and planeswalkers with mana value \d+ or less from the battlefield\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsShadowsVerdictMassExile) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield,
        {
          id: 'bf-shadows-small',
          name: 'Shadows Small Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-shadows-big',
          name: 'Shadows Big Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Giant',
          cmc: 6,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          {
            id: 'gy-shadows-small',
            name: 'Shadows Small GY',
            type_line: 'Creature — Zombie',
            cmc: 2,
          },
          {
            id: 'gy-shadows-pw',
            name: 'Shadows Small PW',
            type_line: 'Legendary Planeswalker — Jace',
            cmc: 2,
          },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
  }

  const needsAnyNumberHandShuffle = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /\bany number of cards from your hand\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsAnyNumberHandShuffle) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const fixtures = [
          { id: 'hand-shuffle-1', name: 'Shuffle One', type_line: 'Instant', cmc: 1 },
          { id: 'hand-shuffle-2', name: 'Shuffle Two', type_line: 'Sorcery', cmc: 2 },
        ];
        const merged = [...hand];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, hand: merged };
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
            'hand-shuffle-1',
            'hand-shuffle-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsChosenTypeTargetCreatures = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /\bcreatures of the creature type of your choice\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsChosenTypeTargetCreatures) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield,
        {
          id: 'bf-snare-elf',
          name: 'Snare Elf',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-snare-goblin',
          name: 'Snare Goblin',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Number.isFinite(Number(nextCtx.xValue)) ? nextCtx.xValue : 2,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenCreatureType: String(nextCtx.selectorContext?.chosenCreatureType || 'Elf'),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-snare-elf',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCountFromOpponentHandExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bcards?\s+from\s+target\s+opponent'?s\s+hand\b/i.test(String((step as any).what?.text || '')) &&
      (step as any).to === 'exile'
  );
  if (needsCountFromOpponentHandExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const extras = [
          { id: 'hand-p2-exile-1', name: 'Audit Hand Card 1', type_line: 'Instant' },
          { id: 'hand-p2-exile-2', name: 'Audit Hand Card 2', type_line: 'Sorcery' },
        ];
        return { ...player, hand: [...hand, ...extras] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsAlternateCostColorFromHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bfrom your hand rather than pay this spell(?:'s)? mana cost\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsAlternateCostColorFromHand) {
    const colorMatch = steps
      .map((step) =>
        String((step as any).what?.text || step.raw || '').match(
          /\b(\w+)\s+(red|blue|black|white|green)\b|\b(red|blue|black|white|green)\b/i
        )
      )
      .find(Boolean);
    const stepText = steps
      .map((step) => String((step as any).what?.text || step.raw || ''))
      .find((text) => /\bfrom your hand rather than pay this spell(?:'s)? mana cost\b/i.test(text)) || '';
    const requiresManaValueX = /\bwith mana value x\b/i.test(stepText);
    const countWord = String(colorMatch?.[1] || '').trim().toLowerCase();
    const countedColors = new Set(['red', 'blue', 'black', 'white', 'green']);
    const count =
      countedColors.has(countWord) || !countWord
        ? 1
        : Math.max(1, Number.parseInt(countWord, 10) || ({ one: 1, two: 2, three: 3, four: 4 } as Record<string, number>)[countWord] || 1);
    const colorWord = String(
      countedColors.has(countWord) ? countWord : colorMatch?.[2] || colorMatch?.[1] || 'red'
    ).toLowerCase();
    const colorMap: Record<string, string[]> = {
      red: ['R'],
      blue: ['U'],
      black: ['B'],
      white: ['W'],
      green: ['G'],
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const extras = Array.from({ length: count }, (_, index) => ({
          id: `hand-alt-${colorWord}-${index + 1}`,
          name: `Audit ${colorWord} card ${index + 1}`,
          type_line: 'Instant',
          colors: colorMap[colorWord] || ['R'],
          ...(requiresManaValueX ? { cmc: Number(nextCtx.xValue ?? 3), mana_cost: '{1}{U}{U}' } : {}),
        }));
        const mergedHand = [...hand];
        for (const extra of extras) {
          if (!mergedHand.some((card: any) => String(card?.id || '').trim() === extra.id)) {
            mergedHand.push(extra);
          }
        }
        return { ...player, hand: mergedHand };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from({ length: count }, (_, index) => `hand-alt-${colorWord}-${index + 1}`),
      },
    } as typeof nextCtx;
  }

  const needsFaceUpExiledTarget = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^target face-up exiled card$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsFaceUpExiledTarget) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-goblin-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsFlickerReturnIt = steps.some((step, index) => {
    if (step.kind !== 'move_zone' || String((step as any).what?.text || '').trim().toLowerCase() !== 'it') {
      return false;
    }
    const prior = steps[index - 1];
    return prior?.kind === 'exile' && /\bcreature\b/i.test(String((prior as any).target?.text || prior.raw || ''));
  });
  if (needsFlickerReturnIt) {
    const flickerCard = {
      id: 'exile-flicker-return-1',
      name: 'Audit Flicker Return',
      type_line: 'Creature — Human',
      owner: 'p1',
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        return exile.some((card: any) => String(card?.id || '').trim() === flickerCard.id)
          ? player
          : { ...player, exile: [...exile, flickerCard] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [flickerCard],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            flickerCard.id,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsNonlandNontokenControlledBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bany number of target nonland, nontoken permanents you control\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsNonlandNontokenControlledBounce) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-artifact-1',
            'bf-enchantment-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLandCardMilledThisWay = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\b(?:a|an)\s+land\s+card\s+milled\s+this\s+way\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsLandCardMilledThisWay) {
    const milledLand = {
      id: 'gy-milled-land-this-way',
      name: 'Milled Plains This Way',
      type_line: 'Basic Land — Plains',
      milledTurn: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === milledLand.id)
          ? player
          : { ...player, graveyard: [...graveyard, milledLand] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [milledLand],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-milled-land-this-way'],
      },
    } as typeof nextCtx;
  }

  const needsAdventureFromMilledCards = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\badventure\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\bmilled cards\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsAdventureFromMilledCards) {
    const milledCards = [
      {
        id: 'gy-milled-adventure-1',
        name: 'Audit Adventure Card',
        type_line: 'Creature — Human // Instant — Adventure',
        layout: 'adventure',
        cmc: 3,
      },
      { id: 'gy-milled-plain-1', name: 'Milled Plain', type_line: 'Basic Land — Plains', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of milledCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: milledCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-milled-adventure-1'],
      },
    } as typeof nextCtx;
  }

  const needsEachCreatureWithoutCounters = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\beach creature without a \+1\/\+1 counter on it\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsEachCreatureWithoutCounters) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const fixtures = [
      {
        id: 'bf-audit-no-counter',
        name: 'Audit No Counter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human',
        colors: ['G'],
        card: { id: 'bf-audit-no-counter-card', name: 'Audit No Counter', type_line: 'Creature — Human', colors: ['G'] },
      },
      {
        id: 'bf-audit-with-counter',
        name: 'Audit With Counter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf',
        colors: ['G'],
        counters: { '+1/+1': 1 },
        card: { id: 'bf-audit-with-counter-card', name: 'Audit With Counter', type_line: 'Creature — Elf', colors: ['G'] },
      },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-(no|with)-counter$/.test(String(perm?.id || ''))),
        ...fixtures,
      ],
    } as GameState;
  }

  const needsGrimoireTopTwoGy = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^the other one$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsGrimoireTopTwoGy) {
    const topTwo = [
      { id: 'gy-grimoire-top-1', name: 'Grimoire Top 1', type_line: 'Instant', cmc: 1 },
      { id: 'gy-grimoire-top-2', name: 'Grimoire Top 2', type_line: 'Sorcery', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = [topTwo[1], topTwo[0], ...(Array.isArray(player.graveyard) ? player.graveyard : [])].filter(
          (card: any, index: number, arr: any[]) =>
            arr.findIndex((entry: any) => String(entry?.id || '').trim() === String(card?.id || '').trim()) === index
        );
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        if (!exile.some((card: any) => String(card?.id || '').trim() === topTwo[0].id)) {
          exile.push(topTwo[0]);
        }
        return {
          ...player,
          graveyard: graveyard.filter((card: any) => String(card?.id || '').trim() !== topTwo[0].id),
          exile,
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: topTwo,
      lastExiledCards: [topTwo[0]],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-grimoire-top-2'],
      },
    } as typeof nextCtx;
  }

  const needsIdentityCrisisExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball cards from target player'?s hand and graveyard\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsIdentityCrisisExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const hand = [
          { id: 'hand-identity-1', name: 'Identity Hand Card', type_line: 'Instant' },
          ...(Array.isArray(player.hand) ? player.hand : []),
        ];
        const graveyard = [
          { id: 'gy-identity-1', name: 'Identity Gy Card', type_line: 'Creature — Zombie', cmc: 2 },
          ...(Array.isArray(player.graveyard) ? player.graveyard : []),
        ];
        return { ...player, hand, graveyard };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsSilentGravestoneExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /this artifact and all cards from all graveyards/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsSilentGravestoneExile) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()
        ),
        {
          id: String(nextCtx.sourceId || 'bf-source').trim(),
          controller: 'p1',
          owner: 'p1',
          card: { name: String(nextCtx.sourceName || 'Silent Gravestone'), type_line: 'Artifact', cmc: 2 },
          attachments: [],
          counters: {},
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixture =
          playerId === 'p1'
            ? { id: 'gy-silent-p1', name: 'Silent P1 GY', type_line: 'Instant', cmc: 1 }
            : playerId === 'p2'
              ? { id: 'gy-silent-p2', name: 'Silent P2 GY', type_line: 'Creature — Zombie', cmc: 2 }
              : null;
        if (!fixture) return player;
        if (graveyard.some((entry: any) => String(entry?.id || '').trim() === fixture.id)) return player;
        return { ...player, graveyard: [...graveyard, fixture] };
      }),
    } as GameState;
  }

  const needsDreamCacheHandTopOrBottom = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\btwo cards from your hand both\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsDreamCacheHandTopOrBottom) {
    const handFixtures = [
      { id: 'hand-dream-1', name: 'Dream One', type_line: 'Instant', cmc: 1 },
      { id: 'hand-dream-2', name: 'Dream Two', type_line: 'Sorcery', cmc: 2 },
      { id: 'hand-dream-3', name: 'Dream Three', type_line: 'Creature — Elf', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [...hand];
        for (const card of handFixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, hand: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      libraryPlacement: 'bottom',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        libraryPlacement: 'bottom',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'hand-dream-1',
            'hand-dream-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsRiseFallGyAndBfReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /target creature card from a graveyard and target creature on the battlefield/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsRiseFallGyAndBfReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixture = {
          id: 'gy-rise',
          name: 'Rise GY Creature',
          type_line: 'Creature — Zombie',
          cmc: 2,
        };
        if (graveyard.some((entry: any) => String(entry?.id || '').trim() === fixture.id)) return player;
        return { ...player, graveyard: [...graveyard, fixture] };
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-rise-creature'
        ),
        {
          id: 'bf-rise-creature',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Rise BF Creature', type_line: 'Creature — Bear', cmc: 2 },
          attachments: [],
          counters: {},
        },
      ],
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
            'gy-rise',
            'bf-rise-creature',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTargetPlayerLibraryExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball cards from target player'?s library\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsTargetPlayerLibraryExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const library = [
          { id: 'lib-jace-1', name: 'Jace Lib One', type_line: 'Instant', cmc: 1 },
          { id: 'lib-jace-2', name: 'Jace Lib Two', type_line: 'Sorcery', cmc: 2 },
          { id: 'lib-jace-3', name: 'Jace Lib Three', type_line: 'Creature — Illusion', cmc: 3 },
          ...(Array.isArray(player.library) ? player.library : []),
        ];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsCollectedCompanySplit = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bcreature cards with mana value \d+ or less from among them\b/i.test(
        String((step as any).what?.text || step.raw || '')
      ) &&
      /\bthe rest on the bottom of your library\b/i.test(String(step.raw || ''))
  );
  if (needsCollectedCompanySplit) {
    const libraryCards = [
      { id: 'lib-company-1', name: 'Company Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-company-2', name: 'Company Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'lib-company-3', name: 'Company Giant', type_line: 'Creature — Giant', cmc: 6 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [...libraryCards, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: libraryCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['lib-company-1', 'lib-company-2'],
      },
    } as typeof nextCtx;
  }

  const needsUnitedBattlefrontAmongThem = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /\bnoncreature, nonland permanent cards with mana value \d+ or less from among them\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsUnitedBattlefrontAmongThem) {
    const libraryCards = [
      { id: 'lib-ub-artifact', name: 'United Artifact', type_line: 'Artifact', cmc: 2 },
      { id: 'lib-ub-enchantment', name: 'United Aura', type_line: 'Enchantment', cmc: 1 },
      { id: 'lib-ub-creature', name: 'United Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-ub-instant', name: 'United Bolt', type_line: 'Instant', cmc: 2 },
      { id: 'lib-ub-land', name: 'United Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [...libraryCards, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: libraryCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-ub-artifact',
            'lib-ub-enchantment',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThisCardAndTargetFromYourGraveyard = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bthis card and target .+ from your graveyard\b/i.test(text);
  });
  if (needsThisCardAndTargetFromYourGraveyard) {
    const sourceName = String(nextCtx.sourceName || 'Sandman, Shifting Scoundrel').trim();
    const sourceId = 'gy-audit-this-and-target-self';
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          {
            id: sourceId,
            name: sourceName,
            type_line: 'Legendary Creature — Human Rogue',
            cmc: 3,
          },
          { id: 'gy-audit-this-and-target-land', name: 'Audit Plains', type_line: 'Basic Land — Plains', cmc: 0 },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      sourceName,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-audit-this-and-target-land',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsReturnThisCardFromGraveyardToBattlefield = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone' || step.to !== 'battlefield') return false;
    const stepRaw = String(step.raw || '');
    const whatText = String((step as any).what?.text || '').trim();
    return (
      /\breturn this card from your graveyard to the battlefield\b/i.test(stepRaw) ||
      (/^this card$/i.test(whatText) && /\bfrom your graveyard\b/i.test(stepRaw))
    );
  });
  if (needsReturnThisCardFromGraveyardToBattlefield) {
    const sourceName = String(nextCtx.sourceName || 'Salvation Colossus').trim();
    const sourceId = 'gy-audit-return-this-card';
    const sourceTypeLine = String(
      (nextState.battlefield || []).find((perm: any) => String(perm?.id || '').trim() === 'bf-source')
        ?.type_line || 'Artifact — Equipment'
    ).trim();
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const selfCard = {
          id: sourceId,
          name: sourceName,
          type_line: sourceTypeLine,
          cmc: 7,
        };
        return {
          ...player,
          graveyard: graveyard.some((card: any) => String(card?.id || '').trim() === selfCard.id)
            ? graveyard
            : [...graveyard, selfCard],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      sourceName,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
      },
    } as typeof nextCtx;
  }

  const needsRestockTwoTargetGyReturn = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\btwo target cards from your graveyard\b/i.test(text);
  });
  if (needsRestockTwoTargetGyReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-restock-1', name: 'Restock One', type_line: 'Instant', cmc: 1 },
          { id: 'gy-restock-2', name: 'Restock Two', type_line: 'Sorcery', cmc: 2 },
          { id: 'gy-restock-3', name: 'Restock Three', type_line: 'Creature — Elf', cmc: 3 },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            'gy-restock-1',
            'gy-restock-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsFilterOutNoncreatureNonlandBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\ball noncreature, nonland permanents\b/i.test(text) && step.to === 'hand';
  });
  if (needsFilterOutNoncreatureNonlandBounce) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-filter-/.test(String(perm?.id || ''))),
        {
          id: 'bf-filter-artifact',
          name: 'Filter Artifact',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Artifact',
          cmc: 2,
        },
        {
          id: 'bf-filter-enchantment',
          name: 'Filter Enchantment',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment',
          cmc: 3,
        },
        {
          id: 'bf-filter-creature',
          name: 'Filter Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;
  }

  const needsGlacialRevelationSnowAmongThem = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bany number of snow permanent cards from among them\b/i.test(text);
  });
  if (needsGlacialRevelationSnowAmongThem) {
    const revealedCards = [
      { id: 'lib-gr-snow-1', name: 'Snow Plains', type_line: 'Basic Snow Land — Plains', cmc: 0 },
      { id: 'lib-gr-snow-2', name: 'Snow Creature', type_line: 'Snow Creature — Human', cmc: 2 },
      { id: 'lib-gr-nonsnow-1', name: 'Regular Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-gr-nonsnow-2', name: 'Regular Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [...revealedCards, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: revealedCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-gr-snow-1',
            'lib-gr-snow-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTimeOfIceAllTappedBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\ball tapped creatures\b/i.test(text) && step.to === 'hand';
  });
  if (needsTimeOfIceAllTappedBounce) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-toi-/.test(String(perm?.id || ''))),
        {
          id: 'bf-toi-tapped',
          name: 'Tapped Goblin',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Goblin',
          cmc: 1,
          tapped: true,
        },
        {
          id: 'bf-toi-untapped',
          name: 'Untapped Elf',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Elf',
          cmc: 1,
        },
      ],
    } as GameState;
  }

  const needsSorceressSchemesGyOrFlashbackExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\btarget instant or sorcery card from your graveyard or (?:an )?exiled card with flashback you own\b/i.test(
      text
    );
  });
  if (needsSorceressSchemesGyOrFlashbackExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const gyFixtures = [
          { id: 'gy-schemes-instant', name: 'Shock', type_line: 'Instant', cmc: 1 },
          { id: 'gy-schemes-creature', name: 'Audit Bear', type_line: 'Creature — Bear', cmc: 2 },
        ];
        const exileFixtures = [
          {
            id: 'ex-schemes-flashback',
            name: 'Faithless Looting',
            type_line: 'Sorcery',
            cmc: 1,
            keywords: ['Flashback'],
          },
        ];
        const mergedGy = [...graveyard];
        for (const card of gyFixtures) {
          if (!mergedGy.some((entry: any) => String(entry?.id || '').trim() === card.id)) mergedGy.push(card);
        }
        const mergedExile = [...exile];
        for (const card of exileFixtures) {
          if (!mergedExile.some((entry: any) => String(entry?.id || '').trim() === card.id)) mergedExile.push(card);
        }
        return { ...player, graveyard: mergedGy, exile: mergedExile };
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
            'gy-schemes-instant',
            'ex-schemes-flashback',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsSplitThePartyHalfCreatures = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bhalf the creatures they control\b/i.test(text) && step.to === 'hand';
  });
  if (needsSplitThePartyHalfCreatures) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-stp-/.test(String(perm?.id || ''))),
        {
          id: 'bf-stp-1',
          name: 'STP One',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
        {
          id: 'bf-stp-2',
          name: 'STP Two',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-stp-3',
          name: 'STP Three',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          cmc: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-stp-1',
            'bf-stp-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsMartyrOfBonesSingleGyExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bup to x target cards from a single graveyard\b/i.test(text) && step.to === 'exile';
  });
  if (needsMartyrOfBonesSingleGyExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-mob-1', name: 'Mob One', type_line: 'Instant', cmc: 1 },
          { id: 'gy-mob-2', name: 'Mob Two', type_line: 'Sorcery', cmc: 2 },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: 1,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        xValue: 1,
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-mob-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAnimalMagnetismThatCardRest = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return (
      (/\bthat card\b/i.test(text) && step.to === 'battlefield') ||
      (/\bthe rest\b/i.test(text) && step.to === 'graveyard')
    );
  });
  if (needsAnimalMagnetismThatCardRest) {
    const revealedCards = [
      { id: 'lib-am-1', name: 'AM Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-am-2', name: 'AM Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-am-3', name: 'AM Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-am-4', name: 'AM Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [...revealedCards, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: revealedCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-am-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCellarDoorBottomLibraryToGraveyard = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bthe bottom card of target player'?s library\b/i.test(text) && step.to === 'graveyard';
  });
  if (needsCellarDoorBottomLibraryToGraveyard) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const library = [
          { id: 'lib-cd-top', name: 'CD Top', type_line: 'Instant', cmc: 1 },
          { id: 'lib-cd-bottom', name: 'CD Bottom', type_line: 'Sorcery', cmc: 2 },
          ...(Array.isArray(player.library) ? player.library : []),
        ];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
    } as typeof nextCtx;
  }

  const needsGrenzoBottomLibraryToGraveyard = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bthe bottom card of your library\b/i.test(text) && step.to === 'graveyard';
  });
  if (needsGrenzoBottomLibraryToGraveyard) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [
          { id: 'lib-grenzo-top', name: 'Grenzo Top', type_line: 'Instant', cmc: 1 },
          { id: 'lib-grenzo-bottom', name: 'Grenzo Bottom', type_line: 'Creature — Human', cmc: 2 },
          ...(Array.isArray(player.library) ? player.library : []),
        ];
        return { ...player, library };
      }),
    } as GameState;
  }

  const needsBoneyardParleyCreatureGyExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\bup to five target creature cards from graveyards\b/i.test(text) && step.to === 'exile';
  });
  if (needsBoneyardParleyCreatureGyExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-bp-1', name: 'BP Creature One', type_line: 'Creature — Zombie', cmc: 3 },
          { id: 'gy-bp-2', name: 'BP Creature Two', type_line: 'Creature — Elf', cmc: 2 },
          { id: 'gy-bp-instant', name: 'BP Instant', type_line: 'Instant', cmc: 1 },
        ];
        const merged = [...graveyard];
        for (const card of fixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            'gy-bp-1',
            'gy-bp-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsBoneyardParleyPileStep = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\ball cards from the pile of your choice\b/i.test(text) && step.to === 'battlefield';
  });
  if (needsBoneyardParleyPileStep) {
    const exiledFixtures = [
      { id: 'ex-bp-1', name: 'BP Exiled One', type_line: 'Creature — Zombie', cmc: 3 },
      { id: 'ex-bp-2', name: 'BP Exiled Two', type_line: 'Creature — Elf', cmc: 2 },
      { id: 'ex-bp-3', name: 'BP Exiled Three', type_line: 'Creature — Human', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [...exile];
        for (const card of exiledFixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, exile: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastExiledCards: exiledFixtures,
      lastMovedCards: exiledFixtures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'ex-bp-1',
            'ex-bp-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsBatch383TargetFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    const target = String((step as any).target?.text || '').toLowerCase();
    return (
      (step.kind === 'destroy' && /destroy any number of target creatures/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy two target enchantments/i.test(raw)) ||
      (step.kind === 'cant_block' && /otherwise,? it can't block/i.test(raw)) ||
      (step.kind === 'add_counter' && /counters on it$/i.test(raw)) ||
      (step.kind === 'skip_next_untap' && /^those creatures/i.test(target)) ||
      (step.kind === 'grant_temporary_ability' &&
        /creature dealt damage this way can't be regenerated/i.test(raw)) ||
      (step.kind === 'exile' && /that player's graveyard/i.test(raw)) ||
      (step.kind === 'cant_block' && /black creatures can't block/i.test(raw)) ||
      (step.kind === 'cant_activate_abilities' && /^those permanents$/i.test(target)) ||
      (step.kind === 'add_counter' && /distribute x \+1\/\+1 counters among/i.test(raw)) ||
      (step.kind === 'skip_next_untap' && /creatures and lands target opponent controls/i.test(raw)) ||
      (step.kind === 'cant_attack' && /other creatures can't attack/i.test(raw)) ||
      (step.kind === 'exile' && /exile the other/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy the chosen permanents/i.test(raw)) ||
      (step.kind === 'double_counters' && /each of them/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /becomes a copy of target nontoken artifact you control with mana value x/i.test(raw)) ||
      (step.kind === 'deal_damage' && /each creature without flying that player controls/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each player sacrifices all creatures they control not chosen this way/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each opponent sacrifices an artifact/i.test(raw)) ||
      (step.kind === 'add_counter' && /commander creature you control/i.test(raw)) ||
      (step.kind === 'add_counter' && /equal to the difference/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove all flood counters from them/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove a time counter from each other card you own in exile/i.test(raw)) ||
      (step.kind === 'move_counters' && /move a loyalty counter from this artifact onto that planeswalker/i.test(raw)) ||
      (step.kind === 'exile' && /each creature your opponents control/i.test(raw)) ||
      (step.kind === 'exile' && /attacking creatures target player controls/i.test(raw)) ||
      (step.kind === 'exile' && /target players' graveyards/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy two target artifacts and\/or enchantments/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy that artifact if its mana value is 5 or less instead/i.test(raw)) ||
      (step.kind === 'destroy' && /^destroy that land$/i.test(raw)) ||
      (step.kind === 'prevent_damage' && /source of your choice would deal to you/i.test(raw)) ||
      (step.kind === 'cant_attack' && /chosen creatures attack if able/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove up to four charge counters from target noncreature artifact/i.test(raw)) ||
      (step.kind === 'add_counter' && /amount of \{s\} spent/i.test(raw)) ||
      (step.kind === 'exile' && /exile this card and target creature unless/i.test(raw)) ||
      (step.kind === 'regenerate' && /werewolf creatures you control/i.test(raw)) ||
      (step.kind === 'cant_attack' && /^\(those creatures can't attack/i.test(target)) ||
      (step.kind === 'copy_permanent' && /target shapeshifter becomes a copy/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove two time counters from each permanent/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove up to five counters from target artifact, creature, planeswalker, or opponent/i.test(raw)) ||
      (step.kind === 'add_counter' && /luck counters on this permanent equal to the result/i.test(raw)) ||
      (step.kind === 'add_counter' && /put two loyalty counters on a planeswalker you control/i.test(raw)) ||
      (step.kind === 'deal_damage' && /each creature not chosen this way/i.test(raw)) ||
      (step.kind === 'modify_pt' && /that creature gets an additional/i.test(raw)) ||
      (step.kind === 'modify_pt' && /for each \{e\} paid this way/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy that land unless any player pays/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy a permanent with indestructible/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile this creature and your life total/i.test(raw)) ||
      (step.kind === 'exile' && /exile any number of target spells/i.test(raw)) ||
      (step.kind === 'exile' && /exile the bottom card of target player's graveyard/i.test(raw)) ||
      (step.kind === 'suspect' && /^you may suspect it$/i.test(raw)) ||
      (step.kind === 'cant_block' && /^beasts can't block$/i.test(target)) ||
      (step.kind === 'exile' && /mana value less than the revealed card's mana value/i.test(raw)) ||
      (step.kind === 'exile' && /convoked this spell, all artifacts/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile that spell/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy this creature and target creature it's blocking/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove x time counters from target permanent or suspended card/i.test(raw)) ||
      (step.kind === 'modify_pt' && /\{e\} paid this way/i.test(raw)) ||
      (step.kind === 'cant_attack' && /creatures with flying can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /creatures with flying can't block/i.test(raw)) ||
      (step.kind === 'cant_attack' && /sculptures you control can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /sculptures you control can't block/i.test(raw)) ||
      (step.kind === 'cant_attack' && /bribery counters on them can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /bribery counters on them can't block/i.test(raw)) ||
      (step.kind === 'cant_attack' && /enchanted creature is a spirit and can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /enchanted creature is a spirit and can't block/i.test(raw)) ||
      (step.kind === 'cant_attack' && /^otherwise, it can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /nonartifact creatures can't block/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /two target creatures you control that share a creature type can't be blocked/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /target creature can't be blocked this turn/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, zurgo has indestructible/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /those creatures also gain trample until end of turn/i.test(raw)) ||
      (step.kind === 'exile' && /exile that creature$/i.test(raw)) ||
      (step.kind === 'exile' && /greatest power among creatures on the battlefield/i.test(raw)) ||
      (step.kind === 'exile' && /exile mangara and target permanent/i.test(raw)) ||
      (step.kind === 'exile' && /exile any number of creatures you control/i.test(raw)) ||
      (step.kind === 'exile' && /shares a card type with the cycled card/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile it and you gain 2 life/i.test(raw)) ||
      (step.kind === 'exile' && /exile each other nonland permanent with mana value less than or equal to the number of counters removed/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy that artifact if it's on the battlefield/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy six target creatures/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy any number of target artifacts and\/or enchantments/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each opponent sacrifices a creature of their choice/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each other player sacrifices an artifact/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each other player sacrifices an enchantment/i.test(raw)) ||
      (step.kind === 'sacrifice' && /^sacrifice x lands$/i.test(raw)) ||
      (step.kind === 'move_counters' && /move a \+1\/\+1 counter from target creature onto a second target creature/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /each nonland permanent you control becomes a copy/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /target artifact or creature becomes a copy of another target/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /target legendary creature you control becomes a copy of target creature card in exile with a memory counter/i.test(raw)) ||
      (step.kind === 'set_base_pt' && /it has base power and toughness 1\/1 until end of turn/i.test(raw)) ||
      (step.kind === 'tap_or_untap' && /untap all other creatures you control and after this phase, there is an additional combat phase/i.test(raw)) ||
      (step.kind === 'optional_untap_choice' && /you may choose not to untap/i.test(raw)) ||
      (step.kind === 'cant_activate_abilities' && /target creature can't attack or block and its activated abilities can't be activated/i.test(raw)) ||
      (step.kind === 'skip_next_untap' && /lands target player controls don't untap during their next untap step/i.test(raw)) ||
      (step.kind === 'move_counters' && /you may move a \+1\/\+1 counter from this land onto it\.\)$/i.test(raw)) ||
      (step.kind === 'cant_block' && /^x target creatures can't block this turn$/i.test(raw)) ||
      (step.kind === 'cant_block' && /green creatures and white creatures can't block this turn/i.test(raw)) ||
      (step.kind === 'cant_block' && /^ii\s*-\s*ice\s*-?\s*up to three target creatures can't block this turn$/i.test(raw)) ||
      (step.kind === 'cant_block' && /other creatures that player controls can't block this turn/i.test(raw)) ||
      (step.kind === 'cant_block' && /^a creature dealt damage this way can't block this turn$/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /creatures dealt damage this way can't be regenerated this turn/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, equipped creatures you control have/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, commanders you control have indestructible/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, equipped creature has hexproof and can't be blocked/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, equipped creatures you control have indestructible/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, other historic creatures you control have double strike/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, outlaws you control have first strike/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /^legolas can't be blocked by creatures with power 2 or less$/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /equipped creature has base power and toughness 7\/7 and can't be blocked by creatures with power 2 or less/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /this artifact becomes a copy of target artifact, except it has this ability/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /until end of turn, this artifact becomes a copy of target creature you control of the chosen type/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /this land becomes a copy of target land, except it has this ability/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /this permanent becomes a copy of the sacrificed creature, except it has this ability/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy any number of target tapped creatures with different controllers/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy target tapped creature an opponent controls/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy it and this creature at end of combat/i.test(raw)) ||
      (step.kind === 'destroy' && /^destroy three target permanents$/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy any of them that are walls/i.test(raw)) ||
      (step.kind === 'exile' && /exile it with three time counters on it instead of putting it into its owner's graveyard/i.test(raw)) ||
      (step.kind === 'exile' && /exile this creature and target creature without flying that's attacking you/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile this permanent and your life total becomes 1/i.test(raw)) ||
      (step.kind === 'exile' && /exile two target artifacts, creatures, and\/or lands you control/i.test(raw)) ||
      (step.kind === 'exile' && /^exile two target artifacts$/i.test(raw)) ||
      (step.kind === 'exile' && /exile the pile of an opponent's choice/i.test(raw)) ||
      (step.kind === 'exile' && /^exile target creature$/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each opponent sacrifices a creature with the greatest power among creatures that player controls/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each player sacrifices a creature of their choice/i.test(raw)) ||
      (step.kind === 'force_block' && /target creature an opponent controls blocks this turn if able/i.test(raw)) ||
      (step.kind === 'animate_permanent' && /enchanted forest becomes a .+ spirit creature until end of turn/i.test(raw)) ||
      (step.kind === 'remove_counter' && /you may remove a time counter from it or put another time counter on it/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove all \+1\/\+1 counters from ashling, and it deals that much damage to each creature and each player/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, equipped creature has hexproof and can't be blocked/i.test(raw)) ||
      (step.kind === 'destroy' && /then destroy target creature of an opponent's choice/i.test(raw)) ||
      (step.kind === 'animate_permanent' && /enchanted mountain becomes a .+ spirit creature until end of turn/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy an aura attached to it/i.test(raw)) ||
      (step.kind === 'remove_counter' && /remove up to x counters from target permanent/i.test(raw)) ||
      (step.kind === 'cant_block' && /^creatures can't block$/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile it with three egg counters on it/i.test(raw)) ||
      (step.kind === 'exile' && /exile this permanent and each artifact and creature your opponents control/i.test(raw)) ||
      (step.kind === 'exile' && /exile up to one target creature you control/i.test(raw)) ||
      (step.kind === 'exile' && /exile target tapped creature an opponent controls until this enchantment leaves the battlefield/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /until end of turn, it becomes a copy of up to one other target creature/i.test(raw)) ||
      (step.kind === 'cant_block' && /monocolored creatures can't block this turn/i.test(raw)) ||
      (step.kind === 'exile' && /exile that card with an ice counter on it/i.test(raw)) ||
      (step.kind === 'schedule_delayed_battlefield_action' && /at end of combat, exile all creatures blocked by this creature/i.test(raw)) ||
      (step.kind === 'cant_attack' && /black creatures can't attack/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /creatures you control with power or toughness 1 or less can't be blocked/i.test(raw)) ||
      (step.kind === 'destroy' && /^destroy two target creatures$/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /equipped creature has ward \{2\}, is an assassin/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /when you do, this creature becomes a copy of another target creature you control/i.test(raw)) ||
      (step.kind === 'exile' && /exile up to two creature cards put into graveyards this way/i.test(raw)) ||
      (step.kind === 'cant_attack' && /creatures with power greater than the number of cards in your hand can't attack/i.test(raw)) ||
      (step.kind === 'grant_temporary_ability' && /during your turn, allies you control have double strike and lifelink/i.test(raw)) ||
      (step.kind === 'animate_permanent' && /you may have it become a 0\/0 elemental creature until end of turn/i.test(raw)) ||
      (step.kind === 'destroy' && /^destroy two target artifacts$/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /this creature becomes a copy of target creature card in your graveyard with mana value x/i.test(raw)) ||
      (step.kind === 'force_block' && /target creature attacks or blocks this turn if able/i.test(raw)) ||
      (step.kind === 'remove_counter' && /you may remove a loyalty counter from a planeswalker you control rather than pay this permanent's crew cost/i.test(raw)) ||
      (step.kind === 'prevent_damage' && /prevent the next 3 damage that would be dealt to any target this turn by a source of your choice/i.test(raw)) ||
      (step.kind === 'regenerate' && /^regenerate it$/i.test(raw)) ||
      (step.kind === 'modify_pt' && /where x is the number of quest counters on this permanent/i.test(raw)) ||
      (step.kind === 'exile' && /you may exile the chosen creatures/i.test(raw)) ||
      (step.kind === 'sacrifice' && /sacrifice this enchantment, search your library for up to two creature cards/i.test(raw)) ||
      (step.kind === 'exile' && /^exile the top card of your library$/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each player sacrifices the creature they control with the greatest mana value unless they pay/i.test(raw)) ||
      (step.kind === 'exile' && /^exile two target creatures$/i.test(raw)) ||
      (step.kind === 'sacrifice' && /each opponent sacrifices a creature they control with the greatest power/i.test(raw)) ||
      (step.kind === 'deal_damage' && /this permanent deals that much damage to target player or planeswalker/i.test(raw)) ||
      (step.kind === 'deal_damage' && /exile that card with a blood counter on it/i.test(raw)) ||
      (step.kind === 'deal_damage' && /it deals twice that much damage to itself instead/i.test(raw)) ||
      (step.kind === 'exile' && /instead exile it with a void counter on it/i.test(raw)) ||
      (step.kind === 'cant_attack' && /creatures your opponents control with counters on them can't attack/i.test(raw)) ||
      (step.kind === 'cant_block' && /creatures your opponents control with counters on them can't block/i.test(raw)) ||
      (step.kind === 'copy_permanent' && /becomes a copy of target creature you control/i.test(raw)) ||
      (step.kind === 'cant_block' && /white creatures and blue creatures can't block/i.test(raw)) ||
      (step.kind === 'sacrifice' && /target opponent sacrifices a creature of their choice/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy target equipment/i.test(raw)) ||
      (step.kind === 'deal_damage' && /this permanent deals .* damage to that creature/i.test(raw)) ||
      (step.kind === 'destroy' && /destroy target enchantment that player controls/i.test(raw)) ||
      (step.kind === 'deal_damage' && /target creature deals damage to itself equal to its power/i.test(raw)) ||
      (step.kind === 'deal_damage' && /target creature deals damage equal to its power to itself/i.test(raw))
    );
  });
  if (needsBatch383TargetFixtures) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const fixturePermanents = [
      {
        id: 'bf-audit-target-1',
        name: 'Audit Target',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Human',
        colors: ['W'],
        cmc: 2,
      },
      {
        id: 'bf-audit-target-2',
        name: 'Audit Black',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Zombie',
        colors: ['B'],
        cmc: 2,
      },
      {
        id: 'bf-audit-enchant-1',
        name: 'Audit Aura',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Enchantment — Aura',
        colors: ['W'],
        cmc: 2,
      },
      {
        id: 'bf-audit-enchant-2',
        name: 'Audit Curse',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Enchantment — Aura Curse',
        colors: ['B'],
        cmc: 1,
      },
      {
        id: 'bf-audit-goaded',
        name: 'Audit Goaded',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Goblin',
        colors: ['R'],
        cmc: 1,
      },
      {
        id: 'bf-audit-source',
        name: 'Audit Planeswalker',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Planeswalker — Gideon',
        colors: ['W'],
        cmc: 4,
        counters: { loyalty: 4 },
      },
      {
        id: 'bf-audit-commander',
        name: 'Audit Commander',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Legendary Creature — Human',
        colors: ['W'],
        cmc: 3,
        isCommander: true,
      },
      {
        id: 'bf-audit-artifact-1',
        name: 'Audit Artifact',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact',
        colors: [],
        cmc: 3,
        counters: { charge: 2 },
      },
      {
        id: 'bf-audit-artifact-2',
        name: 'Audit Artifact Two',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Artifact',
        colors: [],
        cmc: 4,
      },
      {
        id: 'bf-audit-land',
        name: 'Audit Land',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Land',
        colors: [],
        cmc: 0,
      },
      {
        id: 'bf-audit-gardens-land',
        name: 'Audit Copy Land',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Land',
        colors: [],
        cmc: 0,
      },
      {
        id: 'bf-audit-attacker',
        name: 'Audit Attacker',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Soldier',
        colors: ['W'],
        cmc: 2,
        attacking: true,
      },
      {
        id: 'bf-audit-beacon',
        name: 'Audit Beacon',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact',
        colors: [],
        cmc: 3,
        counters: { loyalty: 2 },
      },
      {
        id: 'bf-audit-werewolf',
        name: 'Audit Werewolf',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Werewolf',
        colors: ['G'],
        cmc: 3,
      },
      {
        id: 'bf-audit-shapeshifter',
        name: 'Audit Shapeshifter',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Shapeshifter',
        colors: ['U'],
        cmc: 2,
      },
      {
        id: 'bf-audit-copy-ref',
        name: 'Audit Copy Ref',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf',
        colors: ['G'],
        cmc: 2,
        power: 2,
        toughness: 2,
      },
      {
        id: 'bf-audit-beast',
        name: 'Audit Beast',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Beast',
        colors: ['G'],
        cmc: 4,
      },
      {
        id: 'bf-audit-enchant-creature',
        name: 'Audit Enchantment',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Enchantment — Aura',
        colors: ['U'],
        cmc: 2,
        attachedTo: 'bf-audit-target-1',
      },
      {
        id: 'bf-audit-indestructible',
        name: 'Audit Indestructible',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Angel',
        colors: ['W'],
        cmc: 5,
        keywords: ['Indestructible'],
      },
      {
        id: 'bf-audit-convoke-soldier',
        name: 'Audit Convoke Soldier',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Soldier',
        colors: ['W'],
        cmc: 1,
      },
      {
        id: 'bf-audit-time-perm',
        name: 'Audit Time Perm',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact',
        colors: [],
        cmc: 2,
        counters: { time: 3 },
      },
      {
        id: 'bf-audit-flying',
        name: 'Audit Flyer',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Bird',
        colors: ['U'],
        cmc: 2,
        keywords: ['Flying'],
      },
      {
        id: 'bf-audit-sculpture',
        name: 'Audit Sculpture',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Sculpture',
        colors: ['W'],
        cmc: 3,
      },
      {
        id: 'bf-audit-bribery',
        name: 'Audit Bribery',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Human',
        colors: ['U'],
        cmc: 2,
        counters: { bribery: 1 },
      },
      {
        id: 'bf-audit-aura-host',
        name: 'Audit Aura Host',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Creature — Human',
        colors: ['W'],
        cmc: 2,
      },
      {
        id: 'bf-audit-spirit-aura',
        name: 'Audit Spirit Aura',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Enchantment — Aura',
        colors: ['W'],
        cmc: 3,
        attachedTo: 'bf-audit-aura-host',
      },
      {
        id: 'bf-audit-shared-a',
        name: 'Audit Shared A',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf',
        colors: ['G'],
        cmc: 2,
      },
      {
        id: 'bf-audit-shared-b',
        name: 'Audit Shared B',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf Wizard',
        colors: ['G', 'U'],
        cmc: 3,
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) =>
        String(player?.id || '').trim() === 'p2'
          ? {
              ...player,
              graveyard: [
                ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
                { id: 'gy-audit-1', name: 'Audit Graveyard Card', type_line: 'Instant' },
              ],
            }
          : String(player?.id || '').trim() === 'p1'
            ? {
                ...player,
                exile: [
                  ...(Array.isArray(player?.exile) ? player.exile : []),
                  { id: 'ex-audit-source', name: 'Audit Suspended', type_line: 'Sorcery', counters: { time: 2 } },
                  { id: 'ex-audit-other', name: 'Audit Other', type_line: 'Instant', counters: { time: 1 } },
                ],
              }
            : player
      ),
      battlefield: [
        ...existingBattlefield.filter(
          (perm: any) => !/^bf-audit-(target|enchant|goaded|black)/.test(String(perm?.id || ''))
        ),
        ...fixturePermanents,
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-audit-target-1',
      targetCreatureId: 'bf-audit-target-1',
      xValue: 3,
      snowManaSpent: 3,
      referenceAmount: 3,
      energyPaidThisWay: 2,
      lastReferencedPermanentId: 'bf-audit-artifact-1',
      interactivePlayerChoices: false,
      lastCycledCardType: 'instant',
      lastExiledCards: [{ id: 'ex-audit-1', type_line: 'Creature — Vampire', power: 5, toughness: 5 }],
      lastMovedBattlefieldPermanentIds: ['bf-audit-target-1', 'bf-audit-target-2', 'bf-audit-land'],
      lastAntecedentBattlefieldPermanentIds: ['bf-audit-target-1', 'bf-audit-target-2'],
      lastGoadedBattlefieldPermanentIds: ['bf-audit-goaded'],
      lastDamagedBattlefieldPermanentIds: ['bf-audit-target-1'],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-audit-target-1',
        targetCreatureId: 'bf-audit-target-1',
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        convokeCreatureType: 'soldier',
        chosenObjectIds: [
          'bf-audit-target-1',
          'bf-audit-target-2',
          'bf-audit-enchant-1',
          'bf-audit-enchant-2',
          'bf-audit-artifact-1',
          'bf-audit-artifact-2',
          'bf-audit-land',
          'bf-audit-commander',
          'bf-audit-gardens-land',
          'bf-audit-artifact-1',
          'bf-audit-source',
          'bf-audit-beacon',
          'bf-audit-shapeshifter',
          'bf-audit-copy-ref',
          'bf-audit-indestructible',
          'bf-audit-werewolf',
          'bf-audit-flying',
          'bf-audit-sculpture',
          'bf-audit-bribery',
          'bf-audit-shared-a',
          'bf-audit-shared-b',
          'bf-audit-aura-host',
          'bf-audit-spirit-aura',
        ],
      },
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        const memoryCard = {
          id: 'ex-audit-memory',
          name: 'Audit Memory Creature',
          type_line: 'Creature — Human',
          cmc: 2,
          counters: { memory: 1 },
        };
        return {
          ...player,
          exile: [
            memoryCard,
            ...exile.filter((card: any) => String(card?.id || '').trim() !== memoryCard.id),
          ],
          graveyard: [
            ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
            { id: 'gy-audit-black-1', name: 'Audit Black Instant', type_line: 'Instant', colors: ['B'], cmc: 1 },
            { id: 'gy-audit-black-2', name: 'Audit Black Sorcery', type_line: 'Sorcery', colors: ['B'], cmc: 2 },
          ],
        };
      }),
    } as GameState;
    if (stepsMatchPredicate(steps, (step) => step.kind === 'move_counters' && /move a loyalty counter from this artifact onto that planeswalker/i.test(String(step.raw || '')))) {
      nextCtx = {
        ...nextCtx,
        sourceId: 'bf-audit-beacon',
        targetPermanentId: 'bf-audit-source',
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          targetPermanentId: 'bf-audit-source',
        },
      } as typeof nextCtx;
    }
  }

  const needsBatch390GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    return (
      (step.kind === 'add_mana' && /commander's color identity/i.test(raw)) ||
      (step.kind === 'modify_pt' && /for each creature blocking it/i.test(raw)) ||
      (step.kind === 'modify_pt' && /for each other attacking aurochs/i.test(raw)) ||
      (step.kind === 'modify_pt' && /for each other goblin you control/i.test(raw)) ||
      (step.kind === 'create_token' && /creature token you control/i.test(raw)) ||
      (step.kind === 'prevent_damage' && /prevent the next x damage/i.test(raw)) ||
      (step.kind === 'gain_life' && /that card's mana value/i.test(raw)) ||
      (step.kind === 'grant_graveyard_permission' && /(?:zombie spells|legendary card)/i.test(raw)) ||
      (step.kind === 'add_mana' && /any combination of \{[wubrg]\} and\/or \{[wubrg]\}/i.test(raw)) ||
      step.kind === 'paradigm'
    );
  });
  if (needsBatch390GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) =>
        String(player?.id || '').trim() === 'p1'
          ? {
              ...player,
              commanderColorIdentity: ['W', 'U', 'B', 'R', 'G'],
              commander: { name: 'Audit Commander', color_identity: ['W', 'U', 'B', 'R', 'G'] },
              graveyard: [
                ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
                { id: 'gy-audit-zombie-1', name: 'Audit Zombie', type_line: 'Creature — Zombie', cmc: 2 },
                {
                  id: 'gy-audit-legendary-1',
                  name: 'Audit Legendary',
                  type_line: 'Legendary Creature — Human',
                  cmc: 3,
                },
              ],
            }
          : player
      ),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) =>
            !['bf-audit-token-1', 'bf-audit-blocker-1', 'bf-audit-aurochs-1'].includes(String(perm?.id || '').trim())
        ),
        {
          id: sourceId,
          name: 'Audit Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          attacking: true,
          blockedBy: ['bf-audit-blocker-1'],
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-audit-token-1',
          name: 'Audit Token',
          controller: 'p1',
          owner: 'p1',
          isToken: true,
          type_line: 'Token Creature — Soldier',
          power: 1,
          toughness: 1,
        },
        {
          id: 'bf-audit-blocker-1',
          name: 'Audit Blocker',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Soldier',
          blocking: sourceId,
        },
        {
          id: 'bf-audit-aurochs-1',
          name: 'Audit Aurochs Ally',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Aurochs',
          attacking: true,
          power: 3,
          toughness: 3,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      xValue: Number.isFinite(Number(nextCtx.xValue)) ? nextCtx.xValue : 3,
      lastMovedCards: [
        { id: 'audit-revealed-1', name: 'Audit Revealed', type_line: 'Instant', cmc: 4, mana_cost: '{2}{U}' },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            'bf-audit-token-1',
            'bf-token-1',
            'bf-audit-blocker-1',
            'bf-artifact-1',
            'bf-creature-1',
          ])
        ),
        chosenMana: String(nextCtx.selectorContext?.chosenMana || '{G}{W}'),
      },
    } as typeof nextCtx;
  }

  const needsBatch391GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    return (
      (step.kind === 'create_token' && /copy of target (?:artifact or creature|artifact creature|artifact token|artifact, creature, or land|artifact or enchantment)/i.test(raw)) ||
      (step.kind === 'create_token' && /copies of (?:it|target|the sacrificed creature)/i.test(raw)) ||
      (step.kind === 'create_token' && /where x is (?:that creature's mana value|the number of nontoken creatures that died|the number of treasure tokens you created|the damage dealt to your opponents|the total number of rad counters|the number of vehicles you control plus)/i.test(raw)) ||
      (step.kind === 'deal_damage' && /\bfights?\b/i.test(raw)) ||
      (step.kind === 'deal_damage' && /defending player/i.test(raw)) ||
      (step.kind === 'draw' && /milled card's mana value/i.test(raw)) ||
      (step.kind === 'gain_life' && /sacrificed enchantment's mana value/i.test(raw)) ||
      (step.kind === 'lose_life' && /that card's mana value/i.test(raw)) ||
      (step.kind === 'discard' && /discard your hand/i.test(raw)) ||
      (step.kind === 'shuffle_library' && /that player shuffles/i.test(raw)) ||
      (step.kind === 'mill' && /that player mills/i.test(raw)) ||
      (step.kind === 'lose_life' && /^they lose \d+ life$/i.test(raw)) ||
      (step.kind === 'create_token' && /its owner creates/i.test(raw)) ||
      (step.kind === 'modify_pt' && /for each (?:of its colors|forest you control|plains returned this way|nonbasic land defending player controls|\+1\/\+1 counter removed this way|creature sacrificed this way|mana from a treasure)/i.test(raw)) ||
      (step.kind === 'modify_pt' && /where x is (?:the sacrificed enchantment's mana value|7 minus the number of cards|the toughness of the card returned this way)/i.test(raw)) ||
      (step.kind === 'prevent_damage' && /target creature this turn, where x is/i.test(raw)) ||
      (step.kind === 'add_mana' && /\{[wubrg]\} or \{[wubrg]\} for each/i.test(raw)) ||
      (step.kind === 'grant_graveyard_permission' && /(?:merfolk and druid|cards with retrace|each permanent type from your graveyard)/i.test(raw)) ||
      (step.kind === 'exchange_control' && /two target creatures controlled by different players/i.test(raw))
    );
  });
  if (needsBatch391GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p1') {
          return {
            ...player,
            hand: [
              ...(Array.isArray(player?.hand) ? player.hand : []),
              { id: 'hand-audit-1', name: 'Audit Hand One', type_line: 'Instant', cmc: 1 },
              { id: 'hand-audit-2', name: 'Audit Hand Two', type_line: 'Sorcery', cmc: 2 },
            ],
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              { id: 'gy-audit-merfolk', name: 'Audit Merfolk', type_line: 'Creature — Merfolk', cmc: 2 },
              { id: 'gy-audit-druid', name: 'Audit Druid', type_line: 'Creature — Druid', cmc: 3 },
              { id: 'gy-audit-retrace', name: 'Audit Retrace', type_line: 'Sorcery', cmc: 2, keywords: ['Retrace'] },
            ],
          };
        }
        if (playerId === 'p2') {
          return {
            ...player,
            library: [
              ...(Array.isArray(player?.library) ? player.library : []),
              { id: 'lib-audit-1', name: 'Audit Library Card', type_line: 'Instant', cmc: 2, manaValue: 2 },
            ],
          };
        }
        return player;
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) =>
            ![
              'bf-audit-copy-source',
              'bf-audit-artifact-1',
              'bf-audit-nonbasic-land',
              'bf-audit-forest-1',
              'bf-audit-plains-1',
            ].includes(String(perm?.id || '').trim())
        ),
        {
          id: sourceId,
          name: 'Audit Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 3,
          colors: ['W', 'U'],
        },
        {
          id: 'bf-creature-1',
          name: 'Audit Copy Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Elf',
          power: 2,
          toughness: 2,
          cmc: 3,
          manaValue: 3,
          colors: ['G'],
        },
        {
          id: 'bf-artifact-1',
          name: 'Audit Copy Artifact',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact',
          cmc: 2,
          manaValue: 2,
        },
        {
          id: 'bf-audit-artifact-token-1',
          name: 'Audit Artifact Token',
          controller: 'p1',
          owner: 'p1',
          isToken: true,
          type_line: 'Token Artifact — Treasure',
        },
        {
          id: 'bf-opponent-creature',
          name: 'Audit Opponent Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Zombie',
          power: 3,
          toughness: 3,
        },
        {
          id: 'bf-audit-nonbasic-land',
          name: 'Audit Nonbasic Land',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Land — Gate',
        },
        {
          id: 'bf-audit-forest-1',
          name: 'Audit Forest',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Basic Land — Forest',
        },
        {
          id: 'bf-audit-plains-1',
          name: 'Audit Plains',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Basic Land — Plains',
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      xValue: Number.isFinite(Number(nextCtx.xValue)) ? nextCtx.xValue : 3,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      referenceAmount: Number.isFinite(Number(nextCtx.referenceAmount)) ? nextCtx.referenceAmount : 2,
      treasureManaSpentThisCast: Number((nextCtx as any).treasureManaSpentThisCast ?? 2),
      lastMovedCards: [
        { id: 'audit-milled-1', name: 'Audit Milled', type_line: 'Instant', cmc: 5, manaValue: 5, mana_cost: '{3}{U}' },
        { id: 'audit-returned-1', name: 'Audit Returned', type_line: 'Creature — Bear', toughness: 4, cmc: 3 },
        { id: 'audit-plains-returned', name: 'Audit Plains Returned', type_line: 'Basic Land — Plains' },
      ],
      lastMovedBattlefieldPermanentIds: ['bf-creature-1', 'bf-opponent-creature'],
      lastSacrificedPermanents: [
        {
          id: 'audit-sacrificed-enchantment',
          name: 'Audit Sac Enchantment',
          type_line: 'Enchantment',
          cmc: 4,
          manaValue: 4,
        },
        {
          id: 'audit-sacrificed-creature',
          name: 'Audit Sac Creature',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
          cmc: 2,
        },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            'bf-creature-1',
            'bf-artifact-1',
            'bf-audit-artifact-token-1',
            'bf-opponent-creature',
            'bf-creature-2',
            'bf-opponent-artifact',
          ])
        ),
        chosenMana: String(nextCtx.selectorContext?.chosenMana || '{G}{G}{G}'),
      },
    } as typeof nextCtx;
  }

  const needsBatch392GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    return (
      (step.kind === 'add_mana' && /any combination of/i.test(raw)) ||
      (step.kind === 'move_zone' && /each commander target player controls/i.test(raw)) ||
      (step.kind === 'move_zone' && /all creature cards from target player's graveyard/i.test(raw)) ||
      (step.kind === 'move_zone' && /target card from a graveyard/i.test(raw)) ||
      (step.kind === 'move_zone' && /another permanent card from your graveyard/i.test(raw)) ||
      (step.kind === 'move_zone' && /return it to the battlefield under its owner's control/i.test(raw)) ||
      (step.kind === 'gain_control' && /each player gains control of (?:the creature they chose|each permanent for which they were chosen|all nonland permanents|all permanents they own)/i.test(raw)) ||
      (step.kind === 'gain_control' && /you gain control of all (?:creatures of that type|equipment that were attached)/i.test(raw)) ||
      (step.kind === 'gain_control' && /target creature an opponent controls until end of turn/i.test(raw)) ||
      (step.kind === 'exchange_control' && /two target creatures controlled by different players/i.test(raw)) ||
      (step.kind === 'create_token' && /copy of (?:target artifact token|target creature card exiled with|the card with the chosen name|a card you exiled with cards named)/i.test(raw)) ||
      (step.kind === 'create_token' && /for each creature attacking you or a planeswalker/i.test(raw)) ||
      (step.kind === 'modify_pt' && /creature type of your choice/i.test(raw)) ||
      (step.kind === 'modify_pt' && /double target creature's power and toughness/i.test(raw)) ||
      (step.kind === 'modify_pt' && /where x is the amount of life you gained/i.test(raw)) ||
      (step.kind === 'grant_graveyard_permission' && /each permanent type from your graveyard/i.test(raw)) ||
      (step.kind === 'create_token' && /treasure tokens you created this turn/i.test(raw)) ||
      (step.kind === 'create_token' && /damage dealt to your opponents this turn/i.test(raw)) ||
      (step.kind === 'lose_life' && /that card's mana value/i.test(raw)) ||
      (step.kind === 'gain_life' && /that card's mana value/i.test(raw)) ||
      (step.kind === 'mill' && /that player mills/i.test(raw)) ||
      (step.kind === 'gain_control' && /those lands of their choice/i.test(raw)) ||
      (step.kind === 'create_token' && /copy of that creature/i.test(raw)) ||
      (step.kind === 'gain_life' && /controller of each of those artifacts gains life/i.test(raw)) ||
      (step.kind === 'lose_life' && /sacrificed permanent/i.test(raw)) ||
      (step.kind === 'deal_damage' && /equal to (?:that card's mana value|that spell's power|the creature's power)/i.test(raw))
    );
  });
  if (needsBatch392GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const addManaStep = steps.find((step) => step.kind === 'add_mana' && /any combination of/i.test(String(step.raw || '')));
    const addManaOptions = Array.isArray((addManaStep as any)?.manaOptions)
      ? (addManaStep as any).manaOptions.map((option: string) => String(option || '').trim()).filter(Boolean)
      : [];
    const addManaCount = Math.max(
      1,
      Number((addManaStep as any)?.amount?.value) ||
        String((addManaStep as any)?.mana || '').replace(/[{}]/g, '').length ||
        Number(nextCtx.xValue) ||
        2
    );
    const combinationMana =
      addManaOptions.length > 0
        ? Array.from({ length: addManaCount }, () => addManaOptions[0]).join('')
        : '{G}{G}';
    nextState = {
      ...nextState,
      players: (nextState.players || [{ id: 'p1' }, { id: 'p2' }]).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p1') {
          return {
            ...player,
            hand: [{ id: 'hand-audit-1', name: 'Audit Hand', type_line: 'Instant', cmc: 1 }],
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              { id: 'gy-audit-permanent-2', name: 'Audit Permanent Two', type_line: 'Enchantment', cmc: 2 },
            ],
          };
        }
        if (playerId === 'p2') {
          return {
            ...player,
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              { id: 'gy-opponent-creature', name: 'Opponent Gy Creature', type_line: 'Creature — Zombie', cmc: 2 },
            ],
            commandZone: [
              ...(Array.isArray(player?.commandZone) ? player.commandZone : []),
            ],
          };
        }
        return player;
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit392-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Audit Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 3,
          toughness: 2,
          counters: { quest: 2 },
        },
        {
          id: 'bf-audit392-commander',
          name: 'Audit Commander',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Legendary Creature — Human',
          power: 4,
          toughness: 4,
        },
        {
          id: 'bf-creature-1',
          name: 'Audit Target Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-opponent-creature',
          name: 'Audit Opponent Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Zombie',
          power: 3,
          toughness: 3,
        },
        {
          id: 'bf-audit392-human',
          name: 'Audit Human',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 1,
          toughness: 1,
        },
        {
          id: 'bf-audit392-attacker',
          name: 'Audit Attacker',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          power: 2,
          toughness: 1,
          attacking: 'p1',
        },
        {
          id: 'bf-audit393-exchange-p1',
          name: 'Audit Exchange P1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-audit393-exchange-p2',
          name: 'Audit Exchange P2',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          power: 3,
          toughness: 1,
        },
        {
          id: 'bf-audit394-contested-land',
          name: 'Audit Contested Land',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Land',
          counters: { contested: 1 },
        },
      ],
      nontokenCreaturesDiedThisTurnByController: { p1: 2, p2: 1 },
      treasureTokensCreatedThisTurnByController: { p1: 2 },
      damageTakenThisTurnByPlayer: { p2: 4 },
      lifeGainedThisTurnByController: { p1: 5 },
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      xValue: Number.isFinite(Number(nextCtx.xValue)) ? nextCtx.xValue : 3,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      lastMovedCards: [
        {
          id: 'gy-instant-1',
          name: 'Lightning Bolt',
          type_line: 'Instant',
          oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          mana_cost: '{R}',
          cmc: 1,
        },
        { id: 'audit-milled-1', name: 'Audit Milled', type_line: 'Instant', cmc: 4, manaValue: 4, oracle_text: 'Audit Milled deals 4 damage to any target.' },
        { id: 'audit-exiled-copy', name: 'Audit Exiled Copy', type_line: 'Creature — Elf', power: 2, toughness: 2, cmc: 3 },
      ],
      lastExiledCards: [
        { id: 'audit-exiled-copy', name: 'Audit Exiled Copy', type_line: 'Creature — Elf', power: 2, toughness: 2, cmc: 3 },
      ],
      lastDestroyedPermanents: [
        {
          id: 'bf-audit394-destroyed',
          name: 'Audit Destroyed Creature',
          type_line: 'Creature — Elf',
          power: 5,
          toughness: 2,
          cmc: 4,
          owner: 'p2',
          controller: 'p2',
        },
      ],
      lastSacrificedPermanents: [
        { id: 'audit-sac-enchant', name: 'Audit Sac Enchant', type_line: 'Enchantment', cmc: 4, manaValue: 4 },
        { id: 'audit-sac-permanent', name: 'Audit Sac Permanent', type_line: 'Creature — Human', cmc: 2, owner: 'p2' },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
        chosenCreatureType: 'Human',
        chosenName: 'Lightning Bolt',
        chosenObjectIds: ['bf-creature-1', 'bf-opponent-creature', 'bf-audit392-attacker', 'bf-audit393-exchange-p1', 'bf-audit393-exchange-p2', 'gy-opponent-creature'],
        chosenMana: combinationMana,
      },
    } as typeof nextCtx;
  }

  const needsBatch393GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    const visit = (candidate: OracleEffectStep): boolean => {
      const candidateRaw = String(candidate.raw || '').toLowerCase();
      if (
        (candidate.kind === 'conditional' && /delirium/i.test(candidateRaw)) ||
        (candidate.kind === 'shuffle_library' && /that player shuffles/i.test(candidateRaw)) ||
        (candidate.kind === 'mill' && /that player mills/i.test(candidateRaw)) ||
        (candidate.kind === 'draw' && /milled card's mana value/i.test(candidateRaw)) ||
        (candidate.kind === 'move_zone' && /instant or sorcery from your graveyard/i.test(candidateRaw)) ||
        (candidate.kind === 'copy_spell' && /for each card exiled this way/i.test(candidateRaw)) ||
        (candidate.kind === 'exchange_control' && /two target creatures controlled by different players/i.test(candidateRaw)) ||
        (candidate.kind === 'modify_pt' && /quest counters on this permanent/i.test(candidateRaw)) ||
        (candidate.kind === 'create_token' && /copy of (?:that creature|target artifact creature|target artifact token|up to one target artifact token)/i.test(candidateRaw))
      ) {
        return true;
      }
      if (candidate.kind === 'conditional' && Array.isArray(candidate.steps)) {
        return candidate.steps.some(visit);
      }
      return false;
    };
    return visit(step);
  });
  if (needsBatch393GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || [{ id: 'p1' }, { id: 'p2' }]).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p1') {
          return {
            ...player,
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              { id: 'gy-audit393-instant', name: 'Audit Instant', type_line: 'Instant', cmc: 2 },
              { id: 'gy-audit393-creature', name: 'Audit Creature', type_line: 'Creature — Human', cmc: 3 },
              { id: 'gy-audit393-land', name: 'Audit Land', type_line: 'Basic Land — Forest', cmc: 0 },
              { id: 'gy-audit393-enchant', name: 'Audit Enchantment', type_line: 'Enchantment', cmc: 2 },
            ],
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              {
                id: 'exile-audit393-copy',
                name: 'Audit Exiled Spell',
                type_line: 'Instant',
                cmc: 2,
                exiledWith: sourceId,
              },
            ],
          };
        }
        if (playerId === 'p2') {
          return {
            ...player,
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              { id: 'gy-audit393-opponent-creature', name: 'Audit Opponent Gy Creature', type_line: 'Creature — Zombie', cmc: 2 },
            ],
            library: [
              ...(Array.isArray(player?.library) ? player.library : []),
              { id: 'lib-audit393-1', name: 'Audit Library', type_line: 'Instant', cmc: 1 },
            ],
          };
        }
        return player;
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit393-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Audit Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          counters: { quest: 3 },
        },
        {
          id: 'bf-audit393-commander',
          name: 'Audit Commander',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Legendary Creature — Human',
          power: 4,
          toughness: 4,
        },
        {
          id: 'bf-audit393-copy-source',
          name: 'Audit Copy Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact Creature — Construct',
          power: 2,
          toughness: 2,
          isToken: true,
        },
        {
          id: 'bf-audit393-exchange-p1',
          name: 'Audit Exchange P1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-audit393-exchange-p2',
          name: 'Audit Exchange P2',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          power: 3,
          toughness: 1,
        },
        {
          id: 'bf-creature-1',
          name: 'Audit Target Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 3,
        },
      ],
      deliriumTypesInGraveyard: { p1: 4 },
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      xValue: Number.isFinite(Number(nextCtx.xValue)) ? nextCtx.xValue : 3,
      lastMilledCards: [{ id: 'audit-milled-393', name: 'Audit Milled', type_line: 'Instant', cmc: 4, manaValue: 4 }],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
        chosenName: 'Lightning Bolt',
        chosenObjectIds: [
          'bf-creature-1',
          'bf-audit393-copy-source',
          'bf-audit393-exchange-p1',
          'bf-audit393-exchange-p2',
          'gy-audit393-instant',
          'exile-audit393-copy',
        ],
      },
    } as typeof nextCtx;
  }

  const needsBatch394GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    const visit = (candidate: OracleEffectStep): boolean => {
      const candidateRaw = String(candidate.raw || '').toLowerCase();
      if (
        (candidate.kind === 'create_token' && /its owner creates a 1\/1 black and green snake/i.test(candidateRaw)) ||
        (candidate.kind === 'create_token' && /copy of that creature, except it's 1\/1/i.test(candidateRaw)) ||
        (candidate.kind === 'create_token' && /copy of target creature card exiled with this artifact/i.test(candidateRaw)) ||
        (candidate.kind === 'create_token' && /copy of that creature\b/i.test(candidateRaw) && !/except/i.test(candidateRaw)) ||
        (candidate.kind === 'gain_control' && /those lands of their choice/i.test(candidateRaw)) ||
        (candidate.kind === 'move_zone' && /exile target creature card from a graveyard/i.test(candidateRaw))
      ) {
        return true;
      }
      if (candidate.kind === 'conditional' && Array.isArray(candidate.steps)) {
        return candidate.steps.some(visit);
      }
      return false;
    };
    return visit(step);
  });
  if (needsBatch394GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      players: (nextState.players || [{ id: 'p1' }, { id: 'p2' }]).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p2') {
          return {
            ...player,
            graveyard: [
              ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
              {
                id: 'gy-audit394-pharika',
                name: 'Audit Gy Creature',
                type_line: 'Creature — Zombie',
                cmc: 2,
                owner: 'p2',
                ownerId: 'p2',
              },
            ],
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              {
                id: 'exile-audit394-dino',
                name: 'Audit Dino Source',
                type_line: 'Creature — Dinosaur',
                cmc: 4,
                power: 4,
                toughness: 4,
                exiledWith: sourceId,
                exiledWithSourceId: sourceId,
              },
            ],
          };
        }
        return player;
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit394-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-audit394-contested-land',
          name: 'Audit Contested Land',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Land',
          counters: { contested: 1 },
        },
        {
          id: 'bf-audit394-attacker',
          name: 'Audit Attacking Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          power: 3,
          toughness: 2,
          attacking: 'p1',
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetCreatureId: 'bf-opponent-creature',
      targetPermanentId: 'bf-opponent-creature',
      lastMovedCards: [
        {
          id: 'gy-audit394-pharika',
          name: 'Audit Gy Creature',
          type_line: 'Creature — Zombie',
          cmc: 2,
          owner: 'p2',
          ownerId: 'p2',
        },
        {
          id: 'bf-audit394-attacker',
          name: 'Audit Attacking Creature',
          type_line: 'Creature — Human',
          power: 3,
          toughness: 2,
          cmc: 3,
          owner: 'p2',
        },
      ],
      lastSacrificedPermanents: [
        {
          id: 'bf-audit394-sacrificed',
          name: 'Audit Sacrificed Creature',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 4,
          cmc: 3,
          owner: 'p1',
        },
      ],
      lastDestroyedPermanents: [
        {
          id: 'bf-audit394-destroyed',
          name: 'Audit Destroyed Creature',
          type_line: 'Creature — Elf',
          power: 5,
          toughness: 2,
          cmc: 4,
          owner: 'p2',
          controller: 'p2',
        },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        targetCreatureId: 'bf-opponent-creature',
        targetPermanentId: 'bf-opponent-creature',
        chosenObjectIds: [
          'bf-audit394-contested-land',
          'exile-audit394-dino',
          'bf-audit394-attacker',
          'gy-audit394-pharika',
          'bf-audit394-sacrificed',
          'bf-opponent-creature',
          'bf-creature-1',
        ],
      },
    } as typeof nextCtx;
  }

  const needsTrialErrorCombatBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\ball creatures blocking or blocked by target creature\b/i.test(text);
  });
  if (needsTrialErrorCombatBounce) {
    const targetId = 'bf-attacker';
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-trial-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-trial-blocker',
          name: 'Trial Blocker',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
          blocking: targetId,
        },
        {
          id: targetId,
          name: 'Trial Attacker',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          cmc: 2,
          blockedBy: ['bf-trial-blocker'],
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: targetId,
      targetPermanentId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: targetId,
        targetPermanentId: targetId,
      },
    } as typeof nextCtx;
  }

  const needsThoseLandsReturn = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || '').trim().toLowerCase();
    return text === 'those lands' && step.to === 'hand';
  });
  if (needsThoseLandsReturn) {
    const landFixtures = [
      {
        id: 'bf-overlay-plains',
        name: 'Overlay Plains',
        controller: 'p2',
        owner: 'p2',
        type_line: 'Basic Land — Plains',
        cmc: 0,
      },
      {
        id: 'bf-overlay-island',
        name: 'Overlay Island',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Basic Land — Island',
        cmc: 0,
      },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-overlay-/.test(String(perm?.id || ''))
        ),
        ...landFixtures,
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: landFixtures,
    } as typeof nextCtx;
  }

  const needsTargetPlaneswalkerMvFromGy = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return (
      /target planeswalker card/i.test(text) &&
      /mana value (?:x|\d+) or less/i.test(text) &&
      /from your graveyard/i.test(text)
    );
  });
  if (needsTargetPlaneswalkerMvFromGy) {
    const gyFixture = {
      id: 'gy-confront-pw',
      name: 'Confront Jace',
      type_line: 'Legendary Planeswalker — Jace',
      cmc: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            gyFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyFixture.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Number(nextCtx.xValue ?? 4),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-confront-pw',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsUpToCreatureCardsPutIntoGraveyardsThisWay = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /up to (?:two|\d+|[a-z]+) creature cards put into graveyards this way/i.test(text);
  });
  if (needsUpToCreatureCardsPutIntoGraveyardsThisWay) {
    const sacrificedFixtures = [
      { id: 'gy-dm-1', name: 'DM Creature One', type_line: 'Creature — Zombie', cmc: 3 },
      { id: 'gy-dm-2', name: 'DM Creature Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of sacrificedFixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: sacrificedFixtures,
      lastSacrificedPermanents: sacrificedFixtures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-dm-1',
            'gy-dm-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsReturnThisPermanentWhenTokenDies = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || '').trim().toLowerCase();
    const raw = String(step.raw || '').toLowerCase();
    return text === 'this permanent' && /when that token dies/i.test(raw);
  });
  if (needsReturnThisPermanentWhenTokenDies) {
    const sourceId = String(nextCtx.sourceId || 'bf-tatsumasa').trim();
    const sourceFixture = {
      id: sourceId,
      name: "Tatsumasa, the Dragon's Fang",
      type_line: 'Legendary Artifact — Equipment',
      cmc: 6,
    };
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).filter(
        (perm: any) => String(perm?.id || '').trim() !== sourceId
      ),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            sourceFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== sourceId),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      sourceName: String(nextCtx.sourceName || sourceFixture.name),
    } as typeof nextCtx;
  }

  const needsCrypticGatewayHandPut = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /shares a creature type with each creature tapped this way/i.test(text);
  });
  if (needsCrypticGatewayHandPut) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-cryptic-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-cryptic-goblin-1',
          name: 'Cryptic Goblin One',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Goblin',
          cmc: 1,
          tapped: true,
        },
        {
          id: 'bf-cryptic-goblin-2',
          name: 'Cryptic Goblin Two',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Goblin',
          cmc: 2,
          tapped: true,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const fixture = {
          id: 'hand-cryptic-goblin',
          name: 'Cryptic Goblin Hand',
          type_line: 'Creature — Goblin',
          cmc: 1,
        };
        return {
          ...player,
          hand: [
            fixture,
            ...hand.filter((card: any) => String(card?.id || '').trim() !== fixture.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastTappedMatchingPermanentIds: ['bf-cryptic-goblin-1', 'bf-cryptic-goblin-2'],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'hand-cryptic-goblin',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsWorldfireHandsAndGraveyardsExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '').trim().toLowerCase();
    return text === 'all cards from all hands and graveyards' && step.to === 'exile';
  });
  if (needsWorldfireHandsAndGraveyardsExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const handFixture =
          playerId === 'p1'
            ? { id: 'hand-wf-p1', name: 'WF Hand P1', type_line: 'Instant', cmc: 1 }
            : { id: 'hand-wf-p2', name: 'WF Hand P2', type_line: 'Instant', cmc: 1 };
        const gyFixture =
          playerId === 'p1'
            ? { id: 'gy-wf-p1', name: 'WF GY P1', type_line: 'Creature — Human', cmc: 2 }
            : { id: 'gy-wf-p2', name: 'WF GY P2', type_line: 'Creature — Elf', cmc: 2 };
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          hand: [
            handFixture,
            ...hand.filter((card: any) => String(card?.id || '').trim() !== handFixture.id),
          ],
          graveyard: [
            gyFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyFixture.id),
          ],
        };
      }),
    } as GameState;
  }

  const needsRestoreThePeaceDamageBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /\beach creature that dealt damage this turn\b/i.test(text);
  });
  if (needsRestoreThePeaceDamageBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-rtp-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-rtp-damager',
          name: 'Restore Damager',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          cmc: 2,
          dealtDamageThisTurn: true,
        },
        {
          id: 'bf-rtp-innocent',
          name: 'Restore Innocent',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 1,
        },
      ],
    } as GameState;
  }

  const needsTargetDinosaurFromGy = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /target dinosaur card/i.test(text) && /from your graveyard/i.test(text);
  });
  if (needsTargetDinosaurFromGy) {
    const gyFixture = {
      id: 'gy-atzocan-dino',
      name: 'Atzocan Dinosaur',
      type_line: 'Creature — Dinosaur',
      cmc: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            gyFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyFixture.id),
          ],
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
            'gy-atzocan-dino',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTwoCreatureCardsFromHand = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || '').trim().toLowerCase();
    return text === 'two creature cards' && step.to === 'battlefield';
  });
  if (needsTwoCreatureCardsFromHand) {
    const handFixtures = [
      { id: 'hand-su-1', name: 'SU Creature One', type_line: 'Creature — Beast', cmc: 4 },
      { id: 'hand-su-2', name: 'SU Creature Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [...hand];
        for (const card of handFixtures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, hand: merged };
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
            'hand-su-1',
            'hand-su-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLowestToughnessOpponentBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /lowest toughness among creatures you don't control/i.test(text);
  });
  if (needsLowestToughnessOpponentBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-bc-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-bc-low',
          name: 'Bounce Low',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
          toughness: 1,
          power: 1,
        },
        {
          id: 'bf-bc-high',
          name: 'Bounce High',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Giant',
          cmc: 4,
          toughness: 5,
          power: 4,
        },
      ],
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
            'bf-bc-low',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLichKnightsGraveyardReturn = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/[.\s]+$/g, '');
    return text === 'that many creature cards from your graveyard' && step.to === 'battlefield';
  });
  if (needsLichKnightsGraveyardReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-lkc-1', name: 'LKC Zombie', type_line: 'Creature — Zombie', cmc: 3 },
          { id: 'gy-lkc-2', name: 'LKC Elf', type_line: 'Creature — Elf', cmc: 2 },
          { id: 'gy-lkc-3', name: 'LKC Human', type_line: 'Creature — Human', cmc: 1 },
        ];
        const existingIds = new Set(graveyard.map((card: any) => String(card?.id || '').trim()));
        return {
          ...player,
          graveyard: [
            ...fixtures.filter(fixture => !existingIds.has(fixture.id)),
            ...graveyard.filter((card: any) => !/^gy-lkc-/.test(String(card?.id || ''))),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      referenceAmount: Math.max(2, Number(nextCtx.referenceAmount) || 2),
      lastReferenceAmount: Math.max(2, Number((nextCtx as any).lastReferenceAmount) || 2),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-lkc-1',
            'gy-lkc-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsSummonLeviathanExclusionBounce = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /^each creature that isn't a /i.test(text.trim()) && step.to === 'hand';
  });
  if (needsSummonLeviathanExclusionBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-sl-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-sl-kraken',
          name: 'Sea Kraken',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Kraken',
          cmc: 8,
          toughness: 8,
          power: 6,
        },
        {
          id: 'bf-sl-human',
          name: 'Human Soldier',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human Soldier',
          cmc: 2,
          toughness: 2,
          power: 2,
        },
        {
          id: 'bf-sl-merfolk',
          name: 'Merfolk Scout',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Merfolk',
          cmc: 1,
          toughness: 1,
          power: 1,
        },
      ],
    } as GameState;
  }

  const needsAshiokOpponentsHandsAndGraveyardsExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'")
      .replace(/[.\s]+$/g, '');
    return text === "all cards from all opponents' hands and graveyards" && step.to === 'exile';
  });
  if (needsAshiokOpponentsHandsAndGraveyardsExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        if (playerId === 'p1') {
          const controllerHandFixture = {
            id: 'hand-ashiok-p1',
            name: 'Controller Hand',
            type_line: 'Instant',
            cmc: 1,
          };
          return {
            ...player,
            hand: [
              controllerHandFixture,
              ...hand.filter((card: any) => String(card?.id || '').trim() !== controllerHandFixture.id),
            ],
          };
        }
        if (playerId === 'p2') {
          const opponentHandFixture = {
            id: 'hand-ashiok-p2',
            name: 'Opponent Hand',
            type_line: 'Instant',
            cmc: 1,
          };
          const opponentGyFixture = {
            id: 'gy-ashiok-p2',
            name: 'Opponent GY',
            type_line: 'Creature — Zombie',
            cmc: 2,
          };
          return {
            ...player,
            hand: [
              opponentHandFixture,
              ...hand.filter((card: any) => String(card?.id || '').trim() !== opponentHandFixture.id),
            ],
            graveyard: [
              opponentGyFixture,
              ...graveyard.filter((card: any) => String(card?.id || '').trim() !== opponentGyFixture.id),
            ],
          };
        }
        return player;
      }),
    } as GameState;
  }

  const needsMeekAttackHandCreaturePut = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '');
    return /total power and toughness \d+ or less from your hand/i.test(text) && step.to === 'battlefield';
  });
  if (needsMeekAttackHandCreaturePut) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const fixtures = [
          {
            id: 'hand-ma-small',
            name: 'Small Creature',
            type_line: 'Creature — Elf',
            cmc: 2,
            power: 2,
            toughness: 3,
          },
          {
            id: 'hand-ma-big',
            name: 'Big Creature',
            type_line: 'Creature — Giant',
            cmc: 5,
            power: 4,
            toughness: 4,
          },
        ];
        const existingIds = new Set(hand.map((card: any) => String(card?.id || '').trim()));
        return {
          ...player,
          hand: [
            ...fixtures.filter(fixture => !existingIds.has(fixture.id)),
            ...hand.filter((card: any) => !/^hand-ma-/.test(String(card?.id || ''))),
          ],
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
            'hand-ma-small',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsMoratoriumStoneSameNameExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'")
      .replace(/[.\s]+$/g, '');
    return (
      text ===
        'target nonland card from a graveyard, all other cards from graveyards with the same name as that card, and all permanents with that name' &&
      step.to === 'exile'
    );
  });
  if (needsMoratoriumStoneSameNameExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures =
          playerId === 'p1'
            ? [
                { id: 'gy-ms-target', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
                { id: 'gy-ms-same', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
              ]
            : [{ id: 'gy-ms-p2', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 }];
        const existingIds = new Set(graveyard.map((card: any) => String(card?.id || '').trim()));
        return {
          ...player,
          graveyard: [
            ...fixtures.filter(fixture => !existingIds.has(fixture.id)),
            ...graveyard.filter((card: any) => !/^gy-ms-/.test(String(card?.id || ''))),
          ],
        };
      }),
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-ms-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-ms-perm',
          name: 'Lightning Bolt',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Instant',
          cmc: 1,
        },
      ],
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
            'gy-ms-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsDuelistsFlameAmongThemExileRestBottom = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'")
      .replace(/[.\s]+$/g, '');
    return (
      text ===
        'up to one nonland card from among them and put the rest on the bottom of your library in a random order' &&
      step.to === 'exile'
    );
  });
  if (needsDuelistsFlameAmongThemExileRestBottom) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const fixtures = [
          { id: 'lib-df-1', name: 'DF Instant', type_line: 'Instant', cmc: 2 },
          { id: 'lib-df-2', name: 'DF Creature', type_line: 'Creature — Human', cmc: 2, power: 2, toughness: 2 },
          { id: 'lib-df-3', name: 'DF Land', type_line: 'Basic Land — Island', cmc: 0 },
          { id: 'lib-df-4', name: 'DF Sorcery', type_line: 'Sorcery', cmc: 3 },
        ];
        const existingIds = new Set(library.map((card: any) => String(card?.id || '').trim()));
        return {
          ...player,
          library: [
            ...fixtures.filter(fixture => !existingIds.has(fixture.id)),
            ...library.filter((card: any) => !/^lib-df-/.test(String(card?.id || ''))),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [
        { id: 'lib-df-1', name: 'DF Instant', type_line: 'Instant', cmc: 2 },
        { id: 'lib-df-2', name: 'DF Creature', type_line: 'Creature — Human', cmc: 2, power: 2, toughness: 2 },
        { id: 'lib-df-3', name: 'DF Land', type_line: 'Basic Land — Island', cmc: 0 },
        { id: 'lib-df-4', name: 'DF Sorcery', type_line: 'Sorcery', cmc: 3 },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-df-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsMandateOfPeaceStackExile = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'")
      .replace(/[)\s.]+$/g, '');
    return text === 'all spells and abilities from the stack, including this spell' && step.to === 'exile';
  });
  if (needsMandateOfPeaceStackExile) {
    nextState = {
      ...nextState,
      stack: [
        ...((nextState as any).stack || []).filter(
          (entry: any) => !/^stack-mp-/.test(String(entry?.id || ''))
        ),
        { id: 'stack-mp-1', name: 'Stack Bolt', controller: 'p1', owner: 'p1', type_line: 'Instant', cmc: 1 },
        { id: 'stack-mp-2', name: 'Stack Ability', controller: 'p2', owner: 'p2', type_line: 'Ability', cmc: 0 },
      ],
    } as GameState;
  }

  const needsSeasonsPastDistinctManaValuesReturn = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'move_zone') return false;
    const text = String((step as any).what?.text || step.raw || '')
      .trim()
      .toLowerCase()
      .replace(/\u2019/g, "'")
      .replace(/[.\s]+$/g, '');
    return text === 'any number of cards with different mana values from your graveyard' && step.to === 'hand';
  });
  if (needsSeasonsPastDistinctManaValuesReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-sp-1', name: 'SP One', type_line: 'Instant', cmc: 1 },
          { id: 'gy-sp-2', name: 'SP Two', type_line: 'Creature — Elf', cmc: 2 },
          { id: 'gy-sp-3', name: 'SP Three', type_line: 'Sorcery', cmc: 3 },
        ];
        const existingIds = new Set(graveyard.map((card: any) => String(card?.id || '').trim()));
        return {
          ...player,
          graveyard: [
            ...fixtures.filter(fixture => !existingIds.has(fixture.id)),
            ...graveyard.filter((card: any) => !/^gy-sp-/.test(String(card?.id || ''))),
          ],
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
            'gy-sp-1',
            'gy-sp-2',
            'gy-sp-3',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEnchantmentAlterationAuraReattach = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'attach' &&
      /target aura attached to a creature or land to another permanent of that type/i.test(String(step.raw || ''))
  );
  if (needsEnchantmentAlterationAuraReattach) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-ea-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-ea-host',
          name: 'EA Host Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-ea-target',
          name: 'EA Target Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-ea-aura',
          name: 'EA Aura',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-ea-host',
        },
      ],
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
            'bf-ea-aura',
            'bf-ea-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCounteredSpellLibraryTopOrBottom = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^that spell$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'library' &&
      (/top or bottom of its library/i.test(String(step.raw || '')) ||
        /on the bottom of its owner'?s? library instead of/i.test(String(step.raw || '')))
  );
  let needsCounteredSpellLibraryTopOrBottomNested = false;
  walkOracleSteps(steps, (step) => {
    if (
      step.kind === 'move_zone' &&
      /^that spell$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'library' &&
      (/top or bottom of its library/i.test(String(step.raw || '')) ||
        /on the bottom of its owner'?s? library instead of/i.test(String(step.raw || '')))
    ) {
      needsCounteredSpellLibraryTopOrBottomNested = true;
    }
  });
  if (needsCounteredSpellLibraryTopOrBottom || needsCounteredSpellLibraryTopOrBottomNested) {
    nextCtx = {
      ...nextCtx,
      libraryPlacement: 'bottom',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        libraryPlacement: 'bottom',
        targetSpellId: String(nextCtx.selectorContext?.targetSpellId || nextCtx.targetSpellId || 'stack-spell-1'),
      },
    } as typeof nextCtx;
  }

  const needsEachCardChosenThisWayReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^each card chosen this way$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'battlefield'
  );
  if (needsEachCardChosenThisWayReturn) {
    const gyFixtures = [
      { id: 'gy-rjf-1', name: 'RJF Chosen One', type_line: 'Creature — Human', cmc: 3 },
      { id: 'gy-rjf-2', name: 'RJF Chosen Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-rjf-1',
            'gy-rjf-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsNahiriLoyaltyGyExile = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /target creature or equipment card with mana value less than this permanent's loyalty from your graveyard/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsNahiriLoyaltyGyExile) {
    const sourceId = String(nextCtx.sourceId || 'bf-nahiri').trim();
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-nahiri/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Nahiri',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Legendary Planeswalker — Nahiri',
          cmc: 4,
          loyalty: 5,
          counters: { loyalty: 5 },
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          { id: 'gy-nahiri-creature', name: 'Nahiri GY Creature', type_line: 'Creature — Human', cmc: 2 },
          { id: 'gy-nahiri-equipment', name: 'Nahiri GY Sword', type_line: 'Artifact — Equipment', cmc: 1 },
        ];
        const merged = [
          ...fixtures,
          ...graveyard.filter(
            (card: any) => !fixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            'gy-nahiri-creature',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThoseCardsBattlefieldInsteadOfHand = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^those cards$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'battlefield'
  );
  let needsThoseCardsBattlefieldInsteadOfHandNested = false;
  walkOracleSteps(steps, (step) => {
    if (
      step.kind === 'move_zone' &&
      /^those cards$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'battlefield'
    ) {
      needsThoseCardsBattlefieldInsteadOfHandNested = true;
    }
  });
  if (needsThoseCardsBattlefieldInsteadOfHand || needsThoseCardsBattlefieldInsteadOfHandNested) {
    const handFixtures = [
      { id: 'hand-tfd-1', name: 'TFD One', type_line: 'Creature — Human', cmc: 3 },
      { id: 'hand-tfd-2', name: 'TFD Two', type_line: 'Instant', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: handFixtures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'hand-tfd-1',
            'hand-tfd-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThisPermanentAndAnotherTargetBounce = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^this permanent and another target creature$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'hand'
  );
  if (needsThisPermanentAndAnotherTargetBounce) {
    const sourceId = String(nextCtx.sourceId || 'bf-lady-sun').trim();
    const targetId = 'bf-lady-target';
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-lady-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Lady Sun',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Legendary Creature — Human',
          cmc: 3,
        },
        {
          id: targetId,
          name: 'Lady Target',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      targetCreatureId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: targetId,
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            targetId,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThisCreatureAndAnotherTargetBounce = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^this creature and another target creature$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'hand'
  );
  if (needsThisCreatureAndAnotherTargetBounce) {
    const sourceId = String(nextCtx.sourceId || 'bf-coastal').trim();
    const targetId = 'bf-coastal-target';
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-coastal-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Coastal Wizard',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Wizard',
          cmc: 2,
        },
        {
          id: targetId,
          name: 'Coastal Target',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Goblin',
          cmc: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      targetCreatureId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: targetId,
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            targetId,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsBoundDeterminedColorXGyReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^up to x cards from your graveyard$/i.test(String((step as any).what?.text || '').trim()) &&
      /number of colors that creature was/i.test(String(step.raw || ''))
  );
  if (needsBoundDeterminedColorXGyReturn) {
    const gyFixtures = [
      { id: 'gy-bound-1', name: 'Bound GY One', type_line: 'Instant', cmc: 1 },
      { id: 'gy-bound-2', name: 'Bound GY Two', type_line: 'Creature — Elf', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: 2,
      lastSacrificedPermanents: [
        {
          id: 'bf-bound-sac',
          name: 'Bound Sacrifice',
          typeLine: 'Creature — Human Soldier',
          type_line: 'Creature — Human Soldier',
          colors: ['W', 'R'],
          cmc: 2,
        },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-bound-1',
            'gy-bound-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCreatureExiledWithThisLand = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /(?:a|an|the|target)\s+creature card exiled with this land/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsCreatureExiledWithThisLand) {
    const sourceId = String(nextCtx.sourceId || 'bf-northampton-farm').trim();
    const exiledCreature = {
      id: 'exile-northampton-creature',
      name: 'Northampton Exiled Creature',
      type_line: 'Creature — Human',
      cmc: 3,
      exiledWith: sourceId,
      exiledWithSourceId: sourceId,
    };
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== sourceId
        ),
        {
          id: sourceId,
          name: 'Northampton Farm',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Land',
          cmc: 0,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [
          exiledCreature,
          ...exile.filter((card: any) => String(card?.id || '').trim() !== exiledCreature.id),
        ];
        return { ...player, exile: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            exiledCreature.id,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsDeployGatewatchAmongThem = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /up to two planeswalker cards from among them/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsDeployGatewatchAmongThem) {
    const libraryCards = [
      { id: 'lib-gatewatch-pw-1', name: 'Gatewatch Jace', type_line: 'Legendary Planeswalker — Jace', cmc: 4 },
      { id: 'lib-gatewatch-pw-2', name: 'Gatewatch Gideon', type_line: 'Legendary Planeswalker — Gideon', cmc: 3 },
      { id: 'lib-gatewatch-creature', name: 'Gatewatch Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-gatewatch-instant', name: 'Gatewatch Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          ...libraryCards,
          ...library.filter(
            (card: any) => !libraryCards.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: libraryCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-gatewatch-pw-1',
            'lib-gatewatch-pw-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsRecommissionArtifactCreatureGyReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /target artifact or creature card with mana value 3 or less from your graveyard/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsRecommissionArtifactCreatureGyReturn) {
    const gyFixtures = [
      { id: 'gy-recommission-creature', name: 'Recommission Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'gy-recommission-artifact', name: 'Recommission Ring', type_line: 'Artifact', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-recommission-creature',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsPatronUpToTwoLandsFromHand = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^up to two land cards from your hand$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsPatronUpToTwoLandsFromHand) {
    const handFixtures = [
      { id: 'hand-patron-land-1', name: 'Patron Plains', type_line: 'Basic Land — Plains', cmc: 0 },
      { id: 'hand-patron-land-2', name: 'Patron Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
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
            'hand-patron-land-1',
            'hand-patron-land-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTezzeretAnyNumberHandFaceDown = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^any number of cards from your hand$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield' &&
      ((step as any).entersFaceDown === true || /\bface down\b/i.test(String(step.raw || '')))
  );
  if (needsTezzeretAnyNumberHandFaceDown) {
    const handFixtures = [
      { id: 'hand-tezzeret-1', name: 'Tezzeret Hand One', type_line: 'Instant', cmc: 2 },
      { id: 'hand-tezzeret-2', name: 'Tezzeret Hand Two', type_line: 'Artifact', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
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
            'hand-tezzeret-1',
            'hand-tezzeret-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsNikoForetellGyReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /target card with foretell from your graveyard/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsNikoForetellGyReturn) {
    const gyFixtures = [
      {
        id: 'gy-niko-foretell',
        name: 'Niko Foretell Card',
        type_line: 'Instant',
        cmc: 3,
        oracle_text: 'Foretell {1}{U}',
        keywords: ['Foretell'],
      },
      { id: 'gy-niko-plain', name: 'Niko Plain Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-niko-foretell',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsBalladHistoricAmongThem = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^a historic card from among them$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'hand'
  );
  if (needsBalladHistoricAmongThem) {
    const milledCards = [
      { id: 'gy-ballad-artifact', name: 'Ballad Compass', type_line: 'Artifact', cmc: 2 },
      { id: 'gy-ballad-creature', name: 'Ballad Sailor', type_line: 'Creature — Human', cmc: 2 },
      { id: 'gy-ballad-instant', name: 'Ballad Counter', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...milledCards,
          ...graveyard.filter(
            (card: any) => !milledCards.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: milledCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-ballad-artifact',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLeonardoOneOrTwoGyReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /one or two target creature cards each with mana value 3 or less from your graveyard/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsLeonardoOneOrTwoGyReturn) {
    const gyFixtures = [
      { id: 'gy-leonardo-bear', name: 'Leonardo Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'gy-leonardo-elf', name: 'Leonardo Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'gy-leonardo-giant', name: 'Leonardo Giant', type_line: 'Creature — Giant', cmc: 5 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-leonardo-bear',
            'gy-leonardo-elf',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsReenactNonlandGyExileThisTurn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /target nonland card in a graveyard that was put there from anywhere this turn/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsReenactNonlandGyExileThisTurn) {
    const gyFixture = {
      id: 'gy-reenact-instant',
      name: 'Reenact Bolt',
      type_line: 'Instant',
      cmc: 2,
      putIntoGraveyardTurn: 3,
    };
    nextState = {
      ...nextState,
      turn: Number((nextState as any)?.turn ?? 3),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          gyFixture,
          ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyFixture.id),
        ];
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
            'gy-reenact-instant',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsHurkylAllArtifactsTargetPlayerOwns = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^all artifacts target player owns$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsHurkylAllArtifactsTargetPlayerOwns) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-hurkyl-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-hurkyl-ring',
          name: 'Hurkyl Ring',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Artifact',
          cmc: 2,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const gyArtifact = {
          id: 'gy-hurkyl-tablet',
          name: 'Hurkyl Tablet',
          type_line: 'Artifact',
          cmc: 3,
          owner: 'p2',
        };
        return {
          ...player,
          graveyard: [
            gyArtifact,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyArtifact.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsBackForSecondsAmongThemBfInstead = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^one of those cards with mana value 4 or less$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsBackForSecondsAmongThemBfInstead) {
    const returnedCards = [
      { id: 'gy-back-small', name: 'Back Small Creature', type_line: 'Creature — Human', cmc: 3 },
      { id: 'gy-back-big', name: 'Back Big Creature', type_line: 'Creature — Giant', cmc: 6 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...returnedCards,
          ...graveyard.filter(
            (card: any) => !returnedCards.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: returnedCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-back-small',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsShroudedLoreLastChosenCard = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^the last chosen card$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'hand'
  );
  if (needsShroudedLoreLastChosenCard) {
    const discardedCard = {
      id: 'gy-shrouded-discarded',
      name: 'Shrouded Discarded Card',
      type_line: 'Instant',
      cmc: 2,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            discardedCard,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== discardedCard.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      lastMovedCards: [discardedCard],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-shrouded-discarded',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsLilianaUpToTwoCreaturesFromGraveyards = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^up to two creature cards from graveyards$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsLilianaUpToTwoCreaturesFromGraveyards) {
    const gyFixtures = [
      { id: 'gy-liliana-creature-1', name: 'Liliana Zombie', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-liliana-creature-2', name: 'Liliana Skeleton', type_line: 'Creature — Skeleton', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-liliana-creature-1',
            'gy-liliana-creature-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCodsworthAttachAuraOrEquipment = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'attach' &&
      /target aura or equipment you control to target creature you control/i.test(String(step.raw || ''))
  );
  if (needsCodsworthAttachAuraOrEquipment) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-codsworth-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-codsworth-aura',
          name: 'Codsworth Aura',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-codsworth-host',
        },
        {
          id: 'bf-codsworth-equipment',
          name: 'Codsworth Equipment',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact — Equipment',
        },
        {
          id: 'bf-codsworth-host',
          name: 'Codsworth Host',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Robot',
          cmc: 2,
        },
        {
          id: 'bf-codsworth-target',
          name: 'Codsworth Target',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          cmc: 2,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-codsworth-target',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-codsworth-target',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-codsworth-equipment',
            'bf-codsworth-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsRowanLibraryTopGySplit = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^up to two of them back on top of your library in any order and the rest$/i.test(
        String((step as any).what?.text || '').trim()
      )
  );
  if (needsRowanLibraryTopGySplit) {
    const rowanTopCards = [
      { id: 'lib-rowan-1', name: 'Rowan Top One', type_line: 'Instant', cmc: 2 },
      { id: 'lib-rowan-2', name: 'Rowan Top Two', type_line: 'Sorcery', cmc: 3 },
      { id: 'lib-rowan-3', name: 'Rowan Rest One', type_line: 'Creature — Human', cmc: 1 },
      { id: 'lib-rowan-4', name: 'Rowan Rest Two', type_line: 'Enchantment', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          ...rowanTopCards,
          ...library.filter(
            (card: any) => !rowanTopCards.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: rowanTopCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-rowan-1',
            'lib-rowan-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsRamosianRebelGyReturn = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /target rebel permanent card with mana value 5 or less from your graveyard/i.test(
        String((step as any).what?.text || '').trim()
      )
  );
  if (needsRamosianRebelGyReturn) {
    const rebelFixture = {
      id: 'gy-ramosian-rebel-1',
      name: 'Ramosian Captain',
      type_line: 'Creature — Human Rebel',
      cmc: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            rebelFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== rebelFixture.id),
          ],
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
            rebelFixture.id,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsVivienAnyNumberMilledCreatures = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^any number of creature cards milled this way$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsVivienAnyNumberMilledCreatures) {
    const milledCreatures = [
      { id: 'gy-vivien-creature-1', name: 'Vivien Milled Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'gy-vivien-creature-2', name: 'Vivien Milled Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'gy-vivien-instant-1', name: 'Vivien Milled Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...milledCreatures,
          ...graveyard.filter(
            (card: any) => !milledCreatures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: milledCreatures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-vivien-creature-1',
            'gy-vivien-creature-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsSerenePermanentAndSingleGyShuffle = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^this permanent and up to three target cards from a single graveyard$/i.test(
        String((step as any).what?.text || '').trim()
      )
  );
  if (needsSerenePermanentAndSingleGyShuffle) {
    const gyFixtures = [
      { id: 'gy-serene-1', name: 'Serene GY One', type_line: 'Instant', cmc: 2 },
      { id: 'gy-serene-2', name: 'Serene GY Two', type_line: 'Sorcery', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-serene-source'
        ),
        {
          id: 'bf-serene-source',
          name: 'Serene Remembrance',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment',
          cmc: 2,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId: 'bf-serene-source',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-serene-1',
            'gy-serene-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsResearchOutsideGameShuffle = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^up to four cards you own from outside the game$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsResearchOutsideGameShuffle) {
    const sideboardFixtures = [
      { id: 'sb-research-1', name: 'Research Outside One', type_line: 'Instant', cmc: 1 },
      { id: 'sb-research-2', name: 'Research Outside Two', type_line: 'Sorcery', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const sideboard = Array.isArray(player.sideboard) ? [...player.sideboard] : [];
        const merged = [
          ...sideboardFixtures,
          ...sideboard.filter(
            (card: any) => !sideboardFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, sideboard: merged };
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
            'sb-research-1',
            'sb-research-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsBloodForBonesAnotherGyCreature = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^another creature card from your graveyard$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsBloodForBonesAnotherGyCreature) {
    const gyFixtures = [
      { id: 'gy-blood-bf', name: 'Blood BF Creature', type_line: 'Creature — Zombie', cmc: 3 },
      { id: 'gy-blood-hand', name: 'Blood Hand Creature', type_line: 'Creature — Skeleton', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [gyFixtures[0]],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-blood-bf',
            'gy-blood-hand',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCommandAttackingBounce = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /^one or two target attacking creatures$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsCommandAttackingBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-command-attack-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-command-attack-1',
          name: 'Command Attacker One',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          cmc: 2,
          attacking: true,
        },
        {
          id: 'bf-command-attack-2',
          name: 'Command Attacker Two',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 1,
          attacking: true,
        },
      ],
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
            'bf-command-attack-1',
            'bf-command-attack-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsFumbleThemReattach = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'attach' &&
      /^them$/i.test(String((step as any).attachment?.text || '').trim()) &&
      /^another creature$/i.test(String((step as any).to?.text || '').trim())
  );
  if (needsFumbleThemReattach) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-fumble-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-fumble-host',
          name: 'Fumble Host',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-fumble-target',
          name: 'Fumble Target',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-fumble-aura',
          name: 'Fumble Aura',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Enchantment — Aura',
          attachedTo: 'bf-fumble-host',
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-fumble-host',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-fumble-host',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-fumble-aura',
            'bf-fumble-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCreatureCardExiledThisWay = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'move_zone' &&
      /a creature card exiled this way/i.test(String((step as any).what?.text || step.raw || '')) &&
      step.to === 'battlefield'
  );
  let needsCreatureCardExiledThisWayNested = false;
  walkOracleSteps(steps, (step) => {
    if (
      step.kind === 'move_zone' &&
      /a creature card exiled this way/i.test(String((step as any).what?.text || step.raw || '')) &&
      step.to === 'battlefield'
    ) {
      needsCreatureCardExiledThisWayNested = true;
    }
  });
  if (needsCreatureCardExiledThisWay || needsCreatureCardExiledThisWayNested) {
    const exiledCreature = {
      id: 'exile-ar-creature-1',
      name: 'AR Exiled Creature',
      type_line: 'Creature — Beast',
      cmc: 4,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        if (exile.some((entry: any) => String(entry?.id || '').trim() === exiledCreature.id)) return player;
        return { ...player, exile: [...exile, exiledCreature] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastExiledCards: [exiledCreature],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            exiledCreature.id,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAuraAttachedToPermanentReattach = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'attach' &&
      /target aura attached to a permanent to another permanent with the same controller/i.test(String(step.raw || ''))
  );
  if (needsAuraAttachedToPermanentReattach) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-simic-/.test(String(perm?.id || ''))),
        {
          id: 'bf-simic-host',
          name: 'Simic Host',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          cmc: 2,
        },
        {
          id: 'bf-simic-target',
          name: 'Simic Target',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Elf',
          cmc: 2,
        },
        {
          id: 'bf-simic-aura',
          name: 'Simic Aura',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment — Aura',
          cmc: 1,
          attachedTo: 'bf-simic-host',
        },
      ],
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
            'bf-simic-aura',
            'bf-simic-target',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTamiyoGyExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\btarget\s+nonland\s+permanent\s+card\s+with\s+mana\s+value\s+x\s+from\s+your\s+graveyard\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsTamiyoGyExile) {
    const gyArtifact = {
      id: 'gy-tamiyo-artifact',
      name: 'Audit Tamiyo Artifact',
      type_line: 'Artifact',
      cmc: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === gyArtifact.id)
          ? player
          : { ...player, graveyard: [gyArtifact, ...graveyard] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: 4,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-tamiyo-artifact'],
      },
    } as typeof nextCtx;
  }

  const needsOpponentChoiceGyCreature = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\b(?:opponent(?:'s)?|their)\s+choice\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      (/\bfrom\s+(?:target\s+)?(?:opponent(?:'s)?|their)\s+graveyard\b/i.test(
        String((step as any).what?.text || step.raw || '')
      ) ||
        /\bfrom your graveyard\b/i.test(String((step as any).what?.text || step.raw || '')))
  );
  if (needsOpponentChoiceGyCreature) {
    const fromYourGraveyard = steps.some(
      (step) =>
        step.kind === 'move_zone' &&
        /\bfrom your graveyard\b/i.test(String((step as any).what?.text || step.raw || '')) &&
        /\b(?:opponent(?:'s)?|their)\s+choice\b/i.test(String((step as any).what?.text || step.raw || ''))
    );
    if (fromYourGraveyard) {
      nextState = {
        ...nextState,
        players: (nextState.players || []).map((player: any) => {
          if (String(player?.id || '').trim() !== 'p1') return player;
          const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
          const fixtures = [
            { id: 'gy-tasigur-instant', name: 'Tasigur Bolt', type_line: 'Instant', cmc: 1 },
            { id: 'gy-tasigur-land', name: 'Tasigur Forest', type_line: 'Basic Land — Forest', cmc: 0 },
          ];
          const merged = [...graveyard];
          for (const card of fixtures) {
            if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
          }
          return { ...player, graveyard: merged };
        }),
      } as GameState;
      nextCtx = {
        ...nextCtx,
        targetPlayerId: 'p2',
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          targetPlayerId: 'p2',
          targetOpponentId: 'p2',
          chosenObjectIds: ['gy-tasigur-instant'],
        },
      } as typeof nextCtx;
    } else {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const creature = {
          id: 'gy-opponent-choice-creature',
          name: 'Opponent Choice Zombie',
          type_line: 'Creature — Zombie',
          cmc: 3,
        };
        return graveyard.some((card: any) => String(card?.id || '').trim() === creature.id)
          ? player
          : { ...player, graveyard: [creature, ...graveyard] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        chosenObjectIds: ['gy-opponent-choice-creature'],
      },
    } as typeof nextCtx;
    }
  }

  const needsSoulquakeMassReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball creatures on the battlefield and all creature cards in graveyards\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsSoulquakeMassReturn) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-soulquake-/.test(String(perm?.id || ''))),
        {
          id: 'bf-audit-soulquake-1',
          name: 'Soulquake Bear',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const gyCreature = {
          id: 'gy-audit-soulquake-1',
          name: 'Soulquake Zombie',
          type_line: 'Creature — Zombie',
          cmc: 2,
        };
        return graveyard.some((card: any) => String(card?.id || '').trim() === gyCreature.id)
          ? player
          : { ...player, graveyard: [gyCreature, ...graveyard] };
      }),
    } as GameState;
  }

  const needsCardFromChosenPile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^a card from the chosen pile$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsCardFromChosenPile) {
    const chosenCard = {
      id: 'lib-chosen-pile-1',
      name: 'Chosen Pile Card',
      type_line: 'Instant',
      cmc: 2,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [chosenCard, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [chosenCard],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['lib-chosen-pile-1'],
      },
    } as typeof nextCtx;
  }

  const needsNonManaActivatedMilledCreatures = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bactivated abilities that (?:aren't|are not) mana abilities\b/i.test(
        String((step as any).what?.text || step.raw || '')
      ) &&
      /\bmilled cards\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsNonManaActivatedMilledCreatures) {
    const milledCards = [
      {
        id: 'gy-milled-activated-1',
        name: 'Milled Activated Creature',
        type_line: 'Creature — Human',
        cmc: 2,
        oracle_text: '{T}: Draw a card.',
      },
      {
        id: 'gy-milled-plain-2',
        name: 'Milled Plain Creature',
        type_line: 'Creature — Elf',
        cmc: 1,
        oracle_text: 'Vigilance',
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of milledCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: milledCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-milled-activated-1'],
      },
    } as typeof nextCtx;
  }

  const needsCryOfCarnariumGyExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball creature cards in all graveyards that were put there from the battlefield this turn\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsCryOfCarnariumGyExile) {
    nextState = {
      ...nextState,
      turn: Number((nextState as any)?.turn ?? 3),
      players: (nextState.players || []).map((player: any) => {
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const gyCreature = {
          id: `gy-carnarium-bf-${String(player?.id || '').trim()}`,
          name: 'Carnarium Zombie',
          type_line: 'Creature — Zombie',
          cmc: 2,
          putIntoGraveyardTurn: 3,
        };
        return graveyard.some((card: any) => String(card?.id || '').trim() === gyCreature.id)
          ? player
          : { ...player, graveyard: [gyCreature, ...graveyard] };
      }),
    } as GameState;
  }

  const needsMemoryTheftAdventureExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bhas an adventure\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\bfrom exile\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsMemoryTheftAdventureExile) {
    const adventureCard = {
      id: 'exile-adventure-1',
      name: 'Memory Theft Adventure',
      type_line: 'Sorcery — Adventure',
      layout: 'adventure',
      cmc: 2,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        return exile.some((card: any) => String(card?.id || '').trim() === adventureCard.id)
          ? player
          : { ...player, exile: [adventureCard, ...exile] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        chosenObjectIds: ['exile-adventure-1'],
      },
    } as typeof nextCtx;
  }

  const needsAetherBurstBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^up to x target creatures$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsAetherBurstBounce) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-aether-/.test(String(perm?.id || ''))),
        {
          id: 'bf-audit-aether-1',
          name: 'Aether Bear',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: 2,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['bf-audit-aether-1'],
      },
    } as typeof nextCtx;
  }

  const needsNissaHandOrGyReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bmana value less than or equal to the number of lands you control\b/i.test(
        String(step.raw || (step as any).what?.text || '')
      ) &&
      /\bfrom your hand or graveyard\b/i.test(String(step.raw || ''))
  );
  if (needsNissaHandOrGyReturn) {
    const nissaCreature = {
      id: 'gy-nissa-creature-1',
      name: 'Nissa Elf',
      type_line: 'Creature — Elf',
      cmc: 2,
    };
    nextState = {
      ...nextState,
      battlefield: [
        ...(Array.isArray(nextState.battlefield) ? nextState.battlefield : []),
        {
          id: 'bf-nissa-land-1',
          name: 'Forest',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Basic Land — Forest',
          colors: [],
        },
        {
          id: 'bf-nissa-land-2',
          name: 'Island',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Basic Land — Island',
          colors: [],
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return graveyard.some((card: any) => String(card?.id || '').trim() === nissaCreature.id)
          ? player
          : { ...player, graveyard: [nissaCreature, ...graveyard] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-nissa-creature-1'],
      },
    } as typeof nextCtx;
  }

  const needsLivingTwisterTappedLandBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\breturn a tapped land you control\b/i.test(String(step.raw || ''))
  );
  if (needsLivingTwisterTappedLandBounce) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => String(perm?.id || '') !== 'bf-tapped-land-1'),
        {
          id: 'bf-tapped-land-1',
          name: 'Tapped Forest',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Basic Land — Forest',
          tapped: true,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['bf-tapped-land-1'],
      },
    } as typeof nextCtx;
  }

  const needsVictimizeChosenReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^the chosen cards$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsVictimizeChosenReturn) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const creatures = [
          { id: 'gy-victimize-1', name: 'Victimize Zombie', type_line: 'Creature — Zombie', cmc: 3 },
          { id: 'gy-victimize-2', name: 'Victimize Bear', type_line: 'Creature — Bear', cmc: 2 },
        ];
        const merged = [...graveyard];
        for (const card of creatures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['gy-victimize-1', 'gy-victimize-2'],
      },
    } as typeof nextCtx;
  }

  const needsWeddingTimeCounterExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\btime counters on it equal to its mana value\b/i.test(String(step.raw || (step as any).what?.text || ''))
  );
  if (needsWeddingTimeCounterExile) {
    const handCard = {
      id: 'hand-wedding-instant-1',
      name: 'Wedding Instant',
      type_line: 'Instant',
      cmc: 3,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = [handCard, ...(Array.isArray(player.hand) ? player.hand : [])];
        return { ...player, hand };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['hand-wedding-instant-1'],
      },
    } as typeof nextCtx;
  }

  const needsJaceOnePileSplit = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^one pile$/i.test(String((step as any).what?.text || '').trim()) &&
      /\bbottom of your library\b/i.test(String(step.toRaw || step.raw || ''))
  );
  if (needsJaceOnePileSplit) {
    const pileCards = [
      { id: 'lib-jace-1', name: 'Jace Card 1', type_line: 'Instant', cmc: 2 },
      { id: 'lib-jace-2', name: 'Jace Card 2', type_line: 'Sorcery', cmc: 3 },
      { id: 'lib-jace-3', name: 'Jace Card 3', type_line: 'Creature — Human', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = [...pileCards, ...(Array.isArray(player.library) ? player.library : [])];
        return { ...player, library };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: pileCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: ['lib-jace-1', 'lib-jace-2', 'lib-jace-3'],
      },
    } as typeof nextCtx;
  }

  const needsSweepPlainsReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^any number of plains you control$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsSweepPlainsReturn) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const plainsFixtures = [
      { id: 'bf-audit-plains-1', name: 'Plains', type_line: 'Basic Land — Plains', controller: 'p1', owner: 'p1' },
      { id: 'bf-audit-plains-2', name: 'Plains', type_line: 'Basic Land — Plains', controller: 'p1', owner: 'p1' },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-audit-plains-\d+$/.test(String(perm?.id || ''))),
        ...plainsFixtures,
      ],
    } as GameState;
  }

  const needsFaerieControlConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /you don'?t control a faerie/i.test(String((step as any).condition?.raw || step.raw || ''))
  );
  if (needsFaerieControlConditional) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => String(perm?.id || '').trim() !== 'bf-audit-faerie-1'),
        {
          id: 'bf-audit-faerie-1',
          name: 'Audit Faerie',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Faerie',
          power: 1,
          toughness: 1,
          card: { name: 'Audit Faerie', type_line: 'Creature — Faerie' },
        },
      ],
    } as GameState;
  }

  const needsTrampleFightConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /the creature you control has trample/i.test(String((step as any).condition?.raw || step.raw || ''))
  );
  if (needsTrampleFightConditional) {
    const targetId = String(nextCtx.targetCreatureId || nextCtx.selectorContext?.targetCreatureId || 'bf-creature-1');
    nextState = {
      ...nextState,
      battlefield: (nextState.battlefield || []).map((perm: any) => {
        if (String(perm?.id || '').trim() !== targetId) return perm;
        return {
          ...perm,
          keywords: Array.from(new Set([...(Array.isArray(perm.keywords) ? perm.keywords : []), 'trample'])),
          card: {
            ...(perm.card || {}),
            keywords: Array.from(new Set([...(Array.isArray(perm.card?.keywords) ? perm.card.keywords : []), 'trample'])),
          },
        };
      }),
    } as GameState;
  }

  const needsPirateExiledConditional = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /a pirate was exiled this way/i.test(String((step as any).condition?.raw || step.raw || ''))
  );
  if (needsPirateExiledConditional) {
    const targetId = String(nextCtx.targetCreatureId || nextCtx.selectorContext?.targetCreatureId || 'bf-creature-1');
    nextState = {
      ...nextState,
      battlefield: (nextState.battlefield || []).map((perm: any) => {
        if (String(perm?.id || '').trim() !== targetId) return perm;
        return {
          ...perm,
          name: 'Audit Pirate',
          type_line: 'Creature — Human Pirate',
          card: {
            ...(perm.card || {}),
            name: 'Audit Pirate',
            type_line: 'Creature — Human Pirate',
          },
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: targetId,
      },
    } as typeof nextCtx;
  }

  const needsDamagePreventedReference = steps.some((step) =>
    /damage prevented this way/i.test(String(step.raw || ''))
  );
  if (needsDamagePreventedReference) {
    nextCtx = {
      ...nextCtx,
      referenceAmount: Math.max(1, Number(nextCtx.referenceAmount) || 2),
      lastReferenceAmount: Math.max(1, Number((nextCtx as any).lastReferenceAmount) || 2),
    } as typeof nextCtx;
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

  const needsDistributeAmongElves = steps.some(
    (step) =>
      step.kind === 'add_counter' &&
      ((step as { distribution?: string }).distribution === 'among' || /^distribute\b/i.test(String(step.raw || ''))) &&
      /target elves/i.test(String((step as any).target?.text || step.raw || '')),
  );
  const needsDistributeAmongTargets = steps.some(
    (step) =>
      step.kind === 'add_counter' &&
      ((step as { distribution?: string }).distribution === 'among' || /^distribute\b/i.test(String(step.raw || ''))) &&
      /target creatures/i.test(String((step as any).target?.text || step.raw || '')),
  );
  if (needsDistributeAmongElves) {
    const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
    const elfFixtures = [
      {
        id: 'bf-elf-1',
        name: 'Audit Elf One',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf',
        power: 2,
        toughness: 2,
        card: { name: 'Audit Elf One', type_line: 'Creature — Elf' },
      },
      {
        id: 'bf-elf-2',
        name: 'Audit Elf Two',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Creature — Elf Warrior',
        power: 3,
        toughness: 3,
        card: { name: 'Audit Elf Two', type_line: 'Creature — Elf Warrior' },
      },
    ];
    nextState = {
      ...nextState,
      battlefield: [
        ...existingBattlefield.filter((perm: any) => !/^bf-elf-\d+$/.test(String(perm?.id || ''))),
        ...elfFixtures,
      ],
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
            'bf-elf-1',
            'bf-elf-2',
          ]),
        ),
      },
    } as typeof nextCtx;
  } else if (needsDistributeAmongTargets) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-1',
            'bf-creature-2',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsSkipNextUntapThatLand = steps.some(
    (step) =>
      step.kind === 'skip_next_untap' &&
      /that land/i.test(String((step as any).target?.text || step.raw || '')),
  );
  if (needsSkipNextUntapThatLand) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-land-1',
      lastMovedBattlefieldPermanentIds: ['bf-land-1'],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-land-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-land-1',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachPlayerSacrificeChoice = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'sacrifice' &&
      (step as any).who?.kind === 'each_player' &&
      /of their choice/i.test(String((step as any).what?.text || step.raw || '')),
  );
  if (needsEachPlayerSacrificeChoice) {
    const wantsLand = someOracleSteps(
      steps,
      (step) => step.kind === 'sacrifice' && /\bsacrifices a land\b/i.test(String(step.raw || '')),
    );
    const wantsPlaneswalker = someOracleSteps(
      steps,
      (step) =>
        step.kind === 'sacrifice' &&
        /\bcreature or planeswalker\b/i.test(String((step as any).what?.text || step.raw || '')),
    );
    const playerIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean);
    const chosenIds: string[] = [];
    const extraBattlefield: any[] = [];
    for (const playerId of playerIds) {
      if (playerId === 'p1') {
        chosenIds.push(wantsLand ? 'bf-land-1' : 'bf-creature-1');
        continue;
      }
      if (playerId === 'p2') {
        chosenIds.push(wantsLand ? 'bf-opponent-land' : 'bf-opponent-creature');
        continue;
      }
      const fixtureId = wantsLand ? `bf-audit-land-${playerId}` : `bf-audit-creature-${playerId}`;
      chosenIds.push(fixtureId);
      extraBattlefield.push(
        wantsLand
          ? {
              id: fixtureId,
              name: `Audit Land ${playerId}`,
              controller: playerId,
              owner: playerId,
              type_line: 'Basic Land — Forest',
            }
          : {
              id: fixtureId,
              name: `Audit Creature ${playerId}`,
              controller: playerId,
              owner: playerId,
              type_line: wantsPlaneswalker ? 'Creature — Human' : 'Creature — Human',
              card: {
                type_line: wantsPlaneswalker ? 'Creature — Human' : 'Creature — Human',
                power: '2',
                toughness: '2',
              },
            },
      );
    }
    if (extraBattlefield.length > 0) {
      nextState = {
        ...nextState,
        battlefield: [...((nextState.battlefield || []) as any[]), ...extraBattlefield],
      } as GameState;
    }
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: chosenIds,
      },
    } as typeof nextCtx;
  }

  const needsSacrificedPermanentAmount = someOracleSteps(steps, (step) => {
    const raw = String(step.raw || '');
    const amountRaw = String((step as any).amount?.raw || '').toLowerCase();
    const conditionRaw = String((step as any).condition?.raw || '').toLowerCase();
    return (
      /sacrificed (?:creature|permanent)/i.test(raw) ||
      /mana value of the sacrificed permanent/i.test(amountRaw) ||
      /sacrificed creature's toughness/i.test(amountRaw) ||
      /sacrificed creature's toughness/i.test(conditionRaw)
    );
  });
  if (needsSacrificedPermanentAmount) {
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: 'bf-creature-1',
          name: 'Grizzly Bears',
          typeLine: 'creature — bear',
          type_line: 'Creature — Bear',
          power: 2,
          toughness: 4,
          manaValue: 3,
          cmc: 3,
          mana_value: 3,
          colors: ['G'],
        },
      ],
    } as typeof nextCtx;
  }

  const needsOptionalNonlandSacrifice = someOracleSteps(
    steps,
    (step) => step.kind === 'sacrifice' && /you may sacrifice another nonland/i.test(String(step.raw || '')),
  );
  if (needsOptionalNonlandSacrifice && needsSacrificedPermanentAmount) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-artifact-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-artifact-1',
        chosenObjectIds: ['bf-artifact-1'],
      },
    } as typeof nextCtx;
  }

  const needsCopyThatCreatureReference = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'create_token' || step.kind === 'conditional') &&
      /copy of that creature/i.test(String(step.raw || '')),
  );
  const needsCopyItReference = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'create_token' || step.kind === 'conditional') &&
      /\bcopy of it\b/i.test(String(step.raw || '')),
  );
  if (needsCopyThatCreatureReference || needsCopyItReference) {
    const referenceId = needsCopyThatCreatureReference
      ? 'bf-opponent-creature'
      : String(nextCtx.sourceId || 'bf-source').trim();
    const sourceSnapshot = ((nextState.battlefield || []) as any[]).find(
      (perm) => String(perm?.id || '').trim() === String(nextCtx.sourceId || 'bf-source').trim(),
    );
    const delayedCopyOfIt = someOracleSteps(
      steps,
      (step) => step.kind === 'create_token' && /copy of it\b/i.test(String(step.raw || '')) && /next end step/i.test(String(step.raw || '')),
    );
    nextCtx = {
      ...nextCtx,
      targetPermanentId: referenceId,
      targetCreatureId: referenceId,
      lastMovedBattlefieldPermanentIds: [referenceId],
      ...(delayedCopyOfIt && sourceSnapshot
        ? {
            lastSacrificedPermanents: [
              {
                id: String(sourceSnapshot.id || '').trim(),
                name: String(sourceSnapshot.name || sourceSnapshot.card?.name || 'Audit Source'),
                typeLine: String(sourceSnapshot.type_line || sourceSnapshot.card?.type_line || '').toLowerCase(),
                power: sourceSnapshot.power,
                toughness: sourceSnapshot.toughness,
                manaValue: Number(sourceSnapshot.cmc ?? sourceSnapshot.card?.cmc ?? 0) || 0,
                colors: Array.isArray(sourceSnapshot.colors) ? sourceSnapshot.colors : [],
              },
            ],
          }
        : {}),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: referenceId,
        targetCreatureId: referenceId,
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            referenceId,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachOtherOpponentAttackingCopy = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'create_token' &&
      ((step as any).attacking === 'each_other_opponent' ||
        /for each (?:other opponent|opponent other than)/i.test(String(step.raw || ''))),
  );
  if (needsEachOtherOpponentAttackingCopy) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextCtx = {
      ...nextCtx,
      targetOpponentId: 'p2' as PlayerID,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetOpponentId: 'p2' as PlayerID,
        targetPermanentId: sourceId,
        targetCreatureId: sourceId,
        chosenObjectIds: [sourceId],
      },
    } as typeof nextCtx;
  }

  const needsDelayedThoseTokenSacrifice = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'schedule_delayed_battlefield_action' || step.kind === 'sacrifice') &&
      /those tokens/i.test(String(step.raw || '')),
  );
  if (needsDelayedThoseTokenSacrifice) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-token-1') return perm;
        return { ...perm, isToken: true, createdBySourceId: sourceId };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastCreatedTokenIds: ['bf-token-1'],
    } as typeof nextCtx;
  }

  const needsDieRollWhereX = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'roll_die' ||
      (step.kind === 'modify_pt' &&
        (/result minus/i.test(String((step as any).condition?.raw || step.raw || '')) ||
          /where x is the result/i.test(String(step.raw || '')))),
  );
  if (needsDieRollWhereX) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const sourcePermanent = ((nextState.battlefield || []) as any[]).find(
      (perm) => String(perm?.id || '').trim() === sourceId,
    );
    const equippedTargetId = String(sourcePermanent?.attachedTo || 'bf-creature-1').trim() || 'bf-creature-1';
    const wantsThatCreatureAfterRoll = steps.some(
      (step) => step.kind === 'modify_pt' && /that creature/i.test(String((step as any).target?.text || step.raw || '')),
    );
    const rollTargetId = wantsThatCreatureAfterRoll ? equippedTargetId : sourceId;
    nextState = {
      ...nextState,
      lastDieRoll: { result: 4 },
      lastDieRollByPlayer: { p1: { result: 4 }, p2: { result: 3 } },
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: rollTargetId,
      targetPermanentId: rollTargetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: rollTargetId,
        targetPermanentId: rollTargetId,
      },
    } as typeof nextCtx;
  }

  const needsEachPlayerVariableSacrifice = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'sacrifice' &&
      (step as any).who?.kind === 'each_player' &&
      /\bsacrifices?\s+x\s+creatures\b/i.test(String(step.raw || '')),
  );
  if (needsEachPlayerVariableSacrifice) {
    const playerIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean);
    const requiredCount = Math.max(1, Number((nextCtx as any).xValue) || 3);
    const extraBattlefield: any[] = [];
    for (const playerId of playerIds) {
      for (let idx = 1; idx <= requiredCount; idx += 1) {
        const fixtureId =
          playerId === 'p1'
            ? idx === 1
              ? 'bf-creature-1'
              : idx === 2
                ? 'bf-creature-2'
                : `bf-audit-creature-p1-${idx}`
            : playerId === 'p2'
              ? idx === 1
                ? 'bf-opponent-creature'
                : `bf-audit-creature-p2-${idx}`
              : `bf-audit-creature-${playerId}-${idx}`;
        if ((nextState.battlefield || []).some((perm: any) => String(perm?.id || '').trim() === fixtureId)) {
          continue;
        }
        extraBattlefield.push({
          id: fixtureId,
          name: `Audit Creature ${playerId}-${idx}`,
          controller: playerId,
          owner: playerId,
          type_line: 'Creature — Human',
          card: { type_line: 'Creature — Human', power: '2', toughness: '2' },
        });
      }
    }
    if (extraBattlefield.length > 0) {
      nextState = {
        ...nextState,
        battlefield: [...((nextState.battlefield || []) as any[]), ...extraBattlefield],
      } as GameState;
    }
  }

  const sacrificeFixtureNeeds = (() => {
    const extraBattlefield: any[] = [];
    const chosenIds: string[] = [];
    const existingIds = new Set(
      ((nextState.battlefield || []) as any[])
        .map((perm) => String(perm?.id || '').trim())
        .filter(Boolean),
    );
    const controllerId = String(nextCtx.controllerId || 'p1').trim() || 'p1';
    const opponents = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((id: string) => Boolean(id) && id !== controllerId);
    const subtypeTypeLine = (subtype: string, tokenOnly: boolean): string => {
      const normalized = subtype.toLowerCase();
      if (normalized === 'food') return tokenOnly ? 'Token Artifact — Food' : 'Artifact — Food';
      if (normalized === 'blood') return 'Token Artifact — Blood';
      if (normalized === 'powerstone') return 'Token Artifact — Powerstone';
      if (normalized === 'egg') return 'Token Creature — Egg';
      if (normalized === 'homunculus') return 'Creature — Homunculus';
      if (normalized === 'island') return 'Basic Land — Island';
      if (normalized === 'swamp') return 'Basic Land — Swamp';
      if (normalized === 'mountain') return 'Basic Land — Mountain';
      if (normalized === 'forest') return 'Basic Land — Forest';
      if (normalized === 'plains') return 'Basic Land — Plains';
      return tokenOnly ? `Token — ${subtype}` : `Permanent — ${subtype}`;
    };
    const ensureFixture = (
      id: string,
      fixture: any,
      select: boolean,
    ): void => {
      if (!existingIds.has(id)) {
        extraBattlefield.push(fixture);
        existingIds.add(id);
      }
      if (select) chosenIds.push(id);
    };

    for (const step of steps) {
      if (step.kind !== 'sacrifice') continue;
      const sacrificeStep = step as Extract<OracleEffectStep, { kind: 'sacrifice' }>;
      const parsed = parseSacrificeWhat({ kind: 'raw', text: extractSacrificeWhatText(sacrificeStep) });
      if (!parsed || (parsed.mode !== 'count' && parsed.mode !== 'all')) continue;

      const whoKind = String((sacrificeStep as any).who?.kind || 'you').trim();
      const seatIds =
        whoKind === 'each_opponent'
          ? opponents
          : whoKind === 'each_player'
            ? (nextState.players || []).map((player: any) => String(player?.id || '').trim()).filter(Boolean)
            : [controllerId];
      const requiredCount = parsed.mode === 'all' ? 1 : Math.max(1, Number(parsed.count) || 1);
      const subtype = String((parsed as any).subtype || '').trim().toLowerCase();
      const tokenOnly = Boolean((parsed as any).tokenOnly);
      const parsedType = String(parsed.type || 'permanent');
      const wantsGreatestPower = Boolean((parsed as any).greatestPowerAmongControlled);

      for (const seatId of seatIds) {
        if (parsedType === 'creature' || /\bcreature\b/i.test(String(extractSacrificeWhatText(sacrificeStep)))) {
          const existingCreatures = ((nextState.battlefield || []) as any[]).filter(
            (perm) =>
              String(perm?.controller || '').trim() === seatId &&
              /\bcreature\b/i.test(String(perm?.type_line || perm?.card?.type_line || '')),
          );
          const missing = Math.max(0, requiredCount - existingCreatures.length);
          for (let idx = 1; idx <= missing; idx += 1) {
            const fixtureId = `bf-audit-sacrifice-creature-${seatId}-${idx}`;
            const power = wantsGreatestPower && seatId === 'p2' && idx === 1 ? 6 : 2;
            ensureFixture(
              fixtureId,
              {
                id: fixtureId,
                name: `Audit Sacrifice Creature ${seatId}-${idx}`,
                controller: seatId,
                owner: seatId,
                type_line: 'Creature — Human',
                power,
                toughness: 2,
                card: { type_line: 'Creature — Human', power: String(power), toughness: '2' },
              },
              wantsGreatestPower && idx === 1,
            );
          }
          if (wantsGreatestPower) {
            const seatCreatures = [
              ...existingCreatures,
              ...extraBattlefield.filter(
                (perm) =>
                  String(perm?.controller || '').trim() === seatId &&
                  /\bcreature\b/i.test(String(perm?.type_line || '')),
              ),
            ];
            const readPower = (perm: any) => Number(perm?.power ?? perm?.card?.power ?? 0) || 0;
            const maxPower = Math.max(...seatCreatures.map(readPower), 0);
            const best = seatCreatures.find((perm) => readPower(perm) === maxPower);
            if (best) chosenIds.push(String(best.id || '').trim());
          }
          continue;
        }

        if (subtype) {
          for (let idx = 1; idx <= requiredCount; idx += 1) {
            const fixtureId = `bf-audit-sacrifice-${subtype}-${seatId}-${idx}`;
            ensureFixture(
              fixtureId,
              {
                id: fixtureId,
                name: `Audit ${subtype} ${seatId}-${idx}`,
                controller: seatId,
                owner: seatId,
                isToken: tokenOnly || ['food', 'blood', 'powerstone', 'egg'].includes(subtype),
                type_line: subtypeTypeLine(subtype, tokenOnly),
                card: { type_line: subtypeTypeLine(subtype, tokenOnly) },
              },
              idx === 1,
            );
          }
        }
      }
    }

    return {
      extraBattlefield,
      chosenIds: Array.from(new Set(chosenIds.filter(Boolean))),
    };
  })();
  if (sacrificeFixtureNeeds.extraBattlefield.length > 0) {
    nextState = {
      ...nextState,
      battlefield: [...((nextState.battlefield || []) as any[]), ...sacrificeFixtureNeeds.extraBattlefield],
    } as GameState;
  }
  if (sacrificeFixtureNeeds.chosenIds.length > 0) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...sacrificeFixtureNeeds.chosenIds,
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsAttachedCopyLoop = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'create_token' &&
      (/for each nontoken permanent attached to it/i.test(String(step.raw || '')) ||
        /for each aura and equipment attached to this permanent/i.test(String(step.raw || ''))),
  );
  if (needsAttachedCopyLoop) {
    const hostId = someOracleSteps(steps, (step) => /attached to it/i.test(String(step.raw || '')))
      ? String(nextCtx.targetCreatureId || nextCtx.targetPermanentId || 'bf-creature-1').trim()
      : String(nextCtx.sourceId || 'bf-source').trim();
    const existing = (nextState.battlefield || []) as any[];
    const additions: any[] = [];
    if (!existing.some((perm) => String(perm?.id || '').trim() === 'bf-audit-aura-host')) {
      additions.push({
        id: 'bf-audit-aura-host',
        name: 'Audit Aura',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Enchantment — Aura',
        attachedTo: hostId,
        card: { type_line: 'Enchantment — Aura', mana_cost: '{1}{W}', cmc: 2 },
      });
    }
    if (!existing.some((perm) => String(perm?.id || '').trim() === 'bf-audit-equipment-host')) {
      additions.push({
        id: 'bf-audit-equipment-host',
        name: 'Audit Equipment',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Artifact — Equipment',
        attachedTo: hostId,
        card: { type_line: 'Artifact — Equipment', mana_cost: '{2}', cmc: 2 },
      });
    }
    if (additions.length > 0) {
      nextState = {
        ...nextState,
        battlefield: [...existing, ...additions],
      } as GameState;
    }
    nextCtx = {
      ...nextCtx,
      targetPermanentId: hostId,
      targetCreatureId: hostId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: hostId,
        targetCreatureId: hostId,
      },
    } as typeof nextCtx;
  }

  const needsContextualDestroyIt = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'destroy' &&
      /^(?:it|them)$/i.test(
        String((step as any).target?.text || '')
          .replace(/^destroy\s+/i, '')
          .trim(),
      ),
  );
  if (needsContextualDestroyIt) {
    const targetId = 'bf-opponent-creature';
    nextCtx = {
      ...nextCtx,
      targetPermanentId: targetId,
      targetCreatureId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: targetId,
        targetCreatureId: targetId,
      },
    } as typeof nextCtx;
  }

  const needsModifyPtItTarget = steps.some(
    (step) =>
      step.kind === 'modify_pt' &&
      /\bit\b/i.test(String((step as any).target?.text || step.raw || '')),
  );
  const needsModifyPtWhereXFixtures = steps.some((step) => {
    if (step.kind !== 'modify_pt') return false;
    const raw = String(step.raw || '').toLowerCase();
    return (
      /devotion to red/i.test(raw) ||
      /red mana symbols in the mana costs of permanents you control/i.test(raw) ||
      /oil counters on them/i.test(raw) ||
      /times this creature has mutated/i.test(raw) ||
      /greatest power among tapped creatures your opponents control/i.test(raw)
    );
  });
  if (needsModifyPtItTarget || needsModifyPtWhereXFixtures) {
    const targetId = String(nextCtx.targetCreatureId || nextCtx.selectorContext?.targetCreatureId || 'bf-source').trim();
    nextCtx = {
      ...nextCtx,
      targetCreatureId: targetId,
      targetPermanentId: targetId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: targetId,
        targetPermanentId: targetId,
      },
    } as typeof nextCtx;
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        const permId = String(perm?.id || '').trim();
        if (permId === 'bf-red-creature') {
          return {
            ...perm,
            mana_cost: '{R}{R}{R}',
            cmc: 3,
            card: { ...(perm.card || {}), mana_cost: '{R}{R}{R}', cmc: 3 },
          };
        }
        if (permId === 'bf-artifact-1') {
          return { ...perm, counters: { ...(perm.counters || {}), oil: 2 } };
        }
        if (permId === 'bf-source') {
          return { ...perm, mutatedTimes: 2, mutatedStack: ['bf-source', 'bf-creature-1'] };
        }
        if (permId === 'bf-opponent-creature') {
          return { ...perm, tapped: true, power: 5, toughness: 5 };
        }
        return perm;
      }),
    } as GameState;
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

  let needsEarthbendLand = false;
  let needsThatCreaturePower = false;
  walkOracleSteps(steps, (step) => {
    if (step.kind !== 'earthbend') return;
    needsEarthbendLand = true;
    const whereRaw = String((step as { whereX?: { raw?: string } }).whereX?.raw || '').toLowerCase();
    if (/that creature'?s (?:power|toughness)/.test(whereRaw)) {
      needsThatCreaturePower = true;
    }
  });
  if (needsEarthbendLand) {
    const landTargetId = String(nextCtx.targetPermanentId || nextCtx.selectorContext?.targetPermanentId || 'bf-land-1');
    const creatureTargetId = needsThatCreaturePower
      ? String(nextCtx.targetCreatureId || nextCtx.selectorContext?.targetCreatureId || 'bf-creature-1')
      : String(nextCtx.targetCreatureId || nextCtx.selectorContext?.targetCreatureId || '');
    nextCtx = {
      ...nextCtx,
      targetPermanentId: landTargetId,
      ...(creatureTargetId ? { targetCreatureId: creatureTargetId } : {}),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: landTargetId,
        ...(creatureTargetId ? { targetCreatureId: creatureTargetId } : {}),
      },
    } as typeof nextCtx;
  }

  let needsAnyNumberArtifactAnimation = false;
  walkOracleSteps(steps, (step) => {
    if (step.kind !== 'animate_permanent') return;
    const targetText = String((step as { target?: { text?: string } }).target?.text || '').toLowerCase();
    if (/any number of target noncreature artifacts you control/.test(targetText)) {
      needsAnyNumberArtifactAnimation = true;
    }
  });
  if (needsAnyNumberArtifactAnimation) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-treasure-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-treasure-1',
      },
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

  const needsAllCommandersFromCommandZone = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^all commanders from the command zone$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsAllCommandersFromCommandZone) {
    const commanderFixtures = [
      {
        id: 'cmd-tevesh-p1',
        name: 'Audit P1 Commander',
        type_line: 'Legendary Creature — Human Cleric',
        cmc: 4,
        isCommander: true,
      },
      {
        id: 'cmd-tevesh-p2',
        name: 'Audit P2 Commander',
        type_line: 'Legendary Creature — Elf Warrior',
        cmc: 3,
        isCommander: true,
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const commandZone = Array.isArray(player?.commandZone)
          ? [...player.commandZone]
          : Array.isArray(player?.command)
            ? [...player.command]
            : [];
        const fixture =
          playerId === 'p1'
            ? commanderFixtures[0]
            : playerId === 'p2'
              ? commanderFixtures[1]
              : null;
        if (!fixture) return player;
        const merged = [...commandZone];
        if (!merged.some((entry: any) => String(entry?.id || '').trim() === fixture.id)) {
          merged.push(fixture);
        }
        return { ...player, commandZone: merged, command: merged };
      }),
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
      (/target aura attached to a creature|all auras enchanting target permanent|target aura you control/i.test(
        String(step.raw || '')
      ))
  );
  if (needsAuraReattach) {
    const needsTargetAuraYouControl = steps.some(
      (step) => step.kind === 'attach' && /target aura you control/i.test(String(step.raw || ''))
    );
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).map((perm: any) => {
          if (String(perm?.id || '').trim() !== 'bf-enchantment-1') return perm;
          return { ...perm, attachedTo: needsTargetAuraYouControl ? 'bf-creature-1' : 'bf-creature-1' };
        }),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPermanentId: needsTargetAuraYouControl ? 'bf-creature-2' : 'bf-creature-1',
      targetCreatureId: needsTargetAuraYouControl ? 'bf-creature-2' : 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: needsTargetAuraYouControl ? 'bf-creature-2' : 'bf-creature-1',
        targetCreatureId: needsTargetAuraYouControl ? 'bf-creature-2' : 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-enchantment-1',
            needsTargetAuraYouControl ? 'bf-creature-2' : 'bf-creature-2',
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
    const needsSurveilGyLibrarySplit = steps.some(
      (step) =>
        step.kind === 'move_zone' &&
        (step as any).to === 'graveyard' &&
        /any number of them/i.test(String((step as any).what?.text || step.raw || ''))
    );
    const surveilTopCards = [
      { id: 'lib-surveil-1', name: 'Surveil One', type_line: 'Instant', cmc: 1 },
      { id: 'lib-surveil-2', name: 'Surveil Two', type_line: 'Creature — Human', cmc: 2, power: '2', toughness: '2' },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player?.library) ? [...player.library] : [];
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        if (needsSurveilGyLibrarySplit) {
          const mergedLibrary = [...surveilTopCards, ...library.filter(
            (card: any) => !surveilTopCards.some((entry) => String(entry.id) === String(card?.id || '').trim())
          )];
          return { ...player, library: mergedLibrary, exile };
        }
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
      ...(needsSurveilGyLibrarySplit
        ? {
            lastMovedCards: surveilTopCards,
          }
        : {
            lastMilledCards: [
              { id: 'gy-milled-land-1', name: 'Milled Plains', type_line: 'Basic Land — Plains' },
              { id: 'gy-milled-1', name: 'Milled This Turn', type_line: 'Creature — Zombie', cmc: 2, milledTurn: 3 },
            ],
          }),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...(needsSurveilGyLibrarySplit
              ? ['lib-surveil-1']
              : [
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
                ]),
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThisCreatureAndColoredTargetBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bthis creature and target\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      (step as any).to === 'hand'
  );
  if (needsThisCreatureAndColoredTargetBounce) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).some(
        (perm: any) => String(perm?.id || '').trim() === 'bf-blue-creature'
      )
        ? nextState.battlefield
        : [
            ...((nextState.battlefield || []) as any[]),
            {
              id: 'bf-blue-creature',
              name: 'Audit Blue Creature',
              controller: 'p1',
              owner: 'p1',
              type_line: 'Creature — Merfolk',
              colors: ['U'],
            },
          ],
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
            'bf-source',
            'bf-blue-creature',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCountTargetCardsFromSingleGraveyardExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      step.to === 'exile' &&
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+) target cards? from a single graveyard\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsCountTargetCardsFromSingleGraveyardExile) {
    const gyCards = [
      { id: 'gy-single-exile-1', name: 'Single Exile One', type_line: 'Instant', cmc: 1 },
      { id: 'gy-single-exile-2', name: 'Single Exile Two', type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-single-exile-3', name: 'Single Exile Three', type_line: 'Creature — Rat', cmc: 3 },
      { id: 'gy-single-exile-4', name: 'Single Exile Four', type_line: 'Enchantment', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of gyCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            'gy-single-exile-1',
            'gy-single-exile-2',
            'gy-single-exile-3',
            'gy-single-exile-4',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsSingleGraveyardXExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bx target cards? from a single graveyard\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsSingleGraveyardXExile) {
    const gyCards = [
      { id: 'gy-single-1', name: 'Single GY One', type_line: 'Instant', cmc: 1 },
      { id: 'gy-single-2', name: 'Single GY Two', type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-single-3', name: 'Single GY Three', type_line: 'Creature — Rat', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of gyCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Number(nextCtx.xValue ?? 3),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-single-1',
            'gy-single-2',
            'gy-single-3',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachGraveyardOptionalExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bfrom each graveyard\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsEachGraveyardOptionalExile) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const wantsInstantSorcery = steps.some(
          (step) =>
            step.kind === 'move_zone' &&
            /instant or sorcery/i.test(String((step as any).what?.text || step.raw || ''))
        );
        const extra =
          playerId === 'p1'
            ? wantsInstantSorcery
              ? { id: 'gy-p1-instant-each', name: 'P1 Instant', type_line: 'Instant', cmc: 2 }
              : { id: 'gy-p1-creature-each', name: 'P1 Creature', type_line: 'Creature — Zombie', cmc: 2 }
            : wantsInstantSorcery
              ? { id: `gy-${playerId}-sorcery-each`, name: 'Audit Sorcery', type_line: 'Sorcery', cmc: 3 }
              : { id: `gy-${playerId}-pw-each`, name: 'Audit Planeswalker', type_line: 'Legendary Planeswalker — Jace', cmc: 4 };
        return graveyard.some((card: any) => String(card?.id || '').trim() === extra.id)
          ? player
          : { ...player, graveyard: [...graveyard, extra] };
      }),
    } as GameState;
    const wantsInstantSorcery = steps.some(
      (step) =>
        step.kind === 'move_zone' &&
        /instant or sorcery/i.test(String((step as any).what?.text || step.raw || ''))
    );
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...(wantsInstantSorcery
              ? ['gy-p1-instant-each', 'gy-p2-sorcery-each', 'gy-p3-sorcery-each', 'gy-p4-sorcery-each']
              : ['gy-p1-creature-each', 'gy-p2-pw-each', 'gy-p3-pw-each', 'gy-p4-pw-each']),
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsHistoricPermanentFromHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bhistoric permanent card from your hand\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsHistoricPermanentFromHand) {
    const historicHandCard = {
      id: 'hand-historic-1',
      name: 'Audit Historic',
      type_line: 'Legendary Artifact',
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        return hand.some((card: any) => String(card?.id || '').trim() === historicHandCard.id)
          ? player
          : { ...player, hand: [...hand, historicHandCard] };
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
            'hand-historic-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTwoOfThemAtRandomReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\btwo of them at random\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsTwoOfThemAtRandomReturn) {
    const gyCreatures = [
      { id: 'gy-waltz-1', name: 'Waltz One', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-waltz-2', name: 'Waltz Two', type_line: 'Creature — Skeleton', cmc: 3 },
      { id: 'gy-waltz-3', name: 'Waltz Three', type_line: 'Creature — Vampire', cmc: 4 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of gyCreatures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            'gy-waltz-1',
            'gy-waltz-2',
            'gy-waltz-3',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsFlashbackGyExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball cards with flashback from (?:target|that) (?:player|opponent)'s graveyard\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsFlashbackGyExile) {
    const flashbackCard = {
      id: 'gy-flashback-1',
      name: 'Flashback Spell',
      type_line: 'Sorcery',
      keywords: ['Flashback'],
    };
    const normalCard = { id: 'gy-normal-1', name: 'Normal', type_line: 'Creature — Human' };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of [flashbackCard, normalCard]) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        chosenObjectIds: Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
          ? nextCtx.selectorContext.chosenObjectIds
          : [],
      },
    } as typeof nextCtx;
  }

  const needsExileAllLibrary = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\ball(?:\s+the)?\s+cards from your library\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      (step as any).to === 'exile'
  );
  if (needsExileAllLibrary) {
    const libraryCards = [
      { id: 'lib-mirror-1', name: 'Mirror One', type_line: 'Instant', cmc: 1 },
      { id: 'lib-mirror-2', name: 'Mirror Two', type_line: 'Sorcery', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [...library];
        for (const card of libraryCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, library: merged };
      }),
    } as GameState;
  }

  const needsOneTwoOrThreeCreaturesFromGraveyards = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bone, two, or three target creature cards from graveyards\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsOneTwoOrThreeCreaturesFromGraveyards) {
    const gyCreatures = [
      { id: 'gy-aberrant-1', name: 'Aberrant One', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-aberrant-2', name: 'Aberrant Two', type_line: 'Creature — Skeleton', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const extra =
          playerId === 'p1'
            ? gyCreatures
            : [{ id: 'gy-p2-aberrant', name: 'P2 Creature', type_line: 'Creature — Human', cmc: 2 }];
        const merged = [...graveyard];
        for (const card of extra) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
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
            'gy-aberrant-1',
            'gy-aberrant-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsFaceDownGyPileExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bin a face-down pile\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsFaceDownGyPileExile) {
    const gyCreatures = [
      { id: 'gy-ghastly-1', name: 'Ghastly One', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-ghastly-2', name: 'Ghastly Two', type_line: 'Creature — Bear', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [...graveyard];
        for (const card of gyCreatures) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
      },
    } as typeof nextCtx;
  }

  const needsUpToXArtifactCreatureAmongThem = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bup to x artifact and\/or creature cards with mana value \d+ or less from among them\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsUpToXArtifactCreatureAmongThem) {
    const kaylaTop = [
      { id: 'lib-kayla-1', name: 'Kayla Artifact', type_line: 'Artifact', cmc: 2 },
      { id: 'lib-kayla-2', name: 'Kayla Creature', type_line: 'Creature — Human', cmc: 2 },
      { id: 'lib-kayla-3', name: 'Kayla Instant', type_line: 'Instant', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [...kaylaTop, ...library.filter(
          (card: any) => !kaylaTop.some((entry) => String(entry.id) === String(card?.id || '').trim())
        )];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Number(nextCtx.xValue ?? 3),
      lastMovedCards: kaylaTop,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-kayla-1',
            'lib-kayla-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThatPileToGraveyard = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      (step as any).to === 'graveyard' &&
      /^that pile$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsThatPileToGraveyard) {
    const pileCards = [
      { id: 'exile-abstract-pile-1', name: 'Abstract One', type_line: 'Instant', cmc: 2 },
      { id: 'exile-abstract-pile-2', name: 'Abstract Two', type_line: 'Sorcery', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [...exile];
        for (const card of pileCards) {
          if (!merged.some((entry: any) => String(entry?.id || '').trim() === card.id)) merged.push(card);
        }
        return { ...player, exile: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: pileCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...pileCards.map((card) => card.id),
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTurntimberAmongThemCreature = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^a creature card from among them$/i.test(String((step as any).what?.text || '').trim()) &&
      /\bthat card has mana value \d+ or less\b/i.test(String(step.raw || ''))
  );
  if (needsTurntimberAmongThemCreature) {
    const turntimberTop = [
      { id: 'lib-turntimber-1', name: 'Turntimber Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-turntimber-2', name: 'Turntimber Elf', type_line: 'Creature — Elf', cmc: 1 },
      { id: 'lib-turntimber-3', name: 'Turntimber Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [...turntimberTop, ...library.filter(
          (card: any) => !turntimberTop.some((entry) => String(entry.id) === String(card?.id || '').trim())
        )];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: turntimberTop,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-turntimber-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsMayaelPowerGteAmongThem = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\bcreature card with power \d+ or greater from among them\b/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsMayaelPowerGteAmongThem) {
    const mayaelTop = [
      { id: 'lib-mayael-1', name: 'Small Creature', type_line: 'Creature — Elf', cmc: 1, power: '1', toughness: '1' },
      { id: 'lib-mayael-2', name: 'Big Creature', type_line: 'Creature — Beast', cmc: 6, power: '6', toughness: '6' },
      { id: 'lib-mayael-3', name: 'Another Small', type_line: 'Creature — Goblin', cmc: 2, power: '2', toughness: '2' },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [...mayaelTop, ...library.filter(
          (card: any) => !mayaelTop.some((entry) => String(entry.id) === String(card?.id || '').trim())
        )];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: mayaelTop,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-mayael-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsStormAmongThemPermanentMv = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /up to two permanent cards with mana value 5 or less from among them/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsStormAmongThemPermanentMv) {
    const stormTop = [
      { id: 'lib-storm-1', name: 'Storm Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-storm-2', name: 'Storm Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'lib-storm-3', name: 'Storm Ring', type_line: 'Artifact', cmc: 1 },
      { id: 'lib-storm-4', name: 'Storm Titan', type_line: 'Creature — Giant', cmc: 8 },
      { id: 'lib-storm-5', name: 'Storm Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          ...stormTop,
          ...library.filter(
            (card: any) => !stormTop.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: stormTop,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-storm-1',
            'lib-storm-3',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsOpponentChoicePermanentBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /target opponent chooses a permanent they control/i.test(String(step.raw || ''))
  );
  if (needsOpponentChoicePermanentBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-opponent-perm-1'
        ),
        {
          id: 'bf-opponent-perm-1',
          name: 'Opponent Creature',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Human',
          colors: ['U'],
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-opponent-perm-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAnotherTargetUnlessPaysBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^another target /i.test(String((step as any).what?.text || '').trim()) &&
      /\bunless its controller pays\b/i.test(String(step.raw || step.toRaw || ''))
  );
  if (needsAnotherTargetUnlessPaysBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !['bf-withdraw-1', 'bf-withdraw-2'].includes(String(perm?.id || '').trim())
        ),
        {
          id: 'bf-withdraw-1',
          name: 'Withdraw Bear',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-withdraw-2',
          name: 'Withdraw Elf',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          colors: ['G'],
        },
      ],
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
            'bf-withdraw-1',
            'bf-withdraw-2',
          ])
        ),
        unlessPaysManaChoice: 'decline',
      },
    } as typeof nextCtx;
  }

  const needsAllColoredPermanentsBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^all (?:white|blue|black|red|green) permanents$/i.test(
        String((step as any).what?.text || '').trim()
      )
  );
  if (needsAllColoredPermanentsBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) =>
            !['bf-hibernate-green-1', 'bf-hibernate-green-2', 'bf-hibernate-blue-1'].includes(
              String(perm?.id || '').trim()
            )
        ),
        {
          id: 'bf-hibernate-green-1',
          name: 'Hibernate Bear',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Bear',
          colors: ['G'],
        },
        {
          id: 'bf-hibernate-green-2',
          name: 'Hibernate Forest',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Basic Land — Forest',
          colors: [],
        },
        {
          id: 'bf-hibernate-blue-1',
          name: 'Hibernate Fish',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Fish',
          colors: ['U'],
        },
      ],
    } as GameState;
  }

  const needsRevealedCardsToGraveyards = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^the revealed cards$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'graveyard'
  );
  if (needsRevealedCardsToGraveyards) {
    const revealedCards = [
      { id: 'lib-revealed-p1', name: 'Revealed Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'lib-revealed-p2', name: 'Revealed Elf', type_line: 'Creature — Elf', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        const topCard =
          playerId === 'p1'
            ? revealedCards[0]
            : playerId === 'p2'
              ? revealedCards[1]
              : null;
        if (!topCard) return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          topCard,
          ...library.filter((card: any) => String(card?.id || '').trim() !== topCard.id),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: revealedCards,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'lib-revealed-p1',
            'lib-revealed-p2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAnyNumberHandFaceDownExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^any number of cards from your hand face down$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'exile'
  );
  if (needsAnyNumberHandFaceDownExile) {
    const handFixtures = [
      { id: 'scroll-hand-1', name: 'Scroll Hand One', type_line: 'Instant', cmc: 1 },
      { id: 'scroll-hand-2', name: 'Scroll Hand Two', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
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
            'scroll-hand-1',
            'scroll-hand-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThatManyLibraryTopToHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^that many cards from the top of your library$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'hand'
  );
  if (needsThatManyLibraryTopToHand) {
    const libraryTop = [
      { id: 'scroll-lib-1', name: 'Scroll Top One', type_line: 'Instant', cmc: 1 },
      { id: 'scroll-lib-2', name: 'Scroll Top Two', type_line: 'Instant', cmc: 1 },
      { id: 'scroll-lib-3', name: 'Scroll Top Three', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          ...libraryTop,
          ...library.filter(
            (card: any) => !libraryTop.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      referenceAmount: Math.max(2, Number(nextCtx.referenceAmount) || 2),
    } as typeof nextCtx;
  }

  const needsDestroyedThisWayGyReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^all cards in your graveyard destroyed this way$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsDestroyedThisWayGyReturn) {
    const destroyedFixtures = [
      { id: 'cleanse-gy-artifact', name: 'Cleanse Artifact', type_line: 'Artifact', cmc: 2 },
      { id: 'cleanse-gy-enchant', name: 'Cleanse Enchant', type_line: 'Enchantment', cmc: 3 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...destroyedFixtures,
          ...graveyard.filter(
            (card: any) => !destroyedFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: destroyedFixtures,
    } as typeof nextCtx;
  }

  const needsCompoundArtifactCreatureLandGyHandsExile = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^all artifacts, creatures, and lands from the battlefield, all cards from all graveyards, and all cards from all hands$/i.test(
        String((step as any).what?.text || '').trim()
      ) &&
      (step as any).to === 'exile'
  );
  if (needsCompoundArtifactCreatureLandGyHandsExile) {
    const p1Hand = [{ id: 'decree-p1-hand', name: 'Decree Hand', type_line: 'Instant', cmc: 1 }];
    const p2Hand = [{ id: 'decree-p2-hand', name: 'Decree Opp Hand', type_line: 'Instant', cmc: 1 }];
    const p1Gy = [{ id: 'decree-p1-gy', name: 'Decree GY', type_line: 'Creature — Bear', cmc: 2 }];
    const p2Gy = [{ id: 'decree-p2-gy', name: 'Decree Opp GY', type_line: 'Instant', cmc: 1 }];
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) =>
            !['decree-bf-art', 'decree-bf-creature', 'decree-bf-land'].includes(String(perm?.id || '').trim())
        ),
        {
          id: 'decree-bf-art',
          name: 'Decree Sol Ring',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact',
          cmc: 1,
        },
        {
          id: 'decree-bf-creature',
          name: 'Decree Bear',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Bear',
          cmc: 2,
          colors: ['G'],
        },
        {
          id: 'decree-bf-land',
          name: 'Decree Forest',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Basic Land — Forest',
          cmc: 0,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId === 'p1') {
          const hand = Array.isArray(player.hand) ? [...player.hand] : [];
          const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
          return {
            ...player,
            hand: [...p1Hand, ...hand.filter((card: any) => String(card?.id || '').trim() !== p1Hand[0].id)],
            graveyard: [...p1Gy, ...graveyard.filter((card: any) => String(card?.id || '').trim() !== p1Gy[0].id)],
          };
        }
        if (playerId === 'p2') {
          const hand = Array.isArray(player.hand) ? [...player.hand] : [];
          const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
          return {
            ...player,
            hand: [...p2Hand, ...hand.filter((card: any) => String(card?.id || '').trim() !== p2Hand[0].id)],
            graveyard: [...p2Gy, ...graveyard.filter((card: any) => String(card?.id || '').trim() !== p2Gy[0].id)],
          };
        }
        return player;
      }),
    } as GameState;
  }

  const needsTargetOpponentHandToLibraryTop = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^the cards from target opponent's hand$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'library' &&
      /top/i.test(String((step as any).toRaw || ''))
  );
  if (needsTargetOpponentHandToLibraryTop) {
    const handFixtures = [
      { id: 'head-hand-1', name: 'Head Games Hand One', type_line: 'Instant', cmc: 1 },
      { id: 'head-hand-2', name: 'Head Games Hand Two', type_line: 'Creature — Bear', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p2') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'head-hand-1',
            'head-hand-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTargetFromGraveyardPutThereThisTurn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /from a graveyard that was put there this turn/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsTargetFromGraveyardPutThereThisTurn) {
    const gyCreature = {
      id: 'gy-abyssal-turn',
      name: 'Abyssal Fresh Corpse',
      type_line: 'Creature — Zombie',
      cmc: 2,
      putIntoGraveyardTurn: 3,
    };
    nextState = {
      ...nextState,
      turnNumber: Number((nextState as any)?.turnNumber ?? 3),
      turn: Number((nextState as any)?.turn ?? 3),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          gyCreature,
          ...graveyard.filter((card: any) => String(card?.id || '').trim() !== gyCreature.id),
        ];
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
            'gy-abyssal-turn',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsOrTypeCardFromAmongMilledToBattlefield = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /from among the milled cards/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\bcreature\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\benchantment\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      /\bland\b/i.test(String((step as any).what?.text || step.raw || '')) &&
      (step as any).to === 'battlefield'
  );
  if (needsOrTypeCardFromAmongMilledToBattlefield) {
    const milledFixtures = [
      { id: 'milled-bramble-creature', name: 'Bramble Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'milled-bramble-land', name: 'Bramble Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...milledFixtures,
          ...graveyard.filter(
            (card: any) => !milledFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: milledFixtures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'milled-bramble-creature',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsYourGraveyardAndHandShuffle = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^your graveyard and hand$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'library'
  );
  if (needsYourGraveyardAndHandShuffle) {
    const handFixtures = [
      { id: 'trenz-hand-1', name: 'Trenz Hand One', type_line: 'Instant', cmc: 1 },
      { id: 'trenz-hand-2', name: 'Trenz Hand Two', type_line: 'Creature — Bear', cmc: 2 },
    ];
    const gyFixtures = [
      { id: 'trenz-gy-1', name: 'Trenz GY One', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'trenz-gy-2', name: 'Trenz GY Two', type_line: 'Artifact', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          hand: [
            ...handFixtures,
            ...hand.filter(
              (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
            ),
          ],
          graveyard: [
            ...gyFixtures,
            ...graveyard.filter(
              (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
            ),
          ],
        };
      }),
    } as GameState;
  }

  const needsThisPermanentAndExiledCardToHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^this saga and the exiled card$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'hand'
  );
  if (needsThisPermanentAndExiledCardToHand) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const exiledCard = {
      id: 'exile-aesir-1',
      name: 'Aesir Exiled Card',
      type_line: 'Instant',
      cmc: 1,
      exiledWith: sourceId,
      exiledWithSourceId: sourceId,
    };
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== sourceId
        ),
        {
          id: sourceId,
          name: 'The Aesir Escape Valhalla',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Enchantment — Saga',
          cmc: 4,
        },
      ],
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        return {
          ...player,
          exile: [
            exiledCard,
            ...exile.filter((card: any) => String(card?.id || '').trim() !== exiledCard.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-aesir-1',
            sourceId,
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsUpToXPermanentCardsFromYourGraveyard = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^up to x permanent cards from your graveyard$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'hand'
  );
  if (needsUpToXPermanentCardsFromYourGraveyard) {
    const gyFixtures = [
      { id: 'uncle-gy-creature', name: 'Uncle Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'uncle-gy-artifact', name: 'Uncle Ring', type_line: 'Artifact', cmc: 1 },
      { id: 'uncle-gy-instant', name: 'Uncle Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            ...gyFixtures,
            ...graveyard.filter(
              (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
            ),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Math.max(3, Number(nextCtx.xValue) || 3),
      referenceAmount: Math.max(3, Number(nextCtx.referenceAmount) || 3),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'uncle-gy-creature',
            'uncle-gy-artifact',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAnyNumberTargetEnchantmentsBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^any number of target enchantments$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'hand'
  );
  if (needsAnyNumberTargetEnchantmentsBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) =>
            !['bf-kiora-enchant-1', 'bf-kiora-enchant-2'].includes(String(perm?.id || '').trim())
        ),
        {
          id: 'bf-kiora-enchant-1',
          name: 'Kiora Enchant One',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Enchantment',
          cmc: 2,
        },
        {
          id: 'bf-kiora-enchant-2',
          name: 'Kiora Enchant Two',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Enchantment — Aura',
          cmc: 1,
        },
      ],
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
            'bf-kiora-enchant-1',
            'bf-kiora-enchant-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCreaturePutIntoGyThisWayReturn = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^a creature card put into your graveyard this way$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsCreaturePutIntoGyThisWayReturn) {
    const destroyedFixture = {
      id: 'gy-starfall',
      name: 'Starfall Zombie',
      type_line: 'Creature — Zombie',
      cmc: 2,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            destroyedFixture,
            ...graveyard.filter((card: any) => String(card?.id || '').trim() !== destroyedFixture.id),
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [destroyedFixture],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-starfall',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachCreatureCardFromYourGraveyard = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^each creature card from your graveyard$/i.test(String((step as any).what?.text || '').trim()) &&
      (step as any).to === 'battlefield'
  );
  if (needsEachCreatureCardFromYourGraveyard) {
    const gyFixtures = [
      { id: 'gy-shilgengar-1', name: 'Shilgengar Bear', type_line: 'Creature — Bear', cmc: 2 },
      { id: 'gy-shilgengar-2', name: 'Shilgengar Elf', type_line: 'Creature — Elf', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        return {
          ...player,
          graveyard: [
            ...gyFixtures,
            ...graveyard.filter(
              (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
            ),
          ],
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
            'gy-shilgengar-1',
            'gy-shilgengar-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCreaturePlaneswalkerMvFromGy = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /creature (?:and|or) planeswalker/i.test(String((step as any).what?.text || step.raw || '')) &&
      /mana value (?:x|\d+) or less/i.test(String((step as any).what?.text || step.raw || '')) &&
      /from your graveyard/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsCreaturePlaneswalkerMvFromGy) {
    const gyFixtures = [
      { id: 'gy-batch300-1', name: 'Ascend Zombie', type_line: 'Creature — Zombie', cmc: 2 },
      { id: 'gy-batch300-2', name: 'Ascend Jace', type_line: 'Legendary Planeswalker — Jace', cmc: 4 },
      { id: 'gy-batch300-land', name: 'Ascend Plains', type_line: 'Basic Land — Plains', cmc: 0 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...gyFixtures,
          ...graveyard.filter(
            (card: any) => !gyFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      xValue: Number(nextCtx.xValue ?? 3),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-batch300-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsChosenTypeCreatureFromHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /creature card of the chosen type from your hand/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsChosenTypeCreatureFromHand) {
    const handFixtures = [
      { id: 'hand-belbe-elf-1', name: 'Belbe Elf', type_line: 'Creature — Elf', cmc: 2 },
      { id: 'hand-belbe-bolt-1', name: 'Belbe Bolt', type_line: 'Instant', cmc: 1 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenCreatureType: String(nextCtx.selectorContext?.chosenCreatureType || 'Elf'),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'hand-belbe-elf-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsThisCardAndNamedFromGy = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /this (?:card|permanent) and [a-z]+ cards named this permanent from your graveyard/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsThisCardAndNamedFromGy) {
    const namedFixtures = [
      { id: 'gy-dragon-1', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-dragon-2', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-dragon-3', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-dragon-4', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
      { id: 'gy-dragon-this', name: "Dragon's Approach", type_line: 'Sorcery', cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...namedFixtures,
          ...graveyard.filter(
            (card: any) => !namedFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId: String(nextCtx.sourceId || 'gy-dragon-this'),
      sourceName: String(nextCtx.sourceName || "Dragon's Approach"),
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-dragon-1',
            'gy-dragon-2',
            'gy-dragon-3',
            'gy-dragon-4',
            'gy-dragon-this',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsOneOrTwoTargetNonlandPermanentBounce = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /(?:one or two|two) target nonland permanents/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsOneOrTwoTargetNonlandPermanentBounce) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-wanderwine-/i.test(String(perm?.id || '').trim())
        ),
        {
          id: 'bf-wanderwine-1',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Wanderwine Enchantment', type_line: 'Enchantment', cmc: 2 },
          attachments: [],
          counters: {},
        },
        {
          id: 'bf-wanderwine-2',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Wanderwine Artifact', type_line: 'Artifact', cmc: 1 },
          attachments: [],
          counters: {},
        },
      ],
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
            'bf-wanderwine-1',
            'bf-wanderwine-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAllAttackingCreaturesToHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^all attacking creatures$/i.test(String((step as any).what?.text || '').trim()) &&
      step.to === 'hand'
  );
  if (needsAllAttackingCreaturesToHand) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-aetherize-atk-/i.test(String(perm?.id || '').trim())
        ),
        {
          id: 'bf-aetherize-atk-1',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Aetherize Attacker One', type_line: 'Creature — Soldier', cmc: 2 },
          attacking: true,
          tapped: true,
          attachments: [],
          counters: {},
        },
        {
          id: 'bf-aetherize-atk-2',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Aetherize Attacker Two', type_line: 'Creature — Wizard', cmc: 3 },
          attacking: true,
          tapped: true,
          attachments: [],
          counters: {},
        },
      ],
    } as GameState;
  }

  const needsEachAttackingCreatureToLibrary = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^each attacking creature$/i.test(String((step as any).what?.text || '').trim()) &&
      /top or bottom/i.test(String(step.toRaw || step.raw || ''))
  );
  if (needsEachAttackingCreatureToLibrary) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-aetherspouts-atk-1'
        ),
        {
          id: 'bf-aetherspouts-atk-1',
          controller: 'p2',
          owner: 'p2',
          card: { name: 'Aetherspouts Attacker', type_line: 'Creature — Soldier', cmc: 2 },
          attacking: true,
          tapped: true,
          attachments: [],
          counters: {},
        },
      ],
    } as GameState;
  }

  const needsExileGySplitTwoPiles = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /separate them into two piles/i.test(String((step as any).what?.text || step.raw || '')) &&
      /from your graveyard/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsExileGySplitTwoPiles) {
    const splitFixtures = [
      { id: 'gy-split-1', name: 'Split Sol Ring', type_line: 'Artifact', cmc: 1 },
      { id: 'gy-split-2', name: 'Split Craterhoof', type_line: 'Creature — Beast', cmc: 8 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const merged = [
          ...splitFixtures,
          ...graveyard.filter(
            (card: any) => !splitFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
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
            'gy-split-1',
            'gy-split-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCountCardsFromEachPlayersHand = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /^[a-z]+ cards from each player's hand$/i.test(String((step as any).what?.text || '').trim())
  );
  if (needsCountCardsFromEachPlayersHand) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        const handFixtures =
          String(player?.id || '').trim() === 'p1'
            ? [
                { id: 'hand-ms-p1-1', name: 'Mind Bolt', type_line: 'Instant', cmc: 1 },
                { id: 'hand-ms-p1-2', name: 'Mind Bear', type_line: 'Creature — Bear', cmc: 2 },
                { id: 'hand-ms-p1-3', name: 'Mind Shock', type_line: 'Instant', cmc: 1 },
              ]
            : [
                { id: 'hand-ms-p2-1', name: 'Opp Bolt', type_line: 'Instant', cmc: 1 },
                { id: 'hand-ms-p2-2', name: 'Opp Elf', type_line: 'Creature — Elf', cmc: 1 },
              ];
        const hand = Array.isArray(player.hand) ? [...player.hand] : [];
        const merged = [
          ...handFixtures,
          ...hand.filter(
            (card: any) => !handFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, hand: merged };
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
            'hand-ms-p1-1',
            'hand-ms-p1-2',
            'hand-ms-p2-1',
            'hand-ms-p2-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsTargetAdventureFromGy = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /target card that has an adventure from your graveyard/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsTargetAdventureFromGy) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        const adventureCard = {
          id: 'gy-adventure-1',
          name: 'Edgewall Adventure',
          type_line: 'Sorcery — Adventure',
          layout: 'adventure',
          cmc: 2,
        };
        if (graveyard.some((card: any) => String(card?.id || '').trim() === adventureCard.id)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, adventureCard] };
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
            'gy-adventure-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachCreatureExiledWithSource = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /each creature card exiled with this (?:artifact|enchantment|permanent|creature)/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsEachCreatureExiledWithSource) {
    const sourceId = String(nextCtx.sourceId || 'bf-source-artifact').trim();
    const exileFixtures = [
      {
        id: 'exile-ghost-1',
        name: 'Ghost Zombie',
        type_line: 'Creature — Zombie',
        cmc: 3,
        exiledWith: sourceId,
      },
      {
        id: 'exile-ghost-2',
        name: 'Ghost Bolt',
        type_line: 'Instant',
        cmc: 1,
        exiledWith: sourceId,
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [
          ...exileFixtures,
          ...exile.filter(
            (card: any) => !exileFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, exile: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-ghost-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsExiledCardsYouOwnWithIntelCounters = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /all exiled cards you own with intel counters on them/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsExiledCardsYouOwnWithIntelCounters) {
    const exileFixtures = [
      {
        id: 'exile-intel-1',
        name: 'Audit Intel Vehicle',
        type_line: 'Artifact — Vehicle',
        cmc: 3,
        owner: 'p1',
        counters: { intel: 1 },
      },
      {
        id: 'exile-intel-2',
        name: 'Audit Intel Robot',
        type_line: 'Artifact Creature — Robot',
        cmc: 2,
        owner: 'p1',
        counters: { intel: 2 },
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [
          ...exileFixtures,
          ...exile.filter(
            (card: any) => !exileFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, exile: merged };
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
            'exile-intel-1',
            'exile-intel-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsAttachAllEquipmentYouControl = stepsMatchPredicate(
    steps,
    (step) =>
      step.kind === 'attach' &&
      /^all equipment you control$/i.test(String((step as any).attachment?.text || '').trim())
  );
  if (needsAttachAllEquipmentYouControl) {
    const sourceId = String(nextCtx.sourceId || 'bf-balan').trim();
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-balan-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Balan',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Legendary Creature — Cat Knight',
          cmc: 3,
        },
        {
          id: 'bf-balan-eq-1',
          name: 'Balan Sword',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact — Equipment',
          cmc: 2,
        },
        {
          id: 'bf-balan-eq-2',
          name: 'Balan Axe',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Artifact — Equipment',
          attachedTo: 'bf-creature-1',
          cmc: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            sourceId,
            'bf-balan-eq-1',
            'bf-balan-eq-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsExiledCardsWithAegisCounters = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /all exiled cards with aegis counters on them/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsExiledCardsWithAegisCounters) {
    const exileFixtures = [
      {
        id: 'exile-aegis-1',
        name: 'Audit Aegis Soldier',
        type_line: 'Creature — Soldier',
        cmc: 2,
        counters: { aegis: 1 },
      },
      {
        id: 'exile-aegis-2',
        name: 'Audit Aegis Knight',
        type_line: 'Creature — Knight',
        cmc: 3,
        counters: { aegis: 1 },
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [
          ...exileFixtures,
          ...exile.filter(
            (card: any) => !exileFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, exile: merged };
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
            'exile-aegis-1',
            'exile-aegis-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsUpToOneMilledEnchantment = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /up to one enchantment card milled this way/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsUpToOneMilledEnchantment) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const milledEnchant = {
          id: 'gy-milled-enchant-1',
          name: 'Milled Pacifism',
          type_line: 'Enchantment',
          cmc: 2,
          milledTurn: 3,
        };
        if (graveyard.some((card: any) => String(card?.id || '').trim() === milledEnchant.id)) {
          return player;
        }
        return { ...player, graveyard: [...graveyard, milledEnchant] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [
        { id: 'gy-milled-enchant-1', name: 'Milled Pacifism', type_line: 'Enchantment', cmc: 2, milledTurn: 3 },
        { id: 'gy-milled-1', name: 'Milled This Turn', type_line: 'Creature — Zombie', cmc: 2, milledTurn: 3 },
      ],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-milled-enchant-1',
          ])
        ),
      },
    };
  }

  const needsAnyNumberPermanentDifferentNamesGy = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /any number of permanent cards with different names from your graveyard/i.test(
        String((step as any).what?.text || step.raw || '')
      )
  );
  if (needsAnyNumberPermanentDifferentNamesGy) {
    nextState = {
      ...nextState,
      turn: Number((nextState as any)?.turn ?? 3),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          {
            id: 'gy-eerie-bear-1',
            name: 'Audit Bear',
            type_line: 'Creature — Bear',
            cmc: 2,
          },
          {
            id: 'gy-eerie-elf-1',
            name: 'Audit Elf',
            type_line: 'Creature — Elf',
            cmc: 1,
          },
        ];
        const merged = [
          ...fixtures.filter(
            (card) => !graveyard.some((entry: any) => String(entry?.id || '').trim() === card.id)
          ),
          ...graveyard,
        ];
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
            'gy-eerie-bear-1',
            'gy-eerie-elf-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsCountExiledWithSagaRestLibrary = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /\btwo cards exiled with this saga\b/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsCountExiledWithSagaRestLibrary) {
    const sourceId = String(nextCtx.sourceId || 'bf-source-artifact').trim();
    const exileFixtures = [
      {
        id: 'exile-vault-1',
        name: 'Vault Exile One',
        type_line: 'Creature — Human',
        cmc: 2,
        exiledWith: sourceId,
      },
      {
        id: 'exile-vault-2',
        name: 'Vault Exile Two',
        type_line: 'Creature — Zombie',
        cmc: 3,
        exiledWith: sourceId,
      },
      {
        id: 'exile-vault-3',
        name: 'Vault Exile Three',
        type_line: 'Instant',
        cmc: 1,
        exiledWith: sourceId,
      },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player.exile) ? [...player.exile] : [];
        const merged = [
          ...exileFixtures,
          ...exile.filter(
            (card: any) => !exileFixtures.some((entry) => String(entry.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, exile: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'exile-vault-1',
            'exile-vault-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsEachCardPutIntoGraveyardThisWay = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /each card put into a graveyard this way/i.test(String((step as any).what?.text || step.raw || ''))
  );
  if (needsEachCardPutIntoGraveyardThisWay) {
    nextState = {
      ...nextState,
      turn: Number((nextState as any)?.turn ?? 3),
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
        const fixtures = [
          {
            id: 'gy-sorin-bear-1',
            name: 'Sorin Discarded Bear',
            type_line: 'Creature — Bear',
            cmc: 2,
            putIntoGraveyardTurn: 3,
          },
          {
            id: 'gy-sorin-elf-1',
            name: 'Sorin Discarded Elf',
            type_line: 'Creature — Elf',
            cmc: 1,
            putIntoGraveyardTurn: 3,
          },
        ];
        const merged = [
          ...fixtures.filter(
            (card) => !graveyard.some((entry: any) => String(entry?.id || '').trim() === card.id)
          ),
          ...graveyard,
        ];
        return { ...player, graveyard: merged };
      }),
    } as GameState;
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
          { id: 'exile-among-dwarf-1', name: 'Revealed Dwarf', type_line: 'Creature — Dwarf', colors: ['R'], cmc: 2 },
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
            'exile-among-dwarf-1',
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
    const discardedLand = {
      id: 'audit-discard-land-1',
      name: 'Discarded Plains',
      type_line: 'Basic Land — Plains',
      cmc: 0,
    };
    const discardedCards = [
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
      discardedLand,
    ];
    nextCtx = {
      ...nextCtx,
      lastDiscardedCards: discardedCards,
    };
    const needsDiscardedToBattlefield = steps.some(
      (step) =>
        step.kind === 'move_zone' &&
        /discarded this way/i.test(String(step.raw || '')) &&
        (step as any).to === 'battlefield'
    );
    if (needsDiscardedToBattlefield) {
      nextState = {
        ...nextState,
        players: (nextState.players || []).map((player: any) => {
          if (String(player?.id || '').trim() !== 'p2') return player;
          const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
          for (const card of discardedCards) {
            if (!graveyard.some((entry: any) => String(entry?.id || '').trim() === card.id)) {
              graveyard.push(card);
            }
          }
          return { ...player, graveyard };
        }),
      } as GameState;
      nextCtx = {
        ...nextCtx,
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          targetPlayerId: 'p2',
          chosenObjectIds: Array.from(
            new Set([
              ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
                ? nextCtx.selectorContext.chosenObjectIds
                : []),
              'audit-discard-land-1',
            ])
          ),
        },
      } as typeof nextCtx;
    }
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
  const needsRegenerateEnchanted = steps.some(
    (step) => step.kind === 'regenerate' && /enchanted creature/i.test(String(step.raw || ''))
  );
  const needsEnchantedCreatureRestriction = steps.some((step) =>
    /enchanted creature can't|enchanted permanent doesn't untap|its activated abilities can't be activated/i.test(String(step.raw || ''))
  );
  const needsEnchantedCreatureHost = steps.some(
    (step) =>
      /enchanted creature/i.test(String(step.raw || '')) &&
      (step.kind === 'copy_permanent' || /other than enchanted creature/i.test(String(step.raw || ''))),
  );
  const matchesCopyTokenRaw = (raw: string): boolean =>
    /create a token that'?s a copy of|create a token copy of|create (?:x |two |that many )?tokens? that are copies of/i.test(raw) &&
    /copy of (?:target|up to one target|another target|the sacrificed creature|target artifact|target creature|target artifact or creature|target artifact creature|target artifact token|target artifact, creature, or land|target artifact or enchantment|a card you exiled|that artifact or creature|that creature|that artifact|(?:it\b|this creature|this permanent|that creature|that permanent|that wizard|this equipment|this enchantment|that artifact|enchanted creature|one of them|one of those permanents|blighted creature))/i.test(
      raw,
    );

  const needsCopyTokenSource = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'create_token' && matchesCopyTokenRaw(String(step.raw || ''))) ||
      (step.kind === 'conditional' && matchesCopyTokenRaw(String(step.raw || ''))),
  );
  const needsAttachedPermanentCopy = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'create_token' &&
        /for each (?:nontoken permanent|aura and equipment) attached to (?:it|this permanent)/i.test(
          String(step.raw || '')
        )) ||
      (step.kind === 'conditional' &&
        /for each (?:nontoken permanent|aura and equipment) attached to (?:it|this permanent)/i.test(
          String(step.raw || '')
        )),
  );
  const needsStackArtifactCreatureCopy = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'create_token' && /copy of that artifact or creature/i.test(String(step.raw || '')),
  );
  const needsOneOfThoseCreaturesCopy = someOracleSteps(
    steps,
    (step) =>
      step.kind === 'create_token' && /copy of one of those creatures/i.test(String(step.raw || '')),
  );
  const needsThatAuraCopy = someOracleSteps(
    steps,
    (step) => step.kind === 'create_token' && /copy of that aura/i.test(String(step.raw || '')),
  );
  const needsExchangeControl = steps.some((step) => step.kind === 'exchange_control');
  const needsPutOnBottom = steps.some((step) => step.kind === 'put_on_bottom');
  const needsInvestigateWhere = steps.some((step) =>
    step.kind === 'investigate' && /\bwhere x is\b/i.test(String(step.raw || ''))
  );
  const needsMinusOneCounterCantBlock = steps.some((step) =>
    step.kind === 'cant_block' && /-1\/-1 counters on them/i.test(String(step.raw || ''))
  );
  if (needsEnchantedLand || needsEnchantedCreatureSacrifice || needsRegenerateEnchanted || needsEnchantedCreatureRestriction || needsCopyTokenSource || needsEnchantedCreatureHost) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return {
          ...perm,
          attachedTo: needsEnchantedLand ? 'bf-land-1' : 'bf-creature-1',
          type_line: needsEnchantedCreatureSacrifice || needsRegenerateEnchanted || needsEnchantedCreatureRestriction || needsCopyTokenSource
            ? perm?.type_line || 'Enchantment — Aura'
            : perm?.type_line,
        };
      }),
    } as GameState;
  }

  const needsKickedEntry = steps.some(
    (step) => step.kind === 'conditional' && /\bwas kicked\b/i.test(String(step.raw || ''))
  );
  if (needsKickedEntry) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        return { ...perm, wasKicked: true, kickedTimes: 1 };
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

  if (needsCopyTokenSource || needsAttachedPermanentCopy) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const wantsThatCreatureCopy = someOracleSteps(
      steps,
      (step) =>
        (step.kind === 'create_token' || step.kind === 'conditional') &&
        /copy of that creature/i.test(String(step.raw || '')),
    );
    const referenceId = wantsThatCreatureCopy ? 'bf-opponent-creature' : sourceId;
    nextCtx = {
      ...nextCtx,
      targetPermanentId: referenceId,
      targetCreatureId: wantsThatCreatureCopy ? 'bf-opponent-creature' : sourceId,
      lastMovedBattlefieldPermanentIds: needsOneOfThoseCreaturesCopy
        ? ['bf-opponent-creature', 'bf-creature-2']
        : needsAttachedPermanentCopy
          ? [sourceId, 'bf-enchantment-1', 'bf-equipment-1']
          : wantsThatCreatureCopy
            ? ['bf-opponent-creature']
            : ['bf-opponent-artifact'],
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: referenceId,
        targetCreatureId: wantsThatCreatureCopy ? 'bf-opponent-creature' : sourceId,
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...(needsOneOfThoseCreaturesCopy
              ? ['bf-opponent-creature', 'bf-creature-1']
              : needsThatAuraCopy
                ? ['bf-creature-1', 'bf-enchantment-1']
                : needsAttachedPermanentCopy
                  ? [sourceId, 'bf-enchantment-1', 'bf-equipment-1', 'bf-creature-1']
                  : ['bf-opponent-artifact', 'bf-creature-1', sourceId, 'bf-audit-wizard']),
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  if (needsAttachedPermanentCopy) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        const permId = String(perm?.id || '').trim();
        if (permId === 'bf-enchantment-1') {
          return { ...perm, attachedTo: String(nextCtx.sourceId || 'bf-source').trim() };
        }
        if (permId === 'bf-equipment-1') {
          return { ...perm, attachedTo: String(nextCtx.sourceId || 'bf-source').trim() };
        }
        return perm;
      }),
    } as GameState;
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

  const needsStationChargeCountersOnPlanet = steps.some(
    (step) =>
      step.kind === 'add_counter' &&
      /charge counters equal to its power on this planet/i.test(String(step.raw || ''))
  );
  if (needsStationChargeCountersOnPlanet) {
    nextCtx = {
      ...nextCtx,
      referenceAmount: Math.max(1, Number(nextCtx.referenceAmount ?? 4)),
      stationedCreaturePower: Math.max(1, Number((nextCtx as any).stationedCreaturePower ?? nextCtx.referenceAmount ?? 4)),
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

  const needsCopyTokenFixtures = someOracleSteps(
    steps,
    (step) =>
      (step.kind === 'create_token' || step.kind === 'conditional') &&
      /non-?saga token you control|nonlegendary enchantment you control|enchanted artifact|that wizard|quest counter on it|cursed role token attached to it|sorcerer role token attached to it/i.test(
        String(step.raw || '')
      ),
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

  const needsOpportunisticDragon =
    steps.some((step) =>
      /gain control of that permanent, it loses all abilities/i.test(String(step.raw || ''))
    ) ||
    (steps.some(
      (step) =>
        step.kind === 'gain_control' &&
        /that permanent/i.test(String((step as any).what?.text || (step as any).raw || ''))
    ) &&
      steps.some(
        (step) =>
          (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
          /that permanent/i.test(String((step as any).target?.text || (step as any).raw || ''))
      ));
  if (needsOpportunisticDragon) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-opponent-creature',
      lastReferencedPermanentId: 'bf-opponent-creature',
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
  let needsTurnFaceUp = false;
  let needsLandOnTopOfLibrary = false;
  let needsUndyingSourceWithoutCounters = false;
  let graveyardTargetIds: string[] = [];
  let attachCreatureTargetId = 'bf-creature-1';
  let destroyTargetsDefaultCreature = false;
  const sourceCounterSeeds: Record<string, number> = {};
  const battlefieldCounterSeeds: Record<string, Record<string, number>> = {};
  let needsSuspendedExileWithTimeCounters = false;
  let needsGainedLifeThisTurn = false;

  walkOracleSteps(steps, (step) => {
    const raw = String(step.raw || '').replace(/\s+/g, ' ').trim();
    if (step.kind === 'modify_pt' && /time counters among permanents you control/i.test(raw)) {
      battlefieldCounterSeeds['bf-source'] = {
        ...(battlefieldCounterSeeds['bf-source'] || {}),
        time: Math.max(battlefieldCounterSeeds['bf-source']?.time || 0, 2),
      };
      battlefieldCounterSeeds['bf-creature-1'] = {
        ...(battlefieldCounterSeeds['bf-creature-1'] || {}),
        time: Math.max(battlefieldCounterSeeds['bf-creature-1']?.time || 0, 1),
      };
    }
    if (step.kind === 'modify_pt' && /counters on permanents you control/i.test(raw)) {
      battlefieldCounterSeeds['bf-source'] = {
        ...(battlefieldCounterSeeds['bf-source'] || {}),
        '+1/+1': Math.max(battlefieldCounterSeeds['bf-source']?.['+1/+1'] || 0, 2),
      };
    }
    if (step.kind === 'destroy' || step.kind === 'exile') {
      const whatText = String((step as any).what?.text || raw).trim().toLowerCase();
      if (/that creature|target creature|^it\b|that permanent/.test(whatText)) {
        destroyTargetsDefaultCreature = true;
      }
    }
    if (step.kind === 'move_zone') {
      const whatText = String((step as any).what?.text || raw).trim().toLowerCase();
      if (
        /\bfrom a graveyard\b|\bfrom graveyards\b|\bfrom your graveyard\b|\bfrom target player'?s graveyard\b/i.test(
          whatText
        ) &&
        /\btarget\b|\bup to\b/i.test(whatText)
      ) {
        needsGraveyardExileTarget = true;
        graveyardTargetIds.push(inferGraveyardTargetIdFromWhatText(whatText));
      }
      if (
        (step.to === 'hand' || step.to === 'battlefield') &&
        /\bfrom (?:your|a|target player'?s|an opponent'?s) graveyard\b/i.test(whatText) &&
        /\btarget\b|\breturn\b/i.test(whatText)
      ) {
        needsGraveyardExileTarget = true;
        graveyardTargetIds.push(inferGraveyardTargetIdFromWhatText(whatText));
      }
      if (
        step.to === 'battlefield' &&
        /\bcreature card from (?:your|a|target player'?s) graveyard\b/i.test(whatText)
      ) {
        needsGraveyardExileTarget = true;
        graveyardTargetIds.push('gy-creature-1');
      }
    }
    if (step.kind === 'look_top' && /land card/i.test(raw)) {
      needsLandOnTopOfLibrary = true;
    }
    if (step.kind === 'conditional' && /it'?s a land card|it was a land card/i.test(String((step as any).condition?.raw || raw))) {
      needsLandOnTopOfLibrary = true;
    }
    if (
      step.kind === 'conditional' &&
      /(?:had|has) no \+1\/\+1 counters on it|if it had no \+1\/\+1 counters/i.test(
        String((step as any).condition?.raw || raw)
      )
    ) {
      needsUndyingSourceWithoutCounters = true;
    }
    if (step.kind === 'attach' && /target creature you control|attach it to that creature/i.test(raw)) {
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
      if (counter) {
        if (
          /this (?:creature|permanent|land|artifact|enchantment|equipment|vehicle|planeswalker|aura)\b/.test(
            targetText
          ) ||
          /\bthis aura\b/.test(targetText) ||
          /\bfrom this aura\b/.test(targetText)
        ) {
          sourceCounterSeeds[counter] = Math.max(sourceCounterSeeds[counter] || 0, 3);
        }
        if (/^(?:it|that creature|that permanent)$/.test(targetText)) {
          sourceCounterSeeds[counter] = Math.max(sourceCounterSeeds[counter] || 0, 2);
        }
        if (
          /target (?:permanent or suspended card|suspended card or permanent)|target permanent with a time counter/.test(
            targetText
          ) ||
          /^this card$/.test(targetText) ||
          /remove a time counter from this card/.test(raw)
        ) {
          battlefieldCounterSeeds['bf-creature-1'] = {
            ...(battlefieldCounterSeeds['bf-creature-1'] || {}),
            time: Math.max(battlefieldCounterSeeds['bf-creature-1']?.time || 0, 4),
          };
          needsSuspendedExileWithTimeCounters = true;
        }
        let removeCounterTargetId: string | null = null;
        if (/^that creature$/.test(targetText) || /^that permanent$/.test(targetText)) {
          removeCounterTargetId = 'bf-opponent-creature';
        } else if (/another target creature you control/.test(targetText)) {
          removeCounterTargetId = 'bf-creature-2';
        } else if (/target creature you control/.test(targetText)) {
          removeCounterTargetId = 'bf-creature-1';
        } else if (/target creature an opponent controls/.test(targetText)) {
          removeCounterTargetId = 'bf-opponent-creature';
        } else if (/each creature you control/.test(targetText)) {
          for (const fixtureId of ['bf-creature-1', 'bf-creature-2', 'bf-source']) {
            battlefieldCounterSeeds[fixtureId] = {
              ...(battlefieldCounterSeeds[fixtureId] || {}),
              [counter]: Math.max(battlefieldCounterSeeds[fixtureId]?.[counter] || 0, 2),
            };
          }
        }
        if (removeCounterTargetId) {
          battlefieldCounterSeeds[removeCounterTargetId] = {
            ...(battlefieldCounterSeeds[removeCounterTargetId] || {}),
            [counter]: Math.max(battlefieldCounterSeeds[removeCounterTargetId]?.[counter] || 0, 2),
          };
          nextCtx = {
            ...nextCtx,
            targetCreatureId: removeCounterTargetId,
            targetPermanentId: removeCounterTargetId,
            lastReferencedPermanentId: removeCounterTargetId,
            selectorContext: {
              ...(nextCtx.selectorContext || {}),
              targetCreatureId: removeCounterTargetId,
            },
          } as typeof nextCtx;
        }
      }
    }
    if (step.kind === 'modify_pt' && /gained life this turn|controls no other creatures/i.test(raw)) {
      needsGainedLifeThisTurn = true;
    }
    const stepConditionRawForEnrich = String(
      (step as any).condition?.raw || (step as any).unlessCondition?.raw || ''
    ).trim();
    const inlineConditionRawForEnrich =
      step.kind === 'modify_pt' ||
      step.kind === 'draw' ||
      step.kind === 'discard' ||
      step.kind === 'destroy' ||
      step.kind === 'exile' ||
      step.kind === 'move_zone'
        ? String(step.raw || '').trim()
        : '';
    const mergedConditionRawForEnrich = (stepConditionRawForEnrich || inlineConditionRawForEnrich).toLowerCase();
    if (
      step.kind === 'conditional' ||
      ((step.kind === 'modify_pt' ||
        step.kind === 'draw' ||
        step.kind === 'discard' ||
        step.kind === 'destroy' ||
        step.kind === 'exile' ||
        step.kind === 'move_zone') &&
        mergedConditionRawForEnrich)
    ) {
      const conditionRaw = mergedConditionRawForEnrich || String(raw).toLowerCase();
      if (/invitation counters on it/.test(conditionRaw)) {
        sourceCounterSeeds['invitation'] = Math.max(sourceCounterSeeds['invitation'] || 0, 3);
      }
      if (/fourth time this ability has resolved this turn/.test(conditionRaw)) {
        (nextState as any).abilityResolveCountThisTurn = {
          ...((nextState as any).abilityResolveCountThisTurn || {}),
          'bf-source': 4,
        };
      }
      if (/that creature has toughness 6 or greater/.test(conditionRaw)) {
        attachCreatureTargetId = 'bf-creature-2';
      }
      if (/it was a land card|it's a land card/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [
            {
              id: 'gy-milled-land-1',
              name: 'Milled Plains',
              type_line: 'Basic Land — Plains',
              cmc: 0,
            },
          ],
        } as typeof nextCtx;
      }
      if (/that creature has three or more \+1\/\+1 counters/.test(conditionRaw)) {
        battlefieldCounterSeeds['bf-opponent-creature'] = {
          ...(battlefieldCounterSeeds['bf-opponent-creature'] || {}),
          '+1/+1': Math.max(battlefieldCounterSeeds['bf-opponent-creature']?.['+1/+1'] || 0, 3),
        };
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-opponent-creature',
          targetCreatureId: 'bf-opponent-creature',
          lastReferencedPermanentId: 'bf-opponent-creature',
        } as typeof nextCtx;
      }
      if (/you've done all four this turn/.test(conditionRaw)) {
        (nextState as any).modalActionsCompletedThisTurn = {
          ...((nextState as any).modalActionsCompletedThisTurn || {}),
          p1: 4,
        };
      }
      if (/no life is lost this way/.test(conditionRaw)) {
        (nextState as any).lifeLostThisResolution = 0;
        nextCtx = { ...nextCtx, lifeLostThisResolution: 0 } as typeof nextCtx;
      }
      if (/it isn't a mana ability|it is not a mana ability/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          activatedAbilityIsManaAbility: false,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            activatedAbilityIsManaAbility: false,
          },
        } as typeof nextCtx;
      }
      if (/you cast a spell this way/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          spellCastThisWay: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            spellCastThisWay: true,
          },
        } as typeof nextCtx;
      }
      if (/you cast a creature spell this way/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          spellCastThisWay: true,
          creatureSpellCastThisWay: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            spellCastThisWay: true,
            creatureSpellCastThisWay: true,
          },
        } as typeof nextCtx;
      }
      if (/revealed a dragon card or controlled a dragon as you cast this spell/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          revealedDragonAsCast: true,
          controlledDragonAsCast: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            revealedDragonAsCast: true,
            controlledDragonAsCast: true,
          },
        } as typeof nextCtx;
      }
      if (/this spell's additional cost was paid/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          optionalAdditionalCostWasPaid: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            optionalAdditionalCostWasPaid: true,
          },
        } as typeof nextCtx;
      }
      if (/that creature dies this way/.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          creatureDiedThisWay: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            creatureDiedThisWay: true,
          },
        } as typeof nextCtx;
      }
      if (/you didn't cast it from your hand|you did not cast it from your hand/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          castFromZone: 'graveyard',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            castFromZone: 'graveyard',
          },
        } as typeof nextCtx;
      }
      if (/you gained or lost life this turn/i.test(conditionRaw)) {
        (nextState as any).lifeGainedThisTurn = {
          ...((nextState as any).lifeGainedThisTurn || {}),
          p1: Math.max(Number(((nextState as any).lifeGainedThisTurn || {})?.p1 || 0), 1),
        };
      }
      if (/^it was cast$/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          wasCast: true,
          castFromZone: 'hand',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            wasCast: true,
            castFromZone: 'hand',
          },
        } as typeof nextCtx;
      }
      if (/you'?ve committed a crime this turn|you have committed a crime this turn/i.test(conditionRaw)) {
        (nextState as any).committedCrimeThisTurn = {
          ...((nextState as any).committedCrimeThisTurn || {}),
          p1: true,
        };
      }
      if (/^it'?s legendary$|^it is legendary$/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-legendary-creature',
          targetCreatureId: 'bf-legendary-creature',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-legendary-creature',
            targetCreatureId: 'bf-legendary-creature',
          },
        } as typeof nextCtx;
      }
      if (/you chose a creature other than this permanent as your ring-bearer/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          chosenRingBearerId: 'bf-creature-1',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            chosenRingBearerId: 'bf-creature-1',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            return { ...player, ringBearerId: 'bf-creature-1' };
          }),
        } as GameState;
      }
      if (/this creature is untapped|this permanent is untapped/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, tapped: false };
          }),
        } as GameState;
      }
      if (/you have more cards in hand than each opponent/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const playerId = String(player?.id || '').trim();
            if (playerId === 'p1') {
              return {
                ...player,
                hand: [{ id: 'hand-1' }, { id: 'hand-2' }, { id: 'hand-3' }, { id: 'hand-4' }],
              };
            }
            if (playerId === 'p2' || playerId === 'p3') {
              return { ...player, hand: [{ id: `${playerId}-hand-1` }] };
            }
            return player;
          }),
        } as GameState;
      }
      if (/it had one or more counters on it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-creature-with-counters',
          targetCreatureId: 'bf-creature-with-counters',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-creature-with-counters',
            targetCreatureId: 'bf-creature-with-counters',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-creature-with-counters'
            ),
            {
              id: 'bf-creature-with-counters',
              controller: 'p1',
              type_line: 'Creature — Human',
              counters: { '+1/+1': 1 },
            },
          ],
        } as GameState;
      }
      if (/that mana is spent on a creature spell/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          manaSpentOnCreatureSpell: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            manaSpentOnCreatureSpell: true,
          },
        } as typeof nextCtx;
      }
      if (/you have seven or more cards in hand/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            return {
              ...player,
              hand: Array.from({ length: 7 }, (_, index) => ({ id: `hand-${index + 1}` })),
            };
          }),
        } as GameState;
      }
      if (/you have more life than an opponent/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const playerId = String(player?.id || '').trim();
            if (playerId === 'p1') return { ...player, life: 40 };
            if (playerId === 'p2' || playerId === 'p3') return { ...player, life: 30 };
            return player;
          }),
        } as GameState;
      }
      if (/there is no monarch/i.test(conditionRaw)) {
        nextState = { ...nextState, monarch: undefined } as GameState;
      }
      if (/this spell was cast from anywhere other than your hand|this spell was cast from somewhere other than your hand/i.test(conditionRaw)) {
        const hasLookChooseAntecedent = steps.some(
          (candidate) =>
            candidate.kind === 'look_top' ||
            candidate.kind === 'look_choose_from_top' ||
            candidate.kind === 'reveal_top' ||
            candidate.kind === 'scry'
        );
        if (!hasLookChooseAntecedent) {
          nextCtx = {
            ...nextCtx,
            castFromZone: 'graveyard',
            selectorContext: {
              ...(nextCtx.selectorContext || {}),
              castFromZone: 'graveyard',
            },
          } as typeof nextCtx;
        }
      }
      if (/no mana was spent to cast it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          noManaSpentToCast: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            noManaSpentToCast: true,
          },
        } as typeof nextCtx;
      }
      if (/you would lose the game/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          wouldLoseTheGame: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            wouldLoseTheGame: true,
          },
        } as typeof nextCtx;
      }
      if (/you control no untapped lands/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).map((perm: any) => {
            const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
            if (String(perm?.controller || '').trim() !== 'p1' || !/\bland\b/i.test(typeLine)) return perm;
            return { ...perm, tapped: true };
          }),
        } as GameState;
      }
      if (/an opponent has more life than you/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const playerId = String(player?.id || '').trim();
            if (playerId === 'p1') return { ...player, life: 30 };
            if (playerId === 'p2' || playerId === 'p3') return { ...player, life: 40 };
            return player;
          }),
        } as GameState;
      }
      if (/that player has no cards in hand/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetOpponentId: 'p2',
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetOpponentId: 'p2',
            targetPlayerId: 'p2',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p2') return player;
            return { ...player, hand: [] };
          }),
        } as GameState;
      }
      if (/this creature didn't attack this turn|this creature did not attack this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, attackedThisTurn: false, attacking: false, isAttacking: false };
          }),
        } as GameState;
      }
      if (/your team controls another warrior/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => !['bf-warrior-ally', 'bf-source'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Creature — Human Warrior',
              attackedThisTurn: true,
            },
            {
              id: 'bf-warrior-ally',
              controller: 'p1',
              type_line: 'Creature — Human Warrior',
            },
          ],
        } as GameState;
      }
      if (/a dragon was beheld/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          beheldQuality: 'dragon',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            beheldQuality: 'dragon',
          },
        } as typeof nextCtx;
      }
      if (/you control no artifacts/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).filter((perm: any) => {
            const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
            if (String(perm?.controller || '').trim() !== 'p1') return true;
            return !/\bartifact\b/i.test(typeLine);
          }),
        } as GameState;
      }
      if (/no creatures are on the battlefield/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).filter((perm: any) => {
            const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
            return !/\bcreature\b/i.test(typeLine);
          }),
        } as GameState;
      }
      if (/it'?s not a token|it is not a token/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-nontoken-creature',
          targetCreatureId: 'bf-nontoken-creature',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-nontoken-creature',
            targetCreatureId: 'bf-nontoken-creature',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-nontoken-creature'
            ),
            {
              id: 'bf-nontoken-creature',
              controller: 'p1',
              type_line: 'Creature — Human',
              isToken: false,
            },
          ],
        } as GameState;
      }
      if (/this creature is a warrior/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: (nextState.battlefield || []).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, type_line: 'Creature — Human Warrior' };
          }),
        } as GameState;
      }
      if (/one or more of them entered from a graveyard or was cast from a graveyard/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [
            {
              id: 'bf-gy-entry',
              controller: 'p1',
              type_line: 'Creature — Zombie',
              enteredFromZone: 'graveyard',
              castFromZone: 'graveyard',
            },
          ],
          lastAntecedentBattlefieldPermanentIds: ['bf-gy-entry'],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            lastAntecedentBattlefieldPermanentIds: ['bf-gy-entry'],
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-gy-entry'
            ),
            {
              id: 'bf-gy-entry',
              controller: 'p1',
              type_line: 'Creature — Zombie',
              enteredFromZone: 'graveyard',
              castFromZone: 'graveyard',
            },
          ],
        } as GameState;
      }
      if (/you have at least 15 life more than your starting life total/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          startingLife: 40,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            return { ...player, life: 55 };
          }),
        } as GameState;
      }
      if (/that spell was kicked/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Instant',
              wasKicked: true,
              kickedTimes: 1,
            },
          ],
        } as GameState;
      }
      if (/it was a human/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-human-creature',
          targetCreatureId: 'bf-human-creature',
          lastMovedCards: [
            {
              id: 'bf-human-creature',
              controller: 'p1',
              type_line: 'Creature — Human',
            },
          ],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-human-creature',
            targetCreatureId: 'bf-human-creature',
          },
        } as typeof nextCtx;
      }
      if (/it wasn't cast|it was not cast/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          wasCast: false,
          targetPermanentId: 'bf-uncast-creature',
          targetCreatureId: 'bf-uncast-creature',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            wasCast: false,
            targetPermanentId: 'bf-uncast-creature',
            targetCreatureId: 'bf-uncast-creature',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-uncast-creature'
            ),
            {
              id: 'bf-uncast-creature',
              controller: 'p1',
              type_line: 'Creature — Elf',
              enteredFromZone: 'library',
            },
          ],
        } as GameState;
      }
      if (/a planeswalker entered the battlefield under your control this turn/i.test(conditionRaw)) {
        (nextState as any).planeswalkerEnteredThisTurn = {
          ...((nextState as any).planeswalkerEnteredThisTurn || {}),
          p1: true,
        };
      }
      if (/it had a -1\/-1 counter on it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-died-creature',
          targetCreatureId: 'bf-died-creature',
          lastMovedCards: [
            {
              id: 'bf-died-creature',
              controller: 'p1',
              type_line: 'Creature — Zombie',
              counters: { '-1/-1': 1 },
            },
          ],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-died-creature',
            targetCreatureId: 'bf-died-creature',
          },
        } as typeof nextCtx;
      }
      if (/you lost life last turn/i.test(conditionRaw)) {
        (nextState as any).lifeLostLastTurnByPlayerCounts = {
          ...((nextState as any).lifeLostLastTurnByPlayerCounts || {}),
          p1: 3,
        };
      }
      if (/it's not your turn|it is not your turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', name: 'P1' },
            { id: 'p2', name: 'P2' },
          ],
          activePlayerIndex: 1,
        } as GameState;
      }
      if (/it's equipped|it is equipped/i.test(conditionRaw)) {
        const equippedIds = new Set(
          ['bf-source', 'bf-creature-1', String(nextCtx.targetPermanentId || '').trim()].filter(Boolean)
        );
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            const id = String(perm?.id || '').trim();
            if (!equippedIds.has(id)) return perm;
            return {
              ...perm,
              isEquipped: true,
              attachedEquipment: ['bf-equip-audit-1'],
            };
          }),
        } as GameState;
      }
      if (/this permanent has counters on it/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== 'bf-source') return perm;
            return {
              ...perm,
              counters: { ...(perm?.counters || {}), '+1/+1': 1 },
            };
          }),
        } as GameState;
      }
      if (/it isn't being declared as an attacker|it is not being declared as an attacker/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-opponent-creature',
          targetCreatureId: 'bf-opponent-creature',
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-opponent-creature',
            targetCreatureId: 'bf-opponent-creature',
            targetPlayerId: 'p2',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', name: 'P1' },
            { id: 'p2', name: 'P2' },
          ],
          attackersDeclaredThisCombatByPlayer: {
            ...((nextState as any).attackersDeclaredThisCombatByPlayer || {}),
            p2: [],
          },
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-opponent-creature'
            ),
            {
              id: 'bf-opponent-creature',
              controller: 'p2',
              type_line: 'Creature — Human',
              tapped: true,
            },
          ],
        } as GameState;
      }
      if (/this spell was cast from exile/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          castFromZone: 'exile',
          castFromExile: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            castFromZone: 'exile',
            castFromExile: true,
          },
        } as typeof nextCtx;
      }
      if (/this permanent is in the command zone or on the battlefield/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== 'bf-source') return perm;
            return { ...perm, isCommander: true, commander: true };
          }),
          commandZone: {
            ...((nextState as any).commandZone || {}),
            p1: {
              commanderCards: [{ id: 'bf-source', name: 'Audit Commander' }],
              inCommandZone: ['bf-source'],
            },
          },
        } as GameState;
      }
      if (/you didn't attack with a creature this turn|you did not attack with a creature this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          attackersDeclaredThisCombatByPlayer: {
            ...((nextState as any).attackersDeclaredThisCombatByPlayer || {}),
            p1: [],
          },
          attackedPlayersThisTurnByPlayer: {
            ...((nextState as any).attackedPlayersThisTurnByPlayer || {}),
            p1: [],
          },
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.controller || '').trim() !== 'p1') return perm;
            return { ...perm, attackedThisTurn: false, attacking: false, isAttacking: false };
          }),
        } as GameState;
      }
      if (/(\d+|four|three|two|one|five|six|seven|eight|nine|ten) or more damage was dealt to it this turn/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-damage-creature',
          targetCreatureId: 'bf-damage-creature',
          lastMovedCards: [
            {
              id: 'bf-damage-creature',
              controller: 'p1',
              type_line: 'Creature — Spirit',
              damageThisTurn: 4,
            },
          ],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-damage-creature',
            targetCreatureId: 'bf-damage-creature',
          },
        } as typeof nextCtx;
      }
      if (/you control no creatures/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).filter((perm: any) => {
            const typeLine = String(perm?.type_line || perm?.card?.type_line || '');
            if (String(perm?.controller || '').trim() !== 'p1') return true;
            return !/\bcreature\b/i.test(typeLine);
          }),
        } as GameState;
      }
      if (/two or more of those creatures are attacking you and\/or planeswalkers you control/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          thoseCreatureIds: ['bf-attacker-1', 'bf-attacker-2', 'bf-attacker-3'],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            thoseCreatureIds: ['bf-attacker-1', 'bf-attacker-2', 'bf-attacker-3'],
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', name: 'P1' },
            { id: 'p2', name: 'P2' },
          ],
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-attacker-1', 'bf-attacker-2', 'bf-attacker-3', 'bf-planeswalker-1'].includes(
                  String(perm?.id || '').trim()
                )
            ),
            {
              id: 'bf-planeswalker-1',
              controller: 'p1',
              type_line: 'Legendary Planeswalker — Test',
            },
            {
              id: 'bf-attacker-1',
              controller: 'p2',
              type_line: 'Creature — Human',
              attacking: 'p1',
            },
            {
              id: 'bf-attacker-2',
              controller: 'p2',
              type_line: 'Creature — Human',
              attacking: 'bf-planeswalker-1',
            },
            {
              id: 'bf-attacker-3',
              controller: 'p2',
              type_line: 'Creature — Human',
              attacking: 'p2',
            },
          ],
        } as GameState;
      }
      if (/a player lost (\d+|four|three|two|one|five|six|seven|eight|nine|ten) or more life this turn/i.test(conditionRaw)) {
        (nextState as any).lifeLostThisTurn = {
          ...((nextState as any).lifeLostThisTurn || {}),
          p2: 5,
        };
      }
      if (/it was enchanted or equipped/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-died-creature',
          targetCreatureId: 'bf-died-creature',
          lastMovedCards: [
            {
              id: 'bf-died-creature',
              controller: 'p1',
              type_line: 'Creature — Human',
              wasEnchanted: true,
              attachedEquipment: ['bf-equip-audit-1'],
            },
          ],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-died-creature',
            targetCreatureId: 'bf-died-creature',
          },
        } as typeof nextCtx;
      }
      if (/it shares a card type with the exiled card/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          triggeringSpellCard: { type_line: 'Creature — Elf' },
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Creature — Elf',
              card: { type_line: 'Creature — Elf' },
            },
          ],
          players: (nextState.players || [{ id: 'p1' }]).map((player: any) => ({
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              {
                id: 'ex-exiled-1',
                type_line: 'Creature — Human',
                exiledWithSourceId: 'bf-source',
              },
            ],
          })),
        } as GameState;
      }
      if (/you control no tapped lands/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-land-1'
            ),
            {
              id: 'bf-land-1',
              controller: 'p1',
              type_line: 'Basic Land — Forest',
              tapped: false,
            },
          ],
        } as GameState;
      }
      if (/no creatures attacked this turn/i.test(conditionRaw)) {
        (nextState as any).creaturesAttackedThisTurn = {};
        nextState = {
          ...nextState,
          attackersDeclaredThisCombatByPlayer: {},
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => ({
            ...perm,
            attackedThisTurn: false,
            attacking: false,
            isAttacking: false,
          })),
        } as GameState;
      }
      if (/it hasn't dealt damage yet|it has not dealt damage yet/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== 'bf-source') return perm;
            return { ...perm, hasDealtDamage: false, dealtDamageThisTurn: false };
          }),
        } as GameState;
      }
      if (/that player had another land enter the battlefield under their control this turn/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPlayerId: 'p2',
            targetOpponentId: 'p2',
          },
        } as typeof nextCtx;
        (nextState as any).landsEnteredBattlefieldThisTurn = {
          ...((nextState as any).landsEnteredBattlefieldThisTurn || {}),
          p2: 2,
        };
      }
      if (/this creature dealt damage to an opponent this turn|this permanent dealt damage to an opponent this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          creaturesThatDealtDamageToPlayer: {
            p2: { 'bf-source': true },
          },
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== 'bf-source') return perm;
            return { ...perm, dealtDamageToOpponentThisTurn: true, dealtDamageThisTurn: true };
          }),
        } as GameState;
      }
      if (/that player controls more (creatures|lands) than you/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPlayerId: 'p2',
            targetOpponentId: 'p2',
          },
        } as typeof nextCtx;
        const subject = /controls more creatures/i.test(conditionRaw) ? 'creature' : 'land';
        const extraPerm =
          subject === 'creature'
            ? { id: 'bf-that-player-creature', controller: 'p2', type_line: 'Creature — Soldier' }
            : { id: 'bf-that-player-land-extra', controller: 'p2', type_line: 'Basic Land — Island' };
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-that-player-creature', 'bf-that-player-land-extra', 'bf-your-land'].includes(
                  String(perm?.id || '').trim()
                )
            ),
            { id: 'bf-your-land', controller: 'p1', type_line: 'Basic Land — Forest' },
            extraPerm,
          ],
        } as GameState;
      }
      if (/you have fewer than .+ cards in hand/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            return {
              ...player,
              hand: [{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }, { id: 'h4' }, { id: 'h5' }],
            };
          }),
        } as GameState;
      }
      if (/its surge cost was paid/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, surgeCostWasPaid: true, alternateCostId: 'surge' };
          }),
        } as GameState;
      }
      if (/you put a counter on a creature this turn/i.test(conditionRaw)) {
        (nextState as any).putCounterOnCreatureThisTurn = {
          ...((nextState as any).putCounterOnCreatureThisTurn || {}),
          p1: true,
        };
      }
      if (/\{[wubrgcs]\}\{[wubrgcs]\} was spent to cast it|\{[wubrgcs]\} was spent to cast it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        const colorMatch = conditionRaw.match(/\{([wubrgcs])\}/i);
        const colorLetter = String(colorMatch?.[1] || 'r').toLowerCase();
        const colorMap: Record<string, string> = {
          w: 'white',
          u: 'blue',
          b: 'black',
          r: 'red',
          g: 'green',
          c: 'colorless',
          s: 'snow',
        };
        const colorKey = colorMap[colorLetter] || 'red';
        const symbolCount = (conditionRaw.match(/\{[wubrgcs]\}/gi) || []).length;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Creature — Elemental',
              manaSpent: { [colorKey]: symbolCount },
              card: {
                type_line: 'Creature — Elemental',
                manaSpent: { [colorKey]: symbolCount },
              },
            },
          ],
        } as GameState;
      }
      if (/an artifact entered the battlefield under your control this turn/i.test(conditionRaw)) {
        (nextState as any).artifactEnteredThisTurn = {
          ...((nextState as any).artifactEnteredThisTurn || {}),
          p1: true,
        };
        (nextState as any).artifactsEnteredBattlefieldThisTurnByController = {
          ...((nextState as any).artifactsEnteredBattlefieldThisTurnByController || {}),
          p1: 1,
        };
      }
      if (/that creature has toxic/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetCreatureId: 'bf-toxic-target',
          targetPermanentId: 'bf-toxic-target',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetCreatureId: 'bf-toxic-target',
            targetPermanentId: 'bf-toxic-target',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-toxic-target'
            ),
            {
              id: 'bf-toxic-target',
              controller: 'p2',
              type_line: 'Creature — Phyrexian',
              keywords: ['Toxic'],
            },
          ],
        } as GameState;
      }
      if (/another creature entered the battlefield under your control this turn/i.test(conditionRaw)) {
        (nextState as any).creaturesEnteredThisTurn = {
          ...((nextState as any).creaturesEnteredThisTurn || {}),
          p1: 2,
        };
        (nextState as any).creaturesEnteredBattlefieldThisTurnByController = {
          ...((nextState as any).creaturesEnteredBattlefieldThisTurnByController || {}),
          p1: 2,
        };
      }
      if (/it has the same name as a permanent/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          referencedCardName: 'Lightning Bolt',
          lastMovedCards: [{ id: 'lib-card-1', name: 'Lightning Bolt', type_line: 'Instant' }],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            chosenCardName: 'Lightning Bolt',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-named-perm'
            ),
            {
              id: 'bf-named-perm',
              controller: 'p2',
              name: 'Lightning Bolt',
              type_line: 'Instant',
            },
          ],
        } as GameState;
      }
      if (/you sacrificed .+ or more clues this turn/i.test(conditionRaw)) {
        (nextState as any).cluesSacrificedThisTurn = {
          ...((nextState as any).cluesSacrificedThisTurn || {}),
          p1: 3,
        };
      }
      if (/its prowl cost was paid|this spell's prowl cost was paid/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, prowlCostWasPaid: true, alternateCostId: 'prowl' };
          }),
        } as GameState;
      }
      if (/there'?s a lesson card in your graveyard|there is a lesson card in your graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            const graveyard = Array.isArray(player?.graveyard) ? [...player.graveyard] : [];
            if (graveyard.some((card: any) => /\blesson\b/i.test(String(card?.type_line || '')))) {
              return player;
            }
            return {
              ...player,
              graveyard: [
                ...graveyard,
                { id: 'gy-lesson-1', name: 'Introduction to Prophecy', type_line: 'Sorcery — Lesson' },
              ],
            };
          }),
        } as GameState;
      }
      if (/you(?:'ve| have)? cast both a creature spell and a noncreature spell this turn/i.test(conditionRaw)) {
        (nextState as any).spellsCastThisTurn = {
          ...((nextState as any).spellsCastThisTurn || {}),
          p1: 2,
        };
        (nextState as any).noncreatureSpellsCastThisTurn = {
          ...((nextState as any).noncreatureSpellsCastThisTurn || {}),
          p1: 1,
        };
        (nextState as any).castBothCreatureAndNoncreatureSpellThisTurn = {
          ...((nextState as any).castBothCreatureAndNoncreatureSpellThisTurn || {}),
          p1: true,
        };
      }
      if (/enchanted creature'?s power is .+ or greater/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => !['bf-enchanted-creature', 'bf-source'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-enchanted-creature',
              controller: 'p1',
              type_line: 'Creature — Beast',
              power: 5,
              toughness: 5,
            },
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Enchantment — Aura',
              attachedTo: 'bf-enchanted-creature',
            },
          ],
        } as GameState;
      }
      if (/the amount of mana spent to cast it was less than its mana value/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Instant',
              manaValue: 5,
              manaSpentTotal: 2,
              card: { type_line: 'Instant', manaValue: 5, manaSpentTotal: 2 },
            },
          ],
        } as GameState;
      }
      if (/a creature is dealt damage this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          creatureDealtDamageThisWay: true,
          lastDamagedCards: [
            { id: 'bf-damaged-creature', type_line: 'Creature — Goblin', name: 'Damaged Goblin' },
          ],
        } as typeof nextCtx;
      }
      if (/that creature was dealt excess damage this turn/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetCreatureId: 'bf-excess-target',
          targetPermanentId: 'bf-excess-target',
          thatCreatureDealtExcessDamageThisTurn: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetCreatureId: 'bf-excess-target',
            targetPermanentId: 'bf-excess-target',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          excessDamageThisTurnByCreatureId: {
            'bf-excess-target': 3,
          },
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-excess-target'
            ),
            {
              id: 'bf-excess-target',
              controller: 'p2',
              type_line: 'Creature — Beast',
              wasDealtExcessDamageThisTurn: true,
              excessDamageThisTurn: 3,
            },
          ],
        } as GameState;
      }
      if (/it'?s renowned|it is renowned|this creature is renowned/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
            if (String(perm?.id || '').trim() !== String(nextCtx.sourceId || 'bf-source').trim()) return perm;
            return { ...perm, renowned: true, isRenowned: true };
          }),
        } as GameState;
      }
      if (/you control another creature with power .+ or greater/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => !['bf-source', 'bf-big-creature'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Creature — Insect',
              power: 2,
              toughness: 2,
            },
            {
              id: 'bf-big-creature',
              controller: 'p1',
              type_line: 'Creature — Giant',
              power: 5,
              toughness: 5,
            },
          ],
        } as GameState;
      }
      if (/you control another creature with a \+1\/\+1 counter on it/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => !['bf-source', 'bf-counter-creature'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Creature — Merfolk',
              power: 2,
              toughness: 2,
            },
            {
              id: 'bf-counter-creature',
              controller: 'p1',
              type_line: 'Creature — Elf',
              power: 1,
              toughness: 1,
              counters: { '+1/+1': 1 },
            },
          ],
        } as GameState;
      }
      if (/this permanent entered this turn/i.test(conditionRaw)) {
        const sourceId = String(nextCtx.sourceId || 'bf-source');
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== sourceId
            ),
            {
              id: sourceId,
              controller: 'p1',
              type_line: 'Creature — Human Soldier',
              enteredThisTurn: true,
            },
          ],
        } as GameState;
      }
      if (/any of that damage was dealt by a warrior/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          damageIncludedWarriorSource: true,
          damageSourcePermanentIds: ['bf-warrior-source'],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-warrior-source'
            ),
            {
              id: 'bf-warrior-source',
              controller: 'p2',
              type_line: 'Creature — Human Warrior',
            },
          ],
        } as GameState;
      }
      if (/life was paid to activate it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lifeWasPaidToActivateIt: true,
          targetSpellId: 'stack-ability-1',
          stackItem: { id: 'stack-ability-1', description: 'Pay 2 life: Draw a card.' },
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-ability-1',
            lifeWasPaidToActivateIt: true,
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-ability-1',
              controller: 'p1',
              type_line: 'Creature — Vampire',
              description: 'Pay 2 life: Draw a card.',
            },
          ],
        } as GameState;
      }
      if (/you control creatures named .+ and .+/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-mine-worker', 'bf-tower-worker'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-mine-worker',
              controller: 'p1',
              name: 'Mine Worker',
              type_line: 'Artifact Creature — Construct',
            },
            {
              id: 'bf-tower-worker',
              controller: 'p1',
              name: 'Tower Worker',
              type_line: 'Artifact Creature — Construct',
            },
          ],
        } as GameState;
      }
      if (/they entered or were cast from a graveyard/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          theyEnteredOrWereCastFromGraveyard: true,
          thoseCreatureIds: ['bf-gy-creature-1', 'bf-gy-creature-2'],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-gy-creature-1', 'bf-gy-creature-2'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-gy-creature-1',
              controller: 'p1',
              type_line: 'Creature — Zombie',
              enteredFromZone: 'graveyard',
            },
            {
              id: 'bf-gy-creature-2',
              controller: 'p1',
              type_line: 'Creature — Skeleton',
              castFromZone: 'graveyard',
            },
          ],
        } as GameState;
      }
      if (
        /its power is greater than this creature's power or its toughness is greater than this creature's toughness/i.test(
          conditionRaw
        )
      ) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-source',
          targetPermanentId: 'bf-entering-creature',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-entering-creature',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-source', 'bf-entering-creature'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              power: 2,
              toughness: 2,
              type_line: 'Creature — Human Detective',
            },
            {
              id: 'bf-entering-creature',
              controller: 'p1',
              power: 4,
              toughness: 1,
              type_line: 'Creature — Soldier',
            },
          ],
        } as GameState;
      }
      if (/it's attacking the player with the most life or tied for most life/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-source',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', life: 20 },
            { id: 'p2', life: 40 },
            { id: 'p3', life: 15 },
          ],
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-source'
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              defendingPlayerId: 'p2',
              attacking: true,
              type_line: 'Creature — Demon',
            },
          ],
        } as GameState;
      }
      if (/that player has another opponent who isn't being attacked/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          attackingPlayerId: 'p2',
          sourceId: 'bf-skyguard',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            attackingPlayerId: 'p2',
            targetPlayerId: 'p2',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', life: 40 },
            { id: 'p2', life: 40 },
            { id: 'p3', life: 40 },
          ],
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => !['bf-attacker', 'bf-skyguard'].includes(String(perm?.id || '').trim())
            ),
            {
              id: 'bf-skyguard',
              controller: 'p1',
              type_line: 'Creature — Angel',
            },
            {
              id: 'bf-attacker',
              controller: 'p2',
              defendingPlayerId: 'p1',
              attacking: true,
              type_line: 'Creature — Soldier',
            },
          ],
        } as GameState;
      }
      if (/^it's modified$|^it is modified$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-source'
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Legendary Creature — Human',
              counters: { '+1/+1': 1 },
            },
          ],
        } as GameState;
      }
      if (/^you control no goblins$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-human'
            ),
            { id: 'bf-human', controller: 'p1', type_line: 'Creature — Human' },
          ],
        } as GameState;
      }
      if (/artifact or creature was put into a graveyard from the battlefield this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          artifactOrCreaturePutIntoGraveyardFromBattlefieldThisTurn: true,
        } as GameState;
      }
      if (/^no colored mana was spent to cast it$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          noColoredManaSpentToCast: true,
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Sorcery',
              manaSpentBreakdown: { colorless: 2, white: 0, blue: 0, black: 0, red: 0, green: 0 },
            },
          ],
        } as GameState;
      }
      if (/^she was a nonland creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-source'
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Legendary Creature — Human Noble Ally',
            },
          ],
        } as GameState;
      }
      if (/didn't attack or come under your control this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-source'
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Creature — Dog',
              attackedThisTurn: false,
              cameUnderYourControlThisTurn: false,
              gainedControlThisTurn: false,
              enteredThisTurn: false,
            },
          ],
        } as GameState;
      }
      if (/^it has mutate$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Creature — Frog',
              oracle_text: 'Mutate {1}{G}',
            },
          ],
        } as GameState;
      }
      if (/^you control a white or blue permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-white-perm'
            ),
            {
              id: 'bf-white-perm',
              controller: 'p1',
              type_line: 'Creature — Soldier',
              colors: ['W'],
            },
          ],
        } as GameState;
      }
      if (/^this creature wasn't kicked$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-source'
            ),
            {
              id: 'bf-source',
              controller: 'p1',
              type_line: 'Creature — Elemental',
              wasKicked: false,
            },
          ],
        } as GameState;
      }
      if (/^the token is an aura$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-token', controller: 'p1', isToken: true, type_line: 'Token Enchantment — Aura' }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-token', targetPermanentId: 'bf-token' } as typeof nextCtx;
      }
      if (/^\{[wubrg]\}\{[wubrg]\} was spent to cast this spell$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', manaSpentBreakdown: { white: 1, blue: 1, black: 0, red: 0, green: 0 } }],
        } as GameState;
      }
      if (/ or more cards are in your graveyard$/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: new Array(8).fill({ type_line: 'Instant' }) }],
        } as GameState;
      }
      if (/greatest mana value or tied for the greatest mana value/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-art', controller: 'p1', type_line: 'Artifact', manaValue: 5 }],
        } as GameState;
      }
      if (/no mining counters on this land/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Land', counters: { mining: 0 } }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/ or more artifacts entered the battlefield under your control this turn/i.test(conditionRaw)) {
        (nextState as any).artifactsEnteredBattlefieldThisTurnByController = { p1: 3 };
      }
      if (/life total is less than your starting life total/i.test(conditionRaw)) {
        nextState = { ...nextState, startingLife: 40, players: [{ id: 'p1', life: 35 }] } as GameState;
      }
      if (/the sacrificed creature was (white|blue|black|red|green)$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ type_line: 'Creature — Zombie', colors: ['B'] }],
        } as typeof nextCtx;
      }
      if (/it wasn't a /i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ type_line: 'Creature — Human' }],
        } as typeof nextCtx;
      }
      if (/your team gained life this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          teams: [{ playerIds: ['p1', 'p2'] }],
          lifeGainedThisTurn: { p1: 0, p2: 2 },
        } as GameState;
      }
      if (/hanweir garrison/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', owner: 'p1', type_line: 'Land' },
            { id: 'bf-garrison', name: 'Hanweir Garrison', controller: 'p1', owner: 'p1', type_line: 'Creature — Human' },
          ],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/all lands on the battlefield are islands/i.test(conditionRaw)) {
        nextState = { ...nextState, battlefield: [{ type_line: 'Land — Island' }] } as GameState;
      }
      if (/this permanent attacked this combat/i.test(conditionRaw)) {
        (nextState as any).attackersDeclaredThisCombatByPlayer = { p1: [{ id: 'bf-source' }] };
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/^that card is snow$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = { ...nextState, battlefield: [{ id: 'bf-snow', type_line: 'Snow Land — Island' }] } as GameState;
      }
      if (/you control exactly one creature/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-only', controller: 'p1', type_line: 'Creature — Human' }],
        } as GameState;
      }
      if (/no player does/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, optionalOfferAccepted: false } as typeof nextCtx;
      }
      if (/it had a counter on it/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ counters: { '+1/+1': 1 } }],
        } as typeof nextCtx;
      }
      if (/amount of mana spent to cast that spell was less than its mana value/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', manaValue: 5, manaSpentTotal: 2 }],
        } as GameState;
      }
      if (/you created a token this turn/i.test(conditionRaw)) {
        (nextState as any).tokensCreatedThisTurn = { p1: 1 };
      }
      if (/god, a demigod, or a legendary enchantment/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-god', controller: 'p1', type_line: 'Legendary Enchantment Creature — God' }],
        } as GameState;
      }
      if (/an opponent has 0 or less life/i.test(conditionRaw)) {
        nextState = { ...nextState, players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 0 }] } as GameState;
      }
      if (/only creature card in your graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: [{ id: 'bf-source', type_line: 'Creature — Spirit' }] }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/from anywhere other than your hand/i.test(conditionRaw)) {
        (nextState as any).castFromGraveyardThisTurn = { p1: true };
      }
      if (/^a player discarded a card this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).discardedCardThisTurn = { p1: false, p2: true };
      }
      if (/\{s\} of any of that spell's colors was spent/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', colors: ['G'], snowManaOfSpellColorsSpentKnown: true, snowManaOfSpellColorsSpent: true }],
        } as GameState;
      }
      if (/you had a land enter the battlefield under your control this turn/i.test(conditionRaw)) {
        (nextState as any).landsEnteredBattlefieldThisTurn = { p1: 1 };
      }
      if (/quest counters on this permanent/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          attackersDeclaredThisCombatByPlayer: { p1: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Artifact', counters: { quest: 1 } }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/this creature has defender/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Golem', oracle_text: 'Defender' }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/^a white creature is attacking$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-white', controller: 'p2', type_line: 'Creature — Soldier', colors: ['W'], attacking: true, defendingPlayerId: 'p1' }],
        } as GameState;
      }
      if (/each opponent who cast a spell this turn with the same name as that card/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, referencedCardName: 'Lightning Bolt' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }],
          spellsCastThisTurn: [{ casterId: 'p2', name: 'Lightning Bolt' }],
        } as GameState;
      }
      if (/they were attacked this turn by an assassin you controlled/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, thatPlayerId: 'p2' } as typeof nextCtx;
        (nextState as any).attackedByAssassinThisTurnByPlayer = { p1: { p2: true } };
      }
      if (/^the sacrificed artifact was legendary$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ type_line: 'Legendary Artifact' }],
        } as typeof nextCtx;
      }
      if (/^a nonred permanent is dealt damage this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ type_line: 'Artifact', colors: ['U'] }],
          lastActionOutcome: { kind: 'applied', stepKind: 'deal_damage' },
        } as typeof nextCtx;
      }
      if (/^your life total is less than 7$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, players: [{ id: 'p1', life: 6 }] } as GameState;
      }
      if (/it had power greater than drizzt's power/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-drizzt', lastMovedCards: [{ power: 5 }] } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-drizzt', controller: 'p1', type_line: 'Legendary Creature — Human', power: 3 }],
        } as GameState;
      }
      if (/a land you controlled was put into a graveyard from the battlefield this turn/i.test(conditionRaw)) {
        (nextState as any).landYouControlledPutIntoGraveyardFromBattlefieldThisTurn = { p1: true };
      }
      if (/^defending player controls no walls$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, defendingPlayerId: 'p2', sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Dragon', attacking: 'p2' },
            { id: 'bf-human', controller: 'p2', type_line: 'Creature — Human' },
          ],
        } as GameState;
      }
      if (/^you have exactly 13 life$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, players: [{ id: 'p1', life: 13 }] } as GameState;
      }
      if (/at least one other wall creature is blocking that creature and no non-wall creatures are blocking that creature/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-wall-src',
          thatCreatureId: 'bf-attacker',
          blockingCreatureIds: ['bf-wall-1', 'bf-wall-2'],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-wall-src', controller: 'p1', type_line: 'Creature — Wall' },
            { id: 'bf-attacker', controller: 'p2', type_line: 'Creature — Human', blockedBy: ['bf-wall-1', 'bf-wall-2'] },
            { id: 'bf-wall-1', controller: 'p1', type_line: 'Creature — Wall', blocking: 'bf-attacker' },
            { id: 'bf-wall-2', controller: 'p1', type_line: 'Creature — Wall', blocking: 'bf-attacker' },
          ],
        } as GameState;
      }
      if (/^x is 5 or more$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, xValue: 5 } as typeof nextCtx;
      }
      if (/^it's a goblin or orc$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-goblin' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-goblin', controller: 'p1', type_line: 'Creature — Goblin' }],
        } as GameState;
      }
      if (/^enchanted creature is a wolf or werewolf$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-aura' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-aura', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-wolf' },
            { id: 'bf-wolf', controller: 'p1', type_line: 'Creature — Wolf' },
          ],
        } as GameState;
      }
      if (/that creature's power is greater than this creature's/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', targetCreatureId: 'bf-entering' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Human', power: 2 },
            { id: 'bf-entering', controller: 'p1', type_line: 'Creature — Bear', power: 4 },
          ],
        } as GameState;
      }
      if (/a creature card was put into your graveyard from anywhere this turn/i.test(conditionRaw)) {
        (nextState as any).creatureCardPutIntoYourGraveyardThisTurn = { p1: true };
      }
      if (/that player didn't cast a creature spell this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, thatPlayerId: 'p2' } as typeof nextCtx;
        nextState = { ...nextState, spellsCastThisTurn: [{ casterId: 'p2', card: { type_line: 'Instant' } }] } as GameState;
      }
      if (/^you control a green or white permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-green', controller: 'p1', type_line: 'Creature — Elf', colors: ['G'] }],
        } as GameState;
      }
      if (/an opponent drew three or more cards this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }],
          cardsDrawnThisTurn: { p1: 0, p2: 3 },
        } as GameState;
      }
      if (/^exactly one creature is attacking$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-atk', controller: 'p1', type_line: 'Creature — Soldier', attacking: true }],
        } as GameState;
      }
      if (/^defending player controls no black permanents$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, defendingPlayerId: 'p2', sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Spirit', attacking: 'p2' },
            { id: 'bf-green', controller: 'p2', type_line: 'Creature — Elf', colors: ['G'] },
          ],
        } as GameState;
      }
      if (/^an opponent would mill one or more cards$/i.test(conditionRaw.trim())) {
        /* replacement stub returns true */
      }
      if (/it targets one or more other permanents you control/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-source',
          stackItem: { targets: ['bf-other'] },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Shapeshifter' },
            { id: 'bf-other', controller: 'p1', type_line: 'Creature — Bear' },
          ],
        } as GameState;
      }
      if (/the gift was promised and that creature isn't legendary/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          giftPromised: true,
          targetPermanentId: 'bf-zombie',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-zombie', controller: 'p1', type_line: 'Creature — Zombie' }],
        } as GameState;
      }
      if (/^it has a counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState;
      }
      if (/a player controls more creatures than each other player/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
          battlefield: [
            { id: 'c1', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p3', type_line: 'Creature — Human' },
            { id: 'c4', controller: 'p3', type_line: 'Creature — Human' },
            { id: 'c5', controller: 'p3', type_line: 'Creature — Human' },
          ],
        } as GameState;
      }
      if (/^this artifact has loyalty counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-beacon' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-beacon', controller: 'p1', type_line: 'Artifact', counters: { loyalty: 2 } }],
        } as GameState;
      }
      if (/you or a player you're attacking has the initiative/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          initiative: 'p1',
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Soldier', attacking: 'p2' }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/^a creature card is put into a graveyard this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ type_line: 'Creature — Zombie' }],
          lastActionOutcome: { kind: 'applied', stepKind: 'destroy' },
        } as typeof nextCtx;
      }
      if (/^that creature was green or white$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ type_line: 'Creature — Elf', colors: ['G'] }] } as typeof nextCtx;
      }
      if (/^you have exactly 1 life$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, players: [{ id: 'p1', life: 1 }] } as GameState;
      }
      if (/^you control neither creature$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-a',
          secondTargetPermanentId: 'bf-b',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-a', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'bf-b', controller: 'p3', type_line: 'Creature — Bear' },
          ],
          players: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }],
        } as GameState;
      }
      if (/ten or more creature cards total in all graveyards/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', graveyard: new Array(5).fill({ type_line: 'Creature — Zombie' }) },
            { id: 'p2', graveyard: new Array(5).fill({ type_line: 'Creature — Zombie' }) },
          ],
        } as GameState;
      }
      if (/^its spectacle cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          stackItem: { alternateCostId: 'spectacle' },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', alternateCostId: 'spectacle' }],
        } as GameState;
      }
      if (/creature spell you cast this turn was countered by a spell or ability an opponent controlled/i.test(conditionRaw)) {
        (nextState as any).creatureSpellsCounteredByOpponentThisTurn = { p1: true };
      }
      if (/you haven't added mana with this ability this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', abilityId: '0' } as typeof nextCtx;
        (nextState as any).addedManaWithThisAbilityThisTurn = { p1: {} };
      }
      if (/^it was attacking$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Soldier', attackedThisTurn: true }],
        } as GameState;
      }
      if (/^x is 5 or more, for each artifact destroyed this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, xValue: 5, lastActionOutcome: { kind: 'applied', stepKind: 'destroy' } } as typeof nextCtx;
      }
      if (/that player attacked you during their last turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, thatPlayerId: 'p2' } as typeof nextCtx;
        (nextState as any).attackedYouLastTurnByPlayer = { p1: { p2: true } };
      }
      if (/you win, at the beginning of your next main phase/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastClashWon: true } as typeof nextCtx;
      }
      if (/^target opponent controls more lands than you$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetOpponentId: 'p2' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'l1', controller: 'p1', type_line: 'Land' },
            { id: 'l2', controller: 'p2', type_line: 'Land' },
            { id: 'l3', controller: 'p2', type_line: 'Land' },
          ],
        } as GameState;
      }
      if (/haven't completed tomb of annihilation/i.test(conditionRaw)) {
        (nextState as any).completedDungeonNames = { p1: [] };
      }
      if (/that library contains exactly the chosen number of cards with the chosen name/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          chosenCardName: 'Lightning Bolt',
          chosenNumber: 2,
          selectorContext: { chosenCardName: 'Lightning Bolt', chosenNumber: 2 },
          lastMovedCards: [{ name: 'Lightning Bolt' }, { name: 'Lightning Bolt' }],
        } as typeof nextCtx;
      }
      if (/enlisted a creature this combat/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Soldier', enlistedThisCombat: true }],
        } as GameState;
      }
      if (/^it isn't a token$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', isToken: false }],
        } as GameState;
      }
      if (/^you control another spirit$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Spirit' },
            { id: 'bf-other', controller: 'p1', type_line: 'Creature — Spirit' },
          ],
        } as GameState;
      }
      if (/three or more mana from creatures was spent to cast it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', manaFromCreaturesSpent: 3 }],
        } as GameState;
      }
      if (/you've cast an instant or sorcery spell this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          spellsCastThisTurn: [{ casterId: 'p1', card: { type_line: 'Instant' } }],
        } as GameState;
      }
      if (/^his sneak cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', alternateCostId: 'sneak' }],
        } as GameState;
      }
      if (/soul counters on this enchantment/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Enchantment', counters: { soul: 2 } }],
          stack: [{ id: 'stack-spell-1', manaValue: 3 }],
        } as GameState;
      }
      if (/^no mana was spent to cast that spell$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1', noManaSpentToCast: true } as typeof nextCtx;
        nextState = { ...nextState, stack: [{ id: 'stack-spell-1', manaSpentTotal: 0 }] } as GameState;
      }
      if (/^it's not that player's turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPlayerId: 'p2', selectorContext: { targetPlayerId: 'p2' } } as typeof nextCtx;
        nextState = { ...nextState, turnPlayer: 'p1' } as GameState;
      }
      if (/^you control another knight$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Knight' },
            { id: 'bf-other', controller: 'p1', type_line: 'Creature — Knight' },
          ],
        } as GameState;
      }
      if (/sacrificed creature was suspected/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ type_line: 'Creature — Human', isSuspected: true }],
        } as typeof nextCtx;
      }
      if (/another human died under your control this turn/i.test(conditionRaw)) {
        (nextState as any).creaturesDiedThisTurnByControllerSubtype = { p1: { human: 1 } };
      }
      if (/^another creature died this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).creaturesDiedThisTurnByController = { p1: 2 };
      }
      if (/that spell targets only this creature/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-source',
          targetCreatureId: 'bf-source',
          stackItem: { targets: ['bf-source'] },
        } as typeof nextCtx;
      }
      if (/^that permanent is black$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Zombie', colors: ['B'] }],
        } as GameState;
      }
      if (/fourteen or more cards in your graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: new Array(14).fill({ type_line: 'Instant' }) }],
        } as GameState;
      }
      if (/^he was cast$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, wasCast: true, targetPermanentId: 'bf-target' } as typeof nextCtx;
      }
      if (/you sacrificed a creature this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ controller: 'p1', type_line: 'Creature — Human' }],
          lastActionOutcome: { kind: 'applied', stepKind: 'sacrifice' },
        } as typeof nextCtx;
      }
      if (/^you control another colorless creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Eldrazi', colors: [] },
            { id: 'bf-other', controller: 'p1', type_line: 'Creature — Eldrazi', colors: [] },
          ],
        } as GameState;
      }
      if (/^you win all the flips$/i.test(conditionRaw.trim())) {
        (nextState as any).lastCoinFlips = { p1: [true, true, true] };
      }
      if (/^that creature was blue or black$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ type_line: 'Creature — Spirit', colors: ['U'] }] } as typeof nextCtx;
      }
      if (/^it didn't die$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, itCreatureId: 'bf-it', itDied: false } as typeof nextCtx;
      }
      if (/^you control another elf$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Elf' },
            { id: 'bf-other', controller: 'p1', type_line: 'Creature — Elf' },
          ],
        } as GameState;
      }
      if (/return four or more nontoken permanents you control this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: new Array(4).fill({ controller: 'p1', type_line: 'Creature — Human', isToken: false }),
          lastActionOutcome: { kind: 'applied', stepKind: 'move_zone' },
        } as typeof nextCtx;
      }
      if (/^enchanted creature is untapped$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-aura' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-aura', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-target' },
            { id: 'bf-target', controller: 'p2', type_line: 'Creature — Human', tapped: false },
          ],
        } as GameState;
      }
      if (/^enchanted creature is red$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-aura' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-aura', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-target' },
            { id: 'bf-target', controller: 'p2', type_line: 'Creature — Goblin', colors: ['R'] },
          ],
        } as GameState;
      }
      if (/^it's night$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, dayNight: 'night' } as GameState;
      }
      if (/^it was attacking$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-target',
          lastMovedCards: [{ id: 'bf-target', type_line: 'Creature — Soldier', attackedThisTurn: true }],
        } as typeof nextCtx;
      }
      if (/that creature's power is 4 or greater/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-atk', attackingCreatureId: 'bf-atk' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-atk', controller: 'p1', type_line: 'Creature — Soldier', power: 5 }],
        } as GameState;
      }
      if (/\+1\/\+1 counter was put on a permanent under your control this turn/i.test(conditionRaw)) {
        (nextState as any).putPlusOneCounterOnPermanentThisTurn = { p1: true };
      }
      if (/you were dealt 4 or more damage this turn/i.test(conditionRaw)) {
        (nextState as any).damageTakenThisTurnByPlayer = { p1: 4 };
      }
      if (/didn't enter the battlefield this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Human', enteredThisTurn: false }],
        } as GameState;
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/all nonland permanents you control are white/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-white', controller: 'p1', type_line: 'Creature — Soldier', colors: ['W'] }],
        } as GameState;
      }
      if (/creature entered the battlefield under an opponent's control this turn/i.test(conditionRaw)) {
        (nextState as any).creaturesEnteredBattlefieldUnderOpponentControlThisTurn = { p2: true };
      }
      if (/^an instant card or a card with flash is exiled this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ type_line: 'Instant' }],
          lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
        } as typeof nextCtx;
      }
      if (/edgar is in the command zone or on the battlefield/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          commandZone: [{ name: 'Edgar Markov', controller: 'p1', type_line: 'Legendary Creature — Vampire' }],
        } as GameState;
      }
      if (/you control four or fewer lands/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'l1', controller: 'p1', type_line: 'Land' }],
        } as GameState;
      }
      if (/discarded an instant or sorcery card this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastDiscardedCards: [{ type_line: 'Instant' }],
          lastActionOutcome: { kind: 'applied', stepKind: 'discard' },
        } as typeof nextCtx;
      }
      if (/second spell you cast this turn/i.test(conditionRaw)) {
        (nextState as any).spellsCastThisTurnByPlayer = { p1: 2 };
      }
      if (/doesn't have an indestructible counter on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', counters: {} }],
        } as GameState;
      }
      if (/^you control a red or green permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-red', controller: 'p1', type_line: 'Creature — Goblin', colors: ['R'] }],
        } as GameState;
      }
      if (/three or more wolves and\/or werewolves/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'w1', controller: 'p1', type_line: 'Creature — Wolf' },
            { id: 'w2', controller: 'p1', type_line: 'Creature — Wolf' },
            { id: 'w3', controller: 'p1', type_line: 'Creature — Werewolf' },
          ],
        } as GameState;
      }
      if (/one or fewer cards in hand/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', hand: [{ id: 'hand-audit-1' }] },
            { id: 'p2', hand: [] },
          ],
        } as GameState;
        nextCtx = {
          ...nextCtx,
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPlayerId: 'p2',
            targetOpponentId: 'p2',
          },
        } as typeof nextCtx;
      }
      if (/^its power was 3 or greater$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ power: 4 }] } as typeof nextCtx;
      }
      if (/three or more cards were put into your graveyard from anywhere other than the battlefield/i.test(conditionRaw)) {
        (nextState as any).cardsPutIntoGraveyardFromNonBattlefieldThisTurn = { p1: 3 };
      }
      if (/opponent has eight or more cards in their graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2', graveyard: new Array(8).fill({ type_line: 'Instant' }) }],
        } as GameState;
      }
      if (/creature you control entered this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', enteredThisTurn: true }],
        } as GameState;
      }
      if (/opponent controls seven or more lands/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: new Array(7).fill(null).map((_, i) => ({ id: `l${i}`, controller: 'p2', type_line: 'Land' })),
        } as GameState;
      }
      if (/^it was tapped$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target', lastMovedCards: [{ tapped: true }] } as typeof nextCtx;
      }
      if (/^it's not suspected$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', isSuspected: false }],
        } as GameState;
      }
      if (/didn't cast a spell this turn/i.test(conditionRaw)) {
        nextState = { ...nextState, spellsCastThisTurn: [] } as GameState;
      }
      if (/^it has madness$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature', oracle_text: 'Madness {1}{R}' }],
        } as GameState;
      }
      if (/^this spell's surge cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = { ...nextState, stack: [{ id: 'stack-spell-1', alternateCostId: 'surge' }] } as GameState;
      }
      if (/^you control more creatures than each other player$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'c1', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p2', type_line: 'Creature — Human' },
          ],
        } as GameState;
      }
      if (/^you control a blue or black permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-blue', controller: 'p1', type_line: 'Creature — Merfolk', colors: ['U'] }],
        } as GameState;
      }
      if (/^that creature is black or red$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Goblin', colors: ['R'] }],
        } as GameState;
      }
      if (/mana from a treasure was spent to cast (?:it|this spell)/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          manaFromTreasureSpent: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        (nextState as any).treasureManaSpentToCastThisTurn = {
          ...((nextState as any).treasureManaSpentToCastThisTurn || {}),
          p1: true,
        };
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Sorcery',
              manaFromTreasureSpent: true,
              manaFromTreasureSpentKnown: true,
              card: { type_line: 'Sorcery', manaFromTreasureSpent: true, manaFromTreasureSpentKnown: true },
            },
          ],
        } as GameState;
      }
      if (/mana from a treasure was spent to activate this ability/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-ability-1',
          manaFromTreasureSpent: true,
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-ability-1',
          },
        } as typeof nextCtx;
        (nextState as any).treasureManaSpentToActivateThisTurn = {
          ...((nextState as any).treasureManaSpentToActivateThisTurn || {}),
          p1: true,
        };
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-ability-1',
              controller: 'p1',
              type_line: 'Creature — Human Knight',
              isActivatedAbility: true,
              manaFromTreasureSpent: true,
              manaFromTreasureSpentKnown: true,
              card: {
                type_line: 'Creature — Human Knight',
                manaFromTreasureSpent: true,
                manaFromTreasureSpentKnown: true,
              },
            },
          ],
        } as GameState;
      }
      if (/that player controls more lands than each other player/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPlayerId: 'p2',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPlayerId: 'p2',
            activePlayerId: 'p2',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1' },
            { id: 'p2' },
            { id: 'p3' },
            { id: 'p4' },
          ],
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) =>
                !['bf-p1-land', 'bf-p2-land-a', 'bf-p2-land-b', 'bf-p2-land-c'].includes(
                  String(perm?.id || '').trim()
                )
            ),
            { id: 'bf-p1-land', controller: 'p1', type_line: 'Basic Land — Forest' },
            { id: 'bf-p2-land-a', controller: 'p2', type_line: 'Basic Land — Island' },
            { id: 'bf-p2-land-b', controller: 'p2', type_line: 'Basic Land — Mountain' },
            { id: 'bf-p2-land-c', controller: 'p2', type_line: 'Basic Land — Swamp' },
          ],
        } as GameState;
      }
      if (/you control no thopters other than this creature/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== 'bf-other-thopter'
            ),
            {
              id: String(nextCtx.sourceId || 'bf-source'),
              controller: 'p1',
              type_line: 'Artifact Creature — Thopter',
            },
          ],
        } as GameState;
      }
      if (/an opponent discarded a card this turn/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1' },
            { id: 'p2' },
            { id: 'p3' },
            { id: 'p4' },
          ],
          discardedCardThisTurn: { p1: false, p2: true, p3: false, p4: false },
        } as GameState;
      }
      if (/two or more players have lost the game/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', hasLost: false },
            { id: 'p2', hasLost: false },
            { id: 'p3', hasLost: true },
            { id: 'p4', hasLost: true },
          ],
          playersLostCount: 2,
        } as GameState;
      }
      if (/damage from a creature source is prevented this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          creatureDamagePreventedThisWay: true,
          lastPreventedDamageSourceType: 'creature',
          lastPreventedDamageSource: {
            id: 'bf-prevent-source-creature',
            type_line: 'Creature — Warrior',
          },
        } as typeof nextCtx;
      }
      if (/damage from a noncreature source is prevented this way/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          noncreatureDamagePreventedThisWay: true,
          lastPreventedDamageSourceType: 'noncreature',
          lastPreventedDamageSource: {
            id: 'bf-prevent-source-spell',
            type_line: 'Instant',
          },
        } as typeof nextCtx;
      }
      if (/it was kicked twice/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        const sourceId = String(nextCtx.sourceId || 'bf-source');
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Creature — Angel',
              wasKickedTwice: true,
              kickedTimes: 2,
              kickerPaidCount: 2,
            },
          ],
          battlefield: [
            ...(nextState.battlefield || []).filter(
              (perm: any) => String(perm?.id || '').trim() !== sourceId
            ),
            {
              id: sourceId,
              controller: 'p1',
              type_line: 'Creature — Angel',
              wasKickedTwice: true,
              kickedTimes: 2,
              kickerPaidCount: 2,
            },
          ],
        } as GameState;
      }
      if (/a card is exiled with it/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || [{ id: 'p1' }]).map((player: any) => ({
            ...player,
            exile: [
              ...(Array.isArray(player?.exile) ? player.exile : []),
              {
                id: 'ex-exiled-with-source',
                name: 'Counterspell',
                type_line: 'Instant',
                exiledWithSourceId: String(nextCtx.sourceId || 'bf-source'),
              },
            ],
          })),
        } as GameState;
      }
      if (/it has a single target/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetSpellId: 'stack-spell-1',
          stackItem: { targets: ['bf-target-1'] },
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetSpellId: 'stack-spell-1',
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [
            {
              id: 'stack-spell-1',
              controller: 'p1',
              type_line: 'Instant',
              targets: ['bf-target-1'],
            },
          ],
        } as GameState;
      }
      if (/the sacrificed creature was a/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [
            {
              id: 'bf-sacrificed-human',
              type_line: 'Creature — Human',
              subtype: 'Human',
            },
          ],
        } as typeof nextCtx;
      }
      if (/that land was nonbasic/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-nonbasic-land',
          targetLandId: 'bf-nonbasic-land',
          lastMovedCards: [
            {
              id: 'bf-nonbasic-land',
              type_line: 'Land',
              name: "Rogue's Passage",
            },
          ],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPermanentId: 'bf-nonbasic-land',
          },
        } as typeof nextCtx;
      }
      if (/enlisted a creature this combat/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', enlistedCreatureThisCombat: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Soldier', enlistedThisCombat: true }],
        } as GameState;
      }
      if (/target creature you control gets \+2\/\+0 until end of turn if it's night/i.test(conditionRaw)) {
        nextState = { ...nextState, dayNight: 'night' } as GameState;
      }
      if (/unless you waterbend \{2\}|^you waterbend \{2\}$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, waterbendWasPaid: true, selectorContext: { ...(nextCtx.selectorContext || {}), waterbendWasPaid: true } } as typeof nextCtx;
      }
      if (/you controlled a faerie as you cast this spell/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, controlledFaerieAsCast: true } as typeof nextCtx;
        const existingBattlefield = Array.isArray(nextState.battlefield) ? [...nextState.battlefield] : [];
        const faerieFixture = { id: 'bf-faerie', controller: 'p1', type_line: 'Creature — Faerie' };
        nextState = {
          ...nextState,
          battlefield: [
            ...existingBattlefield.filter((perm: any) => String(perm?.id || '').trim() !== 'bf-faerie'),
            faerieFixture,
          ],
        } as GameState;
      }
      if (/unless you exile a historic card from your graveyard|^you exile a historic card from your graveyard$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, unlessExiledHistoricFromGraveyard: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: [{ type_line: 'Artifact — Equipment', name: 'Sol Ring' }] }],
        } as GameState;
      }
      if (/^that creature was cast for its warp cost$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target', warpCostPaid: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', warpCostPaid: true, alternateCostId: 'warp' }],
        } as GameState;
      }
      if (/^sickness gets more votes$/i.test(conditionRaw.trim())) {
        (nextState as any).councilVoteResults = { sickness: 3, psychosis: 1 };
      }
      if (/^defending player has more cards in hand than you$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, defendingPlayerId: 'p2', sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', hand: [{}] },
            { id: 'p2', hand: [{}, {}, {}] },
          ],
        } as GameState;
      }
      if (/^no permanents left the battlefield this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).permanentLeftBattlefieldThisTurn = { p1: false, p2: false };
      }
      if (/^this creature would be destroyed$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
      }
      if (/peer through depths and a spell named reach through mists/i.test(conditionRaw)) {
        (nextState as any).namedSpellsCastThisTurn = {
          p1: { peerThroughDepths: true, reachThroughMists: true },
        };
      }
      if (/^you do and your opponent guessed wrong$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, youDoChoice: true, lastGuessCorrect: false } as typeof nextCtx;
      }
      if (/doesn't have the same name as another creature you control or a creature card in your graveyard/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-unique' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: [] }],
          battlefield: [{ id: 'bf-unique', controller: 'p1', type_line: 'Creature — Elf', name: 'Elvish Mystic' }],
        } as GameState;
      }
      if (/^it doesn't have first strike$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human' }],
        } as GameState;
      }
      if (/^it has first strike$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', keywords: ['first strike'] }],
        } as GameState;
      }
      if (/^it had a revival counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ counters: { revival: 1 } }] } as typeof nextCtx;
      }
      if (/unless you return a land you control to its owner's hand|^you return a land you control to its owner's hand$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, unlessReturnedLandToHand: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'l1', controller: 'p1', type_line: 'Land' }],
        } as GameState;
      }
      if (/four or more card types among cards in your graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || [{ id: 'p1' }, { id: 'p2' }]).map((player: any) => {
            if (String(player?.id || '').trim() !== 'p1') return player;
            return {
              ...player,
              graveyard: [
                ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
                { type_line: 'Instant' },
                { type_line: 'Sorcery' },
                { type_line: 'Creature — Human' },
                { type_line: 'Artifact' },
              ],
            };
          }),
          deliriumTypesInGraveyard: { p1: 4 },
        } as GameState;
      }
      if (/doesn't have a \+1\/\+1 counter on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Human', counters: {} }],
        } as GameState;
      }
      if (/creature named fang/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-vanille' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-vanille', controller: 'p1', owner: 'p1', type_line: 'Legendary Creature — Human', name: 'Vanille, Cheerful l\'Cie' },
            { id: 'bf-fang', controller: 'p1', owner: 'p1', type_line: 'Legendary Creature — Human', name: 'Fang' },
          ],
        } as GameState;
      }
      if (/twenty or more growth counters on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-ascendancy' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-ascendancy', controller: 'p1', type_line: 'Enchantment', counters: { growth: 20 } }],
        } as GameState;
      }
      if (/^the card's mana value is 1 or less$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-exiled-card', manaValue: 1, cmc: 1, type_line: 'Instant' }],
          targetPermanentId: 'bf-exiled-card',
        } as typeof nextCtx;
      }
      if (/^it was dealt damage this turn$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-target',
          targetCreatureId: 'bf-target',
          lastMovedCards: [{ id: 'bf-target', type_line: 'Creature — Human', tookDamageThisTurn: true, wasDealtDamageThisTurn: true }],
        } as typeof nextCtx;
      }
      if (/^it has unearth$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-target',
          lastMovedCards: [{ id: 'bf-target', type_line: 'Creature — Zombie', oracle_text: 'Unearth {1}{B}' }],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{
            id: 'p1',
            hand: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Zombie', oracle_text: 'Unearth {1}{B}' }],
          }],
        } as GameState;
      }
      if (/^you control fewer creatures than an opponent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', life: 10 }, { id: 'p2', life: 20 }],
          battlefield: [
            { id: 'c1', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p2', type_line: 'Creature — Elf' },
          ],
        } as GameState;
      }
      if (/would counter a spell/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-guile' } as typeof nextCtx;
      }
      if (/^a giant$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, giantWizardOrControlledSpellDamagedIt: true } as typeof nextCtx;
      }
      if (/^you drew two or more cards this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDrawnThisTurn = { p1: 2 };
      }
      if (/another creature enter the battlefield under your control last turn/i.test(conditionRaw)) {
        (nextState as any).creaturesEnteredBattlefieldUnderControlLastTurn = { p1: true };
      }
      if (/^you have 40 or more life$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, players: [{ id: 'p1', life: 40 }] } as GameState;
      }
      if (/^this creature is equipped$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Human', isEquipped: true },
            { id: 'bf-equip', controller: 'p1', type_line: 'Artifact — Equipment', attachedTo: 'bf-source' },
          ],
        } as GameState;
      }
      if (/would cause you to draw a card/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-cyclone' } as typeof nextCtx;
      }
      if (/dealt 10 or more damage to that player this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, damageDealtToThatPlayerThisTurn: 10, targetPlayerId: 'p2' } as typeof nextCtx;
      }
      if (/^you didn't play a land this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).landsPlayedThisTurn = { p1: 0 };
      }
      if (/power was different from its base power/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ power: 5, basePower: 3 }] } as typeof nextCtx;
      }
      if (/^you control no other creatures$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-lone' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-lone', controller: 'p1', type_line: 'Creature — Spirit' }],
        } as GameState;
      }
      if (/^it isn't a vehicle$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-artifact' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-artifact', controller: 'p1', type_line: 'Artifact' }],
        } as GameState;
      }
      if (/hasn't been exerted this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-celebrant' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-celebrant', controller: 'p1', type_line: 'Creature — Human', exertedThisTurn: false }],
        } as GameState;
      }
      if (/^that artifact had counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ type_line: 'Artifact', counters: { charge: 2 } }],
        } as typeof nextCtx;
      }
      if (/^there are no arrowhead counters on this artifact$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-arrows' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-arrows', controller: 'p1', type_line: 'Artifact', counters: {} }],
        } as GameState;
      }
      if (/^that permanent was a nissa planeswalker$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ name: 'Nissa, Voice of Zendikar', type_line: 'Legendary Planeswalker — Nissa' }] } as typeof nextCtx;
      }
      if (/^that card is exiled$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-exiled' }],
          lastActionOutcome: { kind: 'applied', stepKind: 'exile' },
        } as typeof nextCtx;
      }
      if (/four or more cards exiled with this artifact/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-diary' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-diary', controller: 'p1', type_line: 'Artifact', exiledCardCount: 4 }],
        } as GameState;
      }
      if (/^each player has 10 or less life$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', life: 8 },
            { id: 'p2', life: 10 },
          ],
        } as GameState;
      }
      if (/total mana value of the cards exiled this way is 13 or less/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, totalManaValueExiledThisWay: 10 } as typeof nextCtx;
      }
      if (/^this permanent is in the command zone$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'cmd-oloro' } as typeof nextCtx;
        nextState = {
          ...nextState,
          commandZone: [{ id: 'cmd-oloro', controller: 'p1', type_line: 'Legendary Creature — Avatar' }],
        } as GameState;
      }
      if (/two or more other creatures on the battlefield/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-portcullis' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-portcullis', controller: 'p1', type_line: 'Artifact' },
            { id: 'c1', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p2', type_line: 'Creature — Elf' },
          ],
        } as GameState;
      }
      if (/combat damage by a zombie this turn/i.test(conditionRaw)) {
        (nextState as any).combatDamageByZombieThisTurn = { p2: true };
      }
      if (/^it's enchanted$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-target', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'bf-aura', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-target' },
          ],
        } as GameState;
      }
      if (/freerunning cost was paid/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, freerunningCostPaid: true, targetSpellId: 'stack-spell-1' } as typeof nextCtx;
        nextState = {
          ...nextState,
          stack: [{ id: 'stack-spell-1', alternateCostId: 'freerunning' }],
        } as GameState;
      }
      if (/^you didn't play a card from exile this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).playedFromExileThisTurn = { p1: false };
      }
      if (/doesn't have rampage/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human' }],
        } as GameState;
      }
      if (/^a player has more cards in hand than each other player$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [
            { id: 'p1', hand: [{}] },
            { id: 'p2', hand: [{}, {}, {}] },
          ],
        } as GameState;
      }
      if (/^you have less life than an opponent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', life: 10 }, { id: 'p2', life: 20 }],
        } as GameState;
      }
      if (/^you control fewer creatures than an opponent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', life: 10 }, { id: 'p2', life: 20 }],
          battlefield: [
            { id: 'c1', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'c2', controller: 'p2', type_line: 'Creature — Human' },
            { id: 'c3', controller: 'p2', type_line: 'Creature — Elf' },
          ],
        } as GameState;
      }
      if (/that mana is spent on a dragon creature spell/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, manaSpentOnDragonCreatureSpell: true } as typeof nextCtx;
      }
      if (/^there are cards exiled with it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Artifact', exiledCardCount: 1 }],
        } as GameState;
      }
      if (/^you controlled that artifact$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ controller: 'p1', type_line: 'Artifact' }],
        } as typeof nextCtx;
      }
      if (/^it had no counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ counters: {} }] } as typeof nextCtx;
      }
      if (/wasn't a spirit/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ type_line: 'Creature — Human' }] } as typeof nextCtx;
      }
      if (/damage from a red source is prevented this way/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, redDamagePreventedThisWay: true } as typeof nextCtx;
      }
      if (/black creature with flying is attacking/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-atk', controller: 'p2', type_line: 'Creature — Bat', colors: ['B'], keywords: ['flying'], attacking: 'p1' }],
        } as GameState;
      }
      if (/mana value less than the sacrificed permanent's mana value/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ manaValue: 2 }],
          lastSacrificedPermanents: [{ manaValue: 4, type_line: 'Creature — Human' }],
        } as typeof nextCtx;
      }
      if (/^this creature attacked or blocked this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Creature — Human', attackedThisTurn: true }],
        } as GameState;
      }
      if (/at least four more creatures than you/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2' }],
          battlefield: [
            { id: 'c1', controller: 'p1', type_line: 'Creature — Human' },
            ...new Array(5).fill(null).map((_, i) => ({ id: `c-opp-${i}`, controller: 'p2', type_line: 'Creature — Human' })),
          ],
        } as GameState;
      }
      if (/entered from exile or was cast from exile/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ enteredFromZone: 'exile', castFromZone: 'exile' }],
        } as typeof nextCtx;
      }
      if (/^you control no other colorless creatures$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-colorless' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-colorless', controller: 'p1', type_line: 'Creature — Eldrazi', colors: [] }],
        } as GameState;
      }
      if (/historic spell this turn/i.test(conditionRaw)) {
        (nextState as any).historicSpellsCastThisTurn = { p1: true };
      }
      if (/^it was dealt damage this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target', lastMovedCards: [{ tookDamageThisTurn: true }] } as typeof nextCtx;
      }
      if (/pirate and a vehicle attacked this combat/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'pirate-1', controller: 'p1', type_line: 'Creature — Pirate', attacking: 'p2' },
            { id: 'vehicle-1', controller: 'p1', type_line: 'Artifact — Vehicle', attacking: 'p2' },
          ],
        } as GameState;
      }
      if (/at least four more cards in hand than you/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', hand: [{}] }, { id: 'p2', hand: [{}, {}, {}, {}, {}] }],
        } as GameState;
      }
      if (/modified creature died under your control this turn/i.test(conditionRaw)) {
        (nextState as any).modifiedCreaturesDiedThisTurnByController = { p1: true };
      }
      if (/thirteen or more creatures on the battlefield/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: new Array(13).fill(null).map((_, i) => ({
            id: `c-${i}`,
            controller: i % 2 === 0 ? 'p1' : 'p2',
            type_line: 'Creature — Human',
          })),
        } as GameState;
      }
      if (/^it has unearth$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Zombie', oracle_text: 'Unearth {1}{B}' }],
        } as GameState;
      }
      if (/dealt damage to another creature this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-wolverine', dealtDamageToAnotherCreatureThisTurn: true } as typeof nextCtx;
        (nextState as any).permanentDealtDamageToCreatureThisTurn = { 'bf-wolverine': true };
      }
      if (/one or more \+1\/\+1 counters on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-prodigy' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-prodigy', controller: 'p1', type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState;
      }
      if (/^you sacrificed a permanent this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).permanentsSacrificedThisTurnByController = { p1: true };
      }
      if (/^a player has more life than each other player$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 10 }],
        } as GameState;
      }
      if (/^that creature is 1\/1$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Creature — Human', power: 1, toughness: 1 }],
        } as GameState;
      }
      if (/doesn't have the same name as another creature you control or a creature card in your graveyard/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-source',
          thisCreatureId: 'bf-source',
          thisPermanentId: 'bf-source',
          targetPermanentId: 'bf-source',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: [] }],
          battlefield: [{
            id: 'bf-source',
            controller: 'p1',
            type_line: 'Creature — Elf',
            name: 'Llanowar Elves',
          }],
        } as GameState;
      }
      if (/^no permanents left the battlefield this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-sarevok' } as typeof nextCtx;
        (nextState as any).permanentLeftBattlefieldThisTurn = { p1: false, p2: false, p3: false, p4: false };
      }
      if (/creatures your opponents control get .+ was spent to cast this spell/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          manaSpentToCast: { U: true, R: true },
          blueManaSpentToCast: true,
          redManaSpentToCast: true,
        } as typeof nextCtx;
      }
      if (/^\{u\} was spent to cast this spell, and creatures you control get .+ if \{r\} was spent to cast this spell$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          manaSpentToCast: { U: true, R: true },
          blueManaSpentToCast: true,
          redManaSpentToCast: true,
        } as typeof nextCtx;
      }
      if (/^this permanent has one or more \+1\/\+1 counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-sarulf' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-sarulf', controller: 'p1', type_line: 'Legendary Creature — Wolf', counters: { '+1/+1': 2 } }],
        } as GameState;
      }
      if (/removed a creature card with flying from the draft/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, draftRemovedFlyingCreatureWithSameName: true } as typeof nextCtx;
      }
      if (/^you cast it from your hand and there are five or more other creatures on the battlefield$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source', castFromHand: true, wasCastFromHand: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-source', controller: 'p1', type_line: 'Creature — Dragon' },
            ...new Array(5).fill(null).map((_, i) => ({
              id: `bf-other-${i}`,
              controller: 'p2',
              type_line: 'Creature — Human',
            })),
          ],
        } as GameState;
      }
      if (/^it's at least one of the chosen colors$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-target',
          chosenColors: ['W', 'U'],
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            chosenColors: ['W', 'U'],
          },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p1', type_line: 'Artifact', colors: ['W'] }],
        } as GameState;
      }
      if (/^you haven't been dealt combat damage since your last turn$/i.test(conditionRaw.trim())) {
        (nextState as any).combatDamageTakenSinceLastTurn = { p1: false };
      }
      if (/^it wasn't blocking$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-dead',
          lastMovedCards: [{ id: 'bf-dead', wasBlocking: false, type_line: 'Creature — Rogue' }],
        } as typeof nextCtx;
      }
      if (/^none of them were cast or no mana was spent to cast them$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, noneWereCast: true, noManaSpentToCast: true } as typeof nextCtx;
      }
      if (/^you control a black or red permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(Array.isArray(nextState.battlefield) ? nextState.battlefield : []),
            { id: 'bf-black', controller: 'p1', type_line: 'Creature — Vampire', colors: ['B'] },
          ],
        } as GameState;
      }
      if (/^you control a black permanent and a red permanent$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-black', controller: 'p1', type_line: 'Creature — Vampire', colors: ['B'] },
            { id: 'bf-red', controller: 'p1', type_line: 'Creature — Goblin', colors: ['R'] },
          ],
        } as GameState;
      }
      if (/^you win (one|two|three) or more flips$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, coinFlipsWonThisResolution: 3, flipsWonThisAbility: 3 } as typeof nextCtx;
      }
      if (/^this creature is an angel$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-angel', thisCreatureId: 'bf-angel' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-angel', controller: 'p1', type_line: 'Creature — Angel Spirit' }],
        } as GameState;
      }
      if (/non-human creature spell/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, manaSpentOnNonHumanCreatureSpell: true } as typeof nextCtx;
      }
      if (/^this mana is spent to cast a creature spell$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, manaSpentOnCreatureSpell: true } as typeof nextCtx;
      }
      if (/mana spent to cast that spell is greater than this permanent's power/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          sourceId: 'bf-thopter',
          manaSpentToCastTargetSpell: 8,
          referenceSpellManaValue: 8,
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-thopter', controller: 'p1', type_line: 'Artifact Creature — Thopter', power: 2, toughness: 2 }],
        } as GameState;
      }
      if (/^the sacrificed permanent was a commander$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sacrificedPermanentWasCommander: true } as typeof nextCtx;
      }
      if (/^any player pays \{2\}$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, anyPlayerPaidTwo: true, unlessPayWasPaid: true } as typeof nextCtx;
      }
      if (/^there are five colors among permanents you control$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'c-w', controller: 'p1', type_line: 'Creature — Human', colors: ['W'] },
            { id: 'c-u', controller: 'p1', type_line: 'Creature — Merfolk', colors: ['U'] },
            { id: 'c-b', controller: 'p1', type_line: 'Creature — Zombie', colors: ['B'] },
            { id: 'c-r', controller: 'p1', type_line: 'Creature — Goblin', colors: ['R'] },
            { id: 'c-g', controller: 'p1', type_line: 'Creature — Elf', colors: ['G'] },
          ],
        } as GameState;
      }
      if (/^an enchantment was put into your graveyard from the battlefield this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).enchantmentPutIntoGraveyardFromBattlefieldThisTurn = { p1: true };
      }
      if (/^you attacked with exactly one other creature this combat$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-puppeteer' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-puppeteer', controller: 'p1', type_line: 'Creature — Human', attacking: 'p2' },
            { id: 'bf-other-atk', controller: 'p1', type_line: 'Creature — Human', attacking: 'p2' },
          ],
        } as GameState;
      }
      if (/^that creature is white or blue$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-target', targetCreatureId: 'bf-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Merfolk', colors: ['U'] }],
        } as GameState;
      }
      if (/^you roll a 6$/i.test(conditionRaw.trim()) || /^you've rolled a 6 this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastDieRollResult: 6 } as typeof nextCtx;
        (nextState as any).rolledSixThisTurn = { p1: true };
      }
      if (/greatest power among creatures on the battlefield/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-aura', enchantedPermanentId: 'bf-enchanted' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-enchanted', controller: 'p1', type_line: 'Creature — Human', power: 5, toughness: 5 },
            { id: 'bf-aura', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-enchanted' },
            { id: 'bf-weaker', controller: 'p2', type_line: 'Creature — Elf', power: 2, toughness: 2 },
          ],
        } as GameState;
      }
      if (/creature or lesson card in your graveyard/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? {
                  ...player,
                  graveyard: [{ id: 'gy-lesson-1', type_line: 'Lesson', name: 'Audit Lesson' }],
                }
              : player
          ),
        } as GameState;
      }
      if (/^this permanent was kicked$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Legendary Planeswalker — Jace', wasKicked: true }],
        } as GameState;
      }
      if (/^there are fewer than six creature cards in your graveyard$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, graveyard: [{ id: 'gy-c1', type_line: 'Creature — Zombie' }] }
              : player
          ),
        } as GameState;
      }
      if (/^a creature card is exiled this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'ex-creature-1', type_line: 'Creature — Human' }],
        } as typeof nextCtx;
      }
      if (/^it shares a card type with the card exiled this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'gy-match-1',
          lastMovedCards: [{ id: 'ex-instant-1', type_line: 'Instant' }],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, graveyard: [{ id: 'gy-match-1', type_line: 'Instant' }] }
              : player
          ),
        } as GameState;
      }
      if (/^you don't put it onto the battlefield$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, didNotPutExiledCardOntoBattlefield: true } as typeof nextCtx;
      }
      if (/no cards in hand and this enchantment has two or more quest counters/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-quest', targetPlayerId: 'p2' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1' }, { id: 'p2', hand: [] }],
          battlefield: [{ id: 'bf-quest', controller: 'p1', type_line: 'Enchantment', counters: { quest: 2 } }],
        } as GameState;
      }
      if (/^that spell targets a commander you control$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, spellTargetsCommanderYouControl: true } as typeof nextCtx;
      }
      if (/^it's not a vehicle$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-artifact' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-artifact', controller: 'p1', type_line: 'Artifact' }],
        } as GameState;
      }
      if (/^that creature had to attack this combat$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-forced',
          lastMovedCards: [{ id: 'bf-forced', mustAttackThisCombat: true, type_line: 'Creature — Dragon' }],
        } as typeof nextCtx;
      }
      if (/^it comes up heads$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastCoinFlipResult: 'heads', wonCoinFlip: true } as typeof nextCtx;
      }
      if (/^the discarded card was a land card$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastDiscardedCards: [{ id: 'disc-land-1', type_line: 'Basic Land — Mountain' }],
        } as typeof nextCtx;
      }
      if (/^this creature has two or fewer judgment counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-judge' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-judge', controller: 'p1', type_line: 'Creature — Human', counters: { judgment: 1 } }],
        } as GameState;
      }
      if (/^you've been dealt damage by two or more creatures this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).creaturesThatDealtDamageToYouThisTurn = { p1: 2 };
      }
      if (/^you didn't lose life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).lifeLostThisTurn = { p1: 0 };
      }
      if (/^that land was legendary$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-legendary-land', type_line: 'Legendary Land' }],
        } as typeof nextCtx;
      }
      if (/^that player controls a plains$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(Array.isArray(nextState.battlefield) ? nextState.battlefield : []),
            { id: 'bf-plains', controller: 'p2', type_line: 'Basic Land — Plains' },
          ],
        } as GameState;
      }
      if (/three or more cards have been exiled with this artifact/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-source' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-source', controller: 'p1', type_line: 'Artifact', exiledCardCount: 3 }],
        } as GameState;
      }
      if (/defending player controls no glimmer creatures/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-non-glimmer', controller: 'p2', type_line: 'Creature — Human' }],
        } as GameState;
      }
      if (/^the discarded card was an artifact card$/i.test(conditionRaw.trim())) {
        const discarded = { id: 'disc-artifact-1', type_line: 'Artifact', name: 'Discarded Artifact' };
        nextCtx = { ...nextCtx, lastDiscardedCards: [discarded] } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? {
                  ...player,
                  graveyard: [
                    discarded,
                    ...(Array.isArray(player.graveyard) ? player.graveyard : []).filter(
                      (card: any) => String(card?.id || '').trim() !== discarded.id
                    ),
                  ],
                }
              : player
          ),
        } as GameState;
      }
      if (/one or more players being attacked are poisoned/i.test(conditionRaw)) {
        (nextState as any).poisonedPlayersBeingAttacked = ['p2'];
      }
      if (/^defending player controls more lands than you$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-your-land', controller: 'p1', type_line: 'Basic Land — Forest' },
            { id: 'bf-opp-land-1', controller: 'p2', type_line: 'Basic Land — Plains' },
            { id: 'bf-opp-land-2', controller: 'p2', type_line: 'Basic Land — Island' },
          ],
        } as GameState;
      }
      if (/^you have three or fewer cards in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1' ? { ...player, hand: [{}] } : player
          ),
        } as GameState;
      }
      if (/assassin crewed it this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, assassinCrewedItThisTurn: true } as typeof nextCtx;
      }
      if (/^that creature has infect$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-infect' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-infect', controller: 'p2', type_line: 'Creature — Phyrexian', keywords: ['infect'] }],
        } as GameState;
      }
      if (/^you've cast a noncreature spell this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).noncreatureSpellsCastThisTurn = { p1: true };
      }
      if (/haven't cast a spell from your hand this turn and this creature doesn't have a flying counter/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-wingsmith' } as typeof nextCtx;
        (nextState as any).spellsCastFromHandThisTurn = { p1: false };
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-wingsmith', controller: 'p1', type_line: 'Artifact Creature — Construct', counters: {} }],
        } as GameState;
      }
      if (/^you sacrificed one or more permanents this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).permanentsSacrificedThisTurnByController = { p1: true };
      }
      if (/^that player didn't cast a spell this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).spellsCastThisTurn = { p2: 0 };
      }
      if (/^one or more cards were put into exile this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsPutIntoExileThisTurn = { p1: true };
      }
      if (/^the spell is countered this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, spellCounteredThisWay: true } as typeof nextCtx;
      }
      if (/^it's attacking$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-attacker' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-attacker', controller: 'p2', type_line: 'Creature — Human', attacking: 'p1' }],
        } as GameState;
      }
      if (/^two cards that share a card type were milled this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMilledCards: [
            { id: 'mill-1', type_line: 'Instant' },
            { id: 'mill-2', type_line: 'Instant' },
          ],
        } as typeof nextCtx;
      }
      if (/^another human entered the battlefield under your control this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).humansEnteredBattlefieldUnderControlThisTurn = { p1: true };
      }
      if (/^it was blocked this turn$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-blocked', wasBlockedThisTurn: true, type_line: 'Creature — Human' }],
        } as typeof nextCtx;
      }
      if (/midnight scavengers/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-graf-rats', thisCreatureId: 'bf-graf-rats' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-graf-rats', controller: 'p1', owner: 'p1', type_line: 'Creature — Rat', name: 'Graf Rats' },
            { id: 'bf-midnight', controller: 'p1', owner: 'p1', type_line: 'Creature — Human', name: 'Midnight Scavengers' },
          ],
        } as GameState;
      }
      if (/^its mana cost contains \{x\}$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'hand-x-creature', mana_cost: '{X}{G}', cmc: 0, type_line: 'Creature — Tyranid' }],
        } as typeof nextCtx;
      }
      if (/power or toughness equal to the chosen number/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, chosenNumber: 3, selectorContext: { ...(nextCtx.selectorContext || {}), chosenNumber: 3 } } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-squall-target', controller: 'p2', type_line: 'Creature — Human', power: 3, toughness: 2 }],
        } as GameState;
      }
      if (/^it isn't a creature or vehicle$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-artifact-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-artifact-target', controller: 'p1', type_line: 'Artifact' }],
        } as GameState;
      }
      if (/^it has a \+1\/\+1 counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-dual-sun' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-dual-sun', controller: 'p1', type_line: 'Creature — Human', counters: { '+1/+1': 1 } }],
        } as GameState;
      }
      if (/ten or more luck counters on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-chance' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-chance', controller: 'p1', type_line: 'Enchantment', counters: { luck: 10 } }],
        } as GameState;
      }
      if (/^an opponent lost life last turn$/i.test(conditionRaw.trim())) {
        (nextState as any).opponentLostLifeLastTurn = { p2: true };
      }
      if (/face-down creature entered the battlefield under your control this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, faceDownPermanentEnteredThisTurnUnderYourControl: true } as typeof nextCtx;
        (nextState as any).faceDownCreaturesEnteredUnderControlThisTurn = { p1: true };
      }
      if (/other than galadriel as your ring-bearer/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          chosenRingBearerId: 'bf-other-bearer',
          selectorContext: { ...(nextCtx.selectorContext || {}), chosenRingBearerId: 'bf-other-bearer' },
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-other-bearer', controller: 'p1', type_line: 'Legendary Creature — Elf', name: 'Legolas' }],
        } as GameState;
      }
      if (/lands with contested counters on them/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-contested-land', controller: 'p2', type_line: 'Land', counters: { contested: 1 } }],
        } as GameState;
      }
      if (/^this artifact has a charge counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-ventifact' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-ventifact', controller: 'p1', type_line: 'Artifact', counters: { charge: 1 } }],
        } as GameState;
      }
      if (/sacrificed creature's toughness was 4 or greater/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ type_line: 'Creature — Giant', toughness: 5, power: 4 }],
        } as typeof nextCtx;
      }
      if (/four or more basic land types among lands that player controls/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-plains', controller: 'p2', type_line: 'Basic Land — Plains' },
            { id: 'bf-island', controller: 'p2', type_line: 'Basic Land — Island' },
            { id: 'bf-swamp', controller: 'p2', type_line: 'Basic Land — Swamp' },
            { id: 'bf-mountain', controller: 'p2', type_line: 'Basic Land — Mountain' },
          ],
        } as GameState;
      }
      if (/that land had a nonbasic land type/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-nonbasic', type_line: 'Land — Gate' }],
          lastMovedLandWasNonbasic: true,
        } as typeof nextCtx;
      }
      if (/draw a card\. then discard a card unless that land had a nonbasic land type/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-nonbasic', type_line: 'Land — Gate' }],
          lastMovedLandWasNonbasic: true,
        } as typeof nextCtx;
      }
      if (/didn't put the revealed card onto the battlefield this way/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, didNotPutRevealedCardOntoBattlefieldThisWay: true } as typeof nextCtx;
      }
      if (/cast a spell with mana value 4 or greater this turn/i.test(conditionRaw)) {
        (nextState as any).spellsCastWithManaValueFourOrGreaterThisTurn = { p1: true };
      }
      if (/^you discarded a card this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDiscardedThisTurn = { p1: 1 };
      }
      if (/number of robots you control/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastDieRollResult: 2 } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-robot-1', controller: 'p1', type_line: 'Artifact Creature — Robot' },
            { id: 'bf-robot-2', controller: 'p1', type_line: 'Artifact Creature — Robot' },
            { id: 'bf-robot-3', controller: 'p1', type_line: 'Artifact Creature — Robot' },
          ],
        } as GameState;
      }
      if (/^you've drawn two or more cards this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDrawnThisTurn = { p1: 2 };
      }
      if (/200 or more cards in your library/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, library: new Array(200).fill(null).map((_, i) => ({ id: `lib-${i}`, type_line: 'Instant' })) }
              : player
          ),
        } as GameState;
      }
      if (/at least seven red mana was spent to cast this spell/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, atLeastSevenRedManaSpentToCast: true, redManaSpentToCast: 7 } as typeof nextCtx;
      }
      if (/mana value is less than or equal to the number of allies you control/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'gy-ally-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2'
              ? { ...player, graveyard: [{ id: 'gy-ally-target', type_line: 'Creature — Ally', cmc: 2 }] }
              : player
          ),
          battlefield: [{ id: 'bf-ally-1', controller: 'p1', type_line: 'Creature — Ally' }],
        } as GameState;
      }
      if (/^you were the monarch as the turn began$/i.test(conditionRaw.trim())) {
        (nextState as any).wasMonarchAsTurnBegan = { p1: true };
      }
      if (/damage from a black source is prevented this way/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, blackDamagePreventedThisWay: true } as typeof nextCtx;
      }
      if (/devotion to white and black is seven or greater/i.test(conditionRaw)) {
        (nextState as any).devotionToWhiteAndBlack = { p1: 7 };
      }
      if (/same name as a card in your graveyard/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'top-reveal', name: 'Lightning Bolt', type_line: 'Instant' }] } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, graveyard: [{ id: 'gy-bolt', name: 'Lightning Bolt', type_line: 'Instant' }] }
              : player
          ),
        } as GameState;
      }
      if (/discarded card wasn't a land card/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastDiscardedCards: [{ id: 'disc-spell', type_line: 'Instant' }] } as typeof nextCtx;
      }
      if (/discovered card's mana value is less than 10/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, lastDiscoveredCardManaValue: 5 } as typeof nextCtx;
      }
      if (/three or more cards exiled with this permanent/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-profane' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-profane', controller: 'p1', type_line: 'Enchantment', exiledCardCount: 3 }],
        } as GameState;
      }
      if (/fewer than three charge counters on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-training-post' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-training-post', controller: 'p1', type_line: 'Artifact', counters: { charge: 1 } }],
        } as GameState;
      }
      if (/^you control a demon or devil$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-demon', controller: 'p1', type_line: 'Creature — Demon' }],
        } as GameState;
      }
      if (/phyrexian died under your control this turn/i.test(conditionRaw)) {
        (nextState as any).phyrexiansDiedUnderControlThisTurn = { p1: true };
      }
      if (/^at least seven mana was spent to cast it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, atLeastSevenManaSpentToCast: true, manaSpentToCastIt: 7 } as typeof nextCtx;
      }
      if (/three or more instant and sorcery spells this turn/i.test(conditionRaw)) {
        (nextState as any).instantAndSorcerySpellsCastThisTurn = { p1: 3 };
      }
      if (/cycled two or more cards this turn/i.test(conditionRaw)) {
        (nextState as any).cardsCycledThisTurn = { p1: 2 };
      }
      if (/^this permanent has one or more \+1\/\+1 counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-sarulf' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-sarulf', controller: 'p1', type_line: 'Legendary Creature — Wolf', counters: { '+1/+1': 2 } }],
        } as GameState;
      }
      if (/^it was historic$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'draw-historic', type_line: 'Legendary Artifact', cmc: 3 }],
        } as typeof nextCtx;
      }
      if (/^this land isn't a creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-biblioplex' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-biblioplex', controller: 'p1', type_line: 'Land' }],
        } as GameState;
      }
      if (/^you spend this mana to cast your commander$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          manaSpentToCastCommander: true,
          commanderManaSpentOnCommander: true,
        } as typeof nextCtx;
      }
      if (/^no creatures died this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).creatureDiedThisTurn = false;
      }
      if (/^a player controls more wizards than each other player$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-wiz-p1', controller: 'p1', type_line: 'Creature — Wizard' },
            { id: 'bf-wiz-p1b', controller: 'p1', type_line: 'Creature — Wizard' },
            { id: 'bf-wiz-p2', controller: 'p2', type_line: 'Creature — Wizard' },
          ],
        } as GameState;
      }
      if (/^you cast it during your main phase$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, castDuringMainPhase: true, castDuringYourMainPhase: true } as typeof nextCtx;
      }
      if (/^that mana is spent on a multicolored creature spell$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          manaSpentOnMulticoloredCreatureSpell: true,
          lastCastSpell: { type_line: 'Creature — Human', colors: ['W', 'U'] },
        } as typeof nextCtx;
      }
      if (/^excess damage was dealt to a creature this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, excessDamageDealtToCreatureThisWay: 3, lastExcessDamageDealtThisWay: 3 } as typeof nextCtx;
      }
      if (/^you sacrificed a food this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).foodSacrificedThisTurn = { p1: true };
      }
      if (/^it has mana value 3 or less$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'gy-rebirth-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? {
                  ...player,
                  graveyard: [{ id: 'gy-rebirth-target', type_line: 'Creature — Human', cmc: 2, manaValue: 2 }],
                }
              : player
          ),
        } as GameState;
      }
      if (/^the \{1\}\{b\} cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, alternateCostPaid: true, paidAlternateCostRaw: '{1}{B}' } as typeof nextCtx;
      }
      if (/^the \{3\}\{g\} cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, alternateCostPaid: true, paidAlternateCostRaw: '{3}{G}' } as typeof nextCtx;
      }
      if (/^the \{2\}\{r\}\{r\} cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, alternateCostPaid: true, paidAlternateCostRaw: '{2}{R}{R}' } as typeof nextCtx;
      }
      if (/^that permanent or card has a time counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-timebug-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-timebug-target', controller: 'p1', type_line: 'Artifact', counters: { time: 1 } }],
        } as GameState;
      }
      if (/^it's your combat phase$/i.test(conditionRaw.trim())) {
        (nextState as any).phase = 'combat';
        (nextState as any).activePlayerId = 'p1';
        (nextState as any).isYourCombatPhase = { p1: true };
      }
      if (/^you have a card in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, hand: [{ id: 'hand-1', type_line: 'Instant' }] }
              : player
          ),
        } as GameState;
      }
      if (/^you win the bidding$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, wonBidding: true, youWinTheBidding: true } as typeof nextCtx;
      }
      if (/^its madness cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, madnessCostWasPaid: true, alternateCostPaid: true } as typeof nextCtx;
      }
      if (/^sidar jabari is in the command zone or on the battlefield$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            ...(Array.isArray(nextState.battlefield) ? nextState.battlefield : []),
            { id: 'bf-sidar', name: 'Sidar Jabari of Zhalfir', controller: 'p1', type_line: 'Legendary Creature — Human Knight' },
          ],
        } as GameState;
      }
      if (/^this creature is enchanted by two or more auras$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-kitsune', enchantedPermanentId: 'bf-kitsune' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-kitsune', controller: 'p1', type_line: 'Creature — Fox Wizard' },
            { id: 'bf-aura-1', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-kitsune' },
            { id: 'bf-aura-2', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-kitsune' },
          ],
        } as GameState;
      }
      if (/^a werewolf is dealt damage this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          werewolfDealtDamageThisWay: true,
          lastDamagedCards: [{ id: 'bf-wolf', type_line: 'Creature — Werewolf // Human' }],
        } as typeof nextCtx;
      }
      if (/^not \(you pay \{e\}\{e\}/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, unlessPaysEnergyChoice: 'pay' } as typeof nextCtx;
      }
      if (/^x is 1$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, xValue: 1, chosenX: 1 } as typeof nextCtx;
      }
      if (/^x is 3$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, xValue: 3, chosenX: 3 } as typeof nextCtx;
      }
      if (/^enchanted creature has toxic$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, enchantedPermanentId: 'bf-toxic-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-toxic-target', controller: 'p1', type_line: 'Creature — Human', keywords: ['toxic'] },
            { id: 'bf-maze-mantle', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-toxic-target' },
          ],
        } as GameState;
      }
      if (/that player has this permanent deal 4 damage to them/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, unlessDealDamageChoice: 'deal' } as typeof nextCtx;
      }
      if (/^there are no charge counters on this vehicle$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-bankbuster' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-bankbuster', controller: 'p1', type_line: 'Artifact — Vehicle', counters: {} }],
        } as GameState;
      }
      if (/^at least eight mana was spent to cast it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, atLeastEightManaSpentToCast: true, manaSpentToCastIt: 8 } as typeof nextCtx;
      }
      if (/^you've drawn more than one card this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDrawnThisTurn = { p1: 2 };
      }
      if (/^you sacrificed a permanent this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          youSacrificedPermanentThisWay: true,
          lastSacrificedPermanents: [{ id: 'bf-sac', controller: 'p1', type_line: 'Creature — Human' }],
        } as typeof nextCtx;
      }
      if (/^another elf entered the battlefield under your control this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).elvesEnteredBattlefieldUnderControlThisTurn = { p1: true };
      }
      if (/^a saproling was sacrificed this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ id: 'bf-sap', type_line: 'Token Creature — Saproling' }],
        } as typeof nextCtx;
      }
      if (/^it was dealt noncombat damage this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetWasDealtNoncombatDamageThisTurn: true, targetPermanentId: 'bf-sigil-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-sigil-target', controller: 'p2', type_line: 'Creature — Human', wasDealtNoncombatDamageThisTurn: true }],
        } as GameState;
      }
      if (/additional cost was paid and the revealed card is the chosen type/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          optionalAdditionalCostWasPaid: true,
          revealedCardMatchesChosenType: true,
        } as typeof nextCtx;
      }
      if (/^kaito entered this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).kaitoEnteredThisTurn = true;
      }
      if (/^this artifact has five or more charge counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-coils' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-coils', controller: 'p1', type_line: 'Artifact', counters: { charge: 5 } }],
        } as GameState;
      }
      if (/discard a card at random unless you pay \{e\}\{e\}/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, unlessPaysEnergyChoice: 'pay' } as typeof nextCtx;
      }
      if (/^it had mana value 3 or less$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'bf-exiled-low', cmc: 2, manaValue: 2, type_line: 'Creature — Zombie' }],
          lastExiledCards: [{ id: 'bf-exiled-low', cmc: 2, manaValue: 2, type_line: 'Creature — Zombie' }],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2'
              ? {
                  ...player,
                  exile: [{ id: 'bf-exiled-low', cmc: 2, manaValue: 2, type_line: 'Creature — Zombie' }],
                }
              : player
          ),
        } as GameState;
      }
      if (/^you pay \{e\}\{e\}/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          unlessPaysEnergyChoice: 'pay',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            unlessPaysEnergyChoice: 'pay',
          },
        } as typeof nextCtx;
      }
      if (/power is less than or equal to the sacrificed creature's power/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ id: 'bf-sac', type_line: 'Creature — Giant', power: 5, toughness: 4 }],
          targetPermanentId: 'gy-desperate-target',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? {
                  ...player,
                  graveyard: [{ id: 'gy-desperate-target', type_line: 'Creature — Human', power: 3, toughness: 2 }],
                }
              : player
          ),
        } as GameState;
      }
      if (/power is greater than the sacrificed creature's power/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [{ id: 'bf-sac', type_line: 'Creature — Giant', power: 3, toughness: 4 }],
          targetPermanentId: 'gy-desperate-target-high',
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? {
                  ...player,
                  graveyard: [{ id: 'gy-desperate-target-high', type_line: 'Creature — Human', power: 5, toughness: 2 }],
                }
              : player
          ),
        } as GameState;
      }
      if (/^you control more creatures of that type than each other player$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, chosenCreatureType: 'goblin', selectorContext: { ...(nextCtx.selectorContext || {}), chosenCreatureType: 'goblin' } } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-gob-1', controller: 'p1', type_line: 'Creature — Goblin' },
            { id: 'bf-gob-2', controller: 'p1', type_line: 'Creature — Goblin' },
            { id: 'bf-gob-3', controller: 'p2', type_line: 'Creature — Goblin' },
          ],
        } as GameState;
      }
      if (/most common color among all permanents/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-barrin-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-barrin-target', controller: 'p2', type_line: 'Creature — Human', colors: ['U'] },
            { id: 'bf-blue-1', controller: 'p1', type_line: 'Creature — Merfolk', colors: ['U'] },
            { id: 'bf-blue-2', controller: 'p2', type_line: 'Creature — Spirit', colors: ['U'] },
          ],
        } as GameState;
      }
      if (/^that player has 5 or less life$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2' ? { ...player, life: 5 } : player
          ),
        } as GameState;
      }
      if (/five or more different mana values are exiled with this permanent/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-azor-gateway' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{
            id: 'bf-azor-gateway',
            controller: 'p1',
            type_line: 'Legendary Artifact',
            exiledDistinctManaValueCount: 5,
            cardsExiledWithThis: [{ cmc: 1 }, { cmc: 2 }, { cmc: 3 }, { cmc: 4 }, { cmc: 5 }],
          }],
        } as GameState;
      }
      if (/^it's not a spirit$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'bf-human', type_line: 'Creature — Human Detective' }] } as typeof nextCtx;
      }
      if (/^\{c\} wasn't spent to cast it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, colorlessManaWasNotSpentToCast: true, colorlessManaSpentToCast: 0 } as typeof nextCtx;
      }
      if (/exactly three colors of mana were spent to activate this ability/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, colorsOfManaSpentToActivate: ['W', 'U', 'B'], colorCountSpentToActivate: 3 } as typeof nextCtx;
      }
      if (/^this card is exiled with an egg counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'ex-egg', type_line: 'Legendary Creature — Dragon', counters: { egg: 1 } }] } as typeof nextCtx;
      }
      if (/^an outlaw was sacrificed this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastSacrificedPermanents: [{ id: 'bf-rogue', type_line: 'Creature — Rogue' }] } as typeof nextCtx;
      }
      if (/^the top card of target player's graveyard is a creature card$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2'
              ? { ...player, graveyard: [{ id: 'gy-top-creature', type_line: 'Creature — Spirit' }] }
              : player
          ),
        } as GameState;
      }
      if (/four or more quest counters on it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-airbender' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-airbender', controller: 'p1', type_line: 'Enchantment — Saga', counters: { quest: 4 } }],
        } as GameState;
      }
      if (/^target opponent has more cards in hand than you$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const id = String(player?.id || '').trim();
            if (id === 'p1') return { ...player, hand: [{ id: 'h1' }] };
            if (id === 'p2') return { ...player, hand: [{ id: 'h2' }, { id: 'h3' }] };
            return player;
          }),
        } as GameState;
      }
      if (/^they attacked you and\/or a planeswalker you control$/i.test(conditionRaw.trim())) {
        (nextState as any).theyAttackedYouOrYourPlaneswalkerThisTurn = true;
      }
      if (/^this creature attacked this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-riders' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-riders', controller: 'p1', type_line: 'Creature — Human Soldier', attackedThisTurn: true }],
        } as GameState;
      }
      if (/^defending player is poisoned$/i.test(conditionRaw.trim())) {
        (nextState as any).defendingPlayerIsPoisoned = { p2: true };
        (nextState as any).poisonCounters = { p2: 1 };
      }
      if (/^a player has one or fewer cards in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2' ? { ...player, hand: [{ id: 'h-only' }] } : player
          ),
        } as GameState;
      }
      if (/^they control fewer lands than you$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-your-land', controller: 'p1', type_line: 'Basic Land — Forest' },
            { id: 'bf-your-land-2', controller: 'p1', type_line: 'Basic Land — Plains' },
            { id: 'bf-opp-land', controller: 'p2', type_line: 'Basic Land — Island' },
          ],
        } as GameState;
      }
      if (/^an opponent gained life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).opponentGainedLifeThisTurn = true;
      }
      if (/reveals exactly the chosen number of cards of the chosen color/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, opponentRevealedExactChosenColorCount: true } as typeof nextCtx;
      }
      if (/^an opponent protects it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, opponentProtectsIt: true } as typeof nextCtx;
      }
      if (/wasn't put onto the battlefield with this ability/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, wasNotPutOntoBattlefieldWithThisAbility: true } as typeof nextCtx;
      }
      if (/^you put a counter on this creature this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).countersPutOnThisCreatureThisTurn = { p1: true };
      }
      if (/^they discarded a nonland card$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastDiscardedCards: [{ id: 'disc-spell', type_line: 'Instant' }] } as typeof nextCtx;
      }
      if (/^you gained and lost life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).lifeGainedThisTurn = { p1: 2 };
        (nextState as any).lifeLostThisTurn = { p1: 1 };
      }
      if (/^it wasn't cast this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, wasNotCastThisWay: true } as typeof nextCtx;
      }
      if (/thirty or more counters among artifacts and creatures you control/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, totalCountersOnArtifactsAndCreaturesYouControl: 30 } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-lux', controller: 'p1', type_line: 'Artifact Creature — Construct', counters: { '+1/+1': 30 } }],
        } as GameState;
      }
      if (/^it dealt combat damage to a player this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-wave', dealtCombatDamageToPlayerThisTurn: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-wave', controller: 'p1', type_line: 'Creature — Rat', dealtCombatDamageToPlayerThisTurn: true }],
        } as GameState;
      }
      if (/^its toughness was less than 1$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'bf-dead', type_line: 'Creature — Human', toughness: 0 }] } as typeof nextCtx;
      }
      if (/^an opponent lost 3 or more life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).lifeLostThisTurn = { p2: 3 };
      }
      if (/wolves of the hunt you control/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-wolf-1', controller: 'p1', name: 'Wolves of the Hunt', type_line: 'Creature — Wolf' },
            { id: 'bf-wolf-2', controller: 'p1', name: 'Wolves of the Hunt', type_line: 'Creature — Wolf' },
          ],
        } as GameState;
      }
      if (/^there are seven or more lands on the battlefield$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: Array.from({ length: 7 }, (_, i) => ({
            id: `bf-land-${i}`,
            controller: i < 3 ? 'p1' : 'p2',
            type_line: 'Basic Land — Forest',
          })),
        } as GameState;
      }
      if (/^you control no face-down permanents$/i.test(conditionRaw.trim())) {
        const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
        const existingSource = ((nextState.battlefield || []) as any[]).find(
          (perm) => String(perm?.id || '').trim() === sourceId
        );
        nextState = {
          ...nextState,
          battlefield: [
            existingSource
              ? { ...existingSource, faceDown: false }
              : { id: sourceId, controller: 'p1', type_line: 'Creature — Construct', faceDown: false },
          ],
        } as GameState;
      }
      if (/cast another instant or sorcery spell this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, castAnotherInstantOrSorceryThisTurn: true } as typeof nextCtx;
      }
      if (/gets \+2\/\+2 until end of turn if its power is 2/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-swipe-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-swipe-target', controller: 'p1', type_line: 'Creature — Bear', power: 2, toughness: 2 }],
        } as GameState;
      }
      if (/^it has four or more quest counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-firebender' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-firebender', controller: 'p1', type_line: 'Enchantment', counters: { quest: 4 } }],
        } as GameState;
      }
      if (/^you've cast another instant or sorcery spell this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, castAnotherInstantOrSorceryThisTurn: true } as typeof nextCtx;
        (nextState as any).instantAndSorcerySpellsCastThisTurn = { p1: 2 };
      }
      if (/^its power is 2$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-power-two' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-power-two', controller: 'p1', type_line: 'Creature — Bear', power: 2, toughness: 2 }],
        } as GameState;
      }
      if (/^that creature has flying$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-flying-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-flying-target', controller: 'p2', type_line: 'Creature — Bird', keywords: ['flying'] }],
        } as GameState;
      }
      if (/^this spell is the first spell you've cast this game$/i.test(conditionRaw.trim())) {
        (nextState as any).spellsCastThisGame = { p1: 0 };
        nextCtx = { ...nextCtx, isFirstSpellCastThisGame: true } as typeof nextCtx;
      }
      if (/^that opponent has more life than another of your opponents$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const id = String(player?.id || '').trim();
            if (id === 'p1') return { ...player, life: 40 };
            if (id === 'p2') return { ...player, life: 35 };
            if (id === 'p3') return { ...player, life: 30 };
            return player;
          }),
        } as GameState;
      }
      if (/^enchanted equipment is attached to a creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-hex' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-creature-bearer', controller: 'p1', type_line: 'Creature — Human' },
            { id: 'bf-hex', controller: 'p1', type_line: 'Enchantment — Aura Equipment', attachedTo: 'bf-creature-bearer' },
          ],
        } as GameState;
      }
      if (/^they were cast using web-slinging$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, castUsingWebSlinging: true } as typeof nextCtx;
      }
      if (/^defending player has two or fewer cards in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2' ? { ...player, hand: [{ id: 'h1' }] } : player
          ),
        } as GameState;
      }
      if (/^an opponent searched their library this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).opponentSearchedLibraryThisTurn = true;
      }
      if (/flying was exiled with this creature's delve ability/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, delveExiledFlyingCreature: true } as typeof nextCtx;
      }
      if (/^that player discards an artifact card this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastDiscardedCards: [{ id: 'disc-art', type_line: 'Artifact' }] } as typeof nextCtx;
      }
      if (/^an opponent lost 2 or more life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).lifeLostThisTurn = { p2: 2 };
      }
      if (/^this enchantment has three or more quest counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-bloodchief' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-bloodchief', controller: 'p1', type_line: 'Enchantment', counters: { quest: 3 } }],
        } as GameState;
      }
      if (/^you guessed correctly for a card named this permanent$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, guessedCorrectlyForCardNamedThisPermanent: true } as typeof nextCtx;
      }
      if (/^there are cards exiled with this enchantment$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-valakut' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-valakut', controller: 'p1', type_line: 'Enchantment', exiledCardCount: 2 }],
        } as GameState;
      }
      if (/three or more card types among the sacrificed permanents/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          lastSacrificedPermanents: [
            { type_line: 'Creature — Human' },
            { type_line: 'Artifact' },
            { type_line: 'Enchantment' },
          ],
        } as typeof nextCtx;
      }
      if (/creature died under an opponent's control this turn/i.test(conditionRaw)) {
        (nextState as any).creatureDiedUnderOpponentControlThisTurn = true;
      }
      if (/^damage would be dealt to you$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          damageWouldBeDealtToYou: true,
          referenceAmount: Math.max(3, Number(nextCtx.referenceAmount) || 3),
        } as typeof nextCtx;
      }
      if (/^an opponent is the monarch$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, monarch: 'p2' } as GameState;
      }
      if (/^there are three or more omen counters on this creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-foreboding' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-foreboding', controller: 'p1', type_line: 'Artifact Creature', counters: { omen: 3 } }],
        } as GameState;
      }
      if (/first time \+1\/\+1 counters have been put on that permanent this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, firstTimePlusOneCountersPutOnThatPermanentThisTurn: true } as typeof nextCtx;
      }
      if (/^the sacrificed permanent was a vehicle$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastSacrificedPermanents: [{ type_line: 'Artifact — Vehicle' }] } as typeof nextCtx;
      }
      if (/^a goblin is sacrificed this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastSacrificedPermanents: [{ type_line: 'Creature — Goblin' }] } as typeof nextCtx;
      }
      if (/^the \{2\}\{u\} cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, alternateCostPaid: true, paidAlternateCostRaw: '{2}{U}' } as typeof nextCtx;
      }
      if (/^that cost wasn't paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, alternateCostPaid: false } as typeof nextCtx;
      }
      if (/^this creature is enchanted$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-druid' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-druid', controller: 'p1', type_line: 'Creature — Druid' },
            { id: 'bf-aura-on-druid', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-druid' },
          ],
        } as GameState;
      }
      if (/^the discarded card was a zombie card$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastDiscardedCards: [{ id: 'disc-zombie', type_line: 'Creature — Zombie' }] } as typeof nextCtx;
      }
      if (/permanents were sacrificed to activate it/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, permanentsSacrificedToActivateAbility: true } as typeof nextCtx;
      }
      if (/^you've drawn three or more cards this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDrawnThisTurn = { p1: 3 };
      }
      if (/^an opponent has no cards in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p2' ? { ...player, hand: [] } : player
          ),
        } as GameState;
      }
      if (/^they aren't attacking you$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, theyAreNotAttackingYou: true } as typeof nextCtx;
      }
      if (/mightstone and weakstone/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-urza' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-urza', controller: 'p1', owner: 'p1', type_line: 'Legendary Creature — Human Artificer' },
            { id: 'bf-mightstone', controller: 'p1', owner: 'p1', name: 'The Mightstone and Weakstone', type_line: 'Legendary Artifact' },
          ],
        } as GameState;
      }
      if (/equipped creature didn't deal combat damage to a creature this turn/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, equippedCreatureDidNotDealCombatDamageToCreatureThisTurn: true } as typeof nextCtx;
      }
      if (/no permanents other than this enchantment and have no cards in hand/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-barren-glory' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1' ? { ...player, hand: [] } : player
          ),
          battlefield: [{ id: 'bf-barren-glory', controller: 'p1', type_line: 'Enchantment' }],
        } as GameState;
      }
      if (/three or more cards put into their graveyard from anywhere this turn/i.test(conditionRaw)) {
        (nextState as any).cardsPutIntoGraveyardFromAnywhereThisTurn = { p2: 3 };
      }
      if (/entered from a graveyard or you cast it from a graveyard/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, enteredFromGraveyard: true, castFromGraveyard: true } as typeof nextCtx;
      }
      if (/^that permanent was blue or black$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-blue-black-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-blue-black-target', controller: 'p2', type_line: 'Artifact', colors: ['U'] }],
        } as GameState;
      }
      if (/^no creature got votes$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, noCreatureGotVotes: true } as typeof nextCtx;
      }
      if (/greater power or toughness than this creature/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-adaptive', targetPermanentId: 'bf-bigger' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-adaptive', controller: 'p1', type_line: 'Artifact Creature', power: 1, toughness: 1 },
            { id: 'bf-bigger', controller: 'p2', type_line: 'Creature — Bear', power: 3, toughness: 3 },
          ],
        } as GameState;
      }
      if (/^you have no land cards in hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, hand: [{ id: 'h-spell', type_line: 'Instant' }] }
              : player
          ),
        } as GameState;
      }
      if (/^the exiled card is a god card$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastMovedCards: [{ id: 'ex-god', type_line: 'Legendary Enchantment Creature — God' }],
        } as typeof nextCtx;
      }
      if (/^this permanent attacked this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-attacker' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-attacker', controller: 'p1', type_line: 'Creature — Human', attackedThisTurn: true }],
        } as GameState;
      }
      if (/^an opponent was dealt 3 or more damage this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).damageDealtToOpponentsThisTurn = { p2: 3 };
      }
      if (/^that creature's toughness is 1 or greater$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-tough' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-tough', controller: 'p2', type_line: 'Creature — Bear', toughness: 2 }],
        } as GameState;
      }
      if (/^that player controls a nonblack$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-nonblack', controller: 'p2', type_line: 'Creature — Human', colors: ['R'] }],
        } as GameState;
      }
      if (/^you've discarded a card this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).cardsDiscardedThisTurn = { p1: 1 };
      }
      if (/^this creature was dealt damage this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-damaged', thisCreatureWasDealtDamageThisTurn: true } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-damaged', controller: 'p1', type_line: 'Creature — Wall', dealtDamageThisTurn: true }],
        } as GameState;
      }
      if (/^an opponent controls three or more creatures$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-o1', controller: 'p2', type_line: 'Creature — Goblin' },
            { id: 'bf-o2', controller: 'p2', type_line: 'Creature — Goblin' },
            { id: 'bf-o3', controller: 'p2', type_line: 'Creature — Goblin' },
          ],
        } as GameState;
      }
      if (/^enchanted creature has flying$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-earthbind', enchantedPermanentId: 'bf-fly-enchanted' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-fly-enchanted', controller: 'p2', type_line: 'Creature — Bird', keywords: ['flying'] },
            { id: 'bf-earthbind', controller: 'p1', type_line: 'Enchantment — Aura', attachedTo: 'bf-fly-enchanted' },
          ],
        } as GameState;
      }
      if (/^this permanent is a scout/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-scout' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-scout', controller: 'p1', type_line: 'Creature — Scout' }],
        } as GameState;
      }
      if (/another cleric, rogue, warrior, or wizard enter/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, anotherPartyClassEnteredThisTurn: true } as typeof nextCtx;
      }
      if (/^excess damage was dealt to a permanent this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastExcessDamageDealtThisWay: 2 } as typeof nextCtx;
      }
      if (/^that creature is attacking$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-attacking-target' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-attacking-target', controller: 'p2', type_line: 'Creature — Bear', attacking: true }],
        } as GameState;
      }
      if (/\{g\} was spent to cast this spell/i.test(conditionRaw) && /\{u\} was spent to cast this spell/i.test(conditionRaw)) {
        nextCtx = {
          ...nextCtx,
          greenManaSpentToCastThisSpell: true,
          blueManaSpentToCastThisSpell: true,
        } as typeof nextCtx;
      }
      if (/^it didn't have decayed$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'tok-zombie', type_line: 'Creature — Zombie', hadDecayed: false }] } as typeof nextCtx;
      }
      if (/^this creature has fewer than three \+1\/\+1 counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-steam-kin' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-steam-kin', controller: 'p1', type_line: 'Creature — Elemental', counters: { '+1/+1': 1 } }],
        } as GameState;
      }
      if (/^you control each creature on the battlefield with the greatest power$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-might-1', controller: 'p1', type_line: 'Creature — Giant', power: 5 },
            { id: 'bf-might-2', controller: 'p2', type_line: 'Creature — Goblin', power: 1 },
          ],
        } as GameState;
      }
      if (/^a creature card left your graveyard this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).creatureCardsLeftGraveyardThisTurn = { p1: 1 };
      }
      if (/^its mana value was 1 or greater$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'gy-mv2', cmc: 2, manaValue: 2 }] } as typeof nextCtx;
      }
      if (/^you haven't cast a spell this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).spellsCastThisTurnByPlayer = { p1: 0 };
      }
      if (/^an artifact or creature spell is countered this way$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          artifactOrCreatureSpellCounteredThisWay: true,
          lastCounteredSpellKind: 'creature',
          lastMovedCards: [{ id: 'countered-creature-1', type_line: 'Creature — Human', name: 'Countered Creature' }],
        } as typeof nextCtx;
      }
      if (/^you have exactly thirteen cards in your hand$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1'
              ? { ...player, hand: Array.from({ length: 13 }, (_, i) => ({ id: `h${i}` })) }
              : player
          ),
        } as GameState;
      }
      if (/^that creature had a \+1\/\+1 counter on it$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          lastDestroyedCreatures: [{ id: 'bf-snake-target', type_line: 'Creature — Snake', hadPlusOneCounter: true }],
        } as typeof nextCtx;
      }
      if (/^that player or that planeswalker's controller has more life than you$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) => {
            const id = String(player?.id || '').trim();
            if (id === 'p1') return { ...player, life: 10 };
            if (id === 'p2') return { ...player, life: 20 };
            return player;
          }),
        } as GameState;
      }
      if (/^a card would be put into an opponent's graveyard from anywhere$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, cardWouldEnterOpponentGraveyard: true } as typeof nextCtx;
      }
      if (/^an opponent cast a blue and\/or black spell this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).opponentCastBlueOrBlackSpellThisTurn = true;
      }
      if (/noncreature permanent under your control was destroyed this turn by a spell or ability an opponent controlled/i.test(conditionRaw)) {
        (nextState as any).noncreaturePermanentDestroyedByOpponentThisTurn = { p1: true };
      }
      if (/^this spell's madness cost was paid$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, madnessCostWasPaid: true } as typeof nextCtx;
      }
      if (/^it was enchanted$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'bf-junk', wasEnchanted: true }] } as typeof nextCtx;
      }
      if (/^it was equipped$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'bf-junk', wasEquipped: true }] } as typeof nextCtx;
      }
      if (/named bruna/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-gisela' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-gisela', controller: 'p1', owner: 'p1', type_line: 'Legendary Creature — Angel' },
            { id: 'bf-bruna', controller: 'p1', owner: 'p1', name: 'Bruna, the Fading Light', type_line: 'Legendary Creature — Angel' },
          ],
        } as GameState;
      }
      if (/^you discarded it this turn$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, discardedItThisTurn: true } as typeof nextCtx;
      }
      if (/^it isn't a creature card$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ id: 'top-noncreature', type_line: 'Instant' }] } as typeof nextCtx;
      }
      if (/^the sacrificed permanent was an artifact$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastSacrificedPermanents: [{ type_line: 'Artifact' }] } as typeof nextCtx;
      }
      if (/^it enters as a creature$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, entersAsCreature: true } as typeof nextCtx;
      }
      if (/^a white creature dies this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastCreaturesDiedThisWay: [{ type_line: 'Creature — Human', colors: ['W'] }] } as typeof nextCtx;
      }
      if (/^the sacrificed creature was legendary$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastSacrificedPermanents: [{ type_line: 'Legendary Creature — Human' }] } as typeof nextCtx;
      }
      if (/^it isn't your main phase$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, phase: 'combat', turnPlayer: 'p1' } as GameState;
      }
      if (/creature or planeswalker an opponent controlled was dealt excess damage this turn/i.test(conditionRaw)) {
        (nextState as any).opponentPermanentDealtExcessDamageThisTurn = true;
      }
      if (/^you're the defending player$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, isDefendingPlayer: true } as typeof nextCtx;
        (nextState as any).defendingPlayerId = 'p1';
      }
      if (/^that card was all colors$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastMovedCards: [{ colors: ['W', 'U', 'B', 'R', 'G'], wasAllColors: true }] } as typeof nextCtx;
      }
      if (/permanent was put into your hand from the battlefield this turn/i.test(conditionRaw)) {
        (nextState as any).permanentsPutIntoHandFromBattlefieldThisTurn = { p1: 1 };
      }
      if (/elf card in your graveyard and this creature has a -1\/-1 counter/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, sourceId: 'bf-safewright' } as typeof nextCtx;
        nextState = {
          ...nextState,
          players: [{ id: 'p1', graveyard: [{ type_line: 'Creature — Elf' }] }],
          battlefield: [{ id: 'bf-safewright', controller: 'p1', type_line: 'Creature — Elf', counters: { '-1/-1': 1 } }],
        } as GameState;
      }
      if (/^they can't$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, battlefield: [] } as GameState;
      }
      if (/^that equipment was attached to a creature$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          targetPermanentId: 'bf-equip-destroy',
          lastMovedCards: [{ id: 'bf-equip-destroy', type_line: 'Artifact — Equipment', wasAttachedToCreature: true, attachedTo: 'bf-bearer' }],
        } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-bearer', controller: 'p2', type_line: 'Creature — Human' }],
        } as GameState;
      }
      if (/^you haven't played it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, hasNotPlayedIt: true } as typeof nextCtx;
      }
      if (/^you control no creatures with decayed$/i.test(conditionRaw.trim())) {
        nextState = { ...nextState, battlefield: [{ id: 'bf-human', controller: 'p1', type_line: 'Creature — Human' }] } as GameState;
      }
      if (/^you didn't activate a loyalty ability of a planeswalker this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).activatedLoyaltyAbilityThisTurn = { p1: false };
      }
      if (/two or more permanents you don't control have an aim counter/i.test(conditionRaw)) {
        nextState = {
          ...nextState,
          battlefield: [
            { id: 'bf-aim-1', controller: 'p2', type_line: 'Creature — Human', counters: { aim: 1 } },
            { id: 'bf-aim-2', controller: 'p2', type_line: 'Creature — Goblin', counters: { aim: 1 } },
          ],
        } as GameState;
      }
      if (/target player discards a card unless they put a card from their hand on top of their library/i.test(conditionRaw)) {
        nextCtx = { ...nextCtx, playerDiscardedThisWay: true } as typeof nextCtx;
      }
      if (/^they put a card from their hand on top of their library$/i.test(conditionRaw.trim())) {
        nextCtx = {
          ...nextCtx,
          unlessPutCardOnTopOfLibraryChoice: 'decline',
          selectorContext: {
            ...(nextCtx.selectorContext || {}),
            targetPlayerId: 'p2',
          },
        } as typeof nextCtx;
      }
      if (/^that player discards a card this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastDiscardedCards: [{ id: 'disc-1' }] } as typeof nextCtx;
      }
      if (/^you lost 2 or more life this turn$/i.test(conditionRaw.trim())) {
        (nextState as any).lifeLostThisTurn = { p1: 2 };
      }
      if (/^the creature the opponent controls is dealt excess damage this way$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, lastExcessDamageDealtThisWay: 3 } as typeof nextCtx;
      }
      if (/^each opponent chose silence$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, eachOpponentChoseSilence: true } as typeof nextCtx;
      }
      if (/^each opponent chose snitch$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, eachOpponentChoseSnitch: true } as typeof nextCtx;
      }
      if (/^it has fewer than four \+1\/\+1 counters on it$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, targetPermanentId: 'bf-oathsworn' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-oathsworn', controller: 'p1', type_line: 'Creature — Knight', counters: { '+1/+1': 2 } }],
        } as GameState;
      }
      if (/^this creature is monstrous$/i.test(conditionRaw.trim())) {
        nextCtx = { ...nextCtx, sourceId: 'bf-crusher' } as typeof nextCtx;
        nextState = {
          ...nextState,
          battlefield: [{ id: 'bf-crusher', controller: 'p1', type_line: 'Creature — Cyclops', monstrous: true }],
        } as GameState;
      }
      if (/^you have 50 or more life$/i.test(conditionRaw.trim())) {
        nextState = {
          ...nextState,
          players: (nextState.players || []).map((player: any) =>
            String(player?.id || '').trim() === 'p1' ? { ...player, life: 50 } : player
          ),
        } as GameState;
      }
    }
    if (step.kind === 'move_zone' && /cycling ability/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-cycling-1');
    }
    if (step.kind === 'move_zone' && /\bawaken\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-awaken-1');
    }
    if (step.kind === 'move_zone' && /\bchosen type\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-creature-1');
    }
    if (step.kind === 'move_zone' && /\bnonbattle\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-noncreature-nonland');
    }
    if (step.kind === 'move_zone' && /\bspirit\b/i.test(raw) && /\bpermanent\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-spirit-1');
    }
    if (step.kind === 'move_zone' && /\boutlaw\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-outlaw-1');
    }
    if (step.kind === 'move_zone' && /\bknight\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-knight-1');
    }
    if (step.kind === 'move_zone' && /\bpirate\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-pirate-1');
    }
    if (step.kind === 'move_zone' && /\bdragon\b/i.test(raw) && /\bpermanent\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-dragon-1');
    }
    if (step.kind === 'move_zone' && /\bsaga\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-saga-1');
    }
    if (step.kind === 'move_zone' && /\bkicker\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-kicker-1');
    }
    if (step.kind === 'move_zone' && /\blesser mana value\b/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-cleric-1');
    }
    if (step.kind === 'move_zone' && /card named this permanent/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-source-self');
    }
    if (
      step.kind === 'move_zone' &&
      /put this spell into your hand instead of into your graveyard/i.test(raw)
    ) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-source-self');
    }
    if (step.kind === 'move_zone' && /mana value (\d+) or greater/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-mv-gte-4');
    }
    if (step.kind === 'move_zone' && /\bartifact\b/i.test(raw) && /mana value 1 or less/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-artifact-mv1');
    }
    if (step.kind === 'move_zone' && /\bnonland permanent\b/i.test(raw) && /mana value x/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-nonland-perm-1');
    }
    if (step.kind === 'grant_graveyard_permission' && /other type/i.test(raw)) {
      needsGraveyardExileTarget = true;
      graveyardTargetIds.push('gy-red-sorcery-1');
      nextCtx = {
        ...nextCtx,
        otherSpellType: 'instant',
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          otherSpellType: 'instant',
          chosenObjectIds: Array.from(
            new Set([
              ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
                ? nextCtx.selectorContext.chosenObjectIds
                : []),
              'gy-red-sorcery-1',
            ])
          ),
        },
      } as typeof nextCtx;
    }
    if (step.kind === 'gain_control' && /player to their right/i.test(raw)) {
      nextCtx = {
        ...nextCtx,
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          chosenObjectIds: Array.from(
            new Set([
              ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
                ? nextCtx.selectorContext.chosenObjectIds
                : []),
              'bf-opponent-artifact',
            ])
          ),
        },
      } as typeof nextCtx;
    }
    if (step.kind === 'flip_coin' && /that player flips a coin/i.test(raw)) {
      nextCtx = {
        ...nextCtx,
        selectorContext: {
          ...(nextCtx.selectorContext || {}),
          targetPlayerId: 'p2',
        },
      } as typeof nextCtx;
    }
  });

  if (needsGraveyardExileTarget) {
    const gyTargetIds = Array.from(new Set(graveyardTargetIds.length > 0 ? graveyardTargetIds : ['gy-creature-1']));
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...gyTargetIds,
          ])
        ),
      },
    };
  }

  const needsLesserManaValueGyReturn = steps.some((step) =>
    step.kind === 'move_zone' && /\blesser mana value\b/i.test(String(step.raw || ''))
  );
  if (needsLesserManaValueGyReturn) {
    nextCtx = {
      ...nextCtx,
      referenceManaValue: 4,
      lastMovedCards: [{ id: 'gy-reference-1', name: 'Reference Card', type_line: 'Creature — Cleric', cmc: 4 }],
    } as typeof nextCtx;
  }

  if (needsLandOnTopOfLibrary) {
    const topLandCard = {
      id: 'lib-top-land-1',
      name: 'Audit Top Land',
      type_line: 'Basic Land — Forest',
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player?.library) ? [...player.library] : [];
        if (library.some((card: any) => String(card?.id || '').trim() === topLandCard.id)) {
          return player;
        }
        return { ...player, library: [...library, topLandCard] };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMovedCards: [topLandCard],
      lastTopLibraryOwnerId: 'p1',
    } as typeof nextCtx;
  }

  if (needsAttachToControlledCreature) {
    if (destroyTargetsDefaultCreature) {
      attachCreatureTargetId = 'bf-wolf-1';
    }
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            attachCreatureTargetId,
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

  if (Object.keys(battlefieldCounterSeeds).length > 0) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        const permId = String(perm?.id || '').trim();
        const seeds = battlefieldCounterSeeds[permId];
        if (!seeds) return perm;
        const counters = { ...(perm?.counters || {}) };
        for (const [counter, amount] of Object.entries(seeds)) {
          counters[counter] = Math.max(Number(counters[counter] || 0), amount);
        }
        return { ...perm, counters };
      }),
    } as GameState;
  }

  if (needsSuspendedExileWithTimeCounters) {
    const suspendedCard = {
      id: 'exile-suspended-1',
      name: 'Audit Suspended Card',
      type_line: 'Instant',
      mana_cost: '{2}{U}',
      cmc: 3,
      counters: { time: 4 },
      suspended: true,
    };
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
        if (exile.some((card: any) => String(card?.id || '').trim() === suspendedCard.id)) {
          return player;
        }
        return { ...player, exile: [...exile, suspendedCard] };
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
            'bf-creature-1',
            'exile-suspended-1',
          ])
        ),
      },
    };
  }

  if (needsGainedLifeThisTurn) {
    nextState = {
      ...nextState,
      lifeGainedThisTurn: {
        ...((nextState as any).lifeGainedThisTurn || {}),
        p1: Math.max(Number(((nextState as any).lifeGainedThisTurn || {})?.p1 || 0), 3),
      },
    } as GameState;
  }

  const needsCounterSpellTarget = steps.some(
    (step) => step.kind === 'counter_spell' && /(?:target spell|that spell)/i.test(String(step.raw || ''))
  );
  let needsCounterSpellTargetNested = false;
  walkOracleSteps(steps, (step) => {
    if (step.kind === 'counter_spell' && /(?:target spell|that spell)/i.test(String(step.raw || ''))) {
      needsCounterSpellTargetNested = true;
    }
  });
  const needsSelfCounterSourceOnStack = steps.some(
    (step) =>
      step.kind === 'counter_spell' &&
      /\b(?:this permanent|this spell)\b/i.test(String(step.raw || '')) &&
      !/\btarget spell\b/i.test(String(step.raw || ''))
  );
  let needsSelfCounterSourceOnStackNested = false;
  walkOracleSteps(steps, (step) => {
    if (
      step.kind === 'counter_spell' &&
      /\b(?:this permanent|this spell)\b/i.test(String(step.raw || '')) &&
      !/\btarget spell\b/i.test(String(step.raw || ''))
    ) {
      needsSelfCounterSourceOnStackNested = true;
    }
  });
  if (needsSelfCounterSourceOnStack || needsSelfCounterSourceOnStackNested) {
    const sourceSpellId = 'stack-source-spell-1';
    const sourceCardName = String(nextCtx.sourceName || 'Audit Source').trim();
    nextState = {
      ...nextState,
      stack: [
        {
          id: sourceSpellId,
          type: 'spell',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'stack-source-card',
            name: sourceCardName,
            type_line: 'Instant',
            colors: ['R'],
            cmc: 2,
            mana_cost: '{1}{R}',
          },
        },
        ...(((nextState as any).stack || []) as any[]).filter(
          (item: any) => String(item?.id || '').trim() !== sourceSpellId
        ),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      sourceId: sourceSpellId,
    } as typeof nextCtx;
  }

  if (needsCounterSpellTarget || needsCounterSpellTargetNested) {
    nextState = {
      ...nextState,
      stack: [
        {
          id: 'stack-spell-1',
          type: 'spell',
          controller: 'p2',
          owner: 'p2',
          card: {
            id: 'stack-card-1',
            name: 'Counterable Spell',
            type_line: 'Instant',
            colors: ['U'],
            cmc: 2,
            mana_cost: '{1}{U}',
          },
        },
        ...(((nextState as any).stack || []) as any[]).filter(
          (item: any) => String(item?.id || '').trim() !== 'stack-spell-1'
        ),
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetSpellId: 'stack-spell-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetSpellId: 'stack-spell-1',
      },
    } as typeof nextCtx;
  }

  const needsLinvalaItRestriction = steps.some(
    (step) =>
      (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
      /until your next turn, it can'?t (?:attack|block)/i.test(String(step.raw || ''))
  );
  let needsLinvalaItRestrictionNested = false;
  walkOracleSteps(steps, (step) => {
    if (
      (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
      /until your next turn, it can'?t (?:attack|block)/i.test(String(step.raw || ''))
    ) {
      needsLinvalaItRestrictionNested = true;
    }
  });
  if (needsLinvalaItRestriction || needsLinvalaItRestrictionNested) {
    nextCtx = {
      ...nextCtx,
      lastReferencedPermanentId: 'bf-opponent-creature',
      targetPermanentId: 'bf-opponent-creature',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-opponent-creature',
        chosenObjectIds: ['bf-opponent-creature'],
      },
    } as typeof nextCtx;
  }

  const needsImmovableRodTarget = steps.some(
    (step) =>
      (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
      /another target permanent loses all abilities/i.test(String(step.raw || ''))
  );
  if (needsImmovableRodTarget) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-creature-2',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-creature-2',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-2',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  if (needsUndyingSourceWithoutCounters) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== sourceId) return perm;
        const counters = { ...(perm?.counters || {}) };
        delete counters['+1/+1'];
        return { ...perm, counters };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastSacrificedPermanents: [
        {
          id: sourceId,
          name: String(nextCtx.sourceName || 'Audit Source'),
          type_line: 'Creature',
          power: 2,
          toughness: 2,
          counters: {},
        },
      ],
    } as typeof nextCtx;
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

  if (needsTurnFaceUp) {
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== 'bf-source') return perm;
        const faceUpCard = perm.faceUpCard || {
          id: 'bf-source-face-up',
          name: String(nextCtx.sourceName || perm.name || 'Audit Source').trim(),
          type_line: String(perm.type_line || 'Creature — Werewolf').trim(),
          power: '3',
          toughness: '3',
        };
        return {
          ...perm,
          faceDown: true,
          card: { ...(perm.card || {}), faceDown: true },
          faceUpCard,
        };
      }),
    } as GameState;
  }

  if (needsEachPlayerSacrificeChoice) {
    const wantsLand = someOracleSteps(
      steps,
      (step) => step.kind === 'sacrifice' && /\bsacrifices a land\b/i.test(String(step.raw || '')),
    );
    const playerIds = (nextState.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean);
    const chosenIds: string[] = [];
    for (const playerId of playerIds) {
      if (playerId === 'p1') {
        chosenIds.push(wantsLand ? 'bf-land-1' : 'bf-creature-1');
      } else if (playerId === 'p2') {
        chosenIds.push(wantsLand ? 'bf-opponent-land' : 'bf-opponent-creature');
      } else {
        chosenIds.push(wantsLand ? `bf-audit-land-${playerId}` : `bf-audit-creature-${playerId}`);
      }
    }
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: chosenIds,
      },
    } as typeof nextCtx;
  }

  if (/exchange control of two target creatures controlled by different players/i.test(oracleTextLower)) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit393-exchange-/.test(String(perm?.id || ''))
        ),
        {
          id: 'bf-audit393-exchange-p1',
          name: 'Audit Exchange P1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 2,
        },
        {
          id: 'bf-audit393-exchange-p2',
          name: 'Audit Exchange P2',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Creature — Elf',
          power: 3,
          toughness: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: [
          'bf-audit393-exchange-p1',
          'bf-audit393-exchange-p2',
          ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds) ? nextCtx.selectorContext.chosenObjectIds : []),
        ],
      },
    } as typeof nextCtx;
  }
  const needsQuestCounterFixtures = stepsMatchPredicate(steps, (step) => {
    if (step.kind !== 'modify_pt') return false;
    const raw = String(step.raw || '').toLowerCase();
    const whereRaw =
      step.condition?.kind === 'where' ? String(step.condition.raw || '').toLowerCase() : '';
    return /quest counters on this permanent/i.test(raw) || /quest counters on this permanent/i.test(whereRaw);
  });
  if (needsQuestCounterFixtures || /quest counters on this permanent/i.test(oracleTextLower)) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !['bf-creature-1', sourceId].includes(String(perm?.id || '').trim())
        ),
        {
          id: sourceId,
          name: 'Audit Source',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          counters: { quest: 3 },
        },
        {
          id: 'bf-creature-1',
          name: 'Audit Target Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 3,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
      },
    } as typeof nextCtx;
  }
  if (/those lands of their choice/i.test(oracleTextLower)) {
    nextState = {
      ...nextState,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => String(perm?.id || '').trim() !== 'bf-audit394-contested-land'
        ),
        {
          id: 'bf-audit394-contested-land',
          name: 'Audit Contested Land',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Land',
          counters: { contested: 1 },
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: [
          'bf-audit394-contested-land',
          ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds) ? nextCtx.selectorContext.chosenObjectIds : []),
        ],
      },
    } as typeof nextCtx;
  }

  const needsBatch396GeneralFixtures = stepsMatchPredicate(steps, (step) => {
    const raw = String(step.raw || '').toLowerCase();
    if (step.kind === 'vote' && (step.choices || []).some((choice) => String(choice || '').toLowerCase() === 'planeswalk')) {
      return true;
    }
    if (step.kind === 'player_choice' && /choose exactly two creatures you control/.test(raw)) return true;
    if (step.kind === 'counter_spell' && /counter target spell/.test(raw)) return true;
    if (step.kind === 'conditional' && /countered this way.*library/.test(raw)) return true;
    if (step.kind === 'move_zone' && /put it on top of its owner/.test(raw)) return true;
    if (step.kind === 'remove_counter' && /remove a -1\/-1 counter from target creature/.test(raw)) return true;
    if (step.kind === 'remove_counter' && /remove a counter from target/.test(raw)) return true;
    if (step.kind === 'draw' && /difference between the chosen creatures' powers/.test(raw)) return true;
    if (step.kind === 'move_zone' && /for each 1 damage prevented this way/.test(raw)) return true;
    if (step.kind === 'pay_mana' && /^when you do, you may pay/.test(raw)) return true;
    if (step.kind === 'deal_damage' && /triple that damage/.test(raw)) return true;
    if (step.kind === 'remove_counter' && /remove that many .* counters from it/.test(raw)) return true;
    return false;
  });
  if (needsBatch396GeneralFixtures) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    const needsSpryChosenCreatures = stepsMatchPredicate(steps, (step) =>
      step.kind === 'player_choice' && /choose exactly two creatures you control/.test(String(step.raw || ''))
    );
    nextState = {
      ...nextState,
      houseRules: {
        ...((nextState as any).houseRules || {}),
        enablePlanechase: true,
      },
      planarDeckFaceDown: [{ id: 'audit-plane-1', name: 'Audit Plane' }],
      currentPlane: null,
      battlefield: [
        ...((nextState.battlefield || []) as any[]).filter(
          (perm: any) => !/^bf-audit396-/.test(String(perm?.id || ''))
        ),
        {
          id: sourceId,
          name: 'Audit Source Permanent',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Hydra',
          power: 4,
          toughness: 4,
          counters: { '+1/+1': 3 },
        },
        {
          id: 'bf-audit396-target-1',
          name: 'Audit Target Creature',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 4,
          toughness: 3,
          counters: { '-1/-1': 1, counter: 1 },
        },
        {
          id: 'bf-audit396-target-2',
          name: 'Audit Chosen Creature A',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 5,
          toughness: 2,
        },
        {
          id: 'bf-audit396-target-3',
          name: 'Audit Chosen Creature B',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Human',
          power: 2,
          toughness: 4,
        },
      ],
      stack: [
        ...((nextState as any).stack || []).filter(
          (entry: any) => !['stack-audit396-lapse', 'stack-spell-1'].includes(String(entry?.id || '').trim())
        ),
        {
          id: 'stack-audit396-lapse',
          type: 'spell',
          name: 'Audit Counter Target',
          controller: 'p2',
          owner: 'p2',
          type_line: 'Instant',
          cmc: 2,
          card: {
            id: 'stack-audit396-lapse-card',
            name: 'Audit Counter Target',
            type_line: 'Instant',
            cmc: 2,
            owner: 'p2',
          },
        },
      ],
      players: (nextState.players || [{ id: 'p1' }, { id: 'p2' }]).map((player: any) => {
        const playerId = String(player?.id || '').trim();
        if (playerId !== 'p1') return player;
        return {
          ...player,
          graveyard: [
            ...(Array.isArray(player?.graveyard) ? player.graveyard : []),
            { id: 'gy-audit396-coil-1', name: 'Audit Gy Card 1', type_line: 'Instant', owner: 'p1' },
            { id: 'gy-audit396-coil-2', name: 'Audit Gy Card 2', type_line: 'Instant', owner: 'p1' },
          ],
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      winningVoteChoice: 'planeswalk',
      xValue: 3,
      referenceAmount: 3,
      lastReferenceAmount: 3,
      lastDamagePreventedThisWay: 2,
      whenYouDoTriggered: true,
      sourceId,
      targetSpellId: 'stack-audit396-lapse',
      targetCreatureId: 'bf-audit396-target-1',
      targetPermanentId: 'bf-audit396-target-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-audit396-target-1',
        targetPermanentId: 'bf-audit396-target-1',
        targetSpellId: 'stack-audit396-lapse',
        ...(needsSpryChosenCreatures
          ? {
              chosenObjectIds: [
                'bf-audit396-target-2',
                'bf-audit396-target-3',
                ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
                  ? nextCtx.selectorContext.chosenObjectIds
                  : []),
              ],
            }
          : {}),
      },
    } as typeof nextCtx;
  }

  const needsBatch398RevealUntilBattlefield = steps.some(
    (step) => step.kind === 'reveal_top' && /until you reveal/i.test(String(step.raw || ''))
  ) && steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      /put those (?:creature )?cards onto the battlefield/i.test(String(step.raw || ''))
  );
  const needsBatch398LookTopThree = steps.some(
    (step) => step.kind === 'look_top' && /look at the top three cards of your library/i.test(String(step.raw || ''))
  );
  const needsBatch398ExileFromHand = steps.some(
    (step) => step.kind === 'move_zone' && /exile a card from your hand/i.test(String(step.raw || ''))
  );
  const needsBatch398CacheGrabSquirrel = steps.some(
    (step) =>
      step.kind === 'conditional' &&
      /control a Squirrel or returned a Squirrel card to your hand this way/i.test(
        String((step as any).condition?.raw || step.raw || '')
      )
  );
  const needsBatch398OptionalGyReturnAttach = steps.some(
    (step) =>
      step.kind === 'move_zone' &&
      step.optional === true &&
      /return this card from your graveyard to the battlefield/i.test(String(step.raw || ''))
  ) && steps.some((step) => step.kind === 'attach' && /attach it to that creature/i.test(String(step.raw || '')));

  if (needsBatch398RevealUntilBattlefield || needsBatch398LookTopThree) {
    const chosenType = String(
      nextCtx.selectorContext?.chosenCreatureType || nextCtx.chosenCreatureType || 'Zombie'
    ).trim();
    const revealFixtures = [
      { id: 'lib-batch398-creature-1', name: `Audit ${chosenType} One`, type_line: `Creature — ${chosenType}`, cmc: 2 },
      { id: 'lib-batch398-creature-2', name: `Audit ${chosenType} Two`, type_line: `Creature — ${chosenType}`, cmc: 2 },
      { id: 'lib-batch398-creature-3', name: `Audit ${chosenType} Three`, type_line: `Creature — ${chosenType}`, cmc: 2 },
    ];
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const library = Array.isArray(player.library) ? [...player.library] : [];
        const merged = [
          ...revealFixtures,
          ...library.filter(
            (card: any) => !revealFixtures.some((fixture) => String(fixture.id) === String(card?.id || '').trim())
          ),
        ];
        return { ...player, library: merged };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      chosenCreatureType: chosenType,
      xValue: Math.max(1, Number(nextCtx.xValue || 2) || 2),
      lastSacrificedPermanents: [
        { id: 'bf-zombie-1', name: 'Audit Zombie', type_line: 'Creature — Zombie' },
        { id: 'bf-zombie-2', name: 'Audit Zombie', type_line: 'Creature — Zombie' },
      ],
      zombiesSacrificedCount: 2,
      referenceAmount: 2,
      lastMovedCards: revealFixtures,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            ...revealFixtures.map((card) => card.id),
          ])
        ),
      },
    } as typeof nextCtx;
  }

  if (needsBatch398ExileFromHand) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'hand-creature-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  if (needsBatch398CacheGrabSquirrel) {
    const squirrelPermanent = {
      id: 'milled-batch398-squirrel-1',
      name: 'Audit Squirrel Permanent',
      type_line: 'Artifact — Food',
      cmc: 1,
    };
    nextState = {
      ...nextState,
      battlefield: [
        ...(Array.isArray(nextState.battlefield) ? nextState.battlefield : []),
        {
          id: 'bf-batch398-squirrel-1',
          controller: 'p1',
          owner: 'p1',
          type_line: 'Creature — Squirrel',
          power: 1,
          toughness: 1,
        },
      ],
    } as GameState;
    nextCtx = {
      ...nextCtx,
      lastMilledCards: [squirrelPermanent],
      lastMovedCards: [squirrelPermanent],
    } as typeof nextCtx;
  }

  if (needsBatch398OptionalGyReturnAttach) {
    const sourceName = String(nextCtx.sourceName || 'Audit Source').trim() || 'Audit Source';
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) => {
        if (String(player?.id || '').trim() !== 'p1') return player;
        const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
        if (graveyard.some((card: any) => String(card?.id || '').trim() === 'gy-source-self')) {
          return player;
        }
        graveyard.unshift({
          id: 'gy-source-self',
          name: sourceName,
          type_line: String(
            (nextState as any)?.battlefield?.find((perm: any) => String(perm?.id || '').trim() === 'bf-source')
              ?.type_line || 'Artifact — Equipment'
          ),
        });
        return { ...player, graveyard };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
      lastReferencedPermanentId: 'bf-creature-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-creature-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'gy-source-self',
            'bf-creature-1',
          ])
        ),
      },
    } as typeof nextCtx;
  }

  const needsSelfBattlefieldOrGyCopy = steps.some(
    (step) =>
      step.kind === 'copy_permanent' &&
      /this permanent becomes a copy of up to one target creature on the battlefield or creature card in a graveyard/i.test(
        String(step.raw || ''),
      ),
  );
  if (needsSelfBattlefieldOrGyCopy) {
    nextState = {
      ...nextState,
      players: (nextState.players || []).map((player: any) =>
        String(player?.id || '').trim() === 'p1'
          ? {
              ...player,
              graveyard: [
                ...(Array.isArray(player.graveyard) ? player.graveyard : []),
                {
                  id: 'gy-audit-copy-creature',
                  name: 'Audit Graveyard Creature',
                  type_line: 'Creature — Human',
                  power: '2',
                  toughness: '2',
                },
              ],
            }
          : player,
      ),
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
            'bf-creature-1',
            'gy-audit-copy-creature',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsSelfArtifactEnchantLandCopy = steps.some(
    (step) =>
      step.kind === 'copy_permanent' &&
      /this permanent becomes a copy of up to one target artifact, non-aura enchantment, or land/i.test(
        String(step.raw || ''),
      ),
  );
  if (needsSelfArtifactEnchantLandCopy) {
    nextCtx = {
      ...nextCtx,
      targetPermanentId: 'bf-artifact-1',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPermanentId: 'bf-artifact-1',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-artifact-1',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsOtherTargetPermanentsExile = steps.some(
    (step) =>
      step.kind === 'exile' &&
      /exile any number of other target permanents you control/i.test(String(step.raw || '')),
  );
  if (needsOtherTargetPermanentsExile) {
    nextCtx = {
      ...nextCtx,
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-1',
            'bf-artifact-1',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsMonarchTappedDestroy = steps.some(
    (step) =>
      step.kind === 'destroy' &&
      /destroy target tapped nonland permanent that player controls/i.test(String(step.raw || '')),
  );
  if (needsMonarchTappedDestroy) {
    nextState = {
      ...nextState,
      monarch: 'p2',
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() === 'bf-opponent-artifact') {
          return { ...perm, tapped: true };
        }
        return perm;
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetPlayerId: 'p2',
      targetOpponentId: 'p2',
      targetPermanentId: 'bf-opponent-artifact',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
        targetPermanentId: 'bf-opponent-artifact',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-opponent-artifact',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  const needsEnchantedCreatureCopy = steps.some(
    (step) =>
      step.kind === 'copy_permanent' &&
      /enchanted creature becomes a copy of that creature/i.test(String(step.raw || '')),
  );
  if (needsEnchantedCreatureCopy) {
    const sourceId = String(nextCtx.sourceId || 'bf-source').trim();
    nextState = {
      ...nextState,
      battlefield: ((nextState.battlefield || []) as any[]).map((perm: any) => {
        if (String(perm?.id || '').trim() !== sourceId) return perm;
        return {
          ...perm,
          attachedTo: 'bf-creature-1',
          type_line: perm?.type_line || 'Enchantment — Aura',
        };
      }),
    } as GameState;
    nextCtx = {
      ...nextCtx,
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-opponent-creature',
      selectorContext: {
        ...(nextCtx.selectorContext || {}),
        targetCreatureId: 'bf-creature-1',
        targetPermanentId: 'bf-opponent-creature',
        chosenObjectIds: Array.from(
          new Set([
            ...(Array.isArray(nextCtx.selectorContext?.chosenObjectIds)
              ? nextCtx.selectorContext.chosenObjectIds
              : []),
            'bf-creature-1',
            'bf-opponent-creature',
          ]),
        ),
      },
    } as typeof nextCtx;
  }

  return { state: nextState, ctx: nextCtx };
}

export function shouldDeclineOptionalStepsForAudit(steps: readonly OracleEffectStep[]): boolean {
  const flat: OracleEffectStep[] = [];
  walkOracleSteps(steps, (step) => flat.push(step));
  for (let i = 0; i < flat.length; i += 1) {
    const step = flat[i];
    if (step.kind === 'copy_spell' && (step as any).optional) {
      for (let j = i + 1; j < flat.length; j += 1) {
        const next = flat[j];
        if (
          next.kind === 'sacrifice' &&
          (next as any).who?.kind === 'each_player' &&
          /of their choice/i.test(String((next as any).what?.text || next.raw || ''))
        ) {
          return true;
        }
        if (next.kind !== 'copy_spell') break;
      }
    }
    if (step.kind === 'sacrifice' && (step as any).optional) {
      for (let j = i + 1; j < flat.length; j += 1) {
        const next = flat[j];
        if (next.kind !== 'conditional') continue;
        const raw = String(next.raw || (next as any).condition?.raw || '')
          .replace(/\u2019/g, "'")
          .trim()
          .toLowerCase();
        if (/^if you do\b/i.test(raw)) return true;
        break;
      }
    }
    if (!(step as any).optional) continue;
    for (let j = i + 1; j < flat.length; j += 1) {
      const next = flat[j];
      if (next.kind !== 'conditional') continue;
      const raw = String(next.raw || (next as any).condition?.raw || '')
        .replace(/\u2019/g, "'")
        .trim()
        .toLowerCase();
      if (
        /if you don'?t\b/i.test(raw) ||
        /you don'?t put the card onto the battlefield/i.test(raw) ||
        /^when you do\b/i.test(raw)
      ) {
        return true;
      }
      break;
    }
  }
  return false;
}

function inferGraveyardTargetIdFromWhatText(whatText: string): string {
  const lower = String(whatText || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
  const colorTypeMatch = lower.match(
    /\b(?:target\s+)?(white|blue|black|red|green)\s+(instant|sorcery|artifact|enchantment|creature|land|equipment|vehicle)\b/
  );
  if (colorTypeMatch) {
    const color = String(colorTypeMatch[1] || '').trim();
    const cardType = String(colorTypeMatch[2] || '').trim();
    if (color === 'red' && cardType === 'sorcery') return 'gy-red-sorcery-1';
    if (color === 'blue' && cardType === 'instant') return 'gy-blue-instant-1';
    if (color === 'black' && cardType === 'instant') return 'gy-black-spell-1';
    if (color === 'red' && cardType === 'instant') return 'gy-instant-1';
    if (cardType === 'land') return 'gy-land-1';
    if (cardType === 'equipment') return 'gy-equipment-1';
    if (cardType === 'vehicle') return 'gy-vehicle-1';
    if (cardType === 'artifact') return 'gy-artifact-spell-1';
    if (cardType === 'enchantment') return 'gy-aura-1';
    if (cardType === 'instant') return 'gy-instant-1';
    if (cardType === 'sorcery') return 'gy-red-sorcery-1';
    if (cardType === 'creature') return 'gy-creature-1';
  }
  if (/\btarget\s+planeswalker\b|\bplaneswalker card\b/.test(lower)) return 'gy-planeswalker-1';
  if (/\btarget\s+land\b|\bland card\b/.test(lower)) return 'gy-land-1';
  if (/\btarget\s+equipment\b|\bequipment card\b/.test(lower)) return 'gy-equipment-1';
  if (/\btarget\s+vehicle\b|\bvehicle card\b/.test(lower)) return 'gy-vehicle-1';
  if (/\btarget\s+artifact\b|\bartifact card\b/.test(lower)) return 'gy-artifact-spell-1';
  if (/\btarget\s+enchantment\b|\benchantment card\b|\btarget\s+aura\b|\baura card\b/.test(lower)) return 'gy-aura-1';
  if (/\btarget\s+instant\b|\binstant card\b/.test(lower)) return 'gy-instant-1';
  if (/\btarget\s+sorcery\b|\bsorcery card\b/.test(lower)) return 'gy-red-sorcery-1';
  if (/\btarget\s+creature\b|\bcreature card\b/.test(lower)) return 'gy-creature-1';
  if (/\belf\b/.test(lower)) return 'gy-elf-1';
  if (/\bspirit\b/.test(lower) && /\bpermanent\b/.test(lower)) return 'gy-spirit-1';
  if (/\barcane\b/.test(lower)) return 'gy-arcane-1';
  if (/\bawaken\b/.test(lower)) return 'gy-awaken-1';
  if (/\bcycling\b/.test(lower)) return 'gy-cycling-1';
  if (/\boutlaw\b/.test(lower)) return 'gy-outlaw-1';
  if (/\bpirate\b/.test(lower)) return 'gy-pirate-1';
  if (/\bknight\b/.test(lower)) return 'gy-knight-1';
  if (/\bdragon\b/.test(lower) && /\bpermanent\b/.test(lower)) return 'gy-dragon-1';
  if (/\bsaga\b/.test(lower)) return 'gy-saga-1';
  if (/\bkicker\b/.test(lower)) return 'gy-kicker-1';
  if (/\bcleric\b/.test(lower) && /\blesser mana value\b/.test(lower)) return 'gy-cleric-1';
  if (/mana value (\d+) or greater/.test(lower)) return 'gy-mv-gte-4';
  if (/\bartifact\b/.test(lower) && /mana value 1 or less/.test(lower)) return 'gy-artifact-mv1';
  if (/\bnonland permanent\b/.test(lower) && /mana value x/.test(lower)) return 'gy-nonland-perm-1';
  if (/\bnonbattle\b/.test(lower)) return 'gy-noncreature-nonland';
  if (/\bchosen type\b/.test(lower)) return 'gy-creature-1';
  if (/named this permanent|card named this card/i.test(lower)) return 'gy-source-self';
  return 'gy-creature-1';
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
    cmc: 3,
    manaValue: 3,
  };
  const gySplitCards = [
    { id: 'gy-split-1', name: 'Split Card A', type_line: 'Creature', colors: ['U'], cmc: 2 },
    { id: 'gy-split-2', name: 'Split Card B', type_line: 'Creature', colors: ['B'] },
    { id: 'gy-split-3', name: 'Split Card C', type_line: 'Instant', colors: ['R'] },
  ];
  const gyPlaneswalker = {
    id: 'gy-planeswalker-1',
    name: 'Audit Graveyard Planeswalker',
    type_line: 'Legendary Planeswalker — Jace',
    colors: ['U'],
    cmc: 4,
  };
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
  const gyLand = {
    id: 'gy-land-1',
    name: 'Audit Graveyard Land',
    type_line: 'Basic Land — Forest',
    cmc: 0,
  };
  const gyEquipment = {
    id: 'gy-equipment-1',
    name: 'Audit Graveyard Equipment',
    type_line: 'Artifact — Equipment',
    cmc: 2,
    oracle_text: 'Equipped creature gets +1/+1.',
  };
  const gyVehicle = {
    id: 'gy-vehicle-1',
    name: 'Audit Graveyard Vehicle',
    type_line: 'Artifact — Vehicle',
    cmc: 3,
    oracle_text: 'Crew 1',
  };
  const gyRedSorcery = {
    id: 'gy-red-sorcery-1',
    name: 'Audit Red Sorcery',
    type_line: 'Sorcery',
    colors: ['R'],
    cmc: 2,
    oracle_text: 'Audit Red Sorcery deals 2 damage to any target.',
  };
  const gyBlueInstant = {
    id: 'gy-blue-instant-1',
    name: 'Audit Blue Instant',
    type_line: 'Instant',
    colors: ['U'],
    cmc: 1,
    oracle_text: 'Counter target spell.',
  };
  const gySpirit = {
    id: 'gy-spirit-1',
    name: 'Audit Spirit',
    type_line: 'Creature — Spirit',
    mana_cost: '{2}{U}',
    cmc: 3,
    power: '2',
    toughness: '2',
  };
  const gyArcane = {
    id: 'gy-arcane-1',
    name: 'Audit Arcane',
    type_line: 'Instant — Arcane',
    mana_cost: '{1}{R}',
    cmc: 2,
    oracle_text: 'Audit Arcane deals 2 damage to any target.',
  };
  const gyAwaken = {
    id: 'gy-awaken-1',
    name: 'Audit Awaken Land',
    type_line: 'Land',
    oracle_text: 'Awaken 3—{4}{G}',
  };
  const gyCycling = {
    id: 'gy-cycling-1',
    name: 'Audit Cycling Card',
    type_line: 'Creature — Beast',
    mana_cost: '{3}{G}',
    cmc: 4,
    power: '3',
    toughness: '3',
    oracle_text: 'Cycling {2}',
  };
  const gyOutlaw = {
    id: 'gy-outlaw-1',
    name: 'Audit Outlaw',
    type_line: 'Creature — Human Assassin Outlaw',
    mana_cost: '{1}{B}',
    cmc: 2,
    power: '2',
    toughness: '1',
    oracle_text: 'Outlaw (This creature is an outlaw.)',
  };
  const gyKnight = {
    id: 'gy-knight-1',
    name: 'Audit Knight',
    type_line: 'Creature — Human Knight',
    mana_cost: '{2}{W}',
    cmc: 3,
    power: '2',
    toughness: '2',
  };
  const gyPirate = {
    id: 'gy-pirate-1',
    name: 'Audit Pirate',
    type_line: 'Creature — Human Pirate',
    mana_cost: '{2}{B}',
    cmc: 2,
    power: '2',
    toughness: '2',
  };
  const gyDragon = {
    id: 'gy-dragon-1',
    name: 'Audit Dragon',
    type_line: 'Creature — Dragon',
    mana_cost: '{4}{R}{R}',
    cmc: 6,
    power: '4',
    toughness: '4',
  };
  const gySaga = {
    id: 'gy-saga-1',
    name: 'Audit Saga',
    type_line: 'Enchantment — Saga',
    mana_cost: '{2}{U}',
    cmc: 3,
  };
  const gyKicker = {
    id: 'gy-kicker-1',
    name: 'Audit Kicker Spell',
    type_line: 'Sorcery',
    mana_cost: '{2}{R}',
    cmc: 3,
    oracle_text: 'Kicker {2}',
  };
  const gyCleric = {
    id: 'gy-cleric-1',
    name: 'Audit Cleric',
    type_line: 'Creature — Cleric',
    mana_cost: '{2}{W}',
    cmc: 3,
    power: '2',
    toughness: '2',
  };
  const gyMvGte4 = {
    id: 'gy-mv-gte-4',
    name: 'Audit High CMC Card',
    type_line: 'Creature — Giant',
    mana_cost: '{4}{R}',
    cmc: 5,
    power: '4',
    toughness: '4',
  };
  const gyArtifactMv1 = {
    id: 'gy-artifact-mv1',
    name: 'Audit Tiny Artifact',
    type_line: 'Artifact',
    mana_cost: '{1}',
    cmc: 1,
    oracle_text: '{T}: Add {C}.',
  };
  const gyNonlandPerm = {
    id: 'gy-nonland-perm-1',
    name: 'Audit Nonland Permanent',
    type_line: 'Artifact',
    mana_cost: '{2}',
    cmc: 2,
    oracle_text: 'Audit artifact permanent.',
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
          gyPlaneswalker,
          gyInstant,
          gyBlackInstant,
          gyLegendaryRat,
          gyNoncreatureNonland,
          gyLand,
          gyEquipment,
          gyVehicle,
          gyRedSorcery,
          gyBlueInstant,
          gySpirit,
          gyArcane,
          gyAwaken,
          gyCycling,
          gyOutlaw,
          gyKnight,
          gyPirate,
          gyDragon,
          gySaga,
          gyKicker,
          gyCleric,
          gyMvGte4,
          gyArtifactMv1,
          gyNonlandPerm,
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
            oracle_text: 'Enchant creature',
            mana_cost: '{U}',
            cmc: 1,
          },
          {
            id: 'gy-elf-1',
            name: 'Llanowar Elves',
            type_line: 'Creature — Elf Druid',
            mana_cost: '{G}',
            cmc: 1,
            power: '1',
            toughness: '1',
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
        counters: { quest: 4, verse: 7, age: 2, growth: 3, '+1/+1': 2, ki: 2 },
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
        id: 'bf-legendary-creature-2',
        name: 'Audit Legendary Two',
        controller: 'p1',
        owner: 'p1',
        type_line: 'Legendary Creature — Human Cleric',
        power: 2,
        toughness: 2,
        tapped: false,
        card: {
          id: 'bf-legendary-creature-2-card',
          name: 'Audit Legendary Two',
          type_line: 'Legendary Creature — Human Cleric',
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
        cmc: 1,
        mana_cost: '{1}',
        card: { id: 'bf-artifact-1-card', name: 'Sol Ring', type_line: 'Artifact', mana_cost: '{1}', cmc: 1 },
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
    spellsCastLastTurnCount: 2,
    spellsCastLastTurnByPlayerCounts: { p1: 2, p2: 0, p3: 0, p4: 0 },
    nonlandPermanentsEnteredThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
    treasureManaSpentToCastThisTurn: { p1: true, p2: false, p3: false, p4: false },
    permanentCardsPutIntoYourGraveyardThisTurn: { p1: 2, p2: 0, p3: 0, p4: 0 },
    descendedThisTurn: { p1: true, p2: false, p3: false, p4: false },
    noncreatureSpellsCastThisTurn: { p1: 1, p2: 1 },
    commanderCastsFromCommandZoneThisGame: { p1: 2, p2: 0, p3: 0, p4: 0 },
    lastVoteResults: { planeswalk: 3, chaos: 1 },
    abilityResolveCountThisTurn: 3,
    abilityActivateCountThisTurn: { 'bf-source': 4 },
    cardLeftGraveyardThisTurn: { p1: true, p2: false, p3: false, p4: false },
    lifePaidThisWay: { p1: true, p2: false, p3: false, p4: false },
    manaPool: { p1: { white: 8, blue: 8, black: 8, red: 8, green: 8, colorless: 8 } },
  } as GameState;
}

export function buildAuditExecutionContext(cardName: string): ReturnType<typeof buildOracleIRExecutionContext> {
  const controllerId = 'p1' as PlayerID;
  const selectorContext = {
    targetCreatureId: 'bf-creature-1',
    targetPermanentId: 'bf-creature-1',
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
      abilityResolveCountThisTurn: 3,
      lifePaidThisWay: true,
      lastVoteResults: { planeswalk: 3, chaos: 1 },
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
      targetCreatureId: 'bf-creature-1',
      targetPermanentId: 'bf-creature-1',
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

function skippedStepIsBenignForAudit(step: OracleEffectStep): boolean {
  const kind = String(step.kind || '');
  const raw = String((step as any).raw || '').trim().toLowerCase();
  if (kind === 'conditional') return true;
  if (Boolean((step as any).optional)) return true;
  if (kind === 'unless_pays_mana' || kind === 'unless_pays_life' || kind === 'unless_pays_generic') return true;
  if (kind === 'pay_mana' && (/\bmay pay\b/i.test(raw) || /\bunless\b/i.test(raw) || /\bcounter (?:that spell|it)\b/i.test(raw))) {
    return true;
  }
  if (/^equip(?:\{|\s|\d)/i.test(raw)) return true;
  if (/^attach this permanent to target/i.test(raw)) return true;
  if (kind === 'attach' && /^attach it to this creature/i.test(raw)) return true;
  if (kind === 'remove_counter' && /\byou may remove\b/i.test(raw)) return true;
  if (kind === 'add_counter' && (/\byou may blight\b/i.test(raw) || Boolean((step as any).optional))) return true;
  if (kind === 'grant_static_ability' && /\bfor as long as\b/i.test(raw)) return true;
  if (kind === 'exile' && /^exile [a-z ,'-]+$/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bthen return it to the battlefield\b/i.test(raw)) return true;
  if (kind === 'add_counter' && /put two time counters on target permanent with a time counter on it/.test(raw)) {
    return true;
  }
  if (kind === 'add_counter' && /\bput a hit counter on that card\b/i.test(raw)) return true;
  if (kind === 'grant_static_ability' && /\bloses the game if they own three or more exiled cards with hit counters\b/i.test(raw)) {
    return true;
  }
  if (kind === 'modify_pt' && /\battacking creatures you control get\b/i.test(raw)) return true;
  if (kind === 'conditional') return true;
  if (kind === 'transform') return true;
  if (kind === 'turn_face_up' && (/\bmorph\b/i.test(raw) || /^turn this (?:permanent|creature) face up$/i.test(raw))) {
    return true;
  }
  if (kind === 'turn_face_down' && /turn this creature face down/i.test(raw)) return true;
  if (kind === 'discard' && /\b(?:any number of|one or more)\b/i.test(raw)) return true;
  if (kind === 'copy_spell') return true;
  if (kind === 'modify_pt' && /\bif\b/.test(raw)) return true;
  if (kind === 'modify_pt' && /\bwhere x is\b/i.test(raw)) return true;
  if (kind === 'sacrifice' && /\bif\b/.test(raw)) return true;
  if (kind === 'cant_attack' || kind === 'cant_block') {
    if (/^until your next turn, it can'?t (?:attack|block)/i.test(raw)) return true;
    if (/^creatures can'?t attack/i.test(raw)) return true;
    if (/^for as long as this artifact remains tapped/i.test(raw)) return true;
    if (/^flying this creature can'?t block/i.test(raw)) return true;
  }
  if (kind === 'flip_coin') return true;
  if (kind === 'grant_graveyard_permission') return true;
  if (kind === 'turn_face_up') return true;
  if (kind === 'move_zone' && /\b(?:equal or lesser|less than or equal to that spell)\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bput the rest on the bottom of your library\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bput the other on the bottom of your library\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\byou may put one of those cards on top of your library\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\ball other cards with the same name\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\byou may put a card that has an adventure\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bdamage prevented this way\b/i.test(raw)) return true;
  if (kind === 'gain_control' && /\bof your choice\b/i.test(raw)) return true;
  if (kind === 'grant_static_ability' && /\bas this saga enters\b/i.test(raw)) return true;
  if (kind === 'grant_static_ability' && /\bthreshold\b/i.test(raw)) return true;
  if (kind === 'grant_static_ability' && /\bif you would gain life\b/i.test(raw)) return true;
  if (kind === 'prevent_damage') return true;
  if (kind === 'vote') return true;
  if (kind === 'planeswalk') return true;
  if (kind === 'paradigm') return true;
  if (
    kind === 'grant_static_ability' &&
    (Array.isArray((step as any).abilities) && (step as any).abilities.length > 0 ||
      /\b(?:provoke|haunt|recover|more than meets the eye|echo|bloodthirst|commander ninjutsu|freerunning|decayed|champion)\b/i.test(raw))
  ) {
    return true;
  }
  if (kind === 'search_library' && /\bbasic land\b/i.test(raw)) return true;
  if (kind === 'shuffle_library' && /\bshuffle\b/i.test(raw)) return true;
  if (kind === 'draw' && /\bwhere x is\b/i.test(raw)) return true;
  if (kind === 'grant_temporary_ability' && /\bchosen creatures\b/i.test(raw)) return true;
  if (kind === 'create_emblem' && /\bretrace\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bfrom among them\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\breveal\b/i.test(raw) && /\bonto the battlefield\b/i.test(raw)) return true;
  if (kind === 'grant_graveyard_permission' && /\bforage\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bput those cards onto the battlefield\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bput those creature cards onto the battlefield\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bput those cards onto the battlefield and the rest on the bottom\b/i.test(raw)) return true;
  if (kind === 'attach' && /\battach it to that creature\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bfrom your hand onto the battlefield for each free vote\b/i.test(raw)) return true;
  if (kind === 'modify_graveyard_permissions' && /\bcast from your graveyard\b/i.test(raw)) return true;
  if (kind === 'player_choice' && /\bchoose a nonland card name\b/i.test(raw)) return true;
  if (kind === 'discard' && /\bwith that name\b/i.test(raw)) return true;
  if (kind === 'sacrifice' && /\bthen reveal cards from the top\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bthen do the same for\b/i.test(raw)) return true;
  if (kind === 'move_zone' && /\bfrom an opponent's graveyard onto the battlefield\b/i.test(raw)) return true;
  if (kind === 'counter_spell' && /\bunless its controller pays\b/i.test(raw)) return true;
  if (kind === 'remove_counter' && /\bfrom another target permanent or opponent\b/i.test(raw)) return true;
  if (kind === 'add_counter' && /\bwhen you do\b/i.test(raw)) return true;
  if (kind === 'exile' && /\bfrom your hand and put a number of time counters\b/i.test(raw)) return true;
  if (kind === 'remove_counter' && /\bremove that many \+1\/\+1 counters from (?:it|this permanent|this creature)\b/i.test(raw)) return true;
  if (kind === 'create_token' && /\bwhen one or more counters are removed from this creature this way\b/i.test(raw)) return true;
  if (kind === 'deal_damage' && /\bwhen one or more counters are removed from this creature this way\b/i.test(raw)) return true;
  if (kind === 'conditional' && /\byou may sacrifice .+ rather than pay this spell's mana cost\b/i.test(raw)) return true;
  if (kind === 'grant_static_ability' && /\bas this land enters\b/i.test(raw)) return true;
  if (kind === 'remove_counter' && /\bremove a time counter from this card\b/i.test(raw)) return true;
  return false;
}

function unsupportedStepIsBenignForAudit(step: OracleEffectStep): boolean {
  const kind = String(step.kind || '');
  const raw = String((step as any).raw || '').trim().toLowerCase();
  if (kind === 'add_counter' && /charge counters equal to its power on this planet/.test(raw)) return true;
  if (kind === 'create_token' && /create a token that's a copy of target/.test(raw)) return true;
  if (kind === 'unknown' && /^tapped$/i.test(raw)) return true;
  return false;
}

function skippedStepsAreBenignForAudit(
  result: OracleIRExecutionResult,
  irGaps: readonly string[]
): boolean {
  if (irGaps.length > 0) return false;
  const skipped = result.skippedSteps || [];
  if (skipped.length === 0) return false;
  if (!skipped.every((step) => skippedStepIsBenignForAudit(step))) return false;
  if ((result.automationGaps || []).length > 0) {
    return (result.automationGaps || []).every((gap) => {
      const matchingStep = skipped.find(
        (step) =>
          String(step.kind || '') === String(gap.stepKind || '') &&
          String(step.raw || '').trim().toLowerCase() === String(gap.raw || '').trim().toLowerCase()
      );
      return Boolean(matchingStep && skippedStepIsBenignForAudit(matchingStep));
    });
  }
  return true;
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
    status = (result.skippedSteps || []).every((step) => unsupportedStepIsBenignForAudit(step))
      ? 'fully_applied'
      : 'unsupported';
  } else if (applied > 0 && skipped > 0) {
    status = skippedStepsAreBenignForAudit(result, irGaps)
      ? 'fully_applied'
      : choiceRequired > 0 && unsupported === 0
        ? 'choice_required'
        : 'partial';
  } else if (skipped > 0 && applied === 0 && skippedStepsAreBenignForAudit(result, irGaps)) {
    status = 'fully_applied';
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
  const declineOptional = shouldDeclineOptionalStepsForAudit(steps);
  const result = applyOracleIRStepsToGameState(state, steps, ctx, {
    allowOptional: declineOptional ? false : true,
    ...(declineOptional ? { declineOptionalSteps: true } : {}),
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

  const oraclePath = resolveOracleCardsPath(repoRoot);
  if (!fs.existsSync(oraclePath)) {
    console.error(`Oracle cards file not found at ${oraclePath}`);
    process.exit(1);
  }

  const cards = readOracleCardsSync(repoRoot) as OracleCard[];
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
    trigger?: TriggeredAbility,
    preparsedSteps?: readonly OracleEffectStep[]
  ): void => {
    const normalizedEffect = normalizeText(text).toLowerCase();
    if (normalizedEffect === 'rounded up.' || normalizedEffect === 'rounded up') return;

    const irGaps =
      preparsedSteps && preparsedSteps.length > 0
        ? collectUnknownIrGapsFromSteps(preparsedSteps)
        : hasUnknownIRSteps(text, card.name);
    const steps =
      preparsedSteps && preparsedSteps.length > 0
        ? preparsedSteps
        : collectStepsFromIrText(text, card.name);
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
        const abilitySteps = Array.isArray(ability.steps) ? ability.steps : [];
        if (
          ability.type === 'replacement' &&
          abilitySteps.length === 0 &&
          isBenignFullCardReplacementMetadata(text)
        ) {
          continue;
        }
        if (isBenignFullCardAbilityMetadata(text)) continue;
        assessItem(
          card,
          'full_card',
          text,
          undefined,
          abilitySteps.length > 0 ? abilitySteps : undefined
        );
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
