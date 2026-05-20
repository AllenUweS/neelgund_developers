/**
 * Google Maps API key — replaces mapboxToken.ts
 *
 * Place in mobile/.env:
 *   EXPO_PUBLIC_GOOGLE_MAPS_KEY=AIzaSyB-SSGBVdho1IR5zhNUP2Dc5hPfrnnCdHw
 */
export const GOOGLE_MAPS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "";

if (!GOOGLE_MAPS_KEY) {
  console.error(
    "[GoogleMaps] EXPO_PUBLIC_GOOGLE_MAPS_KEY is missing — maps will not load"
  );
}
