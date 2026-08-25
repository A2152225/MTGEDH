// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// mana-in-any-combination riders, untap-and-buff fragments, prevent/remove-counter clauses, station
// numbers, "phases out unless you pay" upkeep riders and optional attach fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector, parseQuantity, splitAttachClauseBody } from './oracleIRParserUtils';
import { normalizeCounterName } from './oracleIRParserSacrificeHelpers';

export function parseResidualManaPhasingAndAttachGuardsOne(
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

  // Omnath: "add three mana in any combination of its colors and put it into your hand"
  const addItsColorsThenHand = raw.match(
    /^add ((?:a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)) mana in any combination of its colors and put it into your hand$/i,
  );
  if (addItsColorsThenHand) {
    return [
      {
        kind: 'add_mana',
        who: { kind: 'you' },
        mana: '{C}',
        amount: parseQuantity(String(addItsColorsThenHand[1] || '').trim()),
        manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
        manaOptionsScope: 'referenced_permanent_colors',
        requiresChosenMana: true,
        raw: `add ${String(addItsColorsThenHand[1] || '').trim()} mana in any combination of its colors`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('it'),
        to: 'hand',
        toRaw: 'into your hand',
        raw: 'put it into your hand',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const addItsColorsOnly = raw.match(
    /^add ((?:a|an|\d+|x|one|two|three|four|five|six|seven|eight|nine|ten|[a-z]+)) mana in any combination of its colors$/i,
  );
  if (addItsColorsOnly) {
    return [{
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{C}',
      amount: parseQuantity(String(addItsColorsOnly[1] || '').trim()),
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      manaOptionsScope: 'referenced_permanent_colors',
      requiresChosenMana: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const discardEqualToughness = raw.match(
    /^discards? cards equal to (that creature(?:'s|\u2019s)? toughness|its toughness)$/i,
  );
  if (discardEqualToughness) {
    return [{
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: String(discardEqualToughness[1] || '').trim() },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^shuffle that pile and put it back on top of (?:your|their) library$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('that pile'),
      to: 'library',
      toRaw: 'on top of your library',
      libraryPlacement: 'top',
      order: 'random',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^attacking doesn(?:'|�)t cause creatures you control to tap this combat(?: if this permanent is untapped)?$/i.test(raw)) {
    return temporaryMetadata(
      'creatures you control',
      "attacking doesn't cause creatures you control to tap this combat",
      'this_turn',
    );
  }

  if (/^it isn(?:'|�)t an equipment$/i.test(raw)) {
    return staticMetadata('it', "isn't an Equipment");
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsTwo(
  raw: string, sequence: { sequence?: 'then' }
): readonly OracleEffectStep[] | null {
  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{
    kind: 'grant_temporary_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration,
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  // Lattice-Blade Mantis: "untap it and it gets +1/+1 until end of turn"
  const untapThenPt = raw.match(
    /^untap (it|this creature|this permanent) and (?:it|this creature|this permanent) gets ([+-]\d+)\/([+-]\d+) until end of turn$/i,
  );
  if (untapThenPt) {
    const target = String(untapThenPt[1] || 'it').trim();
    return [
      {
        kind: 'tap_or_untap',
        target: parseObjectSelector(target),
        mode: 'untap',
        raw: `untap ${target}`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector(target === 'it' ? 'it' : target),
        power: Number.parseInt(String(untapThenPt[2] || '0'), 10),
        toughness: Number.parseInt(String(untapThenPt[3] || '0'), 10),
        duration: 'end_of_turn',
        raw: `${target} gets ${untapThenPt[2]}/${untapThenPt[3]} until end of turn`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  // Imoen-style: "draw a card and you may play an additional land this turn"
  const drawAndAdditionalLand = raw.match(
    /^draw\s+(?:a|one)\s+cards?\s+and\s+(you may play an additional land this turn)$/i,
  );
  if (drawAndAdditionalLand) {
    return [
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'draw a card',
        ...sequence,
      } as unknown as OracleEffectStep,
      ...temporaryMetadata('you', String(drawAndAdditionalLand[1] || '').trim(), 'this_turn'),
    ];
  }

  // Reckless Detective-style: "draw a card and this creature gets +2/+0 until end of turn"
  // Also accept the residual after a stripped leading "draw": "a card and this creature gets �"
  const drawAndSelfPt = raw.match(
    /^(?:draw\s+)?(?:a|one)\s+cards?\s+and\s+(this creature|this permanent|it)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until end of turn$/i,
  );
  if (drawAndSelfPt) {
    const target = String(drawAndSelfPt[1] || 'this creature').trim();
    return [
      {
        kind: 'draw',
        who: { kind: 'you' },
        amount: { kind: 'number', value: 1 },
        raw: 'draw a card',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'modify_pt',
        target: parseObjectSelector(target),
        power: Number.parseInt(String(drawAndSelfPt[2] || '0'), 10),
        toughness: Number.parseInt(String(drawAndSelfPt[3] || '0'), 10),
        duration: 'end_of_turn',
        raw: `${target} gets ${drawAndSelfPt[2]}/${drawAndSelfPt[3]} until end of turn`,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsThree(
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

  // Photon-style: "add that much mana of any one color"
  const addThatMuchAnyColor = raw.match(
    /^add that much mana of any(?:\s+one)?\s+color$/i,
  );
  if (addThatMuchAnyColor) {
    return [{
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{W}',
      amount: { kind: 'reference_amount', raw: 'that much' },
      manaOptions: ['{W}', '{U}', '{B}', '{R}', '{G}'],
      requiresChosenMana: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  // Living Laser / myriad-style token entry follow-up
  if (/^(?:the|those)\s+tokens?\s+enter(?:s)?\s+tapped\s+and\s+attacking$/i.test(raw)) {
    return staticMetadata('those tokens', 'enter tapped and attacking');
  }

  // Precipitous Drop: "It gets -5/-5 instead as long as you've completed a dungeon"
  const insteadAsLongAsPt = raw.match(
    /^(it|enchanted creature|this creature|this permanent)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+instead\s+as\s+long\s+as\s+(.+)$/i,
  );
  if (insteadAsLongAsPt) {
    return [{
      kind: 'conditional',
      condition: { kind: 'as_long_as', raw: String(insteadAsLongAsPt[4] || '').trim().replace(/[.]+$/g, '') },
      steps: [{
        kind: 'grant_static_ability',
        target: parseObjectSelector(String(insteadAsLongAsPt[1] || 'it').trim()),
        power: Number.parseInt(String(insteadAsLongAsPt[2] || '0'), 10),
        toughness: Number.parseInt(String(insteadAsLongAsPt[3] || '0'), 10),
        duration: 'while_attached',
        effectText: [`gets ${insteadAsLongAsPt[2]}/${insteadAsLongAsPt[3]} instead`],
        raw,
      }],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsFour(
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

  const preventRemoveCountersMatch = raw.match(
    /^prevent that damage and remove that many (.+?) counters from (?:it|this permanent|this creature)$/i
  );
  if (preventRemoveCountersMatch) {
    const counterName = String(preventRemoveCountersMatch[1] || '').trim();
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'remove_counter',
        amount: { kind: 'reference_amount', raw: 'that many' },
        counter: counterName.includes('/') ? counterName : normalizeCounterName(counterName),
        target: parseObjectSelector('it'),
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const preventShuffleMatch = raw.match(
    /^prevent that damage and that creature's owner shuffles it into their library$/i
  );
  if (preventShuffleMatch) {
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('that creature'),
        to: 'library',
        toRaw: "that creature's owner's library",
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const preventIncarnationMatch = raw.match(
    /^prevent that damage and put an incarnation counter on this enchantment$/i
  );
  if (preventIncarnationMatch) {
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: 'incarnation',
        target: parseObjectSelector('this enchantment'),
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const preventMillMatch = raw.match(
    /^prevent that damage and each opponent mills (?:that many cards|cards equal to the amount of damage prevented this way)$/i
  );
  if (preventMillMatch) {
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'mill',
        who: { kind: 'each_opponent' },
        amount: { kind: 'reference_amount', raw: 'that many' },
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const preventExileTopMatch = raw.match(
    /^prevent that damage and exile that many cards from the top of your library$/i
  );
  if (preventExileTopMatch) {
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'move_zone',
        what: parseObjectSelector('that many cards from the top of your library'),
        to: 'exile',
        toRaw: 'exile',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const preventRemoveCreateMatch = raw.match(
    /^prevent that damage, remove that many (.+?) counters from this permanent, and create that many (.+)$/i
  );
  if (preventRemoveCreateMatch) {
    const counterName = String(preventRemoveCreateMatch[1] || '').trim();
    const tokenText = String(preventRemoveCreateMatch[2] || '').trim();
    return [
      {
        kind: 'prevent_damage',
        amount: 'all',
        duration: 'this_turn',
        raw: 'prevent that damage',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'remove_counter',
        amount: { kind: 'reference_amount', raw: 'that many' },
        counter: counterName.includes('/') ? counterName : normalizeCounterName(counterName),
        target: parseObjectSelector('this permanent'),
        raw: `remove that many ${counterName} counters from this permanent`,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'create_token',
        who: { kind: 'you' },
        token: tokenText,
        amount: { kind: 'reference_amount', raw: 'that many' },
        raw: `create that many ${tokenText}`,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  const etbCounterChoiceMatch = raw.match(/^with your choice of a (.+?) counter or a (.+?) counter on it$/i);
  if (etbCounterChoiceMatch) {
    return staticMetadata(
      'this permanent',
      `enters with your choice of a ${String(etbCounterChoiceMatch[1] || '').trim()} counter or a ${String(etbCounterChoiceMatch[2] || '').trim()} counter`
    );
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsFive(
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

  if (/^station\s+\d+\+?(?:\s*\|\s*.+)?$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^augment\s+(?:\{[^}]+\})+(?:\s*\|.*)?$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^enchant creature without flying\b/i.test(raw)) {
    return staticMetadata('this aura', raw);
  }

  if (/^cards you own named this permanent intensify by \d+$/i.test(raw)) {
    return staticMetadata('cards you own named this permanent', raw);
  }

  if (/^a card at the beginning of the next turn's upkeep$/i.test(raw)) {
    return [{
      kind: 'schedule_delayed_trigger',
      timing: 'next_upkeep',
      effect: 'draw a card',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you control enchanted (?:creature|permanent)$/i.test(raw)) {
    return staticMetadata('enchanted creature', raw);
  }

  const tieInvestigateMatch = raw.match(/^each player who controls the most (.+?) investigates$/i);
  if (tieInvestigateMatch) {
    return [{
      kind: 'investigate',
      who: {
        kind: 'each_player_who_controls_the_most',
        filter: String(tieInvestigateMatch[1] || 'creatures').trim(),
      },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^up to (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+cards?$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: parseQuantity(raw),
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const drawWhereMatch = raw.match(
    /^(?:(?:you|target player|target opponent|that player|that opponent)\s+)?(?:may\s+)?draw\s+x\s+cards,\s*where\s+x\s+is\s+(.+)$/i
  );
  if (drawWhereMatch) {
    const whoText = raw.match(/^(you|target player|target opponent|that player|that opponent)\b/i)?.[1] || 'you';
    return [{
      kind: 'draw',
      who: parsePlayerSelector(whoText),
      amount: { kind: 'x' },
      whereX: { kind: 'where', raw: String(drawWhereMatch[1] || '').trim() },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsSix(
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

  const phaseUnlessPay = raw.match(/^(?:at\s+the\s+beginning\s+of\s+your\s+upkeep,\s+)?this\s+creature\s+phases\s+out\s+unless\s+you\s+pay\s+((?:\{[^}]+\})+)$/i);
  if (phaseUnlessPay) {
    return staticMetadata('this creature', `phases out unless you pay ${String(phaseUnlessPay[1] || '').trim()}`);
  }

  if (/^they\s+remain\s+paired\s+for\s+as\s+long\s+as\s+you\s+control\s+both\s+of\s+them\.?\)?$/i.test(raw)) {
    return staticMetadata('paired creatures', 'remain paired for as long as you control both of them');
  }

  if (/^they\s+gain\s+decayed$/i.test(raw)) {
    return [{
      kind: 'grant_static_ability',
      target: parseObjectSelector('they'),
      abilities: ['decayed'],
      duration: 'static',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const abilityCostReduction = raw.match(/^this\s+ability\s+costs\s+(\{[^}]+\})\s+less\s+to\s+activate\s+for\s+each\s+(.+)$/i);
  if (abilityCostReduction) {
    return staticMetadata('this ability', `costs ${String(abilityCostReduction[1] || '').trim()} less to activate for each ${String(abilityCostReduction[2] || '').trim()}`);
  }

  if (/^this\s+change\s+in\s+ownership\s+is\s+permanent$/i.test(raw)) {
    return staticMetadata('ownership change', 'is permanent');
  }

  if (/^this\s+creature\s+attacks\s+or\s+blocks\s+each\s+combat\s+if\s+able$/i.test(raw)) {
    return staticMetadata('this creature', 'attacks or blocks each combat if able');
  }

  const temporaryUnblockable = raw.match(/^(this\s+creature|target\s+creature|it)\s+can(?:not|'t)\s+be\s+blocked\s+(this\s+combat|this\s+turn)(?:\s+except\s+by\s+(.+))?$/i);
  if (temporaryUnblockable) {
    const exceptBy = String(temporaryUnblockable[3] || '').trim();
    return temporaryMetadata(
      String(temporaryUnblockable[1] || '').trim(),
      exceptBy ? `can't be blocked except by ${exceptBy}` : "can't be blocked",
      'this_turn'
    );
  }

  const staticCantBlockRestriction = raw.match(/^(this\s+creature)\s+can(?:not|'t)\s+block\s+(.+)$/i);
  if (staticCantBlockRestriction) {
    return staticMetadata(String(staticCantBlockRestriction[1] || '').trim(), `can't block ${String(staticCantBlockRestriction[2] || '').trim()}`);
  }

  if (/^this\s+creature\s+can(?:not|'t)\s+have\s+counters\s+put\s+on\s+it$/i.test(raw)) {
    return staticMetadata('this creature', "can't have counters put on it");
  }

  const selfPumpAndDamage = raw.match(/^this\s+creature\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+and\s+deals\s+(\d+)\s+damage\s+to\s+you$/i);
  if (selfPumpAndDamage) {
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power: Number.parseInt(String(selfPumpAndDamage[1] || '0'), 10),
        toughness: Number.parseInt(String(selfPumpAndDamage[2] || '0'), 10),
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'deal_damage',
        source: parseObjectSelector('this creature'),
        target: parseObjectSelector('you'),
        amount: { kind: 'number', value: Number.parseInt(String(selfPumpAndDamage[3] || '0'), 10) || 0 },
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^this\s+creature\s+has\s+all\s+activated\s+abilities\s+of\s+all\s+creature\s+cards\s+exiled\s+with\s+it$/i.test(raw)) {
    return staticMetadata('this creature', 'has all activated abilities of all creature cards exiled with it');
  }

  if (/^this\s+creature\s+has\s+protection\s+from\s+the\s+chosen\s+color$/i.test(raw)) {
    return staticMetadata('this creature', 'protection from the chosen color');
  }

  if (/^this\s+creature\s+phases\s+out\s+unless\s+you$/i.test(raw)) {
    return staticMetadata('this creature', 'phases out unless you');
  }

  const selfLandAnimation = raw.match(/^this\s+land\s+becomes\s+a\s+(\d+)\/(\d+)\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
  if (selfLandAnimation) {
    const typeText = String(selfLandAnimation[3] || '').replace(/\bwith\s+.+$/i, '').trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('this land'),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(selfLandAnimation[1] || '0'), 10),
      toughness: Number.parseInt(String(selfLandAnimation[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this\s+mana\s+can(?:not|'t)\s+be\s+spent\s+to\s+(?:cast\s+nonartifact\s+spells|pay\s+generic\s+mana\s+costs)$/i.test(raw)) {
    return staticMetadata('this mana', raw.replace(/^this\s+mana\s+/i, ''));
  }

  if (/^this\s+permanent\s+gets\s+\+1\/\+1\s+for\s+each\s+experience\s+counter\s+you\s+have$/i.test(raw)) {
    return staticMetadata('this permanent', 'gets +1/+1 for each experience counter you have');
  }

  if (/^this\s+permanent(?:'|\u2019)s\s+toughness\s+is\s+equal\s+to\s+the\s+number\s+of\s+forests\s+you\s+control$/i.test(raw)) {
    return staticMetadata('this permanent', 'toughness is equal to the number of Forests you control');
  }

  if (/^those\s+permanents\s+phase\s+out$/i.test(raw)) {
    return [{ kind: 'phase_out', target: parseObjectSelector('those permanents'), raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^transform\s+target\s+incubator\s+token\s+you\s+control$/i.test(raw)) {
    return staticMetadata('target Incubator token you control', 'transform');
  }

  const targetTemporaryPt = raw.match(/^(up\s+to\s+one\s+target\s+creature|up\s+to\s+two\s+target\s+creatures\s+you\s+control|two\s+target\s+creatures)\s+(?:each\s+)?gets?\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn$/i);
  if (targetTemporaryPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector(String(targetTemporaryPt[1] || '').trim()),
      power: Number.parseInt(String(targetTemporaryPt[2] || '0'), 10),
      toughness: Number.parseInt(String(targetTemporaryPt[3] || '0'), 10),
      duration: 'end_of_turn',
      optional: /^up\s+to/i.test(String(targetTemporaryPt[1] || '')) || undefined,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^two\s+target\s+players\s+exchange\s+life\s+totals$/i.test(raw)) {
    return staticMetadata('two target players', 'exchange life totals');
  }

  if (/^under\s+your\s+control$/i.test(raw)) {
    return staticMetadata('control rider', 'under your control');
  }

  if (/^until\s+end\s+of\s+combat,\s+you\s+don(?:'|\u2019)?t\s+lose\s+this\s+mana\s+as\s+steps\s+end$/i.test(raw)) {
    return [{ kind: 'retain_mana', who: { kind: 'you' }, duration: 'until_end_of_combat', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^until\s+end\s+of\s+turn,\s+damage\s+that\s+would\s+reduce\s+your\s+life\s+total\s+to\s+less\s+than\s+1\s+reduces\s+it\s+to\s+1\s+instead$/i.test(raw)) {
    return temporaryMetadata('you', 'damage that would reduce your life total to less than 1 reduces it to 1 instead', 'end_of_turn');
  }

  const leadingTemporaryPtAndAbility = raw.match(/^until\s+end\s+of\s+turn,\s+(target\s+creature)\s+gets\s+([+-]\d+)\/([+-]\d+)\s+for\s+each\s+(.+?)\s+and\s+gains\s+(.+)$/i);
  if (leadingTemporaryPtAndAbility) {
    const ability = String(leadingTemporaryPtAndAbility[5] || '').trim().toLowerCase();
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector(String(leadingTemporaryPtAndAbility[1] || '').trim()),
        power: Number.parseInt(String(leadingTemporaryPtAndAbility[2] || '0'), 10),
        toughness: Number.parseInt(String(leadingTemporaryPtAndAbility[3] || '0'), 10),
        scaler: { kind: 'reference_scaler', raw: `for each ${String(leadingTemporaryPtAndAbility[4] || '').trim()}` },
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector(String(leadingTemporaryPtAndAbility[1] || '').trim()),
        abilities: [ability],
        duration: 'end_of_turn',
        raw,
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  const leadingAnimation = raw.match(/^until\s+end\s+of\s+turn,\s+(target\s+(?:land|noncreature\s+artifact\s+you\s+control))\s+becomes\s+a\s+(\d+)\/(\d+)\s+(.+)$/i);
  if (leadingAnimation) {
    const typeText = String(leadingAnimation[4] || '')
      .replace(/\bthat(?:'|\u2019)?s\s+still\s+a\s+land\b/i, '')
      .replace(/\bwith\s+.+$/i, '')
      .trim();
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector(String(leadingAnimation[1] || '').trim()),
      addTypes: typeText ? typeText.split(/\s+/).filter(Boolean) : ['creature'],
      power: Number.parseInt(String(leadingAnimation[2] || '0'), 10),
      toughness: Number.parseInt(String(leadingAnimation[3] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualManaPhasingAndAttachGuardsSeven(
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

  const attachDirectOptional = /^you\s+may\s+/i.test(raw) || /\bup\s+to\s+(?:one|two|three|\d+|[a-z]+)\b/i.test(raw);
  const attachDirectBody = raw.replace(/^you\s+may\s+/i, '').replace(/^attach\s+/i, '').trim();
  const attachSplit = /^attach\s+/i.test(raw) ? splitAttachClauseBody(attachDirectBody) : null;
  if (attachSplit) {
    return [{
      kind: 'attach',
      attachment: parseObjectSelector(attachSplit.attachmentRaw),
      to: parseObjectSelector(attachSplit.toRaw),
      optional: attachDirectOptional || undefined,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const attachContext = raw.match(/^(?:for\s+each\s+of\s+those\s+tokens,\s+you\s+may\s+attach\s+an\s+equipment\s+you\s+control\s+to\s+it|if\s+an\s+equipment\s+is\s+put\s+onto\s+the\s+battlefield\s+this\s+way,\s+you\s+may\s+attach\s+it\s+to\s+a\s+creature\s+you\s+control|-\s*when\s+this\s+equipment\s+enters,\s+you\s+may\s+attach\s+it\s+to\s+target\s+creature\s+you\s+control)$/i);
  if (attachContext) {
    return staticMetadata('attachment instruction', raw);
  }

  if (/^this\s+card\s+enters\s+attached\s+to\s+that\s+land\.?\)?$/i.test(raw)) {
    return [{
      kind: 'attach',
      attachment: parseObjectSelector('this card'),
      to: parseObjectSelector('that land'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const textChange = raw.match(/^change\s+the\s+text\s+of\s+(target\s+permanent)\s+by\s+replacing\s+all\s+instances\s+of\s+(.+?)\s+until\s+end\s+of\s+turn$/i);
  if (textChange) {
    return temporaryMetadata(String(textChange[1] || '').trim(), `text changed by replacing all instances of ${String(textChange[2] || '').trim()}`, 'end_of_turn');
  }

  const domainLookTop = raw.match(/^domain\s+-\s+look\s+at\s+the\s+top\s+x\s+cards\s+of\s+your\s+library,\s+where\s+x\s+is\s+the\s+number\s+of\s+basic\s+land\s+types\s+among\s+lands\s+you\s+control$/i);
  if (domainLookTop) {
    return [{
      kind: 'look_top',
      who: { kind: 'you' },
      amount: { kind: 'reference_amount', raw: 'the number of basic land types among lands you control' },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^double\s+the\s+power\s+and\s+toughness\s+of\s+each\s+creature\s+you\s+control\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return temporaryMetadata('each creature you control', 'double power and toughness', 'end_of_turn');
  }

  if (/^(?:each\s+player\s+chooses\s+.+|each\s+player(?:'|�)?s\s+life\s+total\s+becomes\s+.+|if\s+(?:a\s+creature\s+dying|a\s+permanent\s+entering)\s+causes\s+a\s+triggered\s+ability\s+of\s+a\s+permanent\s+you\s+control\s+to\s+trigger,\s+that\s+ability\s+triggers\s+an\s+additional\s+time|if\s+this\s+permanent\s+is\s+your\s+commander,\s+choose\s+a\s+color\s+before\s+the\s+game\s+begins)$/i.test(raw)) {
    return staticMetadata('static ability', raw);
  }

  const kickedInsteadPt = raw.match(/^if\s+this\s+spell\s+was\s+kicked,\s+that\s+creature\s+gets\s+([+-]\d+)\/([+-]\d+)\s+until\s+end\s+of\s+turn\s+instead$/i);
  if (kickedInsteadPt) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('that creature'),
      power: Number.parseInt(String(kickedInsteadPt[1] || '0'), 10),
      toughness: Number.parseInt(String(kickedInsteadPt[2] || '0'), 10),
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  const kickedInsteadDamage = raw.match(/^if\s+this\s+spell\s+was\s+kicked,\s+it\s+deals\s+(\d+)\s+damage\s+instead$/i);
  if (kickedInsteadDamage) {
    return staticMetadata('kicked spell damage', raw);
  }
  return null;
}

