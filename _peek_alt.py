import re
# Look at alternate-costs and casting for delayed reductions
for p in [
 r'D:\Git\MTGEDH\server\src\state\modules\alternate-costs.ts',
 r'D:\Git\MTGEDH\server\src\state\modules\casting-modifiers.ts',
 r'D:\Git\MTGEDH\rules-engine\src\cards\costReduction.ts',
]:
  t=open(p,encoding='utf-8',errors='ignore').read()
  print('====', p.split(chr(92))[-1], len(t))
  for m in re.finditer(r'.{0,50}(next spell|delayed|thisTurn|genericReduction|costReductionEffects).{0,80}', t, re.I):
    s=m.group(0).replace(chr(10),' ')
    if 'next' in s.lower() or 'delay' in s.lower() or 'thisTurn' in s or 'costReduction' in s:
      print('-', s[:180])
