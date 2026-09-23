from pathlib import Path
# Update condition routing: keep attacks alone as global sole attacker;
# add attacks a player alone as per-defender sole attacker when battlefield present.
path = Path(r"D:/Git/MTGEDH/rules-engine/src/triggeredAbilitiesConditionRouting.ts")
text = path.read_text(encoding="utf-8")
old = """  if (/^a creature you control attacks alone$/i.test(conditionLower)) {
    const attackingCreatures = (eventData.battlefield || []).filter((permanent: any) => {
      if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature')
        && Boolean(permanent?.attacking || permanent?.defendingPlayerId || permanent?.attackingPlayerId);
    });
    if (attackingCreatures.length > 0) return attackingCreatures.length === 1;
    // ATTACKS_ALONE event producers may provide only the lone attacker's
    // identity/controller rather than a full battlefield snapshot.
    return Boolean(
      (eventData.sourceId || eventData.targetPermanentId)
      && String(eventData.sourceControllerId || '').trim() === String(controllerId || '').trim(),
    );
  }

  return null;
}
"""
new = """  if (/^a creature you control attacks alone$/i.test(conditionLower)) {
    const attackingCreatures = (eventData.battlefield || []).filter((permanent: any) => {
      if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature')
        && Boolean(permanent?.attacking || permanent?.defendingPlayerId || permanent?.attackingPlayerId);
    });
    if (attackingCreatures.length > 0) return attackingCreatures.length === 1;
    // ATTACKS_ALONE event producers may provide only the lone attacker's
    // identity/controller rather than a full battlefield snapshot.
    return Boolean(
      (eventData.sourceId || eventData.targetPermanentId)
      && String(eventData.sourceControllerId || '').trim() === String(controllerId || '').trim(),
    );
  }

  if (/^a creature you control attacks a player alone$/i.test(conditionLower)) {
    const sourceId = String(eventData.sourceId || eventData.targetPermanentId || '').trim();
    const attackingCreatures = (eventData.battlefield || []).filter((permanent: any) => {
      if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(permanent?.type_line || permanent?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature')
        && Boolean(permanent?.attacking || permanent?.defendingPlayerId || permanent?.attackingPlayerId);
    });
    if (attackingCreatures.length > 0 && sourceId) {
      const source = attackingCreatures.find((permanent: any) => String(permanent?.id || '').trim() === sourceId);
      if (!source) return false;
      const defended = String(
        source?.defendingPlayerId || source?.attacking || eventData.targetOpponentId || eventData.targetPlayerId || '',
      ).trim();
      if (!defended) return false;
      const coAttackers = attackingCreatures.filter((permanent: any) => {
        const id = String(permanent?.id || '').trim();
        if (!id || id === sourceId) return false;
        const otherDefended = String(permanent?.defendingPlayerId || permanent?.attacking || '').trim();
        return otherDefended === defended;
      });
      return coAttackers.length === 0;
    }
    return Boolean(
      sourceId
      && String(eventData.sourceControllerId || '').trim() === String(controllerId || '').trim(),
    );
  }

  return null;
}
"""
if old not in text:
  raise SystemExit("routing needle missing")
path.write_text(text.replace(old, new, 1), encoding="utf-8", newline="\n")
print("routing ok")
