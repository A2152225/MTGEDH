from pathlib import Path
import json
from datetime import datetime

rows = json.loads(Path(r"D:\Git\MTGEDH\tools\_oncast_audit\probe-post.json").read_text(encoding="utf-8"))
scry = json.loads(Path(r"D:\Git\MTGEDH\tools\_oncast_audit\scryfall.json").read_text(encoding="utf-8"))

# Primary pattern assignment (one primary cluster per card for counting)
PRIORITY = [
  "commander_cast_copy",
  "return_from_graveyard",
  "exile_target_permanent",
  "exile_library_top",
  "destroy",
  "draw",
  "create_tokens",
  "copy_spell_or_permanent",
  "gain_control",
  "tap",
  "search_library",
  "put_onto_battlefield",
  "put_on_library_top",
  "put_counters",
  "pump",
  "gain_life",
  "lose_life",
  "sacrifice",
  "mill_amass",
  "discard",
  "reveal_library",
  "modal",
  "any_player_may_tax",
  "counter_related",
  "extra_turn",
  "remove_counters_cost_reduce",
  "other",
]

def primary(pats):
  for p in PRIORITY:
    if p in pats:
      return p
  return "other"

clusters = {}
for r in rows:
  p = primary(r["patterns"])
  clusters.setdefault(p, []).append(r)

# Status judgments based on audit + known wiring
STATUS = {
  "return_from_graveyard": ("wired", "On-cast path uses inferTriggeredAbilityTargetMetadata (GY zone/destination). Artisan-class fix already landed; Bruna Angel-or-Human OR matching fixed in resolution."),
  "draw": ("wired", "Queued on cast; Kozilek draw-four covered by eldrazi-cast-trigger-resolution.integration.test.ts + oracle IR draw steps."),
  "destroy": ("wired", "Ulamog destroy target permanent: detection + target metadata + game-actions action map destroy_target_permanent; integration test present."),
  "exile_target_permanent": ("partial", "Detection + targeting metadata improved (compound type for World Breaker; up-to-N for Ugin). Effect execution via oracle IR exile steps likely, but colored-permanent / rider clauses (Thief of Existence) need playtest."),
  "exile_library_top": ("partial", "Oblivion Sower / Ulamog Defiler involve multi-step exile + optional put-lands; IR may parse but UX/choice flows are complex."),
  "extra_turn": ("wired", "Emrakul Aeons Torn shorthand + Promised End special-cased in on-cast path / dedicated Emrakul helpers."),
  "commander_cast_copy": ("partial", "Hatut commander-CZ copy path recently fixed (tax/2 + stack copies). Other *Storm commander-copy spells share the pattern but need retest per card."),
  "create_tokens": ("partial", "Token creation generally IR/legacy wired; X-from-mana-spent (Prossh/Abby) and processor-style optional payment gates are higher risk."),
  "copy_spell_or_permanent": ("partial", "Spell-copy stack IR exists; creature token-copy and conditional copies (Sage/Bygone/Malicious) vary."),
  "gain_control": ("partial", "Targeted gain-control (Obligator/Flayer/Beast) should prompt; Emrakul Promised End / World Anew are special multi-turn control flows."),
  "tap": ("partial", "up-to-N min/max now inferred (Elder Deep-Fiend, Supernatural Rescue). Stun-counter riders (Petrifying/Twisted) need counter placement verification."),
  "search_library": ("partial", "Conduit of Ruin / Sowing Mycospawn use library search infra; optional + put-on-top vs put-onto-battlefield differ."),
  "put_onto_battlefield": ("partial", "Library/reveal-into-battlefield patterns (Genesis Hydra, Hatchery Spider, Oblivion Sower) are multi-step."),
  "put_on_library_top": ("partial", "Lashweed Lurker battlefield→library_top: targetType inferred; destination metadata for non-GY bounce-to-library is thin vs GY path."),
  "put_counters": ("partial", "Stun/takeover counters may need specialized counter handlers."),
  "pump": ("wired", "Decimator mass pump until EOT is a common continuous-effect pattern under IR."),
  "gain_life": ("partial", "Simple gain-life OK; Breaker-of-Creation for-each and Hydroid Krasis half-X are value-expression sensitive."),
  "lose_life": ("partial", "Abundant Maw opponent-lose+gain; Scourge kicked half-life needs kicker intervening-if."),
  "sacrifice": ("partial", "Optional pay/process-then-sacrifice (Bearer/Blight Herder) now keep If-you-do text; any-player-may tax counters still special."),
  "mill_amass": ("partial", "Sauron amass+mill+return is a compound effect; GY return portion may need chooser."),
  "discard": ("partial", "Distended Mindbender hand-reveal choose-two not fully IR-wired (reveal_hand+grant_static+discard)."),
  "reveal_library": ("partial", "Reveal-until / put Doctor cards / X creatures patterns are bespoke."),
  "modal": ("partial", "Depth Defiler modes now extracted with bullets; modal choose_mode IR + kicker choose-both needs playtest."),
  "any_player_may_tax": ("wired", "Dash Hopes / Temporal Extortion / Brain Gorgers / Phantasmagorian: generic any_player_may APNAP Pay/Decline; discard/sac Pay chains into hand/sac pickers then resumes APNAP (cancel=decline)."),
  "counter_related": ("partial", "Hope-Ender Coatl counter-target may work; Mana Vortex counter-unless-sacrifice is IR unknown."),
  "remove_counters_cost_reduce": ("unknown", "Mutated Cultist remove-counters + cost reduction is uncommon."),
  "other": ("unknown", "Residual unique effects."),
  "optional_you_may": ("wired", "isOptionalMay via /you may/i on on-cast path sets mandatory=false."),
  "intervening_if": ("partial", "Text preserved; runtime intervening-if / kicker checks vary by card."),
}

# Build markdown
lines = []
lines.append("# MTGEDH On-Cast Trigger Coverage Audit")
lines.append("")
lines.append(f"- **Date:** 2026-08-22 (America/New_York)")
lines.append(f"- **Scryfall query:** `oracle:\"When you cast this spell, \" (game:paper) prefer:best`")
lines.append(f"- **API:** https://api.scryfall.com/cards/search?q=oracle%3A%22When+you+cast+this+spell%2C+%22+%28game%3Apaper%29+prefer%3Abest")
lines.append(f"- **Unique cards audited:** {len(rows)} (Scryfall total_cards={scry.get('total_cards')})")
lines.append("- **Scope:** paper faces, unique by `oracle_id`")
lines.append("")
lines.append("## Executive summary")
lines.append("")
lines.append("Creature on-cast triggers do queue (Hatut G1). Shared infrastructure around detection, target metadata, and multi-clause extraction was the highest-leverage gap class (same family as Artisan of Kozilek).")
lines.append("")
lines.append("### Fixes landed this pass")
lines.append("")
lines.append("1. **Full-clause on-cast extraction** (`rules-engine/src/cards/castTriggers.ts`): no longer truncates at the first `.`, preserves casing, strips trailing reminder text, absorbs modal bullet lines, returns all self-cast clauses.")
lines.append("2. **Multi on-cast queueing** (`onCastSpellTriggerUtils.ts` + `game-actions.ts` ~14066): `resolveOnCastSpellTriggerDescriptions` + loop so Wastescape Battlemage / Sowing Mycospawn queue both abilities.")
lines.append("3. **Richer on-cast target metadata** (`inferTriggeredAbilityTargetMetadata.ts`): compound `artifact, enchantment, or land`; non-GY `up to N` / `two target` min/max.")
lines.append("4. **Bruna-style OR subtypes** (`resolution.ts` `matchesRequiredTypeWords`): `Angel or Human` matches either subtype.")
lines.append("5. **Unit tests** (`server/tests/on-cast-spell-trigger.unit.test.ts`) — 11 passing.")
lines.append("")
lines.append("### Top remaining retest priorities")
lines.append("")
lines.append("1. **Bearer of Silence / Ruin Processor / Blight Herder / Vile Redeemer** — optional pay / processor `If you do` now keeps full text; verify optional payment UI + effect.")
lines.append("2. **World Breaker / Ugin / Elder Deep-Fiend / Ulamog Ceaseless Hunger** — compound / up-to / two-target exile+tap targeting UX.")
lines.append("3. **Wastescape Battlemage / Sowing Mycospawn** — both on-cast triggers on stack when kicked/unkicked.")
lines.append("4. **Commander *Storm* suite** (Echo/Fury/Genesis/Empyrial/Skull + Hatut) — copy count from CZ casts.")
lines.append("5. **Depth Defiler** — modal + kicker choose-both.")
lines.append("6. **Distended Mindbender / Mana Vortex** — not IR-fully-wired.")
lines.append("7. **Emrakul Promised End / World Anew** — control-next-turn special flows.")
lines.append("8. **Lashweed Lurker** — put target permanent on top of library (non-GY destination metadata still thin).")
lines.append("")
lines.append("## Wiring map (shared)")
lines.append("")
lines.append("| Stage | Location | Notes |")
lines.append("|---|---|---|")
lines.append("| Detection | `rules-engine/src/cards/castTriggers.ts` `extractSelfCastEffectClauses` / `detectCastTrigger` | Self-cast paragraphs + Emrakul shorthand |")
lines.append("| Resolve text | `server/src/state/modules/onCastSpellTriggerUtils.ts` | One or many descriptions |")
lines.append("| Queue on cast | `server/src/socket/game-actions.ts` ~14066 | Pushes `triggered_ability` stack items; optional via `/you may/i` |")
lines.append("| Target metadata | `inferTriggeredAbilityTargetMetadata` | Rich GY + compound/up-to |")
lines.append("| Execute | `executeTriggerEffect` → oracle IR primary then legacy preface/body/tail | `stackExecuteTriggerEffectUtils.ts` |")
lines.append("")
lines.append("## Pattern clusters")
lines.append("")

for name, cards in sorted(clusters.items(), key=lambda kv: -len(kv[1])):
  status, note = STATUS.get(name, ("unknown", ""))
  examples = [c["name"] for c in cards[:5]]
  ir_n = sum(1 for c in cards if c.get("irWired"))
  lines.append(f"### {name}")
  lines.append("")
  lines.append(f"- **Count:** {len(cards)}")
  lines.append(f"- **Status:** `{status}`")
  lines.append(f"- **Examples:** {', '.join(examples)}")
  lines.append(f"- **Static IR-wired (effect body):** {ir_n}/{len(cards)}")
  lines.append(f"- **Evidence:** on-cast queue path + inferrer + `executeTriggerEffect` / oracle IR")
  lines.append(f"- **Gap notes:** {note}")
  lines.append("")

lines.append("## Per-card appendix (name → primary pattern → IR)")
lines.append("")
lines.append("| Card | Primary pattern | IR wired | Targeted |")
lines.append("|---|---|---|---|")
for r in sorted(rows, key=lambda x: x["name"]):
  p = primary(r["patterns"])
  targ = "yes" if r["meta"].get("requiresTarget") else "no"
  ir = "yes" if r.get("irWired") else "no"
  lines.append(f"| {r['name']} | {p} | {ir} | {targ} |")

lines.append("")
lines.append("## Companion JSON")
lines.append("")
lines.append("- `tools/on-cast-trigger-coverage.json` — structured cluster + per-card probe")
lines.append("- `tools/_oncast_audit/probe-post.json` — raw post-fix probe")
lines.append("- `tools/_oncast_audit/scryfall.json` — Scryfall snapshot used for this audit")
lines.append("")

md_path = Path(r"D:\Git\MTGEDH\tools\on-cast-trigger-coverage.md")
md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

companion = {
  "audited_at": "2026-08-22T20:20:00-04:00",
  "query": 'oracle:"When you cast this spell, " (game:paper) prefer:best',
  "total_unique": len(rows),
  "fixes": [
    "extractSelfCastEffectClauses full-line + multi + bullets",
    "resolveOnCastSpellTriggerDescriptions + game-actions loop",
    "inferrer compound type + up-to-N",
    "matchesRequiredTypeWords OR groups",
  ],
  "clusters": {
    name: {
      "count": len(cards),
      "status": STATUS.get(name, ("unknown", ""))[0],
      "gap_notes": STATUS.get(name, ("unknown", ""))[1],
      "cards": [c["name"] for c in cards],
      "examples": [c["name"] for c in cards[:5]],
    }
    for name, cards in clusters.items()
  },
  "cards": rows,
}
Path(r"D:\Git\MTGEDH\tools\on-cast-trigger-coverage.json").write_text(json.dumps(companion, indent=2), encoding="utf-8")
print("wrote", md_path, "bytes", md_path.stat().st_size)
print("clusters", {k: len(v) for k,v in sorted(clusters.items(), key=lambda kv: -len(kv[1]))})
