import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import {
  listPendingAttendanceRegularizations,
  approveAttendanceRegularization,
} from "@/lib/api";
import type { AttendanceRegularization } from "@/lib/types";
import { formatTime, formatDate } from "@/lib/utils";

const C = Colors.light;

type FilterStatus = "pending" | "approved" | "rejected" | "all";

const RegularizationRow = React.memo(function RegularizationRow({
  item,
  onApprove,
  onReject,
  isProcessing,
}: {
  item: AttendanceRegularization;
  onApprove: (id: number) => void;
  onReject: (id: number) => void;
  isProcessing: boolean;
}) {
  return (
    <View style={styles.rowCard}>
      <View style={styles.rowTop}>
        <View style={[styles.avatar, { backgroundColor: C.brand + "18" }]}>
          <Text style={styles.avatarText}>{(item.employeeName ?? "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.employeeName ?? `Employee #${item.employeeId}`}</Text>
          <Text style={styles.date}>{formatDate(item.date)}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.status === "pending" ? C.warning + "18" : item.status === "approved" ? C.success + "18" : C.danger + "18" }]}>
          <Text style={[styles.statusText, { color: item.status === "pending" ? C.warning : item.status === "approved" ? C.success : C.danger }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
        </View>
      </View>

      <View style={styles.details}>
        <View style={styles.detailItem}>
          <Ionicons name="log-in-outline" size={14} color={C.success} />
          <Text style={styles.detailText}>In: {formatTime(item.requestedCheckInTime)}</Text>
        </View>
        <View style={styles.detailItem}>
          <Ionicons name="log-out-outline" size={14} color={C.danger} />
          <Text style={styles.detailText}>Out: {formatTime(item.requestedCheckOutTime)}</Text>
        </View>
      </View>

      {item.reason ? (
        <View style={styles.reasonBox}>
          <Text style={styles.reasonLabel}>Reason:</Text>
          <Text style={styles.reasonText}>{item.reason}</Text>
        </View>
      ) : null}

      {item.status === "pending" && (
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => onReject(item.id)}
            disabled={isProcessing}
          >
            <Ionicons name="close-circle" size={16} color={C.danger} />
            <Text style={[styles.actionBtnText, { color: C.danger }]}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => onApprove(item.id)}
            disabled={isProcessing}
          >
            <Ionicons name="checkmark-circle" size={16} color="#fff" />
            <Text style={[styles.actionBtnText, { color: "#fff" }]}>Approve</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

export default function RegularizationsScreen() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<FilterStatus>("pending");
  const [processingId, setProcessingId] = useState<number | null>(null);

  const regularizationsQ = useQuery<AttendanceRegularization[]>({
    queryKey: ["pending-attendance-regularizations"],
    queryFn: () => listPendingAttendanceRegularizations(),
    staleTime: 30_000,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" }) => {
      await approveAttendanceRegularization(id, status);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["pending-attendance-regularizations"] });
      qc.invalidateQueries({ queryKey: ["attendance-summary"] });
      qc.invalidateQueries({ queryKey: ["attendance-date"] });
      setProcessingId(null);
    },
    onError: (e: Error) => {
      Alert.alert("Failed", e.message);
      setProcessingId(null);
    },
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ["pending-attendance-regularizations"] });
    setRefreshing(false);
  }, [qc]);

  const handleApprove = (id: number) => {
    Alert.alert("Approve", "Approve this regularization request?", [
      { text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => { setProcessingId(id); approveMutation.mutate({ id, status: "approved" }); } },
    ]);
  };

  const handleReject = (id: number) => {
    Alert.alert("Reject", "Reject this regularization request?", [
      { text: "Cancel", style: "cancel" },
      { text: "Reject", style: "destructive", onPress: () => { setProcessingId(id); approveMutation.mutate({ id, status: "rejected" }); } },
    ]);
  };

  const allItems = regularizationsQ.data ?? [];
  const filteredItems = filter === "all" ? allItems : allItems.filter((i) => i.status === filter);

  const filters: { key: FilterStatus; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];

  return (
    <ScrollView
      style={[styles.container, { paddingTop: insets.top + 12 }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Regularizations</Text>
          <Text style={styles.subtitle}>Review attendance requests</Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterBar}
      >
        {filters.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.section}>
        {regularizationsQ.isLoading ? (
          <ActivityIndicator color={C.brand} style={{ marginTop: 24 }} />
        ) : filteredItems.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-done-circle-outline" size={36} color={C.border} />
            <Text style={styles.emptyText}>No {filter !== "all" ? filter : ""} requests</Text>
          </View>
        ) : (
          filteredItems.map((item) => (
            <RegularizationRow
              key={item.id}
              item={item}
              onApprove={handleApprove}
              onReject={handleReject}
              isProcessing={approveMutation.isPending && processingId === item.id}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, gap: 8 },
  backBtn: { padding: 4, marginLeft: -4 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },

  filterBar: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 8, paddingTop: 4 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  filterChipTextActive: { color: "#fff", fontFamily: "Inter_600SemiBold" },

  section: { paddingHorizontal: 16, gap: 10 },

  rowCard: { backgroundColor: C.card, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border, gap: 10 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.brand },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  date: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  details: { flexDirection: "row", gap: 16, marginTop: 2 },
  detailItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },

  reasonBox: { backgroundColor: C.surfaceSecondary, borderRadius: 10, padding: 10, gap: 2 },
  reasonLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  reasonText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.text },

  actions: { flexDirection: "row", gap: 10, marginTop: 2 },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 12, borderWidth: 1 },
  rejectBtn: { backgroundColor: C.danger + "10", borderColor: C.danger + "30" },
  approveBtn: { backgroundColor: C.success, borderColor: C.success },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  emptyState: { alignItems: "center", padding: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
});
