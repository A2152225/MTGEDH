p=r'D:\Git\MTGEDH\rules-engine\src\oracleIRExecutorMainLoop.ts'
t=open(p,encoding='utf-8',errors='ignore').read()
i=t.find("case 'unless_sacrifices'")
print(t[i:i+1800])
print('==== any_player_may ====')
i2=t.find("case 'any_player_may'")
print(t[i2:i2+1800])
