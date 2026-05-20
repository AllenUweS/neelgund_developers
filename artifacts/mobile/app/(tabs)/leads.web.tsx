import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { listLeads } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { statusColor, statusLabel, PRIORITY_COLORS, PRIORITY_LABELS, SOURCE_LABELS } from "@/lib/utils";

const C = {
  brand: "#1B4F8A",
  accent: "#F4A820",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  background: "#F0F4F9",
  card: "#FFFFFF",
  border: "#E2E8F0",
  text: "#0F1923",
  textSecondary: "#64748B",
};

const STATUS_FILTERS = ["all", "new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"] as const;
const STATUS_LABELS: Record<string, string> = {
  all: "All", new: "New", not_contacted: "Not Contacted", follow_up: "Follow Up",
  meeting_scheduled: "Meeting", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost",
};
type StatusFilter = (typeof STATUS_FILTERS)[number];

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.length === 1 ? parts[0][0].toUpperCase() : `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export default function LeadsWebScreen() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");

  const role = user?.role ?? "employee";
  const isTransport = role === "transport";
  const canDelete = role === "admin" || role === "super_admin" || role === "hr";

  const leadsQ = useQuery<Lead[]>({
    queryKey: ["leads"],
    queryFn: listLeads,
    enabled: !isTransport,
    staleTime: 45_000,
  });

  const allLeads = leadsQ.data ?? [];

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allLeads.length };
    for (const lead of allLeads) counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    return counts;
  }, [allLeads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allLeads.filter((lead) => {
      const matchSearch = !q || [lead.name, lead.phone, lead.propertyInterest, lead.employeeName, lead.source]
        .filter(Boolean).join(" ").toLowerCase().includes(q);
      const matchStatus = filterStatus === "all" || lead.status === filterStatus;
      return matchSearch && matchStatus;
    }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allLeads, search, filterStatus]);

  const summary = useMemo(() => ({
    open: allLeads.filter(l => l.status !== "closed_won" && l.status !== "closed_lost").length,
    won: statusCounts.closed_won ?? 0,
    hot: allLeads.filter(l => l.priority === "hot").length,
    followUp: (statusCounts.follow_up ?? 0) + (statusCounts.meeting_scheduled ?? 0),
  }), [allLeads, statusCounts]);

  if (isTransport) {
    return (
      <View style={styles.root}>

        <View style={[styles.main, { alignItems: "center", justifyContent: "center" }]}>
          <Ionicons name="lock-closed-outline" size={36} color={C.brand} />
          <Text style={{ fontSize: 18, fontWeight: "700", color: C.text, marginTop: 12 }}>Leads unavailable</Text>
          <Text style={{ color: C.textSecondary, marginTop: 6 }}>Your role is limited to tracking.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>

      <View style={styles.main}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.pageTitle}>Leads</Text>
            <Text style={styles.pageSubtitle}>{allLeads.length} total · {filtered.length} shown</Text>
          </View>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.exportBtn} onPress={() => {}}>
              <Ionicons name="download-outline" size={16} color={C.brand} />
              <Text style={styles.exportBtnText}>Export</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => router.push("/add-lead")}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnText}>Add Lead</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Summary tiles */}
          <View style={styles.summaryRow}>
            {[
              { label: "Open", value: summary.open, color: C.brand, icon: "albums-outline" as const },
              { label: "Hot", value: summary.hot, color: C.danger, icon: "flame-outline" as const },
              { label: "Follow-up", value: summary.followUp, color: C.warning, icon: "calendar-outline" as const },
              { label: "Won", value: summary.won, color: C.success, icon: "trophy-outline" as const },
            ].map((tile) => (
              <View key={tile.label} style={[styles.summaryTile, { borderLeftColor: tile.color }]}>
                <View style={[styles.summaryIcon, { backgroundColor: tile.color + "15" }]}>
                  <Ionicons name={tile.icon} size={16} color={tile.color} />
                </View>
                <Text style={styles.summaryVal}>{tile.value}</Text>
                <Text style={styles.summaryLbl}>{tile.label}</Text>
              </View>
            ))}
          </View>

          {/* Filters */}
          <View style={styles.filtersRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={16} color={C.textSecondary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search name, phone, property, agent..."
                placeholderTextColor={C.textSecondary}
                value={search}
                onChangeText={setSearch}
              />
              {search.length > 0 && (
                <TouchableOpacity onPress={() => setSearch("")}>
                  <Ionicons name="close-circle" size={16} color={C.textSecondary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Status chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
            {STATUS_FILTERS.map((s) => {
              const active = filterStatus === s;
              const color = s === "all" ? C.brand : statusColor(s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}
                  onPress={() => setFilterStatus(s)}
                >
                  <Text style={[styles.chipText, active && { color: "#fff" }]}>{STATUS_LABELS[s]}</Text>
                  <View style={[styles.chipBadge, active && { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                    <Text style={[styles.chipBadgeText, active && { color: "#fff" }]}>
                      {statusCounts[s] ?? 0}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Table */}
          <View style={styles.tableCard}>
            {/* Header */}
            <View style={styles.tableHead}>
              <Text style={[styles.th, { flex: 2.5 }]}>LEAD</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>PHONE</Text>
              <Text style={[styles.th, { flex: 1.5 }]}>ASSIGNED TO</Text>
              <Text style={[styles.th, { flex: 1 }]}>PRIORITY</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>STATUS</Text>
              <Text style={[styles.th, { flex: 1 }]}>CREATED</Text>
              <Text style={[styles.th, { width: 36 }]}> </Text>
            </View>

            {leadsQ.isLoading ? (
              <View style={styles.loadingState}>
                <Text style={{ color: C.textSecondary }}>Loading leads...</Text>
              </View>
            ) : filtered.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="people-outline" size={32} color={C.border} />
                <Text style={styles.emptyText}>No leads found</Text>
              </View>
            ) : (
              filtered.map((lead, i) => {
                const sc = statusColor(lead.status);
                const pc = lead.priority ? PRIORITY_COLORS[lead.priority] : null;
                return (
                  <TouchableOpacity
                    key={lead.id}
                    style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
                    onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
                    activeOpacity={0.75}
                  >
                    {/* Lead */}
                    <View style={[styles.td, { flex: 2.5, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                      <View style={[styles.avatar, { backgroundColor: sc + "18" }]}>
                        <Text style={[styles.avatarText, { color: sc }]}>{initials(lead.name)}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.leadName} numberOfLines={1}>{lead.name}</Text>
                        {lead.propertyInterest && (
                          <Text style={styles.leadProp} numberOfLines={1}>{lead.propertyInterest}</Text>
                        )}
                      </View>
                    </View>
                    {/* Phone */}
                    <View style={[styles.td, { flex: 1.2 }]}>
                      <Text style={styles.tdText} numberOfLines={1}>{lead.phone}</Text>
                    </View>
                    {/* Assigned */}
                    <View style={[styles.td, { flex: 1.5, flexDirection: "row", alignItems: "center", gap: 6 }]}>
                      {lead.employeeName ? (
                        <>
                          <View style={styles.assigneeAvatar}>
                            <Text style={styles.assigneeAvatarText}>{lead.employeeName.charAt(0).toUpperCase()}</Text>
                          </View>
                          <Text style={styles.assigneeName} numberOfLines={1}>{lead.employeeName}</Text>
                        </>
                      ) : (
                        <Text style={[styles.tdText, { color: C.border }]}>Unassigned</Text>
                      )}
                    </View>
                    {/* Priority */}
                    <View style={[styles.td, { flex: 1 }]}>
                      {pc && lead.priority ? (
                        <View style={[styles.priorityChip, { backgroundColor: pc + "15", borderColor: pc + "30" }]}>
                          <View style={[styles.priorityDot, { backgroundColor: pc }]} />
                          <Text style={[styles.priorityText, { color: pc }]}>
                            {PRIORITY_LABELS[lead.priority] ?? lead.priority}
                          </Text>
                        </View>
                      ) : <Text style={styles.tdMuted}>—</Text>}
                    </View>
                    {/* Status */}
                    <View style={[styles.td, { flex: 1.2 }]}>
                      <View style={[styles.statusPill, { backgroundColor: sc + "15", borderColor: sc + "30" }]}>
                        <View style={[styles.statusDot, { backgroundColor: sc }]} />
                        <Text style={[styles.statusPillText, { color: sc }]}>{statusLabel(lead.status)}</Text>
                      </View>
                    </View>
                    {/* Created */}
                    <View style={[styles.td, { flex: 1 }]}>
                      <Text style={styles.tdMuted}>{formatDate(lead.createdAt)}</Text>
                    </View>
                    {/* Arrow */}
                    <View style={[styles.td, { width: 36, alignItems: "center" }]}>
                      <Ionicons name="chevron-forward" size={15} color={C.border} />
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: C.background },
  main: { flex: 1, marginLeft: 0, flexDirection: "column", height: "100vh" as any },
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
  pageSubtitle: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  topActions: { flexDirection: "row", gap: 10 },
  exportBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    backgroundColor: C.brand + "10", borderWidth: 1, borderColor: C.brand + "30",
  },
  exportBtnText: { fontSize: 13, fontWeight: "600", color: C.brand },
  addBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: C.brand,
    shadowColor: C.brand, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8,
  },
  addBtnText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 28, gap: 20 },
  summaryRow: { flexDirection: "row", gap: 14 },
  summaryTile: {
    flex: 1, backgroundColor: C.card, borderRadius: 12, padding: 16,
    borderLeftWidth: 3, gap: 4,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
  },
  summaryIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  summaryVal: { fontSize: 22, fontWeight: "800", color: C.text },
  summaryLbl: { fontSize: 11, fontWeight: "600", color: C.textSecondary },
  filtersRow: { flexDirection: "row", gap: 12 },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: C.card, borderRadius: 10, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, color: C.text, outlineStyle: "none" } as any,
  chipsRow: { gap: 8, paddingBottom: 2 },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  chipText: { fontSize: 12, fontWeight: "600", color: C.textSecondary },
  chipBadge: {
    backgroundColor: C.background, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 1,
  },
  chipBadgeText: { fontSize: 10, fontWeight: "700", color: C.textSecondary },
  tableCard: {
    backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 12,
  },
  tableHead: {
    flexDirection: "row", paddingHorizontal: 20, paddingVertical: 11,
    backgroundColor: C.background, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  th: { fontSize: 10, fontWeight: "700", color: C.textSecondary, letterSpacing: 0.8 },
  tableRow: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tableRowAlt: { backgroundColor: "#F8FAFC" },
  td: {},
  tdText: { fontSize: 13, color: C.text },
  tdMuted: { fontSize: 12, color: C.textSecondary },
  avatar: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 12, fontWeight: "700" },
  leadName: { fontSize: 13, fontWeight: "700", color: C.text },
  leadProp: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  assigneeAvatar: {
    width: 22, height: 22, borderRadius: 6, backgroundColor: C.brand + "20",
    alignItems: "center", justifyContent: "center",
  },
  assigneeAvatarText: { fontSize: 9, fontWeight: "700", color: C.brand },
  assigneeName: { fontSize: 12, color: C.text, flex: 1 },
  priorityChip: {
    flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start",
  },
  priorityDot: { width: 5, height: 5, borderRadius: 3 },
  priorityText: { fontSize: 10, fontWeight: "700" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 20, borderWidth: 1,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: "flex-start",
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10, fontWeight: "700" },
  loadingState: { paddingVertical: 40, alignItems: "center" },
  emptyState: { paddingVertical: 50, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 14, color: C.textSecondary },
});
