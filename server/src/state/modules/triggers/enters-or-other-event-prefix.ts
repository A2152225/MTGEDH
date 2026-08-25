/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: compound "enters or <event>" prefix used by leftover detectors
 * Public: ENTERS_OR_OTHER_EVENT_PREFIX
 */

/** Optional "enters or" before the non-ETB event in compound templates. */
export const ENTERS_OR_OTHER_EVENT_PREFIX = '(?:enters(?: the battlefield)?\\s+or\\s+)?';
