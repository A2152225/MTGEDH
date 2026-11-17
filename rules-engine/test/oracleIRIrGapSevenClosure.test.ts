import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { splitIntoClauses } from '../src/oracleIRParserUtils';
import { shouldSkipSentencePeriodSplit } from '../src/oracleIRAbbreviationPeriodGuard';
import { extractTriggerEffectAfterPrefix } from '../src/triggerEffectTextExtraction';
import { calculateEffectivePT } from '../src/staticAbilitiesEvaluation';

// Seven executor-coverage `ir_gap` closures (generic IR, no card-name routing). Oracle text is quoted from
// oracle-cards.jsonl. Replay note: Wall of Tombstones / Brine Hag write `setPowerToughness` modifiers on
// battlefield permanents, which the existing battlefield permanent-patch diff persists (no player life touched).

function stepsOf(text: string, cardName = 'Test'): any[] {
  return parseOracleTextToIR(text, cardName).abilities.flatMap((ability: any) => ability.steps);
}

function creature(id: string, controller: string, typeLine: string, power = '2', toughness = '2', extra: any = {}) {
  return {
    id,
    controller,
    owner: controller,
    counters: {},
    card: { id, name: id, type_line: typeLine, power, toughness, oracle_text: '' },
    ...extra,
  };
}

function gameState(battlefield: any[], playerExtra: Record<string, any> = {}): any {
  return {
    players: [
      { id: 'p1', life: 40, graveyard: [], hand: [], library: [], exile: [], ...playerExtra },
      { id: 'p2', life: 40, graveyard: [], hand: [], library: [], exile: [] },
    ],
    life: { p1: 40, p2: 40 },
    battlefield,
    turnNumber: 4,
  };
}

describe('Dr. Beverly Crusher: abbreviation period guard', () => {
  it('guard skips a title abbreviation followed by a capitalised name only', () => {
    expect(shouldSkipSentencePeriodSplit('put a +1/+1 counter on Dr', ' Crusher.')).toBe(true);
    expect(shouldSkipSentencePeriodSplit('Mr', ' Smith')).toBe(true);
    expect(shouldSkipSentencePeriodSplit('put a +1/+1 counter on Dr', ' crusher')).toBe(false);
    expect(shouldSkipSentencePeriodSplit('draw a card', ' Then draw')).toBe(false);
  });

  it('splitIntoClauses does not split at "Dr."', () => {
    expect(splitIntoClauses('Put a +1/+1 counter on Dr. Crusher.')).toEqual(['Put a +1/+1 counter on Dr. Crusher']);
    expect(splitIntoClauses('Draw a card. Put a +1/+1 counter on Dr. Crusher.')).toHaveLength(2);
  });

  it('trigger effect extraction keeps the full clause past "Dr."', () => {
    const effect = extractTriggerEffectAfterPrefix(
      'Whenever you gain life, put a +1/+1 counter on Dr. Crusher.',
      /^whenever you gain life,\s*/i,
    );
    expect(effect).toMatch(/put a \+1\/\+1 counter on Dr\. Crusher/i);
  });

  it('parses the trigger to one add_counter step targeting Dr. Crusher (no stray "Crusher" ability)', () => {
    const ir: any = parseOracleTextToIR(
      'If you gaining life causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.\nWhenever you gain life, put a +1/+1 counter on Dr. Crusher.',
      'Dr. Beverly Crusher',
    );
    expect(ir.abilities).toHaveLength(2);
    const trigger = ir.abilities[1];
    expect(trigger.type).toBe('triggered');
    expect(trigger.effectText).toMatch(/Dr\. Crusher\.?$/);
    expect(trigger.steps).toHaveLength(1);
    expect(trigger.steps[0]).toMatchObject({ kind: 'add_counter', counter: '+1/+1' });
    expect(JSON.stringify(trigger.steps[0].target)).toMatch(/Dr\. Crusher/);
  });
});

describe('Fblthp: owner shuffles this permanent into their library', () => {
  it('parses the self-normalised clause to move_zone this permanent -> library', () => {
    const steps = stepsOf("This permanent's owner shuffles this permanent into their library.");
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'move_zone', to: 'library' });
    expect(JSON.stringify(steps[0].what)).toMatch(/this permanent/i);
  });

  it('parses the original "Fblthp\'s owner shuffles him" text to a move_zone', () => {
    const steps = stepsOf("Fblthp's owner shuffles him into their library.", 'Fblthp, Impossibly Lost');
    expect(steps.some((step: any) => step.kind === 'move_zone' && step.to === 'library')).toBe(true);
  });
});

describe('Wall of Tombstones: indefinite base toughness from graveyard creature cards', () => {
  const text = "this creature's base toughness becomes equal to 1 plus the number of creature cards in your graveyard. (This effect lasts indefinitely.)";

  it('parses to a static set_base_pt with a toughness amount', () => {
    const steps = stepsOf(text);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'set_base_pt', duration: 'static' });
    expect(steps[0].toughnessAmount).toMatchObject({ kind: 'reference_amount' });
    expect(steps[0].power).toBeUndefined();
  });

  it('sets toughness to 1 + creature cards in graveyard and replaces its own prior setter on re-application', () => {
    const wall = creature('wall', 'p1', 'Creature - Wall', '0', '5');
    const graveyard = [
      { id: 'g1', name: 'g1', type_line: 'Creature - Elf' },
      { id: 'g2', name: 'g2', type_line: 'Artifact Creature - Golem' },
      { id: 'g3', name: 'g3', type_line: 'Instant' },
    ];
    const ctx: any = { controllerId: 'p1', sourceId: 'wall', sourceName: 'Wall of Tombstones' };
    const first: any = applyOracleIRStepsToGameState(gameState([wall], { graveyard }), stepsOf(text) as any, ctx);
    expect(first.appliedSteps?.map((s: any) => s.kind)).toEqual(['set_base_pt']);
    const afterFirst = first.state.battlefield[0];
    expect(afterFirst.modifiers.filter((m: any) => m.type === 'setPowerToughness')).toHaveLength(1);
    expect(afterFirst.modifiers[0]).toMatchObject({ setToughness: 3, duration: 'static' });
    expect(afterFirst.modifiers[0].setPower).toBeUndefined();
    expect(calculateEffectivePT(afterFirst, first.state.battlefield, [], first.state)).toMatchObject({ power: 0, toughness: 3 });

    const grown = {
      ...first.state,
      players: first.state.players.map((p: any) =>
        p.id === 'p1' ? { ...p, graveyard: [...graveyard, { id: 'g4', name: 'g4', type_line: 'Creature - Bear' }] } : p,
      ),
    };
    const second: any = applyOracleIRStepsToGameState(grown, stepsOf(text) as any, ctx);
    const afterSecond = second.state.battlefield[0];
    expect(afterSecond.modifiers.filter((m: any) => m.type === 'setPowerToughness')).toHaveLength(1);
    expect(calculateEffectivePT(afterSecond, second.state.battlefield, [], second.state).toughness).toBe(4);
  });
});

describe('Sarek: draw a card for every five creature types', () => {
  it('parses to a draw with a "for every" reference amount', () => {
    const steps = stepsOf('Draw a card for every five creature types among non-Borg creatures you control.');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'draw', amount: { kind: 'reference_amount' } });
    expect(String(steps[0].amount.raw)).toMatch(/^a card for every five creature types among non-borg creatures you control$/i);
  });

  it('draws floor(types / 5) cards', () => {
    const types = ['Elf', 'Goblin', 'Human', 'Wizard', 'Cat', 'Dog', 'Bird'];
    const battlefield = types.map((type, i) => creature(`c${i}`, 'p1', `Creature - ${type}`));
    battlefield.push(creature('borg', 'p1', 'Creature - Borg'));
    const library = Array.from({ length: 6 }, (_, i) => ({ id: `lib${i}`, name: `lib${i}`, type_line: 'Land' }));
    const result: any = applyOracleIRStepsToGameState(
      gameState(battlefield, { library }),
      stepsOf('Draw a card for every five creature types among non-Borg creatures you control.') as any,
      { controllerId: 'p1', sourceId: 'sarek', sourceName: 'Sarek' } as any,
    );
    const p1 = result.state.players.find((p: any) => p.id === 'p1');
    // 7 non-Borg creature types -> floor(7 / 5) = 1 card
    expect(p1.hand).toHaveLength(1);
  });
});

describe('Plan for All Outcomes: owner of up to one other target nonland permanent', () => {
  it('parses to an optional move_zone to library with other/up-to-one in the selector', () => {
    const steps = stepsOf('The owner of up to one other target nonland permanent puts it on their choice of the top or bottom of their library.');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'move_zone', to: 'library', optional: true });
    expect(JSON.stringify(steps[0].what)).toMatch(/up to one other target nonland permanent/i);
  });
});

describe('Brine Hag: indefinite 0/2 on creatures that dealt damage to it', () => {
  const text = 'the base power and toughness of each creature that dealt damage to it this turn become 0/2. (This effect lasts indefinitely.)';

  it('parses to a static set_base_pt 0/2', () => {
    const steps = stepsOf(text);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'set_base_pt', power: 0, toughness: 2, duration: 'static' });
    expect(JSON.stringify(steps[0].target)).toMatch(/dealt damage to it this turn/i);
  });

  it('sets 0/2 on only the damage dealers (source already left the battlefield)', () => {
    const battlefield = [
      creature('dealer1', 'p2', 'Creature - Ogre', '5', '5', { dealtCombatDamageTo: ['hag'] }),
      creature('dealer2', 'p2', 'Creature - Orc', '3', '3', { damagedPermanentIds: new Set(['hag']) }),
      creature('bystander', 'p2', 'Creature - Elf', '4', '4'),
    ];
    const result: any = applyOracleIRStepsToGameState(
      gameState(battlefield),
      stepsOf(text) as any,
      { controllerId: 'p1', sourceId: 'hag', sourceName: 'Brine Hag' } as any,
    );
    expect(result.appliedSteps?.map((s: any) => s.kind)).toEqual(['set_base_pt']);
    const byId = (id: string) => result.state.battlefield.find((p: any) => p.id === id);
    for (const id of ['dealer1', 'dealer2']) {
      expect(calculateEffectivePT(byId(id), result.state.battlefield, [], result.state)).toMatchObject({ power: 0, toughness: 2 });
    }
    expect(calculateEffectivePT(byId('bystander'), result.state.battlefield, [], result.state)).toMatchObject({ power: 4, toughness: 4 });
  });

  it('applies as a no-op when nothing dealt damage', () => {
    const result: any = applyOracleIRStepsToGameState(
      gameState([creature('bystander', 'p2', 'Creature - Elf', '4', '4')]),
      stepsOf(text) as any,
      { controllerId: 'p1', sourceId: 'hag', sourceName: 'Brine Hag' } as any,
    );
    expect(result.appliedSteps?.map((s: any) => s.kind)).toEqual(['set_base_pt']);
    expect(result.state.battlefield[0].modifiers ?? []).toHaveLength(0);
  });
});

describe('Itazura: put a card from among them that wasn\'t cast this way into your hand', () => {
  const clause = "You put a card from among them that wasn't cast this way into your hand.";

  it('parses to move_zone with the uncast-from-among-them selector to hand', () => {
    const steps = stepsOf(clause);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'move_zone', to: 'hand' });
    expect(JSON.stringify(steps[0].what)).toMatch(/wasn't cast this way/i);
  });

  const exiled = ['x1', 'x2', 'x3'].map((id) => ({ id, name: id, type_line: 'Sorcery' }));

  it('moves the only remaining uncast card to hand', () => {
    const result: any = applyOracleIRStepsToGameState(
      gameState([], { exile: [exiled[0]] }),
      stepsOf(clause) as any,
      { controllerId: 'p1', sourceId: 'itazura', sourceName: 'Itazura', lastExiledCards: [exiled[0], exiled[1]] } as any,
    );
    const p1 = result.state.players.find((p: any) => p.id === 'p1');
    expect(p1.hand.map((c: any) => c.id)).toEqual(['x1']);
    expect(p1.exile).toHaveLength(0);
  });

  it('requires a player choice when several uncast cards remain, then honours the chosen one', () => {
    const baseCtx: any = { controllerId: 'p1', sourceId: 'itazura', sourceName: 'Itazura', lastExiledCards: exiled };
    const pending: any = applyOracleIRStepsToGameState(gameState([], { exile: exiled }), stepsOf(clause) as any, baseCtx);
    expect(pending.appliedSteps ?? []).toHaveLength(0);
    expect(pending.lastStepOutcome).toMatchObject({ kind: 'choice_required', stepKind: 'move_zone' });

    const chosen: any = applyOracleIRStepsToGameState(gameState([], { exile: exiled }), stepsOf(clause) as any, {
      ...baseCtx,
      selectorContext: { chosenObjectIds: ['x2'] },
    });
    const p1 = chosen.state.players.find((p: any) => p.id === 'p1');
    expect(p1.hand.map((c: any) => c.id)).toEqual(['x2']);
    expect(p1.exile.map((c: any) => c.id)).toEqual(['x1', 'x3']);
  });
});
