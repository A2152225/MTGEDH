import { AbilityType } from './oracleTextParser';
import type {
  OracleEffectStep,
  OracleIRAbility,
  OracleIRResult,
  OracleObjectSelector,
  OraclePlayerSelector,
  OracleQuantity,
  OracleZone,
} from './oracleIR';
import { parseOracleTextToIR } from './oracleIRParser';

/**
 * External compiler output for cards whose oracle phrasing is not yet covered by
 * the regex parser but decomposes into wired OracleEffectStep verbs.
 *
 * Preferred shape: native `OracleEffectStep` objects (lossless, executor-ready).
 * Optional `ir_execution_tree` is a simplified DSL lowered before execution.
 */

export type OracleIRCompilerAbilityType = 'SPELL_EFFECT' | 'ACTIVATED' | 'TRIGGERED' | 'STATIC' | 'REPLACEMENT';

export interface OverlayReplacementEffectSpecInput {
  readonly id: string;
  readonly event: string;
  readonly match?: Record<string, unknown>;
  readonly instead: {
    readonly redirectZone?: string;
    readonly choiceRequired?: boolean;
    readonly replacementOptions?: readonly string[];
    readonly modify?: 'double' | 'add_flat' | 'halve';
    readonly value?: number;
    readonly redirectDrawTo?: 'source_controller';
    readonly sharedDrawCount?: number;
  };
  readonly effectId?: string;
  readonly reason?: string;
  readonly metadata?: Record<string, unknown>;
}

export interface OverlayStaticEffectSpecInput {
  readonly id: string;
  readonly scope: {
    readonly kind: 'creatures_you_control' | 'other_creatures_you_control' | 'all_creatures' | 'creature_type' | 'player_you';
    readonly creatureType?: string;
  };
  readonly grant: {
    readonly power?: number;
    readonly toughness?: number;
    readonly abilities?: readonly string[];
    readonly playerHexproof?: boolean;
    readonly playerShroud?: boolean;
  };
  readonly condition?: {
    readonly kind: 'controller_life_at_least_starting_plus' | 'target_is_token' | 'target_is_not_token' | 'during_source_controller_turn';
    readonly offset?: number;
  };
  readonly layer?: 4 | 5 | 6 | 7;
  readonly sublayer?: '7a' | '7b' | '7c' | '7d';
}

export interface OracleIRCompiledAbility {
  readonly ability_type: OracleIRCompilerAbilityType;
  readonly ability_index?: number;
  readonly trigger_condition?: string;
  readonly cost?: string;
  readonly effect_text?: string;
  readonly steps: readonly OracleEffectStep[];
  /** Declarative replacement specs for STATIC / REPLACEMENT overlay abilities (Phase 5.2). */
  readonly replacement_specs?: readonly OverlayReplacementEffectSpecInput[];
  /** Declarative static specs for STATIC overlay abilities (Phase 5.3). */
  readonly static_specs?: readonly OverlayStaticEffectSpecInput[];
}

/** Simplified compiler DSL — lowered to native OracleEffectStep before execution. */
export type OracleIRCompilerStepVerb =
  | 'DECLARE_TARGET'
  | 'MOVE_ZONE'
  | 'REVEAL'
  | 'LOOK'
  | 'DRAW'
  | 'PROMPT_CHOICE'
  | 'APPLY_CONTINUOUS_EFFECT'
  | 'MODIFY_COUNTERS'
  | 'DAMAGE'
  | 'SHUFFLE';

export interface OracleIRCompilerPointer {
  readonly zone?: 'LIBRARY' | 'HAND' | 'BATTLEFIELD' | 'GRAVEYARD' | 'EXILE' | 'STACK' | 'COMMAND';
  readonly scope?: 'TOP_N' | 'ALL' | 'RESOLUTION_TARGET' | 'ID_REFERENCE';
  readonly count?: number | 'X' | 'ALL';
  readonly sqlite_filter?: {
    readonly types?: readonly string[];
    readonly subtypes?: readonly string[];
    readonly supertypes?: readonly string[];
    readonly controller?: 'YOU' | 'OPPONENT' | 'ANY';
    readonly attributes?: {
      readonly power_less_than_or_equal?: number | null;
      readonly mana_value_equal?: number | null;
    };
  };
  readonly use_reference_id?: string | null;
}

export interface OracleIRCompilerExecutionNode {
  readonly queue_index: number;
  readonly ir_step_verb: OracleIRCompilerStepVerb;
  readonly parameters?: {
    readonly source_pointer?: OracleIRCompilerPointer;
    readonly destination_pointer?: {
      readonly zone?: OracleIRCompilerPointer['zone'] | null;
      readonly placement?: 'TOP' | 'BOTTOM' | 'RANDOM' | 'DEFAULT';
    };
    readonly variable_registry?: {
      readonly capture_variable?: 'X_VALUE' | 'TARGET_COUNT' | null;
      readonly derive_source?: 'CARDS_REVEALED' | 'MANA_PAID' | 'LIFE_LOST' | 'TOTAL_PERMANENTS' | null;
    };
    readonly conditional_branch?: {
      readonly condition_type?: 'IF_MATCHES_FILTER' | 'IF_COULD_PAY' | null;
      readonly match_filter?: { readonly types?: readonly string[] };
      readonly on_true_goto_index?: number | null;
      readonly on_false_goto_index?: number | null;
    };
  };
  readonly ir_reference_id?: string;
  readonly raw?: string;
}

export interface OracleIRCompilerExecutionTree {
  readonly ability_type: OracleIRCompilerAbilityType;
  readonly resolution_nodes: readonly OracleIRCompilerExecutionNode[];
}

export interface OracleIRCompilerEnvelope {
  readonly card_id?: string;
  readonly fallback_to_bespoke?: boolean;
  /** Preferred: fully-typed steps ready for the executor. */
  readonly abilities?: readonly OracleIRCompiledAbility[];
  /** Optional simplified DSL; lowered when `abilities` is absent. */
  readonly ir_execution_tree?: OracleIRCompilerExecutionTree;
}

export interface ResolveOracleIRWithOverlayOptions {
  /** Use overlay steps even when the parser produced a full result. */
  readonly preferOverlay?: boolean;
  /** Replace parser `unknown` steps per ability when overlay supplies replacements. */
  readonly mergeUnknown?: boolean;
}

export interface OracleIRCompilerValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
  readonly steps: readonly OracleEffectStep[];
}

const COMPILER_ABILITY_TO_IR: Record<OracleIRCompilerAbilityType, AbilityType> = {
  SPELL_EFFECT: AbilityType.SPELL,
  ACTIVATED: AbilityType.ACTIVATED,
  TRIGGERED: AbilityType.TRIGGERED,
  STATIC: AbilityType.STATIC,
  REPLACEMENT: AbilityType.REPLACEMENT,
};

const ZONE_MAP: Record<NonNullable<OracleIRCompilerPointer['zone']>, OracleZone> = {
  LIBRARY: 'library',
  HAND: 'hand',
  BATTLEFIELD: 'battlefield',
  GRAVEYARD: 'graveyard',
  EXILE: 'exile',
  STACK: 'stack',
  COMMAND: 'command',
};

function defaultWho(controller: OraclePlayerSelector = { kind: 'you' }): OraclePlayerSelector {
  return controller;
}

function pointerCount(pointer: OracleIRCompilerPointer | undefined): OracleQuantity {
  const count = pointer?.count;
  if (count === 'ALL') return { kind: 'all' };
  if (count === 'X') return { kind: 'x' };
  if (typeof count === 'number') return { kind: 'number', value: count };
  return { kind: 'number', value: 1 };
}

function pointerWhat(pointer: OracleIRCompilerPointer | undefined, referenceId?: string): OracleObjectSelector {
  if (referenceId || pointer?.use_reference_id) {
    const ref = referenceId || pointer?.use_reference_id || 'it';
    return { kind: 'raw', text: ref };
  }
  const types = pointer?.sqlite_filter?.types || [];
  if (types.length === 1) {
    return { kind: 'raw', text: `target ${types[0].toLowerCase()}` };
  }
  if (pointer?.scope === 'TOP_N') {
    return { kind: 'raw', text: 'the top card of your library' };
  }
  return { kind: 'raw', text: 'it' };
}

function refIndexFromReferenceId(
  referenceId: string | undefined,
  nodes: readonly OracleIRCompilerExecutionNode[]
): number | undefined {
  if (!referenceId) return undefined;
  const match = nodes.find((node) => node.ir_reference_id === referenceId);
  return match?.queue_index;
}

function lowerCompilerNode(
  node: OracleIRCompilerExecutionNode,
  nodes: readonly OracleIRCompilerExecutionNode[],
  rawFallback: string
): OracleEffectStep | null {
  const raw = String(node.raw || rawFallback || node.ir_step_verb).trim();
  const src = node.parameters?.source_pointer;
  const dest = node.parameters?.destination_pointer;
  const who = defaultWho();
  const antecedent = refIndexFromReferenceId(src?.use_reference_id || undefined, nodes);

  switch (node.ir_step_verb) {
    case 'REVEAL':
      return {
        kind: 'reveal_top',
        who,
        amount: pointerCount(src),
        raw,
        ...(antecedent !== undefined ? { thisWayAntecedentStepIndex: antecedent } : {}),
      } as OracleEffectStep;
    case 'LOOK':
      return {
        kind: 'look_top',
        who,
        amount: pointerCount(src),
        raw,
      } as OracleEffectStep;
    case 'DRAW':
      return {
        kind: 'draw',
        who,
        amount: pointerCount(src),
        raw,
      } as OracleEffectStep;
    case 'SHUFFLE':
      return {
        kind: 'shuffle_library',
        who,
        raw,
      } as OracleEffectStep;
    case 'DAMAGE':
      return {
        kind: 'deal_damage',
        who: { kind: 'target_player' },
        amount: pointerCount(src),
        raw,
      } as OracleEffectStep;
    case 'DECLARE_TARGET':
      return {
        kind: 'choose_target_creature',
        raw,
      } as OracleEffectStep;
    case 'MODIFY_COUNTERS':
      return {
        kind: 'add_counter',
        who,
        what: pointerWhat(src),
        counter: '+1/+1',
        amount: pointerCount(src),
        raw,
        ...(antecedent !== undefined ? { thisWayAntecedentStepIndex: antecedent } : {}),
      } as OracleEffectStep;
    case 'APPLY_CONTINUOUS_EFFECT':
      return {
        kind: 'grant_temporary_ability',
        target: pointerWhat(src),
        abilityText: raw,
        duration: 'end_of_turn',
        raw,
        ...(antecedent !== undefined ? { thisWayAntecedentStepIndex: antecedent } : {}),
      } as OracleEffectStep;
    case 'MOVE_ZONE': {
      const toZone = dest?.zone ? ZONE_MAP[dest.zone] : 'hand';
      return {
        kind: 'move_zone',
        what: pointerWhat(src, node.ir_reference_id),
        to: toZone,
        toRaw: String(dest?.zone || 'hand').toLowerCase(),
        raw,
        ...(antecedent !== undefined ? { thisWayAntecedentStepIndex: antecedent } : {}),
      } as OracleEffectStep;
    }
    case 'PROMPT_CHOICE':
      return {
        kind: 'player_choice',
        who,
        choiceText: raw,
        raw,
      } as OracleEffectStep;
    default:
      return null;
  }
}

function collectFoldedSkipIndices(
  nodes: readonly OracleIRCompilerExecutionNode[]
): Set<number> {
  const skipIndices = new Set<number>();
  for (const node of nodes) {
    const branch = node.parameters?.conditional_branch;
    if (branch?.condition_type !== 'IF_MATCHES_FILTER') continue;

    const landTypes = (branch.match_filter?.types || []).map((t) => t.toLowerCase());
    const trueIndex = branch.on_true_goto_index ?? undefined;
    const falseIndex = branch.on_false_goto_index ?? undefined;
    const revealAntecedent = nodes.find(
      (n) => n.ir_step_verb === 'REVEAL' && n.queue_index < node.queue_index
    );
    if (!revealAntecedent || !landTypes.includes('land')) continue;

    const trueTarget = typeof trueIndex === 'number'
      ? nodes.find((n) => n.queue_index === trueIndex)
      : undefined;
    const falseTarget = typeof falseIndex === 'number'
      ? nodes.find((n) => n.queue_index === falseIndex)
      : undefined;
    const trueStep = trueTarget ? lowerCompilerNode(trueTarget, nodes, '') : null;
    const falseStep = falseTarget ? lowerCompilerNode(falseTarget, nodes, '') : null;
    if (trueStep?.kind !== 'move_zone' || falseStep?.kind !== 'move_zone') continue;

    skipIndices.add(revealAntecedent.queue_index);
    if (typeof trueIndex === 'number') skipIndices.add(trueIndex);
    if (typeof falseIndex === 'number') skipIndices.add(falseIndex);
  }
  return skipIndices;
}

function lowerConditionalGotoTree(
  tree: OracleIRCompilerExecutionTree
): readonly OracleEffectStep[] {
  const nodes = [...(tree.resolution_nodes || [])].sort((a, b) => a.queue_index - b.queue_index);
  const out: OracleEffectStep[] = [];
  const skipIndices = collectFoldedSkipIndices(nodes);

  for (const node of nodes) {
    if (skipIndices.has(node.queue_index)) continue;

    const branch = node.parameters?.conditional_branch;
    if (branch?.condition_type === 'IF_MATCHES_FILTER') {
      const landTypes = (branch.match_filter?.types || []).map((t) => t.toLowerCase());
      const trueIndex = branch.on_true_goto_index ?? undefined;
      const falseIndex = branch.on_false_goto_index ?? undefined;
      const trueSteps: OracleEffectStep[] = [];
      const falseSteps: OracleEffectStep[] = [];
      const antecedent = refIndexFromReferenceId(
        nodes.find((n) => n.queue_index < node.queue_index)?.ir_reference_id,
        nodes
      ) ?? Math.max(0, node.queue_index - 1);

      if (typeof trueIndex === 'number') {
        const target = nodes.find((n) => n.queue_index === trueIndex);
        if (target) {
          const lowered = lowerCompilerNode(target, nodes, '');
          if (lowered) trueSteps.push({ ...lowered, thisWayAntecedentStepIndex: antecedent } as OracleEffectStep);
        }
      }
      if (typeof falseIndex === 'number') {
        const target = nodes.find((n) => n.queue_index === falseIndex);
        if (target) {
          const lowered = lowerCompilerNode(target, nodes, '');
          if (lowered) falseSteps.push({ ...lowered, thisWayAntecedentStepIndex: antecedent } as OracleEffectStep);
        }
      }

      const conditionRaw = landTypes.includes('land')
        ? "if it's a land card"
        : `if it matches ${(branch.match_filter?.types || []).join(', ')}`;

      const revealAntecedent = nodes.find(
        (n) => n.ir_step_verb === 'REVEAL' && n.queue_index < node.queue_index
      );
      if (
        revealAntecedent
        && landTypes.includes('land')
        && trueSteps.length === 1
        && trueSteps[0]?.kind === 'move_zone'
        && falseSteps.length === 1
        && falseSteps[0]?.kind === 'move_zone'
      ) {
        out.push({
          kind: 'look_select_top',
          who: defaultWho(),
          amount: pointerCount(revealAntecedent.parameters?.source_pointer),
          choose: { kind: 'number', value: 1 },
          destination: 'hand',
          restDestination: 'graveyard',
          raw: String(revealAntecedent.raw || 'reveal the top card of your library'),
        } as OracleEffectStep);
        continue;
      }

      out.push({
        kind: 'conditional',
        condition: { kind: 'if', raw: conditionRaw },
        steps: trueSteps,
        raw: conditionRaw,
      } as OracleEffectStep);
      if (falseSteps.length > 0) {
        out.push(...falseSteps);
      }
      if (typeof trueIndex === 'number') skipIndices.add(trueIndex);
      if (typeof falseIndex === 'number') skipIndices.add(falseIndex);
      continue;
    }

    const lowered = lowerCompilerNode(node, nodes, '');
    if (lowered) out.push(lowered);
  }

  return out;
}

export function lowerCompilerEnvelopeToSteps(
  envelope: OracleIRCompilerEnvelope
): readonly OracleEffectStep[] {
  if (envelope.fallback_to_bespoke) return [];

  if (envelope.abilities && envelope.abilities.length > 0) {
    return envelope.abilities.flatMap((ability) => [...ability.steps]);
  }

  if (envelope.ir_execution_tree) {
    return lowerConditionalGotoTree(envelope.ir_execution_tree);
  }

  return [];
}

export function validateCompiledOracleEffectSteps(
  steps: readonly OracleEffectStep[]
): OracleIRCompilerValidationResult {
  const errors: string[] = [];
  const valid: OracleEffectStep[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const kind = String((step as { kind?: string })?.kind || '').trim();
    if (!kind) {
      errors.push(`step[${i}]: missing kind`);
      continue;
    }
    if (kind === 'unknown') {
      errors.push(`step[${i}]: kind 'unknown' is not executable`);
      continue;
    }
    valid.push(step);
  }

  return { ok: errors.length === 0, errors, steps: valid };
}

export function envelopeToOracleIRAbilities(
  envelope: OracleIRCompilerEnvelope
): readonly OracleIRAbility[] {
  if (envelope.fallback_to_bespoke) return [];

  if (envelope.abilities && envelope.abilities.length > 0) {
    return envelope.abilities.map((ability) => ({
      type: COMPILER_ABILITY_TO_IR[ability.ability_type],
      text: ability.effect_text || '',
      cost: ability.cost,
      triggerCondition: ability.trigger_condition,
      effectText: ability.effect_text || '',
      steps: [...ability.steps],
    }));
  }

  if (envelope.ir_execution_tree) {
    const steps = lowerConditionalGotoTree(envelope.ir_execution_tree);
    return [{
      type: COMPILER_ABILITY_TO_IR[envelope.ir_execution_tree.ability_type],
      text: '',
      effectText: steps.map((step) => step.raw).filter(Boolean).join(' '),
      steps,
    }];
  }

  return [];
}

function abilityHasUnknownSteps(ability: OracleIRAbility): boolean {
  return (ability.steps || []).some((step) => step.kind === 'unknown');
}

function parsedNeedsOverlay(parsed: OracleIRResult): boolean {
  if (!parsed.abilities || parsed.abilities.length === 0) return true;
  return parsed.abilities.some(abilityHasUnknownSteps);
}

function mergeUnknownStepsFromOverlay(
  parsed: OracleIRResult,
  overlayAbilities: readonly OracleIRAbility[]
): OracleIRResult {
  if (overlayAbilities.length === 0) return parsed;

  const abilities = parsed.abilities.map((ability, index) => {
    if (!abilityHasUnknownSteps(ability)) return ability;
    const overlay = overlayAbilities[index] || overlayAbilities[0];
    if (!overlay || overlay.steps.length === 0) return ability;
    return {
      ...ability,
      steps: overlay.steps,
      effectText: overlay.effectText || ability.effectText,
    };
  });

  return { ...parsed, abilities };
}

/**
 * Parse oracle text and optionally apply a compiled overlay when the regex parser
 * is incomplete or when callers explicitly prefer precompiled steps.
 */
export function resolveOracleIRWithOverlay(
  oracleText: string,
  sourceName: string,
  overlay?: OracleIRCompilerEnvelope | null,
  options: ResolveOracleIRWithOverlayOptions = {}
): OracleIRResult {
  const parsed = parseOracleTextToIR(oracleText, sourceName);
  if (!overlay || overlay.fallback_to_bespoke) {
    return parsed;
  }

  const overlayAbilities = envelopeToOracleIRAbilities(overlay);
  const overlayValidation = validateCompiledOracleEffectSteps(
    overlayAbilities.flatMap((ability) => ability.steps)
  );
  if (!overlayValidation.ok || overlayValidation.steps.length === 0) {
    return parsed;
  }

  if (options.preferOverlay) {
    return {
      ...parsed,
      abilities: overlayAbilities,
    };
  }

  if (options.mergeUnknown !== false && parsedNeedsOverlay(parsed)) {
    return mergeUnknownStepsFromOverlay(parsed, overlayAbilities);
  }

  if (parsedNeedsOverlay(parsed) && overlayAbilities.length > 0) {
    return {
      ...parsed,
      abilities: overlayAbilities,
    };
  }

  return parsed;
}

export function collectOracleEffectStepsWithOverlay(
  oracleText: string,
  sourceName: string,
  overlay?: OracleIRCompilerEnvelope | null,
  options?: ResolveOracleIRWithOverlayOptions
): OracleEffectStep[] {
  const resolved = resolveOracleIRWithOverlay(oracleText, sourceName, overlay, options);
  return (resolved.abilities || []).flatMap((ability) => [...(ability.steps || [])]);
}
