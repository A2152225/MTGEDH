p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutionTypes.ts'
t=open(p,encoding='utf-8',errors='ignore').read()[:500]
print(t)
print('PlayerID in file', 'PlayerID' in open(p,encoding='utf-8').read())
# verify type syntax around any_player_may
p2=r'D:\Git\MTGEDH\rules-engine\src\oracleIR.ts'
t2=open(p2,encoding='utf-8').read()
i=t2.find("kind: 'any_player_may'")
print(t2[i-100:i+800])
