// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// attacking-player token creation and the residual metadata catalogue that lowers assorted named
// fragments to plain static grants.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector } from './oracleIRParserUtils';

export function parseResidualAttackerTokenAndMetadataGuardsOne(
  raw: string, sequence: { sequence?: 'then' }, step: OracleEffectStep
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const attackingPlayerCreatesToken = raw.match(/^that\s+attacking\s+player\s+(may\s+)?creates?\s+a\s+(tapped\s+)?(.+?\s+token(?:\s+(?:named\s+.+?|with\s+.+?))?)(?:\s+that(?:'|�)s\s+attacking\s+that\s+opponent)?$/i);
  if (attackingPlayerCreatesToken) {
    return [{
      kind: 'create_token',
      who: { kind: 'target_player' },
      amount: { kind: 'number', value: 1 },
      token: String(attackingPlayerCreatesToken[3] || '').trim(),
      ...(attackingPlayerCreatesToken[2] ? { entersTapped: true } : {}),
      ...(/\bthat(?:'|�)s\s+attacking\s+that\s+opponent\b/i.test(raw) ? { attacking: 'defending_player' as const } : {}),
      ...(attackingPlayerCreatesToken[1] ? { optional: true } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that\s+attacking\s+player\s+may\s+tap\s+or\s+untap\s+target\s+permanent\s+of\s+their\s+choice$/i.test(raw)) {
    return [{ kind: 'tap_or_untap', target: parseObjectSelector('target permanent of their choice'), optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^that\s+creature\s+becomes\s+green$/i.test(raw)) {
    return staticMetadata('that creature', 'becomes green');
  }

  if (/^that\s+creature\s+becomes\s+your\s+commander$/i.test(raw)) {
    return staticMetadata('that creature', 'becomes your commander');
  }

  const thatCreatureGainsAbilities = raw.match(/^that\s+creature\s+gains\s+(.+)$/i);
  if (thatCreatureGainsAbilities && /\b(?:menace|deathtouch|haste)\b/i.test(String(thatCreatureGainsAbilities[1] || ''))) {
    return [{ kind: 'grant_static_ability', target: parseObjectSelector('that creature'), abilities: String(thatCreatureGainsAbilities[1] || '').split(/\s*,\s*|\s+and\s+/i).map(part => part.trim()).filter(Boolean), raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^that\s+creature\s+can\s+block\s+up\s+to\s+two\s+additional\s+creatures\s+this\s+turn$/i.test(raw)) {
    return temporaryMetadata('that creature', 'can block up to two additional creatures', 'this_turn');
  }

  if (/^that\s+creature\s+deals\s+damage\s+equal\s+to\s+its\s+power\s+divided\s+as\s+you\s+choose\s+among\s+any\s+number\s+of\s+target\s+creatures\s+that\s+player\s+controls$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^that\s+creature\s+deals\s+damage\s+equal\s+to\s+its\s+power\s+divided\s+as\s+its\s+controller\s+chooses\s+among\s+any\s+number\s+of\s+those\s+wolves$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^that\s+creature\s+doesn(?:'|�)t\s+untap\s+during\s+its\s+controller(?:'|�)s\s+untap\s+step\s+for\s+as\s+long\s+as\s+(?:you\s+control\s+this\s+creature|this\s+(?:creature|equipment)\s+remains\s+on\s+the\s+battlefield)$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  // Keep "Delirium � If �" for conditional expansion; only swallow non-If residuals.
  if (
    /^(?:democracy\b|devour\b|deworded\b|discover\b|distribute\b|divination,|do\s+this\s+x\s+times|doing\s+the\s+chosen\s+action\s+costs\b|don(?:'|�)t\s+(?:count|touch)\b|double\s+agenda\b|double\b)/i.test(raw)
    || (/^delirium\s*-?/i.test(raw) && !/^delirium\s*[-��]?\s*if\b/i.test(raw))
  ) {
    return staticMetadata('pass26 residual', raw);
  }

  if (/^commander\s+creatures\s+you\s+own\s+are\s+.+?\s+in\s+addition\s+to\s+their\s+other\s+types$/i.test(raw)) {
    return staticMetadata('commander creatures you own', raw);
  }

  const namedModeDamage = raw.match(/^[A-Z][^()]+\(\s*(\d+)\s+damage\s+to\s+(.+?)\s*\.\s*\)$/i);
  if (namedModeDamage) {
    return [{
      kind: 'deal_damage',
      amount: { kind: 'number', value: Number.parseInt(String(namedModeDamage[1] || '0'), 10) || 0 },
      target: parseObjectSelector(String(namedModeDamage[2] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const namedSelfPumpForEach = raw.match(/^[A-Z][A-Za-z0-9' -]+\s+gets\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+until\s+end\s+of\s+turn\s+for\s+each\s+(.+)$/i);
  if (namedSelfPumpForEach) {
    const powerRaw = String(namedSelfPumpForEach[1] || '').trim();
    const toughnessRaw = String(namedSelfPumpForEach[2] || '').trim();
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('this permanent'),
      power: /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0,
      toughness: /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0,
      ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
      ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
      scaler: { kind: 'reference_scaler', raw: `for each ${String(namedSelfPumpForEach[3] || '').trim()}` },
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualAttackerTokenAndMetadataGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  const pass19ResidualMetadata = /^(?:add\s+helm\s+of\s+kaldra|add\s+one\s+mana\s+of\s+that\s+color\s+unless\s+any\s+player|after\s+each\s+opponent|after\s+each\s+player|after\s+that\s+turn|after\s+this\s+phase|all\s+creatures\s+attack\s+enchanted\s+creature|all\s+creatures\s+can\s+attack|all\s+creatures\s+with\s+magnet\s+counters|all\s+incubator\s+tokens|all\s+instances\s+of\s+color\s+words|all\s+lands\s+lose|all\s+morph\s+costs|all\s+nontoken\s+permanents|all\s+permanents\s+other\s+than|all\s+slivers?\s+have\s+"?|all\s+suspected\s+creatures|all\s+targeted\s+spells|all\s+will\s+be\s+one|allons-y|am$|amass\s+|an\s+opponent\s+|and\s+before\s+the\s+game\s+begins|and\s+remember|angel\s+spells\s+and\s+human\s+spells|annihilator\s+x|annihinfect|announce\s+the\s+top|ante\s+this\s+artifact|any\s+number\s+of\s+role\s+enchantments|any\s+number\s+of\s+target\s+players\s+each$|any\s+number\s+of\s+target\s+opponents\s+each\s+sacrifice|any\s+number\s+of\s+target\s+noncreature\s+artifacts|any\s+opponent\s+may|any\s+other\s+commanders|any\s+other\s+player\s+may|any\s+player$|any\s+player\s+may|any\s+time\s+you\s+could\s+mulligan|anything\s+that\s+replaces|anything\s+that\s+could\s+have\s+changed|anywhere\s+this\s+card\s+goes|apiary,|argentum\s+is|artifact\s+creatures\s+with\s+indestructible|artifact\s+offering|artifact\s+cards\s+and\s+red\s+creature\s+cards|artifacts\s+you\s+control\s+have\s+"?\{t\}|artifacts\s+and\s+enchantments\s+you\s+own|artifacts\s+and\s+creatures\s+target\s+opponent|as\b)/i;
  if (pass19ResidualMetadata.test(raw)) {
    return staticMetadata('pass19 residual', raw);
  }

  const opponentLibraryCreatureSearch = raw.match(/^search\s+target\s+opponent(?:'|�)?s\s+library\s+for\s+a\s+creature\s+card\s+and\s+put\s+that\s+card\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i);
  if (opponentLibraryCreatureSearch) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: 'creature card' },
      destination: 'battlefield',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^search\s+its\s+controller(?:'|�)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+all\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+spell\s+and\s+exile\s+them$/i.test(raw)) {
    return [{
      kind: 'exile_named_cards_from_zones',
      who: { kind: 'controller_of_referenced_object' },
      zones: ['graveyard', 'hand', 'library'],
      nameSource: 'target_spell_name',
      maxResults: 'any_number',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+opponent\s+chooses\s+two\s+of\s+those\s+cards$/i.test(raw)) {
    return staticMetadata('choice', raw);
  }

  if (/^target\s+opponent\s+exiles\s+an\s+enchantment\s+they\s+control$/i.test(raw)) {
    return [{ kind: 'exile', target: parseObjectSelector('an enchantment they control'), raw, ...sequence } as unknown as OracleEffectStep];
  }

  const revealUntilCreature = raw.match(/^(target\s+opponent|that\s+creature(?:'|�)?s\s+controller)\s+reveals\s+cards\s+from\s+the\s+top\s+of\s+their\s+library\s+until\s+they\s+reveal\s+a\s+creature\s+card$/i);
  if (revealUntilCreature) {
    const whoRaw = String(revealUntilCreature[1] || '').toLowerCase();
    return [{
      kind: 'reveal_top',
      who: whoRaw === 'target opponent' ? { kind: 'target_opponent' } : { kind: 'target_player' },
      amount: { kind: 'reference_amount', raw: 'until they reveal a creature card' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target\s+permanent\s+becomes\s+white\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('target permanent', 'becomes white', 'end_of_turn');
  }

  if (/^that\s+player\s+draws\s+two\s+additional\s+cards$/i.test(raw)) {
    return [{ kind: 'draw', who: { kind: 'target_player' }, amount: { kind: 'number', value: 2 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^that\s+token\s+gains\s+haste$/i.test(raw)) {
    return staticMetadata('that token', 'gains haste');
  }

  if (/^the\s+"legend\s+rule"\s+doesn(?:'|�)?t\s+apply\s+to\s+permanents\s+you\s+control$/i.test(raw)) {
    return staticMetadata('permanents you control', 'legend rule does not apply');
  }

  if (/^the\s+new\s+target\s+must\s+be\s+a\s+player$/i.test(raw)) {
    return staticMetadata('new target', 'must be a player');
  }

  const newTargetsCantBe = raw.match(/^the\s+new\s+targets?\s+can(?:'|�)t\s+be\s+(.+)$/i);
  if (newTargetsCantBe) {
    return [{
      kind: 'change_target',
      target: parseObjectSelector('it'),
      exclude: parseObjectSelector(String(newTargetsCantBe[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const reselectAtRandom = raw.match(/^reselect\s+(?:the\s+|its\s+)?targets?\s+at\s+random(?:\s+for\s+(.+))?$/i);
  if (reselectAtRandom) {
    return [{
      kind: 'change_target',
      target: parseObjectSelector(String(reselectAtRandom[1] || 'it').trim()),
      newTarget: parseObjectSelector('at random'),
      random: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:the\s+next\s+1\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+this\s+creature\s+this\s+turn\s+is\s+dealt\s+to\s+target\s+creature\s+you\s+control\s+instead|the\s+next\s+time\s+(?:(?:a|an)\s+(?:white|blue|black|red|green|artifact)\s+source\s+of\s+your\s+choice|a\s+source\s+of\s+your\s+choice\s+of\s+the\s+chosen\s+color)\s+would\s+deal\s+damage\s+to\s+you\s+this\s+turn,\s+prevent\s+that\s+damage)$/i.test(raw)) {
    return staticMetadata('damage prevention', raw);
  }

  const ownerLibraryChoice = raw.match(/^the\s+owner\s+of\s+target\s+(nonland\s+)?permanent\s+puts\s+it\s+(?:into\s+their\s+library\s+second\s+from\s+the\s+top\s+or\s+on\s+the\s+bottom|on\s+their\s+choice\s+of\s+the\s+top\s+or\s+bottom\s+of\s+their\s+library)$/i);
  if (ownerLibraryChoice) {
    return [{ kind: 'move_zone', what: parseObjectSelector(`target ${ownerLibraryChoice[1] ? 'nonland ' : ''}permanent`), to: 'library', toRaw: 'top or bottom of their library', raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

