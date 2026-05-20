/**
 * map.web.tsx — Admin / Manager web map screen
 *
 * FIXES applied vs original:
 *   1. polyline prop was being passed to WebMap even when no employee was
 *      selected (it showed a meaningless line joining all employee dots).
 *      Now polyline is only sent when an employee is selected AND there is
 *      no road-snapped route.
 *   2. fitToPolyline was using a ternary that evaluated to a boolean from
 *      `.length >= 2` — but only when selectedEmployee was truthy AND a
 *      route existed. Simplified to a clear boolean.
 *   3. matchTrail result coordinates are [lng, lat] — the conversion was
 *      correct but now includes a guard against empty/null result.
 *   4. markers now always rendered regardless of selectedEmployee so all
 *      active employees stay visible on the map.
 *   5. Added refetchInterval: false for non-today dates (already there but
 *      the staleTime was missing, causing unnecessary refetches on tab focus).
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { EmployeeTrailView } from "@/components/EmployeeTrailView";
import { WebMap, type LatLng, type OsmMarker } from "@/components/GoogleWebMap";
import { listEmployeeLocationsByDate, getLocationTrail } from "@/lib/api";
import { reverseGeocode, openInGoogleMaps, formatCoordinates } from "@/lib/geocoding";
import { matchTrail } from "@/lib/googleRoadsMatching";

const C = Colors.light;

type EmployeeLocation = {
  employeeId: string;
  employeeName: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

type LocationPoint = {
  id: number;
  employeeId: string;
  latitude: number;
  longitude: number;
  recordedAt: string;
};

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayLocal(): string {
  return localDateStr(new Date());
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const isAdminOrManager =
    user?.role === "admin" ||
    user?.role === "super_admin" ||
    user?.role === "manager";
  const [selectedEmployee, setSelectedEmployee] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayLocal);
  const [searchQuery, setSearchQuery] = useState("");
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [mapStyle, setMapStyle] = useState<"streets" | "satellite">("streets");
  const [matchedRoute, setMatchedRoute] = useState<number[][] | null>(null);
  const [myLocationCenter, setMyLocationCenter] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);

  const goToMyLocation = () => {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLocationCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };
  const [isMatching, setIsMatching] = useState(false);
  const topPad = insets.top + 67;
  const bottomPad = insets.bottom + 34 + 80;

  const isToday = selectedDate === todayLocal();
  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = isToday
    ? "Today"
    : dateObj.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

  const goBack = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    setSelectedDate(localDateStr(d));
  };

  const goForward = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    if (localDateStr(d) <= todayLocal()) {
      setSelectedDate(localDateStr(d));
    }
  };

  const effectiveEmployeeId = isAdminOrManager
    ? selectedEmployee
    : (user?.id ?? null);

  const employeesQ = useQuery<EmployeeLocation[]>({
    queryKey: ["location-employees-date", selectedDate],
    queryFn: async () =>
      (await listEmployeeLocationsByDate(selectedDate)) as EmployeeLocation[],
    refetchInterval: isToday ? 30000 : false,
    // FIX #5: staleTime prevents unnecessary refetches on tab focus
    staleTime: isToday ? 30000 : Infinity,
    enabled: isAdminOrManager,
  });

  const trailQ = useQuery({
    queryKey: ["location-trail-web", effectiveEmployeeId, selectedDate],
    queryFn: async () => {
      if (!effectiveEmployeeId) return [] as LocationPoint[];
      return await getLocationTrail(effectiveEmployeeId, selectedDate);
    },
    enabled: isAdminOrManager ? !!selectedEmployee : !!user?.id,
    // FIX: Refresh every 30 s for today so live location updates on both
    // admin and employee views. Use a longer interval for past dates.
    refetchInterval: isToday ? 30_000 : false,
    staleTime: isToday ? 30_000 : Infinity,
  });

  const employees = employeesQ.data ?? [];
  const trail = trailQ.data ?? [];

  // Road-snap trail when employee + date changes
  useEffect(() => {
    // FIX #3: Reset matched route when employee/date changes
    setMatchedRoute(null);
    if (trail.length < 2 || !effectiveEmployeeId) {
      return;
    }
    let cancelled = false;
    setIsMatching(true);
    matchTrail(trail, effectiveEmployeeId, selectedDate)
      .then((result) => {
        if (!cancelled) {
          // Guard: only set if we got valid coordinates
          setMatchedRoute(
            result?.coordinates && result.coordinates.length >= 2
              ? result.coordinates
              : null
          );
        }
      })
      .catch(() => {
        if (!cancelled) setMatchedRoute(null);
      })
      .finally(() => {
        if (!cancelled) setIsMatching(false);
      });
    return () => {
      cancelled = true;
      setIsMatching(false);
    };
  }, [trail, effectiveEmployeeId, selectedDate]);

  // FIX #3: matchedRoute is [lng, lat] pairs — convert to { lat, lng } objects
  const routePolyline: LatLng[] =
    matchedRoute?.map(([lng, lat]) => ({ lat, lng })) ?? [];

  // Fetch addresses for employees
  useEffect(() => {
    const fetchAddresses = async () => {
      for (const emp of employees) {
        const key = `${emp.employeeId}_${emp.latitude}_${emp.longitude}`;
        if (!addresses[key]) {
          const result = await reverseGeocode(emp.latitude, emp.longitude);
          if (result) {
            setAddresses((prev) => ({ ...prev, [key]: result.address }));
          }
        }
      }
    };
    if (employees.length > 0) {
      fetchAddresses();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees]);

  // Filter employees by search query
  const filteredEmployees = employees.filter((emp) =>
    emp.employeeName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // FIX #4: Always show all employee markers on the map
  const markers: OsmMarker[] = employees.map((emp) => ({
    id: emp.employeeId,
    lat: emp.latitude,
    lng: emp.longitude,
    title: emp.employeeName,
    color: emp.employeeId === selectedEmployee ? "orange" : "blue",
    label: emp.employeeName.charAt(0).toUpperCase(),
  }));

  // FIX #1 & #2: Only pass trail polyline when an employee is selected AND
  // there is no road-snapped route available (raw GPS fallback).
  const hasRoute = routePolyline.length >= 2;
  const trailPolyline: LatLng[] =
    selectedEmployee && !hasRoute
      ? trail.map((point) => ({
          lat: point.latitude,
          lng: point.longitude,
        }))
      : [];

  // FIX #2: fitToPolyline is true only when there is something to fit to
  const shouldFit =
    !!selectedEmployee && (hasRoute || trailPolyline.length >= 2);

  // Calculate center: prefer polyline centroid, then marker centroid
  const mapCenter: LatLng | null = (() => {
    if (myLocationCenter) return myLocationCenter;
    const pts = hasRoute ? routePolyline : trailPolyline;
    if (pts.length > 0) {
      const avgLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const avgLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
      return { lat: avgLat, lng: avgLng };
    }
    if (markers.length > 0) {
      const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
      const avgLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
      return { lat: avgLat, lng: avgLng };
    }
    return null;
  })();

  if (!isAdminOrManager) {
    return (
      <View style={styles.employeeContainer}>
        <EmployeeTrailView
          trail={trail}
          matchedRoute={null}
          isLoading={trailQ.isLoading}
          selectedDate={selectedDate}
          onDateChange={setSelectedDate}
          topPad={topPad}
          bottomPad={bottomPad}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Map</Text>
        <Text style={styles.subtitle}>Field team location tracking</Text>
      </View>

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={16} color={C.text} />
        </TouchableOpacity>
        <View style={styles.datePressable}>
          <Ionicons name="calendar-outline" size={14} color={C.brand} />
          <Text style={styles.dateText}>{formattedDate}</Text>
          <input
            type="date"
            max={todayLocal()}
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) setSelectedDate(e.target.value);
            }}
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0,
              cursor: "pointer",
              width: "100%",
              height: "100%",
            }}
          />
        </View>
        <TouchableOpacity
          style={styles.dateBtn}
          onPress={goForward}
          disabled={isToday}
        >
          <Ionicons
            name="chevron-forward"
            size={16}
            color={isToday ? C.border : C.text}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.mapContainer}>
        <WebMap
          center={mapCenter}
          zoom={shouldFit ? undefined : 12}
          markers={markers}
          // FIX #1: polyline only shown for selected employee without a road route
          polyline={trailPolyline}
          routePolyline={hasRoute && selectedEmployee ? routePolyline : []}
          // FIX #2: fitToPolyline is a clear boolean
          fitToPolyline={shouldFit}
          onMarkerPress={(id) =>
            setSelectedEmployee(id === selectedEmployee ? null : id)
          }
          showControls={true}
          mapStyle={mapStyle}
          style={styles.map}
        />
        {isMatching && (
          <View style={styles.snappingBadge}>
            <ActivityIndicator size="small" color={C.brand} />
            <Text style={styles.snappingText}>Snapping to roads…</Text>
          </View>
        )}
        {/* Satellite toggle */}
        <View style={styles.mapStyleToggle}>
          {(["streets", "satellite"] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.mapStyleBtn,
                mapStyle === mode && styles.mapStyleBtnActive,
              ]}
              onPress={() => setMapStyle(mode)}
            >
              <Text
                style={[
                  styles.mapStyleText,
                  mapStyle === mode && styles.mapStyleTextActive,
                ]}
              >
                {mode === "streets" ? "Map" : "Satellite"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* My Location button */}
        <TouchableOpacity
          style={styles.myLocationFab}
          onPress={goToMyLocation}
          disabled={locating}
        >
          {locating
            ? <ActivityIndicator size="small" color={C.brand} />
            : <Ionicons name="locate" size={20} color={C.brand} />
          }
        </TouchableOpacity>
      </View>

      {selectedEmployee && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Trail —{" "}
              {employees.find((e) => e.employeeId === selectedEmployee)
                ?.employeeName ?? "Employee"}{" "}
              · {formattedDate}
            </Text>
            <TouchableOpacity onPress={() => setSelectedEmployee(null)}>
              <Ionicons name="close" size={18} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          {trailQ.isLoading ? (
            <ActivityIndicator color={C.brand} />
          ) : trail.length > 0 ? (
            <View style={styles.trailCard}>
              <Text style={styles.trailStat}>
                {trail.length} location points recorded
              </Text>
              {trail
                .slice(-5)
                .reverse()
                .map((point) => (
                  <View key={point.id} style={styles.trailRow}>
                    <View style={styles.trailDot} />
                    <Text style={styles.trailTime}>
                      {new Date(point.recordedAt).toLocaleTimeString("en", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </Text>
                    <Text style={styles.trailCoords}>
                      {point.latitude.toFixed(4)}, {point.longitude.toFixed(4)}
                    </Text>
                  </View>
                ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>No trail data for this date</Text>
          )}
        </View>
      )}

      {employeesQ.isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      ) : employees.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Active Today</Text>

          {/* Search input */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={18} color={C.textSecondary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search employees..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor={C.textSecondary}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity onPress={() => setSearchQuery("")}>
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={C.textSecondary}
                />
              </TouchableOpacity>
            )}
          </View>

          {filteredEmployees.map((emp) => (
            <TouchableOpacity
              key={emp.employeeId}
              style={[
                styles.empRow,
                selectedEmployee === emp.employeeId && styles.empRowActive,
              ]}
              onPress={() =>
                setSelectedEmployee(
                  selectedEmployee === emp.employeeId ? null : emp.employeeId
                )
              }
            >
              <View style={styles.empAvatar}>
                <Text style={styles.empAvatarText}>
                  {emp.employeeName.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.empName}>{emp.employeeName}</Text>
                <Text style={styles.empTime}>
                  Last seen:{" "}
                  {new Date(emp.recordedAt).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    openInGoogleMaps(emp.latitude, emp.longitude)
                  }
                  style={styles.locationButton}
                >
                  <Ionicons
                    name="location-outline"
                    size={12}
                    color={C.brand}
                  />
                  <Text style={styles.locationText}>
                    {addresses[
                      `${emp.employeeId}_${emp.latitude}_${emp.longitude}`
                    ] || formatCoordinates(emp.latitude, emp.longitude)}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.activeBadge}>
                <View style={styles.activeDot} />
                <Text style={styles.activeText}>Active</Text>
              </View>
            </TouchableOpacity>
          ))}
          {filteredEmployees.length === 0 && (
            <Text style={styles.noResultsText}>No employees found</Text>
          )}
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={40} color={C.border} />
          <Text style={styles.emptyText}>No employees active today</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  employeeContainer: { flex: 1 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 2,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  dateBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  datePressable: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 36,
    backgroundColor: C.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    position: "relative",
    overflow: "hidden",
  },
  dateText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  mapContainer: {
    margin: 20,
    height: 400,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
  },
  map: { flex: 1, minHeight: 400 },
  section: { paddingHorizontal: 20, gap: 10, marginBottom: 8 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  trailCard: {
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  trailStat: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.brand,
    marginBottom: 4,
  },
  trailRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  trailDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.brand },
  trailTime: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.text,
    minWidth: 50,
  },
  trailCoords: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  empRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  empRowActive: { borderColor: C.brand },
  empAvatar: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
  },
  empAvatarText: {
    fontSize: 17,
    fontFamily: "Inter_700Bold",
    color: C.brand,
  },
  empName: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
  empTime: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  locationButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  locationText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: C.brand,
  },
  noResultsText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    paddingVertical: 20,
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: C.success + "20",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  activeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    color: C.success,
  },
  loadingState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  emptyState: { alignItems: "center", padding: 40, gap: 12 },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  mapStyleToggle: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.95)",
    borderRadius: 8,
    overflow: "hidden",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    zIndex: 10,
  },
  mapStyleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "rgba(245,245,245,0.96)",
  },
  mapStyleBtnActive: { backgroundColor: "#fff" },
  mapStyleText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  mapStyleTextActive: { color: C.brand },
  myLocationFab: {
    position: "absolute",
    bottom: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    borderWidth: 1.5,
    borderColor: C.brand + "30",
    zIndex: 1000,
  },
  snappingBadge: {
    position: "absolute",
    top: 12,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.95)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    zIndex: 10,
  },
  snappingText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
});