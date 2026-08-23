import re,os
for root in [r'D:\Git\MTGEDH\client\src']:
  for dp,_,fns in os.walk(root):
    for fn in fns:
      if not fn.endswith(('.ts','.tsx')): continue
      p=os.path.join(dp,fn)
      t=open(p,encoding='utf-8',errors='ignore').read()
      if 'needsTargetSelection' in t or 'requiresTarget' in t and 'triggered' in t.lower():
        if 'needsTargetSelection' in t:
          print(p)
