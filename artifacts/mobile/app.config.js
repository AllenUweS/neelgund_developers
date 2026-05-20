// // /**
// //  * Dynamic Expo config (merges app.json). Maps are rendered with Leaflet in a WebView
// //  * using OpenStreetMap tiles — no Google Maps SDK, no API key needed.
// //  */
// // // eslint-disable-next-line @typescript-eslint/no-require-imports
// // const appJson = require("./app.json");

// // module.exports = () => {
// //   const { expo } = appJson;

// //   const plugins = [
// //     ...(expo.plugins || []),
// //     [
// //       "expo-location",
// //       {
// //         locationWhenInUsePermission:
// //           "Allow Neelgund Developers to use your location to show your position on the map and for attendance.",
// //         locationAlwaysAndWhenInUsePermission:
// //           "Allow Neelgund Developers to track your field movement in the background for attendance and team trail visibility.",
// //         isIosBackgroundLocationEnabled: true,
// //         isAndroidBackgroundLocationEnabled: true,
// //         isAndroidForegroundServiceEnabled: true,
// //       },
// //     ],
// //   ];

// //   return {
// //     ...expo,
// //     plugins,
// //   };
// // };


// // 

// ========================================================================

const appJson = require("./app.json");

module.exports = () => {
  const { expo } = appJson;

  const plugins = [
    ...(expo.plugins || []),
    [
      "expo-location",
      {
        locationWhenInUsePermission:
          "Allow Neelgund Developers to use your location to show your position on the map and for attendance.",
        locationAlwaysAndWhenInUsePermission:
          "Allow Neelgund Developers to track your field movement in the background for attendance and team trail visibility.",
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ];

  return {
    ...expo,
    plugins,
    // Expose the Google Maps key to native builds
    android: {
      ...(expo.android || {}),
      config: {
        ...(expo.android?.config || {}),
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? "",
        },
      },
    },
  };
};
