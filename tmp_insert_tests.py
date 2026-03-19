f = r'd:\Git\MTGEDH\rules-engine\test\oracleIRExecutor.test.ts'
with open(f, 'r', encoding='utf-8') as fh:
    lines = fh.readlines()

new_tests = r"""
  describe('all-players spells cast this turn', () => {
    it('sums all players\' spell counts for "number of spells cast this turn"', () => {
      const ir = parseOracleTextToIR(
        'The creature gets +X/+0 until end of turn where X is the number of spells cast this turn.',
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        spellsCastThisTurn: { p1: 2, p2: 3, p3: 1 },
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p3', name: 'P3', seat: 2, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'eq1', ownerId: 'p1', controller: 'p1', name: 'Equipment', cardType: 'Artifact — Equipment', type_line: 'Artifact — Equipment', attachedTo: 'tc1', tapped: false, summoningSick: false, counters: {} } as any,
          { id: 'tc1', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 2, toughness: 2, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      } as any);

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'eq1' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tc1') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
      expect(ptMod.power).toBe(6); // 2 + 3 + 1
      expect(ptMod.toughness).toBe(0);
    });

    it('handles "one plus the number of spells cast this turn" via arithmetic recursion', () => {
      const ir = parseOracleTextToIR(
        'The creature gets +X/+0 until end of turn where X is one plus the number of spells cast this turn.',
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        spellsCastThisTurn: { p1: 1, p2: 2 },
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'tcOnePlusSpells', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      } as any);

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcOnePlusSpells') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
      expect(ptMod.power).toBe(4); // 1 + (1 + 2)
      expect(ptMod.toughness).toBe(0);
    });
  });

  describe('named-source exile count', () => {
    it('counts cards exiled by a named permanent on the battlefield', () => {
      const ir = parseOracleTextToIR(
        'Target creature gets +X/+X until end of turn where X is the number of cards exiled with verdant sungrove.',
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          {
            id: 'p1', name: 'P1', seat: 0, life: 40, library: [],
            hand: [],
            graveyard: [],
            exile: [
              { id: 'ex1', exiledBy: 'namedSrc' },
              { id: 'ex2', exiledBy: 'namedSrc' },
              { id: 'ex3', exiledBy: 'namedSrc' },
              { id: 'ex4', exiledBy: 'otherSrc' },
            ],
          } as any,
        ],
        battlefield: [
          { id: 'namedSrc', ownerId: 'p1', controller: 'p1', name: 'Verdant Sungrove', cardType: 'Enchantment', type_line: 'Enchantment', tapped: false, summoningSick: false, counters: {} } as any,
          { id: 'tcNamedExile', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'namedSrc' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcNamedExile') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
      expect(ptMod.power).toBe(3);
      expect(ptMod.toughness).toBe(3);
    });

    it('returns null (no modifier) when named permanent is not on battlefield', () => {
      const ir = parseOracleTextToIR(
        'Target creature gets +X/+X until end of turn where X is the number of cards exiled with verdant sungrove.',
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [{ id: 'ex1', exiledBy: 'namedSrc2' }] } as any,
        ],
        battlefield: [
          { id: 'tcNoSource', ownerId: 'p1', controller: 'p1', name: 'Target Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcNoSource') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');
      expect(ptMod).toBeUndefined();
    });
  });

  describe('difference between those players\' life totals', () => {
    it('returns absolute difference of two identified players\' life totals', () => {
      const ir = parseOracleTextToIR(
        "Target creature gets +X/+0 until end of turn where X is the difference between those players' life totals.",
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p2', name: 'P2', seat: 1, life: 30, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p3', name: 'P3', seat: 2, life: 22, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'tcLifeDiff', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, {
        controllerId: 'p1',
        selectorContext: { eachOfThoseOpponents: ['p2', 'p3'] as any },
      });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcLifeDiff') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
      expect(ptMod.power).toBe(8); // |30 - 22|
      expect(ptMod.toughness).toBe(0);
    });

    it('returns null (no modifier) when fewer than two opponents are identified', () => {
      const ir = parseOracleTextToIR(
        "Target creature gets +X/+0 until end of turn where X is the difference between those players' life totals.",
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
          { id: 'p2', name: 'P2', seat: 1, life: 30, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'tcLifeDiffNone', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      // No selectorContext provided — eachOfThoseOpponents will be empty
      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcLifeDiffNone') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');
      expect(ptMod).toBeUndefined();
    });
  });

  describe('generic mana in that spell\'s mana cost', () => {
    it('counts the numeric component of a spell\'s mana cost', () => {
      const ir = parseOracleTextToIR(
        "Target creature gets +X/+0 until end of turn where X is the amount of generic mana in that spell's mana cost.",
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'srcSpellGeneric', ownerId: 'p1', controller: 'p1', name: 'Kindle', cardType: 'Instant', type_line: 'Instant', mana_cost: '{3}{B}{R}', tapped: false, summoningSick: false, counters: {} } as any,
          { id: 'tcGenericMana', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'srcSpellGeneric' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcGenericMana') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      expect(result.appliedSteps.some(s => s.kind === 'modify_pt')).toBe(true);
      expect(ptMod.power).toBe(3);
      expect(ptMod.toughness).toBe(0);
    });

    it('handles multi-generic components summed correctly', () => {
      const ir = parseOracleTextToIR(
        "Target creature gets +X/+0 until end of turn where X is the amount of generic mana in that spell's mana cost.",
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'srcSpellMultiGen', ownerId: 'p1', controller: 'p1', name: 'Test Spell', cardType: 'Sorcery', type_line: 'Sorcery', mana_cost: '{U}{U}', tapped: false, summoningSick: false, counters: {} } as any,
          { id: 'tcGenericMana2', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'srcSpellMultiGen' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcGenericMana2') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');

      // {U}{U} has no generic mana, so X=0 and no modifier is added (power +0 === no change)
      expect(ptMod).toBeUndefined();
    });

    it('returns 0 and skips modifier for purely colored mana cost', () => {
      const ir = parseOracleTextToIR(
        "Target creature gets +X/+0 until end of turn where X is the amount of generic mana in that spell's mana cost.",
        'Test'
      );
      const steps = ir.abilities[0]?.steps ?? [];

      const start = makeState({
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [], exile: [] } as any,
        ],
        battlefield: [
          { id: 'srcColoredOnly', ownerId: 'p1', controller: 'p1', name: 'Bolt', cardType: 'Instant', type_line: 'Instant', mana_cost: '{R}', tapped: false, summoningSick: false, counters: {} } as any,
          { id: 'tcGenericMana3', ownerId: 'p1', controller: 'p1', name: 'Test Bear', cardType: 'Creature', power: 1, toughness: 1, tapped: false, summoningSick: false, counters: {} } as any,
        ],
        priority: 'p1',
        turnPlayer: 'p1',
      });

      const result = applyOracleIRStepsToGameState(start, steps, { controllerId: 'p1', sourceId: 'srcColoredOnly' });
      const creature = ((result.state as any).battlefield || []).find((p: any) => p.id === 'tcGenericMana3') as any;
      const ptMod = (Array.isArray(creature?.modifiers) ? creature.modifiers : []).find((m: any) => m?.type === 'powerToughness');
      expect(ptMod).toBeUndefined();
    });
  });

"""

# Insert the new tests before the final '}); blank line' at the end
# The file ends: ...safe-skips }); ← line 26781, }); ← line 26782, blank ← line 26783
# We want to insert BEFORE line 26782 (0-idx 26781)
insert_idx = len(lines) - 2  # before the final '});' at 0-idx 26781

lines = lines[:insert_idx] + [new_tests] + lines[insert_idx:]

with open(f, 'w', encoding='utf-8', newline='') as fh:
    fh.writelines(lines)

print(f'Done. New total: {len(lines)} lines')
