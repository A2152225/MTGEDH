/**
 * Origin: server/src/state/modules/triggers/spell-cast-get-triggers.ts
 * Cluster: Folk Hero "cast a spell that shares a creature type with this creature"
 * Public: spellSharesCreatureTypeWithSource
 */

import { extractCreatureTypes } from '../../../../../shared/src/creatureTypes.js';
import { cardHasCreatureType } from '../../creatureTypeNow.js';

export function spellSharesCreatureTypeWithSource(spellCard: any, sourcePermanent: any): boolean {
  const sourceCard = sourcePermanent?.card || sourcePermanent;
  const sourceTypes = extractCreatureTypes(
    String(sourceCard?.type_line || sourcePermanent?.type_line || ''),
    String(sourceCard?.oracle_text || ''),
  ).map((type) => String(type || '').toLowerCase()).filter(Boolean);
  const spellTypes = extractCreatureTypes(
    String(spellCard?.type_line || ''),
    String(spellCard?.oracle_text || ''),
  ).map((type) => String(type || '').toLowerCase()).filter(Boolean);

  if (sourceTypes.some((type) => spellTypes.includes(type))) return true;
  if (sourceTypes.some((type) => cardHasCreatureType(spellCard, type))) return true;
  if (spellTypes.some((type) => cardHasCreatureType(sourceCard, type))) return true;
  return false;
}
