// server/src/state/modules/layer4TypeSettingAnimation.ts
// Extra layer 4 type-setting specs (CR 613.1d) consumed by layer4TypeSetting's SPECS:
//   "All lands are 2/2 creatures that are still lands." (Nature's Revolt, Living Plane)
//   "As long as enchanted permanent is a Vehicle, it's a creature in addition to its other types." (Aerial Modification)
// Public entry symbols: LAYER4_ANIMATION_SPECS.

function typeLineOf(perm: any): string {
  return String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
}

export const LAYER4_ANIMATION_SPECS: Array<{ re: RegExp; build: (source: any) => any }> = [
  {
    re: /\ball lands are (\d+)\/(\d+) creatures that are still lands\b/i,
    build: (source) => {
      const m = String(source?.card?.oracle_text || source?.oracle_text || '').match(/\ball lands are (\d+)\/(\d+) creatures/i);
      const power = Number(m?.[1] || 0);
      const toughness = Number(m?.[2] || 0);
      return {
        addTypes: ['Creature'],
        basePT: () => ({ power, toughness }),
        appliesTo: (perm: any) => /\bland\b/.test(typeLineOf(perm)),
      };
    },
  },
  {
    re: /\bas long as (?:enchanted|equipped) permanent is an? ([a-z]+), it's a creature in addition to its other types\b/i,
    build: (source) => {
      const m = String(source?.card?.oracle_text || source?.oracle_text || '').replace(/\u2019/g, "'")
        .match(/as long as (?:enchanted|equipped) permanent is an? ([a-z]+), it's a creature/i);
      const sub = new RegExp('\\b' + String(m?.[1] || 'vehicle').toLowerCase() + '\\b');
      const hostId = String(source?.attachedTo || '');
      return {
        addTypes: ['Creature'],
        appliesTo: (perm: any) => !!hostId && String(perm?.id || '') === hostId && sub.test(typeLineOf(perm)),
      };
    },
  },
];
