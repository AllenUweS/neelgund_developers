import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { usePathname, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const C = {
  brand: "#1B4F8A",
  brandDark: "#0D2F5A",
  accent: "#F4A820",
  success: "#22C55E",
  danger: "#EF4444",
  background: "#F8FAFC",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F1923",
  textSecondary: "#64748B",
};

// Sidebar dark theme
const S = {
  bg: "#0A1628",
  surface: "#111E35",
  surfaceHover: "#162440",
  border: "#1E2D47",
  text: "#E2E8F0",
  textMuted: "#64748B",
  accent: "#F4A820",
  brand: "#3B7DD8",
};

interface NavItem {
  label: string;
  icon: IoniconsName;
  activeIcon: IoniconsName;
  path: string;
  roles?: string[];
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", icon: "home-outline", activeIcon: "home", path: "/(tabs)/" },
  { label: "Leads", icon: "people-outline", activeIcon: "people", path: "/(tabs)/leads" },
  { label: "Attendance", icon: "calendar-outline", activeIcon: "calendar", path: "/(tabs)/attendance" },
  { label: "Live Map", icon: "map-outline", activeIcon: "map", path: "/(tabs)/map", roles: ["admin", "super_admin", "manager"] },
  { label: "Profile", icon: "person-outline", activeIcon: "person", path: "/(tabs)/profile" },
];

const ROLE_COLORS: Record<string, string> = {
  super_admin: "#8B5CF6",
  admin: "#3B7DD8",
  manager: "#F4A820",
  employee: "#22C55E",
  hr: "#EC4899",
  transport: "#14B8A6",
};

export function WebSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.includes(user?.role ?? "")
  );

  const isActive = (path: string) => {
    if (path === "/(tabs)/") return pathname === "/" || pathname === "/(tabs)/" || pathname === "/index";
    return pathname.includes(path.replace("/(tabs)/", ""));
  };

  const initials = user?.name
    ? user.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const roleColor = ROLE_COLORS[user?.role ?? ""] ?? S.brand;

  return (
    <View style={styles.sidebar}>
      {/* Logo */}
      <View style={styles.logoArea}>
        <View style={styles.logoMark}>
          <Text style={styles.logoMarkText}>C</Text>
        </View>
        <View style={styles.logoText}>
          <Text style={styles.logoTitle}>CRM</Text>
          <Text style={styles.logoSub}>DASHBOARD</Text>
        </View>
        <View style={styles.logoLine} />
      </View>

      {/* Nav */}
      <ScrollView style={styles.navScroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.navSection}>NAVIGATION</Text>
        {visibleItems.map((item) => {
          const active = isActive(item.path);
          return (
            <TouchableOpacity
              key={item.path}
              style={[styles.navItem, active && styles.navItemActive]}
              onPress={() => router.push(item.path as any)}
              activeOpacity={0.8}
            >
              {active && <View style={styles.navActiveBar} />}
              <View style={[styles.navIconWrap, active && styles.navIconWrapActive]}>
                <Ionicons
                  name={active ? item.activeIcon : item.icon}
                  size={18}
                  color={active ? S.accent : S.textMuted}
                />
              </View>
              <Text style={[styles.navLabel, active && styles.navLabelActive]}>
                {item.label}
              </Text>
              {active && (
                <View style={styles.navActiveDot} />
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* User Footer */}
      <View style={styles.userFooter}>
        <View style={styles.userDivider} />
        <View style={styles.userRow}>
          <View style={[styles.userAvatar, { backgroundColor: roleColor + "25", borderColor: roleColor + "60" }]}>
            <Text style={[styles.userAvatarText, { color: roleColor }]}>{initials}</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName} numberOfLines={1}>{user?.name}</Text>
            <View style={[styles.rolePill, { backgroundColor: roleColor + "20" }]}>
              <Text style={[styles.roleText, { color: roleColor }]}>
                {user?.role?.replace("_", " ").toUpperCase()}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={logout}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="log-out-outline" size={18} color={S.textMuted} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 240,
    height: "100%" as any,
    backgroundColor: S.bg,
    borderRightWidth: 1,
    borderRightColor: S.border,
    flexDirection: "column",
    position: "fixed" as any,
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 100,
  },
  logoArea: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 24,
    gap: 0,
  },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.brand,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  logoMarkText: {
    fontSize: 22,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -1,
  },
  logoText: { marginBottom: 20 },
  logoTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: S.text,
    letterSpacing: 2,
  },
  logoSub: {
    fontSize: 9,
    fontWeight: "700",
    color: S.textMuted,
    letterSpacing: 3,
    marginTop: 1,
  },
  logoLine: {
    height: 1,
    backgroundColor: S.border,
  },
  navScroll: { flex: 1, paddingTop: 8 },
  navSection: {
    fontSize: 9,
    fontWeight: "700",
    color: S.textMuted,
    letterSpacing: 2,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 11,
    marginBottom: 2,
    gap: 12,
    position: "relative",
  },
  navItemActive: {
    backgroundColor: S.surface,
  },
  navActiveBar: {
    position: "absolute",
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    borderRadius: 2,
    backgroundColor: S.accent,
  },
  navIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  navIconWrapActive: {
    backgroundColor: S.accent + "18",
  },
  navLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
    color: S.textMuted,
  },
  navLabelActive: {
    color: S.text,
    fontWeight: "600",
  },
  navActiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: S.accent,
  },
  userFooter: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  userDivider: {
    height: 1,
    backgroundColor: S.border,
    marginBottom: 16,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarText: { fontSize: 13, fontWeight: "700" },
  userInfo: { flex: 1, gap: 3 },
  userName: {
    fontSize: 13,
    fontWeight: "600",
    color: S.text,
  },
  rolePill: {
    alignSelf: "flex-start",
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  roleText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  logoutBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: S.surface,
    alignItems: "center",
    justifyContent: "center",
  },
});
