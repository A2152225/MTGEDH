p=r'D:\Git\MTGEDH\server\src\state\modules\graveyard-mana-value.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find('DynamicManaValueContext')
print(t[i:i+500])
# also end of inferTriggeredAbilityTargetMetadata return / target type inference for creature
p2=r'D:\Git\MTGEDH\server\src\state\modules\inferTriggeredAbilityTargetMetadata.ts'
t2=open(p2,encoding='utf-8').read()
# find targetType = creature
import re
for m in re.finditer(r'targetType = ', t2):
  print(t2[m.start():m.start()+120].replace('\n',' '))
