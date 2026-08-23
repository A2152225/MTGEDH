import re, os
# Find server handling of unless pay choice / oracleIrUnlessPayChoice
needles = ['oracleIrUnlessPayChoice', 'unlessPaysLifeChoice', 'unless_pays_life', 'UnlessPay']
for root in [r'D:\Git\MTGEDH\server\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith('.ts'): continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      hits=sum(t.count(n) for n in needles)
      if hits:
        print(f'{hits:3d} {p}')
