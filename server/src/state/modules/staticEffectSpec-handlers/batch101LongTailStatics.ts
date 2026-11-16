// server/src/state/modules/staticEffectSpec-handlers/batch101LongTailStatics.ts
// B101 long-tail statics: Essence, Esix, Land Equilibrium, Darkblade, Fear of
// Sleep Paralysis, Cairn Wanderer, Keen-Eared Sentry, Case of the Gorgon's Kiss,
// Bludgeon Brawl, Entropic Specter, mayhem/escape grants, Shield, Pick-Axe.
// Public: parseBatch101LongTailStaticKind, pushBatch101LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import {
  parseEssenceEnterAsCopy,
  parseEsixFirstTokensCopy,
  parseLandEquilibrium,
  parseDarkbladeSurveilGrants,
  parseStunCountersCantBeRemovedFromOpponents,
  parseCairnWandererGyKeywords,
  parseOpponentVentureOncePerTurn,
  parseSolvedIsCreaturePTKeywords,
  parseBludgeonBrawl,
  parseChosenPlayerHandPT,
  parseNonlandGraveyardMayhem,
  parseDinosaurGraveyardHasEscape,
  parseShieldPreventXCreatures,
  parsePickAxeAsAttachesChoice,
  parseEquippedIsCopyOfLastChosen,
  parseRecoverCost,
} from '../batch101Parsers.js';

export function parseBatch101LongTailStaticKind(oracle: string): string[] {
  const kinds: string[] = [];
  if (parseEssenceEnterAsCopy(oracle)) kinds.push('essence-enter-as-copy');
  if (parseEsixFirstTokensCopy(oracle)) kinds.push('esix-first-tokens-copy');
  if (parseLandEquilibrium(oracle)) kinds.push('land-equilibrium-sacrifice');
  if (parseDarkbladeSurveilGrants(oracle)) kinds.push('deathtouch-if-surveilled-this-turn');
  if (parseStunCountersCantBeRemovedFromOpponents(oracle)) kinds.push('opponent-stun-counters-locked');
  if (parseCairnWandererGyKeywords(oracle)) kinds.push('cairn-wanderer-graveyard-keywords');
  if (parseOpponentVentureOncePerTurn(oracle)) kinds.push('opponents-venture-once-per-turn');
  if (parseSolvedIsCreaturePTKeywords(oracle)) kinds.push('solved-case-is-creature');
  if (parseBludgeonBrawl(oracle)) kinds.push('bludgeon-brawl-equipment');
  if (parseChosenPlayerHandPT(oracle)) kinds.push('chosen-player-hand-pt');
  if (parseNonlandGraveyardMayhem(oracle)) kinds.push('graveyard-nonland-mayhem');
  if (parseDinosaurGraveyardHasEscape(oracle)) kinds.push('graveyard-dinosaur-escape');
  if (parseShieldPreventXCreatures(oracle)) kinds.push('prevent-x-damage-to-equipped-creatures-you-control');
  if (parsePickAxeAsAttachesChoice(oracle) || parseEquippedIsCopyOfLastChosen(oracle)) kinds.push('equipped-copy-of-last-chosen-craft-card');
  if (parseRecoverCost(oracle)) kinds.push('recover-graveyard-trigger');
  return kinds;
}

export function pushBatch101LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  for (const kind of parseBatch101LongTailStaticKind(oracle)) {
    specs.push(buildSpec(
      source,
      kind,
      { kind: 'self' } as any,
      { abilities: [kind.replace(/-/g, '_')] } as any,
    ));
  }
}
