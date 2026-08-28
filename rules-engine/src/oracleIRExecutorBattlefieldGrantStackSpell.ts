/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts /
 * oracleIRExecutorBattlefieldGrantTemporaryAbilityStep.ts
 * Cluster: grant keywords onto a spell still on the stack ("that spell" /
 * "this spell"). Binds via targetSpellId, not the trigger source (Judith is the
 * watcher; Reckless Blaze is the spell).
 * Public: tryApplyGrantKeywordsToStackSpell
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const STACK_SPELL_TARGET = /^(?:that spell|this spell)$/i;

type GrantKeywordStep = Extract<
  OracleEffectStep,
  { kind: 'grant_static_ability' | 'grant_temporary_ability' }
>;

function isStackSpellEntry(entry: any): boolean {
  const type = String(entry?.type || '').trim().toLowerCase();
  if (type === 'triggered_ability' || type === 'activated_ability' || type === 'ability') {
    return false;
  }
  if (type === 'spell') return true;
  return Boolean(entry?.card);
}

function stackEntryMatchesId(entry: any, wantedId: string): boolean {
  if (!wantedId) return false;
  const id = String(entry?.id || '').trim();
  const cardId = String(entry?.card?.id || '').trim();
  return id === wantedId || cardId === wantedId;
}

function collectGrantedKeywords(step: GrantKeywordStep): string[] {
  const fromAbilities = Array.isArray(step.abilities) ? step.abilities : [];
  const fromEffectText = Array.isArray(step.effectText) ? step.effectText : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...fromAbilities, ...fromEffectText]) {
    for (const part of String(value || '').split(/\s+and\s+/i)) {
      const keyword = part.trim().toLowerCase().replace(/[.]+$/g, '');
      if (!keyword || seen.has(keyword)) continue;
      seen.add(keyword);
      out.push(keyword);
    }
  }
  return out;
}

function findStackSpell(
  state: GameState,
  ctx: OracleIRExecutionContext,
): { readonly index: number; readonly entry: any } | null {
  const stack = Array.isArray((state as any).stack) ? ((state as any).stack as any[]) : [];
  if (stack.length === 0) return null;

  const targetSpellId = String(ctx.targetSpellId || ctx.selectorContext?.targetSpellId || '').trim();
  if (targetSpellId) {
    const byTarget = stack.findIndex(
      (entry) => isStackSpellEntry(entry) && stackEntryMatchesId(entry, targetSpellId),
    );
    if (byTarget >= 0) return { index: byTarget, entry: stack[byTarget] };
  }

  if (String(ctx.sourceObjectType || '').trim() === 'spell') {
    const sourceId = String(ctx.sourceId || '').trim();
    if (sourceId) {
      const bySource = stack.findIndex(
        (entry) => isStackSpellEntry(entry) && stackEntryMatchesId(entry, sourceId),
      );
      if (bySource >= 0) return { index: bySource, entry: stack[bySource] };
    }
  }

  return null;
}

function grantTargetText(step: GrantKeywordStep): string {
  return String((step.target as any)?.text || step.raw || '')
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isStackSpellGrantTarget(step: GrantKeywordStep): boolean {
  const targetText = grantTargetText(step);
  if (STACK_SPELL_TARGET.test(targetText)) return true;
  return /^(?:that spell|this spell)\s+gains?\b/i.test(targetText);
}

export function tryApplyGrantKeywordsToStackSpell(
  state: GameState,
  step: GrantKeywordStep,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  if (!isStackSpellGrantTarget(step)) return null;

  const keywords = collectGrantedKeywords(step);
  if (keywords.length === 0) {
    return {
      applied: false,
      message: `Skipped stack-spell keyword grant (no keywords): ${step.raw}`,
      reason: 'unsupported_object_selector',
    };
  }

  const found = findStackSpell(state, ctx);
  if (!found) {
    return {
      applied: false,
      message: `Skipped stack-spell keyword grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const stack = [...((state as any).stack as any[])];
  const existingGranted = Array.isArray(found.entry?.grantedAbilities)
    ? [...found.entry.grantedAbilities]
    : [];
  for (const keyword of keywords) {
    if (!existingGranted.some((entry) => String(entry || '').trim().toLowerCase() === keyword)) {
      existingGranted.push(keyword);
    }
  }

  stack[found.index] = {
    ...found.entry,
    grantedAbilities: existingGranted,
  };

  const spellName = String(found.entry?.card?.name || found.entry?.name || 'that spell').trim();
  return {
    applied: true,
    state: {
      ...(state as any),
      stack,
    } as GameState,
    log: [`${spellName} gains ${keywords.join(' and ')}`],
  };
}
