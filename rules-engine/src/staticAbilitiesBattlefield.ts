import type { BattlefieldPermanent, KnownCardRef, PlayerID } from '../../shared/src';
import { calculateEffectivePT } from './staticAbilitiesEvaluation';
import type { StaticAbility } from './staticAbilitiesShared';

type ParseStaticAbilitiesFn = (
  card: KnownCardRef,
  permanentId: string,
  controllerId: PlayerID
) => StaticAbility[];

export function collectStaticAbilities(
  battlefield: BattlefieldPermanent[],
  parseStaticAbilities: ParseStaticAbilitiesFn
): StaticAbility[] {
  const abilities: StaticAbility[] = [];

  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;

    const parsed = parseStaticAbilities(card, perm.id, perm.controller);
    abilities.push(...parsed);
  }

  return abilities;
}

function applyStaticAuraControlEffects(
  battlefield: BattlefieldPermanent[]
): BattlefieldPermanent[] {
  const nextBattlefield = battlefield.map(permanent => ({ ...permanent } as BattlefieldPermanent));

  for (const aura of nextBattlefield) {
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
  parseStaticAbilities: ParseStaticAbilitiesFn
): BattlefieldPermanent[] {
  const battlefieldWithStaticControl = applyStaticAuraControlEffects(battlefield);
  const staticAbilities = collectStaticAbilities(battlefieldWithStaticControl, parseStaticAbilities);

  const withEffectivePT = battlefieldWithStaticControl.map(perm => {
    const card = perm.card as KnownCardRef;
    if (!card) return perm;

    const typeLine = (card.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) {
      return perm;
    }

    const { power, toughness, grantedAbilities } = calculateEffectivePT(
      perm,
      battlefieldWithStaticControl,
      staticAbilities
    );

    return {
      ...perm,
      effectivePower: perm.effectivePower ?? power,
      effectiveToughness: perm.effectiveToughness ?? toughness,
      grantedAbilities: grantedAbilities.length > 0 ? grantedAbilities : undefined,
    } as BattlefieldPermanent;
  });

  const staticGoadSources = collectStaticGoadSources(withEffectivePT);

  if (staticGoadSources.length === 0) {
    return withEffectivePT;
  }

  return withEffectivePT.map(perm => {
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
  });
}

interface StaticGoadSource {
  permanentId: string;
  controller: string;
  sourcePower: number;
  requiresLowerPower: boolean;
}

function collectStaticGoadSources(battlefield: BattlefieldPermanent[]): StaticGoadSource[] {
  const sources: StaticGoadSource[] = [];

  for (const perm of battlefield) {
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
