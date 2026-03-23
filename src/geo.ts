import type Database from "better-sqlite3";
import { getAllFranchiseLocations, type FranchiseLocationRow } from "./db.js";

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

export function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

export function findNearestFranchise(
  franchises: FranchiseLocationRow[],
  lat: number,
  lng: number
): FranchiseLocationRow | null {
  let nearest: FranchiseLocationRow | null = null;
  let minDist = Infinity;

  for (const f of franchises) {
    if (f.lat === null || f.lng === null) continue;
    const dist = haversineDistanceMiles(lat, lng, f.lat, f.lng);
    if (dist < minDist) {
      minDist = dist;
      nearest = f;
    }
  }

  return nearest;
}

const STATE_ABBR_MAP: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS",
  missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
};

const STATE_ABBRS = new Set(Object.values(STATE_ABBR_MAP));

export type ExtractedCityState = {
  city: string;
  stateAbbr: string;
};

/**
 * Extracts city and state from location text like:
 * - "Golden Spike Event Center, Ogden, UT"
 * - "123 Main St, Pomona, CA 91766"
 * - "Diamond Bar Center, Diamond Bar, California"
 */
export function extractCityFromLocation(locationText: string): ExtractedCityState | null {
  if (!locationText) return null;

  const parts = locationText.split(",").map((p) => p.trim());
  if (parts.length < 2) return null;

  for (let i = parts.length - 1; i >= 1; i--) {
    const candidate = parts[i];

    const abbrMatch = candidate.match(/^([A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
    if (abbrMatch) {
      const abbr = abbrMatch[1].toUpperCase();
      if (STATE_ABBRS.has(abbr)) {
        const city = parts[i - 1].trim();
        if (city) return { city, stateAbbr: abbr };
      }
    }

    const fullStateName = candidate.replace(/\s+\d{5}(?:-\d{4})?$/, "").trim().toLowerCase();
    const mappedAbbr = STATE_ABBR_MAP[fullStateName];
    if (mappedAbbr) {
      const city = parts[i - 1].trim();
      if (city) return { city, stateAbbr: mappedAbbr };
    }
  }

  return null;
}

export type NearbyCity = {
  city: string;
  stateInitials: string;
  distanceMiles: number;
};

export function getNearbyCities(
  db: Database.Database,
  lat: number,
  lng: number,
  radiusMiles: number
): NearbyCity[] {
  const allFranchises = getAllFranchiseLocations(db);

  const cityMap = new Map<string, NearbyCity>();

  for (const f of allFranchises) {
    if (f.lat === null || f.lng === null) continue;
    const dist = haversineDistanceMiles(lat, lng, f.lat, f.lng);
    if (dist > radiusMiles) continue;

    const key = `${f.city.toLowerCase()}|${f.state_initials.toLowerCase()}`;
    const existing = cityMap.get(key);
    if (!existing || dist < existing.distanceMiles) {
      cityMap.set(key, {
        city: f.city.trim(),
        stateInitials: f.state_initials,
        distanceMiles: Math.round(dist * 10) / 10,
      });
    }
  }

  return [...cityMap.values()].sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export function getFranchisesWithinRadius(
  db: Database.Database,
  lat: number,
  lng: number,
  radiusMiles: number
): FranchiseLocationRow[] {
  const allFranchises = getAllFranchiseLocations(db);
  return allFranchises.filter((f) => {
    if (f.lat === null || f.lng === null) return false;
    return haversineDistanceMiles(lat, lng, f.lat, f.lng) <= radiusMiles;
  });
}
