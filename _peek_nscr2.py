import re,os
# Search more broadly
pat=re.compile(r'next.?spell.*(cost|less)|costs? \{1\} less|for each counter removed|genericReduction', re.I)
for root in [r'D:\Git\MTGEDH\rules-engine\src', r'D:\Git\MTGEDH\server\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      if pat.search(t) and ('counter removed' in t.lower() or 'next spell you cast this turn costs' in t.lower() or 'grantCostReduction' in t or 'CostReductionEffect' in t):
        print(p)
        for m in pat.finditer(t):
          if m.start()<len(t):
            snippet=t[max(0,m.start()-40):m.start()+80].replace('\n',' ')
            if 'next spell' in snippet.lower() or 'counter removed' in snippet.lower():
              print(' ', snippet[:160])
