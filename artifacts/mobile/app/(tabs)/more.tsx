import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";

const C = Colors.light;

function ActionCard({
  title,
  subtitle,
  icon,
  iconColor,
  iconBg,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  iconBg: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.actionLeft}>
        <View style={[styles.actionIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.actionTitle}>{title}</Text>
          <Text style={styles.actionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
    </TouchableOpacity>
  );
}

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const role = user?.role ?? "employee";

  const isHr = role === "hr" || role === "admin" || role === "super_admin";
  const canViewTracking = role === "manager" || role === "admin" || role === "super_admin";
  const isSuperAdmin = role === "admin" || role === "super_admin";
  const canManageRegularizations = role === "manager" || role === "admin" || role === "super_admin";

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90;

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ paddingTop: topPad }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad, gap: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>More</Text>
          <Text style={styles.subtitle}>Shortcuts and role-based tools</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Workspace</Text>
          <ActionCard
            title="Company Documents"
            subtitle="Open policies and shared files"
            icon="folder-open-outline"
            iconColor={C.brand}
            iconBg={C.brand + "14"}
            onPress={() => router.push("/(tabs)/documents")}
          />
          <ActionCard
            title="Lead Management"
            subtitle="Review and update your lead pipeline"
            icon="people-outline"
            iconColor={C.brand}
            iconBg={C.brand + "14"}
            onPress={() => router.push("/(tabs)/leads")}
          />
        </View>

        {role === "manager" ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Manager Tools</Text>
            <ActionCard
              title="My Team"
              subtitle="View your assigned employees"
              icon="people-outline"
              iconColor="#10B981"
              iconBg="#10B9811A"
              onPress={() => router.push("/my-team" as any)}
            />
          </View>
        ) : null}

        {(isHr || canViewTracking || isSuperAdmin) ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Admin Tools</Text>
            {isHr ? (
              <ActionCard
                title="HR & Team Management"
                subtitle="Manage users, roles and reporting lines"
                icon="people-circle-outline"
                iconColor="#EC4899"
                iconBg="#EC48991A"
                onPress={() => router.push("/(tabs)/admin")}
              />
            ) : null}
            {canManageRegularizations ? (
              <ActionCard
                title="Attendance Regularizations"
                subtitle="Review and approve attendance requests"
                icon="git-pull-request-outline"
                iconColor={C.brand}
                iconBg={C.brand + "14"}
                onPress={() => router.push("/regularizations")}
              />
            ) : null}
            {canViewTracking ? (
              <ActionCard
                title="Tracking Status"
                subtitle="Monitor tracker health and permissions"
                icon="pulse-outline"
                iconColor={C.accent}
                iconBg={C.accent + "1C"}
                onPress={() => router.push("/(tabs)/tracking-status")}
              />
            ) : null}
            {isSuperAdmin ? (
              <ActionCard
                title="Super Admin Console"
                subtitle="Open global controls and advanced actions"
                icon="shield-checkmark-outline"
                iconColor="#7C3AED"
                iconBg="#7C3AED1A"
                onPress={() => router.push("/(tabs)/super-admin")}
              />
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { gap: 4, marginTop: 8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  section: { gap: 10 },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  actionCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  actionLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  actionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  actionSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 2,
  },
});
