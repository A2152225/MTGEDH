import { applyGainControlStep } from './rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
const result = applyGainControlStep(
  {
    players: [{ id: 'p1' }, { id: 'p2' }],
    battlefield: [
      { id: 'c1', controller: 'p2', type_line: 'Creature — Eldrazi', summoningSickness: false },
    ],
    controlChangeEffects: [],
  } as any,
  {
    kind: 'gain_control',
    what: { kind: 'raw', text: 'target creature' },
    newController: { kind: 'you' },
    duration: 'until_end_of_turn',
    raw: 'gain control of target creature until end of turn',
  } as any,
  { controllerId: 'p1', targetPermanentId: 'c1', sourceName: 'Flayer of Loyalties' } as any,
);
console.log(result);
