import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { splitAttachClauseBody } from './oracleIRParserUtils';
import { parseSimpleBattlefieldSelector } from './oracleIRExecutorBattlefieldParser';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import { hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import {
  attachExistingBattlefieldPermanentToTarget,
  moveTargetedCardFromGraveyard,
  moveTargetedCardFromHand,
} from './oracleIRExecutorZoneOps';

type StepApplyResult = {
  readonly applied: true;
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepSkipResult = {
  readonly applied: false;
  readonly message: string;
  readonly reason: 'unsupported_selector' | 'impossible_action' | 'player_choice_required';
  readonly options?: {
    readonly classification?: 'unsupported' | 'player_choice' | 'invalid_input';
    readonly persist?: boolean;
  };
};

export type AttachStepHandlerResult = StepApplyResult | StepSkipResult;

type ParsedAttachClause = {
  readonly attachmentText: string;
  readonly targetText: string;
};

function getControllerId(ctx: OracleIRExecutionContext): PlayerID {
  return (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
}

function getChosenObjectIds(ctx: OracleIRExecutionContext): readonly string[] {
  return Array.isArray(ctx.selectorContext?.chosenObjectIds)
    ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
    : [];
}

function normalizeAttachText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAttachClauseFromStep(step: Extract<OracleEffectStep, { kind: 'attach' }>): ParsedAttachClause | null {
  const attachmentText = String((step.attachment as any)?.text || '').trim();
  const targetText = String((step.to as any)?.text || '').trim();
  if (attachmentText && targetText && !/^(?:up|one)$/i.test(attachmentText)) {
    return { attachmentText, targetText };
  }

  const raw = String(step.raw || '').trim();
  const body = raw.replace(/^you\s+may\s+/i, '').replace(/^attach\s+/i, '').trim();
  const split = splitAttachClauseBody(body);
  if (!split) return null;

  return {
    attachmentText: split.attachmentRaw,
    targetText: split.toRaw,
  };
}

function resolveBattlefieldPermanentBySelector(
  state: GameState,
  selectorText: string,
  ctx: OracleIRExecutionContext,
  lastMovedBattlefieldPermanentIds: readonly string[]
): string | 'player_choice_required' | '' {
  const normalized = normalizeAttachText(selectorText);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = getControllerId(ctx);
  const chosenObjectIds = getChosenObjectIds(ctx);

  if (normalized === 'that creature' || normalized === 'that permanent') {
    const movedIds = lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean);
    const matchingMoved = movedIds.filter((id) => {
      const perm = battlefield.find((entry) => String((entry as any)?.id || '').trim() === id) as any;
      if (!perm) return false;
      return hasExecutorClass(perm, normalized === 'that creature' ? 'creature' : 'permanent');
    });
    if (matchingMoved.length === 1) return matchingMoved[0];
    if (matchingMoved.length > 1) return 'player_choice_required';
    return String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  }

  if (normalized === 'it') {
    const movedIds = lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (movedIds.length === 1) return movedIds[0];
    if (movedIds.length > 1) return 'player_choice_required';
    const contextualTargetId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    return contextualTargetId || '';
  }

  if (normalized === 'the chosen creature') {
    if (chosenObjectIds.length === 1) return chosenObjectIds[0];
    if (chosenObjectIds.length > 1) return 'player_choice_required';
    return String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  }

  if (normalized === 'this creature' || normalized === 'this permanent') {
    return String(ctx.sourceId || '').trim();
  }

  if (normalized === 'target creature' || normalized === 'target creature you control') {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length >= 1) {
      const sorted = [...preferred].sort((left, right) =>
        String((left as any)?.id || '').trim().localeCompare(String((right as any)?.id || '').trim())
      );
      return String((sorted[0] as any)?.id || '').trim();
    }
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  }

  if (normalized === 'her') {
    return String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
  }

  if (/^target land you control$/.test(normalized) || /^target land$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'land')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length >= 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target non-human creature you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        !/\bhuman\b/i.test(String((perm as any)?.type_line || (perm as any)?.card?.type_line || ''))
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  const targetSubtypeYouControl = normalized.match(/^target ([a-z][a-z -]+) you control$/);
  if (targetSubtypeYouControl) {
    const subtype = String(targetSubtypeYouControl[1] || '').trim().toLowerCase();
    if (subtype === 'land') return '';
    const matches = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.type_line || (perm as any)?.card?.type_line || '')
          .toLowerCase()
          .includes(subtype)
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target legendary creature you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.type_line || (perm as any)?.card?.type_line || '')
          .toLowerCase()
          .includes('legendary')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target knight you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.type_line || (perm as any)?.card?.type_line || '')
          .toLowerCase()
          .includes('knight')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^up to one target creature you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'creature')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target attacking creature$/.test(normalized)) {
    const attackersByPlayer = ((state as any)?.attackersDeclaredThisCombatByPlayer || {}) as Record<string, string[]>;
    const attackerIds = new Set(
      (Array.isArray(attackersByPlayer[controllerId]) ? attackersByPlayer[controllerId] : [])
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const matches = battlefield.filter(perm => {
      const permId = String((perm as any)?.id || '').trim();
      return attackerIds.has(permId) || (perm as any)?.isAttacking === true;
    });
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 0) return String((matches[0] as any)?.id || '').trim();
    const fallback = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    return fallback || '';
  }

  if (/^another creature$/.test(normalized)) {
    const sourceId = String(ctx.sourceId || '').trim();
    const matches = battlefield.filter(
      perm =>
        hasExecutorClass(perm as any, 'creature') &&
        String((perm as any)?.id || '').trim() !== sourceId
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return String(ctx.targetCreatureId || '').trim();
  }

  if (/^another permanent with the same controller$/.test(normalized)) {
    const anchorId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const anchor = battlefield.find(perm => String((perm as any)?.id || '').trim() === anchorId) as any;
    const anchorController = String(anchor?.controller || controllerId).trim();
    const excludedIds = new Set(
      [
        anchorId,
        ...(Array.isArray((ctx.selectorContext as any)?.excludeAttachTargetIds)
          ? (ctx.selectorContext as any).excludeAttachTargetIds
          : []),
      ]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const matches = battlefield.filter(perm => {
      const permId = String((perm as any)?.id || '').trim();
      if (!permId || excludedIds.has(permId)) return false;
      return String((perm as any)?.controller || '').trim() === anchorController;
    });
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^another permanent of that type$/.test(normalized)) {
    const anchorId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    const anchor = battlefield.find(perm => String((perm as any)?.id || '').trim() === anchorId) as any;
    const excludedIds = new Set(
      [
        anchorId,
        ...(Array.isArray((ctx.selectorContext as any)?.excludeAttachTargetIds)
          ? (ctx.selectorContext as any).excludeAttachTargetIds
          : []),
      ]
        .map(id => String(id || '').trim())
        .filter(Boolean)
    );
    const hostIsCreature = Boolean(anchor && hasExecutorClass(anchor as any, 'creature'));
    const hostIsLand = Boolean(anchor && hasExecutorClass(anchor as any, 'land'));
    const matches = battlefield.filter(perm => {
      const permId = String((perm as any)?.id || '').trim();
      if (!permId || excludedIds.has(permId)) return false;
      if (hostIsCreature) return hasExecutorClass(perm as any, 'creature');
      if (hostIsLand) return hasExecutorClass(perm as any, 'land');
      return false;
    });
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  const selector = parseSimpleBattlefieldSelector({ kind: 'raw', text: selectorText } as any);
  if (selector) {
    const matches = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (selector.controllerFilter === 'you' && (perm as any)?.controller !== controllerId) return false;
      if (selector.excludeSourceId && permanentId === String(ctx.sourceId || '').trim()) return false;
      if (selector.types.includes('creature') && !hasExecutorClass(perm as any, 'creature')) return false;
      if (selector.types.includes('land') && !hasExecutorClass(perm as any, 'land')) return false;
      if (selector.types.includes('permanent') || selector.types.length === 0) return true;
      return selector.types.some(type => hasExecutorClass(perm as any, type));
    });
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return String((preferred[0] as any)?.id || '').trim();
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1) return 'player_choice_required';
  }

  return '';
}

type CombinedAuraAttachmentRef =
  | { readonly kind: 'battlefield'; readonly id: string }
  | { readonly kind: 'hand'; readonly cardId: string }
  | { readonly kind: 'graveyard'; readonly cardId: string };

function resolveBrunaCombinedAuraAttachments(
  state: GameState,
  attachmentText: string,
  ctx: OracleIRExecutionContext
): CombinedAuraAttachmentRef[] | 'player_choice_required' | '' {
  const normalized = normalizeAttachText(attachmentText);
  if (!/^any number of auras on the battlefield and aura cards from your graveyard and\/or hand$/.test(normalized)) {
    return '';
  }

  const controllerId = getControllerId(ctx);
  const chosenObjectIds = getChosenObjectIds(ctx);
  const refs: CombinedAuraAttachmentRef[] = [];

  const battlefieldAuras = ((state.battlefield || []) as BattlefieldPermanent[])
    .filter(perm => hasExecutorClass(perm as any, 'aura'))
    .map(perm => String((perm as any)?.id || '').trim())
    .filter(Boolean);
  const preferredBattlefieldAuras =
    chosenObjectIds.length > 0
      ? battlefieldAuras.filter(id => chosenObjectIds.includes(id))
      : battlefieldAuras;
  for (const id of preferredBattlefieldAuras.length > 0 ? preferredBattlefieldAuras : battlefieldAuras) {
    refs.push({ kind: 'battlefield', id });
  }

  const player = state.players.find(p => p.id === controllerId) as any;
  for (const zone of ['hand', 'graveyard'] as const) {
    const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
    const auraCardIds = cards
      .filter((card: any) => hasExecutorClass(card as any, 'aura'))
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
    const preferred =
      chosenObjectIds.length > 0 ? auraCardIds.filter(id => chosenObjectIds.includes(id)) : auraCardIds;
    for (const cardId of preferred.length > 0 ? preferred : auraCardIds) {
      refs.push({ kind: zone, cardId });
    }
  }

  return refs.length > 0 ? refs : '';
}

function resolveAttachmentPermanentIds(
  state: GameState,
  attachmentText: string,
  ctx: OracleIRExecutionContext,
  lastMovedBattlefieldPermanentIds: readonly string[]
): string[] | 'player_choice_required' | '' {
  const normalized = normalizeAttachText(attachmentText);
  const battlefield = [...((state.battlefield || []) as BattlefieldPermanent[])];
  const controllerId = getControllerId(ctx);
  const chosenObjectIds = getChosenObjectIds(ctx);
  const sourceId = String(ctx.sourceId || '').trim();

  if (/^this (?:aura|enchantment|equipment|permanent)$/.test(normalized)) {
    if (sourceId) {
      const sourceOnBattlefield = battlefield.some(
        (perm) => String((perm as any)?.id || '').trim() === sourceId
      );
      if (sourceOnBattlefield) return [sourceId];
    }
    const movedIds = lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean);
    const attachmentFromMoved = movedIds.filter((id) => {
      const perm = battlefield.find((entry) => String((entry as any)?.id || '').trim() === id) as any;
      if (!perm) return false;
      return (
        hasExecutorClass(perm, 'equipment') ||
        hasExecutorClass(perm, 'aura') ||
        hasExecutorClass(perm, 'enchantment')
      );
    });
    if (attachmentFromMoved.length === 1) return attachmentFromMoved;
    if (attachmentFromMoved.length > 1) return 'player_choice_required';
    const equipment = battlefield.filter(
      (perm) => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'equipment')
    );
    if (equipment.length === 1) return [String((equipment[0] as any)?.id || '').trim()];
    return sourceId ? [sourceId] : '';
  }

  if (normalized === 'it') {
    const movedIds = lastMovedBattlefieldPermanentIds.map((id) => String(id || '').trim()).filter(Boolean);
    if (movedIds.length === 1) return [movedIds[0]];
    if (movedIds.length > 1) return 'player_choice_required';
    if (sourceId) return [sourceId];
  }

  if (/^that equipment$/.test(normalized)) {
    const movedIds = lastMovedBattlefieldPermanentIds.map(id => String(id || '').trim()).filter(Boolean);
    const equipmentFromMoved = movedIds.filter(id => {
      const perm = battlefield.find(entry => String((entry as any)?.id || '').trim() === id) as any;
      return perm && hasExecutorClass(perm, 'equipment');
    });
    if (equipmentFromMoved.length === 1) return equipmentFromMoved;
    const equipment = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'equipment')
    );
    const preferred = equipment.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return [String((preferred[0] as any)?.id || '').trim()];
    if (equipment.length === 1) return [String((equipment[0] as any)?.id || '').trim()];
    if (sourceId && equipment.some(perm => String((perm as any)?.id || '').trim() === sourceId)) {
      return [sourceId];
    }
    return equipment.length > 0 ? [String((equipment[0] as any)?.id || '').trim()] : '';
  }

  if (/^them$/.test(normalized)) {
    const anchorId = String(ctx.targetCreatureId || ctx.targetPermanentId || '').trim();
    const attachmentIds = battlefield
      .filter(perm => {
        const permId = String((perm as any)?.id || '').trim();
        if (!permId) return false;
        if (!hasExecutorClass(perm as any, 'aura') && !hasExecutorClass(perm as any, 'equipment')) return false;
        if (chosenObjectIds.includes(permId)) return true;
        if (anchorId && String((perm as any)?.attachedTo || '').trim() === anchorId) return true;
        return false;
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const preferred = attachmentIds.filter(id => chosenObjectIds.includes(id));
    if (preferred.length === 1) return preferred;
    if (attachmentIds.length === 1) return attachmentIds;
    if (attachmentIds.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target aura attached to a creature$/.test(normalized)) {
    const auraIds = battlefield
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'aura')) return false;
        const attachedToId = String((perm as any)?.attachedTo || '').trim();
        if (!attachedToId) return false;
        const attached = battlefield.find(entry => String((entry as any)?.id || '').trim() === attachedToId);
        return Boolean(attached && hasExecutorClass(attached as any, 'creature'));
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const preferred = auraIds.filter(id => chosenObjectIds.includes(id));
    if (preferred.length === 1) return preferred;
    if (auraIds.length === 1) return auraIds;
    if (auraIds.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target aura attached to a creature or land$/.test(normalized)) {
    const auraIds = battlefield
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'aura')) return false;
        const attachedToId = String((perm as any)?.attachedTo || '').trim();
        if (!attachedToId) return false;
        const attached = battlefield.find(entry => String((entry as any)?.id || '').trim() === attachedToId);
        return Boolean(
          attached &&
            (hasExecutorClass(attached as any, 'creature') || hasExecutorClass(attached as any, 'land'))
        );
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const preferred = auraIds.filter(id => chosenObjectIds.includes(id));
    if (preferred.length === 1) return preferred;
    if (auraIds.length === 1) return auraIds;
    if (auraIds.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target aura attached to a permanent$/.test(normalized)) {
    const auraIds = battlefield
      .filter(perm => {
        if (!hasExecutorClass(perm as any, 'aura')) return false;
        return Boolean(String((perm as any)?.attachedTo || '').trim());
      })
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    const preferred = auraIds.filter(id => chosenObjectIds.includes(id));
    if (preferred.length === 1) return preferred;
    if (auraIds.length === 1) return auraIds;
    if (auraIds.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^all auras enchanting target permanent$/.test(normalized)) {
    const anchorId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    if (!anchorId) return '';
    const auraIds = battlefield
      .filter(
        perm =>
          hasExecutorClass(perm as any, 'aura') &&
          String((perm as any)?.attachedTo || '').trim() === anchorId
      )
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return auraIds.length > 0 ? auraIds : '';
  }

  if (/^all equipment on the battlefield$/.test(normalized)) {
    const equipmentIds = battlefield
      .filter(perm => hasExecutorClass(perm as any, 'equipment'))
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return equipmentIds.length > 0 ? equipmentIds : '';
  }

  if (/^any number of auras on the battlefield and aura cards from your graveyard and\/or hand$/.test(normalized)) {
    const auraIds = battlefield
      .filter(perm => hasExecutorClass(perm as any, 'aura'))
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return auraIds.length > 0 ? auraIds : '';
  }

  if (/^all equipment attached to that creature$/.test(normalized)) {
    const creatureId = resolveBattlefieldPermanentBySelector(state, 'that creature', ctx, lastMovedBattlefieldPermanentIds);
    if (creatureId === 'player_choice_required') return creatureId;
    if (!creatureId) return '';
    const creature = battlefield.find(perm => String((perm as any)?.id || '').trim() === creatureId) as any;
    const equipmentIds = Array.isArray(creature?.attachedEquipment)
      ? creature.attachedEquipment.map((id: any) => String(id || '').trim()).filter(Boolean)
      : [];
    return equipmentIds.length > 0 ? equipmentIds : '';
  }

  const equipmentMvMatch = normalized.match(
    /^(?:target equipment(?: you control)?)(?: with mana value (\d+)(?: or (\d+))?)?$/
  );
  if (equipmentMvMatch) {
    const allowedMv = [
      Number.parseInt(String(equipmentMvMatch[1] || ''), 10),
      equipmentMvMatch[2] ? Number.parseInt(String(equipmentMvMatch[2] || ''), 10) : NaN,
    ].filter(value => Number.isFinite(value)) as number[];
    const matches = battlefield.filter(perm => {
      if ((perm as any)?.controller !== controllerId || !hasExecutorClass(perm as any, 'equipment')) return false;
      if (allowedMv.length === 0) return true;
      const manaValue = getCardManaValue((perm as any)?.card || perm);
      return manaValue !== null && allowedMv.includes(manaValue);
    });
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return [String((preferred[0] as any)?.id || '').trim()];
    if (matches.length === 1) return [String((matches[0] as any)?.id || '').trim()];
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^any number of auras and equipment you control$/.test(normalized)) {
    const auraAndEquipment = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        (hasExecutorClass(perm as any, 'aura') || hasExecutorClass(perm as any, 'equipment'))
    );
    const preferred = auraAndEquipment.filter(perm =>
      chosenObjectIds.includes(String((perm as any)?.id || '').trim())
    );
    const ids = (preferred.length > 0 ? preferred : auraAndEquipment)
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return ids.length > 0 ? ids : '';
  }

  if (/^any number of equipment you control$/.test(normalized) || /^all equipment you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'equipment')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    const ids = (preferred.length > 0 ? preferred : matches)
      .map(perm => String((perm as any)?.id || '').trim())
      .filter(Boolean);
    return ids.length > 0 ? ids : '';
  }

  if (/^(?:any number of |all )?target equipment(?: you control)?$/.test(normalized) || /^target equipment you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'equipment')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length > 0) return preferred.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    if (matches.length > 0) return matches.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean);
    return '';
  }

  if (/^up to one target equipment(?: you control)?$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'equipment')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return [String((preferred[0] as any)?.id || '').trim()];
    if (matches.length === 1) return [String((matches[0] as any)?.id || '').trim()];
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target aura you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm => (perm as any)?.controller === controllerId && hasExecutorClass(perm as any, 'aura')
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return [String((preferred[0] as any)?.id || '').trim()];
    if (matches.length === 1) return [String((matches[0] as any)?.id || '').trim()];
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  if (/^target aura or equipment you control$/.test(normalized)) {
    const matches = battlefield.filter(
      perm =>
        (perm as any)?.controller === controllerId &&
        (hasExecutorClass(perm as any, 'aura') || hasExecutorClass(perm as any, 'equipment'))
    );
    const preferred = matches.filter(perm => chosenObjectIds.includes(String((perm as any)?.id || '').trim()));
    if (preferred.length === 1) return [String((preferred[0] as any)?.id || '').trim()];
    if (matches.length === 1) return [String((matches[0] as any)?.id || '').trim()];
    if (matches.length > 1) return 'player_choice_required';
    return '';
  }

  const resolved = resolveBattlefieldPermanentBySelector(state, attachmentText, ctx, lastMovedBattlefieldPermanentIds);
  if (resolved === 'player_choice_required') return 'player_choice_required';
  if (resolved) return [resolved];
  return '';
}

export function applyAttachStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'attach' }>,
  ctx: OracleIRExecutionContext,
  lastMovedBattlefieldPermanentIds: readonly string[]
): AttachStepHandlerResult {
  const parsed = parseAttachClauseFromStep(step);
  if (!parsed) {
    return {
      applied: false,
      message: `Skipped attach (unsupported attachment clause): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  const brunaAuraAttachments = resolveBrunaCombinedAuraAttachments(state, parsed.attachmentText, ctx);
  if (brunaAuraAttachments === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped attach (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const attachmentIds = brunaAuraAttachments
    ? []
    : resolveAttachmentPermanentIds(state, parsed.attachmentText, ctx, lastMovedBattlefieldPermanentIds);
  if (attachmentIds === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped attach (needs player attachment choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }
  if ((!brunaAuraAttachments || brunaAuraAttachments.length === 0) && (!attachmentIds || attachmentIds.length === 0)) {
    return {
      applied: false,
      message: `Skipped attach (unsupported attachment selector): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  let targetResolveCtx = ctx;
  const normalizedTarget = normalizeAttachText(parsed.targetText);
  if (
    (/^another permanent with the same controller$/.test(normalizedTarget) ||
      /^another permanent of that type$/.test(normalizedTarget)) &&
    attachmentIds &&
    attachmentIds.length === 1
  ) {
    const attachmentPerm = ((state.battlefield || []) as BattlefieldPermanent[]).find(
      perm => String((perm as any)?.id || '').trim() === attachmentIds[0]
    ) as any;
    const hostId = String(attachmentPerm?.attachedTo || '').trim();
    if (hostId) {
      const selectorContext = {
        ...(ctx.selectorContext || {}),
        excludeAttachTargetIds: attachmentIds,
      };
      targetResolveCtx = {
        ...ctx,
        targetPermanentId: hostId,
        targetCreatureId: hostId,
        selectorContext,
      };
    }
  }

  const targetId = resolveBattlefieldPermanentBySelector(
    state,
    parsed.targetText,
    targetResolveCtx,
    lastMovedBattlefieldPermanentIds
  );
  if (targetId === 'player_choice_required') {
    return {
      applied: false,
      message: `Skipped attach (needs player attachment target choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }
  if (!targetId) {
    return {
      applied: false,
      message: `Skipped attach (unsupported attachment target): ${step.raw}`,
      reason: 'unsupported_selector',
    };
  }

  let workingState = state;
  const combinedLog: string[] = [];
  const controllerId = getControllerId(ctx);

  if (brunaAuraAttachments && brunaAuraAttachments.length > 0) {
    for (const ref of brunaAuraAttachments) {
      if (ref.kind === 'battlefield') {
        const result = attachExistingBattlefieldPermanentToTarget(workingState, ref.id, targetId);
        if (result.kind === 'impossible') continue;
        workingState = result.state;
        combinedLog.push(...result.log);
        continue;
      }

      const result =
        ref.kind === 'hand'
          ? moveTargetedCardFromHand(
              workingState,
              controllerId,
              ref.cardId,
              'aura',
              'battlefield',
              controllerId,
              undefined,
              undefined,
              undefined,
              targetId
            )
          : moveTargetedCardFromGraveyard(
              workingState,
              controllerId,
              ref.cardId,
              { cardType: 'aura' },
              'battlefield',
              controllerId,
              undefined,
              undefined,
              undefined,
              targetId
            );
      if (result.kind !== 'applied') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
    }
  } else {
    for (const attachmentId of attachmentIds) {
      const result = attachExistingBattlefieldPermanentToTarget(workingState, attachmentId, targetId);
      if (result.kind === 'impossible') {
        return {
          applied: false,
          message: `Skipped attach (attachment target unavailable): ${step.raw}`,
          reason: 'impossible_action',
          options: { persist: false },
        };
      }
      workingState = result.state;
      combinedLog.push(...result.log);
    }
  }

  return {
    applied: true,
    state: workingState,
    log: combinedLog,
  };
}
