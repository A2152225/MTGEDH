from pathlib import Path
hits=[]
for p in Path(r'D:/Git/MTGEDH/server/src/state/modules').glob('*rigger*'):
  if p.suffix!='.ts': continue
  text=p.read_text(encoding='utf-8',errors='replace')
  if 'buildOracleIRExecutionContext' in text or 'wasKicked' in text:
    hits.append(str(p))
    for i,line in enumerate(text.splitlines(),1):
      if 'buildOracleIRExecutionContext' in line or 'wasKicked' in line or 'teamworkWasPaid' in line:
        hits.append(f'  {i}|{line.strip()[:140]}')
for p in Path(r'D:/Git/MTGEDH/server/src/state/modules').glob('oracleIr*'):
  text=p.read_text(encoding='utf-8',errors='replace')
  if 'wasKicked' in text or ('buildOracleIR' in text and 'trigger' in p.name.lower()):
    for i,line in enumerate(text.splitlines(),1):
      if 'wasKicked' in line:
        hits.append(f'{p.name}:{i}|{line.strip()[:140]}')
Path(r'D:/Git/MTGEDH/probe_trig_kick.txt').write_text('\n'.join(hits),encoding='utf-8')
print('\n'.join(hits[:60]))
