from pathlib import Path
h = Path(r"D:/Git/MTGEDH/rules-engine/src/actions/triggersHandler.ts").read_text(encoding="utf-8")
idx = h.find("triggersHandlerAttacksAlone")
print(h[idx:idx+3000])
print("====")
print("count checkAttacksAPlayerAloneTriggers", h.count("checkAttacksAPlayerAloneTriggers"))
print("count ATTACKS_A_PLAYER_ALONE", h.count("ATTACKS_A_PLAYER_ALONE"))
