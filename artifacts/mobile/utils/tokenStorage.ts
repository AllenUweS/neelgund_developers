import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const AUTH_TOKEN_KEY = "neelgund:auth_token";

async function secureStoreSet(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function secureStoreGet(key: string): Promise<string | null> {
  return await SecureStore.getItemAsync(key);
}

async function secureStoreDelete(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

/**
 * Persist the Supabase access token for background tasks.
 * Uses expo-secure-store on native, AsyncStorage as fallback.
 */
export async function persistAuthToken(token: string): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }
  try {
    await secureStoreSet(AUTH_TOKEN_KEY, token);
  } catch {
    // Fallback to AsyncStorage if SecureStore fails
    await AsyncStorage.setItem(AUTH_TOKEN_KEY, token);
  }
}

/**
 * Read the persisted auth token.
 */
export async function getPersistedAuthToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  }
  try {
    const token = await secureStoreGet(AUTH_TOKEN_KEY);
    if (token) return token;
  } catch {
    // ignore
  }
  // Fallback
  return await AsyncStorage.getItem(AUTH_TOKEN_KEY);
}

/**
 * Clear the persisted auth token on logout.
 */
export async function clearPersistedAuthToken(): Promise<void> {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    return;
  }
  try {
    await secureStoreDelete(AUTH_TOKEN_KEY);
  } catch {
    // ignore
  }
  await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
}

/**
 * Store the API base URL for REST calls.
 */
const API_BASE_URL_KEY = "neelgund:api_base_url";

export async function getApiBaseUrl(): Promise<string> {
  // Allow override via env or AsyncStorage; default to production
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  try {
    const stored = await AsyncStorage.getItem(API_BASE_URL_KEY);
    if (stored) return stored;
  } catch {
    // ignore
  }

  // Production default
  return "https://api.neelgund.com";
}

export async function setApiBaseUrl(url: string): Promise<void> {
  await AsyncStorage.setItem(API_BASE_URL_KEY, url);
}
