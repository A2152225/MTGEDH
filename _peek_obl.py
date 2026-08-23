import re
for p in [
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParser.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserSimpleActionClauses.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserAbilityClauses.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRParserPostprocess.ts',
]:
  t=open(p,encoding='utf-8',errors='ignore').read()
  # find gain control patterns that aren't the main one
  for m in re.finditer(r'gain(?:s)?\s+control\s+of', t, re.I):
    ctx=t[max(0,m.start()-80):m.start()+120].replace('\n',' ')
    if 'match' in ctx.lower() or 'RegExp' in ctx or 'kind' in ctx:
      pass
  # specifically look for non-anchored
  if re.search(r'gain control of \$\{\\|gainControlLoose|gain_control.*rawClause', t):
    print('interesting', p)
# Probe: what clause text produces Obligator nested step?
print('---')
code=r'''
import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
const texts = [
  'If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn',
  'gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn',
  'gain control of target creature until end of turn',
];
for (const text of texts) {
  const ir = parseOracleTextToIR(text, 'Eldrazi Obligator');
  console.log('TEXT:', text.slice(0,80));
  console.log(JSON.stringify(ir.abilities.flatMap(a=>a.steps), null, 2).slice(0,1500));
  console.log('---');
}
'''
open(r'D:\Git\MTGEDH\_probe_obl.mts','w',encoding='utf-8').write(code)
