/**
 * geocoding.ts  (updated — uses Google Geocoding API)
 * Replaces the old OpenStreetMap Nominatim implementation.
 *
 * API docs: https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Linking from "expo-linking";
import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

export type GeocodingResult = {
  address: string;
  city?: string;
  state?: string;
  country?: string;
};

const CACHE_KEY = "geocoding_cache_google";
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

type CacheEntry = {
  address: string;
  timestamp: number;
};

/**
 * Reverse-geocode a lat/lng coordinate into a human-readable address
 * using the Google Geocoding API. Results are cached for 24 hours.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodingResult | null> {
  if (!GOOGLE_MAPS_KEY) return null;

  try {
    const cacheKey = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
    const cached = await getCachedAddress(cacheKey);
    if (cached) return parseGoogleAddress(cached);

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}&result_type=street_address|locality` +
      `&key=${GOOGLE_MAPS_KEY}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Geocoding request failed");

    const data = await response.json();

    if (data.status !== "OK" || !data.results?.length) return null;

    // Use the most detailed result
    const best = data.results[0];
    const address: string =
      best.formatted_address ?? `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    // Extract components
    let city: string | undefined;
    let state: string | undefined;
    let country: string | undefined;

    for (const comp of best.address_components ?? []) {
      if (comp.types.includes("locality")) city = comp.long_name;
      if (comp.types.includes("administrative_area_level_1"))
        state = comp.long_name;
      if (comp.types.includes("country")) country = comp.long_name;
    }

    await cacheAddress(cacheKey, address);

    return { address, city, state, country };
  } catch (error) {
    console.error("Reverse geocoding error:", error);
    return null;
  }
}

function parseGoogleAddress(address: string): GeocodingResult {
  // Simple heuristic split on commas when used from cache
  const parts = address.split(",").map((p) => p.trim());
  return {
    address,
    city: parts[parts.length - 3] || undefined,
    state: parts[parts.length - 2] || undefined,
    country: parts[parts.length - 1] || undefined,
  };
}

async function getCachedAddress(key: string): Promise<string | null> {
  try {
    const cacheJson = await AsyncStorage.getItem(CACHE_KEY);
    if (!cacheJson) return null;
    const cache: Record<string, CacheEntry> = JSON.parse(cacheJson);
    const entry = cache[key];
    if (!entry) return null;
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      delete cache[key];
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      return null;
    }
    return entry.address;
  } catch {
    return null;
  }
}

async function cacheAddress(key: string, address: string): Promise<void> {
  try {
    const cacheJson = await AsyncStorage.getItem(CACHE_KEY);
    const cache: Record<string, CacheEntry> = cacheJson
      ? JSON.parse(cacheJson)
      : {};
    cache[key] = { address, timestamp: Date.now() };

    // Trim cache to 100 entries (oldest first)
    const keys = Object.keys(cache);
    if (keys.length > 100) {
      const sorted = keys.sort(
        (a, b) => cache[a].timestamp - cache[b].timestamp
      );
      for (let i = 0; i < 10; i++) delete cache[sorted[i]];
    }

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error("Cache error:", error);
  }
}

/** Open a lat/lng in Google Maps (web or native) */
export function openInGoogleMaps(lat: number, lng: number): void {
  const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  if (typeof window !== "undefined") {
    window.open(url, "_blank");
  } else {
    Linking.openURL(url);
  }
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}
