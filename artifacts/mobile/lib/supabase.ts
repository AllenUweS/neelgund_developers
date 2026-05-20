// // // import AsyncStorage from "@react-native-async-storage/async-storage";
// // // import { createClient } from "@supabase/supabase-js";
// // // import { Platform } from "react-native";

// // // const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// // // const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// // // if (!supabaseUrl || !supabaseAnonKey) {
// // //   throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required");
// // // }

// // // // Use localStorage for web, AsyncStorage for native
// // // const storage = Platform.OS === "web" ? {
// // //   getItem: (key: string) => {
// // //     try {
// // //       return Promise.resolve(localStorage.getItem(key));
// // //     } catch {
// // //       return Promise.resolve(null);
// // //     }
// // //   },
// // //   setItem: (key: string, value: string) => {
// // //     try {
// // //       localStorage.setItem(key, value);
// // //       return Promise.resolve();
// // //     } catch {
// // //       return Promise.resolve();
// // //     }
// // //   },
// // //   removeItem: (key: string) => {
// // //     try {
// // //       localStorage.removeItem(key);
// // //       return Promise.resolve();
// // //     } catch {
// // //       return Promise.resolve();
// // //     }
// // //   },
// // // } : AsyncStorage;

// // // export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
// // //   auth: {
// // //     storage,
// // //     persistSession: true,
// // //     autoRefreshToken: true,
// // //     detectSessionInUrl: false,
// // //   },
// // // });


// // =====================================================================================




// // import AsyncStorage from "@react-native-async-storage/async-storage";
// // import { createClient } from "@supabase/supabase-js";
// // import { Platform } from "react-native";

// // // FIX: Expo "output: static" pre-renders every route in Node.js 20, which has
// // // no native WebSocket. supabase-js v2.46+ tries to open a WebSocket inside
// // // createClient(), crashing the SSR pass before the browser even loads.
// // // This polyfill sets global.WebSocket = ws (the Node WebSocket package) when
// // // running in Node. It is a no-op in the browser and on native.
// // if (Platform.OS === "web") {
// //   require("@/lib/wsPolyfill");
// // }

// // const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// // const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// // if (!supabaseUrl || !supabaseAnonKey) {
// //   throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required");
// // }

// // // Use localStorage for web, AsyncStorage for native
// // const storage =
// //   Platform.OS === "web"
// //     ? {
// //         getItem: (key: string) => {
// //           try {
// //             return Promise.resolve(localStorage.getItem(key));
// //           } catch {
// //             return Promise.resolve(null);
// //           }
// //         },
// //         setItem: (key: string, value: string) => {
// //           try {
// //             localStorage.setItem(key, value);
// //             return Promise.resolve();
// //           } catch {
// //             return Promise.resolve();
// //           }
// //         },
// //         removeItem: (key: string) => {
// //           try {
// //             localStorage.removeItem(key);
// //             return Promise.resolve();
// //           } catch {
// //             return Promise.resolve();
// //           }
// //         },
// //       }
// //     : AsyncStorage;

// // export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
// //   auth: {
// //     storage,
// //     persistSession: true,
// //     autoRefreshToken: true,
// //     detectSessionInUrl: false,
// //   },
// // });


// // ==============================================================================================

// import AsyncStorage from "@react-native-async-storage/async-storage";
// import { createClient } from "@supabase/supabase-js";
// import { Platform } from "react-native";

// // React Native (Android/iOS) has a built-in global WebSocket — no polyfill needed.
// // Web (browser) also has a native WebSocket — no polyfill needed there either.
// // The old wsPolyfill that imported the Node "ws" package has been removed
// // because Metro cannot bundle Node core modules (like "stream") on native.

// const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
// const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

// if (!supabaseUrl || !supabaseAnonKey) {
//   throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required");
// }

// const storage =
//   Platform.OS === "web"
//     ? {
//         getItem: (key: string) => {
//           try { return Promise.resolve(localStorage.getItem(key)); }
//           catch { return Promise.resolve(null); }
//         },
//         setItem: (key: string, value: string) => {
//           try { localStorage.setItem(key, value); return Promise.resolve(); }
//           catch { return Promise.resolve(); }
//         },
//         removeItem: (key: string) => {
//           try { localStorage.removeItem(key); return Promise.resolve(); }
//           catch { return Promise.resolve(); }
//         },
//       }
//     : AsyncStorage;

// export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
//   auth: {
//     storage,
//     persistSession: true,
//     autoRefreshToken: true,
//     detectSessionInUrl: false,
//   },
// });

// // ==============================================================================================

// lib/supabase.ts  ← used by Android & iOS only
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are required");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});