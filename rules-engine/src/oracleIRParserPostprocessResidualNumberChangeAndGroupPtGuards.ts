// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// "add or subtract X from a number" text changes, group-wide P/T scaling and chosen-name exile fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity } from './oracleIRParserUtils';
import { CONVOKE_DELVE_INNER_REMINDER_PATTERN } from './oracleIRParserPostprocessKeywordReminderPrunes';

export function parseResidualNumberChangeAndGroupPtGuardsOne(
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

  const addOrSubtractNumberText = raw.match(/^add\s+or\s+subtract\s+x\s+from\s+a\s+number\s+or\s+number\s+word\s+on\s+(target\s+spell\s+or\s+permanent)\s+until\s+end\s+of\s+turn$/i);
  if (addOrSubtractNumberText) {
    return temporaryMetadata(String(addOrSubtractNumberText[1] || '').trim(), 'add or subtract X from a number or number word', 'end_of_turn');
  }

  const anyNumberDiscard = raw.match(/^any\s+number\s+of\s+target\s+(opponents|players)\s+each\s+discard\s+(a\s+card|their\s+hands)$/i);
  if (anyNumberDiscard) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector(`any number of target ${String(anyNumberDiscard[1] || '').trim()}`),
      amount: /^their\s+hands$/i.test(String(anyNumberDiscard[2] || '')) ? { kind: 'all' } : { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anyNumberDraw = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+draw\s+(.+?)\s+cards$/i);
  if (anyNumberDraw) {
    return [{
      kind: 'draw',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberDraw[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anyNumberGainLife = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+gain\s+(.+?)\s+life$/i);
  if (anyNumberGainLife) {
    return [{
      kind: 'gain_life',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberGainLife[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anyNumberMill = raw.match(/^any\s+number\s+of\s+target\s+players\s+each\s+mill\s+(.+)$/i);
  if (anyNumberMill) {
    return [{
      kind: 'mill',
      who: parsePlayerSelector('any number of target players'),
      amount: parseQuantity(String(anyNumberMill[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const anotherPlayerCreatesToken = raw.match(/^another\s+target\s+player\s+creates\s+a\s+(.+?)\s+token\s+with\s+"([^"]+)"$/i);
  if (anotherPlayerCreatesToken) {
    const token = String(anotherPlayerCreatesToken[1] || '').trim();
    const tokenAbility = String(anotherPlayerCreatesToken[2] || '').trim();
    return [{
      kind: 'create_token',
      who: parsePlayerSelector('target player'),
      amount: { kind: 'number', value: 1 },
      token: `${token} with "${tokenAbility}"`,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const youAndEachCreateToken = raw.match(
    /^you and (target opponent|that player|target player) each create an? (.+?) token\.?$/i,
  );
  if (youAndEachCreateToken) {
    const whoText = String(youAndEachCreateToken[1] || '').trim();
    const token = String(youAndEachCreateToken[2] || '').trim();
    const who = parsePlayerSelector(`you and ${whoText}`);
    return [{
      kind: 'create_token',
      who,
      amount: { kind: 'number', value: 1 },
      token: token.charAt(0).toUpperCase() + token.slice(1),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const ownerCreatesQuestToken = raw.match(
    /^its owner creates (?:a )?tapped (.+?) creature token for each quest counter on it\.?$/i,
  );
  if (ownerCreatesQuestToken) {
    return [{
      kind: 'create_token',
      who: { kind: 'owner_of_source' },
      amount: { kind: 'x' },
      token: String(ownerCreatesQuestToken[1] || '').trim(),
      entersTapped: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const opportunisticDragonControl = raw.match(
    /^for as long as this creature remains on the battlefield, gain control of that permanent, it loses all abilities, and it can(?:'|\u2019)?t attack or block\.?$/i,
  );
  if (opportunisticDragonControl) {
    return [
      {
        kind: 'gain_control',
        what: parseObjectSelector('that permanent'),
        newController: { kind: 'you' },
        duration: 'static',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'cant_attack',
        target: parseObjectSelector('that permanent'),
        duration: 'static',
        raw: "that permanent can't attack",
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'cant_block',
        target: parseObjectSelector('that permanent'),
        duration: 'static',
        raw: "that permanent can't block",
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const halfLifeRoundedDown = raw.match(
    /^(that player|target player|target opponent)\s+loses\s+half\s+their\s+life,?\s*rounded\s+down\.?$/i,
  );
  if (halfLifeRoundedDown) {
    return [{
      kind: 'lose_life',
      who: parsePlayerSelector(String(halfLifeRoundedDown[1] || '').trim()),
      amount: { kind: 'reference_amount', raw: 'half their life rounded down' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then if an opponent controls more lands than you, repeat this process once\.?$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: 'an opponent controls more lands than you' },
      steps: [staticMetadata('process', 'repeat this process once')[0]],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const landsBecomeSwamps = raw.match(/^((?:two|three|four|five|\d+|any number of|up to \w+)\s+target lands) become swamps\.?$/i);
  if (landsBecomeSwamps) {
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector(String(landsBecomeSwamps[1] || '').trim()),
      landType: 'Swamp',
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^transform this (land|creature|permanent|enchantment|artifact)\.?/i.test(raw)) {
    const permanentType = raw.match(/^transform this (land|creature|permanent|enchantment|artifact)/i)?.[1] || 'permanent';
    return [{
      kind: 'turn_face_up',
      target: parseObjectSelector(`this ${permanentType}`),
      raw: raw.replace(/\.\s*.+$/i, '').trim(),
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^convert this permanent\.?/i.test(raw)) {
    return [{
      kind: 'turn_face_up',
      target: parseObjectSelector('this permanent'),
      raw: raw.replace(/\.\s*.+$/i, '').trim(),
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^any number of target players mulligan\.?$/i.test(raw)) {
    return staticMetadata('any number of target players', 'mulligan');
  }

  if (/^the amount of life they lost this turn\.?$/i.test(raw)) {
    return [{
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'the amount of life they lost this turn' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const forEachShrineLife = raw.match(/^you gain (\d+) life for each shrine you control\.?$/i);
  if (forEachShrineLife) {
    return [{
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: parseQuantity(`${String(forEachShrineLife[1] || '').trim()} for each shrine you control`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const forEachAgeCounterLife = raw.match(/^you gain (\d+) life for each age counter on it\.?$/i);
  if (forEachAgeCounterLife) {
    return [{
      kind: 'gain_life',
      who: { kind: 'you' },
      amount: parseQuantity(`${String(forEachAgeCounterLife[1] || '').trim()} for each age counter on it`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you may have two target players exchange life totals\.?$/i.test(raw)) {
    return staticMetadata('two target players', 'exchange life totals');
  }

  const delayedMana = raw.match(/^add (\{[^}]+\}(?:\{[^}]+\})*) at the beginning of your next main phase this turn\.?$/i);
  if (delayedMana) {
    return [{
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: String(delayedMana[1] || '').trim(),
      amount: { kind: 'number', value: 1 },
      duration: 'next_main_phase_this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature can attack as though it had haste unless it entered this turn\.?$/i.test(raw)) {
    return staticMetadata('this creature', 'can attack as though it had haste unless it entered this turn');
  }

  const lifeTotalBecomes = raw.match(/^your life total becomes (\d+)\.?$/i);
  if (lifeTotalBecomes) {
    return staticMetadata('you', `life total becomes ${String(lifeTotalBecomes[1] || '').trim()}`);
  }

  const faceUpCounters = raw.match(/^as\s+this\s+creature\s+is\s+turned\s+face\s+up,\s+put\s+(four|five|\d+)\s+\+1\/\+1\s+counters\s+on\s+it$/i);
  if (faceUpCounters) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector('this creature'),
      counter: '+1/+1',
      amount: parseQuantity(String(faceUpCounters[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const phylacteryCounter = raw.match(/^as\s+this\s+creature\s+enters,\s+put\s+a\s+phylactery\s+counter\s+on\s+(an\s+artifact\s+you\s+control)$/i);
  if (phylacteryCounter) {
    return [{
      kind: 'add_counter',
      target: parseObjectSelector(String(phylacteryCounter[1] || '').trim()),
      counter: 'phylactery',
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const asEntersMill = raw.match(/^as\s+this\s+creature\s+enters,\s+(?:if\s+it\s+was\s+kicked,\s+)?mill\s+(.+)$/i);
  if (asEntersMill) {
    return [{
      kind: 'mill',
      who: { kind: 'you' },
      amount: parseQuantity(String(asEntersMill[1] || '').trim()),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const asEntersDiscardHand = raw.match(/^as\s+this\s+enchantment\s+enters,\s+discard\s+your\s+hand$/i);
  if (asEntersDiscardHand) {
    return [{
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'all' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const asEntersSacrificeAllLands = raw.match(/^as\s+this\s+enchantment\s+enters,\s+sacrifice\s+all\s+lands\s+you\s+control$/i);
  if (asEntersSacrificeAllLands) {
    return [{
      kind: 'sacrifice',
      who: { kind: 'you' },
      what: parseObjectSelector('all lands you control'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^another\s+target\s+creature\s+you\s+control\s+can't\s+be\s+blocked\s+this\s+turn\s+except\s+by\s+spirits$/i.test(raw)) {
    return temporaryMetadata('another target creature you control', "can't be blocked except by Spirits", 'this_turn');
  }

  const persistentArtifactAnimation = raw.match(/^another\s+target\s+nontoken\s+artifact\s+you\s+control\s+becomes\s+a\s+4\/4\s+artifact\s+creature\s+for\s+as\s+long\s+as\s+this\s+permanent\s+remains\s+tapped$/i);
  if (persistentArtifactAnimation) {
    return staticMetadata('another target nontoken artifact you control', 'becomes a 4/4 artifact creature for as long as this permanent remains tapped');
  }

  const broadPersistentIndestructible = raw.match(/^(another\s+target\s+(?:legendary\s+)?permanent(?:\s+you\s+control)?)\s+gains\s+indestructible\s+for\s+as\s+long\s+as\s+you\s+control\s+(this\s+(?:creature|permanent))$/i);
  if (broadPersistentIndestructible) {
    return staticMetadata(String(broadPersistentIndestructible[1] || '').trim(), `gains indestructible for as long as you control ${String(broadPersistentIndestructible[2] || '').trim()}`);
  }

  const compoundAttackingPt = raw.match(/^attacking\s+([a-z][a-z -]+?)\s+creatures\s+get\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+and\s+attacking\s+([a-z][a-z -]+?)\s+creatures\s+get\s+([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))\s+until\s+end\s+of\s+turn$/i);
  if (compoundAttackingPt) {
    const buildPt = (kindRaw: string, powerRaw: string, toughnessRaw: string): OracleEffectStep => ({
      kind: 'modify_pt',
      target: parseObjectSelector(`attacking ${kindRaw.trim()} creatures`),
      power: /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0,
      toughness: /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0,
      ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
      ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep);
    return [
      buildPt(String(compoundAttackingPt[1] || ''), String(compoundAttackingPt[2] || ''), String(compoundAttackingPt[3] || '')),
      buildPt(String(compoundAttackingPt[4] || ''), String(compoundAttackingPt[5] || ''), String(compoundAttackingPt[6] || '')),
    ];
  }

  const anyNumberDiscardReference = raw.match(/^any\s+number\s+of\s+target\s+(opponents|players)\s+each\s+discard\s+a\s+number\s+of\s+cards\s+equal\s+to\s+(.+)$/i);
  if (anyNumberDiscardReference) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector(`any number of target ${String(anyNumberDiscardReference[1] || '').trim()}`),
      amount: parseQuantity(`a number of cards equal to ${String(anyNumberDiscardReference[2] || '').trim()}`),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^all\s+unblocked\s+creatures\s+attacking\s+you\s+become\s+blocked\s+by\s+this\s+permanent$/i.test(raw)) {
    return staticMetadata('all unblocked creatures attacking you', 'become blocked by this permanent');
  }

  if (/^all\s+walls\s+able\s+to\s+block\s+this\s+creature\s+do\s+so$/i.test(raw)) {
    return staticMetadata('combat requirements', raw);
  }

  if (/^attacking\s+creatures\s+become\s+blocked$/i.test(raw)) {
    return staticMetadata('attacking creatures', 'become blocked');
  }

  if (/^black\s+creatures\s+you\s+control\s+can't\s+be\s+blocked\s+this\s+turn\s+except\s+by\s+black\s+creatures$/i.test(raw)) {
    return temporaryMetadata('black creatures you control', "can't be blocked except by black creatures", 'this_turn');
  }

  if (/^unless\s+.+?\s+pays\s+\d+\s+life$/i.test(raw)) {
    return staticMetadata('payment gate', raw);
  }

  const conditionalTypeAddition = raw.match(/^if\s+it\s+isn(?:'|�)t\s+an?\s+([a-z][a-z -]+),\s+it\s+becomes\s+an?\s+\1\s+in\s+addition\s+to\s+its\s+other\s+types$/i);
  if (conditionalTypeAddition) {
    const typeName = String(conditionalTypeAddition[1] || '').trim();
    return staticMetadata('it', `becomes a ${typeName} in addition to its other types if it is not already one`);
  }

  if (/^then\s+shuffles\s+and\s+puts\s+that\s+card\s+on\s+top$/i.test(raw)) {
    return staticMetadata('library order', raw);
  }

  if (/^cloak\s+a\s+card\s+from\s+your\s+hand$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a card from your hand'),
      to: 'battlefield',
      toRaw: 'battlefield face down as a 2/2 creature with ward {2}',
      entersFaceDown: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^.+?\s+-\s+exile\s+this\s+permanent$/i.test(raw)) {
    return [{
      kind: 'exile',
      target: parseObjectSelector('this permanent'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^counters\s+to\s+"0\."$/i.test(raw)) {
    return staticMetadata('counters', raw);
  }

  const createTokenCopy = raw.match(
    /^create\s+(?:x\s+)?(?:(?:\d+\/\d+|[a-z]+)\s+)*(?:\d+\/\d+\s+)?(?:[a-z]+\s+)*tokens?\s+that(?:'|\u2019)?s\s+a\s+copy\s+of\s+(.+?)(?:\s+instead)?\.?$/i
  );
  if (createTokenCopy) {
    const usesX = /^create\s+x\s+/i.test(raw);
    return [{
      kind: 'create_token',
      who: { kind: 'you' },
      amount: usesX ? { kind: 'x' } : { kind: 'number', value: 1 },
      token: `copy of ${String(createTokenCopy[1] || '').trim()}`,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^create\s+(?:a\s+5x5\s+grid|a\s+character\b|a\s+copy\b|a\s+token\s+from\b|a\s+token\s+of\b|an\s+animated\s+role\b|one\s+resource\b|two\s+(?:copies|tokens)\b|[A-Z][\s\S]+?\s+token\b)/i.test(raw)) {
    return staticMetadata('create residual', raw);
  }

  if (/^creature\s+cards\s+in\s+.+?\s+can(?:not|'|�)t\s+enter\s+the\s+battlefield$/i.test(raw)) {
    return staticMetadata('creature cards', raw);
  }

  const graveyardTemporaryCastGrant = raw.match(/^creature\s+cards\s+in\s+your\s+graveyard\s+gain\s+"([^"]+)"\s+until\s+end\s+of\s+turn$/i);
  if (graveyardTemporaryCastGrant) {
    return temporaryMetadata('creature cards in your graveyard', String(graveyardTemporaryCastGrant[1] || '').trim(), 'end_of_turn');
  }

  if (/^combat\s+damage(?:\s+that\s+would\s+be\s+dealt\s+by\s+.+?)?\s+can(?:not|'|�)?t\s+be\s+prevented$/i.test(raw) || /^combat\s+damage\s+uses\s+the\s+stack$/i.test(raw)) {
    return staticMetadata('combat damage', raw);
  }

  const spellCostReduction = raw.match(/^(.+?\bspells\s+you\s+cast)\s+cost\s+(.+?)\s+less\s+to\s+cast(?:,?\s+(.+))?$/i);
  if (spellCostReduction) {
    const tail = String(spellCostReduction[3] || '').trim();
    return staticMetadata(String(spellCostReduction[1] || '').trim(), `cost ${String(spellCostReduction[2] || '').trim()} less to cast${tail ? ` ${tail}` : ''}`);
  }

  if (/^creatures\b.+?\s+get\s+[+-]?(?:\d+|x)\s*\/\s*[+-]?(?:\d+|x)\s+and\s+(?:gain|can(?:not|'|�)t)\b/i.test(raw)) {
    if (/\buntil\s+end\s+of\s+turn\b/i.test(raw)) return temporaryMetadata('creatures', raw, 'end_of_turn');
    return staticMetadata('creatures', raw);
  }

  const broadCreaturePt = raw.match(/^((?:creature\s+tokens\b.*?|creatures\b.*?))\s+get\s+(?:an\s+additional\s+)?([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\s+for\s+each\b.*?)?(?:\s+until\s+end\s+of\s+turn)?$/i);
  if (broadCreaturePt) {
    const targetText = String(broadCreaturePt[1] || '').trim();
    const powerRaw = String(broadCreaturePt[2] || '').trim();
    const toughnessRaw = String(broadCreaturePt[3] || '').trim();
    const isTemporary = /\buntil\s+end\s+of\s+turn\b/i.test(raw);
    const power = /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0;
    const toughness = /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0;
    if (isTemporary) {
      return [{
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power,
        toughness,
        ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
        ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep];
    }
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      power,
      toughness,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualNumberChangeAndGroupPtGuardsTwo(
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

  const eachPt = raw.match(/^(each\b.+?)\s+gets?\s+(?:twice\s+)?([+-]?(?:\d+|x))\s*\/\s*([+-]?(?:\d+|x))(?:\b.*)?$/i);
  if (eachPt) {
    const targetText = String(eachPt[1] || '').trim();
    const powerRaw = String(eachPt[2] || '').trim();
    const toughnessRaw = String(eachPt[3] || '').trim();
    const isTemporary = /\buntil\s+end\s+of\s+turn\b/i.test(raw);
    const power = /^-?x$/i.test(powerRaw) ? (powerRaw.startsWith('-') ? -1 : 1) : Number.parseInt(powerRaw, 10) || 0;
    const toughness = /^-?x$/i.test(toughnessRaw) ? (toughnessRaw.startsWith('-') ? -1 : 1) : Number.parseInt(toughnessRaw, 10) || 0;
    if (isTemporary) {
      return [{
        kind: 'modify_pt',
        target: parseObjectSelector(targetText),
        power,
        toughness,
        ...(/^[-+]?x$/i.test(powerRaw) ? { powerUsesX: true } : {}),
        ...(/^[-+]?x$/i.test(toughnessRaw) ? { toughnessUsesX: true } : {}),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep];
    }
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector(targetText),
      power,
      toughness,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const eachLandTypeBeforeResidual = raw.match(/^(all|each)\s+lands?\s+(?:are|is)\s+(?:an?\s+)?(islands?|swamps?|mountains?|plains?|forests?)\s+in\s+addition\s+to\s+(?:their|its)\s+other\s+(?:types|land\s+types)$/i);
  if (eachLandTypeBeforeResidual) {
    const landTypeRaw = String(eachLandTypeBeforeResidual[2] || '').toLowerCase();
    const landType = /^islands?$/.test(landTypeRaw) ? 'Island'
      : /^swamps?$/.test(landTypeRaw) ? 'Swamp'
        : /^mountains?$/.test(landTypeRaw) ? 'Mountain'
          : /^plains?$/.test(landTypeRaw) ? 'Plains'
            : 'Forest';
    return [{
      kind: 'set_basic_land_type',
      target: parseObjectSelector('all lands'),
      landType,
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const playerMayPutLandEarly = raw.match(
    /^each\s+player\s+may\s+put\s+a\s+land\s+card\s+from\s+their\s+hand\s+onto\s+the\s+battlefield$/i,
  );
  if (playerMayPutLandEarly) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land card from their hand'),
      to: 'battlefield',
      toRaw: 'the battlefield',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (CONVOKE_DELVE_INNER_REMINDER_PATTERN.test(raw)) {
    return [];
  }

  if (/^each\b/i.test(raw)) {
    if (/\binvestigates?$/i.test(raw)) {
      return [step];
    }
    return staticMetadata('each residual', raw);
  }

  if (/^improvise(?:\s*\(|$)/i.test(raw)) {
    return staticMetadata('keyword', raw);
  }

  if (/^(?:\(?a creature with indestructible can(?:not|'t) be destroyed by damage\.?\)?)$/i.test(raw)) {
    return [];
  }

  if (/^\(?\s*whenever this creature becomes the target of a spell or ability an opponent controls, counter it unless that player/i.test(raw)) {
    return [];
  }

  const wardWaterbendMatch = raw.match(/^ward[-�]waterbend\s+(\{[^}]+\})$/i);
  if (wardWaterbendMatch) {
    const cost = String(wardWaterbendMatch[1] || '').trim();
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('this permanent'),
      effectText: [`ward�waterbend ${cost}`],
      duration: 'static',
      raw: `Ward�Waterbend ${cost}`,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you gain hexproof until your next turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('you'),
      abilities: ['hexproof'],
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const delayedEarthbendMatch = raw.match(/^when that creature dies this turn, you earthbend (\d+)$/i);
  if (delayedEarthbendMatch) {
    const count = String(delayedEarthbendMatch[1] || '').trim();
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'next_end_step',
      effect: `you earthbend ${count}`,
      steps: [{
        kind: 'earthbend',
        target: parseObjectSelector('target land you control'),
        amount: parseQuantity(count),
        raw: `you earthbend ${count}`,
      } as unknown as OracleEffectStep],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (
    /^you draw x cards and the chosen creatures get \+x\/\+x and gain trample until end of turn, where x is the difference between the chosen creatures' powers$/i.test(
      raw
    )
  ) {
    return [
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'x' },
        raw: 'You draw X cards',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector('the chosen creatures'),
        power: 1,
        toughness: 1,
        powerUsesX: true,
        toughnessUsesX: true,
        duration: 'end_of_turn',
        raw: 'the chosen creatures get +X/+X until end of turn',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('the chosen creatures'),
        abilities: ['trample'],
        duration: 'end_of_turn',
        raw: 'the chosen creatures gain trample until end of turn',
        ...sequence,
      } as unknown as OracleEffectStep,
      ...staticMetadata('x', "where X is the difference between the chosen creatures' powers"),
    ];
  }

  const earthbendMatch = raw.match(/^(?:you\s+)?earthbend\s+(a|an|\d+|x|[a-z]+)$/i);
  if (earthbendMatch) {
    return [{
      kind: 'earthbend',
      target: parseObjectSelector('target land you control'),
      amount: parseQuantity(earthbendMatch[1]),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const earthbendWhereMatch = raw.match(/^(?:you\s+)?earthbend\s+x,\s+where\s+x\s+is\s+(.+)$/i);
  if (earthbendWhereMatch) {
    return [{
      kind: 'earthbend',
      target: parseObjectSelector('target land you control'),
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: String(earthbendWhereMatch[1] || '').trim() },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:ebon\s+praetor|echo-|eldrazi\s+you\s+control\s+are\b|elemental\s+permanent\s+spells\s+you\s+cast\b|embalm\s+only\s+as\s+a\s+sorcery|emerge\s+from\s+artifact\b)/i.test(raw)) {
    return staticMetadata('pass29 residual', raw);
  }

  if (/^(?:enchanted|equipped) creature has protection from .+$/i.test(raw)) {
    return staticMetadata('enchanted creature', raw);
  }

  if (/^enchanted\s+\w+\b/i.test(raw)) {
    return staticMetadata('enchanted residual', raw);
  }

  // "End the combat phase" is a real resolution step (see simpleActionClauses).
  if (/^(?:enraging\s+licid\b|entwine(?:\s|-)|equip-)/i.test(raw)) {
    return staticMetadata('pass30 residual', raw);
  }

  if (/^(?:equipment\s+you\s+control\s+have\b|equipped\s+creature\b)/i.test(raw)) {
    return staticMetadata('equipment residual', raw);
  }

  if (/^(?:escalate-|every\s+hope\s+shall\s+vanish|everyone\s+else\s+is\s+fair\s+game|evoke-|exchange\b)/i.test(raw)) {
    return staticMetadata('pass31 residual', raw);
  }

  if (/^face-down\s+creatures\s+get\s+[+-]?\d+\s*\/\s*[+-]?\d+$/i.test(raw)) {
    return staticMetadata('face-down creatures', raw);
  }

  if (/^if\s+you\s+both\s+own\s+and\s+control\s+this\s+permanent\s+and\s+a\s+creature\s+named\s+.+?,\s+you$/i.test(raw)) {
    return staticMetadata('meld condition residual', raw);
  }

  if (/^(?:exhaust\s+abilities\b|explore-clash\b|exterminate!|fading\b|fearless\s+l'cie,\s+you\b|first\s+strike,\s+protection\b|firstest\s+strike\b|fixed\s+commander\s+ninjutsu\b|flanking\s*\(|flashforward\b|flavor\s+words\b|flip(?:\s|\b)|flying(?:,|\b))/i.test(raw)) {
    return staticMetadata('pass32 residual', raw);
  }

  if (/^food$/i.test(raw)) {
    return staticMetadata('token type residual', raw);
  }
  return null;
}

export function parseResidualNumberChangeAndGroupPtGuardsThree(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const chosenNameZoneExile = raw.match(
    /^search\s+(target\s+opponent|target\s+player|that\s+player)(?:'|�)?s\s+graveyard,\s+hand,\s+and\s+library\s+for\s+(all\s+|any\s+number\s+of\s+|up\s+to\s+(\w+|\d+)\s+)?cards?\s+with\s+(?:that|the\s+chosen)\s+name\s+and\s+exile\s+them$/i
  );
  if (chosenNameZoneExile) {
    const limitText = String(chosenNameZoneExile[2] || '').trim();
    const parsedLimit = parseQuantity(String(chosenNameZoneExile[3] || '').trim());
    const maxResults = /^any\s+number\s+of$/i.test(limitText)
      ? 'any_number'
      : parsedLimit.kind === 'number'
        ? parsedLimit.value
        : undefined;
    return [{
      kind: 'exile_named_cards_from_zones',
      who: parsePlayerSelector(String(chosenNameZoneExile[1] || '').trim()),
      zones: ['graveyard', 'hand', 'library'],
      nameSource: 'chosen_card_name',
      ...(maxResults !== undefined ? { maxResults } : {}),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentLibrarySearchToBattlefield = raw.match(
    /^search\s+target\s+opponent(?:'|�)?s\s+library\s+for\s+an?\s+(.+?)\s+card\s+and\s+put\s+(?:that\s+card|it)\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i
  );
  if (targetOpponentLibrarySearchToBattlefield) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: `${String(targetOpponentLibrarySearchToBattlefield[1] || '').trim()} card` },
      destination: 'battlefield',
      maxResults: 1,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const targetOpponentLibrarySearchToExile = raw.match(
    /^search\s+target\s+opponent(?:'|�)?s\s+library\s+for\s+an?\s+(.+?)\s+and\s+exile\s+it(\s+face\s+down)?$/i
  );
  if (targetOpponentLibrarySearchToExile) {
    return [{
      kind: 'search_library',
      who: { kind: 'target_opponent' },
      criteria: { kind: 'raw', text: String(targetOpponentLibrarySearchToExile[1] || '').trim() },
      destination: 'exile',
      maxResults: 1,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

