import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, Platform, ActivityIndicator, Modal, TextInput, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { router } from "expo-router";
import * as XLSX from "xlsx";
// Skip jspdf imports for now to fix web build
// import { jsPDF } from "jspdf";
// import autoTable from "jspdf-autotable";
import Colors from "@/constants/colors";
import { listCompanyDocuments, listLeads, listTrackingStatus, listUsers, resetUserPassword, type AppRole } from "@/lib/api";
import type { TrackingRow, CompanyDocument, Lead } from "@/lib/types";
import { formatWhen } from "@/lib/utils";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

const C = Colors.light;

type LeadRow = Lead;

type AppUserRow = {
  id: string;
  name: string;
  email: string;
  role: AppRole;
};

function timestampForFileName(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}`;
}

function downloadBlobOnWeb(fileName: string, blob: Blob): void {
  if (Platform.OS !== "web") throw new Error("Lead export is currently available on web admin.");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function MetricCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: IoniconsName;
  color: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function QuickAction({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: IoniconsName;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.actionCard} onPress={onPress} activeOpacity={0.85}>
      <View style={styles.actionLeft}>
        <View style={styles.actionIconWrap}>
          <Ionicons name={icon} size={20} color={C.brand} />
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

export default function SuperAdminScreen() {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90;
  const [resetTarget, setResetTarget] = useState<AppUserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [exportingType, setExportingType] = useState<"excel" | "pdf" | null>(null);

  const usersQ = useQuery<AppUserRow[]>({
    queryKey: ["users"],
    queryFn: async () => (await listUsers()) as AppUserRow[],
  });
  const trackingQ = useQuery<TrackingRow[]>({
    queryKey: ["tracking-status"],
    queryFn: listTrackingStatus,
  });
  const docsQ = useQuery<CompanyDocument[]>({
    queryKey: ["company-documents"],
    queryFn: listCompanyDocuments,
  });
  const leadsQ = useQuery<LeadRow[]>({
    queryKey: ["leads"],
    queryFn: async () => (await listLeads()) as LeadRow[],
  });
  const resetPasswordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) => {
      await resetUserPassword(id, password);
    },
    onSuccess: () => {
      Alert.alert("Password Updated", "The user password has been reset successfully.");
      setResetTarget(null);
      setNewPassword("");
    },
    onError: (err: Error) => {
      Alert.alert("Reset Failed", err.message || "Unable to reset password");
    },
  });

  const users = usersQ.data ?? [];
  const trackingRows = trackingQ.data ?? [];
  const docs = docsQ.data ?? [];
  const leads = leadsQ.data ?? [];

  const managers = users.filter((u) => u.role === "manager").length;
  const employees = users.filter((u) => u.role === "employee").length;
  const transport = users.filter((u) => u.role === "transport").length;
  const trackingRunning = trackingRows.filter((r) => r.trackerState === "running").length;
  const permissionDenied = trackingRows.filter((r) => r.permissionState === "denied").length;

  const isLoading = usersQ.isLoading || trackingQ.isLoading || docsQ.isLoading || leadsQ.isLoading;
  const isRefreshing = usersQ.isFetching || trackingQ.isFetching || docsQ.isFetching || leadsQ.isFetching;

  const onRefresh = () => {
    usersQ.refetch();
    trackingQ.refetch();
    docsQ.refetch();
    leadsQ.refetch();
  };

  const submitPasswordReset = () => {
    if (!resetTarget) return;
    const password = newPassword.trim();
    if (password.length < 8) {
      Alert.alert("Invalid Password", "Password must be at least 8 characters.");
      return;
    }
    resetPasswordMutation.mutate({ id: resetTarget.id, password });
  };

  const exportLeadsExcel = () => {
    if (Platform.OS !== "web") {
      Alert.alert("Web Only", "Excel export is currently available on web admin.");
      return;
    }
    if (leads.length === 0) {
      Alert.alert("No Leads", "There are no leads to export.");
      return;
    }
    try {
      setExportingType("excel");
      const rows = leads.map((lead) => ({
        "Lead Name": lead.name ?? "",
        Phone: lead.phone ?? "",
        Email: lead.email ?? "",
        "Assigned Employee": lead.employeeName ?? "",
        Status: lead.status ?? "",
        Source: lead.source ?? "",
        Priority: lead.priority ?? "",
        "Follow-up Date": lead.followUpDate ?? "",
        Budget: lead.budget ?? "",
        "Property Interest": lead.propertyInterest ?? "",
        Address: lead.address ?? "",
        "Created At": formatWhen(lead.createdAt),
        "Updated At": formatWhen(lead.updatedAt),
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
      const xlsxArrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob(
        [xlsxArrayBuffer],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      );
      downloadBlobOnWeb(`leads-report-${timestampForFileName()}.xlsx`, blob);
      Alert.alert("Exported", "Excel report downloaded.");
    } catch (err) {
      Alert.alert("Export Failed", err instanceof Error ? err.message : "Unable to export Excel.");
    } finally {
      setExportingType(null);
    }
  };

  const exportLeadsPdf = async () => {
    if (!leads.length) {
      Alert.alert("No Leads", "There are no leads to export.");
      return;
    }
    try {
      setExportingType("pdf");
      // Skip PDF export on web for now
      if (Platform.OS === "web") {
        Alert.alert("Export Failed", "PDF export is not available on web. Please use Excel export.");
        return;
      }
      // Import jspdf via require on native
      const { jsPDF } = require("jspdf");
      const autoTable = require("jspdf-autotable").default;
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(14);
      doc.text("Leads Report", 40, 36);
      doc.setFontSize(10);
      doc.text(`Generated: ${new Date().toLocaleString("en-IN")}`, 40, 52);
      autoTable(doc, {
        startY: 64,
        styles: { fontSize: 8, cellPadding: 4 },
        head: [[
          "Lead",
          "Phone",
          "Employee",
          "Status",
          "Source",
          "Priority",
          "Follow-up",
          "Created",
        ]],
        body: leads.map((lead) => ([
          lead.name ?? "",
          lead.phone ?? "",
          lead.employeeName ?? "",
          lead.status ?? "",
          lead.source ?? "",
          lead.priority ?? "",
          lead.followUpDate ?? "",
          formatWhen(lead.createdAt),
        ])),
      });
      const blob = doc.output("blob");
      downloadBlobOnWeb(`leads-report-${timestampForFileName()}.pdf`, blob);
      Alert.alert("Exported", "PDF report downloaded.");
    } catch (err) {
      Alert.alert("Export Failed", err instanceof Error ? err.message : "Unable to export PDF.");
    } finally {
      setExportingType(null);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={{ paddingTop: topPad }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: bottomPad, gap: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={C.brand} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Super Admin</Text>
          <Text style={styles.subtitle}>Global controls and company-wide visibility</Text>
        </View>

        {isLoading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={C.brand} />
          </View>
        ) : (
          <>
            <View style={styles.metricsGrid}>
              <MetricCard label="Team Size" value={users.length} icon="people" color={C.brand} />
              <MetricCard label="Managers" value={managers} icon="briefcase" color="#8B5CF6" />
              <MetricCard label="Employees" value={employees} icon="person" color={C.success} />
              <MetricCard label="Transport" value={transport} icon="car" color="#F59E0B" />
              <MetricCard label="Trackers Running" value={trackingRunning} icon="pulse" color={C.accent} />
              <MetricCard label="Permission Denied" value={permissionDenied} icon="warning" color={C.danger} />
              <MetricCard label="Documents" value={docs.length} icon="folder-open" color={C.brand} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Quick Actions</Text>
              <QuickAction
                title="Open HR Panel"
                subtitle="Manage users, roles and profile details"
                icon="people-circle"
                onPress={() => router.push("/(tabs)/hr")}
              />
              <QuickAction
                title="Open Tracking Status"
                subtitle="Review live tracker and permission health"
                icon="pulse"
                onPress={() => router.push("/(tabs)/tracking-status")}
              />
              <QuickAction
                title="Open Documents"
                subtitle="Review company files and categories"
                icon="folder-open"
                onPress={() => router.push("/(tabs)/documents")}
              />
              <QuickAction
                title="Open Leads"
                subtitle="Review and delete leads"
                icon="people"
                onPress={() => router.push("/(tabs)/leads")}
              />
              <QuickAction
                title="Open Map"
                subtitle="View employee location overview"
                icon="map"
                onPress={() => router.push("/(tabs)/map")}
              />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Lead Reports</Text>
              <Text style={styles.sectionHelper}>
                Export {leads.length} leads for offline reporting.
              </Text>
              <View style={styles.exportRow}>
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={exportLeadsExcel}
                  disabled={exportingType !== null}
                >
                  {exportingType === "excel" ? (
                    <ActivityIndicator size="small" color={C.brand} />
                  ) : (
                    <Ionicons name="grid-outline" size={16} color={C.brand} />
                  )}
                  <Text style={styles.exportBtnText}>Export Excel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.exportBtn}
                  onPress={exportLeadsPdf}
                  disabled={exportingType !== null}
                >
                  {exportingType === "pdf" ? (
                    <ActivityIndicator size="small" color={C.brand} />
                  ) : (
                    <Ionicons name="document-text-outline" size={16} color={C.brand} />
                  )}
                  <Text style={styles.exportBtnText}>Export PDF</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>User Password Reset</Text>
              {users.map((u) => (
                <View key={u.id} style={styles.userRow}>
                  <View style={styles.userInfo}>
                    <Text style={styles.userName}>{u.name}</Text>
                    <Text style={styles.userEmail}>{u.email}</Text>
                    <Text style={styles.userRole}>{u.role.toUpperCase()}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.resetBtn}
                    onPress={() => {
                      setResetTarget(u);
                      setNewPassword("");
                    }}
                  >
                    <Ionicons name="key-outline" size={16} color={C.brand} />
                    <Text style={styles.resetBtnText}>Reset</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={resetTarget !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => {
          setResetTarget(null);
          setNewPassword("");
        }}
      >
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity
              onPress={() => {
                setResetTarget(null);
                setNewPassword("");
              }}
            >
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <TouchableOpacity onPress={submitPasswordReset} disabled={resetPasswordMutation.isPending}>
              {resetPasswordMutation.isPending ? (
                <ActivityIndicator color={C.brand} />
              ) : (
                <Ionicons name="checkmark" size={24} color={C.brand} />
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.modalHelper}>
            {resetTarget ? `Set a new password for ${resetTarget.name}.` : ""}
          </Text>
          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>New Password *</Text>
            <TextInput
              style={styles.fieldInput}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Minimum 8 characters"
              placeholderTextColor={C.placeholder}
              secureTextEntry
              autoCapitalize="none"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { paddingTop: 16, gap: 4 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  loadingState: { minHeight: 280, alignItems: "center", justifyContent: "center" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metricCard: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: "31%",
    borderRadius: 14,
    backgroundColor: C.card,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
    gap: 8,
  },
  metricIcon: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  metricValue: { fontSize: 24, fontFamily: "Inter_700Bold", color: C.text },
  metricLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  section: { gap: 10, marginTop: 8 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  sectionHelper: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  exportRow: { flexDirection: "row", gap: 10 },
  exportBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.brand + "44",
    backgroundColor: C.brand + "10",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  exportBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
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
  actionLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  actionIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.brand + "14" },
  actionTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  actionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  userRow: {
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
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  userRole: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: C.brand, marginTop: 4, letterSpacing: 0.6 },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 10,
    backgroundColor: C.brand + "12",
  },
  resetBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
  modal: { flex: 1, backgroundColor: C.background, paddingHorizontal: 20, paddingBottom: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  modalHelper: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginBottom: 16 },
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
