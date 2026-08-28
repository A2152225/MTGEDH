import type { BattlefieldPermanent, GameState, KnownCardRef, PlayerID } from '../../shared/src';
import { calculateEffectivePT } from './staticAbilitiesEvaluation';
import type { StaticAbility } from './staticAbilitiesShared';
import { controllerHasLeftTheGame } from './playerInGameStatus';

const STATIC_ABILITIES_APPLIED = Symbol.for('mtgedh.staticAbilitiesApplied');

type ParseStaticAbilitiesFn = (
  card: KnownCardRef,
  permanentId: string,
  controllerId: PlayerID
) => StaticAbility[];

function hasOracleText(card: KnownCardRef | undefined): boolean {
  return Boolean(String(card?.oracle_text || '').trim());
}

export function collectStaticAbilities(
  battlefield: BattlefieldPermanent[],
  parseStaticAbilities: ParseStaticAbilitiesFn,
  gameState?: GameState
): StaticAbility[] {
  const abilities: StaticAbility[] = [];

  for (const perm of battlefield) {
    if (controllerHasLeftTheGame(gameState, perm.controller)) continue;
    const card = perm.card as KnownCardRef;
    if (!card || !hasOracleText(card)) continue;

    const parsed = parseStaticAbilities(card, perm.id, perm.controller);
    abilities.push(...parsed);
  }

  return abilities;
}

function markStaticAbilitiesApplied(battlefield: BattlefieldPermanent[]): BattlefieldPermanent[] {
  try {
    Object.defineProperty(battlefield, STATIC_ABILITIES_APPLIED, {
      value: true,
      enumerable: false,
      configurable: true,
    });
  } catch {
    (battlefield as any)[STATIC_ABILITIES_APPLIED] = true;
  }
  return battlefield;
}

function canBatchIdenticalTokenPt(perm: BattlefieldPermanent): boolean {
  if (perm.isToken !== true) return false;
  if (perm.attachedTo) return false;
  if (Array.isArray((perm as any).attachedEquipment) && (perm as any).attachedEquipment.length > 0) return false;
  if (Array.isArray((perm as any).attachments) && (perm as any).attachments.length > 0) return false;
  if (Array.isArray(perm.modifiers) && perm.modifiers.length > 0) return false;
  if ((perm.damageMarked || 0) > 0 || ((perm as any).markedDamage || 0) > 0 || ((perm as any).damageTaken || 0) > 0) return false;
  if ((perm as any).isEquipped || (perm as any).isCommander) return false;
  return true;
}

function identicalTokenPtFingerprint(perm: BattlefieldPermanent): string {
  const card = perm.card as KnownCardRef;
  const counters = Object.entries(perm.counters || {})
    .filter(([, v]) => (v as number) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
  const granted = ((perm as any).grantedAbilities || []).slice().sort().join('|');
  return [
    perm.controller,
    card?.name || '',
    card?.type_line || '',
    card?.oracle_text || '',
    perm.basePower ?? card?.power ?? '',
    perm.baseToughness ?? card?.toughness ?? '',
    counters,
    granted,
  ].join('\0');
}

function applyStaticAuraControlEffects(
  battlefield: BattlefieldPermanent[],
  gameState?: GameState
): BattlefieldPermanent[] {
  const nextBattlefield = battlefield.map(permanent => ({ ...permanent } as BattlefieldPermanent));

  for (const aura of nextBattlefield) {
    if (controllerHasLeftTheGame(gameState, aura.controller)) continue;
    const card = aura.card as KnownCardRef;
    if (!card) continue;

    const typeLine = String(card.type_line || '').toLowerCase();
    if (!typeLine.includes('enchantment') || !typeLine.includes('aura')) continue;

    const oracleText = String(card.oracle_text || '').toLowerCase();
    if (!/\byou control enchanted (?:creature|permanent)\b/i.test(oracleText)) continue;

    const attachedToId = String((aura as any).attachedTo || '').trim();
    if (!attachedToId) continue;

    const enchantedIndex = nextBattlefield.findIndex(perm => String((perm as any)?.id || '').trim() === attachedToId);
    if (enchantedIndex < 0) continue;

    nextBattlefield[enchantedIndex] = {
      ...nextBattlefield[enchantedIndex],
      controller: aura.controller,
    } as BattlefieldPermanent;
  }

  return nextBattlefield;
}

export function applyStaticAbilitiesToBattlefield(
  battlefield: BattlefieldPermanent[],
  parseStaticAbilities: ParseStaticAbilitiesFn,
  gameState?: GameState
): BattlefieldPermanent[] {
  if (!Array.isArray(battlefield) || battlefield.length === 0) {
    return battlefield || [];
  }
  if ((battlefield as any)[STATIC_ABILITIES_APPLIED] === true) {
    return battlefield;
  }

  const battlefieldWithStaticControl = applyStaticAuraControlEffects(battlefield, gameState);
  const staticAbilities = collectStaticAbilities(battlefieldWithStaticControl, parseStaticAbilities, gameState);
  const tokenPtCache = new Map<string, { power: number; toughness: number; grantedAbilities: string[] }>();

  const withEffectivePT = battlefieldWithStaticControl.map(perm => {
    const card = perm.card as KnownCardRef;
    if (!card) return perm;

    const typeLine = (card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) {
      return perm;
    }

    let power: number;
    let toughness: number;
    let grantedAbilities: string[];
    if (canBatchIdenticalTokenPt(perm)) {
      const fingerprint = identicalTokenPtFingerprint(perm);
      let cached = tokenPtCache.get(fingerprint);
      if (!cached) {
        cached = calculateEffectivePT(
          perm,
          battlefieldWithStaticControl,
          staticAbilities,
          gameState
        );
        tokenPtCache.set(fingerprint, cached);
      }
      power = cached.power;
      toughness = cached.toughness;
      grantedAbilities = cached.grantedAbilities;
    } else {
      ({ power, toughness, grantedAbilities } = calculateEffectivePT(
        perm,
        battlefieldWithStaticControl,
        staticAbilities,
        gameState
      ));
    }

    return {
      ...perm,
      effectivePower: perm.effectivePower ?? power,
      effectiveToughness: perm.effectiveToughness ?? toughness,
      grantedAbilities: grantedAbilities.length > 0 ? grantedAbilities : undefined,
    } as BattlefieldPermanent;
  });

  const staticGoadSources = collectStaticGoadSources(withEffectivePT, gameState);

  if (staticGoadSources.length === 0) {
    return markStaticAbilitiesApplied(withEffectivePT);
  }

  return markStaticAbilitiesApplied(withEffectivePT.map(perm => {
    const card = perm.card as KnownCardRef;
    if (!card) return perm;

    const typeLine = (card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) {
      return perm;
    }

    let isStaticallyGoaded = false;
    const goadedByStatic: string[] = [];

    for (const source of staticGoadSources) {
      if (perm.controller === source.controller) continue;

      if (source.requiresLowerPower) {
        const cardPower = card.power;
        const permPower = perm.effectivePower ?? (perm as any).basePower ??
          (typeof cardPower === 'number' ? cardPower : parseInt(String(cardPower || '0'), 10));
        if (permPower < source.sourcePower) {
          isStaticallyGoaded = true;
          if (!goadedByStatic.includes(source.controller)) {
            goadedByStatic.push(source.controller);
          }
        }
      }
    }

    if (!isStaticallyGoaded) {
      return perm;
    }

    return {
      ...perm,
      isStaticallyGoaded: true,
      staticGoadedBy: goadedByStatic,
    } as BattlefieldPermanent;
  }));
}

interface StaticGoadSource {
  permanentId: string;
  controller: string;
  sourcePower: number;
  requiresLowerPower: boolean;
}

function collectStaticGoadSources(
  battlefield: BattlefieldPermanent[],
  gameState?: GameState
): StaticGoadSource[] {
  const sources: StaticGoadSource[] = [];

  for (const perm of battlefield) {
    if (controllerHasLeftTheGame(gameState, perm.controller)) continue;
    const card = perm.card as KnownCardRef;
    if (!card) continue;

    const oracleText = (card.oracle_text || '').toLowerCase();

    if (oracleText.includes('creatures your opponents control') &&
        oracleText.includes('power less than') &&
        oracleText.includes('power are goaded')) {
      const cardPower = card.power;
      const sourcePower = perm.effectivePower ?? (perm as any).basePower ??
        (typeof cardPower === 'number' ? cardPower : parseInt(String(cardPower || '0'), 10));
      sources.push({
        permanentId: perm.id,
        controller: perm.controller,
        sourcePower,
        requiresLowerPower: true,
      });
    }
  }

  return sources;
}
