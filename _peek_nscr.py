# Search for delayed/next-spell cost reduction state fields
import re,os
for root in [r'D:\Git\MTGEDH\server\src', r'D:\Git\MTGEDH\rules-engine\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      if re.search(r'nextSpellCostReduction|delayedCostReduction|temporaryCostReduction|costReductionEffects|genericReductionThisTurn', t):
        print(p)
