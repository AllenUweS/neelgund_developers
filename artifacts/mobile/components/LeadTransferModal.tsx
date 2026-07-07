import React, { useState, useEffect, useMemo } from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import DateTimePicker from "@react-native-community/datetimepicker";
import Colors from "@/constants/colors";
import { transferLeads, listUsers } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/utils";

const STATUS_FILTERS = ["all", "new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"] as const;

const C = Colors.light;

function safeHaptic(kind: "impact" | "selection" | "success") {
  if (Platform.OS === "web") return;
  if (kind === "impact") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  if (kind === "selection") void Haptics.selectionAsync();
  if (kind === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function LeadTransferModal({
  visible,
  onClose,
  allLeads,
  refetchLeads,
}: {
  visible: boolean;
  onClose: () => void;
  allLeads: Lead[];
  refetchLeads: () => void;
}) {
  const [mode, setMode] = useState<"single" | "date" | "status">("single");
  const [fromEmployeeId, setFromEmployeeId] = useState("");
  const [toEmployeeId, setToEmployeeId] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");
  const [showDatePicker, setShowDatePicker] = useState(false);

  const usersQ = useQuery({
    queryKey: ["users"],
    queryFn: listUsers,
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const allUsers = usersQ.data ?? [];

  useEffect(() => {
    if (visible) {
      setMode("single");
      setFromEmployeeId("");
      setToEmployeeId("");
      setSelectedLeadId("");
      setSelectedDate("");
      setSelectedStatus("all");
    }
  }, [visible]);

  const matchingLeads = useMemo(() => {
    if (!fromEmployeeId) return [];
    let leads = allLeads.filter(l => l.employeeId === fromEmployeeId);

    if (mode === "single" && selectedLeadId) {
      leads = leads.filter(l => l.id.toString() === selectedLeadId);
    } else if (mode === "date" && selectedDate) {
      leads = leads.filter(l => l.createdAt.startsWith(selectedDate));
    } else if (mode === "status" && selectedStatus !== "all") {
      leads = leads.filter(l => l.status === selectedStatus);
    }

    if (mode === "single" && !selectedLeadId) return [];
    if (mode === "date" && !selectedDate) return [];
    if (mode === "status" && selectedStatus === "all") return [];
    
    return leads;
  }, [allLeads, fromEmployeeId, mode, selectedLeadId, selectedDate, selectedStatus]);

  const employees = useMemo(() => allUsers.filter(u => u.role !== "transport"), [allUsers]);
  const fromEmployeeLeads = useMemo(() => allLeads.filter(l => l.employeeId === fromEmployeeId), [allLeads, fromEmployeeId]);

  const transferMutation = useMutation({
    mutationFn: async () => {
      const leadIds = matchingLeads.map(l => l.id);
      if (leadIds.length === 0 || !toEmployeeId) throw new Error("Please fill all required fields.");
      await transferLeads(leadIds, toEmployeeId);
    },
    onSuccess: () => {
      safeHaptic("success");
      refetchLeads();
      onClose();
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#F8FAFC", paddingTop: Platform.OS === "web" ? 60 : 20 }}>
        <View style={tmStyles.header}>
          <TouchableOpacity onPress={onClose} style={tmStyles.closeBtn} hitSlop={8}>
            <Ionicons name="close" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={tmStyles.headerTitle}>Lead Transfer</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 24 }}>
          <View style={tmStyles.modeSwitcher}>
            {(["single", "date", "status"] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={[tmStyles.modeTab, mode === m && tmStyles.modeTabActive]}
                onPress={() => { setMode(m); safeHaptic("selection"); }}
              >
                <Text style={[tmStyles.modeTabText, mode === m && tmStyles.modeTabTextActive]}>
                  {m === "single" ? "Single Lead" : m === "date" ? "Date-wise" : "Status-wise"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {usersQ.isLoading ? (
            <ActivityIndicator color={C.brand} />
          ) : (
            <>
              <View style={tmStyles.field}>
                <Text style={tmStyles.label}>From Employee *</Text>
                <View style={tmStyles.selectWrap}>
                  <select
                    style={tmStyles.webSelect}
                    value={fromEmployeeId}
                    onChange={(e) => {
                      setFromEmployeeId(e.target.value);
                      setSelectedLeadId("");
                    }}
                  >
                    <option value="">Select source employee...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
                  </select>
                </View>
              </View>

              {mode === "single" && fromEmployeeId && (
                <View style={tmStyles.field}>
                  <Text style={tmStyles.label}>Select Lead *</Text>
                  <View style={tmStyles.selectWrap}>
                    <select style={tmStyles.webSelect} value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)}>
                      <option value="">Select lead...</option>
                      {fromEmployeeLeads.map(l => (
                        <option key={l.id} value={l.id.toString()}>{l.name} - {l.phone}</option>
                      ))}
                    </select>
                  </View>
                </View>
              )}

              {mode === "date" && fromEmployeeId && (
                <View style={tmStyles.field}>
                  <Text style={tmStyles.label}>Select Date *</Text>
                  {Platform.OS === "web" ? (
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      style={{ ...tmStyles.webSelect, height: 48, boxSizing: "border-box" }}
                    />
                  ) : (
                    <>
                      <TouchableOpacity style={tmStyles.dateBtn} onPress={() => setShowDatePicker(true)}>
                        <Text style={selectedDate ? tmStyles.dateVal : tmStyles.datePlace}>
                          {selectedDate ? formatDisplayDate(selectedDate) : "Select date..."}
                        </Text>
                      </TouchableOpacity>
                      {showDatePicker && (
                        <DateTimePicker
                          value={selectedDate ? new Date(selectedDate) : new Date()}
                          mode="date"
                          display="default"
                          onChange={(event, date) => {
                            setShowDatePicker(false);
                            if (date) {
                              const pad = (n: number) => n.toString().padStart(2, "0");
                              setSelectedDate(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`);
                            }
                          }}
                        />
                      )}
                    </>
                  )}
                </View>
              )}

              {mode === "status" && fromEmployeeId && (
                <View style={tmStyles.field}>
                  <Text style={tmStyles.label}>Select Status *</Text>
                  <View style={tmStyles.statusRow}>
                    {STATUS_FILTERS.filter((s) => s !== "all").map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[tmStyles.statusPill, selectedStatus === s && { backgroundColor: C.brand, borderColor: C.brand }]}
                        onPress={() => { setSelectedStatus(s); safeHaptic("selection"); }}
                      >
                        <Text style={[tmStyles.statusPillText, selectedStatus === s && { color: "#FFF" }]}>
                          {STATUS_LABELS[s]}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {fromEmployeeId && matchingLeads.length > 0 && (
                <View style={[tmStyles.impactCard, { backgroundColor: "#EEF2FF", borderColor: "#C7D2FE" }]}>
                  <Ionicons name="flash" size={24} color="#6366F1" />
                  <Text style={[tmStyles.impactText, { color: "#4F46E5", fontFamily: "Inter_700Bold" }]}>
                    {matchingLeads.length} Lead{matchingLeads.length !== 1 ? "s" : ""} selected for transfer
                  </Text>
                </View>
              )}
              
              {fromEmployeeId && matchingLeads.length === 0 && (mode === "date" || mode === "status") && (
                <View style={[tmStyles.impactCard, { backgroundColor: "#FFF1F2", borderColor: "#FECDD3" }]}>
                  <Ionicons name="alert-circle" size={24} color="#E11D48" />
                  <Text style={[tmStyles.impactText, { color: "#E11D48" }]}>
                    No leads match this selection.
                  </Text>
                </View>
              )}

              <View style={tmStyles.field}>
                <Text style={tmStyles.label}>To Employee *</Text>
                <View style={tmStyles.selectWrap}>
                  <select style={tmStyles.webSelect} value={toEmployeeId} onChange={(e) => setToEmployeeId(e.target.value)}>
                    <option value="">Select destination employee...</option>
                    {employees.map(e => (
                      e.id !== fromEmployeeId && <option key={e.id} value={e.id}>{e.name} ({e.role})</option>
                    ))}
                  </select>
                </View>
              </View>
            </>
          )}
        </ScrollView>

        <View style={tmStyles.footer}>
          <TouchableOpacity
            style={[tmStyles.submitBtn, (matchingLeads.length === 0 || !toEmployeeId || transferMutation.isPending) && { opacity: 0.5 }]}
            onPress={() => transferMutation.mutate()}
            disabled={matchingLeads.length === 0 || !toEmployeeId || transferMutation.isPending}
          >
            {transferMutation.isPending ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={tmStyles.submitText}>Transfer {matchingLeads.length} Lead{matchingLeads.length !== 1 ? "s" : ""}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const tmStyles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16, backgroundColor: "#FFF", borderBottomWidth: 1, borderBottomColor: C.border },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surfaceSecondary, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  modeSwitcher: { flexDirection: "row", backgroundColor: "#E2E8F0", borderRadius: 12, padding: 4 },
  modeTab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10 },
  modeTabActive: { backgroundColor: "#FFF", shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 },
  modeTabText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  modeTabTextActive: { color: C.text, fontFamily: "Inter_700Bold" },
  field: { gap: 8 },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  selectWrap: { backgroundColor: "#FFF", borderWidth: 1, borderColor: C.border, borderRadius: 12, overflow: "hidden" },
  webSelect: { width: "100%", padding: 14, fontSize: 15, fontFamily: "Inter_400Regular", backgroundColor: "transparent", border: "none", outline: "none", appearance: "none" } as any,
  dateBtn: { backgroundColor: "#FFF", borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 14 },
  dateVal: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.text },
  datePlace: { fontSize: 15, fontFamily: "Inter_400Regular", color: C.placeholder },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusPill: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: "#FFF", borderWidth: 1, borderColor: C.border },
  statusPillText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary },
  impactCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#F1F5F9", borderWidth: 1, borderColor: "#E2E8F0", padding: 16, borderRadius: 14 },
  impactText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: C.textSecondary },
  footer: { padding: 20, backgroundColor: "#FFF", borderTopWidth: 1, borderTopColor: C.border, paddingBottom: Platform.OS === "ios" ? 40 : 20 },
  submitBtn: { backgroundColor: C.brand, borderRadius: 14, height: 54, alignItems: "center", justifyContent: "center" },
  submitText: { fontSize: 16, fontFamily: "Inter_700Bold", color: "#FFF" },
});
