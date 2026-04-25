import type {
  EffectProgramCommandStep,
  EffectProgramHandlerArgs,
  EffectProgramKeywordStep,
  EffectProgramStep,
} from './effectProgram';
import { buildEffectProgramFromOracleIR } from './effectProgram';
import type { OracleEffectStep, OracleObjectSelector, OraclePlayerSelector, OracleQuantity } from './oracleIR';

export type EffectProgramKeywordSupportStatus = 'supported' | 'partial' | 'manual';

export interface EffectProgramKeywordRegistryEntry {
  readonly keyword: string;
  readonly aliases?: readonly string[];
  readonly oracleStepKind: string;
  readonly support: EffectProgramKeywordSupportStatus;
  readonly requiresChoice: boolean;
  readonly description: string;
  readonly buildOracleStep?: (step: EffectProgramKeywordStep) => OracleEffectStep | undefined;
}

export type EffectProgramKeywordRegistry = ReadonlyMap<string, EffectProgramKeywordRegistryEntry>;

export interface EffectProgramKeywordAuditFinding {
  readonly keyword: string;
  readonly status: 'missing' | 'manual' | 'partial';
  readonly message: string;
}

export const DEFAULT_EFFECT_PROGRAM_KEYWORD_ENTRIES: readonly EffectProgramKeywordRegistryEntry[] = [
  createKeywordEntry('scry', 'scry', true, 'supported', buildPlayerAmountStep),
  createKeywordEntry('surveil', 'surveil', true, 'supported', buildPlayerAmountStep),
  createKeywordEntry('fateseal', 'fateseal', true, 'supported', buildFatesealStep),
  createKeywordEntry('clash', 'clash', true, 'supported', buildClashStep),
  createKeywordEntry('explore', 'explore', true, 'supported', buildExploreStep),
  createKeywordEntry('connive', 'connive', true, 'partial', buildTargetAmountStep),
  createKeywordEntry('manifest dread', 'manifest_dread', true, 'partial', buildPlayerStep, ['manifest_dread']),
  createKeywordEntry('learn', 'learn', true, 'partial', buildPlayerStep),
  createKeywordEntry('collect evidence', 'collect_evidence', true, 'partial', buildPlayerAmountStep, ['collect_evidence']),
  createKeywordEntry('exert', 'exert', true, 'partial', buildTargetStep),
  createKeywordEntry('populate', 'populate', true, 'supported', buildPlayerAmountStep),
  createKeywordEntry('proliferate', 'proliferate', true, 'supported', buildPlayerStep),
  createKeywordEntry('the ring tempts you', 'ring_tempts_you', true, 'partial', buildPlayerStep, ['ring tempts you', 'ring_tempts_you']),
  createKeywordEntry('investigate', 'investigate', false, 'supported', buildPlayerAmountStep),
  createKeywordEntry('time travel', 'time_travel', false, 'supported', buildPlayerAmountStep, ['time_travel']),
];

export const DEFAULT_EFFECT_PROGRAM_KEYWORD_REGISTRY = createEffectProgramKeywordRegistry(
  DEFAULT_EFFECT_PROGRAM_KEYWORD_ENTRIES
);

export function createEffectProgramKeywordRegistry(
  entries: readonly EffectProgramKeywordRegistryEntry[]
): EffectProgramKeywordRegistry {
  const registry = new Map<string, EffectProgramKeywordRegistryEntry>();
  for (const entry of entries) {
    const aliases = [entry.keyword, ...(entry.aliases || []), entry.oracleStepKind];
    for (const alias of aliases) {
      registry.set(normalizeKeyword(alias), entry);
    }
  }
  return registry;
}

export function getEffectProgramKeywordEntry(
  keyword: string,
  registry: EffectProgramKeywordRegistry = DEFAULT_EFFECT_PROGRAM_KEYWORD_REGISTRY
): EffectProgramKeywordRegistryEntry | undefined {
  return registry.get(normalizeKeyword(keyword));
}

export function expandEffectProgramKeywordStep(
  args: EffectProgramHandlerArgs<any, EffectProgramKeywordStep>,
  registry: EffectProgramKeywordRegistry = DEFAULT_EFFECT_PROGRAM_KEYWORD_REGISTRY
): readonly EffectProgramStep[] | undefined {
  const entry = getEffectProgramKeywordEntry(args.step.keyword, registry);
  if (!entry || entry.support === 'manual') {
    return undefined;
  }

  const oracleStep = readOracleStep(args.step) || entry.buildOracleStep?.(args.step);
  if (!oracleStep) {
    return undefined;
  }

  const commandStep: EffectProgramCommandStep = {
    id: `${args.step.id}:command`,
    kind: 'command',
    clause: args.step.clause,
    raw: args.step.raw,
    command: {
      kind: 'oracle_ir_step',
      step: oracleStep,
    },
  };

  if (!entry.requiresChoice) {
    return [commandStep];
  }

  if (entry.support !== 'supported') {
    return [commandStep];
  }

  return buildEffectProgramFromOracleIR({
    id: args.step.id,
    controllerId: args.runtime.program.controllerId,
    sourceId: args.runtime.program.sourceId,
    sourceName: args.runtime.program.sourceName,
    sourceImage: args.runtime.program.sourceImage,
    steps: [oracleStep],
  }).steps;
}

export function createEffectProgramKeywordExpansionHandler(
  registry: EffectProgramKeywordRegistry = DEFAULT_EFFECT_PROGRAM_KEYWORD_REGISTRY
) {
  return (args: EffectProgramHandlerArgs<any, EffectProgramKeywordStep>) => expandEffectProgramKeywordStep(args, registry);
}

export function auditEffectProgramKeywords(
  keywords: readonly string[],
  registry: EffectProgramKeywordRegistry = DEFAULT_EFFECT_PROGRAM_KEYWORD_REGISTRY
): readonly EffectProgramKeywordAuditFinding[] {
  const findings: EffectProgramKeywordAuditFinding[] = [];
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (!normalized) {
      continue;
    }

    const entry = registry.get(normalized);
    if (!entry) {
      findings.push({
        keyword,
        status: 'missing',
        message: `No EffectProgram keyword registry entry for "${keyword}".`,
      });
      continue;
    }

    if (entry.support === 'manual' || entry.support === 'partial') {
      findings.push({
        keyword,
        status: entry.support,
        message: `Keyword "${keyword}" is marked ${entry.support} in the EffectProgram registry.`,
      });
    }
  }
  return findings;
}

function createKeywordEntry(
  keyword: string,
  oracleStepKind: string,
  requiresChoice: boolean,
  support: EffectProgramKeywordSupportStatus,
  buildOracleStep: (step: EffectProgramKeywordStep, oracleStepKind: string) => OracleEffectStep | undefined,
  aliases: readonly string[] = []
): EffectProgramKeywordRegistryEntry {
  return {
    keyword,
    aliases,
    oracleStepKind,
    requiresChoice,
    support,
    description: `${keyword} keyword action`,
    buildOracleStep: (step) => buildOracleStep(step, oracleStepKind),
  };
}

function readOracleStep(step: EffectProgramKeywordStep): OracleEffectStep | undefined {
  const oracleStep = step.parameters?.oracleStep;
  if (oracleStep && typeof oracleStep === 'object' && typeof (oracleStep as any).kind === 'string') {
    return oracleStep as OracleEffectStep;
  }
  return undefined;
}

function buildPlayerStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    who: readPlayerSelector(step.parameters?.who),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildPlayerAmountStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    who: readPlayerSelector(step.parameters?.who),
    amount: readQuantity(step.parameters?.amount),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildTargetStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    target: readObjectSelector(step.parameters?.target),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildExploreStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    target: readExploreTargetSelector(step.parameters?.target),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildTargetAmountStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    target: readObjectSelector(step.parameters?.target),
    amount: readQuantity(step.parameters?.amount),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildFatesealStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    who: readPlayerSelector(step.parameters?.who),
    target: readFatesealTargetSelector(step.parameters?.target),
    amount: readQuantity(step.parameters?.amount),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function buildClashStep(step: EffectProgramKeywordStep, kind: string): OracleEffectStep {
  return {
    kind,
    who: readPlayerSelector(step.parameters?.who),
    opponent: readClashOpponentSelector(step.parameters?.opponent),
    raw: step.raw || step.keyword,
  } as OracleEffectStep;
}

function readQuantity(value: unknown): OracleQuantity {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OracleQuantity;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'number', value };
  }
  return { kind: 'number', value: 1 };
}

function readPlayerSelector(value: unknown): OraclePlayerSelector {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OraclePlayerSelector;
  }
  return { kind: 'you' };
}

function readFatesealTargetSelector(value: unknown): OraclePlayerSelector {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OraclePlayerSelector;
  }
  return { kind: 'target_opponent' };
}

function readClashOpponentSelector(value: unknown): OraclePlayerSelector {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OraclePlayerSelector;
  }
  return { kind: 'target_opponent' };
}

function readObjectSelector(value: unknown): OracleObjectSelector {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OracleObjectSelector;
  }
  return { kind: 'raw', text: String(value || 'source') };
}

function readExploreTargetSelector(value: unknown): OracleObjectSelector {
  if (value && typeof value === 'object' && typeof (value as any).kind === 'string') {
    return value as OracleObjectSelector;
  }
  return { kind: 'raw', text: String(value || 'this creature') };
}

function normalizeKeyword(keyword: string): string {
  return String(keyword || '').trim().toLowerCase().replace(/[\s_-]+/g, ' ');
}
