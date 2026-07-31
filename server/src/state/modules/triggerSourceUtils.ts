export function buildInterveningIfSubjectSnapshot(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;
  return {
    id: permanent.id,
    controller: permanent.controller,
    owner: permanent.owner,
    enteredFromZone: permanent.enteredFromZone,
    enteredFromGraveyard: permanent.enteredFromGraveyard,
    enteredFromCast: permanent.enteredFromCast,
    castSourceZone: permanent.castSourceZone,
    castFromHand: permanent.castFromHand,
    card: permanent.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

export function buildTriggerSourcePermanentSnapshot(permanent: any): any | undefined {
  if (!permanent || typeof permanent !== 'object') return undefined;

  return {
    id: permanent.id,
    controller: permanent.controller,
    owner: permanent.owner,
    tapped: permanent.tapped,
    isToken: permanent.isToken,
    token: permanent.token,
    enteredFromZone: permanent.enteredFromZone,
    enteredFromGraveyard: permanent.enteredFromGraveyard,
    enteredFromCast: permanent.enteredFromCast,
    castSourceZone: permanent.castSourceZone,
    castFromHand: permanent.castFromHand,
    counters: permanent.counters && typeof permanent.counters === 'object' ? { ...(permanent.counters as any) } : undefined,
    card: permanent.card && typeof permanent.card === 'object' ? { ...(permanent.card as any) } : undefined,
  };
}

export function getTriggerSourcePermanent(state: any, triggerItem: any, sourcePermanent?: any): any | null {
  if (sourcePermanent) {
    return sourcePermanent;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourceId = String(
    triggerItem?.source ||
    triggerItem?.sourceId ||
    triggerItem?.permanentId ||
    '',
  ).trim();

  if (sourceId) {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '') === sourceId);
    if (permanent) {
      return permanent;
    }
  }

  return triggerItem?.sourcePermanentSnapshot || null;
}

/**
 * Resolve who controls a triggered-ability stack item.
 * Missing controller used to orphan Effect Program option_choice steps (priority stays null forever).
 */
export function resolveTriggeredAbilityControllerId(
  state: any,
  triggerItem: any,
  fallbackController?: string | null,
): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const playerIds = new Set(players.map((player: any) => String(player?.id || '').trim()).filter(Boolean));

  const candidates = [
    triggerItem?.controller,
    triggerItem?.controllerId,
    fallbackController,
    triggerItem?.sourcePermanentSnapshot?.controller,
    triggerItem?.source?.controllerId,
    triggerItem?.source?.controller,
    getTriggerSourcePermanent(state, triggerItem)?.controller,
  ];

  for (const candidate of candidates) {
    const id = String(candidate || '').trim();
    if (!id) continue;
    if (playerIds.size === 0 || playerIds.has(id)) {
      return id;
    }
  }

  return '';
}

export function resolveTriggeredAbilityTargetPlayerId(state: any, triggerItem: any): string {
  const players = Array.isArray(state?.players) ? state.players : [];
  const playerIds = new Set(players.map((player: any) => String(player?.id || '')).filter(Boolean));
  const targets = Array.isArray(triggerItem?.targets)
    ? triggerItem.targets.map((target: any) => String(target || '').trim()).filter(Boolean)
    : [];

  for (const targetId of targets) {
    if (playerIds.has(targetId)) {
      return targetId;
    }
  }

  const explicitTargetPlayer = String(triggerItem?.targetPlayer || '').trim();
  if (explicitTargetPlayer && playerIds.has(explicitTargetPlayer)) {
    return explicitTargetPlayer;
  }

  const triggeringPlayer = String(triggerItem?.triggeringPlayer || '').trim();
  if (triggeringPlayer && playerIds.has(triggeringPlayer)) {
    return triggeringPlayer;
  }

  return '';
}

export function resolvePreparedTargetPermanent(
  state: any,
  description: string,
  triggerItem: any,
  sourcePermanent?: any,
): any | null {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const normalizedDescription = String(description || '').replace(/[’]/g, "'").toLowerCase();
  const targets = Array.isArray(triggerItem?.targets)
    ? triggerItem.targets.map((target: any) => String(target || '').trim()).filter(Boolean)
    : [];

  const targetedPermanent = targets
    .map((targetId: string) => battlefield.find((entry: any) => String(entry?.id || '') === targetId))
    .find(Boolean) || null;
  const triggerSourcePermanent = getTriggerSourcePermanent(state, triggerItem, sourcePermanent);

  if (normalizedDescription.includes('target creature') || normalizedDescription.includes('target permanent') || normalizedDescription.includes('that creature')) {
    return targetedPermanent || triggerSourcePermanent;
  }

  if (
    normalizedDescription.includes('it becomes prepared')
    || normalizedDescription.includes('it becomes unprepared')
    || normalizedDescription.includes('this creature becomes prepared')
    || normalizedDescription.includes('this creature becomes unprepared')
  ) {
    return targetedPermanent || triggerSourcePermanent;
  }

  return triggerSourcePermanent || targetedPermanent;
}
