import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { isExternallyHandledOracleFragmentText } from '../../rules-engine/src/oracleIRParserPostprocess.ts';

const cases = [
  '(As this Saga enters and after your draw step, add a lore counter. Sacrifice after VI.)',
  'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
  'Threshold - As long as there are seven or more cards in your graveyard, this creature gets +1/+1 and has flying.',
  'Do this only once each turn.',
  'Aftermath (Cast this spell only from your graveyard. Then exile it.)',
  "Skulk (This creature can't be blocked by creatures with greater power.)",
  '(As a Siege enters, choose an opponent to protect it. You and others can attack it. When it\'s defeated, exalt its controller and they draw cards equal to its defense.)',
  'Enchant permanent',
  '{T}: Add {G}.\nSearch your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
];

for (const t of cases) {
  const steps = collectStepsFromIrText(t, 'Test');
  const irGaps = hasUnknownIRSteps(t, 'Test');
  const rec = dryRunOracleSteps(
    steps,
    { name: 'Test', type_line: 'Creature', oracle_text: t },
    irGaps,
    { typeLine: 'Creature' }
  );
  console.log('---', t.slice(0, 90).replace(/\n/g, ' '));
  console.log('status', rec.status, 'irGaps', irGaps.length, 'extern', isExternallyHandledOracleFragmentText(t));
  console.log('steps', steps.map((s) => `${s.kind}:${String((s as any).raw || '').slice(0,40)}`));
  const parsed = parseOracleTextToIR(t, 'Test');
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '').trim();
    if (!text) continue;
    console.log(' ability', a.type, text.slice(0,60), 'steps', a.steps?.map(s=>s.kind));
  }
}
