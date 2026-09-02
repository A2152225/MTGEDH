import type { GameState } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { resolveOracleIrBoundTargetSpellId } from './oracleIrTargetBinding';
import { getStackItems } from './stackOperations';

function normalizeId(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return String((value as { id?: string }).id || '').trim();
  }
  return String(value || '').trim();
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase();
}

export function isRandomChangeTargetStep(step: OracleEffectStep | undefined): boolean {
  if (!step || step.kind !== 'change_target') return false;
  if (step.random === true) return true;
  const newTargetText = step.newTarget?.kind === 'raw' ? String(step.newTarget.text || '') : '';
  return /\bat random\b/i.test(newTargetText) || /reselect\s+(?:the\s+|its\s+)?targets?\s+at\s+random/i.test(String(step.raw || ''));
}

export function changeTargetMentionsCopies(
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
): boolean {
  const targetText = step.target?.kind === 'raw' ? String(step.target.text || '') : '';
  return /\bthe copy\b|\bthe copies\b|\bthe spell and the copy\b/i.test(`${targetText} ${String(step.raw || '')}`);
}

export function resolveChangeTargetExcludeText(
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
): string {
  if (step.exclude?.kind === 'raw') return String(step.exclude.text || '').trim();
  const match = String(step.raw || '')
    .replace(/\u2019/g, "'")
    .match(/can(?:'|')t be (.+)$/i);
  return String(match?.[1] || '').trim();
}

function replaceStackItem(
  state: GameState,
  spellId: string,
  nextItem: any,
): GameState {
  const stack = [...getStackItems((state as any)?.stack)];
  const index = stack.findIndex((item) => normalizeId((item as any)?.id) === spellId);
  if (index < 0) return state;
  stack[index] = nextItem;
  if (Array.isArray((state as any)?.stack)) {
    return { ...(state as any), stack } as GameState;
  }
  if ((state as any)?.stack && typeof (state as any).stack === 'object') {
    return {
      ...(state as any),
      stack: { ...((state as any).stack as object), objects: stack },
    } as GameState;
  }
  return { ...(state as any), stack } as GameState;
}

function isYouOrPermanentYouControlExclude(excludeText: string): boolean {
  return /you or a permanent you control/i.test(normalizeText(excludeText));
}

function isExcludedCandidate(
  candidateId: string,
  controllerId: string,
  battlefield: readonly any[],
  excludeText: string,
): boolean {
  if (!candidateId || !excludeText) return false;
  if (!isYouOrPermanentYouControlExclude(excludeText)) return false;
  if (candidateId === controllerId) return true;
  return battlefield.some((permanent) => {
    if (normalizeId(permanent?.id) !== candidateId) return false;
    return String(permanent?.controller || permanent?.controllerId || '').trim() === controllerId;
  });
}

function collectRetargetCandidates(
  state: GameState,
  spell: any,
  controllerId: string,
  excludeText: string,
  ctx?: OracleIRExecutionContext,
): Array<{ id: string; type?: string; [key: string]: unknown }> {
  const battlefield = Array.isArray((state as any)?.battlefield) ? ((state as any).battlefield as any[]) : [];
  const players = Array.isArray((state as any)?.players) ? ((state as any).players as any[]) : [];
  const validTargets = Array.isArray(spell?.copyRetargetValidTargets) ? spell.copyRetargetValidTargets : [];
  const currentTargets = Array.isArray(spell?.targets) ? spell.targets : [];
  const currentIds = currentTargets.map(normalizeId).filter(Boolean);
  const currentLooksLikePlayer = currentIds.length > 0 && currentIds.every((id) =>
    players.some((player) => normalizeId(player?.id) === id)
  );

  const fromMetadata = validTargets
    .map((target: any) => {
      const id = normalizeId(target);
      if (!id) return null;
      const type = String(target?.type || (currentLooksLikePlayer ? 'player' : 'permanent')).trim() || undefined;
      return target && typeof target === 'object' && !Array.isArray(target)
        ? { ...target, id, ...(type ? { type } : {}) }
        : { id, ...(type ? { type } : {}) };
    })
    .filter((target): target is { id: string; type?: string } => Boolean(target?.id));

  const oracleText = String(spell?.card?.oracle_text || spell?.oracle_text || spell?.activatedAbilityText || '');
  const isAnyTarget = /\bany target\b/i.test(oracleText);

  let candidates = fromMetadata;
  if (candidates.length === 0 && typeof ctx?.collectLegalRetargetCandidates === 'function') {
    candidates = ctx.collectLegalRetargetCandidates(state, spell, String(spell?.controller || controllerId))
      .map((target) => {
        const id = normalizeId(target);
        if (!id) return null;
        return {
          ...target,
          id,
          type: String(target?.type || (currentLooksLikePlayer ? 'player' : 'permanent')).trim() || undefined,
        };
      })
      .filter((target): target is { id: string; type?: string } => Boolean(target?.id));
  }
  if (candidates.length === 0) {
    const playerCandidates = players
      .map((player) => {
        const id = normalizeId(player?.id);
        return id ? { id, type: 'player', name: String(player?.name || id) } : null;
      })
      .filter((target): target is { id: string; type: string; name: string } => Boolean(target));
    const permanentCandidates = battlefield
      .map((permanent) => {
        const id = normalizeId(permanent?.id);
        return id
          ? {
              id,
              type: 'permanent',
              name: String(permanent?.card?.name || permanent?.name || id),
            }
          : null;
      })
      .filter((target): target is { id: string; type: string; name: string } => Boolean(target));
    if (isAnyTarget) {
      candidates = [...playerCandidates, ...permanentCandidates];
    } else if (currentLooksLikePlayer) {
      candidates = playerCandidates;
    } else {
      candidates = permanentCandidates;
    }
  }

  return candidates.filter((candidate) =>
    !isExcludedCandidate(candidate.id, controllerId, battlefield, excludeText)
  );
}

function pickRandomCandidate<T>(candidates: readonly T[]): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index] ?? candidates[0]!;
}

function candidateAsTarget(
  existing: any,
  candidate: { id: string; type?: string; [key: string]: unknown },
): any {
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return { ...existing, id: candidate.id };
  }
  return candidate && typeof candidate === 'object'
    ? { ...candidate, id: candidate.id, type: candidate.type || 'permanent' }
    : { id: candidate.id, type: candidate.type || 'permanent' };
}

function applyCandidatesToSpellSlots(
  spell: any,
  candidates: ReadonlyArray<{ id: string; type?: string; [key: string]: unknown }>,
): any {
  const existingTargets = Array.isArray(spell?.targets) ? spell.targets : [];
  if (existingTargets.length <= 1) {
    const chosen = pickRandomCandidate(candidates);
    if (!chosen) return spell;
    return {
      ...spell,
      targets: [candidateAsTarget(existingTargets[0], chosen)],
    };
  }
  return {
    ...spell,
    targets: existingTargets.map((slot: any) => {
      const chosen = pickRandomCandidate(candidates);
      return chosen ? candidateAsTarget(slot, chosen) : slot;
    }),
  };
}

export function resolveChangeTargetSpellIds(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'change_target' }>,
  ctx: OracleIRExecutionContext,
): string[] {
  const stack = getStackItems((state as any)?.stack);
  const sourceId = String(ctx.sourceId || '').trim();
  const boundId = resolveOracleIrBoundTargetSpellId(ctx);
  const otherSpells = stack.filter((item) => {
    const id = normalizeId((item as any)?.id);
    if (!id || id === sourceId) return false;
    const type = String((item as any)?.type || 'spell').trim().toLowerCase();
    return !type || type === 'spell' || type === 'ability';
  });
  const originalId = boundId || (otherSpells.length === 1 ? normalizeId((otherSpells[0] as any)?.id) : '');

  const ids = new Set<string>();
  if (originalId) ids.add(originalId);
  if (changeTargetMentionsCopies(step) && originalId) {
    for (const item of stack) {
      const copiedFrom = String((item as any)?.copiedFromStackItemId || '').trim();
      if (copiedFrom === originalId) {
        const copyId = normalizeId((item as any)?.id);
        if (copyId) ids.add(copyId);
      }
    }
  }
  return [...ids];
}

export function applyRandomRetargetToStackSpells(
  state: GameState,
  spellIds: readonly string[],
  ctx: OracleIRExecutionContext,
  exclude?: OracleObjectSelector,
  excludeTextOverride?: string,
): {
  readonly applied: boolean;
  readonly state: GameState;
  readonly log: readonly string[];
} {
  const controllerId = String(ctx.controllerId || '').trim();
  const excludeText = excludeTextOverride
    || (exclude?.kind === 'raw' ? String(exclude.text || '').trim() : '');
  let nextState = state;
  const log: string[] = [];
  let changed = false;

  for (const spellId of spellIds) {
    const stack = getStackItems((nextState as any)?.stack);
    const spell = stack.find((item) => normalizeId((item as any)?.id) === spellId);
    if (!spell) continue;
    const candidates = collectRetargetCandidates(nextState, spell, controllerId, excludeText, ctx);
    if (candidates.length === 0) {
      log.push(`No legal random targets for ${spellId}; left existing targets unchanged`);
      changed = true;
      continue;
    }
    const nextSpell = applyCandidatesToSpellSlots(spell, candidates);
    nextState = replaceStackItem(nextState, spellId, nextSpell);
    const nextIds = (Array.isArray(nextSpell?.targets) ? nextSpell.targets : [])
      .map((target: any) => normalizeId(target))
      .filter(Boolean);
    log.push(`Reselected targets of ${spellId} at random to ${nextIds.join(', ') || '(unchanged)'}`);
    changed = true;
  }

  return { applied: changed || spellIds.length === 0, state: nextState, log };
}
