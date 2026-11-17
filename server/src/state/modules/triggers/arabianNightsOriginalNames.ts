/**
 * Card names whose first printing is Arabian Nights (ARN).
 * "Originally printed in the Arabian Nights expansion" follows the first printing,
 * so a later reprint still counts and a basic land that merely appeared in ARN does not.
 * Origin: City in a Bottle state trigger. Public: nameFirstPrintedInArabianNights.
 */
const NAMES = [
  "Abu Ja'far", 'Aladdin', "Aladdin's Lamp", "Aladdin's Ring", 'Ali Baba', 'Ali from Cairo',
  'Army of Allah', 'Bazaar of Baghdad', 'Bird Maiden', 'Bottle of Suleiman', 'Brass Man', 'Camel',
  'City in a Bottle', 'City of Brass', 'Cuombajj Witches', 'Cyclone', 'Dancing Scimitar', 'Dandân',
  'Desert', 'Desert Nomads', 'Desert Twister', 'Diamond Valley', 'Drop of Honey', 'Ebony Horse',
  'El-Hajjâj', 'Elephant Graveyard', 'Erg Raiders', 'Erhnam Djinn', 'Eye for an Eye', 'Fishliver Oil',
  'Flying Carpet', 'Flying Men', 'Ghazbán Ogre', 'Giant Tortoise', 'Guardian Beast', 'Hasran Ogress',
  'Hurr Jackal', 'Ifh-Bíff Efreet', 'Island Fish Jasconius', 'Island of Wak-Wak', "Jandor's Ring",
  "Jandor's Saddlebags", 'Jeweled Bird', 'Jihad', 'Junún Efreet', 'Juzám Djinn', 'Khabál Ghoul',
  'King Suleiman', 'Kird Ape', 'Library of Alexandria', 'Magnetic Mountain', 'Merchant Ship',
  'Metamorphosis', 'Mijae Djinn', 'Moorish Cavalry', 'Nafs Asp', 'Oasis', 'Old Man of the Sea',
  'Oubliette', 'Piety', 'Pyramids', 'Repentant Blacksmith', "Ring of Ma'rûf", 'Rukh Egg',
  'Sandals of Abdallah', 'Sandstorm', 'Serendib Djinn', 'Serendib Efreet', 'Shahrazad', 'Sindbad',
  'Singing Tree', 'Sorceress Queen', 'Stone-Throwing Devils', 'Unstable Mutation', 'War Elephant',
  'Wyluli Wolf', 'Ydwen Efreet',
];

const BY_NAME = new Set(NAMES.map((name) => name.toLowerCase()));

export function nameFirstPrintedInArabianNights(name: string): boolean {
  return BY_NAME.has(String(name || '').trim().toLowerCase());
}
