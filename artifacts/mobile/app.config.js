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
    [
      "expo-build-properties",
      {
        android: {
          kotlinVersion: "2.1.20",
          compileSdkVersion: 35,
          targetSdkVersion: 35,
          buildToolsVersion: "35.0.0",
          agpVersion: "8.7.3",
        }
      }
    ],
  ];

  return {
    ...expo,
    plugins,
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