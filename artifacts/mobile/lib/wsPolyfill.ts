/**
 * lib/wsPolyfill.ts
 *
 * Supabase-js v2.46+ grabs a WebSocket the moment createClient() is called.
 * With Expo's "output: static" web mode, every route is pre-rendered in
 * Node.js 20 (no native WebSocket) before it reaches the browser.
 *
 * This file polyfills global.WebSocket with the "ws" package when:
 *   - We are running in Node.js (typeof window === "undefined"), AND
 *   - global.WebSocket is not already defined
 *
 * It is a no-op in the browser (window exists, WebSocket exists) and on
 * Android/iOS (React Native provides WebSocket natively, this file is never
 * imported there because supabase.ts only imports it on web).
 */

// if (typeof window === "undefined" && typeof global.WebSocket === "undefined") {
//   // eslint-disable-next-line @typescript-eslint/no-var-requires
//   const ws = require("ws");
//   // supabase-js checks `global.WebSocket` — assign the ws constructor there
//   (global as typeof globalThis & { WebSocket: unknown }).WebSocket = ws.WebSocket ?? ws;
// }

/**
 * lib/wsPolyfill.ts
 *
 * This file is intentionally empty.
 *
 * The Node "ws" package import has been removed. React Native (Android/iOS)
 * provides a native global WebSocket — no polyfill is needed or safe here,
 * because Metro cannot bundle Node core modules like "stream".
 *
 * For web SSR, supabase-js handles WebSocket gracefully without this file.
 */
