import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const cases = [
  'Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.',
  'Search your library for a basic land card, put that card onto the battlefield tapped, then shuffle.',
  'This land enters tapped unless you control two or more basic lands.',
  'This land enters tapped unless you control two or fewer other lands.',
  "Return this card transformed under its owner's control. Craft only as a sorcery.)",
  'Regenerate enchanted creature.',
  'If this creature was kicked, it enters with two +1/+1 counters on it.',
  'Search your library for a basic land card, put it onto the battlefield, then shuffle.',
  'Search your library for up to two basic Forest cards, put them onto the battlefield tapped, then shuffle.',
  'Search your library for a basic land card, reveal it, put it onto the battlefield tapped, then shuffle.',
];

for (const t of cases) {
  const steps = collectStepsFromIrText(t, 'Test');
  const irGaps = hasUnknownIRSteps(t, 'Test');
  const rec = dryRunOracleSteps(
    steps,
    { name: 'Test', type_line: 'Land', oracle_text: t },
    irGaps,
    { typeLine: 'Land' }
  );
  console.log('---', t.slice(0, 90));
  console.log('status', rec.status, 'irGaps', irGaps.length);
  console.log(
    'steps',
    steps.map((s) => `${s.kind}${s.kind === 'move_zone' ? `:${(s as any).to}` : ''}:${String((s as any).raw || '').slice(0, 50)}`)
  );
  if (Object.keys(rec.reasonCodes).length) console.log('reasons', rec.reasonCodes);
}
