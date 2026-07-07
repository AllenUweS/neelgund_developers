/**
 * api.appConfig.ts
 *
 * Supabase helpers for reading and writing the app_config table.
 * Import these into your admin panel and into googleMapsKey.ts.
 */

import { supabase } from "@/lib/supabase";

export type AppConfigRow = {
    key: string;
    value: string;
    description: string | null;
    updated_by: string | null;
    updated_at: string;
};

// ── Read ─────────────────────────────────────────────────────────────────────

/** Fetch all config rows (admin only). */
export async function listAppConfig(): Promise<AppConfigRow[]> {
    const { data, error } = await supabase
        .from("app_config")
        .select("*")
        .order("key");
    if (error) throw error;
    return data as AppConfigRow[];
}

/** Fetch the Google Maps API key via the public RPC (any authenticated user). */
export async function fetchGoogleMapsKeyFromDB(): Promise<string | null> {
    const { data, error } = await supabase.rpc("get_google_maps_key");
    if (error) {
        console.warn("[AppConfig] RPC error:", error.message);
        return null;
    }
    return data as string | null;
}

// ── Write ────────────────────────────────────────────────────────────────────

/** Update the Google Maps API key (admin/super_admin only). */
export async function updateGoogleMapsKey(newKey: string): Promise<void> {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase
        .from("app_config")
        .update({
            value: newKey.trim(),
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
        })
        .eq("key", "google_maps_api_key");

    if (error) throw error;
}

/** Generic upsert for any config key (admin/super_admin only). */
export async function upsertAppConfig(
    key: string,
    value: string,
    description?: string
): Promise<void> {
    const {
        data: { user },
    } = await supabase.auth.getUser();

    const { error } = await supabase.from("app_config").upsert(
        {
            key,
            value: value.trim(),
            description: description ?? null,
            updated_by: user?.id ?? null,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
    );

    if (error) throw error;
}