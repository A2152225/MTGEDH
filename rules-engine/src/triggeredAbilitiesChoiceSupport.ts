import type { GameState, PlayerID } from '../../shared/src';
import {
  createMayAbilityEvent,
  createModeSelectionEvent,
  createOptionChoiceEvent,
  createTargetSelectionEvent,
  type ChoiceEvent,
} from './choiceEvents';
import { parseOracleTextToIR } from './oracleIRParser';
import { type TriggerEventData, buildTriggerEventDataFromPayloads } from './triggeredAbilitiesEventData';
import type { TriggeredAbility } from './triggeredAbilities';

export interface ResolvedTriggeredAbilityChoice {
  readonly type: 'target_selection' | 'option_choice' | 'mode_selection';
  readonly selections?: unknown;
  readonly targetTypes?: readonly string[];
  readonly mayAbilityPrompt?: boolean;
}

function extractTriggeredChoiceSelectionId(selection: unknown): string | undefined {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized || undefined;
  }

  if (Array.isArray(selection)) {
    for (const entry of selection) {
      const extracted = extractTriggeredChoiceSelectionId(entry);
      if (extracted) return extracted;
    }
    return undefined;
  }

  if (selection && typeof selection === 'object') {
    const id = typeof (selection as any).id === 'string' ? (selection as any).id.trim() : '';
    if (id) return id;

    const value = typeof (selection as any).value === 'string' ? (selection as any).value.trim() : '';
    if (value) return value;

    const choiceId = typeof (selection as any).choiceId === 'string' ? (selection as any).choiceId.trim() : '';
    if (choiceId) return choiceId;
  }

  return undefined;
}

function extractTriggeredChoiceSelectionIds(selection: unknown, dedupe: boolean = true): string[] {
  if (typeof selection === 'string') {
    const normalized = selection.trim();
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(selection)) {
    const ids = selection.flatMap((entry: unknown) => extractTriggeredChoiceSelectionIds(entry, dedupe));
    return dedupe
      ? ids.filter((id: string, index: number, items: string[]) => items.indexOf(id) === index)
      : ids.filter(Boolean);
  }

  const extracted = extractTriggeredChoiceSelectionId(selection);
  return extracted ? [extracted] : [];
}

export function buildTriggeredAbilityEventDataFromChoices(
  state: GameState,
  controllerId: string,
  choices: readonly ResolvedTriggeredAbilityChoice[]
): TriggerEventData {
  const overrides: Record<string, unknown> = {};
  const playerIds = new Set(
    ((state.players || []) as any[])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean)
  );

  for (const choice of choices) {
    if (choice?.mayAbilityPrompt) {
      continue;
    }

    if (choice?.type === 'target_selection') {
      const selectedIds = extractTriggeredChoiceSelectionIds(choice?.selections);
      if (selectedIds.length === 0) continue;

      const normalizedTargetTypes = Array.isArray(choice?.targetTypes)
        ? choice.targetTypes.map((entry: any) => String(entry || '').toLowerCase())
        : [];

      if (normalizedTargetTypes.includes('opponent')) {
        if (selectedIds.length === 1) {
          overrides.targetOpponentId = selectedIds[0];
          overrides.targetPlayerId = selectedIds[0];
        } else {
          overrides.affectedOpponentIds = selectedIds;
          overrides.affectedPlayerIds = selectedIds;
        }
        continue;
      }

      if (normalizedTargetTypes.includes('player')) {
        if (selectedIds.length === 1) {
          overrides.targetPlayerId = selectedIds[0];
          if (selectedIds[0] !== controllerId) {
            overrides.targetOpponentId = selectedIds[0];
          }
        } else {
          overrides.affectedPlayerIds = selectedIds;
          const opponentIds = selectedIds.filter((id: string) => id !== controllerId);
          if (opponentIds.length > 0) {
            overrides.affectedOpponentIds = opponentIds;
          }
        }
        continue;
      }

      const nonPlayerIds = selectedIds.filter((id: string) => !playerIds.has(id));
      if (nonPlayerIds.length === 1) {
        overrides.targetPermanentId = nonPlayerIds[0];
      }
      continue;
    }

    if (choice?.type === 'option_choice') {
      const selectedId = extractTriggeredChoiceSelectionId(choice?.selections);
      if (selectedId === 'tap' || selectedId === 'untap') {
        overrides.tapOrUntapChoice = selectedId;
      }
      continue;
    }

    if (choice?.type === 'mode_selection') {
      overrides.selectedModeIds = extractTriggeredChoiceSelectionIds(choice?.selections, false);
    }
  }

  return overrides as TriggerEventData;
}

export function normalizeTriggerContextId(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

export function buildEnrichedTriggerExecutionEventData(
  state: GameState,
  ability: Pick<TriggeredAbility, 'controllerId' | 'sourceId' | 'sourceName' | 'effect'>,
  eventData?: TriggerEventData,
  options: { inferTapOrUntapChoice?: boolean } = {}
): TriggerEventData | undefined {
  const normalizedEventData = buildTriggerEventDataFromPayloads(
    eventData?.sourceControllerId ?? ability.controllerId,
    eventData,
    {
      sourceId: ability.sourceId,
      sourceControllerId: ability.controllerId,
    }
  );

  const playerIds = new Set(
    (state.players || [])
      .map((player: any) => normalizeTriggerContextId(player?.id))
      .filter((id: string | undefined): id is string => Boolean(id))
  );
  const findObjectById = (id: string | undefined): any => {
    const normalizedId = normalizeTriggerContextId(id);
    if (!normalizedId) return undefined;

    const battlefieldMatch = ((state.battlefield || []) as any[]).find(
      perm => normalizeTriggerContextId(perm?.id) === normalizedId
    );
    if (battlefieldMatch) return battlefieldMatch;

    for (const player of state.players || []) {
      for (const zoneName of ['graveyard', 'hand', 'exile', 'library'] as const) {
        const zone = Array.isArray((player as any)?.[zoneName]) ? (player as any)[zoneName] : [];
        const match = zone.find((card: any) => normalizeTriggerContextId(card?.id) === normalizedId);
        if (match) return match;
      }
    }

    return undefined;
  };
  const inferDamageSourceIds = (): readonly string[] | undefined => {
    if (Array.isArray(normalizedEventData.damagedByPermanentIds) && normalizedEventData.damagedByPermanentIds.length > 0) {
      return normalizedEventData.damagedByPermanentIds;
    }

    const referencedObject = findObjectById(
      normalizedEventData.targetPermanentId ??
      normalizedEventData.sourceId ??
      eventData?.targetPermanentId ??
      eventData?.sourceId
    );
    if (!Array.isArray((referencedObject as any)?.damageSourceIds) || (referencedObject as any).damageSourceIds.length === 0) {
      return undefined;
    }

    return (referencedObject as any).damageSourceIds
      .map((id: unknown) => normalizeTriggerContextId(id))
      .filter((id: string | undefined): id is string => Boolean(id));
  };
  const inferSourceAttachedToPermanentIds = (): readonly string[] | undefined => {
    if (
      Array.isArray(normalizedEventData.sourceAttachedToPermanentIds) &&
      normalizedEventData.sourceAttachedToPermanentIds.length > 0
    ) {
      return normalizedEventData.sourceAttachedToPermanentIds;
    }

    const sourcePermanent = findObjectById(ability.sourceId);
    const attachedToId = normalizeTriggerContextId(sourcePermanent?.attachedTo ?? sourcePermanent?.enchanting);
    return attachedToId ? [attachedToId] : undefined;
  };

  const inferredTargetPermanentId = (() => {
    const explicit = normalizeTriggerContextId(normalizedEventData.targetPermanentId ?? eventData?.targetPermanentId);
    if (explicit) return explicit;
    const fallbackTargetId = normalizeTriggerContextId(normalizedEventData.targetId ?? eventData?.targetId);
    if (fallbackTargetId && !playerIds.has(fallbackTargetId)) return fallbackTargetId;
    return undefined;
  })();

  const inferredTapOrUntapChoice = (() => {
    if (!options.inferTapOrUntapChoice) return undefined;
    const explicit = normalizedEventData.tapOrUntapChoice ?? eventData?.tapOrUntapChoice;
    if (explicit === 'tap' || explicit === 'untap') return explicit;
    if (!inferredTargetPermanentId) return undefined;
    const permanent = ((state.battlefield || []) as any[]).find(
      perm => normalizeTriggerContextId(perm?.id) === inferredTargetPermanentId
    );
    if (!permanent) return undefined;
    return Boolean((permanent as any)?.tapped) ? 'untap' : 'tap';
  })();
  const inferredDamagedByPermanentIds = inferDamageSourceIds();
  const inferredSourceAttachedToPermanentIds = inferSourceAttachedToPermanentIds();
  const inferredSourceRenowned = (() => {
    if (typeof normalizedEventData.sourceRenowned === 'boolean') return normalizedEventData.sourceRenowned;
    if (typeof eventData?.sourceRenowned === 'boolean') return eventData.sourceRenowned;
    const sourcePermanent = findObjectById(ability.sourceId);
    if (typeof sourcePermanent?.isRenowned === 'boolean') return Boolean(sourcePermanent.isRenowned);
    if (typeof sourcePermanent?.renowned === 'boolean') return Boolean(sourcePermanent.renowned);
    if (sourcePermanent) return false;
    return undefined;
  })();
  const inferredPlayerLifeTotals = (() => {
    const out: Record<string, number> = {};
    for (const player of state.players || []) {
      const playerId = normalizeTriggerContextId((player as any)?.id);
      const life = Number((player as any)?.life);
      if (!playerId || !Number.isFinite(life)) continue;
      out[playerId] = life;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  })();

  const hasBaseEventData = Boolean(eventData) || Object.keys(normalizedEventData).length > 0;
  if (
    !hasBaseEventData &&
    !inferredTargetPermanentId &&
    !inferredTapOrUntapChoice &&
    !inferredDamagedByPermanentIds &&
    !inferredSourceAttachedToPermanentIds &&
    typeof inferredSourceRenowned !== 'boolean' &&
    !inferredPlayerLifeTotals
  ) {
    return undefined;
  }

  return {
    ...((eventData as Record<string, unknown> | undefined) || {}),
    ...normalizedEventData,
    ...(inferredTargetPermanentId ? { targetPermanentId: inferredTargetPermanentId } : {}),
    ...(inferredTapOrUntapChoice ? { tapOrUntapChoice: inferredTapOrUntapChoice } : {}),
    ...(inferredDamagedByPermanentIds ? { damagedByPermanentIds: inferredDamagedByPermanentIds } : {}),
    ...(inferredSourceAttachedToPermanentIds
      ? { sourceAttachedToPermanentIds: inferredSourceAttachedToPermanentIds }
      : {}),
    ...(typeof inferredSourceRenowned === 'boolean' ? { sourceRenowned: inferredSourceRenowned } : {}),
    ...(inferredPlayerLifeTotals ? { playerLifeTotals: inferredPlayerLifeTotals } : {}),
  } as TriggerEventData;
}

function getTriggerSourceImage(state: GameState, sourceId: string | undefined): string | undefined {
  const normalizedSourceId = normalizeTriggerContextId(sourceId);
  if (!normalizedSourceId) return undefined;
  const permanent = ((state.battlefield || []) as any[]).find(
    perm => normalizeTriggerContextId(perm?.id) === normalizedSourceId
  ) as any;
  const images = permanent?.card?.image_uris;
  return images?.small || images?.normal || undefined;
}

function buildPermanentTargetChoiceOptions(state: GameState): readonly { id: string; name: string; imageUrl?: string }[] {
  return ((state.battlefield || []) as any[])
    .map((perm: any) => {
      const id = normalizeTriggerContextId(perm?.id);
      if (!id) return undefined;
      const card = perm?.card || {};
      const name = String(card?.name || perm?.name || id).trim() || id;
      const imageUrl = card?.image_uris?.small || card?.image_uris?.normal || undefined;
      const option: { id: string; name: string; imageUrl?: string } = { id, name };
      if (imageUrl) {
        option.imageUrl = imageUrl;
      }
      return option;
    })
    .filter((option): option is { id: string; name: string; imageUrl?: string } => Boolean(option));
}

function buildFilteredPermanentTargetChoiceOptions(
  state: GameState,
  controllerId: string,
  filter: 'any' | 'creature_you_control'
): readonly { id: string; name: string; imageUrl?: string }[] {
  const normalizedControllerId = normalizeTriggerContextId(controllerId);
  return ((state.battlefield || []) as any[])
    .filter((perm: any) => {
      if (filter === 'any') return true;
      if (filter !== 'creature_you_control') return true;
      const permControllerId = normalizeTriggerContextId(perm?.controller);
      const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
      return permControllerId === normalizedControllerId && /\bcreature\b/i.test(typeLine);
    })
    .map((perm: any) => {
      const id = normalizeTriggerContextId(perm?.id);
      if (!id) return undefined;
      const card = perm?.card || {};
      const name = String(card?.name || perm?.name || id).trim() || id;
      const imageUrl = card?.image_uris?.small || card?.image_uris?.normal || undefined;
      const option: { id: string; name: string; imageUrl?: string } = { id, name };
      if (imageUrl) option.imageUrl = imageUrl;
      return option;
    })
    .filter((option): option is { id: string; name: string; imageUrl?: string } => Boolean(option));
}

function buildPlayerTargetChoiceOptions(
  state: GameState,
  controllerId: string,
  mode: 'player' | 'opponent'
): readonly { id: string; name: string }[] {
  return ((state.players || []) as any[])
    .map((player: any) => {
      const id = normalizeTriggerContextId(player?.id);
      if (!id) return undefined;
      if (mode === 'opponent' && id === controllerId) return undefined;
      return {
        id,
        name: String(player?.name || id).trim() || id,
      };
    })
    .filter((option): option is { id: string; name: string } => Boolean(option));
}

function getUnresolvedPlayerTargetKinds(steps: readonly any[]): { needsPlayerTarget: boolean; needsOpponentTarget: boolean } {
  let needsPlayerTarget = false;
  let needsOpponentTarget = false;

  for (const step of steps) {
    const whoKind = String((step as any)?.who?.kind || '').trim();
    if (whoKind === 'target_player') needsPlayerTarget = true;
    if (whoKind === 'target_opponent') needsOpponentTarget = true;
  }

  return { needsPlayerTarget, needsOpponentTarget };
}

function getUnresolvedChooseModeSteps(steps: readonly any[]): readonly any[] {
  return steps.filter((step: any) => step?.kind === 'choose_mode');
}

export function buildTriggeredAbilityChoiceEvents(
  state: GameState,
  ability: Pick<TriggeredAbility, 'controllerId' | 'sourceId' | 'sourceName' | 'effect' | 'optional'>,
  eventData?: TriggerEventData
): readonly ChoiceEvent[] {
  const ir = parseOracleTextToIR(ability.effect, ability.sourceName);
  const steps = ir.abilities.flatMap(a => a.steps);
  const enrichedEventData = buildEnrichedTriggerExecutionEventData(state, ability, eventData, {
    inferTapOrUntapChoice: false,
  });
  const sourceImage = getTriggerSourceImage(state, ability.sourceId);
  const choiceEvents: ChoiceEvent[] = [];
  const unresolvedPlayerTargets = getUnresolvedPlayerTargetKinds(steps as any[]);
  const unresolvedChooseModeSteps = getUnresolvedChooseModeSteps(steps as any[]);

  if (ability.optional || steps.some(step => Boolean((step as any).optional))) {
    choiceEvents.push(
      createMayAbilityEvent(
        ability.controllerId as PlayerID,
        ability.sourceId,
        ability.sourceName,
        ability.effect,
        undefined,
        sourceImage
      )
    );
  }

  if (unresolvedPlayerTargets.needsOpponentTarget && !enrichedEventData?.targetOpponentId) {
    const validTargets = buildPlayerTargetChoiceOptions(state, ability.controllerId, 'opponent');
    if (validTargets.length > 0) {
      choiceEvents.push(
        createTargetSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          validTargets,
          ['opponent'],
          1,
          1,
          true,
          sourceImage
        )
      );
    }
  }

  if (unresolvedPlayerTargets.needsPlayerTarget && !enrichedEventData?.targetPlayerId) {
    const validTargets = buildPlayerTargetChoiceOptions(state, ability.controllerId, 'player');
    if (validTargets.length > 0) {
      choiceEvents.push(
        createTargetSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          validTargets,
          ['player'],
          1,
          1,
          true,
          sourceImage
        )
      );
    }
  }

  if (!Array.isArray(enrichedEventData?.selectedModeIds)) {
    for (const step of unresolvedChooseModeSteps) {
      const modes = Array.isArray((step as any)?.modes) ? (step as any).modes : [];
      if (modes.length === 0) continue;
      choiceEvents.push(
        createModeSelectionEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          modes.map((mode: any) => ({
            id: String(mode?.label || '').trim(),
            text: String(mode?.raw || mode?.label || '').trim() || String(mode?.label || '').trim(),
          })),
          Math.max(0, Number((step as any)?.minModes ?? 0) || 0),
          Number((step as any)?.maxModes ?? -1) || -1,
          sourceImage,
          Boolean((step as any)?.canRepeatModes)
        )
      );
    }
  }

  for (const step of steps) {
    if (step.kind === 'attach' && !enrichedEventData?.targetPermanentId) {
      const targetRaw = String((step.to as any)?.text || (step.to as any)?.raw || '').trim().toLowerCase();
      const validTargets = /^target creature you control$/i.test(targetRaw)
        ? buildFilteredPermanentTargetChoiceOptions(state, ability.controllerId, 'creature_you_control')
        : /^target creature$/i.test(targetRaw)
          ? buildFilteredPermanentTargetChoiceOptions(state, ability.controllerId, 'any').filter(option => {
              const permanent = ((state.battlefield || []) as any[]).find(
                perm => normalizeTriggerContextId(perm?.id) === option.id
              ) as any;
              const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
              return /\bcreature\b/i.test(typeLine);
            })
          : [];
      if (validTargets.length > 0) {
        choiceEvents.push(
          createTargetSelectionEvent(
            ability.controllerId as PlayerID,
            ability.sourceId,
            ability.sourceName,
            validTargets,
            ['permanent'],
            1,
            1,
            true,
            sourceImage
          )
        );
      }
      continue;
    }

    if (step.kind !== 'tap_or_untap') continue;

    if (!enrichedEventData?.targetPermanentId) {
      const validTargets = buildPermanentTargetChoiceOptions(state);
      if (validTargets.length > 0) {
        choiceEvents.push(
          createTargetSelectionEvent(
            ability.controllerId as PlayerID,
            ability.sourceId,
            ability.sourceName,
            validTargets,
            ['permanent'],
            1,
            1,
            true,
            sourceImage
          )
        );
      }
    }

    if (!enrichedEventData?.tapOrUntapChoice) {
      const targetPermanentName = (() => {
        const targetPermanentId = normalizeTriggerContextId(enrichedEventData?.targetPermanentId);
        if (!targetPermanentId) return 'the target permanent';
        const permanent = ((state.battlefield || []) as any[]).find(
          perm => normalizeTriggerContextId(perm?.id) === targetPermanentId
        ) as any;
        return String(permanent?.card?.name || permanent?.name || 'the target permanent').trim() || 'the target permanent';
      })();

      choiceEvents.push(
        createOptionChoiceEvent(
          ability.controllerId as PlayerID,
          ability.sourceId,
          ability.sourceName,
          `Choose whether ${ability.sourceName} taps or untaps ${targetPermanentName}`,
          [
            { id: 'tap', label: 'Tap', description: `Tap ${targetPermanentName}` },
            { id: 'untap', label: 'Untap', description: `Untap ${targetPermanentName}` },
          ],
          1,
          1
        )
      );
    }
  }

  return choiceEvents;
}
