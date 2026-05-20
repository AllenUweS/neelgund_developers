import React, { useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import {
  getDashboardStats,
  getRecentLeads,
  getHotLeadsToday,
  listLeaderboard,
} from "@/lib/api";
import type { LeaderboardEntry, Lead, DashboardStats } from "@/lib/types";
import { statusColor, statusLabel, greeting, PRIORITY_COLORS } from "@/lib/utils";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

const C = {
  brand: "#1B4F8A",
  brandDark: "#0D2F5A",
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

function StatCard({
  label,
  value,
  icon,
  color,
  delta,
}: {
  label: string;
  value: number | string;
  icon: IoniconsName;
  color: string;
  delta?: string;
}) {
  return (
    <View style={[styles.statCard, { borderTopColor: color }]}>
      <View style={styles.statCardTop}>
        <View style={[styles.statIconWrap, { backgroundColor: color + "15" }]}>
          <Ionicons name={icon} size={20} color={color} />
        </View>
        {delta && (
          <View style={[styles.deltaBadge, { backgroundColor: C.success + "15" }]}>
            <Ionicons name="trending-up" size={11} color={C.success} />
            <Text style={[styles.deltaText, { color: C.success }]}>{delta}</Text>
          </View>
        )}
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={[styles.statBar, { backgroundColor: color + "15" }]}>
        <View style={[styles.statBarFill, { backgroundColor: color, width: "65%" }]} />
      </View>
    </View>
  );
}

function LeaderboardRow({
  entry,
  rank,
}: {
  entry: LeaderboardEntry;
  rank: number;
}) {
  const medals = ["#F4A820", "#94A3B8", "#CD7F32"];
  const medalColor = rank <= 3 ? medals[rank - 1] : C.textSecondary;
  const pct = entry.totalLeads > 0 ? Math.min((entry.closedWon / entry.totalLeads) * 100, 100) : 0;

  return (
    <View style={[styles.lbRow, rank === 1 && styles.lbRowGold]}>
      <View style={[styles.lbRankWrap, { backgroundColor: medalColor + "18" }]}>
        {rank <= 3 ? (
          <Ionicons name="trophy" size={13} color={medalColor} />
        ) : (
          <Text style={[styles.lbRankNum, { color: medalColor }]}>{rank}</Text>
        )}
      </View>
      <View style={styles.lbAvatarCircle}>
        <Text style={styles.lbAvatarText}>
          {entry.employeeName?.charAt(0).toUpperCase() ?? "?"}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.lbName} numberOfLines={1}>{entry.employeeName}</Text>
        <View style={styles.lbBarTrack}>
          <View style={[styles.lbBarFill, { width: `${pct}%` as any, backgroundColor: medalColor }]} />
        </View>
      </View>
      <View style={styles.lbNums}>
        <Text style={styles.lbTotal}>{entry.totalLeads}</Text>
        <Text style={styles.lbWon}>{entry.closedWon}W</Text>
      </View>
    </View>
  );
}

export default function DashboardWebScreen() {
  const { user } = useAuth();

  const statsQ = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 30_000,
  });

  const recentLeadsQ = useQuery<Lead[]>({
    queryKey: ["recent-leads"],
    queryFn: () => getRecentLeads(8),
    staleTime: 60_000,
  });

  const hotLeadsQ = useQuery<Lead[]>({
    queryKey: ["hot-leads-today"],
    queryFn: () => getHotLeadsToday(10),
    staleTime: 60_000,
  });

  const lbQ = useQuery<LeaderboardEntry[]>({
    queryKey: ["leaderboard"],
    queryFn: listLeaderboard,
    staleTime: 5 * 60_000,
  });

  const stats = statsQ.data ?? { totalLeads: 0, newLeads: 0, closedWon: 0, meetings: 0, hotLeads: 0 };
  const recentLeads = recentLeadsQ.data ?? [];
  const hotLeads = hotLeadsQ.data ?? [];
  const leaderboard = lbQ.data ?? [];

  const onRefresh = useCallback(() => {
    statsQ.refetch();
    recentLeadsQ.refetch();
    hotLeadsQ.refetch();
    lbQ.refetch();
  }, []);

  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  return (
    <View style={styles.root}>

      <View style={styles.main}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.greetingText}>{greeting()}, {user?.name?.split(" ")[0]}</Text>
            <Text style={styles.dateText}>{today}</Text>
          </View>
          <View style={styles.topBarRight}>
            <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
              <Ionicons name="refresh-outline" size={18} color={C.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.addLeadTopBtn} onPress={() => router.push("/add-lead")}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addLeadTopText}>Add Lead</Text>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Stat Cards */}
          <View style={styles.statsRow}>
            <StatCard
              label="Total Leads"
              value={stats.totalLeads}
              icon="people"
              color={C.brand}
              delta="+12%"
            />
            <StatCard
              label="New Leads"
              value={stats.newLeads}
              icon="add-circle"
              color={C.accent}
            />
            <StatCard
              label="Meetings"
              value={stats.meetings ?? (stats as any).meetingsScheduled ?? 0}
              icon="calendar"
              color="#8B5CF6"
            />
            <StatCard
              label="Closed Won"
              value={stats.closedWon}
              icon="checkmark-circle"
              color={C.success}
              delta="+8%"
            />
            <StatCard
              label="Hot Today"
              value={stats.hotLeads ?? (stats as any).hotLeadsToday ?? 0}
              icon="flame"
              color={C.danger}
            />
          </View>

          {/* Main grid */}
          <View style={styles.gridRow}>
            {/* Recent Leads Table */}
            <View style={styles.leadsPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Recent Leads</Text>
                  <Text style={styles.panelSub}>{recentLeads.length} leads shown</Text>
                </View>
                <TouchableOpacity
                  style={styles.seeAllBtn}
                  onPress={() => router.push("/(tabs)/leads" as any)}
                >
                  <Text style={styles.seeAllText}>View all</Text>
                  <Ionicons name="arrow-forward" size={13} color={C.brand} />
                </TouchableOpacity>
              </View>

              {/* Table Header */}
              <View style={styles.tableHead}>
                <Text style={[styles.thCell, { flex: 2 }]}>LEAD</Text>
                <Text style={[styles.thCell, { flex: 1 }]}>ASSIGNED TO</Text>
                <Text style={[styles.thCell, { flex: 1 }]}>STATUS</Text>
                <Text style={[styles.thCell, { width: 32 }]}> </Text>
              </View>

              {recentLeads.length === 0 && !recentLeadsQ.isLoading ? (
                <View style={styles.emptyTableState}>
                  <Ionicons name="people-outline" size={28} color={C.border} />
                  <Text style={styles.emptyTableText}>No recent leads</Text>
                </View>
              ) : (
                recentLeads.map((lead, i) => {
                  const sc = statusColor(lead.status);
                  return (
                    <TouchableOpacity
                      key={lead.id}
                      style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}
                      onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
                      activeOpacity={0.75}
                    >
                      <View style={[styles.tdCell, { flex: 2, flexDirection: "row", alignItems: "center", gap: 10 }]}>
                        <View style={[styles.leadAvatar, { backgroundColor: sc + "18" }]}>
                          <Text style={[styles.leadAvatarText, { color: sc }]}>
                            {lead.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.leadName} numberOfLines={1}>{lead.name}</Text>
                          {lead.propertyInterest && (
                            <Text style={styles.leadSub} numberOfLines={1}>{lead.propertyInterest}</Text>
                          )}
                        </View>
                      </View>
                      <View style={[styles.tdCell, { flex: 1 }]}>
                        <Text style={styles.assignedText} numberOfLines={1}>
                          {lead.employeeName ?? "—"}
                        </Text>
                      </View>
                      <View style={[styles.tdCell, { flex: 1 }]}>
                        <View style={[styles.statusChip, { backgroundColor: sc + "15", borderColor: sc + "30" }]}>
                          <View style={[styles.statusDot, { backgroundColor: sc }]} />
                          <Text style={[styles.statusChipText, { color: sc }]}>{statusLabel(lead.status)}</Text>
                        </View>
                      </View>
                      <View style={[styles.tdCell, { width: 32, alignItems: "center" }]}>
                        <Ionicons name="chevron-forward" size={15} color={C.border} />
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            {/* Leaderboard */}
            <View style={styles.lbPanel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Leaderboard</Text>
                  <Text style={styles.panelSub}>This month's top performers</Text>
                </View>
                <View style={[styles.trophyBadge]}>
                  <Ionicons name="trophy" size={14} color={C.accent} />
                </View>
              </View>

              {leaderboard.length === 0 && !lbQ.isLoading ? (
                <View style={styles.emptyTableState}>
                  <Ionicons name="trophy-outline" size={28} color={C.border} />
                  <Text style={styles.emptyTableText}>No data yet</Text>
                </View>
              ) : (
                leaderboard.slice(0, 8).map((entry, i) => (
                  <LeaderboardRow key={entry.employeeId} entry={entry} rank={i + 1} />
                ))
              )}
            </View>
          </View>

          {/* Hot Leads Row */}
          {hotLeads.length > 0 && (
            <View style={styles.hotSection}>
              <View style={styles.hotSectionHeader}>
                <View style={styles.hotTitleRow}>
                  <View style={styles.hotPulse} />
                  <Text style={styles.hotTitle}>Hot Leads Today</Text>
                  <View style={[styles.hotCount, { backgroundColor: C.danger + "15" }]}>
                    <Text style={[styles.hotCountText, { color: C.danger }]}>{hotLeads.length}</Text>
                  </View>
                </View>
                <TouchableOpacity onPress={() => router.push("/(tabs)/leads" as any)}>
                  <Text style={styles.seeAllText}>See all</Text>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
                {hotLeads.map((lead) => {
                  const sc = statusColor(lead.status);
                  return (
                    <TouchableOpacity
                      key={lead.id}
                      style={styles.hotCard}
                      onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.hotCardAvatar, { backgroundColor: C.danger + "15" }]}>
                        <Text style={[styles.hotCardAvatarText, { color: C.danger }]}>
                          {lead.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.hotCardName} numberOfLines={1}>{lead.name}</Text>
                      {lead.propertyInterest && (
                        <Text style={styles.hotCardProp} numberOfLines={1}>{lead.propertyInterest}</Text>
                      )}
                      <View style={[styles.hotCardStatus, { backgroundColor: sc + "15" }]}>
                        <Text style={[styles.hotCardStatusText, { color: sc }]}>{statusLabel(lead.status)}</Text>
                      </View>
                      {lead.priority && PRIORITY_COLORS[lead.priority] && (
                        <View style={[styles.priorityTag, { backgroundColor: PRIORITY_COLORS[lead.priority] + "15" }]}>
                          <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[lead.priority] }]} />
                          <Text style={[styles.priorityText, { color: PRIORITY_COLORS[lead.priority] }]}>
                            {lead.priority.toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}
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
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  greetingText: { fontSize: 18, fontWeight: "700", color: C.text },
  dateText: { fontSize: 12, color: C.textSecondary, marginTop: 2 },
  topBarRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.background,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
  },
  addLeadTopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: C.brand,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: C.brand,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
  },
  addLeadTopText: { fontSize: 13, fontWeight: "700", color: "#fff" },
  scroll: { flex: 1 },
  scrollContent: { padding: 28, gap: 24, maxWidth: 1300, alignSelf: "center", width: "100%" as any },

  // Stats
  statsRow: { flexDirection: "row", gap: 16 },
  statCard: {
    flex: 1,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 20,
    borderTopWidth: 3,
    borderTopColor: C.brand,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    gap: 6,
  },
  statCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  statIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  deltaBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 20, paddingHorizontal: 7, paddingVertical: 3 },
  deltaText: { fontSize: 10, fontWeight: "700" },
  statValue: { fontSize: 28, fontWeight: "800", color: C.text, letterSpacing: -1 },
  statLabel: { fontSize: 12, fontWeight: "500", color: C.textSecondary },
  statBar: { height: 4, borderRadius: 2, marginTop: 8, overflow: "hidden" },
  statBarFill: { height: 4, borderRadius: 2 },

  // Grid
  gridRow: { flexDirection: "row", gap: 20 },
  leadsPanel: {
    flex: 3,
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  lbPanel: {
    flex: 1.6,
    backgroundColor: C.card,
    borderRadius: 14,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  panelTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  panelSub: { fontSize: 11, color: C.textSecondary, marginTop: 2 },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontSize: 12, fontWeight: "600", color: C.brand },
  trophyBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "#F4A82015",
    alignItems: "center",
    justifyContent: "center",
  },
  tableHead: {
    flexDirection: "row",
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: C.background,
  },
  thCell: { fontSize: 10, fontWeight: "700", color: C.textSecondary, letterSpacing: 0.8 },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  tableRowAlt: { backgroundColor: "#F8FAFC" },
  tdCell: { flexDirection: "row", alignItems: "center" },
  leadAvatar: { width: 34, height: 34, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  leadAvatarText: { fontSize: 13, fontWeight: "700" },
  leadName: { fontSize: 13, fontWeight: "600", color: C.text },
  leadSub: { fontSize: 11, color: C.textSecondary, marginTop: 1 },
  assignedText: { fontSize: 12, color: C.textSecondary },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusChipText: { fontSize: 10, fontWeight: "700" },
  emptyTableState: { paddingVertical: 40, alignItems: "center", gap: 8 },
  emptyTableText: { fontSize: 13, color: C.textSecondary },

  // Leaderboard
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    gap: 10,
  },
  lbRowGold: { backgroundColor: "#F4A82008" },
  lbRankWrap: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  lbRankNum: { fontSize: 12, fontWeight: "700" },
  lbAvatarCircle: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  lbAvatarText: { fontSize: 12, fontWeight: "700", color: C.brand },
  lbName: { fontSize: 12, fontWeight: "600", color: C.text, marginBottom: 4 },
  lbBarTrack: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: "hidden" },
  lbBarFill: { height: 4, borderRadius: 2 },
  lbNums: { alignItems: "flex-end" },
  lbTotal: { fontSize: 14, fontWeight: "800", color: C.text },
  lbWon: { fontSize: 10, fontWeight: "600", color: C.success },

  // Hot Leads
  hotSection: { gap: 14 },
  hotSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  hotTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  hotPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.danger,
  },
  hotTitle: { fontSize: 15, fontWeight: "700", color: C.text },
  hotCount: { borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2 },
  hotCountText: { fontSize: 11, fontWeight: "700" },
  hotCard: {
    width: 160,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    gap: 7,
    borderWidth: 1,
    borderColor: C.danger + "25",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  hotCardAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hotCardAvatarText: { fontSize: 15, fontWeight: "700" },
  hotCardName: { fontSize: 13, fontWeight: "700", color: C.text },
  hotCardProp: { fontSize: 11, color: C.textSecondary },
  hotCardStatus: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start" },
  hotCardStatusText: { fontSize: 10, fontWeight: "700" },
  priorityTag: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, alignSelf: "flex-start" },
  priorityDot: { width: 5, height: 5, borderRadius: 3 },
  priorityText: { fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
});
