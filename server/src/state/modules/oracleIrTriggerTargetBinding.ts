import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { readTriggeringSpellManaValue } from './oracleIrTriggerPrimaryIncompleteReasons.js';
import { getActualPowerToughness } from '../utils.js';
import { getCurrentPowerToughnessForRules } from './currentPowerToughness.js';
import { findTriggeringSpellOnStack, stackObjectIdsMatch } from './triggerCastSpellStackBinding.js';
import { readTriggerEffectCastXValue } from './triggerSourceUtils.js';

/** Binds a triggered ability's chosen/implied targets (permanent, player, spell, X) for Oracle IR execution. */
export function resolveTriggerTargetBinding(
  ctx: GameContext,
  triggerItem: any | undefined,
  controller: PlayerID,
): {
  targetPermanentId?: string;
  targetPlayerId?: PlayerID;
  targetSpellId?: string;
  chosenObjectIds?: readonly string[];
  sourcePermanentId?: string;
  sourceId?: string;
  referenceAmount?: number;
  xValue?: number;
  spellManaValue?: number;
} {
  const state = (ctx as any).state;
  const targets = Array.isArray(triggerItem?.targets) ? triggerItem.targets : [];
  let targetPlayerId = String(
    targets[0]?.id || targets[0] || triggerItem?.targetPlayerId || '',
  ).trim() as PlayerID;
  const knownPlayerIds = new Set(
    (Array.isArray(state?.players) ? state.players : [])
      .map((player: any) => String(player?.id || '').trim())
      .filter(Boolean),
  );
  if (targetPlayerId && !knownPlayerIds.has(targetPlayerId)) {
    targetPlayerId = '' as PlayerID;
  }

  if (!targetPlayerId) {
    const players = Array.isArray(state?.players) ? state.players : [];
    const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));
    for (const targetId of targets.map((target: any) => String(target || '').trim()).filter(Boolean)) {
      if (playerIds.has(targetId)) {
        targetPlayerId = targetId as PlayerID;
        break;
      }
    }
    const explicitTargetPlayer = String(triggerItem?.targetPlayer || '').trim();
    if (!targetPlayerId && explicitTargetPlayer && playerIds.has(explicitTargetPlayer)) {
      targetPlayerId = explicitTargetPlayer as PlayerID;
    }
    const triggerValue = (triggerItem as any)?.value;
    const defendingPlayerId = String(
      triggerItem?.defendingPlayer
        || triggerItem?.effectData?.defendingPlayerId
        || triggerItem?.effectData?.defendingPlayer
        || (triggerValue && typeof triggerValue === 'object' ? triggerValue.defendingPlayerId : '')
        || (triggerValue && typeof triggerValue === 'object' ? triggerValue.defendingPlayer : '')
        || '',
    ).trim();
    if (!targetPlayerId && defendingPlayerId && playerIds.has(defendingPlayerId)) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
    const triggeringPlayer = String(triggerItem?.triggeringPlayer || '').trim();
    if (!targetPlayerId && triggeringPlayer && playerIds.has(triggeringPlayer)) {
      targetPlayerId = triggeringPlayer as PlayerID;
    }
  }

  const sourcePermanentId = String(
    triggerItem?.source || triggerItem?.permanentId || '',
  ).trim();

  if (!targetPlayerId && sourcePermanentId) {
    const sourcePermanent = (state?.battlefield || []).find(
      (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId,
    ) as any;
    const attackingPlayerId = String(sourcePermanent?.attacking || '').trim();
    if (attackingPlayerId && !attackingPlayerId.startsWith('perm_')) {
      targetPlayerId = attackingPlayerId as PlayerID;
    }
    const enchantedTarget = String(
      sourcePermanent?.attachedTo
        || sourcePermanent?.enchanting
        || sourcePermanent?.enchantedPlayerId
        || '',
    ).trim();
    if (enchantedTarget) {
      targetPlayerId = enchantedTarget as PlayerID;
    }
  }

  if (!targetPlayerId) {
    const defendingPlayerId = String(
      triggerItem?.defendingPlayer
        || triggerItem?.effectData?.defendingPlayer
        || '',
    ).trim();
    if (defendingPlayerId && !defendingPlayerId.startsWith('perm_')) {
      targetPlayerId = defendingPlayerId as PlayerID;
    }
  }

  const sourceId = String(sourcePermanentId || triggerItem?.sourceId || triggerItem?.id || '').trim();
  const triggeringStackItemId = String(
    triggerItem?.triggeringStackItemId
    || triggerItem?.effectData?.triggeringStackItemId
    || '',
  ).trim();
  const lifeLostReference = Number(triggerItem?.effectData?.lifeLost ?? 0);
  const lifePaidReference = Number(triggerItem?.effectData?.lifePaid ?? 0);
  const countersPlacedReference = Number(triggerItem?.effectData?.countersPlaced ?? 0);
  const snapshottedReference = Number(
    triggerItem?.referenceAmount
    ?? triggerItem?.value?.attachedAuraCount
    ?? triggerItem?.effectData?.attachedAuraCount
    ?? 0,
  );
  const damageReference = Number(
    triggerItem?.damageAmount ?? triggerItem?.effectData?.damageAmount ?? 0,
  );
  const lifeGainedReference = String(triggerItem?.triggerType || '') === 'lifegain'
    ? Number(triggerItem?.effectData?.lifeGained ?? 0)
    : 0;
  const losingPlayerId = String(
    triggerItem?.effectData?.losingPlayerId
      || triggerItem?.triggeringPlayer
      || triggerItem?.targetPlayer
      || '',
  ).trim() as PlayerID;

  const normalizedTargetIds = targets
    .map((targetRef: any) => (typeof targetRef === 'string' ? targetRef : String(targetRef?.id || '')))
    .filter(Boolean);

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const players = Array.isArray(state?.players) ? state.players : [];
  const stack = Array.isArray(state?.stack) ? state.stack : [];

  let targetPermanentId: string | undefined;
  let targetSpellId: string | undefined;
  if (triggeringStackItemId) {
    const stamped = stack.find((stackItem: any) => (
      stackObjectIdsMatch(String(stackItem?.id || ''), triggeringStackItemId)
      || stackObjectIdsMatch(String(stackItem?.card?.id || ''), triggeringStackItemId)
    ));
    if (stamped) {
      targetSpellId = String(stamped.id || '').trim() || undefined;
    } else {
      // Keep the bound id even if the object already left the stack so copy
      // effects (Hive Mind) use last-known information instead of another spell.
      targetSpellId = triggeringStackItemId;
    }
  }
  if (!targetSpellId) {
    const boundSpell = findTriggeringSpellOnStack(state, triggerItem);
    if (boundSpell) {
      targetSpellId = String(boundSpell.id || '').trim() || undefined;
      const boundCaster = String(boundSpell.controller || '').trim();
      if (!targetPlayerId && boundCaster) {
        targetPlayerId = boundCaster as PlayerID;
      }
    }
  }
  for (const targetId of normalizedTargetIds) {
    if (battlefield.some((permanent: any) => String(permanent?.id || '') === targetId)) {
      targetPermanentId = targetId;
      break;
    }
    if (stack.some((stackItem: any) => String(stackItem?.id || '') === targetId)) {
      targetSpellId = targetId;
      break;
    }
    if (players.some((player: any) => String(player?.id || '') === targetId)) {
      targetPlayerId = targetId as PlayerID;
      break;
    }
  }

  const interveningSubjectPermanentId = String(
    triggerItem?.interveningIfSubjectPermanentId || '',
  ).trim();
  // Damage-received watchers retain the object that was dealt damage in
  // effectData. Bind it as the pronoun antecedent for effects such as
  // "put a +1/+1 counter on it"; the watcher itself remains the source for
  // "this creature" / "this permanent".
  const damagedPermanentId = String(
    triggerItem?.effectData?.damagedPermanentId
      || triggerItem?.effectData?.targetPermanentId
      || '',
  ).trim();
  const discardedCardId = String(triggerItem?.effectData?.discardedCardId || '').trim();
  const boundGraveyardCardId = String(triggerItem?.boundGraveyardCardId || '').trim();
  const createdTokenIds = Array.isArray(triggerItem?.effectData?.createdTokenIds)
    ? triggerItem.effectData.createdTokenIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
    : [];
  // Becomes-untapped watchers retain the object that untapped in effectData.
  // Bind it as the pronoun antecedent for "that permanent's controller mills".
  const untappedPermanentId = String(triggerItem?.effectData?.untappedPermanentId || '').trim();
  const untappedPermanentController = String(
    triggerItem?.effectData?.untappedPermanentController || '',
  ).trim() as PlayerID;
  // Attack watchers (Vengeful Ancestor "whenever a goaded creature attacks")
  // stamp the attacking creature so "it deals 1 damage to its controller" binds.
  const attackingCreatureId = String(triggerItem?.effectData?.attackingCreatureId || '').trim();
  const effectNamesSeparateAnyTarget = /\bto any target\b/i.test(
    String(triggerItem?.effect || triggerItem?.description || ''),
  );
  const enteringCreatureWasChosen = Boolean(
    interveningSubjectPermanentId
    && normalizedTargetIds.some((id) => id === interveningSubjectPermanentId),
  );
  // "it deals damage … to any target": the entering creature is the damage
  // source, not an implicit target. Binding it as the target hits that creature
  // for its own power with no prompt.
  const bindEnteringCreatureAsTarget = !effectNamesSeparateAnyTarget || enteringCreatureWasChosen;
  const chosenObjectIds = Array.from(new Set([
    ...normalizedTargetIds,
    ...(bindEnteringCreatureAsTarget && interveningSubjectPermanentId ? [interveningSubjectPermanentId] : []),
    ...(damagedPermanentId ? [damagedPermanentId] : []),
    ...(untappedPermanentId ? [untappedPermanentId] : []),
    ...(attackingCreatureId ? [attackingCreatureId] : []),
    ...(discardedCardId ? [discardedCardId] : []),
    ...(boundGraveyardCardId ? [boundGraveyardCardId] : []),
    ...createdTokenIds,
  ]));
  // Pronoun effects ("put a counter on it") still use the entering creature.
  // "to any target" does not, unless the player actually chose that creature.
  if (
    !targetPermanentId
    && bindEnteringCreatureAsTarget
    && normalizedTargetIds.length === 0
    && interveningSubjectPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === interveningSubjectPermanentId)
  ) {
    targetPermanentId = interveningSubjectPermanentId;
  }
  if (
    !targetPermanentId
    && damagedPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === damagedPermanentId)
  ) {
    targetPermanentId = damagedPermanentId;
  }
  if (
    !targetPermanentId
    && untappedPermanentId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === untappedPermanentId)
  ) {
    targetPermanentId = untappedPermanentId;
  }
  if (
    !targetPermanentId
    && attackingCreatureId
    && battlefield.some((permanent: any) => String(permanent?.id || '') === attackingCreatureId)
  ) {
    targetPermanentId = attackingCreatureId;
  }
  if (!targetPlayerId && untappedPermanentController) {
    const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));
    if (playerIds.has(untappedPermanentController)) {
      targetPlayerId = untappedPermanentController;
    }
  }
  if (!targetPermanentId) {
    const dyingId = String(triggerItem?.dyingCreature?.id || triggerItem?.value?.dyingPermanentId || '').trim();
    if (dyingId) targetPermanentId = dyingId;
  }

  let xValue = typeof triggerItem?.xValue === 'number' ? triggerItem.xValue : undefined;
  const spellManaValue = readTriggeringSpellManaValue(state, triggerItem, targetSpellId);
  if (typeof xValue !== 'number' || !Number.isFinite(xValue)) {
    const effect = String(triggerItem?.effect || triggerItem?.description || '');
    const statMatch = effect.match(/where\s+x\s+is\s+that\s+creature(?:'|’)?s\s+(power|toughness)/i);
    if (statMatch) {
      const subjectId = interveningSubjectPermanentId || String(targetPermanentId || '').trim();
      const onBattlefield = battlefield.find((permanent: any) => String(permanent?.id || '') === subjectId);
      const subject = onBattlefield || triggerItem?.interveningIfSubjectSnapshot;
      if (subject) {
        // Battlefield creature: current P/T. Snapshot (left the battlefield): recorded values.
        const pt = onBattlefield
          ? getCurrentPowerToughnessForRules(onBattlefield, state)
          : getActualPowerToughness(subject, state);
        const bound = String(statMatch[1] || '').toLowerCase() === 'power' ? pt.power : pt.toughness;
        if (Number.isFinite(bound)) {
          xValue = Math.max(0, Math.floor(Number(bound)));
        }
      }
    }
    if (
      (typeof xValue !== 'number' || !Number.isFinite(xValue))
      && /where\s+x\s+is\s+that\s+spell(?:'|’)?s\s+mana\s+value/i.test(effect)
      && typeof spellManaValue === 'number'
    ) {
      xValue = spellManaValue;
    }
    if (typeof xValue !== 'number' || !Number.isFinite(xValue)) {
      const castX = readTriggerEffectCastXValue(state, triggerItem);
      if (typeof castX === 'number') xValue = castX;
    }
  }

  return {
    targetPermanentId,
    targetPlayerId: (targetPlayerId || losingPlayerId || undefined) as PlayerID | undefined,
    targetSpellId,
    chosenObjectIds: chosenObjectIds.length > 0 ? chosenObjectIds : undefined,
    sourcePermanentId: sourcePermanentId || undefined,
    sourceId: sourceId || undefined,
    referenceAmount:
      Number.isFinite(lifeLostReference) && lifeLostReference > 0
        ? lifeLostReference
        : Number.isFinite(lifePaidReference) && lifePaidReference > 0
          ? lifePaidReference
          : Number.isFinite(countersPlacedReference) && countersPlacedReference > 0
            ? countersPlacedReference
            : Number.isFinite(snapshottedReference) && snapshottedReference > 0
              ? snapshottedReference
              : Number.isFinite(damageReference) && damageReference > 0
                ? damageReference
                : Number.isFinite(lifeGainedReference) && lifeGainedReference > 0
                  ? lifeGainedReference
                  : undefined,
    xValue,
    spellManaValue,
  };
}

/** Last-known snapshots of permanents sacrificed to put this reflexive trigger on the stack (Surtland Flinger). */
