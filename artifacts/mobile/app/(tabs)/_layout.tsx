import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

export default function TabLayout() {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const role = user?.role ?? "employee";
  const isTransport = role === "transport";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const isWide = width > 600;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: C.brand,
        tabBarInactiveTintColor: C.tabIconDefault,
        headerShown: true,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : "#FFFFFF",
          borderTopWidth: isWeb ? 1 : 0.5,
          borderTopColor: "#E2E8F0",
          elevation: 0,
          height: isWeb ? (isWide ? 64 : 78) : (isWide ? 72 : 86),
          paddingBottom: isWeb ? (isWide ? 8 : 10) : (isWide ? 12 : 26),
          paddingTop: isWide ? 8 : 10,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={100} tint="light" style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: "#FFFFFF" }]} />
          ),
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: isWide ? 10 : 11,
          marginTop: isWide ? 0 : 1,
        },
        tabBarItemStyle: {
          paddingVertical: isWide ? 1 : 2,
        },
        lazy: true,
        freezeOnBlur: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) => <Ionicons name="bar-chart" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "Leads",
          href: isTransport ? null : undefined,
          tabBarIcon: ({ color }) => <Ionicons name="people" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: "Map",
          headerShown: false,
          tabBarIcon: ({ color }) => <Ionicons name="map" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: "Attendance",
          tabBarIcon: ({ color }) => <Ionicons name="finger-print" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: "Docs",
          href: null,
          tabBarIcon: ({ color }) => <Ionicons name="folder" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Ionicons name="person-circle" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: "More",
          tabBarIcon: ({ color }) => <Ionicons name="ellipsis-horizontal-circle" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="admin"
        options={{
          title: "Admin",
          href: null,
          tabBarIcon: ({ color }) => <Ionicons name="shield-half" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="hr"
        options={{
          title: "HR",
          href: null,
          tabBarIcon: ({ color }) => <Ionicons name="people-circle" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="super-admin"
        options={{
          title: "Super Admin",
          href: null,
          tabBarIcon: ({ color }) => <Ionicons name="shield-checkmark" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tracking-status"
        options={{
          title: "Tracking",
          href: null,
          tabBarIcon: ({ color }) => <Ionicons name="pulse" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}
