p=r'D:\Git\MTGEDH\rules-engine\src\oracleIR.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find("readonly kind: 'unless_sacrifices'")
# insert any_player_may BEFORE unless_sacrifices
print(t[i-400:i+50])
print('====')
# check OracleIRExecutionContext for unless choices
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutionTypes.ts'
t2=open(p2,encoding='utf-8',errors='ignore').read()
for needle in ['unlessPaysLifeChoice','unlessDiscardsChoice','unlessSacrificesChoice','anyPlayerMay']:
  print(needle, t2.find(needle))
print('file len', len(t2))
# show choice fields area
i2=t2.find('unlessPaysLifeChoice')
print(t2[i2-200:i2+800])
