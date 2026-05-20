import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { updateMyPassword } from "@/lib/api";

const C = Colors.light;

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const [showResetModal, setShowResetModal] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90;

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      const password = newPassword.trim();
      const confirm = confirmPassword.trim();
      if (password.length < 8) throw new Error("Password must be at least 8 characters");
      if (password !== confirm) throw new Error("Passwords do not match");
      await updateMyPassword(password);
    },
    onSuccess: () => {
      Alert.alert("Password Updated", "Your password has been reset successfully.");
      setShowResetModal(false);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => Alert.alert("Reset Failed", err.message || "Unable to reset password"),
  });

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ paddingTop: topPad }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad, gap: 14 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.avatarWrap}>
            <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
          </View>
          <Text style={styles.name}>{user?.name ?? "User"}</Text>
          <Text style={styles.role}>{(user?.role ?? "employee").toUpperCase()}</Text>
        </View>

        <View style={styles.infoCard}>
          <ProfileRow icon="mail-outline" label="Email" value={user?.email ?? "—"} />
          <ProfileRow icon="call-outline" label="Phone" value={user?.phone ?? "—"} />
          <ProfileRow icon="business-outline" label="Department" value={user?.department ?? "—"} />
          <ProfileRow icon="briefcase-outline" label="Designation" value={user?.designation ?? "—"} />
          <ProfileRow icon="calendar-outline" label="Joining Date" value={user?.joiningDate ?? "—"} />
        </View>

        <TouchableOpacity
          style={styles.actionCard}
          onPress={() => {
            setShowResetModal(true);
            setNewPassword("");
            setConfirmPassword("");
          }}
          activeOpacity={0.85}
        >
          <View style={styles.actionLeft}>
            <View style={[styles.actionIconWrap, { backgroundColor: C.brand + "14" }]}>
              <Ionicons name="key-outline" size={20} color={C.brand} />
            </View>
            <View>
              <Text style={styles.actionTitle}>Reset Password</Text>
              <Text style={styles.actionSubtitle}>Change your account password</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.logoutBtn}
          onPress={() => {
            Alert.alert("Sign Out", "Do you want to sign out?", [
              { text: "Cancel", style: "cancel" },
              { text: "Sign Out", style: "destructive", onPress: () => logout() },
            ]);
          }}
        >
          <Ionicons name="log-out-outline" size={18} color={C.danger} />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showResetModal}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setShowResetModal(false)}
      >
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} enabled={Platform.OS !== "web"} style={{ flex: 1 }}>
          <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowResetModal(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Reset Password</Text>
              <TouchableOpacity onPress={() => resetPasswordMutation.mutate()} disabled={resetPasswordMutation.isPending}>
                {resetPasswordMutation.isPending ? (
                  <ActivityIndicator color={C.brand} />
                ) : (
                  <Ionicons name="checkmark" size={24} color={C.brand} />
                )}
              </TouchableOpacity>
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>New Password *</Text>
              <TextInput
                style={styles.fieldInput}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Minimum 8 characters"
                placeholderTextColor={C.placeholder}
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Confirm Password *</Text>
              <TextInput
                style={styles.fieldInput}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder="Re-enter password"
                placeholderTextColor={C.placeholder}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function ProfileRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <View style={styles.profileRowIcon}>
        <Ionicons name={icon} size={16} color={C.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.profileRowLabel}>{label}</Text>
        <Text style={styles.profileRowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { alignItems: "center", paddingTop: 18, gap: 8 },
  avatarWrap: { width: 78, height: 78, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: C.brand + "1A" },
  avatarText: { fontSize: 32, fontFamily: "Inter_700Bold", color: C.brand },
  name: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text },
  role: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: C.brand,
    backgroundColor: C.brand + "18",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    letterSpacing: 0.8,
  },
  infoCard: { backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 },
  profileRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, gap: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  profileRowIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  profileRowLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  profileRowValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text, marginTop: 2 },
  actionCard: {
    marginTop: 2,
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
  actionLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  actionIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  actionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  actionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  logoutBtn: {
    marginTop: 2,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.danger + "40",
    backgroundColor: C.danger + "10",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  logoutText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.danger },
  modal: { flex: 1, backgroundColor: C.background, paddingHorizontal: 20, paddingBottom: 20, gap: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
});
