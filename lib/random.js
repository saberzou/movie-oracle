export function shuffle(items, random = Math.random) {
  const result = Array.from(items);
  for (let i = result.length - 1; i > 0; i -= 1) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('random() must return a number in [0, 1).');
    }
    const j = Math.floor(value * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
