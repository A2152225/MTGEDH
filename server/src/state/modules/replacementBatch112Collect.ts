// Batch 112 replacement specs. Amount and zone changes are applied by the
// batch 112 helpers so a marker spec is not also a second modifier.
// Public: collectBatch112ReplacementSpecsFromState.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import {
  normalizeBatch112Oracle,
  parseAgeCounterPrevent,
  parseBasicLandColorChoice,
  parseChainsDraw,
  parseColorManaReplacement,
  parseChosenPlayersDouble,
  parseClueTokensInstead,
  parseDelayDamage,
  parseDestroyBecomesHeal,
  parseEnchantedDiesToHand,
  parseExileGraveyardForDamage,
  parseExileLibraryForDamage,
  parseFirstTokenCopiesEnchanted,
  parseGlobalWither,
  parseLandTypeCycle,
  parseLichMirror,
  parseLookOneRestGraveyard,
  parseNontokenDiesBlood,
  parseOneOfEachToken,
  parseOpponentGraveyardExile,
  parseOpponentNontokenDiesZombie,
  parseOpponentOwnedCreatureExile,
  parsePreventAndRemoveCounter,
  parsePreventOne,
  parseSelfExtraTurn,
  parseTwoOrMoreManaBecomesColorless,
} from './batch112Parsers.js';
import { normalizeBatch113 } from './batch113Remaining.js';

function asSpec(spec: object): ReplacementEffectSpec {
  return spec as unknown as ReplacementEffectSpec;
}

export function collectBatch112ReplacementSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const battlefield = Array.isArray((state as { battlefield?: unknown[] })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield : [];
  const specs: ReplacementEffectSpec[] = [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const rec = perm as { id?: string; controller?: string; phasedOut?: boolean; card?: { name?: string } };
    if (rec.phasedOut || !rec.card) continue;
    const sourcePermanentId = String(rec.id || '').trim();
    const sourceController = String(rec.controller || '').trim();
    if (!sourcePermanentId || !sourceController) continue;
    const text = normalizeBatch112Oracle(readCardOracleText(rec.card), String(rec.card.name || ''));
    const base = { sourcePermanentId, sourceController, sourceName: String(rec.card.name || 'Unknown') };
    const damage = parsePreventOne(text) || parseDelayDamage(text) || parseExileGraveyardForDamage(text)
      || parseExileLibraryForDamage(text) || parsePreventAndRemoveCounter(text) || parseAgeCounterPrevent(text)
      || parseChosenPlayersDouble(text) || parseGlobalWither(text);
    if (damage) {
      specs.push(asSpec({ ...base, id: `${sourcePermanentId}:batch112-damage`, event: 'damage', match: {}, instead: {}, effectId: 'batch112-damage', reason: 'batch112_damage' }));
    }
    if (/if an opponent would face a villainous choice, they face that choice an additional time/.test(normalizeBatch113(readCardOracleText(rec.card)))) {
      specs.push(asSpec({ ...base, id: `${sourcePermanentId}:villainous-extra`, event: 'choice', match: {}, instead: {}, effectId: 'villainous-extra', reason: 'villainous_extra' }));
    }
    if (parseLookOneRestGraveyard(text) > 0) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:look-one-rest-graveyard`, event: 'card-draw',
        match: { drawingPlayerIsSourceController: true, exactDrawCount: 1 }, instead: { choiceRequired: true },
        effectId: 'look-one-rest-graveyard', reason: 'look_one_rest_graveyard',
        metadata: { lookAtLibraryTop: parseLookOneRestGraveyard(text) },
      }));
    }
    // Shared Fate's wording is owned by the oracle draw template
    // ('draw-replaced-by-exile-opponent-library': opponent choice, face-down exile in the
    // opponent's exile, source-linked play). Emitting 'shared-fate-draw' too replaced each draw twice.
    if (parseChainsDraw(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:batch112-draw`, event: 'card-draw', match: {}, instead: { choiceRequired: true },
        effectId: 'chains-draw-replacement', reason: 'batch112_draw',
      }));
    }
    if (parseDestroyBecomesHeal(text)) {
      specs.push(asSpec({ ...base, id: `${sourcePermanentId}:destroy-heal`, event: 'destroy', match: {}, instead: {}, effectId: 'destroy-becomes-heal', reason: 'destroy_becomes_heal' }));
    }
    if (parseOpponentOwnedCreatureExile(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:owned-creature-exile`, event: 'zone-change',
        match: { destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
        instead: { redirectZone: 'exile' }, effectId: 'opponent-owned-creature-exile', reason: 'opponent_owned_creature_exile',
        metadata: { nontokenOnly: true, destinationOwnerIsOpponentOfSource: true },
      }));
    }
    if (parseEnchantedDiesToHand(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:enchanted-die-hand`, event: 'zone-change',
        match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
        instead: { redirectZone: 'hand' }, effectId: 'enchanted-die-to-hand', reason: 'enchanted_die_to_hand',
        metadata: { enchantedByController: sourceController },
      }));
    }
    if (parseOpponentNontokenDiesZombie(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:zombie-exile`, event: 'zone-change',
        match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature', objectControllerIsOpponentOfSource: true },
        instead: { redirectZone: 'exile' }, effectId: 'opponent-nontoken-zombie', reason: 'opponent_nontoken_zombie',
        metadata: { nontokenOnly: true, createZombieToken: true, sourceController },
      }));
    }
    if (parseNontokenDiesBlood(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:blood-exile`, event: 'zone-change',
        match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectTypeLineIncludes: 'creature' },
        instead: { redirectZone: 'exile' }, effectId: 'nontoken-blood-exile', reason: 'nontoken_blood_exile',
        metadata: { nontokenOnly: true, bloodCounter: true },
      }));
    }
    if (parseOpponentGraveyardExile(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:opp-gy-exile`, event: 'zone-change',
        match: { destinationZone: 'graveyard' }, instead: { redirectZone: 'exile' },
        effectId: 'opponent-graveyard-exile', reason: 'opponent_graveyard_exile',
        metadata: { destinationOwnerIsOpponentOfSource: true, voidCounter: /void counter/.test(text) },
      }));
    }
    if (parseSelfExtraTurn(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:extra-turn-exile`, event: 'zone-change',
        match: { sourceZone: 'battlefield', destinationZone: 'graveyard', objectIsSource: true },
        instead: { redirectZone: 'exile' }, effectId: 'self-exile-extra-turn', reason: 'self_exile_extra_turn',
        metadata: { extraTurn: true, sourceController },
      }));
    }
    if (parseLichMirror(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:lich-mirror`, event: 'lose-game', match: {},
        instead: { loseGame: { controllerCantLose: true } }, effectId: 'lich-mirror', reason: 'lich_mirror',
      }));
    }
    if (parseBasicLandColorChoice(text) || parseColorManaReplacement(text) || parseTwoOrMoreManaBecomesColorless(text) || parseLandTypeCycle(text)) {
      specs.push(asSpec({ ...base, id: `${sourcePermanentId}:batch112-mana`, event: 'mana-production', match: {}, instead: {}, effectId: 'batch112-mana', reason: 'batch112_mana' }));
    }
    if (parseFirstTokenCopiesEnchanted(text) || parseClueTokensInstead(text) || parseOneOfEachToken(text)) {
      specs.push(asSpec({
        ...base, id: `${sourcePermanentId}:batch112-token`, event: 'token-creation', match: {}, instead: {},
        effectId: 'batch112-token', reason: 'batch112_token',
      }));
    }
  }
  return specs;
}
