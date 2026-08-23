import re,os
# Search for remove all counters / remove_counters / cost reduction next spell
needles=[r'remove all counters', r'remove_counters', r'next spell you cast', r'costs? \{1\} less', r'for each counter removed', r'costReduction', r'cost_reduction']
for root in [r'D:\Git\MTGEDH\rules-engine\src', r'D:\Git\MTGEDH\server\src', r'D:\Git\MTGEDH\server\tests']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      p=os.path.join(dp,fn)
      try: t=open(p,encoding='utf-8',errors='ignore').read()
      except: continue
      hits=[]
      for n in needles:
        if re.search(n, t, re.I): hits.append(n)
      if hits:
        print(os.path.relpath(p, r'D:\Git\MTGEDH'), '::', ', '.join(hits[:4]))
