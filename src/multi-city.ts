import type { AgentConfig } from "./types.js";
import { runIncrementalPipeline } from "./pipeline.js";

type CityRunSummary = {
  city: string;
  success: boolean;
  eventCount: number;
  error?: string;
};

function normalizeCities(cities: string[]) {
  return [...new Set(cities.map((city) => city.trim()).filter(Boolean))];
}

export async function runMultiCityPipeline(
  baseConfig: AgentConfig,
  cities: string[],
  concurrency: number
) {
  const normalizedCities = normalizeCities(cities);
  if (normalizedCities.length === 0) {
    return [];
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, normalizedCities.length));
  const summaries: CityRunSummary[] = Array.from(
    { length: normalizedCities.length },
    () => ({ city: "", success: false, eventCount: 0 })
  );
  let nextIndex = 0;

  console.log(
    `\nRunning ${normalizedCities.length} cities with concurrency=${safeConcurrency}...`
  );

  const workers = Array.from({ length: safeConcurrency }, () =>
    (async () => {
      while (nextIndex < normalizedCities.length) {
        const index = nextIndex;
        nextIndex += 1;

        const city = normalizedCities[index];
        summaries[index] = { city, success: false, eventCount: 0 };

        console.log(`\n=== City ${index + 1}/${normalizedCities.length}: ${city} ===`);
        try {
          const events = await runIncrementalPipeline({ ...baseConfig, searchLocation: city, searchArea: city });
          summaries[index] = {
            city,
            success: true,
            eventCount: events.length,
          };
        } catch (err) {
          summaries[index] = {
            city,
            success: false,
            eventCount: 0,
            error: err instanceof Error ? err.message : String(err),
          };
          console.warn(`City failed (${city}): ${summaries[index].error}`);
        }
      }
    })()
  );

  await Promise.all(workers);
  return summaries;
}
