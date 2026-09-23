from pathlib import Path
path = Path(r"D:/Git/MTGEDH/server/src/state/modules/triggers/attack-detection-generic.ts")
text = path.read_text(encoding="utf-8")
# Move player-alone block before attacks-alone block for safety
alone_start = text.find("  const creatureAttacksAloneMatch = oracleText.match(")
player_start = text.find("  // CR 506.6 (20260925): attacks a player alone")
if alone_start < 0 or player_start < 0:
  raise SystemExit(f"anchors {alone_start} {player_start}")

# Extract player-alone block (until enchantedPlayerAttackedMatch)
player_end = text.find("  const enchantedPlayerAttackedMatch", player_start)
alone_block_end = player_start  # alone block currently ends where player block starts

alone_block = text[alone_start:alone_block_end]
player_block = text[player_start:player_end]

# Rebuild: player first, then alone
text2 = text[:alone_start] + player_block + alone_block + text[player_end:]
path.write_text(text2, encoding="utf-8", newline="\n")
print("reordered detection")
# show
chunk = path.read_text(encoding="utf-8")
idx = chunk.find("creatureAttacksAloneMatch")
idx2 = chunk.find("creatureAttacksAPlayerAloneMatch")
print("player_alone_idx", idx2, "alone_idx", idx, "player_before_alone", idx2 < idx)
