from pathlib import Path
path = Path(r"D:\Git\MTGEDH\server\src\state\modules\stackResolveTriggeredAbilityTargetPromptUtils.ts")
text = path.read_text(encoding="utf-8")
idx = text.find("triggeredAbilityGraveyardSelection")
print("idx", idx)
print(repr(text[idx-200:idx+900]))
print("---guard---")
idx2 = text.find("targetZone === 'graveyard')")
print(repr(text[idx2-200:idx2+80]))
