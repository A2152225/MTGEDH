# Oracle Automation Batch Blockers

Items deferred during the current `oracle-automation-next-10000` pass so the ordered queue can keep moving.

## Deferred Seams

- `Abyssal Harvester` (item 68 in graveyard exile slice): `that was put there this turn` graveyard qualifier needs explicit legality tracking.
- `Wizard's Spellbook` (item 87 in graveyard exile slice): same activation continues into d20-driven cast/copy handling from the exiled card.
- `Armored Scrapgorger` (item 71 in graveyard exile slice): combined `exile ... and put an oil counter on this creature` needs deterministic follow-up counter support in the same clause.
- `Ardyn, the Usurper` (item 72 in graveyard exile slice): beginning-of-combat exile is linked to immediate token-copy creation from the exiled creature card.
- `Klothys, God of Destiny` (item 73 in graveyard exile slice): same trigger branches into mana or life-plus-damage outcomes based on the exiled card's type.
- `Intrepid Paleontologist` (item 75 in graveyard exile slice): activated exile must retain `cards exiled with this creature` provenance for later cast permission and finality support.
- `Emperor of Bones` (item 76 in graveyard exile slice): beginning-of-combat exile must retain `cards exiled with this creature` linkage for later reanimation.
- `Dino DNA` (item 77 in graveyard exile slice): imprint exile must retain artifact-linked exiled-card state for later token-copy creation.
- `The Animus` (item 85 in graveyard exile slice): `with a memory counter on it` qualifier needs explicit counter-qualified graveyard targeting.
- `Psionic Ritual` (item 91 in graveyard exile slice): `exile ... and copy it` needs deterministic post-exile spell-copy support.
- `Keen-Eyed Curator` (item 93 in graveyard exile slice): same activation has a conditional `+1/+1 counter` rider keyed off the exiled card.
- `Summoner's Sending` (item 94 in graveyard exile slice): optional end-step exile is bundled with token creation plus a mana-value counter rider.
- `Misfortune Teller` (item 95 in graveyard exile slice): same trigger branches into token / Treasure / life outcomes based on the exiled card's type.
- `Selesnya Eulogist` (item 96 in graveyard exile slice): `exile ... then populate` needs the follow-up populate token path in the same ordered effect.
- `Urborg Scavengers` (item 101 in graveyard exile slice): same trigger adds a counter and ability-sharing state tied to the exiled card.
- `Dimir Doppelganger` (item 103 in graveyard exile slice): exile is followed by copy-into-self transformation tied to the exiled creature card.
- `Lazav, Wearer of Faces` (item 106 in graveyard exile slice): `exile ... then investigate` needs the ordered investigate follow-up.
- `Lara Croft, Tomb Raider` (item 109 in graveyard exile slice): `put a discovery counter on it` needs exiled-card counter/support metadata after the exile step.
- `Mastermind Plum` (item 79 in graveyard exile slice): same attack trigger branches into Treasure creation based on the exiled card's type.
- `Immersturm Predator` (item 80 in graveyard exile slice): combined `exile ... and put a +1/+1 counter on this creature` needs ordered same-trigger counter support.
- `Boiling Rock Rioter` (item 110 in graveyard exile slice): activated exile must retain `cards you own exiled with this creature` linkage for the later cast-from-exile ability.
- `Corpse Appraiser` (item 129 in graveyard exile slice): same ETB uses `If a card is put into exile this way` to gate a library look / hand selection follow-up.
- `Conversion Chamber` (item 140 in graveyard exile slice): exile is bundled with a same-ability charge-counter rider that fuels a later token ability.
- `Mourner's Shield` (item 146 in graveyard exile slice): imprint exile must retain the exiled card's characteristics for later prevention text.
- `Mirror Golem` (item 149 in graveyard exile slice): imprint exile must retain the exiled card's types for later protection-setting logic.
- `Vincent's Limit Break` (item 262 in dies-return-to-battlefield slice): grants a temporary dies trigger that returns the creature while also setting chosen base power/toughness.
- `Bronzehide Lion` (item 264 in dies-return-to-battlefield slice): dies trigger returns the card transformed into an Aura with new text.
- `Missy` (item 265 in dies-return-to-battlefield slice): dies trigger returns the creature face down, tapped, and with modified characteristics.
- `Ashcloud Phoenix` (item 269 in dies-return-to-battlefield slice): dies trigger returns the card face down under your control.
- `Yarus, Roar of the Old Gods` (item 270 in dies-return-to-battlefield slice): dies trigger returns a face-down permanent card face down, then turns it face up.
- `Scythe of the Wretched` (item 272 in dies-return-to-battlefield slice): tracks creatures dealt damage by the equipped creature this turn, then returns them under your control on death.
- `Presumed Dead` (item 273 in dies-return-to-battlefield slice): grants a temporary dies trigger that returns the creature and suspects it.
- `Perigee Beckoner` (item 274 in dies-return-to-battlefield slice): ETB grants another creature a temporary dies trigger that returns it tapped.
- `Shade's Form` (item 276 in dies-return-to-battlefield slice): dies return is now covered, but the card still has additional activated-text parsing residue on the granted pump ability.
- `Dread Slaver` (item 279 in dies-return-to-battlefield slice): tracks creatures dealt damage by this creature this turn, then returns them under your control on death.
- `Soul Collector` (item 281 in dies-return-to-battlefield slice): tracks creatures dealt damage by this creature this turn, then returns them under your control on death.
- `Molten Firebird` (item 283 in dies-return-to-battlefield slice): dies trigger schedules return at the next end step and also skips your next draw step.
- `Athreos, God of Passage` (item 287 in dies-return-to-hand slice): now parses as an explicit `unless target opponent pays 3 life` gate and auto-returns only when that opponent cannot pay; the remaining blocker is real opponent payment-choice resolution when they can.
- `Sequence Engine` (item 131 in graveyard exile slice): same activated ability ties exile to X-sized token creation plus X counters.
- `The Spot, Living Portal` (item 132 in graveyard exile slice): linked exile set needs later return-to-hand support when the source dies.
- `Morbid Bloom` (item 135 in graveyard exile slice): follow-up token count depends on the exiled creature's toughness.
- `Headstone` (item 153 in graveyard exile slice): exile is bundled with a delayed next-upkeep draw trigger.
- `Grixis Sojourners` (item 155 in graveyard exile slice): optional dual-trigger exile is not a clean deterministic lock in the default regression harness.
- `Selfless Exorcist` (item 160 in graveyard exile slice): same activation uses the exiled card's power to deal damage back to the source creature.
- `Color Pie` (item 162 in graveyard exile slice): silver-border multi-effect joke card remains intentionally out of the deterministic pass.
- `The Many Deeds of Belzenlok` (item 163 in graveyard exile slice): exile is tied to copying a targeted Saga chapter ability from the exiled card.
