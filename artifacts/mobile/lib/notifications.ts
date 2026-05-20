// import * as Notifications from "expo-notifications";
// import { Platform } from "react-native";

// const CHECKOUT_REMINDER_ID_KEY = "neelgund:checkout_reminder_notification_id";
// const CHECKOUT_HOUR = 18;
// const CHECKOUT_MINUTE = 0;

// /**
//  * Request notification permissions.
//  */
// export async function requestNotificationPermissions(): Promise<boolean> {
//   if (Platform.OS === "web") return false;
//   const { status: existing } = await Notifications.getPermissionsAsync();
//   if (existing === "granted") return true;
//   const { status } = await Notifications.requestPermissionsAsync();
//   return status === "granted";
// }

// /**
//  * Schedule a daily checkout reminder at 6:00 PM.
//  * Cancels any existing reminder first.
//  */
// export async function scheduleCheckoutReminder(): Promise<string | null> {
//   if (Platform.OS === "web") return null;

//   const granted = await requestNotificationPermissions();
//   if (!granted) return null;

//   // Cancel any existing reminder
//   await cancelCheckoutReminder();

//   const identifier = await Notifications.scheduleNotificationAsync({
//     content: {
//       title: "Time to Check Out!",
//       body: "It's 6:00 PM — don't forget to clock out for today.",
//       sound: "default",
//     },
//     trigger: {
//       type: "daily",
//       hour: CHECKOUT_HOUR,
//       minute: CHECKOUT_MINUTE,
//     } as Notifications.DailyTriggerInput,
//   });

//   return identifier;
// }

// /**
//  * Cancel the checkout reminder notification.
//  */
// export async function cancelCheckoutReminder(): Promise<void> {
//   if (Platform.OS === "web") return;
//   const scheduled = await Notifications.getAllScheduledNotificationsAsync();
//   for (const n of scheduled) {
//     if (n.content.title === "Time to Check Out!") {
//       await Notifications.cancelScheduledNotificationAsync(n.identifier);
//     }
//   }
// }

// /**
//  * Set up notification handler so notifications show when app is foregrounded.
//  */
// export function setNotificationHandler(): void {
//   if (Platform.OS === "web") return;
//   Notifications.setNotificationHandler({
//     handleNotification: async () => ({
//       shouldShowAlert: true,
//       shouldPlaySound: true,
//       shouldSetBadge: false,
//       shouldShowBanner: true,
//       shouldShowList: true,
//     }),
//   });
// }
export function setNotificationHandler() {
  console.log("Notifications disabled in Expo Go");
}

export async function registerForPushNotificationsAsync() {
  return null;
}

export async function scheduleCheckoutReminder() {
  return null;
}

export async function cancelCheckoutReminder() {
  return null;
}