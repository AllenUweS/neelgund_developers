import { supabase } from "@/lib/supabase";

export async function getAuthToken(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export function apiUrl(path: string): string {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
  return `${base}${path}`;
}
