export function applyTriggerOrderToStack(state: any, orderedTriggerIds: string[]): number {
  const stack = Array.isArray(state?.stack) ? state.stack : [];

  const itemsById = new Map<string, any>();
  const indices: number[] = [];

  for (const rawTriggerId of orderedTriggerIds) {
    const triggerId = String(rawTriggerId || '').trim();
    if (!triggerId) continue;

    const index = stack.findIndex((item: any) => item?.id === triggerId || item?.triggerId === triggerId);
    if (index === -1) continue;

    indices.push(index);
    itemsById.set(triggerId, stack[index]);
  }

  if (indices.length === 0) {
    return 0;
  }

  const targetIndices = indices.slice().sort((left, right) => left - right);
  const placementOrder = orderedTriggerIds
    .map((id) => itemsById.get(String(id || '').trim()))
    .filter(Boolean)
    .reverse();

  const count = Math.min(targetIndices.length, placementOrder.length);
  for (let index = 0; index < count; index++) {
    stack[targetIndices[index]] = placementOrder[index];
  }

  return count;
}