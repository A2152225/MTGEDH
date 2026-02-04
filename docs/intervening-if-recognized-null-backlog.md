# Intervening-if recognized-null backlog

- Generated: 2026-02-04T00:51:16.506Z
- Source: server/scripts/out/intervening-if-audit.json
- Recognized-null clause strings: 17

Each item below is a distinct intervening-if clause string that the evaluator recognizes but returns `null` for under the audit probe context.
In real gameplay, many become decidable once event refs/stack metadata are plumbed into `isInterveningIfSatisfied()` calls.

- [ ] (5) [misc] if mana from a Treasure was spent to cast it — e.g. Alchemist's Talent, Hired Hexblade, Jaded Sell-Sword, Marut, Mastermind Plum
- [ ] (2) [misc] if {B}{B} was spent to cast it — e.g. Deceit, Emptiness
- [ ] (2) [misc] if {R} was spent to cast it — e.g. Gruul Scrapper, Steamcore Weird
- [ ] (2) [misc] if {R}{R} was spent to cast it — e.g. Catharsis, Vibrance
- [ ] (2) [misc] if {U}{U} was spent to cast it — e.g. Deceit, Wistfulness
- [ ] (2) [misc] if {W}{W} was spent to cast it — e.g. Catharsis, Emptiness
- [ ] (2) [misc] if that spell was kicked — e.g. Bloodstone Goblin, Hallar, the Firefletcher
- [ ] (1) [misc] if {B} was spent to cast it — e.g. Shrieking Grotesque
- [ ] (1) [misc] if {C} was spent to cast it — e.g. Drowner of Truth // Drowned Jungle
- [ ] (1) [misc] if {C} wasn't spent to cast it — e.g. Wumpus Aberration
- [ ] (1) [misc] if {U} was spent to cast it — e.g. Ogre Savant
- [ ] (1) [misc] if {W} was spent to cast it — e.g. Revenant Patriarch
- [ ] (1) [misc] if it was kicked twice — e.g. Archangel of Wrath
- [ ] (1) [misc] if its additional cost was paid — e.g. Graven Archfiend
- [ ] (1) [misc] if mana from a Treasure was spent to cast it or activate it — e.g. Vazi, Keen Negotiator
- [ ] (1) [misc] if three or more mana from creatures was spent to cast it — e.g. Inga and Esika
- [ ] (1) [misc] if you attacked with exactly one other creature this combat — e.g. Creepy Puppeteer