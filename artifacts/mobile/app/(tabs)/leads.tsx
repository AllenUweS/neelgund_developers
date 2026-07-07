import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { deleteLead, listLeads, listManagers, listUsers, type AppUser } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { PRIORITY_COLORS, PRIORITY_LABELS, SOURCE_LABELS, statusColor, statusLabel } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";
import { LeadTransferModal } from "@/components/LeadTransferModal";

const C = Colors.light;

import DateTimePicker from "@react-native-community/datetimepicker";

interface CustomDatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate?: Date;
  title?: string;
}

function CustomDatePickerModal({
  visible,
  onClose,
  onConfirm,
  initialDate,
  title,
}: CustomDatePickerModalProps) {
  const [date, setDate] = React.useState(initialDate || new Date());

  React.useEffect(() => {
    if (visible && initialDate) {
      setDate(initialDate);
    }
  }, [visible, initialDate]);

  if (!visible) return null;

  if (Platform.OS === "android") {
    return (
      <DateTimePicker
        value={date}
        mode="date"
        display="default"
        onChange={(event, selectedDate) => {
          if (event.type === "set" && selectedDate) {
            onConfirm(selectedDate);
            onClose();
          } else if (event.type === "dismissed") {
            onClose();
          }
        }}
      />
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dpStyles.overlay}>
        <View style={dpStyles.sheet}>
          <View style={dpStyles.sheetHeader}>
            <Text style={dpStyles.sheetTitle}>{title || "Select Date"}</Text>
            <TouchableOpacity onPress={onClose} style={dpStyles.sheetClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={dpStyles.divider} />

          <DateTimePicker
            value={date}
            mode="date"
            display="inline"
            onChange={(event, selectedDate) => {
              if (selectedDate) {
                setDate(selectedDate);
                onConfirm(selectedDate);
                onClose();
              }
            }}
            style={{ margin: 16, alignSelf: "center" }}
          />
        </View>
      </View>
    </Modal>
  );
}

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    paddingTop: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#0F172A",
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 24,
  },
});

const STATUS_FILTERS = ["all", "new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"] as const;
const STATUS_LABELS: Record<string, string> = {
  all: "All",
  new: "New",
  not_contacted: "Not Contacted",
  follow_up: "Follow Up",
  meeting_scheduled: "Meeting",
  negotiation: "Negotiation",
  closed_won: "Won",
  closed_lost: "Lost",
};

type StatusFilter = (typeof STATUS_FILTERS)[number];

function safeHaptic(kind: "impact" | "selection" | "success") {
  if (Platform.OS === "web") return;
  if (kind === "impact") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  if (kind === "selection") void Haptics.selectionAsync();
  if (kind === "success") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}

function formatDate(iso?: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[1].charAt(0)}`.toUpperCase();
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^\d+]/g, "");
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

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
  if (Platform.OS !== "web") return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function LeadCard({
  lead,
  canDelete,
  onDelete,
  onPress,
}: {
  lead: Lead;
  canDelete: boolean;
  onDelete: (lead: Lead) => void;
  onPress: () => void;
}) {
  const sc = statusColor(lead.status);
  const priorityColor = lead.priority ? PRIORITY_COLORS[lead.priority] : null;
  const sourceLabel = lead.source ? SOURCE_LABELS[lead.source] ?? lead.source : null;

  return (
    <TouchableOpacity style={styles.leadCard} onPress={onPress} activeOpacity={0.84}>
      <View style={[styles.leadAvatar, { backgroundColor: sc + "18" }]}>
        <Text style={[styles.leadAvatarText, { color: sc }]}>{initials(lead.name)}</Text>
      </View>

      <View style={styles.leadBody}>
        <View style={styles.leadTopRow}>
          <View style={styles.leadTitleWrap}>
            <Text style={styles.leadName} numberOfLines={1}>
              {lead.name}
            </Text>
            <Text style={styles.leadPhone} numberOfLines={1}>
              {normalizePhone(lead.phone)}
            </Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: sc + "16", borderColor: sc + "30" }]}>
            <Text style={[styles.statusPillText, { color: sc }]} numberOfLines={1}>
              {statusLabel(lead.status)}
            </Text>
          </View>
        </View>

        <View style={styles.leadInfoRow}>
          <Ionicons name="business-outline" size={13} color={C.textSecondary} />
          <Text style={styles.leadInfoText} numberOfLines={1}>
            {lead.propertyInterest || "No property selected"}
          </Text>
        </View>

        <View style={styles.leadMetaWrap}>
          {priorityColor && lead.priority ? (
            <View style={[styles.metaChip, { backgroundColor: priorityColor + "14", borderColor: priorityColor + "35" }]}>
              <View style={[styles.metaDot, { backgroundColor: priorityColor }]} />
              <Text style={[styles.metaChipText, { color: priorityColor }]}>{PRIORITY_LABELS[lead.priority] ?? lead.priority}</Text>
            </View>
          ) : null}
          {sourceLabel ? (
            <View style={styles.metaChip}>
              <Ionicons name="sparkles-outline" size={12} color={C.textSecondary} />
              <Text style={styles.metaChipText}>{sourceLabel}</Text>
            </View>
          ) : null}
          {lead.budget ? (
            <View style={styles.metaChip}>
              <Ionicons name="wallet-outline" size={12} color={C.textSecondary} />
              <Text style={styles.metaChipText} numberOfLines={1}>
                {lead.budget}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.leadFooter}>
          <View style={styles.ownerWrap}>
            <Ionicons name="person-outline" size={12} color={C.textSecondary} />
            <Text style={styles.ownerText} numberOfLines={1}>
              {lead.employeeName ?? "Unassigned"}
            </Text>
          </View>
          <Text style={styles.dateText}>{formatDate(lead.createdAt)}</Text>
        </View>
      </View>

      {canDelete ? (
        <TouchableOpacity
          style={styles.deleteBtn}
          onPress={(event) => {
            event.stopPropagation();
            onDelete(lead);
          }}
          hitSlop={8}
        >
          <Ionicons name="trash-outline" size={17} color={C.danger} />
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={C.border} />
      )}
    </TouchableOpacity>
  );
}

const MemoLeadCard = React.memo(LeadCard);

// ── AdminTeamView ──────────────────────────────────────────────────────────
// Three-level drill-down: Teams → Employees → Leads
// Uses listManagers (profiles) for teams and listUsers for employees per team,
// plus leadsQ for actual lead counts and data.

const MANAGER_ACCENT = "#8B5CF6";
const EMPLOYEE_ACCENT = "#1E4E8A";

type AdminViewLevel = "teams" | "employees" | "leads" | "all";

function AdminTeamView({
  topPad,
  bottomPad,
  leadsQ,
  adminView,
  setAdminView,
  selectedManager,
  setSelectedManager,
  selectedEmployee,
  setSelectedEmployee,
  renderLead,
  addLead,
  onTransferLeads,
  onExport,
  onViewAllLeads,
}: {
  topPad: number;
  bottomPad: number;
  leadsQ: ReturnType<typeof useQuery<Lead[]>>;
  adminView: AdminViewLevel;
  setAdminView: (v: AdminViewLevel) => void;
  selectedManager: { id: string; name: string } | null;
  setSelectedManager: (m: { id: string; name: string } | null) => void;
  selectedEmployee: { id: string; name: string } | null;
  setSelectedEmployee: (e: { id: string; name: string } | null) => void;
  renderLead: ({ item }: { item: Lead }) => React.ReactElement;
  addLead: () => void;
  onTransferLeads?: () => void;
  onExport?: (empId?: string) => void;
  onViewAllLeads: () => void;
}) {
  const allLeads = leadsQ.data ?? [];

  // Fetch all managers from profiles table
  const managersQ = useQuery<AppUser[]>({
    queryKey: ["managers"],
    queryFn: listManagers,
    staleTime: 5 * 60_000,
  });
  const allManagers = managersQ.data ?? [];

  // Fetch ALL users so we can filter employees by managerId
  const usersQ = useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: listUsers,
    staleTime: 5 * 60_000,
  });
  const allUsers = usersQ.data ?? [];

  // Employees under selected manager — from profiles (has manager_id FK)
  const employeesForManager = useMemo(() => {
    if (!selectedManager) return [];
    return allUsers
      .filter((u) => u.managerId === selectedManager.id || u.id === selectedManager.id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [allUsers, selectedManager]);

  // Leads for the selected employee (also catches leads where they are the assigned manager)
  const employeeLeads = useMemo(() => {
    if (!selectedEmployee) return [];
    if (selectedEmployee.id === "unassigned") {
      return allLeads.filter(l => !allManagers.some(m => l.managerId === m.id || l.employeeId === m.id))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
    return allLeads
      .filter((l) => l.employeeId === selectedEmployee.id || l.managerId === selectedEmployee.id)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allLeads, selectedEmployee, allManagers]);

  const isLoading = leadsQ.isLoading || managersQ.isLoading || usersQ.isLoading;
  const isFetching = leadsQ.isFetching;

  // ── SCREEN 3: Employee's leads list ─────────────────────────────────────
  if (adminView === "leads" && selectedEmployee && selectedManager) {
    const wonCount = employeeLeads.filter(l => l.status === "closed_won").length;
    const openCount = employeeLeads.filter(l => l.status !== "closed_won" && l.status !== "closed_lost").length;
    return (
      <View style={[atStyles.screen, { paddingTop: topPad }]}>
        <FlatList
          data={leadsQ.isLoading ? [] : employeeLeads}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderLead}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10 }}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={leadsQ.refetch} tintColor={C.brand} />}
          ListHeaderComponent={
            <View style={{ paddingTop: 14, paddingBottom: 10, gap: 12 }}>
              {/* Breadcrumb */}
              <View style={atStyles.breadcrumb}>
                <TouchableOpacity onPress={() => { setAdminView("teams"); setSelectedManager(null); setSelectedEmployee(null); }} hitSlop={8}>
                  <Text style={atStyles.crumbDim}>Teams</Text>
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={12} color={C.textSecondary} />
                <TouchableOpacity onPress={() => { setAdminView("employees"); setSelectedEmployee(null); }} hitSlop={8}>
                  <Text style={atStyles.crumbDim}>{selectedManager.name}</Text>
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={12} color={C.textSecondary} />
                <Text style={atStyles.crumbActive}>{selectedEmployee.name}</Text>
              </View>

              {/* Hero card */}
              <View style={[atStyles.heroCard, { borderLeftColor: EMPLOYEE_ACCENT }]}>
                <View style={[atStyles.heroAvatar, { backgroundColor: EMPLOYEE_ACCENT + "18" }]}>
                  <Text style={[atStyles.heroAvatarText, { color: EMPLOYEE_ACCENT }]}>
                    {selectedEmployee.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={atStyles.heroName}>{selectedEmployee.name}</Text>
                  <Text style={atStyles.heroSub}>under {selectedManager.name}'s team</Text>
                </View>
                {onExport && (
                  <TouchableOpacity style={[atStyles.heroAddBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, marginRight: 6 }]} onPress={() => onExport(selectedEmployee.id)} activeOpacity={0.88}>
                    <Ionicons name="download-outline" size={19} color={C.brand} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={atStyles.heroAddBtn} onPress={addLead} activeOpacity={0.88}>
                  <Ionicons name="add" size={20} color="#fff" />
                </TouchableOpacity>
              </View>

              {/* Mini stats */}
              <View style={atStyles.miniStats}>
                <View style={atStyles.miniStat}>
                  <Text style={[atStyles.miniStatNum, { color: C.brand }]}>{employeeLeads.length}</Text>
                  <Text style={atStyles.miniStatLabel}>Total</Text>
                </View>
                <View style={atStyles.miniStatDivider} />
                <View style={atStyles.miniStat}>
                  <Text style={[atStyles.miniStatNum, { color: C.warning }]}>{openCount}</Text>
                  <Text style={atStyles.miniStatLabel}>Open</Text>
                </View>
                <View style={atStyles.miniStatDivider} />
                <View style={atStyles.miniStat}>
                  <Text style={[atStyles.miniStatNum, { color: C.success }]}>{wonCount}</Text>
                  <Text style={atStyles.miniStatLabel}>Won</Text>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            leadsQ.isLoading ? (
              <View style={atStyles.loadBox}><ActivityIndicator size="large" color={C.brand} /><Text style={atStyles.loadText}>Loading leads...</Text></View>
            ) : (
              <View style={atStyles.emptyBox}>
                <View style={atStyles.emptyIconWrap}><Ionicons name="receipt-outline" size={32} color={C.brand} /></View>
                <Text style={atStyles.emptyTitle}>No leads yet</Text>
                <Text style={atStyles.emptySub}>This employee hasn't been assigned any leads.</Text>
              </View>
            )
          }
        />
      </View>
    );
  }

  // ── SCREEN 2: Employees in a manager's team ──────────────────────────────
  if (adminView === "employees" && selectedManager) {
    const teamTotalLeads = allLeads.filter(l => l.managerId === selectedManager.id || l.employeeId === selectedManager.id).length;
    return (
      <View style={[atStyles.screen, { paddingTop: topPad }]}>
        <FlatList
          data={employeesForManager}
          keyExtractor={(emp) => emp.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 10 }}
          refreshControl={<RefreshControl refreshing={isFetching || usersQ.isFetching} onRefresh={() => { leadsQ.refetch(); usersQ.refetch(); }} tintColor={C.brand} />}
          ListHeaderComponent={
            <View style={{ paddingTop: 14, paddingBottom: 10, gap: 12 }}>
              {/* Breadcrumb */}
              <View style={atStyles.breadcrumb}>
                <TouchableOpacity onPress={() => { setAdminView("teams"); setSelectedManager(null); }} hitSlop={8}>
                  <Text style={atStyles.crumbDim}>Teams</Text>
                </TouchableOpacity>
                <Ionicons name="chevron-forward" size={12} color={C.textSecondary} />
                <Text style={atStyles.crumbActive}>{selectedManager.name}</Text>
              </View>

              {/* Hero card */}
              <View style={[atStyles.heroCard, { borderLeftColor: MANAGER_ACCENT }]}>
                <View style={[atStyles.heroAvatar, { backgroundColor: MANAGER_ACCENT + "18" }]}>
                  <Text style={[atStyles.heroAvatarText, { color: MANAGER_ACCENT }]}>
                    {selectedManager.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={atStyles.heroName}>{selectedManager.name}'s Team</Text>
                  <Text style={atStyles.heroSub}>{employeesForManager.length} employee{employeesForManager.length === 1 ? "" : "s"} · {teamTotalLeads} lead{teamTotalLeads === 1 ? "" : "s"}</Text>
                </View>
              </View>

              <Text style={atStyles.sectionLabel}>TAP AN EMPLOYEE TO SEE THEIR LEADS</Text>
            </View>
          }
          renderItem={({ item: emp }) => {
            const empLeads = allLeads.filter(l => l.employeeId === emp.id);
            const empWon = empLeads.filter(l => l.status === "closed_won").length;
            const empOpen = empLeads.filter(l => l.status !== "closed_won" && l.status !== "closed_lost").length;
            const empHot = empLeads.filter(l => l.priority === "hot").length;
            return (
              <TouchableOpacity
                style={atStyles.empCard}
                activeOpacity={0.82}
                onPress={() => {
                  setSelectedEmployee({ id: emp.id, name: emp.name });
                  setAdminView("leads");
                  safeHaptic("selection");
                }}
              >
                <View style={[atStyles.empAvatar, { backgroundColor: EMPLOYEE_ACCENT + "14" }]}>
                  <Text style={[atStyles.empAvatarText, { color: EMPLOYEE_ACCENT }]}>{emp.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={atStyles.empName}>{emp.name}</Text>
                  {emp.designation ? <Text style={atStyles.empDesig}>{emp.designation}</Text> : null}
                  <View style={atStyles.empBadgeRow}>
                    {empHot > 0 && (
                      <View style={[atStyles.empBadge, { backgroundColor: "#FEF2F2" }]}>
                        <Ionicons name="flame" size={10} color={C.danger} />
                        <Text style={[atStyles.empBadgeText, { color: C.danger }]}>{empHot} hot</Text>
                      </View>
                    )}
                    <View style={[atStyles.empBadge, { backgroundColor: C.brand + "12" }]}>
                      <Text style={[atStyles.empBadgeText, { color: C.brand }]}>{empOpen} open</Text>
                    </View>
                    {empWon > 0 && (
                      <View style={[atStyles.empBadge, { backgroundColor: "#ECFDF5" }]}>
                        <Text style={[atStyles.empBadgeText, { color: C.success }]}>{empWon} won</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={atStyles.empLeadCount}>
                  <Text style={atStyles.empLeadNum}>{empLeads.length}</Text>
                  <Text style={atStyles.empLeadLbl}>leads</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textSecondary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            isLoading ? (
              <View style={atStyles.loadBox}><ActivityIndicator size="large" color={C.brand} /></View>
            ) : (
              <View style={atStyles.emptyBox}>
                <View style={atStyles.emptyIconWrap}><Ionicons name="person-outline" size={32} color={C.brand} /></View>
                <Text style={atStyles.emptyTitle}>No employees yet</Text>
                <Text style={atStyles.emptySub}>No leads have been assigned under this manager yet.</Text>
              </View>
            )
          }
        />
      </View>
    );
  }

  // ── SCREEN 1: All manager teams ──────────────────────────────────────────
  const totalLeads = allLeads.length;
  const totalOpen = allLeads.filter(l => l.status !== "closed_won" && l.status !== "closed_lost").length;
  const totalWon = allLeads.filter(l => l.status === "closed_won").length;
  const totalHot = allLeads.filter(l => l.priority === "hot").length;

  return (
    <View style={[atStyles.screen, { paddingTop: topPad }]}>
      <FlatList
        data={allManagers}
        keyExtractor={(m) => m.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad, gap: 12 }}
        refreshControl={<RefreshControl refreshing={isFetching || managersQ.isFetching} onRefresh={() => { leadsQ.refetch(); managersQ.refetch(); }} tintColor={C.brand} />}
        ListHeaderComponent={
          <View style={{ paddingTop: 14, paddingBottom: 6, gap: 14 }}>
            {/* Title row */}
            <View style={atStyles.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={atStyles.eyebrow}>CRM PIPELINE</Text>
                <Text style={atStyles.pageTitle}>Leads</Text>
                <Text style={atStyles.pageSub}>{totalLeads} total · {allManagers.length} team{allManagers.length === 1 ? "" : "s"}</Text>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {onTransferLeads && (
                  <TouchableOpacity style={[atStyles.addBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]} onPress={onTransferLeads} activeOpacity={0.88}>
                    <Ionicons name="swap-horizontal" size={21} color={C.brand} />
                  </TouchableOpacity>
                )}
                {onExport && (
                  <TouchableOpacity style={[atStyles.addBtn, { backgroundColor: C.card, borderWidth: 1, borderColor: C.border }]} onPress={() => onExport()} activeOpacity={0.88}>
                    <Ionicons name="download-outline" size={21} color={C.brand} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={atStyles.addBtn} onPress={addLead} activeOpacity={0.88}>
                  <Ionicons name="add" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Stats bar */}
            <View style={atStyles.statsBar}>
              <View style={atStyles.statItem}>
                <Text style={[atStyles.statNum, { color: C.brand }]}>{totalLeads}</Text>
                <Text style={atStyles.statLabel}>Total</Text>
              </View>
              <View style={atStyles.statDivider} />
              <View style={atStyles.statItem}>
                <Text style={[atStyles.statNum, { color: C.warning }]}>{totalOpen}</Text>
                <Text style={atStyles.statLabel}>Open</Text>
              </View>
              <View style={atStyles.statDivider} />
              <View style={atStyles.statItem}>
                <Text style={[atStyles.statNum, { color: C.danger }]}>{totalHot}</Text>
                <Text style={atStyles.statLabel}>Hot</Text>
              </View>
              <View style={atStyles.statDivider} />
              <View style={atStyles.statItem}>
                <Text style={[atStyles.statNum, { color: C.success }]}>{totalWon}</Text>
                <Text style={atStyles.statLabel}>Won</Text>
              </View>
            </View>

            <Text style={atStyles.sectionLabel}>TAP A TEAM TO SEE ITS MEMBERS</Text>

            {/* All Leads shortcut */}
            <TouchableOpacity style={atStyles.allLeadsBtn} onPress={onViewAllLeads} activeOpacity={0.85}>
              <Ionicons name="layers-outline" size={16} color={C.brand} />
              <Text style={atStyles.allLeadsBtnText}>View All Leads</Text>
              <Ionicons name="chevron-forward" size={15} color={C.brand} style={{ marginLeft: "auto" }} />
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item: manager }) => {
          const teamLeads = allLeads.filter(l => l.managerId === manager.id || l.employeeId === manager.id);
          const empCount = allUsers.filter(u => u.managerId === manager.id || u.id === manager.id).length;
          const teamWon = teamLeads.filter(l => l.status === "closed_won").length;
          const teamHot = teamLeads.filter(l => l.priority === "hot").length;
          const pct = totalLeads > 0 ? Math.round((teamLeads.length / totalLeads) * 100) : 0;
          return (
            <TouchableOpacity
              style={atStyles.teamCard}
              activeOpacity={0.82}
              onPress={() => {
                setSelectedManager({ id: manager.id, name: manager.name });
                setAdminView("employees");
                safeHaptic("selection");
              }}
            >
              <View style={[atStyles.teamAvatar, { backgroundColor: MANAGER_ACCENT + "18" }]}>
                <Text style={[atStyles.teamAvatarText, { color: MANAGER_ACCENT }]}>{manager.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <View style={atStyles.teamTitleRow}>
                  <Text style={atStyles.teamName}>{manager.name}'s Team</Text>
                  <Text style={atStyles.teamPct}>{pct}%</Text>
                </View>
                <View style={atStyles.teamMeta}>
                  <Ionicons name="people-outline" size={12} color={C.textSecondary} />
                  <Text style={atStyles.teamMetaText}>{empCount} employee{empCount === 1 ? "" : "s"}</Text>
                  <View style={atStyles.teamDot} />
                  <Ionicons name="layers-outline" size={12} color={C.textSecondary} />
                  <Text style={atStyles.teamMetaText}>{teamLeads.length} lead{teamLeads.length === 1 ? "" : "s"}</Text>
                  {teamHot > 0 && <><View style={atStyles.teamDot} /><Ionicons name="flame" size={12} color={C.danger} /><Text style={[atStyles.teamMetaText, { color: C.danger }]}>{teamHot} hot</Text></>}
                  {teamWon > 0 && <><View style={atStyles.teamDot} /><Ionicons name="trophy" size={12} color={C.success} /><Text style={[atStyles.teamMetaText, { color: C.success }]}>{teamWon} won</Text></>}
                </View>
                {/* Progress bar */}
                <View style={atStyles.progressTrack}>
                  <View style={[atStyles.progressFill, { width: `${pct}%` as any, backgroundColor: MANAGER_ACCENT }]} />
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.textSecondary} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          allManagers.length > 0 ? (() => {
            const unassignedLeads = allLeads.filter(l => !allManagers.some(m => l.managerId === m.id || l.employeeId === m.id));
            if (unassignedLeads.length === 0) return null;
            const uWon = unassignedLeads.filter(l => l.status === "closed_won").length;
            const uHot = unassignedLeads.filter(l => l.priority === "hot").length;
            return (
              <TouchableOpacity
                style={[atStyles.teamCard, { marginTop: 16 }]}
                activeOpacity={0.82}
                onPress={() => {
                  setSelectedManager({ id: "unassigned", name: "System" });
                  setSelectedEmployee({ id: "unassigned", name: "Unassigned / Admin Leads" });
                  setAdminView("leads");
                }}
              >
                <View style={[atStyles.teamAvatar, { backgroundColor: C.border + "40" }]}>
                  <Text style={[atStyles.teamAvatarText, { color: C.textSecondary }]}>U</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  <View style={atStyles.teamTitleRow}>
                    <Text style={atStyles.teamName}>Unassigned / Admin Leads</Text>
                  </View>
                  <View style={atStyles.teamMeta}>
                    <Ionicons name="layers-outline" size={12} color={C.textSecondary} />
                    <Text style={atStyles.teamMetaText}>{unassignedLeads.length} leads</Text>
                    {uHot > 0 && <><View style={atStyles.teamDot} /><Ionicons name="flame" size={12} color={C.danger} /><Text style={[atStyles.teamMetaText, { color: C.danger }]}>{uHot} hot</Text></>}
                    {uWon > 0 && <><View style={atStyles.teamDot} /><Ionicons name="trophy" size={12} color={C.success} /><Text style={[atStyles.teamMetaText, { color: C.success }]}>{uWon} won</Text></>}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color={C.textSecondary} style={{ marginLeft: 4 }} />
              </TouchableOpacity>
            );
          })() : null
        }
        ListEmptyComponent={
          isLoading ? (
            <View style={atStyles.loadBox}><ActivityIndicator size="large" color={C.brand} /><Text style={atStyles.loadText}>Loading teams...</Text></View>
          ) : (
            <View style={atStyles.emptyBox}>
              <View style={atStyles.emptyIconWrap}><Ionicons name="people-outline" size={36} color={C.brand} /></View>
              <Text style={atStyles.emptyTitle}>No teams yet</Text>
              <Text style={atStyles.emptySub}>Add managers and assign employees to build teams.</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const atStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F8FB" },
  breadcrumb: { flexDirection: "row", alignItems: "center", gap: 4 },
  crumbDim: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  crumbActive: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  // Hero card (manager / employee detail header)
  heroCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.card, borderRadius: 18, padding: 16,
    borderLeftWidth: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  heroAvatar: { width: 50, height: 50, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  heroAvatarText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  heroName: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  heroSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  heroAddBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  // Mini stats strip
  miniStats: { flexDirection: "row", backgroundColor: C.card, borderRadius: 14, padding: 14, alignItems: "center" },
  miniStat: { flex: 1, alignItems: "center" },
  miniStatNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  miniStatLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  miniStatDivider: { width: 1, height: 30, backgroundColor: C.border },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: C.textSecondary, letterSpacing: 0.8 },
  allLeadsBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.brand + "10", borderWidth: 1, borderColor: C.brand + "25",
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11,
  },
  allLeadsBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.brand, flex: 1 },
  // Employee card
  empCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.card, borderRadius: 16, padding: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  empAvatar: { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  empAvatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  empName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  empDesig: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  empBadgeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  empBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  empBadgeText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  empLeadCount: { alignItems: "center", marginRight: 2 },
  empLeadNum: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  empLeadLbl: { fontSize: 10, fontFamily: "Inter_400Regular", color: C.textSecondary },
  // Team card (teams screen)
  teamCard: {
    flexDirection: "row", alignItems: "center", gap: 14,
    backgroundColor: C.card, borderRadius: 18, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  teamAvatar: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  teamAvatarText: { fontSize: 22, fontFamily: "Inter_700Bold" },
  teamTitleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  teamName: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.text },
  teamPct: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  teamMeta: { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  teamMetaText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  teamDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.textSecondary },
  progressTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  // Page header (teams screen)
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  eyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.brand, letterSpacing: 0.8 },
  pageTitle: { marginTop: 2, fontSize: 30, fontFamily: "Inter_700Bold", color: C.text },
  pageSub: { marginTop: 3, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  addBtn: { width: 43, height: 43, borderRadius: 12, backgroundColor: C.brand, alignItems: "center", justifyContent: "center", marginTop: 6 },
  statsBar: {
    flexDirection: "row", backgroundColor: C.card, borderRadius: 16, padding: 16,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  statItem: { flex: 1, alignItems: "center" },
  statNum: { fontSize: 22, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  statDivider: { width: 1, height: 34, backgroundColor: C.border },
  // Shared empty / loading
  loadBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingTop: 60 },
  loadText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  emptyBox: { alignItems: "center", gap: 8, paddingTop: 60, paddingHorizontal: 28 },
  emptyIconWrap: { width: 68, height: 68, borderRadius: 20, backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  emptySub: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
});

export default function LeadsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterManager, setFilterManager] = useState("all");
  const [filterDate, setFilterDate] = useState("");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showFilterDatePicker, setShowFilterDatePicker] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [exportOverrideEmployeeId, setExportOverrideEmployeeId] = useState<string | null>(null);
  const [showFromDatePicker, setShowFromDatePicker] = useState(false);
  const [showToDatePicker, setShowToDatePicker] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Admin team-drill-down state
  const [adminView, setAdminView] = useState<"teams" | "employees" | "leads" | "all">(
    user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager" ? "teams" : "all"
  );
  const [selectedManager, setSelectedManager] = useState<{ id: string; name: string } | null>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<{ id: string; name: string } | null>(null);

  const role = user?.role ?? "employee";
  const isTransport = role === "transport" || user?.department?.toLowerCase() === "transport";
  const hasNoAccess = isTransport || role === "hr";
  const canDeleteLeads = role === "admin" || role === "super_admin" || role === "hr";
  const isAdmin = role === "admin" || role === "super_admin";
  const isManager = role === "manager";
  const canUsePeopleFilters = isAdmin || isManager;

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 96;
  const debouncedSearch = useDebounce(search, 220);

  const leadsQ = useQuery<Lead[]>({
    queryKey: ["leads"],
    queryFn: listLeads,
    enabled: !hasNoAccess,
    staleTime: 45_000,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteLead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      safeHaptic("success");
    },
    onError: (err: Error) => Alert.alert("Delete Failed", err.message || "Unable to delete lead"),
  });

  const allLeads = leadsQ.data ?? [];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allLeads.length };
    for (const lead of allLeads) {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    }
    return counts;
  }, [allLeads]);

  const employees = useMemo(() => {
    const map = new Map<string, string>();
    for (const lead of allLeads) {
      if (lead.employeeId && lead.employeeName) map.set(lead.employeeId, lead.employeeName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allLeads]);

  const managers = useMemo(() => {
    const map = new Map<string, string>();
    for (const lead of allLeads) {
      if (lead.managerId && lead.managerName) map.set(lead.managerId, lead.managerName);
    }
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [allLeads]);

  const filteredLeads = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    const filterStart = filterDate ? new Date(filterDate + "T00:00:00").getTime() : 0;
    const filterEnd = filterDate ? new Date(filterDate + "T23:59:59.999").getTime() : 0;

    return allLeads
      .filter((lead) => {
        const sourceLabel = lead.source ? (SOURCE_LABELS[lead.source] ?? lead.source).toLowerCase() : "";
        const searchable = [
          lead.name,
          lead.phone,
          lead.propertyInterest,
          lead.address,
          lead.employeeName,
          lead.managerName,
          lead.source,
          sourceLabel,
          lead.budget,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        const leadTime = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
        const dateMatch = !filterDate || (leadTime >= filterStart && leadTime <= filterEnd);

        return (
          (!q || searchable.includes(q)) &&
          (filterStatus === "all" || lead.status === filterStatus) &&
          (filterEmployee === "all" || lead.employeeId === filterEmployee) &&
          (filterManager === "all" || lead.managerId === filterManager) &&
          dateMatch
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allLeads, debouncedSearch, filterEmployee, filterManager, filterStatus, filterDate]);

  const summary = useMemo(() => {
    const open = allLeads.filter((lead) => lead.status !== "closed_won" && lead.status !== "closed_lost").length;
    const won = statusCounts.closed_won ?? 0;
    const hot = allLeads.filter((lead) => lead.priority === "hot").length;
    const followUps = (statusCounts.follow_up ?? 0) + (statusCounts.meeting_scheduled ?? 0);
    return { open, won, hot, followUps };
  }, [allLeads, statusCounts]);

  const activeFilterCount =
    (filterStatus !== "all" ? 1 : 0) + (filterEmployee !== "all" ? 1 : 0) + (filterManager !== "all" ? 1 : 0) + (filterDate ? 1 : 0) + (search.trim() ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch("");
    setFilterStatus("all");
    setFilterEmployee("all");
    setFilterManager("all");
    setFilterDate("");
  }, []);

  const leadsForExport = useMemo(() => {
    const base = exportOverrideEmployeeId
      ? allLeads.filter((l) => l.employeeId === exportOverrideEmployeeId)
      : filteredLeads;
    return base.filter((lead) => {
      const created = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
      const from = exportFromDate ? new Date(exportFromDate + "T00:00:00").getTime() : 0;
      const to = exportToDate ? new Date(exportToDate + "T23:59:59.999").getTime() : Infinity;
      return (!exportFromDate || created >= from) && (!exportToDate || created <= to);
    });
  }, [filteredLeads, allLeads, exportFromDate, exportToDate, exportOverrideEmployeeId]);

  const exportLeadsExcel = useCallback(async () => {
    if (leadsForExport.length === 0) {
      Alert.alert("No Leads", "There are no leads matching the selected filters to export.");
      return;
    }
    try {
      setExporting(true);
      const rows = leadsForExport.map((lead) => ({
        "Lead Name": lead.name ?? "",
        Phone: lead.phone ?? "",
        Email: lead.email ?? "",
        "Assigned Employee": lead.employeeName ?? "",
        "Manager": lead.managerName ?? "",
        Status: statusLabel(lead.status) ?? lead.status ?? "",
        Source: lead.source ?? "",
        Priority: lead.priority ?? "",
        "Follow-up Date": lead.followUpDate ?? "",
        Budget: lead.budget ?? "",
        "Property Interest": lead.propertyInterest ?? "",
        Address: lead.address ?? "",
        "Created At": lead.createdAt ? new Date(lead.createdAt).toLocaleString("en-IN") : "",
        "Updated At": lead.updatedAt ? new Date(lead.updatedAt).toLocaleString("en-IN") : "",
      }));

      const worksheet = XLSX.utils.json_to_sheet(rows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Leads");
      const xlsxArrayBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const fileName = `leads-export-${timestampForFileName()}.xlsx`;

      if (Platform.OS === "web") {
        const blob = new Blob(
          [xlsxArrayBuffer],
          { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
        );
        downloadBlobOnWeb(fileName, blob);
        Alert.alert("Exported", `Excel report downloaded with ${rows.length} lead(s).`);
      } else {
        // Mobile: write as base64 — the only reliable cross-platform method on Android + iOS
        const base64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
        const filePath = FileSystem.cacheDirectory + fileName;
        await FileSystem.writeAsStringAsync(filePath, base64, {
          encoding: "base64",
        });

        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(filePath, {
            mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            dialogTitle: "Export Leads",
            UTI: "com.microsoft.excel.xlsx",
          });
        } else {
          Alert.alert("Export Failed", "Sharing is not available on this device.");
        }
      }

      setShowExportModal(false);
    } catch (err) {
      Alert.alert("Export Failed", err instanceof Error ? err.message : "Unable to export Excel.");
    } finally {
      setExporting(false);
    }
  }, [leadsForExport]);

  // Declare once, used in both admin early-return and main return
  const exportModalNode = (
    <ExportModal
      visible={showExportModal}
      onClose={() => { setShowExportModal(false); setExportOverrideEmployeeId(null); }}
      onExport={exportLeadsExcel}
      exporting={exporting}
      fromDate={exportFromDate}
      setFromDate={setExportFromDate}
      toDate={exportToDate}
      setToDate={setExportToDate}
      showFromDatePicker={showFromDatePicker}
      setShowFromDatePicker={setShowFromDatePicker}
      showToDatePicker={showToDatePicker}
      setShowToDatePicker={setShowToDatePicker}
      leadsCount={leadsForExport.length}
      employees={employees}
      managers={managers}
      isAdmin={isAdmin}
      isManager={isManager}
      exportEmployeeId={exportOverrideEmployeeId}
      setExportEmployeeId={setExportOverrideEmployeeId}
    />
  );

  const confirmDeleteLead = useCallback(
    (lead: Lead) => {
      Alert.alert("Delete Lead", `Delete ${lead.name}? This action cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(lead.id) },
      ]);
    },
    [deleteMutation],
  );

  const openLead = useCallback((lead: Lead) => {
    safeHaptic("selection");
    router.push({ pathname: "/lead/[id]", params: { id: String(lead.id) } });
  }, []);

  const addLead = useCallback(() => {
    safeHaptic("impact");
    router.push("/add-lead");
  }, []);

  const renderLead = useCallback(
    ({ item }: { item: Lead }) => (
      <MemoLeadCard lead={item} canDelete={canDeleteLeads} onDelete={confirmDeleteLead} onPress={() => openLead(item)} />
    ),
    [canDeleteLeads, confirmDeleteLead, openLead],
  );

  if (hasNoAccess) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <View style={styles.lockIcon}>
          <Ionicons name="lock-closed-outline" size={30} color={C.brand} />
        </View>
        <Text style={styles.emptyTitle}>Leads not available</Text>
        <Text style={styles.emptySubtitle}>{role === "hr" ? "Your role does not have access to the leads pipeline." : "Your role is limited to tracking and trip visibility."}</Text>
      </View>
    );
  }

  // ── Admin team drill-down view ─────────────────────────────────────────────
  if (adminView === "teams" || adminView === "employees" || adminView === "leads") {
    return (
      <>
        <AdminTeamView
          topPad={topPad}
          bottomPad={bottomPad}
          leadsQ={leadsQ as any}
          adminView={adminView}
          setAdminView={setAdminView}
          selectedManager={selectedManager}
          setSelectedManager={setSelectedManager}
          selectedEmployee={selectedEmployee}
          setSelectedEmployee={setSelectedEmployee}
          renderLead={renderLead}
          addLead={addLead}
          onTransferLeads={isAdmin || isManager ? () => setShowTransferModal(true) : undefined}
          onExport={canUsePeopleFilters ? (empId?: string) => { setExportOverrideEmployeeId(empId ?? null); setShowExportModal(true); } : undefined}
          onViewAllLeads={() => { setAdminView("all"); setSelectedManager(null); setSelectedEmployee(null); }}
        />
        {exportModalNode}
        <LeadTransferModal
          visible={showTransferModal}
          onClose={() => setShowTransferModal(false)}
          allLeads={allLeads}
          refetchLeads={leadsQ.refetch}
        />
      </>
    );
  }
  // ── End admin team view ────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <FlatList
        data={leadsQ.isLoading ? [] : filteredLeads}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderLead}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "web"}
        refreshControl={<RefreshControl refreshing={leadsQ.isFetching} onRefresh={leadsQ.refetch} tintColor={C.brand} />}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            {isAdmin && adminView === "all" ? (
              <TouchableOpacity style={styles.backRow} onPress={() => setAdminView("teams")} activeOpacity={0.8}>
                <Ionicons name="chevron-back" size={16} color={C.brand} />
                <Text style={styles.backText}>Back to Teams</Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.eyebrow}>CRM PIPELINE</Text>
                <Text style={styles.title}>Leads</Text>
                <Text style={styles.subtitle}>
                  {allLeads.length} total lead{allLeads.length === 1 ? "" : "s"} · {filteredLeads.length} shown
                </Text>
              </View>
              <View style={styles.headerActions}>
                {canUsePeopleFilters ? (
                  <TouchableOpacity style={styles.iconButton} onPress={() => setShowFilterModal(true)} activeOpacity={0.85}>
                    <Ionicons name="filter" size={21} color={activeFilterCount > 0 ? C.brand : C.textSecondary} />
                    {activeFilterCount > 0 ? (
                      <View style={styles.filterBadge}>
                        <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ) : null}
                {(isAdmin || isManager) ? (
                  <TouchableOpacity style={styles.iconButton} onPress={() => setShowTransferModal(true)} activeOpacity={0.85}>
                    <Ionicons name="swap-horizontal" size={21} color={C.brand} />
                  </TouchableOpacity>
                ) : null}
                {canUsePeopleFilters ? (
                  <TouchableOpacity style={styles.iconButton} onPress={() => setShowExportModal(true)} activeOpacity={0.85}>
                    <Ionicons name="download-outline" size={21} color={C.brand} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.addButton} onPress={addLead} activeOpacity={0.88}>
                  <Ionicons name="add" size={24} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.summaryGrid}>
              <SummaryTile label="Open" value={summary.open} color={C.brand} icon="albums-outline" />
              <SummaryTile label="Hot" value={summary.hot} color={C.danger} icon="flame-outline" />
              <SummaryTile label="Follow-up" value={summary.followUps} color={C.warning} icon="calendar-outline" />
              <SummaryTile label="Won" value={summary.won} color={C.success} icon="trophy-outline" />
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={18} color={C.placeholder} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search name, phone, project, source..."
                placeholderTextColor={C.placeholder}
                value={search}
                onChangeText={setSearch}
                returnKeyType="search"
              />
              {search.length > 0 ? (
                <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={C.placeholder} />
                </TouchableOpacity>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusRail}>
              {STATUS_FILTERS.map((status) => {
                const color = status === "all" ? C.brand : statusColor(status);
                const active = filterStatus === status;
                return (
                  <TouchableOpacity
                    key={status}
                    style={[styles.statusChip, active && { backgroundColor: color, borderColor: color }]}
                    onPress={() => setFilterStatus(status)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{STATUS_LABELS[status]}</Text>
                    <View style={[styles.statusCount, active && styles.statusCountActive]}>
                      <Text style={[styles.statusCountText, active && styles.statusCountTextActive]}>{statusCounts[status] ?? 0}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {activeFilterCount > 0 ? (
              <View style={styles.activeFiltersRow}>
                <Text style={styles.activeFiltersText}>{activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"}</Text>
                <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {leadsQ.isError ? (
              <View style={styles.errorCard}>
                <Ionicons name="cloud-offline-outline" size={24} color={C.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.errorTitle}>Could not load leads</Text>
                  <Text style={styles.errorBody}>Check your connection and try again.</Text>
                </View>
                <TouchableOpacity style={styles.retryButton} onPress={() => leadsQ.refetch()}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          leadsQ.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator size="large" color={C.brand} />
              <Text style={styles.loadingText}>Loading leads...</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIcon}>
                <Ionicons name="people-outline" size={34} color={C.brand} />
              </View>
              <Text style={styles.emptyTitle}>{activeFilterCount > 0 ? "No matching leads" : "No leads yet"}</Text>
              <Text style={styles.emptySubtitle}>{activeFilterCount > 0 ? "Adjust filters or clear search to see more." : "Create your first lead to start the pipeline."}</Text>
              {activeFilterCount > 0 ? (
                <TouchableOpacity style={styles.emptyAction} onPress={clearFilters}>
                  <Text style={styles.emptyActionText}>Clear filters</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.emptyAction} onPress={addLead}>
                  <Ionicons name="add" size={18} color="#fff" />
                  <Text style={styles.emptyActionText}>Add Lead</Text>
                </TouchableOpacity>
              )}
            </View>
          )
        }
        ListFooterComponent={<View style={{ height: bottomPad }} />}
      />

      <FilterModal
        visible={showFilterModal}
        onClose={() => setShowFilterModal(false)}
        onReset={() => {
          setFilterStatus("all");
          setFilterEmployee("all");
          setFilterManager("all");
          setFilterDate("");
        }}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterEmployee={filterEmployee}
        setFilterEmployee={setFilterEmployee}
        filterManager={filterManager}
        setFilterManager={setFilterManager}
        filterDate={filterDate}
        setFilterDate={setFilterDate}
        showDatePicker={showFilterDatePicker}
        setShowDatePicker={setShowFilterDatePicker}
        employees={employees}
        managers={managers}
        isAdmin={isAdmin}
        isManager={isManager}
      />

      {exportModalNode}
      <LeadTransferModal
        visible={showTransferModal}
        onClose={() => setShowTransferModal(false)}
        allLeads={allLeads}
        refetchLeads={leadsQ.refetch}
      />
    </View>
  );
}

function SummaryTile({ label, value, color, icon }: { label: string; value: number; color: string; icon: React.ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <View style={styles.summaryTile}>
      <View style={[styles.summaryIcon, { backgroundColor: color + "15" }]}>
        <Ionicons name={icon} size={17} color={color} />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function FilterModal({
  visible,
  onClose,
  onReset,
  filterStatus,
  setFilterStatus,
  filterEmployee,
  setFilterEmployee,
  filterManager,
  setFilterManager,
  filterDate,
  setFilterDate,
  showDatePicker,
  setShowDatePicker,
  employees,
  managers,
  isAdmin,
  isManager,
}: {
  visible: boolean;
  onClose: () => void;
  onReset: () => void;
  filterStatus: StatusFilter;
  setFilterStatus: (status: StatusFilter) => void;
  filterEmployee: string;
  setFilterEmployee: (id: string) => void;
  filterManager: string;
  setFilterManager: (id: string) => void;
  filterDate: string;
  setFilterDate: (v: string) => void;
  showDatePicker: boolean;
  setShowDatePicker: (v: boolean) => void;
  employees: Array<[string, string]>;
  managers: Array<[string, string]>;
  isAdmin: boolean;
  isManager: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.exportOverlay}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalIconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Lead Filters</Text>
            <TouchableOpacity style={styles.resetButton} onPress={onReset}>
              <Text style={styles.resetText}>Reset</Text>
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
            <View style={{ gap: 8 }}>
              <Text style={styles.modalSectionTitle}>Date</Text>
              {Platform.OS === "web" ? (
                <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46, position: "relative", overflow: "hidden" }]}>
                  <Ionicons name="calendar-outline" size={16} color={filterDate ? C.text : C.placeholder} />
                  <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: filterDate ? C.text : C.placeholder }}>
                    {filterDate ? formatDisplayDate(filterDate) : "Any Date"}
                  </Text>
                  <input type="date" value={filterDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterDate(e.target.value)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" } as any} />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46, justifyContent: "space-between" }]}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="calendar-outline" size={16} color={filterDate ? C.brand : C.placeholder} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: filterDate ? C.text : C.placeholder }}>
                        {filterDate ? formatDisplayDate(filterDate) : "Any Date"}
                      </Text>
                    </View>
                    {filterDate ? (
                      <TouchableOpacity onPress={() => setFilterDate("")} hitSlop={8}>
                        <Ionicons name="close-circle" size={18} color={C.placeholder} />
                      </TouchableOpacity>
                    ) : (
                      <Ionicons name="chevron-down" size={16} color={C.textSecondary} />
                    )}
                  </TouchableOpacity>
                  <CustomDatePickerModal
                    visible={showDatePicker}
                    onClose={() => setShowDatePicker(false)}
                    onConfirm={(date) => { setFilterDate(date.toISOString().split("T")[0]); }}
                    initialDate={filterDate ? new Date(filterDate + "T00:00:00") : new Date()}
                    title="Select Date"
                  />
                </>
              )}
            </View>

            <FilterSection title="Status">
              {STATUS_FILTERS.map((status) => (
                <ModalChip key={status} active={filterStatus === status} label={STATUS_LABELS[status]} onPress={() => setFilterStatus(status)} />
              ))}
            </FilterSection>

            {isAdmin && managers.length > 0 ? (
              <FilterSection title="Manager">
                <ModalChip active={filterManager === "all"} label="All managers" onPress={() => setFilterManager("all")} />
                {managers.map(([id, name]) => (
                  <ModalChip key={id} active={filterManager === id} label={name} onPress={() => setFilterManager(filterManager === id ? "all" : id)} />
                ))}
              </FilterSection>
            ) : null}

            {(isAdmin || isManager) && employees.length > 0 ? (
              <FilterSection title="Employee">
                <ModalChip active={filterEmployee === "all"} label="All employees" onPress={() => setFilterEmployee("all")} />
                {employees.map(([id, name]) => (
                  <ModalChip key={id} active={filterEmployee === id} label={name} onPress={() => setFilterEmployee(filterEmployee === id ? "all" : id)} />
                ))}
              </FilterSection>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.modalSection}>
      <Text style={styles.modalSectionTitle}>{title}</Text>
      <View style={styles.modalChipGrid}>{children}</View>
    </View>
  );
}

function ModalChip({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.modalChip, active && styles.modalChipActive]} onPress={onPress} activeOpacity={0.85}>
      <Text style={[styles.modalChipText, active && styles.modalChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ExportModal({
  visible,
  onClose,
  onExport,
  exporting,
  fromDate,
  setFromDate,
  toDate,
  setToDate,
  showFromDatePicker,
  setShowFromDatePicker,
  showToDatePicker,
  setShowToDatePicker,
  leadsCount,
  employees,
  managers,
  isAdmin,
  isManager,
  exportEmployeeId,
  setExportEmployeeId,
}: {
  visible: boolean;
  onClose: () => void;
  onExport: () => void;
  exporting: boolean;
  fromDate: string;
  setFromDate: (v: string) => void;
  toDate: string;
  setToDate: (v: string) => void;
  showFromDatePicker: boolean;
  setShowFromDatePicker: (v: boolean) => void;
  showToDatePicker: boolean;
  setShowToDatePicker: (v: boolean) => void;
  leadsCount: number;
  employees: Array<[string, string]>;
  managers: Array<[string, string]>;
  isAdmin: boolean;
  isManager: boolean;
  exportEmployeeId: string | null;
  setExportEmployeeId: (id: string | null) => void;
}) {
  const [empDropOpen, setEmpDropOpen] = React.useState(false);

  // Quick preset helpers
  const applyPreset = (preset: string) => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (preset === "this_month") {
      setFromDate(fmt(new Date(today.getFullYear(), today.getMonth(), 1)));
      setToDate(fmt(today));
    } else if (preset === "last_month") {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      setFromDate(fmt(first));
      setToDate(fmt(last));
    } else if (preset === "last_7") {
      const d = new Date(today); d.setDate(d.getDate() - 6);
      setFromDate(fmt(d));
      setToDate(fmt(today));
    } else if (preset === "last_30") {
      const d = new Date(today); d.setDate(d.getDate() - 29);
      setFromDate(fmt(d));
      setToDate(fmt(today));
    } else if (preset === "this_year") {
      setFromDate(fmt(new Date(today.getFullYear(), 0, 1)));
      setToDate(fmt(today));
    } else if (preset === "all") {
      setFromDate("");
      setToDate("");
    }
  };

  const allPeople: Array<[string, string]> = React.useMemo(() => {
    const seen = new Set<string>();
    const out: Array<[string, string]> = [];
    for (const [id, name] of employees) {
      if (!seen.has(id)) { seen.add(id); out.push([id, name]); }
    }
    for (const [id, name] of managers) {
      if (!seen.has(id)) { seen.add(id); out.push([id, name]); }
    }
    return out.sort((a, b) => a[1].localeCompare(b[1]));
  }, [employees, managers]);

  const selectedPersonName = exportEmployeeId
    ? (allPeople.find(([id]) => id === exportEmployeeId)?.[1] ?? "Unknown")
    : "All employees";

  const presets = [
    { key: "this_month", label: "This Month" },
    { key: "last_month", label: "Last Month" },
    { key: "last_7", label: "Last 7 Days" },
    { key: "last_30", label: "Last 30 Days" },
    { key: "this_year", label: "This Year" },
    { key: "all", label: "All Time" },
  ];

  const dateRangeLabel =
    fromDate && toDate ? `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`
      : fromDate ? `From ${formatDisplayDate(fromDate)}`
        : toDate ? `Until ${formatDisplayDate(toDate)}`
          : "All time";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.exportOverlay}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalIconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Export Leads</Text>
            <View style={{ width: 38 }} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* ── Employee picker (admin / manager only) ─────────────────── */}
            {(isAdmin || isManager) && allPeople.length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.modalSectionTitle}>Employee</Text>
                <TouchableOpacity
                  style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 48 }]}
                  onPress={() => setEmpDropOpen((v) => !v)}
                  activeOpacity={0.85}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                    <Ionicons name="person-outline" size={17} color={exportEmployeeId ? C.text : C.placeholder} />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_500Medium", color: exportEmployeeId ? C.text : C.placeholder }} numberOfLines={1}>
                      {selectedPersonName}
                    </Text>
                  </View>
                  <Ionicons name={empDropOpen ? "chevron-up" : "chevron-down"} size={18} color={C.textSecondary} />
                </TouchableOpacity>

                {empDropOpen && (
                  <View style={styles.empDropdown}>
                    <TouchableOpacity
                      style={[styles.empDropItem, !exportEmployeeId && styles.empDropItemActive]}
                      onPress={() => { setExportEmployeeId(null); setEmpDropOpen(false); }}
                    >
                      <Ionicons name="people-outline" size={16} color={!exportEmployeeId ? C.brand : C.textSecondary} />
                      <Text style={[styles.empDropItemText, !exportEmployeeId && { color: C.brand, fontFamily: "Inter_600SemiBold" }]}>
                        All employees
                      </Text>
                      {!exportEmployeeId && <Ionicons name="checkmark" size={16} color={C.brand} style={{ marginLeft: "auto" }} />}
                    </TouchableOpacity>
                    {allPeople.map(([id, name]) => (
                      <TouchableOpacity
                        key={id}
                        style={[styles.empDropItem, exportEmployeeId === id && styles.empDropItemActive]}
                        onPress={() => { setExportEmployeeId(id); setEmpDropOpen(false); }}
                      >
                        <View style={styles.empDropAvatar}>
                          <Text style={styles.empDropAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                        </View>
                        <Text style={[styles.empDropItemText, exportEmployeeId === id && { color: C.brand, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                          {name}
                        </Text>
                        {exportEmployeeId === id && <Ionicons name="checkmark" size={16} color={C.brand} style={{ marginLeft: "auto" }} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            {/* ── Quick date presets ──────────────────────────────────────── */}
            <View style={{ gap: 8 }}>
              <Text style={styles.modalSectionTitle}>Quick Select</Text>
              <View style={styles.presetsGrid}>
                {presets.map((p) => {
                  const isActive =
                    p.key === "all" ? (!fromDate && !toDate)
                      : (() => {
                        const today = new Date();
                        const pad = (n: number) => String(n).padStart(2, "0");
                        const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                        if (p.key === "this_month") {
                          return fromDate === fmt(new Date(today.getFullYear(), today.getMonth(), 1)) && toDate === fmt(today);
                        }
                        if (p.key === "last_month") {
                          const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
                          const last = new Date(today.getFullYear(), today.getMonth(), 0);
                          return fromDate === fmt(first) && toDate === fmt(last);
                        }
                        if (p.key === "last_7") {
                          const d = new Date(today); d.setDate(d.getDate() - 6);
                          return fromDate === fmt(d) && toDate === fmt(today);
                        }
                        if (p.key === "last_30") {
                          const d = new Date(today); d.setDate(d.getDate() - 29);
                          return fromDate === fmt(d) && toDate === fmt(today);
                        }
                        if (p.key === "this_year") {
                          return fromDate === fmt(new Date(today.getFullYear(), 0, 1)) && toDate === fmt(today);
                        }
                        return false;
                      })();
                  return (
                    <TouchableOpacity
                      key={p.key}
                      style={[styles.presetChip, isActive && styles.presetChipActive]}
                      onPress={() => applyPreset(p.key)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.presetChipText, isActive && styles.presetChipTextActive]}>{p.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* ── Custom date range ───────────────────────────────────────── */}
            <View style={{ gap: 8 }}>
              <Text style={styles.modalSectionTitle}>Custom Date Range</Text>
              <View style={{ flexDirection: "row", gap: 10 }}>
                {/* From */}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary }}>From</Text>
                  {Platform.OS === "web" ? (
                    <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46, position: "relative", overflow: "hidden" }]}>
                      <Ionicons name="calendar-outline" size={16} color={fromDate ? C.text : C.placeholder} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: fromDate ? C.text : C.placeholder }}>
                        {fromDate ? formatDisplayDate(fromDate) : "Start"}
                      </Text>
                      <input type="date" value={fromDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFromDate(e.target.value)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" } as any} />
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46 }]}
                        onPress={() => setShowFromDatePicker(true)}
                      >
                        <Ionicons name="calendar-outline" size={16} color={fromDate ? C.brand : C.placeholder} />
                        <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: fromDate ? C.text : C.placeholder }}>
                          {fromDate ? formatDisplayDate(fromDate) : "Start date"}
                        </Text>
                      </TouchableOpacity>
                      <CustomDatePickerModal
                        visible={showFromDatePicker}
                        onClose={() => setShowFromDatePicker(false)}
                        onConfirm={(date) => { setFromDate(date.toISOString().split("T")[0]); }}
                        initialDate={fromDate ? new Date(fromDate + "T00:00:00") : new Date()}
                        title="Select Start Date"
                      />
                    </>
                  )}
                </View>
                {/* To */}
                <View style={{ flex: 1, gap: 5 }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary }}>To</Text>
                  {Platform.OS === "web" ? (
                    <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46, position: "relative", overflow: "hidden" }]}>
                      <Ionicons name="calendar-outline" size={16} color={toDate ? C.text : C.placeholder} />
                      <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: toDate ? C.text : C.placeholder }}>
                        {toDate ? formatDisplayDate(toDate) : "End"}
                      </Text>
                      <input type="date" value={toDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToDate(e.target.value)} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" } as any} />
                    </View>
                  ) : (
                    <>
                      <TouchableOpacity
                        style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 8, height: 46 }]}
                        onPress={() => setShowToDatePicker(true)}
                      >
                        <Ionicons name="calendar-outline" size={16} color={toDate ? C.brand : C.placeholder} />
                        <Text style={{ fontSize: 14, fontFamily: "Inter_400Regular", color: toDate ? C.text : C.placeholder }}>
                          {toDate ? formatDisplayDate(toDate) : "End date"}
                        </Text>
                      </TouchableOpacity>
                      <CustomDatePickerModal
                        visible={showToDatePicker}
                        onClose={() => setShowToDatePicker(false)}
                        onConfirm={(date) => { setToDate(date.toISOString().split("T")[0]); }}
                        initialDate={toDate ? new Date(toDate + "T00:00:00") : new Date()}
                        title="Select End Date"
                      />
                    </>
                  )}
                </View>
              </View>
              {/* Clear dates shortcut */}
              {(fromDate || toDate) ? (
                <TouchableOpacity onPress={() => { setFromDate(""); setToDate(""); }} style={{ alignSelf: "flex-end" }}>
                  <Text style={{ fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand }}>Clear dates</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* ── Summary card ───────────────────────────────────────────── */}
            <View style={styles.exportSummaryCard}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={styles.exportSummaryIcon}>
                  <Ionicons name="document-text-outline" size={20} color={C.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary }}>Ready to export</Text>
                  <Text style={{ fontSize: 22, fontFamily: "Inter_700Bold", color: C.text }}>{leadsCount} lead{leadsCount !== 1 ? "s" : ""}</Text>
                </View>
              </View>
              <View style={styles.exportSummaryDetails}>
                <View style={styles.exportSummaryRow}>
                  <Text style={styles.exportSummaryLabel}>Employee</Text>
                  <Text style={styles.exportSummaryValue} numberOfLines={1}>{selectedPersonName}</Text>
                </View>
                <View style={styles.exportSummaryRow}>
                  <Text style={styles.exportSummaryLabel}>Period</Text>
                  <Text style={styles.exportSummaryValue} numberOfLines={1}>{dateRangeLabel}</Text>
                </View>
                <View style={styles.exportSummaryRow}>
                  <Text style={styles.exportSummaryLabel}>Format</Text>
                  <Text style={styles.exportSummaryValue}>Excel (.xlsx)</Text>
                </View>
              </View>
            </View>
          </ScrollView>

          {/* Footer buttons */}
          <View style={{ paddingTop: 12, gap: 10 }}>
            <TouchableOpacity
              style={[styles.exportButton, (exporting || leadsCount === 0) && { opacity: 0.55 }]}
              onPress={onExport}
              activeOpacity={0.88}
              disabled={exporting || leadsCount === 0}
            >
              {exporting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="download-outline" size={18} color="#fff" />
                  <Text style={styles.exportButtonText}>
                    {leadsCount === 0 ? "No leads to export" : `Export ${leadsCount} Lead${leadsCount !== 1 ? "s" : ""} to Excel`}
                  </Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose} activeOpacity={0.85}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FB" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  listContent: { paddingHorizontal: 16, paddingBottom: 0, gap: 10, flexGrow: 1 },
  listHeader: { gap: 14, paddingTop: 14, paddingBottom: 4 },
  // back navigation row
  backRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 2 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.brand },
  // team / employee drill-down cards
  teamCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.card,
    borderRadius: 16, padding: 14, gap: 12,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  teamAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  teamAvatarText: { fontSize: 20, fontFamily: "Inter_700Bold" },
  teamInfo: { flex: 1 },
  teamName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  teamSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 14 },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.brand, letterSpacing: 0.8 },
  title: { marginTop: 2, fontSize: 30, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { marginTop: 3, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  headerActions: { flexDirection: "row", gap: 8, paddingTop: 6 },
  iconButton: {
    width: 43,
    height: 43,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  addButton: { width: 43, height: 43, borderRadius: 12, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  filterBadge: {
    position: "absolute",
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: C.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  filterBadgeText: { fontSize: 10, fontFamily: "Inter_700Bold", color: "#fff" },
  summaryGrid: { flexDirection: "row", gap: 8 },
  summaryTile: {
    flex: 1,
    minHeight: 86,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    justifyContent: "space-between",
  },
  summaryIcon: { width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  summaryValue: { fontSize: 20, fontFamily: "Inter_700Bold", color: C.text },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  searchBox: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", color: C.text, paddingVertical: 10 },
  statusRail: { gap: 8, paddingRight: 4 },
  statusChip: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  statusChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  statusChipTextActive: { color: "#fff" },
  statusCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: C.surfaceSecondary,
    alignItems: "center",
    justifyContent: "center",
  },
  statusCountActive: { backgroundColor: "rgba(255,255,255,0.24)" },
  statusCountText: { fontSize: 10, fontFamily: "Inter_700Bold", color: C.textSecondary },
  statusCountTextActive: { color: "#fff" },
  activeFiltersRow: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: C.brand + "10",
    borderWidth: 1,
    borderColor: C.brand + "25",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  activeFiltersText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
  clearButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.card },
  clearButtonText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.brand },
  errorCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    backgroundColor: C.danger + "10",
    borderWidth: 1,
    borderColor: C.danger + "25",
    padding: 14,
  },
  errorTitle: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  errorBody: { marginTop: 2, fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  retryButton: { borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.card },
  retryText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.danger },
  leadCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 13,
  },
  leadAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  leadAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  leadBody: { flex: 1, gap: 7 },
  leadTopRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  leadTitleWrap: { flex: 1 },
  leadName: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  leadPhone: { marginTop: 2, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  statusPill: { maxWidth: 112, borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  statusPillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  leadInfoRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  leadInfoText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  leadMetaWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaChip: {
    minHeight: 25,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceSecondary,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaDot: { width: 6, height: 6, borderRadius: 3 },
  metaChipText: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.textSecondary },
  leadFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  ownerWrap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  ownerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  dateText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  deleteBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.danger + "12", alignItems: "center", justifyContent: "center" },
  loadingState: { minHeight: 240, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  emptyState: { minHeight: 260, alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 24 },
  emptyIcon: { width: 68, height: 68, borderRadius: 20, backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  emptyAction: {
    marginTop: 8,
    minHeight: 42,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: C.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyActionText: { fontSize: 14, fontFamily: "Inter_700Bold", color: "#fff" },
  lockIcon: { width: 70, height: 70, borderRadius: 22, backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  fieldInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    borderWidth: 1,
    borderColor: C.border,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  filterSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  filterSummaryLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  filterSummaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text, textAlign: "right", flexShrink: 1 },
  exportButton: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: C.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  exportButtonText: { fontSize: 15, fontFamily: "Inter_700Bold", color: "#fff" },
  cancelButton: {
    minHeight: 44,
    borderRadius: 14,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: { fontSize: 15, fontFamily: "Inter_700Bold", color: C.textSecondary },
  exportOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  modal: { backgroundColor: "#F6F8FB", paddingHorizontal: 18, paddingBottom: 18, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: "90%", minHeight: "55%" },
  // employee dropdown
  empDropdown: {
    backgroundColor: C.card, borderRadius: 14, borderWidth: 1, borderColor: C.border,
    overflow: "hidden", marginTop: 2,
  },
  empDropItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.background,
  },
  empDropItemActive: { backgroundColor: C.brand + "0D" },
  empDropItemText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, flex: 1 },
  empDropAvatar: { width: 26, height: 26, borderRadius: 8, backgroundColor: C.brand + "18", alignItems: "center", justifyContent: "center" },
  empDropAvatarText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.brand },
  // quick preset chips
  presetsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  presetChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  presetChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  presetChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  presetChipTextActive: { color: "#fff" },
  // summary card
  exportSummaryCard: {
    backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.border,
    padding: 16, gap: 12,
  },
  exportSummaryIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: C.brand + "14",
    alignItems: "center", justifyContent: "center",
  },
  exportSummaryDetails: { gap: 6, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 10 },
  exportSummaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  exportSummaryLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  exportSummaryValue: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.text, flexShrink: 1, textAlign: "right" },
  modalHeader: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  modalIconButton: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.card, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text },
  resetButton: { minWidth: 58, alignItems: "flex-end" },
  resetText: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.brand },
  modalContent: { gap: 18, paddingTop: 8, paddingBottom: 34 },
  modalSection: { gap: 10 },
  modalSectionTitle: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.textSecondary, letterSpacing: 0.8, textTransform: "uppercase" },
  modalChipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  modalChip: { borderRadius: 999, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: 13, paddingVertical: 9 },
  modalChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  modalChipText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  modalChipTextActive: { color: "#fff" },
});