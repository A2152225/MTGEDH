// Chat B split helper: name a single-group guard-run plan.
import fs from 'node:fs';

const [outModule, prefix, headerPath] = process.argv.slice(2);
if (!outModule || !prefix || !headerPath) {
  console.error('usage: node tools/_tmp-chatB-name-one-plan.mjs <outModulePath> <helperPrefix> <headerTxt>');
  process.exit(1);
}

const words = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
];

const plans = JSON.parse(fs.readFileSync('tools/_tmp-chatB-plans.json', 'utf8'));
if (plans.length !== 1) {
  console.error(`expected a single group, got ${plans.length}`);
  process.exit(1);
}
const plan = plans[0];
plan.out = outModule;
plan.header = headerPath;
plan.chunks.forEach((chunk, i) => {
  chunk.name = `${prefix}${words[i + 1] ?? `Part${i + 1}`}`;
});

fs.writeFileSync('tools/_tmp-chatB-plans-named.json', JSON.stringify(plans, null, 2));
for (const chunk of plan.chunks) {
  console.log(`${chunk.name} (${chunk.start}-${chunk.end}) args(${chunk.args})`);
}
