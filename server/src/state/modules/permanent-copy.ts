function readCharacteristicNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function applyCopyCardOntoPermanent(
  sourcePermanent: any,
  targetCard: any,
  targetPermanent: any | null,
  retainedAbilityText?: string,
): { applied: boolean; sourceName?: string; targetName?: string } {
  const sourceCard = (sourcePermanent?.card && typeof sourcePermanent.card === 'object')
    ? sourcePermanent.card
    : sourcePermanent;

  if (!sourcePermanent.preCopyCardSnapshot) {
    sourcePermanent.preCopyCardSnapshot = {
      name: String(sourcePermanent?.name || sourceCard?.name || '').trim() || undefined,
      cardType: String(sourcePermanent?.cardType || sourcePermanent?.type_line || sourceCard?.type_line || '').trim() || undefined,
      type_line: String(sourcePermanent?.type_line || sourceCard?.type_line || '').trim() || undefined,
      oracle_text: String(sourcePermanent?.oracle_text || sourceCard?.oracle_text || '').trim() || undefined,
      power: sourcePermanent?.power ?? sourcePermanent?.basePower,
      toughness: sourcePermanent?.toughness ?? sourcePermanent?.baseToughness,
      card: JSON.parse(JSON.stringify(sourceCard)),
      grantedAbilities: Array.isArray(sourcePermanent?.grantedAbilities)
        ? [...sourcePermanent.grantedAbilities]
        : undefined,
    };
  }

  const rawRetained = String(retainedAbilityText || '').trim();
  const sourceOracleBeforeCopy = String(sourceCard?.oracle_text || sourcePermanent?.oracle_text || '').trim();
  const retained = /^it has this ability$/i.test(rawRetained)
    ? (sourceOracleBeforeCopy.match(
        /At the beginning of your upkeep, you may have this creature become a copy of another target creature, except it has this ability\.?/i,
      )?.[0] || sourceOracleBeforeCopy)
    : rawRetained;
  const targetOracleText = String(targetCard?.oracle_text || '').trim();
  const copiedOracleText = retained
    ? [targetOracleText, retained].filter(Boolean).join('\n')
    : targetOracleText;

  const copiedName = String(targetCard?.name || targetPermanent?.name || '').trim();
  const typeLine = String(targetCard?.type_line || targetPermanent?.type_line || '').trim();
  const copiedPower = readCharacteristicNumber(
    targetPermanent?.basePower,
    targetPermanent?.power,
    targetCard?.power,
  );
  const copiedToughness = readCharacteristicNumber(
    targetPermanent?.baseToughness,
    targetPermanent?.toughness,
    targetCard?.toughness,
  );

  const grantedAbilities = Array.isArray(sourcePermanent?.grantedAbilities)
    ? sourcePermanent.grantedAbilities.map((entry: unknown) => String(entry || '').trim()).filter(Boolean)
    : [];
  if (retained && !grantedAbilities.includes(retained)) {
    grantedAbilities.push(retained);
  }

  const nextCard = {
    ...sourceCard,
    ...targetCard,
    id: String(sourceCard?.id || sourcePermanent?.id || '').trim() || sourceCard?.id,
    zone: 'battlefield',
    ...(copiedName ? { name: copiedName } : {}),
    ...(typeLine ? { type_line: typeLine } : {}),
    ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
    ...(Array.isArray(targetCard?.colors) ? { colors: [...targetCard.colors] } : {}),
    ...(targetCard?.mana_cost || targetCard?.manaCost
      ? { mana_cost: targetCard?.mana_cost ?? targetCard?.manaCost }
      : {}),
    ...(copiedPower !== undefined ? { power: String(copiedPower) } : {}),
    ...(copiedToughness !== undefined ? { toughness: String(copiedToughness) } : {}),
  };

  Object.assign(sourcePermanent, {
    ...(copiedName ? { name: copiedName } : {}),
    ...(typeLine ? { cardType: typeLine, type_line: typeLine } : {}),
    ...(copiedOracleText ? { oracle_text: copiedOracleText } : {}),
    ...(copiedPower !== undefined
      ? { power: copiedPower, basePower: copiedPower, effectivePower: undefined }
      : {}),
    ...(copiedToughness !== undefined
      ? { toughness: copiedToughness, baseToughness: copiedToughness, effectiveToughness: undefined }
      : {}),
    ...(grantedAbilities.length > 0 ? { grantedAbilities } : {}),
    ...(targetPermanent?.id
      ? { copiedFromPermanentId: String(targetPermanent.id || '').trim() }
      : {}),
    copiedFromCardId: String(targetCard?.id || '').trim() || undefined,
    card: nextCard,
  });

  return {
    applied: true,
    sourceName: String(sourcePermanent?.card?.name || sourcePermanent?.name || copiedName || 'Permanent'),
    targetName: copiedName || 'creature',
  };
}

export function revertCopyPermanentToOriginal(permanent: any): boolean {
  const snapshot = permanent?.preCopyCardSnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }

  const restoredCard = JSON.parse(JSON.stringify(snapshot.card || {}));
  const restoredName = String(snapshot.name || restoredCard?.name || '').trim();
  const restoredTypeLine = String(snapshot.type_line || snapshot.cardType || restoredCard?.type_line || '').trim();
  const restoredOracle = String(snapshot.oracle_text || restoredCard?.oracle_text || '').trim();

  Object.assign(permanent, {
    ...(restoredName ? { name: restoredName } : {}),
    ...(restoredTypeLine ? { cardType: restoredTypeLine, type_line: restoredTypeLine } : {}),
    ...(restoredOracle ? { oracle_text: restoredOracle } : {}),
    ...(snapshot.power !== undefined
      ? { power: snapshot.power, basePower: snapshot.power, effectivePower: undefined }
      : {}),
    ...(snapshot.toughness !== undefined
      ? { toughness: snapshot.toughness, baseToughness: snapshot.toughness, effectiveToughness: undefined }
      : {}),
    ...(Array.isArray(snapshot.grantedAbilities) ? { grantedAbilities: [...snapshot.grantedAbilities] } : { grantedAbilities: undefined }),
    card: {
      ...restoredCard,
      ...(restoredName ? { name: restoredName } : {}),
      ...(restoredTypeLine ? { type_line: restoredTypeLine } : {}),
      ...(restoredOracle ? { oracle_text: restoredOracle } : {}),
      zone: 'hand',
    },
    copiedFromPermanentId: undefined,
    copiedFromCardId: undefined,
    preCopyCardSnapshot: undefined,
  });

  return true;
}

export function applyPermanentBecomeCopyOfTargetPermanent(
  state: any,
  sourcePermanentId: string,
  targetPermanentId: string,
  retainedAbilityText?: string,
): { applied: boolean; sourceName?: string; targetName?: string } {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === String(sourcePermanentId || '').trim());
  const targetPermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === String(targetPermanentId || '').trim());
  if (!sourcePermanent || !targetPermanent) {
    return { applied: false };
  }

  const targetCard = (targetPermanent?.card && typeof targetPermanent.card === 'object')
    ? JSON.parse(JSON.stringify(targetPermanent.card))
    : JSON.parse(JSON.stringify(targetPermanent));

  return applyCopyCardOntoPermanent(sourcePermanent, targetCard, targetPermanent, retainedAbilityText);
}

export function applyPermanentBecomeCopyOfCardData(
  state: any,
  sourcePermanentId: string,
  cardData: any,
  retainedAbilityText?: string,
): { applied: boolean; sourceName?: string; targetName?: string } {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === String(sourcePermanentId || '').trim());
  if (!sourcePermanent || !cardData) {
    return { applied: false };
  }
  const targetCard = JSON.parse(JSON.stringify(cardData));
  return applyCopyCardOntoPermanent(sourcePermanent, targetCard, null, retainedAbilityText);
}

export function findExiledCardById(state: any, cardId: string, sourcePermanentId?: string): any | null {
  const normalizedId = String(cardId || '').trim();
  if (!normalizedId) return null;

  if (sourcePermanentId) {
    const sourcePermanent = (state?.battlefield || []).find(
      (perm: any) => String(perm?.id || '').trim() === String(sourcePermanentId || '').trim(),
    );
    const linked = Array.isArray(sourcePermanent?.exiledCards) ? sourcePermanent.exiledCards : [];
    const linkedMatch = linked.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedId);
    if (linkedMatch) return linkedMatch;
  }

  const zones = state?.zones || {};
  for (const zoneState of Object.values(zones)) {
    const exile = Array.isArray((zoneState as any)?.exile) ? (zoneState as any).exile : [];
    const match = exile.find((card: any) => String(card?.id || '').trim() === normalizedId);
    if (match) return match;
  }
  return null;
}
