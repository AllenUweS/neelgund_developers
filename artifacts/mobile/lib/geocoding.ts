/**
 * geocoding.ts  (updated — fetches Google Maps key from DB via getGoogleMapsKey())
 *
 * API docs: https://developers.google.com/maps/documentation/geocoding/requests-reverse-geocoding
 */

import { Platform } from "react-native";
import * as Linking from "expo-linking";
import { getGoogleMapsKey } from "@/lib/googleMapsKey";

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

// ── Platform-safe KV storage ─────────────────────────────────────────────────
const kv = {
  async get(k: string): Promise<string | null> {
    try {
      if (Platform.OS === "web") return localStorage.getItem(k);
      const { default: AS } = await import(
        "@react-native-async-storage/async-storage"
      );
      return AS.getItem(k);
    } catch {
      return null;
    }
  },
  async set(k: string, v: string): Promise<void> {
    try {
      if (Platform.OS === "web") {
        localStorage.setItem(k, v);
      } else {
        const { default: AS } = await import(
          "@react-native-async-storage/async-storage"
        );
        await AS.setItem(k, v);
      }
    } catch { }
  },
};

// ── Cache helpers ────────────────────────────────────────────────────────────
async function getCachedAddress(cacheKey: string): Promise<string | null> {
  try {
    const raw = await kv.get(`${CACHE_KEY}_${cacheKey}`);
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_DURATION) return null;
    return entry.address;
  } catch {
    return null;
  }
}

async function setCachedAddress(
  cacheKey: string,
  address: string
): Promise<void> {
  const entry: CacheEntry = { address, timestamp: Date.now() };
  await kv.set(`${CACHE_KEY}_${cacheKey}`, JSON.stringify(entry));
}

// ── Address parsing ──────────────────────────────────────────────────────────
type GoogleAddressComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

function extractLandmarkName(components: GoogleAddressComponent[]): string {
  const pick = (type: string) =>
    components.find((c) => c.types.includes(type))?.long_name ?? "";

  const locality = pick("locality") || pick("sublocality_level_1");
  const admin2 = pick("administrative_area_level_2");
  const admin1 = pick("administrative_area_level_1");

  if (locality && admin1) return `${locality}, ${admin1}`;
  if (admin2 && admin1) return `${admin2}, ${admin1}`;
  if (admin1) return admin1;
  return "";
}

function parseGoogleAddress(formatted: string): GeocodingResult {
  const parts = formatted.split(",").map((p) => p.trim());
  return {
    address: formatted,
    city: parts[1] ?? undefined,
    state: parts[2] ?? undefined,
    country: parts[parts.length - 1] ?? undefined,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────
/**
 * Reverse-geocodes a lat/lng pair using the Google Geocoding API.
 * Results are cached for 24 hours.
 *
 * FIX: No longer filters by result_type, so works for all Indian coordinates.
 */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<GeocodingResult | null> {
  const key = await getGoogleMapsKey();
  if (!key) return null;

  try {
    const cacheKey = `${lat.toFixed(6)}_${lng.toFixed(6)}`;
    const cached = await getCachedAddress(cacheKey);
    if (cached) return parseGoogleAddress(cached);

    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${lat},${lng}` +
      `&key=${key}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Geocoding request failed");

    const data = await response.json();
    if (data.status !== "OK" || !data.results?.length) return null;

    const best = data.results[0];
    const components: GoogleAddressComponent[] =
      best.address_components ?? [];
    const label =
      extractLandmarkName(components) || best.formatted_address || "";

    await setCachedAddress(cacheKey, label);
    return parseGoogleAddress(label);
  } catch (err) {
    console.warn("[Geocoding] Error:", err);
    return null;
  }
}

/**
 * Forward-geocodes a text query using the Google Geocoding API.
 */
export async function forwardGeocode(
  query: string
): Promise<{ lat: number; lng: number; address: string } | null> {
  const key = await getGoogleMapsKey();
  if (!key) return null;

  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(query)}` +
      `&key=${key}`;

    const response = await fetch(url);
    if (!response.ok) throw new Error("Forward geocoding request failed");

    const data = await response.json();
    if (data.status !== "OK" || !data.results?.length) return null;

    const result = data.results[0];
    const { lat, lng } = result.geometry.location;
    return { lat, lng, address: result.formatted_address };
  } catch (err) {
    console.warn("[Geocoding] Forward error:", err);
    return null;
  }
}

/**
 * Opens the native maps app with directions to a given lat/lng.
 */
export function openInMaps(lat: number, lng: number, label?: string): void {
  const encoded = encodeURIComponent(label ?? `${lat},${lng}`);
  const url =
    Platform.OS === "ios"
      ? `maps://?q=${encoded}&ll=${lat},${lng}`
      : `geo:${lat},${lng}?q=${encoded}`;
  Linking.openURL(url).catch(() => {
    Linking.openURL(
      `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
    );
  });
}

export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function openInGoogleMaps(lat: number, lng: number, label?: string): void {
  openInMaps(lat, lng, label);
}

export async function getNearestLandmark(lat: number, lng: number): Promise<string> {
  const result = await reverseGeocode(lat, lng);
  return result?.address || formatCoordinates(lat, lng);
}