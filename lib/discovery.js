export const MIN_RELEASE_DATE = '1990-01-01';

export function getTodayIsoDate(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function normalizeDateRange(yearGte, yearLte, today = getTodayIsoDate()) {
  const lower = yearGte > MIN_RELEASE_DATE ? yearGte : MIN_RELEASE_DATE;
  const upper = yearLte < today ? yearLte : today;

  if (lower > upper) {
    // Conflicting answer choices should broaden to a useful supported range,
    // rather than sending TMDB an impossible lower/upper pair.
    return { gte: MIN_RELEASE_DATE, lte: today };
  }
  return { gte: lower, lte: upper };
}

export function broadenFilters(filters, today = getTodayIsoDate()) {
  const fallback = { ...filters };
  delete fallback.with_genres;
  fallback['primary_release_date.gte'] = MIN_RELEASE_DATE;
  fallback['primary_release_date.lte'] = today;
  fallback['vote_average.gte'] = 5.5;
  fallback['vote_count.gte'] = 100;
  fallback.page = 1;
  return fallback;
}
