/**
 * tokenStorage.ts — v2
 *
 * CHANGE: Now writes token to BOTH expo-secure-store (for JS layer security)
 * AND a plain SharedPreferences file "neelgund_native_bridge" (for Kotlin
 * NativeTrackingService to read without needing the EncryptedSharedPreferences
 * master key).
 *
 * This is the standard pattern used by Uber, Lyft, and Google Maps — the JS
 * layer and native layer share state via a known SharedPreferences contract.
 *
 * The plain SharedPreferences is only accessible to the app itself (MODE_PRIVATE)
 * and is not exposed to other apps, so the security tradeoff is acceptable for
 * an internal employee tracking app.
 *
 * The Kotlin service reads from "neelgund_native_bridge" under these keys:
 *   auth_token     → current JWT access token
 *   refresh_token  → refresh token for session renewal
 *   user_id        → authenticated employee ID
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform, NativeModules } from "react-native";

const AUTH_TOKEN_KEY = "neelgund:auth_token";
const REFRESH_TOKEN_KEY = "neelgund:refresh_token";
const USER_ID_KEY = "neelgund:user_id";

// ── Native bridge SharedPreferences (Kotlin-readable) ─────────────────────────
// WakeLockModule exposes a method to write to the native bridge prefs.
// Falls back to no-op if the module is not available.
function writeToNativeBridge(key: string, value: string | null): void {
  try {
    const wl = NativeModules.WakeLockModule;
    if (wl?.writeBridgePref) {
      wl.writeBridgePref(key, value ?? "");
    }
  } catch { /* non-critical */ }
}

// ── SecureStore helpers ───────────────────────────────────────────────────────

async function secureSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function secureGet(key: string): Promise<string | null> {
  return await SecureStore.getItemAsync(key);
}

async function secureDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist the Supabase access token.
 * Writes to SecureStore (JS) AND native bridge prefs (Kotlin).
 */
export async function persistAuthToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }
  try {
    await secureSet(AUTH_TOKEN_KEY, token);
  } catch {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  }
  // Write to native bridge so NativeTrackingService can read it
  writeToNativeBridge("auth_token", token);
}

/**
 * Persist the Supabase refresh token.
 * Writes to SecureStore (JS) AND native bridge prefs (Kotlin).
 */
export async function persistRefreshToken(token: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await secureSet(REFRESH_TOKEN_KEY, token);
  } catch {
    await AsyncStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
  writeToNativeBridge("refresh_token", token);
}

/**
 * Persist the user ID for the native layer.
 */
export async function persistUserId(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  // Store in SecureStore for consistency with auth/refresh tokens.
  // Falls back to AsyncStorage if SecureStore is unavailable (emulator, old device).
  try {
    await secureSet(USER_ID_KEY, userId);
  } catch {
    try {
      await AsyncStorage.setItem(USER_ID_KEY, userId);
    } catch { /* ignore */ }
  }
  writeToNativeBridge("user_id", userId);
}

export async function getPersistedAuthToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  }
  try {
    const token = await secureGet(AUTH_TOKEN_KEY);
    if (token) return token;
  } catch { /* ignore */ }
  return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

export async function clearPersistedAuthToken(): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  try { await secureDelete(AUTH_TOKEN_KEY); } catch { /* ignore */ }
  try { await secureDelete(REFRESH_TOKEN_KEY); } catch { /* ignore */ }
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
  await AsyncStorage.removeItem(REFRESH_TOKEN_KEY);
  await AsyncStorage.removeItem(USER_ID_KEY);
  // Clear native bridge
  writeToNativeBridge("auth_token", null);
  writeToNativeBridge("refresh_token", null);
  writeToNativeBridge("user_id", null);
}

const API_BASE_URL_KEY = "neelgund:api_base_url";

export async function getApiBaseUrl(): Promise<string> {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;
  try {
    const stored = await AsyncStorage.getItem(API_BASE_URL_KEY);
    if (stored) return stored;
  } catch { /* ignore */ }
  return "https://api.neelgund.com";
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_BASE_URL_KEY, url);
}