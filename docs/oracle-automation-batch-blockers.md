# Oracle Automation Batch Blockers

Items deferred during the current `oracle-automation-next-10000` pass so the ordered queue can keep moving.

## Deferred Seams

- `Abyssal Harvester` (item 68 in graveyard exile slice): `that was put there this turn` graveyard qualifier needs explicit legality tracking.
- `Wizard's Spellbook` (item 87 in graveyard exile slice): same activation continues into d20-driven cast/copy handling from the exiled card.
- `Urborg Scavengers` (item 101 in graveyard exile slice): same trigger adds a counter and ability-sharing state tied to the exiled card.
- `Vincent's Limit Break` (item 262 in dies-return-to-battlefield slice): grants a temporary dies trigger that returns the creature while also setting chosen base power/toughness.
- `Bronzehide Lion` (item 264 in dies-return-to-battlefield slice): dies trigger returns the card transformed into an Aura with new text.
- `Grixis Sojourners` (item 155 in graveyard exile slice): optional dual-trigger exile is not a clean deterministic lock in the default regression harness.
- `Color Pie` (item 162 in graveyard exile slice): silver-border multi-effect joke card remains intentionally out of the deterministic pass.
- `The Many Deeds of Belzenlok` (item 163 in graveyard exile slice): exile is tied to copying a targeted Saga chapter ability from the exiled card.
