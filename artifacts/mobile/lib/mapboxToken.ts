export const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

if (!MAPBOX_ACCESS_TOKEN) {
  console.error("[Mapbox] EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN is missing — maps will not load");
}
