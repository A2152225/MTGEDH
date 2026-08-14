/*
  Replacement-effect soak (Phase 5 mill / library-search / combat).

  In-process: local oracle + pattern spec collection (no card-name routing).
  Live table: inject named permanents with real oracle, then mill / search / combat.
  Does not expand edh-readiness.
*/

import { lookupLocalCardByNameSync } from '../../../src/services/localCardLookup.js';
import { detectPreventDamageMillReplacementForController, detectTypeRestrictedCombatMillReplacement } from '../../../src/state/modules/game-state-effects.js';
import {
  collectOraclePatternLibrarySearchReplacementSpecsFromState,
  collectOraclePatternMillReplacementSpecsFromState,
} from '../../../src/state/modules/replacementEffectSpec.js';
import {
  check,
  finishSoak,
  soakCard,
  type SoakSuite,
  type SmokeSoakResult,
} from '../oracleIrSmokeCore.js';

function battlefieldFor(name: string, controller = 'p1') {
  const card = lookupLocalCardByNameSync(name);
  return [{
    id: `spec-${name}`,
    controller,
    card: { name: card?.name || name, oracle_text: card?.oracle_text || '' },
  }];
}

function millSpecs(name: string) {
  return collectOraclePatternMillReplacementSpecsFromState({ battlefield: battlefieldFor(name) });
}

function searchSpecs(name: string, controller = 'p2') {
  return collectOraclePatternLibrarySearchReplacementSpecsFromState({
    battlefield: battlefieldFor(name, controller),
  });
}

function powerOf(name: string): number {
  const card = lookupLocalCardByNameSync(name);
  return Number.parseInt(String(card?.power || '0'), 10) || 0;
}

function runMillReplacements(): SmokeSoakResult {
  return finishSoak('mill_replacements', 'Mill table', 'Opponent mill amount replacements', [
    soakCard('Bruvac the Grandiloquent', (_card, _collected, result) => {
      const specs = millSpecs('Bruvac the Grandiloquent');
      result.checks.push(
        check(
          'mill_double',
          'double',
          specs.map((spec) => spec.instead.modify),
          specs.some((spec) => spec.instead.modify === 'double'),
        ),
      );
    }),
    soakCard('The Water Crystal', (_card, _collected, result) => {
      const specs = millSpecs('The Water Crystal');
      result.checks.push(
        check(
          'mill_plus_four',
          4,
          specs.map((spec) => spec.instead.value),
          specs.some((spec) => spec.instead.modify === 'add_flat' && Number(spec.instead.value) === 4),
        ),
      );
    }),
  ]);
}

function runLibrarySearchReplacements(): SmokeSoakResult {
  const names = [
    'Leonin Arbiter',
    'Aven Mindcensor',
    'Ashiok, Dream Render',
    'Stranglehold',
    'Opposition Agent',
    'Mindlock Orb',
    'Ob Nixilis, Unshackled',
  ] as const;
  const expect: Record<string, (specs: ReturnType<typeof searchSpecs>) => { id: string; expected: unknown; pass: boolean; actual: unknown }> = {
    'Leonin Arbiter': (specs) => ({
      id: 'search_payment',
      expected: '{2}',
      actual: specs.map((spec) => spec.instead.paymentToIgnore),
      pass: specs.some((spec) => String(spec.instead.paymentToIgnore) === '{2}'),
    }),
    'Aven Mindcensor': (specs) => ({
      id: 'search_limit_top',
      expected: 4,
      actual: specs.map((spec) => spec.instead.limitToTop),
      pass: specs.some((spec) => spec.instead.limitToTop === 4),
    }),
    'Ashiok, Dream Render': (specs) => ({
      id: 'search_prevent',
      expected: true,
      actual: specs.map((spec) => spec.instead.preventSearch),
      pass: specs.some((spec) => spec.instead.preventSearch === true),
    }),
    Stranglehold: (specs) => ({
      id: 'search_prevent',
      expected: true,
      actual: specs.map((spec) => spec.instead.preventSearch),
      pass: specs.some((spec) => spec.instead.preventSearch === true),
    }),
    'Opposition Agent': (specs) => ({
      id: 'search_control',
      expected: true,
      actual: specs.map((spec) => spec.instead.controlSearch),
      pass: specs.some((spec) => spec.instead.controlSearch === true),
    }),
    'Mindlock Orb': (specs) => ({
      id: 'search_prevent',
      expected: true,
      actual: specs.map((spec) => spec.instead.preventSearch),
      pass: specs.some((spec) => spec.instead.preventSearch === true),
    }),
    'Ob Nixilis, Unshackled': (specs) => ({
      id: 'search_trigger',
      expected: 'triggerEffect',
      actual: specs.map((spec) => spec.instead.triggerEffect),
      pass: specs.some((spec) => Boolean(spec.instead.triggerEffect)),
    }),
  };

  return finishSoak(
    'library_search_replacements',
    'Search table',
    'Library-search restriction replacements',
    names.map((name) =>
      soakCard(name, (_card, _collected, result) => {
        const row = expect[name](searchSpecs(name));
        result.checks.push(check(row.id, row.expected, row.actual, row.pass));
      }),
    ),
  );
}

function runCombatReplacements(): SmokeSoakResult {
  return finishSoak('combat_replacements', 'Combat table', 'Combat damage mill replacements', [
    soakCard('Szadek, Lord of Secrets', (card, _collected, result) => {
      const oracle = String(card.oracle_text || '').toLowerCase();
      const szadekPower = powerOf('Szadek, Lord of Secrets');
      result.checks.push(
        check(
          'source_self_combat_oracle',
          'would deal combat damage to a player + instead + counters + mill',
          oracle.slice(0, 180),
          oracle.includes('would deal combat damage to a player')
            && oracle.includes('instead')
            && oracle.includes('+1/+1')
            && (oracle.includes('mills') || oracle.includes('mill')),
        ),
      );
      result.checks.push(check('power_parsed', true, szadekPower, szadekPower > 0));
    }),
    soakCard('Undead Alchemist', (card, _collected, result) => {
      const oracle = String(card.oracle_text || '').toLowerCase();
      const attacker = {
        id: 'alch',
        controller: 'p1',
        card: { name: card.name, oracle_text: card.oracle_text, type_line: card.type_line },
      };
      const detected = detectTypeRestrictedCombatMillReplacement(
        { state: { battlefield: [attacker] } } as any,
        'p1',
        attacker.card,
        attacker,
      );
      result.checks.push(
        check(
          'type_restricted_combat_oracle',
          'a [type] you control would deal combat damage + instead mill that player',
          oracle.slice(0, 180),
          /if a \w+ you control would deal combat damage to a player/i.test(oracle)
            && oracle.includes('instead')
            && (oracle.includes('that player mills') || oracle.includes('that player mill')),
        ),
      );
      result.checks.push(
        check(
          'type_restricted_detect',
          'zombie',
          detected?.effect.appliesToCreatureType,
          detected?.effect.appliesToCreatureType === 'zombie' && detected?.effect.millDamagedPlayer === true,
        ),
      );
    }),
    soakCard('The Mindskinner', (card, _collected, result) => {
      const detected = detectPreventDamageMillReplacementForController(
        {
          state: {
            battlefield: battlefieldFor('The Mindskinner'),
            players: [{ id: 'p1' }, { id: 'p2' }],
          },
        } as any,
        'p1',
        { nonCombatOnly: false },
      );
      result.checks.push(
        check(
          'prevent_and_mill',
          true,
          { prevents: detected?.effect.preventsDamage, millAll: detected?.effect.millAllOpponents },
          detected?.effect.preventsDamage === true && detected?.effect.millAllOpponents === true,
        ),
      );
      result.checks.push(
        check(
          'oracle_not_source_self_only',
          'a source you control',
          String(card.oracle_text || '').slice(0, 120),
          /a source you control/i.test(String(card.oracle_text || '')),
        ),
      );
    }),
  ]);
}

export const replacementEffectsSuite: SoakSuite = {
  id: 'replacement-effects',
  title: 'Replacement-effect live injection',
  description: 'Mill double/+4, library-search restrictions, Szadek source-self, Alchemist type-restricted combat mill, Mindskinner prevent-and-mill',
  live: {
    mill_replacements: {
      playerCount: 3,
      setup: 'main',
      action: 'mill',
      millCount: 3,
      perCard: {
        'Bruvac the Grandiloquent': {
          inject: [{ name: 'Bruvac the Grandiloquent', controller: 'human' }],
          expect: { millOpponentExact: 6, millOtherUnchanged: true },
        },
        'The Water Crystal': {
          inject: [{ name: 'The Water Crystal', controller: 'human' }],
          expect: { millOpponentExact: 7, millOtherUnchanged: true },
        },
      },
    },
    library_search_replacements: {
      playerCount: 2,
      setup: 'main',
      action: 'search',
      perCard: {
        'Leonin Arbiter': {
          inject: [{ name: 'Leonin Arbiter', controller: 'ai' }],
          expect: { canSearch: true, paymentAmount: '{2}' },
        },
        'Aven Mindcensor': {
          inject: [{ name: 'Aven Mindcensor', controller: 'ai' }],
          expect: { canSearch: true, limitToTop: 4 },
        },
        'Ashiok, Dream Render': {
          inject: [{ name: 'Ashiok, Dream Render', controller: 'ai' }],
          expect: { canSearch: false },
        },
        Stranglehold: {
          inject: [{ name: 'Stranglehold', controller: 'ai' }],
          expect: { canSearch: false },
        },
        'Opposition Agent': {
          inject: [{ name: 'Opposition Agent', controller: 'ai' }],
          expect: { canSearch: true, controlledBySeat: 'ai' },
        },
        'Mindlock Orb': {
          inject: [{ name: 'Mindlock Orb', controller: 'ai' }],
          expect: { canSearch: false },
        },
        'Ob Nixilis, Unshackled': {
          inject: [{ name: 'Ob Nixilis, Unshackled', controller: 'ai' }],
          expect: { canSearch: true, triggerCountAtLeast: 1 },
        },
      },
    },
    combat_replacements: {
      playerCount: 3,
      setup: 'main',
      action: 'combat',
      perCard: {
        'Szadek, Lord of Secrets': {
          inject: [{ name: 'Szadek, Lord of Secrets', controller: 'human', attacking: true }],
          expect: {
            lifeUnchanged: true,
            millOpponentAtLeast: 1,
            millOtherUnchanged: true,
            plusOneAtLeast: 1,
          },
        },
        'Undead Alchemist': {
          inject: [{ name: 'Undead Alchemist', controller: 'human', attacking: true }],
          expect: {
            lifeUnchanged: true,
            millOpponentAtLeast: 1,
            millOtherUnchanged: true,
            plusOneOnAttacker: 0,
          },
        },
        'The Mindskinner': {
          inject: [
            { name: 'The Mindskinner', controller: 'human' },
            { soakCreature: true, controller: 'human', attacking: true },
          ],
          expect: {
            lifeUnchanged: true,
            millOpponentAtLeast: 1,
            millOtherAtLeast: 1,
          },
        },
      },
    },
  },
  run: () => [
    runMillReplacements(),
    runLibrarySearchReplacements(),
    runCombatReplacements(),
  ],
};
