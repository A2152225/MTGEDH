import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';

const texts = [
  'Convoke (Each creature you tap while casting this spell pays for {1} or one mana of that creature\'s color.)',
  'Convoke\nCreate X 1/1 white Soldier creature tokens with lifelink.',
  'Convoke (Your creatures can help cast this spell. Each creature you tap while casting this spell pays for {1} or one mana of that creature\'s color.)\nCreate X 1/1 white Soldier creature tokens with lifelink.',
  'Convoke\nTarget creature gets +3/+3 until end of turn.'
];

texts.forEach((text, i) => {
  console.log('--- Sample ' + (i + 1) + ' ---');
  console.log('Input: ' + text);
  const ir = parseOracleTextToIR(text);
  console.log('Keywords: ' + JSON.stringify(ir.keywords));
  const abilities = ir.abilities.map(a => ({
    type: a.type,
    text: a.text,
    steps: a.steps.map(s => ({
       kind: s.kind,
       raw: (s as any).raw
    }))
  }));
  console.log('Abilities: ' + JSON.stringify(abilities));
  console.log('');
});
