// const { getDefaultConfig } = require("expo/metro-config");

// const config = getDefaultConfig(__dirname);

// // Exclude jspdf from web builds to avoid bundling issues
// // Exclude mapbox-gl and react-map-gl from native builds (web-only libraries with dynamic imports)
// config.resolver.resolveRequest = (context, moduleName, platform) => {
//   if (platform === 'web' && (moduleName === 'jspdf' || moduleName === 'jspdf-autotable')) {
//     return {
//       filePath: require.resolve(moduleName),
//       type: 'empty',
//     };
//   }
//   if ((platform === 'android' || platform === 'ios') && (moduleName === 'mapbox-gl' || moduleName.startsWith('react-map-gl'))) {
//     return {
//       filePath: require.resolve('expo/metro-config'),
//       type: 'empty',
//     };
//   }
//   return context.resolveRequest(context, moduleName, platform);
// };

// module.exports = config;

// ================================================================

// const { getDefaultConfig } = require("expo/metro-config");

// const config = getDefaultConfig(__dirname);

// // Block Node-only packages from being bundled on native (Android/iOS).
// // Block web-only packages from being bundled on native.
// const NATIVE_BLOCKED = new Set(["ws", "stream", "mapbox-gl"]);
// const WEB_BLOCKED = new Set(["jspdf", "jspdf-autotable"]);

// config.resolver.resolveRequest = (context, moduleName, platform) => {
//   const bare = moduleName.split("/")[0];

//   // Block ws + Node core modules on native — they crash Metro
//   if ((platform === "android" || platform === "ios") && NATIVE_BLOCKED.has(bare)) {
//     return { type: "empty" };
//   }

//   // Block react-map-gl (web-only Mapbox wrapper) on native
//   if ((platform === "android" || platform === "ios") && moduleName.startsWith("react-map-gl")) {
//     return { type: "empty" };
//   }

//   // Block jspdf on web (uses Node APIs not available in browser bundle)
//   if (platform === "web" && WEB_BLOCKED.has(bare)) {
//     return { type: "empty" };
//   }

//   return context.resolveRequest(context, moduleName, platform);
// };

// module.exports = config;

// ================================================================


const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

const config = getDefaultConfig(__dirname);

const NATIVE_BLOCKED = new Set(["ws", "stream", "mapbox-gl"]);
const WEB_BLOCKED = new Set(["jspdf", "jspdf-autotable"]);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const bare = moduleName.split("/")[0];

  // Block ws + Node core modules on native — they crash Metro
  if ((platform === "android" || platform === "ios") && NATIVE_BLOCKED.has(bare)) {
    return { type: "empty" };
  }

  // Block react-map-gl on native
  if ((platform === "android" || platform === "ios") && moduleName.startsWith("react-map-gl")) {
    return { type: "empty" };
  }

  // Block jspdf on web
  if (platform === "web" && WEB_BLOCKED.has(bare)) {
    return { type: "empty" };
  }

  // ── CRITICAL: manually resolve platform-specific extensions ──────────────
  // When a custom resolveRequest is provided, Metro's built-in platform
  // extension resolution (.web.ts, .web.tsx, etc.) is BYPASSED entirely.
  // We must do it ourselves for any relative/alias import.
  if (platform === "web" && (moduleName.startsWith(".") || moduleName.startsWith("@/"))) {
    // Resolve the alias to an absolute path
    let basePath = moduleName;
    if (moduleName.startsWith("@/")) {
      basePath = path.resolve(__dirname, moduleName.slice(2));
    } else {
      basePath = path.resolve(path.dirname(context.originModulePath), moduleName);
    }

    // Try .web.ts, .web.tsx in order
    const webExtensions = [".web.ts", ".web.tsx", ".web.js", ".web.jsx"];
    for (const ext of webExtensions) {
      const candidate = basePath + ext;
      if (fs.existsSync(candidate)) {
        return { type: "sourceFile", filePath: candidate };
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;