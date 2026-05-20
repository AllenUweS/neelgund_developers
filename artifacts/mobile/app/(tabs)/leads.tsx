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
import * as XLSX from "xlsx";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { deleteLead, listLeads } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { PRIORITY_COLORS, PRIORITY_LABELS, SOURCE_LABELS, statusColor, statusLabel } from "@/lib/utils";
import { useDebounce } from "@/hooks/useDebounce";

const C = Colors.light;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

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
  const now = initialDate || new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(now.getDate());

  useEffect(() => {
    if (visible && initialDate) {
      setYear(initialDate.getFullYear());
      setMonth(initialDate.getMonth());
      setDay(initialDate.getDate());
    }
  }, [visible, initialDate]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const Spinner = ({
    value,
    min,
    max,
    onChange,
    label,
    formatter,
  }: {
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
    label: string;
    formatter?: (v: number) => string;
  }) => (
    <View style={dpStyles.spinnerCol}>
      <Text style={dpStyles.spinnerLabel}>{label}</Text>
      <TouchableOpacity
        style={dpStyles.spinnerBtn}
        onPress={() => onChange(value >= max ? min : value + 1)}
      >
        <Ionicons name="chevron-up" size={18} color={C.brand} />
      </TouchableOpacity>
      <View style={dpStyles.spinnerValueBox}>
        <Text style={dpStyles.spinnerValue}>
          {formatter ? formatter(value) : pad(value)}
        </Text>
      </View>
      <TouchableOpacity
        style={dpStyles.spinnerBtn}
        onPress={() => onChange(value <= min ? max : value - 1)}
      >
        <Ionicons name="chevron-down" size={18} color={C.brand} />
      </TouchableOpacity>
    </View>
  );

  const handleConfirm = () => {
    const safeDay = Math.min(day, daysInMonth);
    const date = new Date(year, month, safeDay, 0, 0, 0, 0);
    onConfirm(date);
    onClose();
  };

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

          <View style={dpStyles.spinnersRow}>
            {/* Day */}
            <Spinner
              value={day}
              min={1}
              max={daysInMonth}
              onChange={setDay}
              label="Day"
            />
            <View style={dpStyles.spinnerSep} />
            {/* Month */}
            <Spinner
              value={month}
              min={0}
              max={11}
              onChange={setMonth}
              label="Month"
              formatter={(v) => MONTHS[v]}
            />
            <View style={dpStyles.spinnerSep} />
            {/* Year */}
            <Spinner
              value={year}
              min={new Date().getFullYear() - 5}
              max={new Date().getFullYear() + 5}
              onChange={setYear}
              label="Year"
              formatter={(v) => String(v)}
            />
          </View>

          <View style={dpStyles.divider} />

          <View style={dpStyles.previewRow}>
            <Ionicons name="time-outline" size={14} color={C.brand} />
            <Text style={dpStyles.previewText}>
              {`${day} ${MONTHS[month]} ${year}`}
            </Text>
          </View>

          <View style={dpStyles.sheetActions}>
            <TouchableOpacity style={dpStyles.cancelBtn} onPress={onClose}>
              <Text style={dpStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dpStyles.confirmBtn} onPress={handleConfirm}>
              <Text style={dpStyles.confirmBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
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
  spinnersRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  spinnerCol: {
    alignItems: "center",
    minWidth: 44,
  },
  spinnerLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#64748B",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  spinnerBtn: {
    padding: 6,
  },
  spinnerValueBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 44,
    alignItems: "center",
  },
  spinnerValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#0F172A",
  },
  spinnerSep: {
    width: 6,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  previewText: {
    fontSize: 13,
    color: "#2563EB",
    fontFamily: "Inter_600SemiBold",
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#64748B",
  },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
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
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
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

export default function LeadsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterEmployee, setFilterEmployee] = useState("all");
  const [filterManager, setFilterManager] = useState("all");
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFromDate, setExportFromDate] = useState("");
  const [exportToDate, setExportToDate] = useState("");
  const [showFromDatePicker, setShowFromDatePicker] = useState(false);
  const [showToDatePicker, setShowToDatePicker] = useState(false);
  const [exporting, setExporting] = useState(false);

  const role = user?.role ?? "employee";
  const isTransport = role === "transport" || user?.department?.toLowerCase() === "transport";
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
    enabled: !isTransport,
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

        return (
          (!q || searchable.includes(q)) &&
          (filterStatus === "all" || lead.status === filterStatus) &&
          (filterEmployee === "all" || lead.employeeId === filterEmployee) &&
          (filterManager === "all" || lead.managerId === filterManager)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allLeads, debouncedSearch, filterEmployee, filterManager, filterStatus]);

  const summary = useMemo(() => {
    const open = allLeads.filter((lead) => lead.status !== "closed_won" && lead.status !== "closed_lost").length;
    const won = statusCounts.closed_won ?? 0;
    const hot = allLeads.filter((lead) => lead.priority === "hot").length;
    const followUps = (statusCounts.follow_up ?? 0) + (statusCounts.meeting_scheduled ?? 0);
    return { open, won, hot, followUps };
  }, [allLeads, statusCounts]);

  const activeFilterCount =
    (filterStatus !== "all" ? 1 : 0) + (filterEmployee !== "all" ? 1 : 0) + (filterManager !== "all" ? 1 : 0) + (search.trim() ? 1 : 0);

  const clearFilters = useCallback(() => {
    setSearch("");
    setFilterStatus("all");
    setFilterEmployee("all");
    setFilterManager("all");
  }, []);

  const leadsForExport = useMemo(() => {
    return filteredLeads.filter((lead) => {
      const created = lead.createdAt ? new Date(lead.createdAt).getTime() : 0;
      const from = exportFromDate ? new Date(exportFromDate + "T00:00:00").getTime() : 0;
      const to = exportToDate ? new Date(exportToDate + "T23:59:59.999").getTime() : Infinity;
      return (!exportFromDate || created >= from) && (!exportToDate || created <= to);
    });
  }, [filteredLeads, exportFromDate, exportToDate]);

  const exportLeadsExcel = useCallback(() => {
    if (Platform.OS !== "web") {
      Alert.alert("Web Only", "Excel export is currently available on web admin.");
      return;
    }
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
      const blob = new Blob(
        [xlsxArrayBuffer],
        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      );
      downloadBlobOnWeb(`leads-export-${timestampForFileName()}.xlsx`, blob);
      Alert.alert("Exported", `Excel report downloaded with ${rows.length} lead(s).`);
      setShowExportModal(false);
    } catch (err) {
      Alert.alert("Export Failed", err instanceof Error ? err.message : "Unable to export Excel.");
    } finally {
      setExporting(false);
    }
  }, [leadsForExport]);

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

  if (isTransport) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <View style={styles.lockIcon}>
          <Ionicons name="lock-closed-outline" size={30} color={C.brand} />
        </View>
        <Text style={styles.emptyTitle}>Leads not available</Text>
        <Text style={styles.emptySubtitle}>Your role is limited to tracking and trip visibility.</Text>
      </View>
    );
  }

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
                    <Ionicons name="options-outline" size={21} color={C.brand} />
                    {activeFilterCount > 0 ? (
                      <View style={styles.filterBadge}>
                        <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
                      </View>
                    ) : null}
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={styles.iconButton} onPress={() => setShowExportModal(true)} activeOpacity={0.85}>
                  <Ionicons name="download-outline" size={21} color={C.brand} />
                </TouchableOpacity>
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
        }}
        filterStatus={filterStatus}
        setFilterStatus={setFilterStatus}
        filterEmployee={filterEmployee}
        setFilterEmployee={setFilterEmployee}
        filterManager={filterManager}
        setFilterManager={setFilterManager}
        employees={employees}
        managers={managers}
        isAdmin={isAdmin}
        isManager={isManager}
      />

      <ExportModal
        visible={showExportModal}
        onClose={() => setShowExportModal(false)}
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
        filterStatus={filterStatus}
        filterEmployee={filterEmployee}
        filterManager={filterManager}
        employees={employees}
        managers={managers}
        isAdmin={isAdmin}
        isManager={isManager}
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
  employees: Array<[string, string]>;
  managers: Array<[string, string]>;
  isAdmin: boolean;
  isManager: boolean;
}) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
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
  filterStatus,
  filterEmployee,
  filterManager,
  employees,
  managers,
  isAdmin,
  isManager,
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
  filterStatus: StatusFilter;
  filterEmployee: string;
  filterManager: string;
  employees: Array<[string, string]>;
  managers: Array<[string, string]>;
  isAdmin: boolean;
  isManager: boolean;
}) {
  const employeeName = employees.find(([id]) => id === filterEmployee)?.[1];
  const managerName = managers.find(([id]) => id === filterManager)?.[1];

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="formSheet" onRequestClose={onClose}>
      <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity style={styles.modalIconButton} onPress={onClose}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Export Leads</Text>
          <View style={{ width: 58 }} />
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalContent}>
          <View style={{ gap: 16 }}>
            <View style={{ gap: 10 }}>
              <Text style={styles.modalSectionTitle}>Date Range</Text>

              {/* From Date */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary }}>From Date</Text>
                {Platform.OS === "web" ? (
                  <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10, position: "relative", overflow: "hidden" }]}>
                    <Ionicons name="calendar-outline" size={18} color={fromDate ? C.text : C.placeholder} />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: fromDate ? C.text : C.placeholder }}>
                      {fromDate ? formatDisplayDate(fromDate) : "Select start date"}
                    </Text>
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFromDate(e.target.value)}
                      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" } as any}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10 }]}
                      onPress={() => setShowFromDatePicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={fromDate ? C.text : C.placeholder} />
                      <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: fromDate ? C.text : C.placeholder }}>
                        {fromDate ? formatDisplayDate(fromDate) : "Select start date"}
                      </Text>
                    </TouchableOpacity>
                    <CustomDatePickerModal
                      visible={showFromDatePicker}
                      onClose={() => setShowFromDatePicker(false)}
                      onConfirm={(date) => {
                        const iso = date.toISOString().split("T")[0];
                        setFromDate(iso);
                      }}
                      initialDate={fromDate ? new Date(fromDate + "T00:00:00") : new Date()}
                      title="Select From Date"
                    />
                  </>
                )}
              </View>

              {/* To Date */}
              <View style={{ gap: 6 }}>
                <Text style={{ fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary }}>To Date</Text>
                {Platform.OS === "web" ? (
                  <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10, position: "relative", overflow: "hidden" }]}>
                    <Ionicons name="calendar-outline" size={18} color={toDate ? C.text : C.placeholder} />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: toDate ? C.text : C.placeholder }}>
                      {toDate ? formatDisplayDate(toDate) : "Select end date"}
                    </Text>
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setToDate(e.target.value)}
                      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: "pointer" } as any}
                    />
                  </View>
                ) : (
                  <>
                    <TouchableOpacity
                      style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10 }]}
                      onPress={() => setShowToDatePicker(true)}
                    >
                      <Ionicons name="calendar-outline" size={18} color={toDate ? C.text : C.placeholder} />
                      <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: toDate ? C.text : C.placeholder }}>
                        {toDate ? formatDisplayDate(toDate) : "Select end date"}
                      </Text>
                    </TouchableOpacity>
                    <CustomDatePickerModal
                      visible={showToDatePicker}
                      onClose={() => setShowToDatePicker(false)}
                      onConfirm={(date) => {
                        const iso = date.toISOString().split("T")[0];
                        setToDate(iso);
                      }}
                      initialDate={toDate ? new Date(toDate + "T00:00:00") : new Date()}
                      title="Select To Date"
                    />
                  </>
                )}
              </View>
            </View>

            {/* Active Filters Summary */}
            <View style={{ gap: 10 }}>
              <Text style={styles.modalSectionTitle}>Applied Filters</Text>
              <View style={{ gap: 6 }}>
                <View style={styles.filterSummaryRow}>
                  <Text style={styles.filterSummaryLabel}>Status</Text>
                  <Text style={styles.filterSummaryValue}>{STATUS_LABELS[filterStatus]}</Text>
                </View>
                {(isAdmin || isManager) && employees.length > 0 ? (
                  <View style={styles.filterSummaryRow}>
                    <Text style={styles.filterSummaryLabel}>Employee</Text>
                    <Text style={styles.filterSummaryValue}>{employeeName ?? "All employees"}</Text>
                  </View>
                ) : null}
                {isAdmin && managers.length > 0 ? (
                  <View style={styles.filterSummaryRow}>
                    <Text style={styles.filterSummaryLabel}>Manager</Text>
                    <Text style={styles.filterSummaryValue}>{managerName ?? "All managers"}</Text>
                  </View>
                ) : null}
                <View style={styles.filterSummaryRow}>
                  <Text style={styles.filterSummaryLabel}>Date Range</Text>
                  <Text style={styles.filterSummaryValue}>
                    {fromDate && toDate
                      ? `${formatDisplayDate(fromDate)} – ${formatDisplayDate(toDate)}`
                      : fromDate
                      ? `From ${formatDisplayDate(fromDate)}`
                      : toDate
                      ? `Until ${formatDisplayDate(toDate)}`
                      : "All time"}
                  </Text>
                </View>
                <View style={[styles.filterSummaryRow, { marginTop: 4 }]}>
                  <Text style={styles.filterSummaryLabel}>Matching Leads</Text>
                  <Text style={[styles.filterSummaryValue, { fontFamily: "Inter_700Bold", color: C.brand }]}>{leadsCount}</Text>
                </View>
              </View>
            </View>
          </View>
        </ScrollView>

        <View style={{ paddingTop: 12, gap: 10 }}>
          <TouchableOpacity
            style={[styles.exportButton, exporting && { opacity: 0.6 }]}
            onPress={onExport}
            activeOpacity={0.88}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="download-outline" size={18} color="#fff" />
                <Text style={styles.exportButtonText}>Export to Excel</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FB" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28 },
  listContent: { paddingHorizontal: 16, paddingBottom: 0, gap: 10 },
  listHeader: { gap: 14, paddingTop: 14, paddingBottom: 4 },
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
  modal: { flex: 1, backgroundColor: "#F6F8FB", paddingHorizontal: 18, paddingBottom: 18 },
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

