import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from "react-native";
import { useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { updateMyPassword } from "@/lib/api";

const C = {
  brand: "#1B4F8A",
  brandDark: "#0D2F5A",
  accent: "#F4A820",
  success: "#22C55E",
  danger: "#EF4444",
  background: "#F0F4F9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F1923",
  textSecondary: "#64748B",
};

const ROLE_META: Record<string, { color: string; label: string; desc: string }> = {
  super_admin: { color: "#8B5CF6", label: "Super Admin", desc: "Full system access and configuration" },
  admin: { color: "#1B4F8A", label: "Administrator", desc: "Manage leads, users and reporting" },
  manager: { color: "#F4A820", label: "Manager", desc: "Oversee team performance and leads" },
  employee: { color: "#22C55E", label: "Employee", desc: "Manage assigned leads and attendance" },
  hr: { color: "#EC4899", label: "HR", desc: "Manage attendance and employee records" },
  transport: { color: "#14B8A6", label: "Transport", desc: "Fleet tracking and trip management" },
};

export default function ProfileWebScreen() {
  const { user, logout } = useAuth();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwSuccess, setPwSuccess] = useState(false);

  const roleMeta = ROLE_META[user?.role ?? ""] ?? { color: C.brand, label: user?.role ?? "User", desc: "System user" };

  const initials = user?.name
    ? user.name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase()
    : "?";

  const resetMutation = useMutation({
    mutationFn: async () => {
      const pw = newPassword.trim();
      const conf = confirmPassword.trim();
      if (pw.length < 8) throw new Error("Password must be at least 8 characters");
      if (pw !== conf) throw new Error("Passwords do not match");
      await updateMyPassword(pw);
    },
    onSuccess: () => {
      setPwSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
      setTimeout(() => setPwSuccess(false), 4000);
    },
    onError: (err: Error) => Alert.alert("Reset Failed", err.message),
  });

  const pwStrength = newPassword.length === 0 ? null
    : newPassword.length < 8 ? "weak"
      : newPassword.length < 12 ? "fair"
        : "strong";

  const pwStrengthColor = pwStrength === "weak" ? C.danger : pwStrength === "fair" ? C.accent : C.success;
  const pwStrengthWidth = pwStrength === "weak" ? "33%" : pwStrength === "fair" ? "66%" : "100%";

  return (
    <View style={styles.root}>
      <View style={styles.main}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Text style={styles.pageTitle}>Profile</Text>
          <TouchableOpacity style={styles.logoutTopBtn} onPress={logout}>
            <Ionicons name="log-out-outline" size={16} color={C.danger} />
            <Text style={styles.logoutTopText}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.pageWrap}>

            {/* Profile Hero Card */}
            <View style={styles.heroCard}>
              <View style={[styles.heroBand, { backgroundColor: roleMeta.color }]} />
              <View style={styles.heroBody}>
                <View style={[styles.avatar, { backgroundColor: roleMeta.color + "20", borderColor: roleMeta.color + "50" }]}>
                  <Text style={[styles.avatarText, { color: roleMeta.color }]}>{initials}</Text>
                </View>
                <View style={styles.heroInfo}>
                  <Text style={styles.userName}>{user?.name}</Text>
                  <Text style={styles.userEmail}>{user?.email}</Text>
                  <View style={[styles.rolePill, { backgroundColor: roleMeta.color + "18" }]}>
                    <View style={[styles.roleDot, { backgroundColor: roleMeta.color }]} />
                    <Text style={[styles.roleText, { color: roleMeta.color }]}>{roleMeta.label}</Text>
                  </View>
                  <Text style={styles.roleDesc}>{roleMeta.desc}</Text>
                </View>
                <View style={styles.infoTiles}>
                  <View style={styles.infoTile}>
                    <Text style={styles.infoTileLabel}>USER ID</Text>
                    <Text style={styles.infoTileValue} numberOfLines={1}>{user?.id?.slice(0, 8)}...</Text>
                  </View>
                  <View style={styles.infoTileDivider} />
                  <View style={styles.infoTile}>
                    <Text style={styles.infoTileLabel}>ACCESS LEVEL</Text>
                    <Text style={styles.infoTileValue}>{roleMeta.label}</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* Bottom row: password + danger side by side */}
            <View style={styles.bottomRow}>

              {/* Password Change Card */}
              <View style={[styles.card, styles.pwCard]}>
                <View style={styles.cardHeader}>
                  <View style={[styles.cardIconWrap, { backgroundColor: C.brand + "15" }]}>
                    <Ionicons name="lock-closed" size={18} color={C.brand} />
                  </View>
                  <View>
                    <Text style={styles.cardTitle}>Change Password</Text>
                    <Text style={styles.cardSub}>Use a strong password with 8+ characters</Text>
                  </View>
                </View>

                {pwSuccess && (
                  <View style={styles.successBanner}>
                    <Ionicons name="checkmark-circle" size={16} color={C.success} />
                    <Text style={styles.successText}>Password updated successfully</Text>
                  </View>
                )}

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>New Password</Text>
                  <View style={styles.fieldWrap}>
                    <Ionicons name="key-outline" size={16} color={C.textSecondary} style={styles.fieldIcon} />
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="Min. 8 characters"
                      placeholderTextColor={C.textSecondary}
                      secureTextEntry={!showNewPw}
                      value={newPassword}
                      onChangeText={setNewPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity onPress={() => setShowNewPw(!showNewPw)} style={styles.eyeBtn}>
                      <Ionicons name={showNewPw ? "eye-off-outline" : "eye-outline"} size={16} color={C.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  {newPassword.length > 0 && (
                    <View style={styles.strengthRow}>
                      <View style={styles.strengthTrack}>
                        <View style={[styles.strengthFill, { width: pwStrengthWidth as any, backgroundColor: pwStrengthColor }]} />
                      </View>
                      <Text style={[styles.strengthText, { color: pwStrengthColor }]}>
                        {pwStrength?.charAt(0).toUpperCase()}{pwStrength?.slice(1)}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Confirm Password</Text>
                  <View style={[
                    styles.fieldWrap,
                    confirmPassword.length > 0 && newPassword !== confirmPassword && { borderColor: C.danger + "60" },
                    confirmPassword.length > 0 && newPassword === confirmPassword && { borderColor: C.success + "60" },
                  ]}>
                    <Ionicons name="shield-checkmark-outline" size={16} color={C.textSecondary} style={styles.fieldIcon} />
                    <TextInput
                      style={styles.fieldInput}
                      placeholder="Re-enter password"
                      placeholderTextColor={C.textSecondary}
                      secureTextEntry={!showConfirmPw}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity onPress={() => setShowConfirmPw(!showConfirmPw)} style={styles.eyeBtn}>
                      <Ionicons name={showConfirmPw ? "eye-off-outline" : "eye-outline"} size={16} color={C.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                    <Text style={styles.matchError}>Passwords do not match</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[
                    styles.saveBtn,
                    resetMutation.isPending && { opacity: 0.7 },
                    (newPassword.length < 8 || newPassword !== confirmPassword) && { opacity: 0.5 },
                  ]}
                  onPress={() => resetMutation.mutate()}
                  disabled={resetMutation.isPending || newPassword.length < 8 || newPassword !== confirmPassword}
                >
                  {resetMutation.isPending ? (
                    <Text style={styles.saveBtnText}>Updating...</Text>
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={16} color="#fff" />
                      <Text style={styles.saveBtnText}>Update Password</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {/* Account Actions */}
              <View style={[styles.card, styles.dangerCard]}>
                <Text style={styles.dangerTitle}>Account Actions</Text>
                <Text style={styles.dangerSub}>Manage your session and account access.</Text>
                <TouchableOpacity style={styles.logoutDangerBtn} onPress={logout}>
                  <Ionicons name="log-out-outline" size={16} color={C.danger} />
                  <Text style={styles.logoutDangerText}>Sign out of all sessions</Text>
                </TouchableOpacity>
              </View>

            </View>
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.background },
  main: { flex: 1, flexDirection: "column", height: "100vh" as any },
  topBar: {
    height: 68,
    backgroundColor: C.card,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 32,
  },
  pageTitle: { fontSize: 20, fontWeight: "800", color: C.text },
  logoutTopBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.danger + "10", borderRadius: 10, borderWidth: 1, borderColor: C.danger + "25",
    paddingHorizontal: 14, paddingVertical: 9,
  },
  logoutTopText: { fontSize: 13, fontWeight: "600", color: C.danger },

  scroll: { flex: 1 },
  scrollContent: { padding: 32 },
  pageWrap: { maxWidth: 900, width: "100%", alignSelf: "center", gap: 24 },

  // Hero Card — horizontal layout
  heroCard: {
    backgroundColor: C.card, borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.07, shadowRadius: 20,
  },
  heroBand: { height: 6 },
  heroBody: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 32,
    paddingVertical: 28,
    gap: 28,
  },
  avatar: {
    width: 80, height: 80, borderRadius: 22, borderWidth: 3,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  avatarText: { fontSize: 30, fontWeight: "800" },
  heroInfo: { flex: 1, gap: 4 },
  userName: { fontSize: 22, fontWeight: "800", color: C.text },
  userEmail: { fontSize: 13, color: C.textSecondary },
  rolePill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: "flex-start", marginTop: 4,
  },
  roleDot: { width: 7, height: 7, borderRadius: 4 },
  roleText: { fontSize: 12, fontWeight: "700" },
  roleDesc: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  infoTiles: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.background, borderRadius: 12,
    borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 20, paddingVertical: 14,
    gap: 20, flexShrink: 0,
  },
  infoTile: { gap: 3 },
  infoTileDivider: { width: 1, height: 32, backgroundColor: C.border },
  infoTileLabel: { fontSize: 9, fontWeight: "700", color: C.textSecondary, letterSpacing: 1 },
  infoTileValue: { fontSize: 13, fontWeight: "700", color: C.text },

  // Bottom row
  bottomRow: { flexDirection: "row", gap: 20, alignItems: "flex-start" },

  card: {
    backgroundColor: C.card, borderRadius: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 12,
  },
  pwCard: { flex: 2, padding: 28, gap: 18 },
  dangerCard: {
    flex: 1, padding: 24, gap: 12,
    borderWidth: 1, borderColor: C.danger + "20",
  },

  cardHeader: { flexDirection: "row", alignItems: "center", gap: 14 },
  cardIconWrap: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  cardSub: { fontSize: 12, color: C.textSecondary, marginTop: 2 },

  successBanner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.success + "12", borderRadius: 10, borderWidth: 1, borderColor: C.success + "25",
    padding: 12,
  },
  successText: { fontSize: 13, fontWeight: "600", color: C.success },

  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.text, letterSpacing: 0.2 },
  fieldWrap: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: C.background, borderRadius: 11, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 12, height: 46,
  },
  fieldIcon: { marginRight: 8 },
  fieldInput: { flex: 1, fontSize: 14, color: C.text, outlineStyle: "none" } as any,
  eyeBtn: { padding: 4 },
  strengthRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  strengthTrack: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" },
  strengthFill: { height: 4, borderRadius: 2 },
  strengthText: { fontSize: 11, fontWeight: "700", width: 45 },
  matchError: { fontSize: 11, color: C.danger, marginTop: 2 },
  saveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: C.brand, borderRadius: 11, paddingVertical: 13,
    shadowColor: C.brand, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 10,
  },
  saveBtnText: { fontSize: 14, fontWeight: "700", color: "#fff" },

  dangerTitle: { fontSize: 13, fontWeight: "800", color: C.text },
  dangerSub: { fontSize: 12, color: C.textSecondary },
  logoutDangerBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.danger + "08", borderRadius: 10, borderWidth: 1, borderColor: C.danger + "20",
    paddingHorizontal: 16, paddingVertical: 11, marginTop: 4,
    alignSelf: "flex-start",
  },
  logoutDangerText: { fontSize: 13, fontWeight: "600", color: C.danger },
});