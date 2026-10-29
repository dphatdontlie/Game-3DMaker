const owned = new WeakSet<object>();
export function own<T extends object>(value: T): T {
  owned.add(value);
  return value;
}
export function isOwned(value: object) {
  return owned.has(value);
}
