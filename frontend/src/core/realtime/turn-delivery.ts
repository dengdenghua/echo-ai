// A peer's turn start is not a receipt for this user's queued input.
export function createTurnDeliveryWatch(clientItemId?: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return {
    delivered: false,
    clientItemId: clientItemId ?? `itm_user_${suffix}`,
  };
}

export function turnContainsUserItem(
  turn: unknown,
  clientItemId: string,
): boolean {
  if (typeof turn !== "object" || turn === null || !("items" in turn))
    return false;
  return (
    Array.isArray(turn.items) &&
    turn.items.some(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "userMessage" &&
        "id" in item &&
        item.id === clientItemId,
    )
  );
}
