import React, { useCallback, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { router } from "expo-router";
import { Platform } from "react-native";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { getAttendanceToday, getDashboardStats, getRecentLeads, getHotLeadsToday, listLeaderboard } from "@/lib/api";
import type { LeaderboardEntry, Lead, AttendanceRecord, DashboardStats } from "@/lib/types";
import { statusColor, statusLabel, greeting, PRIORITY_COLORS } from "@/lib/utils";
import { Skeleton, StatCardSkeleton, LeadRowSkeleton, HotCardSkeleton, LeaderboardRowSkeleton } from "@/components/Skeleton";

type IoniconsName = ComponentProps<typeof Ionicons>["name"];

const C = Colors.light;

const StatCard = React.memo(function StatCard({ label, value, icon, color }: { label: string; value: number | string; icon: IoniconsName; color: string }) {
  return (
    <LinearGradient
      colors={[color + "22", color + "08"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.statCard, { borderLeftColor: color }]}
    >
      <View style={[styles.statIcon, { backgroundColor: color + "30" }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </LinearGradient>
  );
});

const LeaderboardRow = React.memo(function LeaderboardRow({ entry, isTop }: { entry: LeaderboardEntry; isTop: boolean }) {
  const rankColors = ["#F4A820", "#94A3B8", "#CD7F32"];
  const rankColor = entry.rank <= 3 ? rankColors[entry.rank - 1] : C.textSecondary;

  return (
    <View style={[styles.lbRow, isTop && styles.lbRowTop]}>
      <View style={[styles.lbRank, { backgroundColor: rankColor + "20" }]}>
        <Text style={[styles.lbRankText, { color: rankColor }]}>{entry.rank}</Text>
      </View>
      <Text style={styles.lbName} numberOfLines={1}>{entry.employeeName}</Text>
      <View style={styles.lbStats}>
        <Text style={styles.lbTotal}>{entry.totalLeads}</Text>
        <Text style={styles.lbWon}>{entry.closedWon} won</Text>
      </View>
    </View>
  );
});

export default function DashboardScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, logout } = useAuth();
  const isWide = width > 500;

  const statsQ = useQuery<DashboardStats>({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
    staleTime: 30_000,
  });

  const recentLeadsQ = useQuery<Lead[]>({
    queryKey: ["recent-leads"],
    queryFn: () => getRecentLeads(5),
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

  const attendanceQ = useQuery<AttendanceRecord | null>({
    queryKey: ["attendance-today"],
    queryFn: getAttendanceToday,
    enabled: user?.role === "employee" || user?.role === "transport",
    staleTime: 30_000,
  });

  const isLoading = statsQ.isLoading || recentLeadsQ.isLoading || hotLeadsQ.isLoading || lbQ.isLoading;
  const stats = statsQ.data ?? { totalLeads: 0, newLeads: 0, closedWon: 0, meetings: 0, hotLeads: 0 };
  const recentLeads = recentLeadsQ.data ?? [];
  const hotLeads = hotLeadsQ.data ?? [];
  const leaderboard = lbQ.data ?? [];
  const todayRecord = attendanceQ.data;

  const onRefresh = useCallback(() => {
    statsQ.refetch();
    recentLeadsQ.refetch();
    hotLeadsQ.refetch();
    lbQ.refetch();
    attendanceQ.refetch();
  }, []);

  const topPad = useMemo(() => insets.top + (Platform.OS === "web" ? 67 : 0), [insets.top]);
  const bottomPad = useMemo(() => insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90, [insets.bottom]);

  const hasCheckedIn = !!todayRecord?.checkInTime;
  const hasCheckedOut = !!todayRecord?.checkOutTime;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad, paddingHorizontal: isWide ? 24 : 16, gap: 20 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={statsQ.isFetching || recentLeadsQ.isFetching || hotLeadsQ.isFetching || lbQ.isFetching || attendanceQ.isFetching}
          onRefresh={onRefresh}
          tintColor={C.brand}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarInitial}>{user?.name?.charAt(0)?.toUpperCase() ?? "?"}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>{greeting()},</Text>
          <Text style={styles.userName} numberOfLines={1}>{user?.name}</Text>
          <Text style={styles.dateText}>
            {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>{user?.role?.toUpperCase()}</Text>
          </View>
          <TouchableOpacity onPress={logout} style={styles.logoutBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="log-out-outline" size={20} color={C.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Attendance Quick Card */}
      {(user?.role === "employee" || user?.role === "transport") && (
        isLoading ? (
          <Skeleton width="100%" height={56} borderRadius={14} />
        ) : (
          <TouchableOpacity
            style={[
              styles.attendanceCard,
              hasCheckedIn && !hasCheckedOut && { borderColor: C.success + "40", backgroundColor: C.success + "08" },
              hasCheckedOut && { borderColor: C.brand + "30" },
            ]}
            onPress={() => router.push("/(tabs)/attendance")}
            activeOpacity={0.85}
          >
            <View style={[styles.attendanceDot, {
              backgroundColor: hasCheckedOut ? C.success : hasCheckedIn ? C.warning : C.danger,
            }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.attendanceLabel}>
                {hasCheckedOut
                  ? "Checked out for today"
                  : hasCheckedIn
                  ? "Checked in — don't forget to check out"
                  : "Not checked in yet"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.border} />
          </TouchableOpacity>
        )
      )}

      {/* Stats Grid */}
      <View style={[styles.statsGrid, isWide && { flexDirection: "row", flexWrap: "wrap" }]}>
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Total Leads" value={stats.totalLeads} icon="people" color={C.brand} />
            <StatCard label="New" value={stats.newLeads} icon="add-circle" color={C.accent} />
            <StatCard label="Meetings" value={stats.meetings} icon="calendar" color="#8B5CF6" />
            <StatCard label="Closed Won" value={stats.closedWon} icon="checkmark-circle" color={C.success} />
          </>
        )}
      </View>

      {/* Hot Leads Row */}
      {(isLoading || hotLeads.length > 0) && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleRow}>
              <View style={[styles.hotDot, { backgroundColor: C.danger }]} />
              <Text style={styles.sectionTitle}>Hot Leads</Text>
            </View>
            {!isLoading && (
              <TouchableOpacity onPress={() => router.push("/(tabs)/leads")} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}>
                <Text style={styles.seeAll}>See all</Text>
              </TouchableOpacity>
            )}
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12 }}>
            {isLoading ? (
              <>
                <HotCardSkeleton />
                <HotCardSkeleton />
                <HotCardSkeleton />
              </>
            ) : (
              hotLeads.map(lead => (
                <TouchableOpacity
                  key={lead.id}
                  style={styles.hotCard}
                  onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
                  activeOpacity={0.85}
                >
                  <View style={[styles.hotAvatar, { backgroundColor: C.danger + "18" }]}>
                    <Text style={[styles.hotAvatarText, { color: C.danger }]}>{lead.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.hotName} numberOfLines={1}>{lead.name}</Text>
                  {lead.propertyInterest ? (
                    <Text style={styles.hotProp} numberOfLines={1}>{lead.propertyInterest}</Text>
                  ) : null}
                  <View style={[styles.hotStatus, { backgroundColor: statusColor(lead.status) + "18" }]}>
                    <Text style={[styles.hotStatusText, { color: statusColor(lead.status) }]}>{statusLabel(lead.status)}</Text>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        {isLoading ? (
          <Skeleton width="100%" height={52} borderRadius={16} />
        ) : (
          <TouchableOpacity style={styles.addLeadBtn} onPress={() => router.push("/add-lead")} activeOpacity={0.85}>
            <Ionicons name="add" size={22} color="#FFFFFF" />
            <Text style={styles.addLeadText}>Add New Lead</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Leaderboard */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Leaderboard</Text>
        <View style={styles.lbCard}>
          {isLoading ? (
            <>
              <LeaderboardRowSkeleton />
              <LeaderboardRowSkeleton />
              <LeaderboardRowSkeleton />
              <LeaderboardRowSkeleton />
              <LeaderboardRowSkeleton />
            </>
          ) : leaderboard.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={32} color={C.textSecondary} />
              <Text style={styles.emptyText}>No data yet</Text>
            </View>
          ) : (
            leaderboard.slice(0, 5).map((entry, idx) => (
              <LeaderboardRow key={entry.employeeId} entry={entry} isTop={idx === 0} />
            ))
          )}
        </View>
      </View>

      {/* Recent Leads */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Leads</Text>
          {!isLoading && (
            <TouchableOpacity onPress={() => router.push("/(tabs)/leads")} hitSlop={{ top: 4, bottom: 4, left: 8, right: 8 }}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.recentList}>
          {isLoading ? (
            <>
              <LeadRowSkeleton />
              <LeadRowSkeleton />
              <LeadRowSkeleton />
              <LeadRowSkeleton />
            </>
          ) : (
            recentLeads.map(lead => (
              <TouchableOpacity
                key={lead.id}
                style={styles.recentRow}
                onPress={() => router.push({ pathname: "/lead/[id]", params: { id: lead.id } })}
              >
                <View style={styles.leadAvatar}>
                  <Text style={styles.leadAvatarText}>{lead.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.leadName} numberOfLines={1}>{lead.name}</Text>
                  {lead.employeeName && (
                    <Text style={styles.leadSub} numberOfLines={1}>{lead.employeeName}</Text>
                  )}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  {lead.priority ? (
                    <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[lead.priority] }]} />
                  ) : null}
                  <View style={[styles.statusBadge, { backgroundColor: statusColor(lead.status) + "20" }]}>
                    <Text style={[styles.statusText, { color: statusColor(lead.status) }]}>{statusLabel(lead.status)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
          {!isLoading && recentLeads.length === 0 && (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={32} color={C.textSecondary} />
              <Text style={styles.emptyText}>No leads yet</Text>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: { flexDirection: "row", alignItems: "flex-start", paddingTop: 16, gap: 12 },
  avatarCircle: { width: 48, height: 48, borderRadius: 16, backgroundColor: C.brand, alignItems: "center", justifyContent: "center" },
  avatarInitial: { fontSize: 20, fontFamily: "Inter_700Bold", color: "#fff" },
  greeting: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  userName: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text, marginTop: 2 },
  dateText: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 3 },
  headerRight: { alignItems: "flex-end", gap: 8 },
  roleBadge: { backgroundColor: C.brand + "15", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  roleBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold", color: C.brand, letterSpacing: 1 },
  logoutBtn: { padding: 6 },

  attendanceCard: {
    flexDirection: "row", alignItems: "center", gap: 10,
    backgroundColor: C.card, borderRadius: 14, padding: 14,
    borderWidth: 1.5, borderColor: C.border,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  attendanceDot: { width: 10, height: 10, borderRadius: 5 },
  attendanceLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.text },

  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  statCard: {
    flex: 1, minWidth: "44%", borderRadius: 16, padding: 16, borderLeftWidth: 3, gap: 8,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
    overflow: "hidden",
  },
  statIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 26, fontFamily: "Inter_700Bold", color: C.text },
  statLabel: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },

  section: { gap: 12 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hotDot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  seeAll: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.brand },

  hotCard: {
    width: 140, backgroundColor: C.card, borderRadius: 14, padding: 14, gap: 6,
    borderWidth: 1, borderColor: C.danger + "20",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 1,
  },
  hotAvatar: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  hotAvatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  hotName: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.text },
  hotProp: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  hotStatus: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, alignSelf: "flex-start" },
  hotStatusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  addLeadBtn: { flexDirection: "row", height: 52, backgroundColor: C.brand, borderRadius: 16, alignItems: "center", justifyContent: "center", gap: 8 },
  addLeadText: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  lbCard: {
    backgroundColor: C.card, borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  lbRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  lbRowTop: { backgroundColor: C.accent + "08" },
  lbRank: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  lbRankText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  lbName: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  lbStats: { alignItems: "flex-end" },
  lbTotal: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  lbWon: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.success },
  recentList: {
    backgroundColor: C.card, borderRadius: 16, overflow: "hidden",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  recentRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  leadAvatar: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brand + "20", alignItems: "center", justifyContent: "center" },
  leadAvatarText: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.brand },
  leadName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  leadSub: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  emptyState: { paddingVertical: 32, alignItems: "center", gap: 8 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
});
