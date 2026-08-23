from pathlib import Path
p = Path(r'D:/Git/MTGEDH/server/src/state/effects/effectProgramResolutionService.ts')
text = p.read_text(encoding='utf-8')
# show buildTeamworkChooseBothQueueExtras
idx = text.find('function buildTeamworkChooseBothQueueExtras')
print(text[idx:idx+900])
