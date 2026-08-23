import re,os
# Search for where trigger targets become IR ctx fields
needles=['targetCreatureId','targetPermanentId','chosenObjectIds']
for root in [r'D:\Git\MTGEDH\server\src\state\modules']:
  for fn in os.listdir(root):
    if not fn.endswith('.ts'): continue
    p=os.path.join(root,fn)
    t=open(p,encoding='utf-8',errors='ignore').read()
    if 'targetCreatureId' in t or ('chosenObjectIds' in t and 'trigger' in t.lower()):
      c=t.count('targetCreatureId')+t.count('chosenObjectIds')
      print(f'{c:3d} {fn}')
