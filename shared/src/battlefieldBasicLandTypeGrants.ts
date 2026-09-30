/**
 * Battlefield continuous effects that add a basic land type.
 * "Each land" / "All lands" include the source when it is a land.
 * "Each other land" does not.
 */

import { normalizeBasicLandType, type BasicLandType } from './landTypes';

export interface BattlefieldLandTypeSubject {
  id?: string;
  controller?: string;
  isToken?: boolean;
  type_line?: string;
  oracle_text?: string;
  chosenBasicLandType?: string;
  card?: {
    type_line?: string;
    oracle_text?: string;
    chosenBasicLandType?: string;
    name?: string;
  } | null;
}

const WORD_TO_BASIC_LAND_TYPE: Record<string, BasicLandType> = {
  plains: 'Plains',
  island: 'Island',
  islands: 'Island',
  swamp: 'Swamp',
  swamps: 'Swamp',
  mountain: 'Mountain',
  mountains: 'Mountain',
  forest: 'Forest',
  forests: 'Forest',
};

const EVERY_BASIC_LAND_TYPE: readonly BasicLandType[] = [
  'Plains',
  'Island',
  'Swamp',
  'Mountain',
  'Forest',
];

function readOracle(permanent: BattlefieldLandTypeSubject | null | undefined): string {
  return String(permanent?.oracle_text || permanent?.card?.oracle_text || '').toLowerCase();
}

function readTypeLine(permanent: BattlefieldLandTypeSubject | null | undefined): string {
  return String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
}

function isLand(permanent: BattlefieldLandTypeSubject | null | undefined): boolean {
  return readTypeLine(permanent).includes('land');
}

function controllerId(permanent: BattlefieldLandTypeSubject | null | undefined): string {
  return String(permanent?.controller || '');
}

/**
 * Basic land types a battlefield continuous effect adds to this permanent.
 * Does not include types printed on the permanent's own type line.
 */
export function grantedBasicLandTypesFromBattlefield(
  permanent: BattlefieldLandTypeSubject | null | undefined,
  battlefield: readonly BattlefieldLandTypeSubject[] | null | undefined,
): BasicLandType[] {
  if (!permanent) return [];
  const types: BasicLandType[] = [];
  const add = (landType: BasicLandType | null | undefined) => {
    if (!landType || types.includes(landType)) return;
    types.push(landType);
  };

  const selfId = String(permanent.id || '');
  const selfController = controllerId(permanent);
  const list = Array.isArray(battlefield) ? battlefield : [];

  for (const source of list) {
    if (!source) continue;
    const oracle = readOracle(source);
    if (!oracle) continue;
    const sourceId = String(source.id || '');
    const isSource = Boolean(selfId) && selfId === sourceId;
    const sameController = Boolean(selfController) && selfController === controllerId(source);

    const eachLand = oracle.match(
      /each\s+(other\s+)?land\s+is\s+an?\s+(plains|island|swamp|mountain|forest)\s+in\s+addition/,
    );
    if (eachLand && isLand(permanent) && !(eachLand[1] && isSource)) {
      add(WORD_TO_BASIC_LAND_TYPE[eachLand[2]]);
    }

    const allLands = oracle.match(
      /all\s+lands\s+are\s+(plains|islands|swamps|mountains|forests)\s+in\s+addition/,
    );
    if (allLands && isLand(permanent)) {
      add(WORD_TO_BASIC_LAND_TYPE[allLands[1]]);
    }

    const youControl = oracle.match(
      /lands\s+you\s+control\s+are\s+(plains|islands|swamps|mountains|forests)\s+in\s+addition/,
    );
    if (youControl && isLand(permanent) && sameController) {
      add(WORD_TO_BASIC_LAND_TYPE[youControl[1]]);
    }

    if (
      /lands\s+you\s+control\s+are\s+every\s+basic\s+land\s+type\s+in\s+addition/.test(oracle)
      && isLand(permanent)
      && sameController
    ) {
      for (const landType of EVERY_BASIC_LAND_TYPE) add(landType);
    }

    const youControlChosen =
      /lands\s+you\s+control\s+are\s+the\s+chosen\s+(?:basic\s+)?land\s+type\s+in\s+addition/.test(oracle)
      || /lands\s+you\s+control\s+are\s+the\s+chosen\s+type\s+in\s+addition/.test(oracle);
    if (youControlChosen && isLand(permanent) && sameController) {
      add(normalizeBasicLandType(
        source.chosenBasicLandType || source.card?.chosenBasicLandType,
      ));
    }

    const creatureForests = oracle.match(
      /(nontoken\s+)?creatures\s+you\s+control\s+are\s+forest\s+lands\s+in\s+addition/,
    );
    if (creatureForests && sameController && readTypeLine(permanent).includes('creature')) {
      const nontokenOnly = Boolean(creatureForests[1]);
      if (!(nontokenOnly && permanent.isToken === true)) {
        add('Forest');
      }
    }
  }

  return types;
}
