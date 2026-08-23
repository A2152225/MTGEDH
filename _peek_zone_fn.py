from pathlib import Path
p=Path(r'D:/Git/MTGEDH/rules-engine/src/oracleIRParserZoneAndRemovalActions.ts')
text=p.read_text(encoding='utf-8')
# find export function that contains counterUnless
idx=text.find('counterSelfUnlessSacrificeMatch')
print('idx', idx)
# find function name before this
before=text[:idx].rfind('export function')
print(text[before:before+200])
print('---')
# also find who calls this
import re
for name in Path(r'D:/Git/MTGEDH/rules-engine/src').glob('oracleIRParser*.ts'):
  t=name.read_text(encoding='utf-8',errors='replace')
  for m in re.finditer(r'tryParse\w*Counter|parseZoneAndRemoval|from \'./oracleIRParserZoneAndRemoval', t):
    pass
  if 'oracleIRParserZoneAndRemovalActions' in t or 'tryParseCounter' in t:
    for i,line in enumerate(t.splitlines(),1):
      if 'ZoneAndRemoval' in line or 'tryParseCounterSpell' in line or 'parseCounter' in line:
        print(f'{name.name}:{i}|{line[:140]}')
