import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { formatCoordinates, openInGoogleMaps } from "@/lib/geocoding";

const C = Colors.light;

let NativeDatePicker: typeof import("@react-native-community/datetimepicker").default | null = null;
try {
  NativeDatePicker = require("@react-native-community/datetimepicker").default;
} catch {}

export type EmployeeLocation = {
  employeeId: string;
  employeeName: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
  trackerState?: "running" | "stopped";
};

type ActivityFilter = "all" | "fresh" | "hour" | "older";

const ACTIVITY_FILTERS: Array<{ id: ActivityFilter; label: string; icon: React.ComponentProps<typeof Ionicons>["name"] }> = [
  { id: "all", label: "All", icon: "people-outline" },
  { id: "fresh", label: "Live now", icon: "radio-button-on-outline" },
  { id: "hour", label: "Last hour", icon: "time-outline" },
  { id: "older", label: "Older", icon: "moon-outline" },
];

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return localDateStr(new Date());
}

function minutesSince(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(diff / 60000));
}

function timeAgo(iso: string): string {
  if (!iso || new Date(iso).getFullYear() < 2000) return "never";
  const mins = minutesSince(iso);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}mo ago` : `${years}y ago`;
}

function activityTone(employee: EmployeeLocation): { label: string; color: string; bg: string; icon: React.ComponentProps<typeof Ionicons>["name"] } {
  const mins = minutesSince(employee.recordedAt);
  // FIX: If trackerState is explicitly "stopped" the employee is offline —
  // show Idle even if their last ping was very recent (e.g. just logged out).
  if (employee.trackerState === "stopped") {
    return { label: "Idle", color: C.textSecondary, bg: C.surfaceSecondary, icon: "time-outline" };
  }
  // trackerState = "running" or unknown (no row yet): use time-based heuristic
  if (mins <= 10 && employee.trackerState === "running") return { label: "Live", color: C.success, bg: C.success + "18", icon: "radio-button-on" };
  if (mins <= 60) return { label: "Recent", color: C.warning, bg: C.warning + "18", icon: "pulse-outline" };
  return { label: "Idle", color: C.textSecondary, bg: C.surfaceSecondary, icon: "time-outline" };
}

function initials(name: string): string {
  const bits = name.trim().split(/\s+/).filter(Boolean);
  if (bits.length === 0) return "?";
  if (bits.length === 1) return bits[0].charAt(0).toUpperCase();
  return `${bits[0].charAt(0)}${bits[1].charAt(0)}`.toUpperCase();
}

function safeHaptic() {
  if (Platform.OS !== "web") void Haptics.selectionAsync();
}

export function EmployeePickerList({
  employees,
  isLoading,
  isError,
  onRefetch,
  onSelect,
  selectedDate,
  onDateChange,
  topPad,
  bottomPad,
}: {
  employees: EmployeeLocation[];
  isLoading: boolean;
  isError: boolean;
  onRefetch: () => void;
  onSelect: (employeeId: string) => void;
  selectedDate: string;
  onDateChange: (date: string) => void;
  topPad: number;
  bottomPad: number;
}) {
  const [search, setSearch] = useState("");
  const [showPicker, setShowPicker] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>("all");

  const isToday = selectedDate === todayLocal();
  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = isToday
    ? "Today"
    : dateObj.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

  const stats = useMemo(() => {
    // FIX: Live count uses trackerState = "running" as the truth source.
    const live = employees.filter(
      (e) => e.trackerState === "running" && minutesSince(e.recordedAt) <= 10
    ).length;
    const recent = employees.filter((e) => minutesSince(e.recordedAt) <= 60).length;
    return { live, recent, total: employees.length };
  }, [employees]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees
      .filter((employee) => {
        const mins = minutesSince(employee.recordedAt);
        const matchesSearch = !q || employee.employeeName.toLowerCase().includes(q);
        const matchesActivity =
          activityFilter === "all" ||
          (activityFilter === "fresh" && mins <= 10 && employee.trackerState !== "stopped") ||
          (activityFilter === "hour" && mins <= 60) ||
          (activityFilter === "older" && mins > 60);
        return matchesSearch && matchesActivity;
      })
      .sort((a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime());
  }, [activityFilter, employees, search]);

  const goBack = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onDateChange(localDateStr(d));
  };

  const goForward = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    if (localDateStr(d) <= todayLocal()) onDateChange(localDateStr(d));
  };

  const selectEmployee = (employeeId: string) => {
    safeHaptic();
    onSelect(employeeId);
  };

  if (isLoading) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <View style={styles.loadingOrb}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
        <Text style={styles.emptyTitle}>Finding the team</Text>
        <Text style={styles.emptyBody}>Loading the latest employee locations...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: topPad, paddingBottom: bottomPad }]}>
        <View style={styles.emptyIcon}>
          <Ionicons name="cloud-offline-outline" size={34} color={C.danger} />
        </View>
        <Text style={styles.emptyTitle}>Team map did not load</Text>
        <Text style={styles.emptyBody}>Check your connection and try again.</Text>
        <TouchableOpacity style={styles.primaryBtn} onPress={onRefetch} activeOpacity={0.88}>
          <Ionicons name="refresh" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <FlatList
        data={filtered}
        keyExtractor={(employee) => employee.employeeId}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={10}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews={Platform.OS !== "web"}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: bottomPad + 18, gap: 10 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.eyebrow}>TEAM TRAILS</Text>
                  <Text style={styles.title}>Pick a rider</Text>
                  <Text style={styles.subtitle}>Select an employee to replay their route, stops, and trip history.</Text>
                </View>
                <TouchableOpacity style={styles.refreshBtn} onPress={onRefetch} activeOpacity={0.85}>
                  <Ionicons name="refresh" size={21} color={C.brand} />
                </TouchableOpacity>
              </View>

              <View style={styles.statRow}>
                <StatPill label="Live" value={stats.live} color={C.success} icon="radio-button-on" />
                <StatPill label="Recent" value={stats.recent} color={C.warning} icon="pulse-outline" />
                <StatPill label="Total" value={stats.total} color={C.brand} icon="people-outline" />
              </View>
            </View>

            <View style={styles.dateNav}>
              <TouchableOpacity style={styles.dateBtn} onPress={goBack}>
                <Ionicons name="chevron-back" size={17} color={C.text} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.dateMainBtn} onPress={() => setShowPicker(true)} activeOpacity={0.86}>
                <Ionicons name="calendar-outline" size={16} color={C.brand} />
                <Text style={styles.dateText}>{formattedDate}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.dateBtn, isToday && styles.dateBtnDisabled]} onPress={goForward} disabled={isToday}>
                <Ionicons name="chevron-forward" size={17} color={isToday ? C.border : C.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={18} color={C.placeholder} />
              <TextInput
                placeholder="Search employees..."
                placeholderTextColor={C.placeholder}
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {search.length > 0 ? (
                <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color={C.placeholder} />
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.filterRail}>
              {ACTIVITY_FILTERS.map((filter) => {
                const active = activityFilter === filter.id;
                return (
                  <TouchableOpacity
                    key={filter.id}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    onPress={() => setActivityFilter(filter.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name={filter.icon} size={15} color={active ? "#fff" : C.textSecondary} />
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{filter.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.sectionTitle}>
              {filtered.length} {filtered.length === 1 ? "employee" : "employees"} ready on {formattedDate}
            </Text>
          </View>
        }
        renderItem={({ item }) => <EmployeeCard employee={item} onSelect={selectEmployee} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="map-outline" size={34} color={C.brand} />
            </View>
            <Text style={styles.emptyTitle}>No matching employees</Text>
            <Text style={styles.emptyBody}>
              {search ? "Try another name or clear search." : `No one has a recorded location on ${formattedDate}.`}
            </Text>
            {search || activityFilter !== "all" ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setSearch("");
                  setActivityFilter("all");
                }}
              >
                <Text style={styles.secondaryBtnText}>Clear filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      {showPicker && NativeDatePicker ? (
        <NativeDatePicker
          mode="date"
          value={dateObj}
          maximumDate={new Date()}
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_evt: { type: string }, date?: Date) => {
            setShowPicker(Platform.OS === "ios");
            if (date) onDateChange(localDateStr(date));
          }}
        />
      ) : null}
    </View>
  );
}

function StatPill({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <View style={styles.statPill}>
      <View style={[styles.statIcon, { backgroundColor: color + "18" }]}>
        <Ionicons name={icon} size={16} color={color} />
      </View>
      <View>
        <Text style={styles.statValue}>{value}</Text>
        <Text style={styles.statLabel}>{label}</Text>
      </View>
    </View>
  );
}

function EmployeeCard({ employee, onSelect }: { employee: EmployeeLocation; onSelect: (id: string) => void }) {
  const tone = activityTone(employee);
  const coords = formatCoordinates(employee.latitude, employee.longitude);
  const hasPing = employee.recordedAt && new Date(employee.recordedAt).getFullYear() >= 2000;
  const hasCoords = employee.latitude !== 0 || employee.longitude !== 0;

  return (
    <TouchableOpacity style={styles.card} activeOpacity={0.86} onPress={() => onSelect(employee.employeeId)}>
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, { backgroundColor: tone.color + "16" }]}>
          <Text style={[styles.avatarText, { color: tone.color }]}>{initials(employee.employeeName)}</Text>
        </View>
        <View style={[styles.avatarStatus, { backgroundColor: tone.color }]} />
      </View>

      <View style={styles.cardBody}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {employee.employeeName}
          </Text>
          <View style={[styles.activityBadge, { backgroundColor: tone.bg }]}>
            <Ionicons name={tone.icon} size={12} color={tone.color} />
            <Text style={[styles.activityText, { color: tone.color }]}>{tone.label}</Text>
          </View>
        </View>

        <View style={styles.detailRow}>
          <Ionicons name="time-outline" size={13} color={C.textSecondary} />
          {hasPing ? (
            <>
              <Text style={styles.detailText}>{timeAgo(employee.recordedAt)}</Text>
              <View style={styles.dot} />
              <Text style={styles.detailText}>
                {new Date(employee.recordedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </Text>
            </>
          ) : (
            <Text style={styles.detailText}>never active</Text>
          )}
        </View>

        {hasCoords ? (
          <TouchableOpacity
            style={styles.coordRow}
            onPress={(event) => {
              event.stopPropagation();
              openInGoogleMaps(employee.latitude, employee.longitude);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name="navigate-circle-outline" size={15} color={C.brand} />
            <Text style={styles.coordText} numberOfLines={1}>
              {coords}
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.coordRow}>
            <Ionicons name="navigate-circle-outline" size={15} color={C.textSecondary} />
            <Text style={[styles.coordText, { color: C.textSecondary }]} numberOfLines={1}>
              no location
            </Text>
          </View>
        )}

        <View style={styles.cardActionRow}>
          <View style={styles.pathHint}>
            <Ionicons name="git-branch-outline" size={14} color={C.brand} />
            <Text style={styles.pathHintText}>Route replay ready</Text>
          </View>
          <View style={styles.viewTripBtn}>
            <Text style={styles.viewTripText}>View Trip</Text>
            <Ionicons name="arrow-forward" size={15} color="#fff" />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F6F8FB" },
  centered: { alignItems: "center", justifyContent: "center", paddingHorizontal: 28, gap: 10 },
  header: { paddingTop: 10, paddingBottom: 8, gap: 12 },
  hero: {
    backgroundColor: C.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    padding: 16,
    gap: 16,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  eyebrow: { fontSize: 11, fontFamily: "Inter_700Bold", color: C.brand, letterSpacing: 0.8 },
  title: { marginTop: 2, fontSize: 29, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { marginTop: 4, fontSize: 13, lineHeight: 19, fontFamily: "Inter_500Medium", color: C.textSecondary },
  refreshBtn: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: C.brand + "12",
    alignItems: "center",
    justifyContent: "center",
  },
  statRow: { flexDirection: "row", gap: 8 },
  statPill: {
    flex: 1,
    minHeight: 62,
    borderRadius: 14,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statIcon: { width: 31, height: 31, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  statLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  dateNav: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  dateBtnDisabled: { opacity: 0.55 },
  dateMainBtn: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  dateText: { fontSize: 14, fontFamily: "Inter_700Bold", color: C.text },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: C.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 13,
    minHeight: 46,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, paddingVertical: 10 },
  filterRail: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterChip: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  filterChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterChipText: { fontSize: 12, fontFamily: "Inter_700Bold", color: C.textSecondary },
  filterChipTextActive: { color: "#fff" },
  sectionTitle: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  card: {
    flexDirection: "row",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  avatarWrap: { width: 52, alignItems: "center" },
  avatar: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  avatarStatus: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: "#fff", marginTop: -8, marginRight: -32 },
  cardBody: { flex: 1, gap: 8 },
  cardTitleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  name: { flex: 1, fontSize: 16, fontFamily: "Inter_700Bold", color: C.text },
  activityBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  activityText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  detailText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.textSecondary },
  coordRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  coordText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
  cardActionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 2 },
  pathHint: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  pathHintText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },
  viewTripBtn: {
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 12,
    backgroundColor: "#073550",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  viewTripText: { fontSize: 12, fontFamily: "Inter_700Bold", color: "#fff" },
  loadingOrb: { width: 70, height: 70, borderRadius: 22, backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center" },
  emptyState: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 22, gap: 10 },
  emptyIcon: { width: 68, height: 68, borderRadius: 22, backgroundColor: C.brand + "12", alignItems: "center", justifyContent: "center" },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_700Bold", color: C.text, textAlign: "center" },
  emptyBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center", lineHeight: 20 },
  primaryBtn: {
    marginTop: 8,
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: C.brand,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 14 },
  secondaryBtn: {
    marginTop: 6,
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: C.brand, fontFamily: "Inter_700Bold", fontSize: 13 },
});