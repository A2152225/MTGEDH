import re, os

# Find evaluateUnlessSacrifices and any_player related executor code
for p in [
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorConditionalStepSupport.ts',
 r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorMainLoop.ts',
 r'D:\Git\MTGEDH\server\src\state\modules\oracleIrEffectProgramServer.ts',
 r'D:\Git\MTGEDH\_patch_unless_sac.py',
]:
  t=open(p,encoding='utf-8',errors='ignore').read()
  print('====', os.path.basename(p), len(t))
  for needle in ['evaluateUnlessSacrifices', 'unless_sacrifices', 'any_player', 'UnlessPay', 'player_choice_required']:
    idxs=[m.start() for m in re.finditer(re.escape(needle), t)]
    print(f'  {needle}: {len(idxs)} hits')
    if idxs:
      i=idxs[0]
      print(t[max(0,i-100):i+500].replace('\n',' | ')[:400])
      print('---')
