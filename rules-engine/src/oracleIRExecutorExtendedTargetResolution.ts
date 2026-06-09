import type { BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import {
  parseSimpleBattlefieldSelector,
  type SimpleBattlefieldSelector,
} from './oracleIRExecutorBattlefieldParser';
import { permanentMatchesSelector, permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function normalizeExtendedTargetText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function readPower(perm: any): number {
  for (const candidate of [perm?.effectivePower, perm?.basePower, perm?.power, perm?.card?.power]) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function permanentHasFlying(perm: BattlefieldPermanent): boolean {
  if (/\bflying\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some((value) => /\bflying\b/i.test(String(value || '')));
}

function permanentHasDefender(perm: BattlefieldPermanent): boolean {
  if (/\bdefender\b/i.test(getExecutorTypeLineLower(perm))) return true;
  const keywordValues: unknown[] = [
    ...(Array.isArray((perm as any)?.keywords) ? (perm as any).keywords : []),
    ...(Array.isArray((perm as any)?.card?.keywords) ? (perm as any).card.keywords : []),
    ...(Array.isArray((perm as any)?.grantedAbilities) ? (perm as any).grantedAbilities : []),
  ];
  return keywordValues.some((value) => /\bdefender\b/i.test(String(value || '')));
}

function typeLineHasSubtype(perm: BattlefieldPermanent, subtype: string): boolean {
  const escaped = subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}s?($|[^a-z0-9])`, 'i').test(getExecutorTypeLineLower(perm));
}

function collectBoundIds(ctx: OracleIRExecutionContext): string[] {
  return Array.from(
    new Set(
      [
        String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
        String(ctx.targetPermanentId || '').trim(),
        String(ctx.targetCreatureId || '').trim(),
        String(ctx.selectorContext?.targetPermanentId || '').trim(),
        String(ctx.selectorContext?.targetCreatureId || '').trim(),
        ...(Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
          : []),
      ].filter(Boolean)
    )
  );
}

function resolveAttachedHost(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const sourceId = String(ctx.sourceId || '').trim();
  const sourcePermanent = sourceId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === sourceId)
    : undefined;
  const attachedToId = String(
    (sourcePermanent as any)?.attachedTo || (sourcePermanent as any)?.enchanting || ''
  ).trim();
  return attachedToId
    ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === attachedToId)
    : undefined;
}

function resolveContextualSingleCreature(
  battlefield: readonly BattlefieldPermanent[],
  ctx: OracleIRExecutionContext
): BattlefieldPermanent | undefined {
  const boundIds = collectBoundIds(ctx);
  for (const id of boundIds) {
    const match = battlefield.find((perm) => String((perm as any)?.id || '').trim() === id);
    if (match && permanentMatchesType(match, 'creature')) return match;
  }
  const sourceId = String(ctx.sourceId || '').trim();
  if (sourceId) {
    const source = battlefield.find((perm) => String((perm as any)?.id || '').trim() === sourceId);
    if (source && permanentMatchesType(source, 'creature')) return source;
  }
  const creatures = battlefield.filter((perm) => permanentMatchesType(perm, 'creature'));
  return creatures.length === 1 ? creatures[0] : undefined;
}

export function resolveAttachedReferenceTargets(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  const text = normalizeExtendedTargetText(targetText);
  if (!text) return null;

  if (/^enchanted (?:creature|land|permanent|artifact|enchantment)$/i.test(text)) {
    const host = resolveAttachedHost(battlefield, ctx);
    return host ? [host] : [];
  }

  if (/^equipped creature$/i.test(text)) {
    const host = resolveAttachedHost(battlefield, ctx);
    return host && permanentMatchesType(host, 'creature') ? [host] : [];
  }

  if (
    /^(?:this|it|he|her)(?: creature| permanent| equipment| enchantment| artifact| land| saga)?$/i.test(text) ||
    text === 'this equipment' ||
    text === 'this creature' ||
    text === 'this permanent'
  ) {
    const sourceId = String(ctx.sourceId || '').trim();
    const self = sourceId
      ? battlefield.find((perm) => String((perm as any)?.id || '').trim() === sourceId)
      : undefined;
    return self ? [self] : [];
  }

  if (/^(?:that creature|it|her|him)$/i.test(text)) {
    const contextual = resolveContextualSingleCreature(battlefield, ctx);
    return contextual ? [contextual] : [];
  }

  return null;
}

export function resolveMassCreatureRestrictionTargets(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext
): BattlefieldPermanent[] | null {
  const text = normalizeExtendedTargetText(targetText);
  if (!text) return null;

  const controllerId = String(ctx.controllerId || '').trim();
  const isCreature = (perm: BattlefieldPermanent) => permanentMatchesType(perm, 'creature');
  const controlledByYou = (perm: any) => String(perm?.controller || '').trim() === controllerId;
  const controlledByOpponents = (perm: any) =>
    Boolean(controllerId) && String(perm?.controller || '').trim() !== controllerId;

  if (/^creatures without flying$/i.test(text)) {
    return battlefield.filter((perm) => isCreature(perm) && !permanentHasFlying(perm));
  }

  if (/^creatures with defender$/i.test(text)) {
    return battlefield.filter((perm) => isCreature(perm) && permanentHasDefender(perm));
  }

  const globalPowerAtMost = text.match(/^creatures with power (\d+) or less$/i);
  if (globalPowerAtMost) {
    const threshold = Number(globalPowerAtMost[1] || 0);
    return battlefield.filter((perm) => isCreature(perm) && readPower(perm) <= threshold);
  }

  if (/^creatures target player controls$/i.test(text)) {
    return battlefield.filter((perm) => isCreature(perm) && controlledByOpponents(perm));
  }

  if (
    /^creatures (?:that player controls )?without flying$/i.test(text) ||
    /^creatures without flying (?:that player controls|your opponents control)$/i.test(text) ||
    /^creatures without flying your opponents control$/i.test(text)
  ) {
    return battlefield.filter(
      (perm) => isCreature(perm) && controlledByOpponents(perm) && !permanentHasFlying(perm)
    );
  }

  if (/^creatures that player controls without flying$/i.test(text)) {
    return battlefield.filter(
      (perm) => isCreature(perm) && controlledByOpponents(perm) && !permanentHasFlying(perm)
    );
  }

  const opponentPowerAtMost = text.match(
    /^creatures your opponents control with power less than or equal to that number$/i
  );
  if (opponentPowerAtMost) {
    const threshold = Number(ctx.referenceAmount ?? ctx.xValue ?? 2);
    return battlefield.filter(
      (perm) => isCreature(perm) && controlledByOpponents(perm) && readPower(perm) <= threshold
    );
  }

  if (/^creatures with mana value of that quality$/i.test(text)) {
    const targetMv = Number(ctx.referenceAmount ?? ctx.xValue ?? 2);
    return battlefield.filter((perm) => {
      if (!isCreature(perm)) return false;
      const mv = getCardManaValue((perm as any)?.card || perm);
      return mv !== null && mv === targetMv;
    });
  }

  if (/^all creatures with magnet counters on them$/i.test(text)) {
    return battlefield.filter(
      (perm) =>
        isCreature(perm) && Number(((perm as any)?.counters || {}).magnet ?? 0) > 0
    );
  }

  if (/^creatures your opponents control with -1\/-1 counters on them$/i.test(text)) {
    return battlefield.filter(
      (perm) =>
        isCreature(perm) &&
        controlledByOpponents(perm) &&
        Number(((perm as any)?.counters || {})['-1/-1'] ?? 0) > 0
    );
  }

  if (/^each spider and legendary creature you control$/i.test(text)) {
    return battlefield.filter(
      (perm) =>
        isCreature(perm) &&
        controlledByYou(perm) &&
        (typeLineHasSubtype(perm, 'spider') || typeLineHasSubtype(perm, 'legendary'))
    );
  }

  if (/^each creature you control$/i.test(text)) {
    return battlefield.filter((perm) => isCreature(perm) && controlledByYou(perm));
  }

  if (/^all creatures$/i.test(text)) {
    return battlefield.filter((perm) => isCreature(perm));
  }

  return null;
}

export function resolveTargetPrefixedPermanents(
  battlefield: readonly BattlefieldPermanent[],
  targetText: string,
  ctx: OracleIRExecutionContext,
  boundMatches: (selector: SimpleBattlefieldSelector) => BattlefieldPermanent[]
): BattlefieldPermanent[] | null {
  const text = normalizeExtendedTargetText(targetText);
  if (!/^target\b/.test(text)) return null;

  if (/^target permanent you neither own nor control$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || '').trim();
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      const owner = String((perm as any)?.owner || '').trim();
      const controller = String((perm as any)?.controller || '').trim();
      return owner !== controllerId && controller !== controllerId;
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^target nonland permanent$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (boundIds.size > 0 && !boundIds.has(id)) return false;
      if (sourceId && id === sourceId) return false;
      return permanentMatchesType(perm, 'nonland_permanent');
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^target creature with power less than or equal to that creature'?s power an opponent controls$/i.test(text)) {
    const boundIds = collectBoundIds(ctx);
    const controllerId = String(ctx.controllerId || '').trim();
    const readPower = (perm: any): number => {
      for (const value of [perm?.effectivePower, perm?.basePower, perm?.card?.power, perm?.power]) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return 0;
    };

    let referencePower: number | undefined;
    for (const id of boundIds) {
      const perm = battlefield.find((entry) => String((entry as any)?.id || '').trim() === id);
      if (!perm || !permanentMatchesType(perm, 'creature')) continue;
      if (String((perm as any)?.controller || '').trim() !== controllerId) continue;
      referencePower = readPower(perm);
      break;
    }
    if (referencePower === undefined) {
      const sourceId = String(ctx.sourceId || '').trim();
      const source = battlefield.find((entry) => String((entry as any)?.id || '').trim() === sourceId);
      if (source && permanentMatchesType(source, 'creature')) referencePower = readPower(source);
    }

    const boundIdSet = new Set(boundIds);
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (boundIdSet.size > 0 && !boundIdSet.has(id)) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      if (String((perm as any)?.controller || '').trim() === controllerId) return false;
      return referencePower === undefined ? true : readPower(perm) <= referencePower;
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: targetText });
  if (selector) {
    const bound = boundMatches(selector);
    if (bound.length > 0) return bound.slice(0, 1);
    const matched = battlefield.filter((perm) => permanentMatchesSelector(perm, selector, ctx));
    if (matched.length > 0) return matched.slice(0, 1);
    return [];
  }

  if (/^target creature you control$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.has(id)) return false;
      return permanentMatchesType(perm, 'creature') && controlledByYou(perm as any, ctx);
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^target creature an opponent controls$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    const controllerId = String(ctx.controllerId || '').trim();
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.has(id)) return false;
      return (
        permanentMatchesType(perm, 'creature') &&
        String((perm as any)?.controller || '').trim() !== controllerId
      );
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^another target creature you control$/i.test(text)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const boundIds = new Set(collectBoundIds(ctx));
    const matches = battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!id || id === sourceId) return false;
      if (!boundIds.has(id)) return false;
      return permanentMatchesType(perm, 'creature') && controlledByYou(perm as any, ctx);
    });
    return matches.length > 0 ? matches.slice(0, 1) : [];
  }

  if (/^any number of target permanents$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    return battlefield.filter((perm) => boundIds.has(String((perm as any)?.id || '').trim()));
  }

  if (/^any number of target tapped nontoken creatures$/i.test(text)) {
    const boundIds = new Set(collectBoundIds(ctx));
    return battlefield.filter((perm) => {
      const id = String((perm as any)?.id || '').trim();
      if (!boundIds.has(id)) return false;
      if ((perm as any)?.isToken) return false;
      if (!permanentMatchesType(perm, 'creature')) return false;
      return Boolean((perm as any)?.tapped);
    });
  }

  return null;
}

function controlledByYou(perm: any, ctx: OracleIRExecutionContext): boolean {
  return String(perm?.controller || '').trim() === String(ctx.controllerId || '').trim();
}

function stripCompoundRestrictionPrefix(value: string): string {
  return String(value || '')
    .replace(/^for as long as this creature remains on the battlefield,\s+gain control of that permanent,\s+/i, '')
    .replace(/^for as long as this artifact remains tapped,\s+/i, '')
    .replace(/\s+loses all abilities,?\s+and\s+/i, ' ')
    .trim();
}

export function inferTargetTextFromStepRaw(step: OracleEffectStep): string {
  const raw = normalizeExtendedTargetText(String(step.raw || ''));
  if (!raw) return '';

  if (step.kind === 'set_basic_land_type') {
    const match = raw.match(/^(enchanted land)\s+is\s+an?\s+/i);
    if (match) return String(match[1] || '').trim();
  }

  if (step.kind === 'cant_block' || step.kind === 'cant_attack') {
    if (/^until your next turn, it can'?t (?:attack|block)/i.test(raw)) {
      return 'it';
    }
    if (/^flying this creature can'?t block/i.test(raw)) {
      return 'this creature';
    }
    if (/^creatures can'?t attack(?: or block)?(?: this turn)?\.?$/i.test(raw)) {
      return 'all creatures';
    }
    if (/^for as long as this creature remains on the battlefield, gain control of that permanent/i.test(raw)) {
      return 'that permanent';
    }
    if (/^for as long as this artifact remains tapped, another target permanent/i.test(raw)) {
      return 'another target permanent';
    }
    const compoundAttackOrBlock = raw.match(/^(.+?)\s+can['\u2019]t attack or block(?:\s+this\s+turn)?\.?$/i);
    if (compoundAttackOrBlock) {
      const target = stripCompoundRestrictionPrefix(String(compoundAttackOrBlock[1] || ''))
        .replace(/\s+loses all abilities,?\s+and\s+it$/i, 'it')
        .replace(/\s+loses all abilities and$/i, '')
        .replace(/\s+loses all abilities$/i, '')
        .trim();
      return target || 'that permanent';
    }
    const match = raw.match(/^(.+?)\s+can['\u2019]t\s+(?:block|attack)(?:\s+this\s+turn)?\.?$/i);
    if (match) {
      return stripCompoundRestrictionPrefix(String(match[1] || ''))
        .replace(/\s+loses all abilities,?\s+and\s+it$/i, 'it')
        .replace(/\s+loses all abilities and$/i, '')
        .replace(/\s+loses all abilities$/i, '')
        .replace(/^until your next turn,\s*/i, '')
        .replace(/^another\s+/i, '')
        .trim();
    }
  }

  if (step.kind === 'cant_activate_abilities') {
    const match = raw.match(/^(.+?)\s+(?:doesn['\u2019]t untap during its controller['\u2019]s untap step and )?its activated abilities can['\u2019]t be activated$/i);
    if (match) return String(match[1] || '').trim();
    const simpleMatch = raw.match(/^(.+?)\s+(?:activated )?abilities can['\u2019]t be activated$/i);
    if (simpleMatch) return String(simpleMatch[1] || '').trim();
  }

  if (step.kind === 'double_counters') {
    const eachKind = raw.match(/^double the number of each kind of counter on (.+?)(?: if .*)?$/i);
    if (eachKind) return String(eachKind[1] || '').trim();
    const specific = raw.match(/^double the number of .+? counters on (.+?)(?: if .*)?$/i);
    if (specific) return String(specific[1] || '').trim();
  }

  if (step.kind === 'remove_counter') {
    const fromMatch = raw.match(/\s+from\s+(.+?)(?:\.|$)/i);
    if (fromMatch) return String(fromMatch[1] || '').trim();
    if (/^remove .+ from this (?:equipment|creature|permanent)$/i.test(raw)) return 'this permanent';
  }

  if (step.kind === 'sacrifice') {
    const match = raw.match(/^sacrifice\s+(.+)$/i);
    if (match) return String(match[1] || '').trim();
  }

  if (step.kind === 'monstrosity' || step.kind === 'exert') {
    return 'this permanent';
  }

  if (step.kind === 'turn_face_down') {
    const match = raw.match(/^turn\s+(.+?)\s+face down$/i);
    if (match) return String(match[1] || '').trim();
  }

  if (step.kind === 'tap_or_untap') {
    const match = raw.match(/^(?:tap|untap)\s+(.+?)(?:\s+and\b|\s*$)/i);
    if (match) return String(match[1] || '').trim();
  }

  if (step.kind === 'add_counter' && /\bon it\b/.test(raw)) {
    return 'it';
  }

  return '';
}

export function effectiveStepTarget(
  step: OracleEffectStep
): { readonly kind: 'raw'; readonly text: string } | undefined {
  const existing =
    (step as any).target?.kind === 'raw' ? String((step as any).target.text || '').trim() : '';
  if (existing && /\b(?:gain control|loses all abilities|for as long as this creature remains)\b/i.test(existing)) {
    const inferred = inferTargetTextFromStepRaw(step);
    if (inferred) return { kind: 'raw', text: inferred };
  }
  if (!existing && (step.kind === 'cant_attack' || step.kind === 'cant_block')) {
    const inferred = inferTargetTextFromStepRaw(step);
    if (inferred) return { kind: 'raw', text: inferred };
  }
  if (
    existing &&
    (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
    /^flying\b/i.test(existing)
  ) {
    return { kind: 'raw', text: 'this creature' };
  }
  if (
    existing &&
    (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
    /until your next turn,\s*it\b/i.test(existing)
  ) {
    return { kind: 'raw', text: 'it' };
  }
  if (
    existing &&
    (step.kind === 'cant_attack' || step.kind === 'cant_block') &&
    (/^for as long as this artifact remains tapped,\s*another target permanent\b/i.test(existing) ||
      /\banother target permanent loses all abilities\b/i.test(existing))
  ) {
    return { kind: 'raw', text: 'another target permanent' };
  }
  if (existing) return { kind: 'raw', text: existing };
  const inferred = inferTargetTextFromStepRaw(step);
  return inferred ? { kind: 'raw', text: inferred } : undefined;
}
