from pathlib import Path
# modal utils for teamwork + discard then subject
for name,ranges in [
  ('stackResolveSpellLegacyModalUtils.ts', [(1,160)]),
  ('effectProgramResolutionService.ts', [(250,360)]),
  ('oracleIRParserPostprocess.ts', [(29880,30050)]),
]:
  p = Path(r'D:/Git/MTGEDH/server/src/state/modules')/name if 'stack' in name or 'effect' in name else Path(r'D:/Git/MTGEDH/rules-engine/src')/name
  if 'effectProgram' in name:
    p = Path(r'D:/Git/MTGEDH/server/src/state/modules')/name
  if not p.exists():
    # try alternate
    alts = list(Path(r'D:/Git/MTGEDH').rglob(name))
    p = alts[0] if alts else p
  print('FILE', p)
  if not p.exists():
    print('MISSING'); continue
  lines=p.read_text(encoding='utf-8',errors='replace').splitlines()
  for a,b in ranges:
    print(f'==== {a}-{b} ====')
    for i in range(a-1,min(b,len(lines))):
      print(f'{i+1}|{lines[i]}')
