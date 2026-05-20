import React from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { listMyTeam } from "@/lib/api";
import type { AppUser } from "@/lib/api";

const C = Colors.light;

function EmployeeCard({ user }: { user: AppUser }) {
  const handleCall = () => {
    if (user.phone) {
      Linking.openURL(`tel:${user.phone}`);
    }
  };

  const handleEmail = () => {
    if (user.email) {
      Linking.openURL(`mailto:${user.email}`);
    }
  };

  const initials = user.name
    .split(/\s+/)
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase() || "?";

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{user.name}</Text>
          <Text style={styles.roleText}>{user.designation || "Employee"}</Text>
        </View>
      </View>
      
      <View style={styles.cardActions}>
        {user.phone ? (
          <TouchableOpacity style={styles.actionBtn} onPress={handleCall}>
            <Ionicons name="call-outline" size={16} color={C.brand} />
            <Text style={styles.actionText}>Call</Text>
          </TouchableOpacity>
        ) : null}
        
        {user.email ? (
          <TouchableOpacity style={styles.actionBtn} onPress={handleEmail}>
            <Ionicons name="mail-outline" size={16} color={C.brand} />
            <Text style={styles.actionText}>Email</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export default function MyTeamScreen() {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + 40;

  const { data: team = [], isLoading, isError } = useQuery<AppUser[]>({
    queryKey: ["my-team"],
    queryFn: listMyTeam,
  });

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Team</Text>
        <View style={{ width: 40 }} />
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      ) : isError ? (
        <View style={styles.center}>
          <Ionicons name="alert-circle-outline" size={48} color={C.danger} />
          <Text style={styles.emptyText}>Failed to load team</Text>
        </View>
      ) : team.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="people-outline" size={64} color={C.border} />
          <Text style={styles.emptyText}>No employees assigned to you</Text>
          <Text style={styles.emptySub}>When HR assigns employees to you, they will appear here.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 12 }}
          showsVerticalScrollIndicator={false}
        >
          {team.map((user) => (
            <EmployeeCard key={user.id} user={user} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  backBtn: { padding: 12 },
  title: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: C.text },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  emptyText: { fontSize: 16, fontFamily: "Inter_500Medium", color: C.textSecondary, marginTop: 16 },
  emptySub: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 8, textAlign: "center" },
  card: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 16,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: C.brand },
  name: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text },
  roleText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  cardActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    paddingTop: 12,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.brand + "10",
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    gap: 6,
    flex: 1,
  },
  actionText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.brand },
});
