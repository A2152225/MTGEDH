// Extracted from rules-engine/src/oracleIRParserPostprocess.ts (chat B 40KB split campaign).
//
// Cluster: runs of guards lifted out of parseCurrentResidualUnknownStep's residual chain covering
// entry riders, damage multipliers, temporary loss-of-ability grants and "you may activate / you may
// reveal" permission fragments.
//
// Every helper keeps its guards in their original order and returns null when none matched, so the
// caller resumes the chain exactly where the run used to sit. staticMetadata / temporaryMetadata are
// verbatim copies of the chain prologue.

import type { OracleEffectStep } from './oracleIR';
import { parseObjectSelector, parsePlayerSelector } from './oracleIRParserUtils';
import { normalizeCreatureTypeWord } from '../../shared/src/creatureTypes';

export function parseResidualEntryAndPermissionGuardsOne(
  raw: string, sequence: { sequence?: 'then' }, clauseBody: string
): readonly OracleEffectStep[] | null {
  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{
    kind: 'grant_static_ability',
    target: parseObjectSelector(target),
    effectText: [effectText],
    duration: 'static',
    raw,
    ...sequence,
  } as unknown as OracleEffectStep];

  if (/^prepared$/i.test(raw)) {
    return staticMetadata('this creature', 'enters prepared');
  }

  if (/^this creature enters prepared$/i.test(clauseBody)) {
    return staticMetadata('this creature', 'enters prepared');
  }

  if (/^prevent that damage$/i.test(raw)) {
    return [{
      kind: 'prevent_damage',
      amount: 'all',
      duration: 'this_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^draw a card\.?$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature gets \+1\/\+0 and gains menace until end of turn$/i.test(raw)) {
    return [
      {
        kind: 'modify_pt',
        target: parseObjectSelector('this creature'),
        power: 1,
        toughness: 0,
        duration: 'end_of_turn',
        raw: 'this creature gets +1/+0 until end of turn',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'grant_temporary_ability',
        target: parseObjectSelector('this creature'),
        abilities: ['menace'],
        duration: 'end_of_turn',
        raw,
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsTwo(
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

  if (/^target creature you control gains protection from each color until your next turn$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('target creature you control'),
      abilities: ['protection from each color'],
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^target creature gets -2\/-0 until your next turn$/i.test(raw)) {
    return [{
      kind: 'modify_pt',
      target: parseObjectSelector('target creature'),
      power: -2,
      toughness: 0,
      duration: 'until_next_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you may blight 1\b/i.test(raw)) {
    return [
      {
        kind: 'add_counter',
        amount: { kind: 'number', value: 1 },
        counter: '-1/-1',
        target: parseObjectSelector('a creature you control'),
        optional: true,
        raw: 'you may blight 1',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'create_token',
        optional: true,
        token: { name: 'Treasure', type_line: 'Artifact � Treasure', power: 0, toughness: 0 },
        amount: { kind: 'number', value: 1 },
        raw: 'create a Treasure token',
        ...sequence,
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^this land enters tapped unless .+$/i.test(raw)) {
    return staticMetadata('this land', raw);
  }

  if (/^under the control of an opponent of your choice$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsThree(
  raw: string, sequence: { sequence?: 'then' }, clauseBody: string
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

  if (/^it deals triple that damage to that permanent or player$/i.test(raw)) {
    return [{
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'triple that', multiplier: 3 },
      target: parseObjectSelector('that permanent or player'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^multiblight\s+\d+$/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  if (/^poison modular\s+\d+(?:\s*\(this creature enters|$)/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  if (
    /^until end of turn, whenever you cast an instant or sorcery spell, copy it\. you may choose new targets for the copy\.?$/i.test(
      clauseBody,
    )
  ) {
    return temporaryMetadata('you', clauseBody, 'end_of_turn');
  }

  if (/^instant and sorcery spells you cast with mana value \d+ or greater cost \{x\} less to cast/i.test(clauseBody)) {
    return staticMetadata('you', clauseBody);
  }

  if (/^power-up abilities of other creatures you control cost \{3\} less to activate/i.test(clauseBody)) {
    return staticMetadata('other creatures you control', clauseBody);
  }

  if (/^powers and toughnesses are reversed/i.test(clauseBody)) {
    return staticMetadata('all permanents', clauseBody);
  }

  if (/^(?:devour\s+(?:\d+|x)|gravestorm)\b/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }

  if (/^seek\s+(?:a|an)\s+.+$/i.test(raw)) {
    return staticMetadata('keyword action', raw);
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsFour(
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

  if (/^two cards at random$/i.test(raw)) {
    return [{
      kind: 'draw',
      who: { kind: 'you' },
      amount: { kind: 'number', value: 2 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^any number of land cards$/i.test(raw)) {
    return staticMetadata('land cards', raw);
  }

  if (/^add one mana of any of this creature'?s colors$/i.test(raw)) {
    return [{
      kind: 'add_mana',
      who: { kind: 'you' },
      mana: '{C}',
      amount: { kind: 'number', value: 1 },
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?(?:transform|flip)\s+it\.?$/i.test(raw)) {
    return staticMetadata('it', raw.replace(/^then\s+/i, ''));
  }

  if (/^that creature gets -4\/-4 instead if you control a creature named bogbrew witch$/i.test(raw)) {
    return staticMetadata('that creature', raw);
  }

  if (/^you may put up to two name stickers on it$/i.test(raw)) {
    return staticMetadata('it', raw);
  }

  if (/^damage to an opponent this turn, it deals double that$/i.test(raw)) {
    return staticMetadata('it', 'deals double damage dealt to an opponent this turn');
  }

  if (/^that much life$/i.test(raw)) {
    return staticMetadata('life amount', raw);
  }

  if (/^you may reveal a card that shares a creature type with that creature from among them and put it into your hand/i.test(raw)) {
    return staticMetadata('revealed cards', raw);
  }

  if (/^(?:any\s+(?:opponent|player)\s+may\s+sacrifice\s+a\s+(?:creature|land)\s+of\s+their\s+choice|as\s+this\s+creature\s+enters,\s+pay\s+any\s+amount\s+of\s+life|discard\s+down\s+to\s+your\s+maximum\s+hand\s+size)$/i.test(raw)) {
    return staticMetadata('choice', raw);
  }

  if (/^activated\s+abilities\s+of\s+sources\s+with\s+the\s+chosen\s+name\s+cost\s+\{2\}\s+more\s+to\s+activate\s+unless\s+they(?:'|�)?re\s+mana\s+abilities$/i.test(raw)) {
    return staticMetadata('activated abilities of sources with the chosen name', "cost {2} more to activate unless they're mana abilities");
  }

  if (/^(?:then\s+)?do\s+the\s+same\s+for\s+aura\s+cards$/i.test(raw)) {
    return staticMetadata('Aura cards', 'do the same');
  }

  if (/^(?:then\s+)?each\s+opponent\s+who\s+didn(?:'|�)?t\s+draws\s+a\s+card$/i.test(raw)) {
    return [{
      kind: 'conditional',
      condition: { kind: 'if', raw: "each opponent who didn't" },
      steps: [{ kind: 'draw', who: { kind: 'each_opponent' }, amount: { kind: 'number', value: 1 }, raw: 'each opponent draws a card' }],
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?reveal\s+the\s+card$/i.test(raw)) {
    return staticMetadata('that card', 'reveal it');
  }

  if (/^(?:then\s+)?reveal\s+the\s+top\s+card$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?reveals\s+the\s+top\s+card\s+of\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'reveal_top', who: { kind: 'owner_of_referenced_object' }, amount: { kind: 'number', value: 1 }, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?shuffles\s+all\s+other\s+cards\s+revealed\s+this\s+way\s+into\s+their\s+library$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('all other cards revealed this way'), to: 'library', toRaw: 'their library', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (
    /^(?:then\s+)?put all cards revealed this way that weren't put onto the battlefield on the bottom of your library in a random order$/i.test(
      raw
    )
  ) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector("all cards revealed this way that weren't put onto the battlefield"),
      to: 'library',
      toRaw: 'the bottom of your library in a random order',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?that\s+player\s+chooses\s+a\s+card\s+name$/i.test(raw)) {
    return [{ kind: 'choose_card_name', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?that\s+player\s+puts\s+the\s+exiled\s+cards\s+that\s+weren(?:'|�)?t\s+cast\s+this\s+way\s+on\s+the\s+bottom\s+of\s+their\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return staticMetadata('exiled cards not cast this way', 'put on the bottom of their library in a random order');
  }

  if (/^(?:then\s+)?the\s+player\s+to\s+your\s+left\s+chooses\s+a\s+third\s+color$/i.test(raw)) {
    return staticMetadata('player to your left', 'chooses a third color');
  }

  if (/^(?:then\s+)?you\s+may\s+discard\s+a\s+nonland\s+card$/i.test(raw)) {
    return [{ kind: 'discard', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, target: parseObjectSelector('a nonland card'), optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^(?:then\s+)?you\s+may\s+pay\s+eight\s+\{e\}$/i.test(raw)) {
    return staticMetadata('energy payment', 'you may pay eight {E}');
  }

  if (/^manifest\s+the\s+top\s+card\s+of\s+your\s+library\s+and\s+attach\s+this\s+enchantment\s+to\s+it$/i.test(raw)) {
    return [
      {
        kind: 'move_zone',
        what: parseObjectSelector('the top card of your library'),
        to: 'battlefield',
        toRaw: 'battlefield face down',
        entersFaceDown: true,
        raw: 'Manifest the top card of your library',
        ...sequence,
      } as unknown as OracleEffectStep,
      {
        kind: 'attach',
        attachment: parseObjectSelector('this enchantment'),
        to: parseObjectSelector('it'),
        raw: 'attach this enchantment to it',
        sequence: 'then',
      } as unknown as OracleEffectStep,
    ];
  }

  if (/^(?:then\s+)?you\s+put\s+a\s+creature\s+card\s+from\s+a\s+graveyard\s+onto\s+the\s+battlefield\s+under\s+your\s+control$/i.test(raw)) {
    return [{ kind: 'move_zone', what: parseObjectSelector('a creature card from a graveyard'), to: 'battlefield', toRaw: 'the battlefield under your control', raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^there\s+is\s+an\s+additional\s+beginning\s+phase\s+after\s+this\s+phase$/i.test(raw)) {
    return staticMetadata('turn structure', raw);
  }

  if (/^they\s+don(?:'|�)?t\s+untap\s+during\s+their\s+controller(?:'|�)?s\s+next\s+untap\s+step$/i.test(raw)) {
    return [{ kind: 'skip_next_untap', target: parseObjectSelector('they'), raw, ...sequence } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsFive(
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

  if (/^until\s+end\s+of\s+turn,\s+this\s+creature\s+loses\s+"prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+this\s+creature\."\s+any\s+player\s+may\s+activate\s+this\s+ability$/i.test(raw)) {
    return temporaryMetadata('this creature', 'loses "Prevent all damage that would be dealt to this creature." Any player may activate this ability', 'end_of_turn');
  }

  if (/^until\s+end\s+of\s+turn,\s+this\s+creature\s+loses\s+defender\s+and\s+gains\s+flying$/i.test(raw)) {
    return [{
      kind: 'grant_temporary_ability',
      target: parseObjectSelector('this creature'),
      abilities: ['flying'],
      effectText: ['loses defender'],
      duration: 'end_of_turn',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^until\s+the\s+end\s+of\s+your\s+next\s+turn,\s+you\s+may\s+cast\s+that\s+card$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('that card'),
      duration: 'until_end_of_next_turn',
      permission: 'cast',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^until\s+your\s+next\s+turn,\s+prevent\s+all\s+damage\s+that\s+would\s+be\s+dealt\s+to\s+and\s+dealt\s+by\s+target\s+permanent\s+an\s+opponent\s+controls$/i.test(raw)) {
    return temporaryMetadata('target permanent an opponent controls', 'prevent all damage dealt to and dealt by it', 'until_next_turn');
  }

  if (/^vivid\s+-\s+this\s+spell\s+costs\s+\{1\}\s+less\s+to\s+cast\s+for\s+each\s+color\s+among\s+permanents\s+you\s+control$/i.test(raw)) {
    return staticMetadata('this spell', 'costs {1} less to cast for each color among permanents you control');
  }

  if (/^this\s+spell\s+costs\s+(?:\{[^}]+\})+\s+less\s+to\s+cast\s+for\s+each\s+creature\s+sacrificed\s+this\s+way$/i.test(raw)) {
    return staticMetadata('this spell', raw);
  }

  if (/^ward-\{2\},\s+pay\s+2\s+life$/i.test(raw)) {
    return staticMetadata('keyword ability', 'Ward-{2}, Pay 2 life');
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsSix(
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

  if (/^when\s+that\s+creature\s+leaves\s+the\s+battlefield\s+this\s+turn,\s+sacrifice\s+this\s+creature$/i.test(raw)) {
    return temporaryMetadata('this creature', 'sacrifice when that creature leaves the battlefield this turn');
  }

  if (/^while\s+each\s+one\s+is\s+exiled,\s+its\s+owner\s+may\s+cast\s+it\s+for\s+\{2\}\s+rather\s+than\s+its\s+mana\s+cost\.\)?$/i.test(raw)) {
    return staticMetadata('each exiled card', 'its owner may cast it for {2} rather than its mana cost');
  }

  if (/^(?:you|your\s+opponents)\s+can(?:not|'t)\s+(?:cast\s+(?:creature\s+spells(?:\s+this\s+turn)?|noncreature\s+spells(?:\s+this\s+turn)?|spells(?:\s+this\s+turn)?|spells\s+with\s+the\s+chosen\s+name|spells\s+with\s+the\s+same\s+name\s+as\s+(?:a\s+card\s+exiled\s+with\s+this\s+permanent|the\s+exiled\s+card))|lose\s+the\s+game\s+and\s+your\s+opponents\s+can(?:not|'t)\s+win\s+the\s+game)$/i.test(raw)) {
    return staticMetadata('spell/game restriction', raw);
  }

  if (/^you\s+can(?:not|'t)\s+cast\s+this\s+permanent\s+during\s+your\s+first,\s+second,\s+or\s+third\s+turns\s+of\s+the\s+game$/i.test(raw)) {
    return staticMetadata('this permanent', raw);
  }

  if (/^you\s+choose\s+an\s+instant\s+or\s+sorcery\s+card\s+from\s+it\s+and\s+exile\s+that\s+card$/i.test(raw)) {
    return staticMetadata('choice', 'choose an instant or sorcery card from it and exile that card');
  }

  if (/^you\s+choose\s+which\s+creatures\s+block\s+this\s+combat\s+and\s+how\s+those\s+creatures\s+block$/i.test(raw)) {
    return staticMetadata('combat choices', raw);
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsSeven(
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

  if (/^you\s+may\s+activate\s+abilities\s+of\s+creatures\s+you\s+control\s+as\s+though\s+those\s+creatures\s+had\s+haste$/i.test(raw)) {
    return staticMetadata('creatures you control', 'may activate abilities as though they had haste');
  }

  if (/^you\s+may\s+cast\s+a\s+spell\s+from\s+among\s+them\s+without\s+paying\s+its\s+mana\s+cost\.\s+put\s+the\s+rest\s+on\s+the\s+bottom\s+of\s+your\s+library\s+in\s+a\s+random\s+order$/i.test(raw)) {
    return staticMetadata('cards among them', 'you may cast a spell from among them without paying its mana cost; put the rest on the bottom of your library in a random order');
  }

  if (/^you\s+may\s+cast\s+it\s+this\s+turn,\s+and\s+mana\s+of\s+any\s+type\s+can\s+be\s+spent\s+to\s+cast\s+that\s+spell$/i.test(raw)) {
    return [{
      kind: 'grant_exile_permission',
      who: { kind: 'you' },
      what: parseObjectSelector('it'),
      duration: 'this_turn',
      permission: 'cast',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+cast\s+the\s+copy$/i.test(raw)) {
    return staticMetadata('copy', 'you may cast it');
  }

  if (/^you\s+may\s+choose\s+new\s+targets\s+for\s+it$/i.test(raw)) {
    return [{ kind: 'change_target', target: parseObjectSelector('it'), optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+have\s+target\s+creature\s+block\s+it\s+this\s+turn\s+if\s+able$/i.test(raw)) {
    return [{ kind: 'force_block', blocker: parseObjectSelector('target creature'), attacker: parseObjectSelector('it'), duration: 'end_of_turn', optional: true, raw, ...sequence } as unknown as OracleEffectStep];
  }

  if (/^you\s+may\s+have\s+target\s+land\s+you\s+control\s+become\s+a\s+3\/3\s+elemental\s+creature\s+with\s+haste\s+until\s+end\s+of\s+turn$/i.test(raw)) {
    return [{
      kind: 'animate_permanent',
      target: parseObjectSelector('target land you control'),
      addTypes: ['Elemental', 'creature'],
      power: 3,
      toughness: 3,
      abilities: ['haste'],
      duration: 'end_of_turn',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsEight(
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

  if (/^you\s+may\s+have\s+that\s+player\s+shuffle$/i.test(raw)) {
    return staticMetadata('that player', 'may shuffle');
  }

  if (/^you\s+may\s+have\s+this\s+creature\s+become\s+a\s+copy\s+of\s+another\s+target\s+creature,\s+except\s+it\s+has\s+this\s+ability$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('this creature'),
      source: parseObjectSelector('another target creature'),
      retainAbilityText: 'it has this ability',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^this creature becomes a copy of that creature,\s+except it has this ability$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('this creature'),
      source: parseObjectSelector('that creature'),
      retainAbilityText: 'it has this ability',
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^that creature becomes a copy of this creature\.?$/i.test(raw)) {
    return [{
      kind: 'copy_permanent',
      target: parseObjectSelector('that creature'),
      source: parseObjectSelector('this creature'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then, not counting that draw, if you drew more cards this turn than an opponent drew on their last turn, you may put a land card from your hand onto the battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a land card from your hand'),
      to: 'battlefield',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^then, if you have 1,000 or more life, you lose the game$/i.test(raw)) {
    return staticMetadata('you', 'lose the game if you have 1,000 or more life');
  }

  if (/^then, double the amount of life you lose and cards you draw for the rest of the game from this ability$/i.test(raw)) {
    return staticMetadata('this permanent', 'double the amount of life you lose and cards you draw for the rest of the game from this ability');
  }

  if (/^three cards and your life total becomes 5$/i.test(raw)) {
    return [
      { kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 3 }, raw, ...sequence } as unknown as OracleEffectStep,
      staticMetadata('your life total', 'becomes 5')[0]!,
    ];
  }

  if (/^you and that player may each put a permanent card from your hand onto the battlefield$/i.test(raw)) {
    return [{
      kind: 'move_zone',
      what: parseObjectSelector('a permanent card from your hand'),
      to: 'battlefield',
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^curse defending player$/i.test(raw)) {
    return staticMetadata('defending player', 'curse defending player');
  }

  if (/^you\s+may\s+look\s+at\s+cards\s+exiled\s+with\s+this\s+creature$/i.test(raw)) {
    return staticMetadata('cards exiled with this creature', 'you may look at them');
  }

  if (/^you\s+may\s+pay\s+\{1\}\s+and\s+discard\s+a\s+card$/i.test(raw)) {
    return [
      { kind: 'pay_mana', who: { kind: 'you' }, mana: '{1}', optional: true, raw, ...sequence } as unknown as OracleEffectStep,
      { kind: 'discard', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, optional: true, raw, sequence: 'then' } as unknown as OracleEffectStep,
    ];
  }

  if (/^you\s+may\s+reselect\s+which\s+player\s+or\s+permanent\s+target\s+attacking\s+creature\s+is\s+attacking$/i.test(raw)) {
    return staticMetadata('target attacking creature', 'may reselect which player or permanent it is attacking');
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsNine(
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

  {
    const revealType = raw.match(/^you\s+may\s+reveal\s+an?\s+([a-z]+)\s+card\s+from\s+your\s+hand$/i);
    const typeName = revealType ? normalizeCreatureTypeWord(String(revealType[1] || '')) : null;
    if (typeName) {
      const typeLabel = `${typeName.charAt(0).toUpperCase()}${typeName.slice(1)}`;
      return staticMetadata('your hand', `you may reveal a ${typeLabel} card`);
    }
  }

  if (/^you\s+may\s+reveal\s+the\s+first\s+card\s+you\s+draw\s+each\s+turn\s+as\s+you\s+draw\s+it$/i.test(raw)) {
    return staticMetadata('first card you draw each turn', 'you may reveal it as you draw it');
  }

  if (/^you\s+may\s+spend\s+mana\s+as\s+though\s+it\s+were\s+mana\s+of\s+any\s+color\s+to\s+activate\s+those\s+abilities$/i.test(raw)) {
    return staticMetadata('mana spent to activate those abilities', 'may be spent as though it were mana of any color');
  }

  if (/^your\s+life\s+total\s+becomes\s+that\s+number$/i.test(raw)) {
    return staticMetadata('your life total', 'becomes that number');
  }

  if (
    /^you may attach to it any number of auras on the battlefield and you may put onto the battlefield attached to it any number of aura cards that could enchant it from your graveyard and\/or hand$/i.test(
      raw
    )
  ) {
    return [{
      kind: 'attach',
      attachment: parseObjectSelector('any number of auras on the battlefield and aura cards from your graveyard and/or hand'),
      to: parseObjectSelector('it'),
      optional: true,
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsTen(
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

  if (/^as\s+this\s+land\s+enters,\s+you\s+may\s+pay\s+2\s+life$/i.test(raw)) {
    return staticMetadata('this land', 'you may pay 2 life as it enters');
  }

  if (/^enchanted\s+creature\s+gets\s+-x\/-0,\s+where\s+x\s+is\s+the\s+number\s+of\s+cards\s+in\s+your\s+graveyard$/i.test(raw)) {
    return staticMetadata('enchanted creature', 'gets -X/-0, where X is the number of cards in your graveyard');
  }

  if (/^\d+(?:,\s*or\s*\d+)*,\s*create\s+/i.test(raw)) {
    return staticMetadata('die roll result', raw);
  }

  if (/^roll\s+x\s+six-sided\s+dice$/i.test(raw)) {
    return staticMetadata('die roll', raw);
  }

  if (/^after you roll a die,\s+.+$/i.test(raw)) {
    return staticMetadata('die roll', raw);
  }

  if (/^after you draft this card,\s+.+$/i.test(raw)) {
    return staticMetadata('this card', raw);
  }

  if (/^after you draft three cards this way,\s+.+$/i.test(raw)) {
    return staticMetadata('drafted cards this way', raw);
  }

  if (/^add or subtract 1 from target creature(?:'|�)s power, target player(?:'|�)s life total, or target die roll(?:'|�)s result$/i.test(raw)) {
    return staticMetadata(
      "target creature's power, target player's life total, or target die roll's result",
      'add or subtract 1'
    );
  }
  return null;
}

export function parseResidualEntryAndPermissionGuardsEleven(
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

  if (/^creature\s+spells\s+you\s+cast\s+gain\s+.+?\s+as\s+you\s+cast\s+them$/i.test(raw)) {
    return staticMetadata('creature spells you cast', raw);
  }

  if (/^creature\s+spells\s+(?:you\s+cast\s+this\s+turn|you\s+control\s+with\s+power\s+.+?)\s+can(?:not|'|�)t\s+be\s+countered$/i.test(raw)) {
    return staticMetadata('creature spells', raw);
  }

  if (/^creatures\s+(?:can(?:not|'|�)t\s+be\s+the\s+targets\s+of\s+spells|don(?:'|�)t\s+untap\s+during\s+target\s+player(?:'|�)s\s+next\s+untap\s+step|enter\s+to\s+the\s+left\s+or\s+right\s+of\s+the\s+volcano|entering\s+or\s+dying\s+don(?:'|�)t\s+cause\s+abilities\s+to\s+trigger|in\s+each\s+sector\s+can\s+be\s+blocked\b.*|it\s+was\s+blocking\s+.+?\s+become\s+unblocked|lose\s+all\s+abilities|of\s+the\s+creature\s+type\s+of\s+your\s+choice\s+attack\s+this\s+turn\s+if\s+able)$/i.test(raw)) {
    return staticMetadata('creatures', raw);
  }

  if (/^creatures\b/i.test(raw)) {
    return staticMetadata('creatures', raw);
  }

  if (/^damage\b/i.test(raw)) {
    return staticMetadata('damage', raw);
  }

  if (/^dash\s+costs\s+you\s+pay\s+cost\s+.+?\s+less\b/i.test(raw)) {
    return staticMetadata('dash costs', raw);
  }

  if (/^(?:daybound|desertwalk)$/i.test(raw)) {
    return staticMetadata('keyword', raw);
  }

  if (/^defending\s+player\b/i.test(raw)) {
    return staticMetadata('defending player', raw);
  }

  if (/^discard\s+any\s+number\s+of\s+creature\s+cards$/i.test(raw)) {
    return [{
      kind: 'discard',
      who: parsePlayerSelector('you'),
      amount: { kind: 'any_number' },
      target: parseObjectSelector('creature cards'),
      raw,
      ...sequence,
    } as unknown as OracleEffectStep];
  }

  if (/^draw\s+(?:an\s+additional|two\s+additional|another)\b/i.test(raw)) {
    return staticMetadata('draw residual', raw);
  }

  if (/^duress\s*\(/i.test(raw)) {
    return staticMetadata('named mode residual', raw);
  }

  if (/^during\b/i.test(raw)) {
    return staticMetadata('during residual', raw);
  }
  return null;
}

