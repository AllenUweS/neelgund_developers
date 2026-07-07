// lib/supabase.web.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// During Expo static pre-render, this module runs in Node 20 which has no
// WebSocket. Supabase-js tries to open one inside createClient().
// We install a do-nothing stub so the constructor doesn't throw.
// In the browser this block is skipped (window exists, real WebSocket exists).
if (typeof window === "undefined") {
    // Minimal WebSocket stub — just enough for supabase-js to not throw
    // during construction. It never actually connects in SSR.
    const noop = () => { };
    class FakeWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        readyState = 3; // CLOSED
        onopen: null = null;
        onclose: null = null;
        onerror: null = null;
        onmessage: null = null;
        send = noop;
        close = noop;
        addEventListener = noop;
        removeEventListener = noop;
        dispatchEvent = () => false;
        constructor(_url: string, _protocols?: string | string[]) { }
    }
    (globalThis as typeof globalThis & { WebSocket: unknown }).WebSocket = FakeWebSocket;
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        storage: typeof window !== "undefined" ? {
            getItem: (key) => {
                try { return Promise.resolve(localStorage.getItem(key)); }
                catch { return Promise.resolve(null); }
            },
            setItem: (key, value) => {
                try { localStorage.setItem(key, value); }
                catch { }
                return Promise.resolve();
            },
            removeItem: (key) => {
                try { localStorage.removeItem(key); }
                catch { }
                return Promise.resolve();
            },
        } : {
            // No-op storage during SSR — session is never accessed server-side
            getItem: () => Promise.resolve(null),
            setItem: () => Promise.resolve(),
            removeItem: () => Promise.resolve(),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});