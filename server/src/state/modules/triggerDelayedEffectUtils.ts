import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debugWarn } from '../../utils/debug.js';
import { uid, parsePT } from '../utils.js';

const COUNT_WORD_TO_NUMBER: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

export function parseBattlefieldCounterClause(text: string): Record<string, number> | undefined {
  const normalized = String(text || '').replace(/[’]/g, "'");
  const matches = Array.from(normalized.matchAll(/\bwith\s+(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:additional\s+)?((?:(?!\bwith\b|[.,;]).)+?)\s+counters?\s+on\s+it\b/gi));
  const match = matches.length > 0 ? matches[matches.length - 1] : undefined;
  if (!match) {
    return undefined;
  }

  const rawQuantity = String(match[1] || '').trim().toLowerCase();
  const quantity = rawQuantity
    ? (/^\d+$/.test(rawQuantity) ? Number.parseInt(rawQuantity, 10) : (COUNT_WORD_TO_NUMBER[rawQuantity] || 1))
    : 1;
  const counterName = String(match[2] || '').trim();

  if (!counterName || !Number.isFinite(quantity) || quantity <= 0) {
    return undefined;
  }

  return { [counterName]: quantity };
}

export function getNextEndStepFireTurnNumber(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  const currentPhase = String(state?.phase ?? '').toLowerCase();
  const currentStepUpper = String(state?.step ?? '').toUpperCase();
  const inEnding = currentPhase === 'ending' && (currentStepUpper === 'END' || currentStepUpper === 'CLEANUP');
  return inEnding ? currentTurn + 1 : currentTurn;
}

export function getNextUpkeepNotBeforeTurnNumber(state: any): number {
  const currentTurn = Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
  return currentTurn + 1;
}

export function scheduleDelayedGraveyardReturn(ctx: GameContext, options: {
  playerId: string;
  sourceName: string;
  entries: Array<{
    cardId: string;
    zoneOwnerId: string;
    destination: 'hand' | 'battlefield';
    fireAtStep?: 'end_step' | 'upkeep';
    fireAtPlayerId?: string;
    destinationUsesSelectedCardOwner?: boolean;
    battlefieldControllerMode?: 'owner';
    battlefieldControllerId?: string;
    battlefieldTapped?: boolean;
    battlefieldCounters?: Record<string, number>;
    battlefieldFaceDown?: boolean;
    battlefieldTurnFaceUp?: boolean;
    battlefieldSuspected?: boolean;
  }>;
}): void {
  const stateAny = (ctx as any).state as any;
  if (!stateAny || !Array.isArray(options.entries) || options.entries.length === 0) {
    return;
  }
  stateAny.pendingDelayedGraveyardReturns = Array.isArray(stateAny.pendingDelayedGraveyardReturns)
    ? stateAny.pendingDelayedGraveyardReturns
    : [];

  const persistedEntries = options.entries
    .map((entry) => {
      const cardId = String(entry?.cardId || '').trim();
      const zoneOwnerId = String(entry?.zoneOwnerId || '').trim();
      if (!cardId || !zoneOwnerId) return null;
      const fireAtStep = String(entry?.fireAtStep || '').toLowerCase() === 'upkeep' ? 'upkeep' : 'end_step';
      const fireAtTurnNumber = fireAtStep === 'upkeep'
        ? getNextUpkeepNotBeforeTurnNumber(stateAny)
        : getNextEndStepFireTurnNumber(stateAny);
      const scheduleId = uid('delayed_graveyard_return');
      const pendingEntry = {
        scheduleId,
        cardId,
        zoneOwnerId,
        fireAtTurnNumber,
        fireAtStep,
        fireAtPlayerId: fireAtStep === 'upkeep'
          ? String(entry?.fireAtPlayerId || '').trim() || zoneOwnerId
          : undefined,
        sourceName: String(options.sourceName || 'Delayed trigger').trim() || 'Delayed trigger',
        createdBy: String(options.playerId || '').trim(),
        destination: String(entry.destination || '').toLowerCase() === 'battlefield' ? 'battlefield' : 'hand',
        destinationUsesSelectedCardOwner: entry.destinationUsesSelectedCardOwner === true,
        battlefieldControllerMode: String(entry.battlefieldControllerMode || '').toLowerCase() === 'owner' ? 'owner' : undefined,
        battlefieldControllerId: String(entry.battlefieldControllerId || '').trim() || undefined,
        battlefieldTapped: entry.battlefieldTapped === true,
        battlefieldCounters: entry.battlefieldCounters && typeof entry.battlefieldCounters === 'object'
          ? { ...entry.battlefieldCounters }
          : undefined,
        ...(entry.battlefieldFaceDown === true ? { battlefieldFaceDown: true } : null),
        ...(entry.battlefieldTurnFaceUp === true ? { battlefieldTurnFaceUp: true } : null),
        ...(entry.battlefieldSuspected === true ? { battlefieldSuspected: true } : null),
      };
      stateAny.pendingDelayedGraveyardReturns.push(pendingEntry);
      return pendingEntry;
    })
    .filter(Boolean);

  if (persistedEntries.length === 0) {
    return;
  }

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (!gameId) {
    return;
  }

  try {
    appendEvent(gameId, stateAny.seq ?? 0, 'scheduleDelayedGraveyardReturn', {
      playerId: String(options.playerId || '').trim(),
      sourceName: String(options.sourceName || 'Delayed trigger').trim() || 'Delayed trigger',
      entries: persistedEntries,
    });
  } catch (err) {
    debugWarn(1, '[scheduleDelayedGraveyardReturn] appendEvent failed:', err);
  }
}

export function scheduleDelayedDrawAtNextUpkeep(ctx: GameContext, options: {
  playerId: string;
  sourceName: string;
  sourceId?: string;
  count?: number;
}): void {
  const stateAny = (ctx as any).state as any;
  if (!stateAny) return;

  const playerId = String(options.playerId || '').trim();
  if (!playerId) return;

  const count = Math.max(1, Math.floor(Number(options.count || 1)));
  stateAny.pendingDelayedDrawsAtNextUpkeep = Array.isArray(stateAny.pendingDelayedDrawsAtNextUpkeep)
    ? stateAny.pendingDelayedDrawsAtNextUpkeep
    : [];

  const pendingEntry = {
    scheduleId: uid('delayed_upkeep_draw'),
    playerId,
    createdBy: playerId,
    sourceId: String(options.sourceId || '').trim() || undefined,
    sourceName: String(options.sourceName || 'Delayed trigger').trim() || 'Delayed trigger',
    count,
    fireAtTurnNumber: getNextUpkeepNotBeforeTurnNumber(stateAny),
    fireAtStep: 'upkeep',
  };

  stateAny.pendingDelayedDrawsAtNextUpkeep.push(pendingEntry);

  const gameId = String((ctx as any)?.gameId || '').trim();
  if (!gameId) return;

  try {
    appendEvent(gameId, stateAny.seq ?? 0, 'scheduleDelayedDrawAtNextUpkeep', {
      playerId,
      sourceName: pendingEntry.sourceName,
      entries: [pendingEntry],
    });
  } catch (err) {
    debugWarn(1, '[scheduleDelayedDrawAtNextUpkeep] appendEvent failed:', err);
  }
}

export function turnReturnedPermanentFaceUp(permanent: any): void {
  if (!permanent || (permanent as any).isFaceDown !== true || !(permanent as any).faceUpCard) {
    return;
  }

  const actualCard = { ...((permanent as any).faceUpCard || {}), zone: 'battlefield' };
  const typeLine = String(actualCard?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');

  (permanent as any).isFaceDown = false;
  (permanent as any).card = actualCard;
  if (isCreature) {
    (permanent as any).basePower = parsePT(actualCard?.power);
    (permanent as any).baseToughness = parsePT(actualCard?.toughness);
    (permanent as any).summoningSickness = true;
  } else {
    delete (permanent as any).basePower;
    delete (permanent as any).baseToughness;
    delete (permanent as any).summoningSickness;
  }
  delete (permanent as any).faceDownType;
  delete (permanent as any).faceUpCard;
  delete (permanent as any).canTurnFaceUp;
}

function typeLineHasSubtypeSeparator(typeLine: string): boolean {
  return /[—–]/.test(typeLine) || typeLine.includes('—');
}

export function addCreatureType(creature: any, typeToAdd: string): void {
  if (!creature?.card) {
    creature.card = creature.card || {};
  }
  const currentTypeLine = creature.card.type_line || '';
  const typeToAddLower = typeToAdd.toLowerCase();

  if (currentTypeLine.toLowerCase().includes(typeToAddLower)) {
    return;
  }

  if (typeLineHasSubtypeSeparator(currentTypeLine)) {
    creature.card.type_line = `${currentTypeLine} ${typeToAdd}`;
  } else {
    creature.card.type_line = `${currentTypeLine} — ${typeToAdd}`;
  }

  creature.addedTypes = creature.addedTypes || [];
  if (!creature.addedTypes.includes(typeToAdd)) {
    creature.addedTypes.push(typeToAdd);
  }
}

export function applyBattlefieldReturnCharacteristicMetadata(permanent: any, metadata: any): void {
  if (!permanent || !metadata) {
    return;
  }

  const setTypeLine = String(metadata?.battlefieldSetTypeLine || '').trim();
  if (setTypeLine) {
    permanent.card = { ...(permanent.card || {}), type_line: setTypeLine };
    const isCreature = setTypeLine.toLowerCase().includes('creature');
    if (isCreature) {
      permanent.basePower = parsePT(permanent.card?.power);
      permanent.baseToughness = parsePT(permanent.card?.toughness);
      permanent.summoningSickness = true;
    } else {
      delete permanent.basePower;
      delete permanent.baseToughness;
      delete permanent.summoningSickness;
      delete permanent.card.power;
      delete permanent.card.toughness;
    }
  }

  if (typeof metadata?.battlefieldSetOracleText === 'string') {
    permanent.card = { ...(permanent.card || {}), oracle_text: String(metadata.battlefieldSetOracleText) };
  }

  if (metadata?.battlefieldLoseAllOtherTypes === true && setTypeLine) {
    delete permanent.addedTypes;
    delete permanent.grantedTypes;
  }

  const grantedTypes = Array.isArray(metadata?.battlefieldGrantedTypes)
    ? metadata.battlefieldGrantedTypes
    : [];
  for (const typeName of grantedTypes) {
    const formattedTypeName = String(typeName || '').trim().replace(/^./, (char) => char.toUpperCase());
    if (formattedTypeName) {
      addCreatureType(permanent, formattedTypeName);
    }
  }
}

export function markPermanentEnteredFromZone(permanent: any, zone: string): void {
  const normalizedZone = String(zone || '').trim().toLowerCase();
  if (!permanent || !normalizedZone) return;

  permanent.enteredFromZone = normalizedZone;
  if (normalizedZone === 'graveyard') {
    permanent.enteredFromGraveyard = true;
  }

  if (permanent.card && typeof permanent.card === 'object') {
    permanent.card = {
      ...(permanent.card as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }

  if (permanent.faceUpCard && typeof permanent.faceUpCard === 'object') {
    permanent.faceUpCard = {
      ...(permanent.faceUpCard as any),
      enteredFromZone: normalizedZone,
      ...(normalizedZone === 'graveyard' ? { enteredFromGraveyard: true } : null),
    };
  }
}
