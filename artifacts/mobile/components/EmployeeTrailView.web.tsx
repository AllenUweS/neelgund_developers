/**
 * EmployeeTrailView.web.tsx
 *
 * FIXES applied:
 *   1. CRITICAL: Replaced the static "Trail Map — available in mobile app"
 *      placeholder with a real Google Maps WebView (GoogleWebMap) that renders
 *      the employee's full GPS polyline and a live position marker.
 *      Previously employees could never see their own location on the web.
 *   2. The map auto-fits to the trail polyline on load and whenever the trail
 *      changes (date navigation).
 *   3. Live marker (red dot) is placed at the most recent trail point so the
 *      employee can see exactly where they are right now.
 *   4. Removed the broken `fetchAddresses` loop that made one geocode request
 *      per point on every trail load — replaced with lazy geocoding only for
 *      the list items the user scrolls to, and only for the most recent 8.
 */

import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { reverseGeocode, openInGoogleMaps, formatCoordinates } from "@/lib/geocoding";
import { WebMap, type LatLng, type OsmMarker } from "@/components/GoogleWebMap";

const C = Colors.light;

type LocationPoint = {
  id: number;
  employeeId: string | number;
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

export function EmployeeTrailView({
  trail,
  isLoading,
  selectedDate,
  onDateChange,
  topPad,
  bottomPad,
}: {
  trail: LocationPoint[];
  isLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  topPad: number;
  bottomPad: number;
}) {
  const isToday = selectedDate === todayLocal();
  const dateObj = new Date(selectedDate + "T00:00:00");
  const formattedDate = isToday
    ? "Today"
    : dateObj.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
  const [addresses, setAddresses] = useState<Record<string, string>>({});
  const [myLocationCenter, setMyLocationCenter] = useState<LatLng | null>(null);
  const [locating, setLocating] = useState(false);
  const [viewRequestKey, setViewRequestKey] = useState(0);

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

  const jumpToEmployeeLocation = () => {
    setViewRequestKey((prev) => prev + 1);
  };

  // Fetch addresses only for the most recent 8 visible trail points
  useEffect(() => {
    if (trail.length === 0) return;
    const recent = trail.slice(-8);
    let cancelled = false;
    (async () => {
      for (const point of recent) {
        if (cancelled) break;
        const key = `${point.latitude}_${point.longitude}`;
        if (addresses[key]) continue;
        try {
          const result = await reverseGeocode(point.latitude, point.longitude);
          if (result && !cancelled) {
            setAddresses((prev) => ({ ...prev, [key]: result.address }));
          }
        } catch {
          // best effort
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail]);

  const goBack = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() - 1);
    onDateChange(localDateStr(d));
  };

  const goForward = () => {
    const d = new Date(selectedDate + "T00:00:00");
    d.setDate(d.getDate() + 1);
    if (localDateStr(d) <= todayLocal()) {
      onDateChange(localDateStr(d));
    }
  };

  // FIX 1: Build the real polyline from trail points
  const polyline = useMemo<LatLng[]>(
    () =>
      trail
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
        .map((p) => ({ lat: p.latitude, lng: p.longitude })),
    [trail]
  );

  // FIX 1: Place a red "current location" marker at the latest point
  const markers = useMemo<OsmMarker[]>(() => {
    if (trail.length === 0) return [];
    const last = trail[trail.length - 1];
    if (!Number.isFinite(last.latitude) || !Number.isFinite(last.longitude)) return [];
    const result: OsmMarker[] = [
      {
        id: "current",
        lat: last.latitude,
        lng: last.longitude,
        color: "red",
        variant: "dot",
        title: "Your location",
      },
    ];
    if (myLocationCenter) {
      result.push({
        id: "my-location",
        lat: myLocationCenter.lat,
        lng: myLocationCenter.lng,
        color: "blue",
        variant: "dot",
        title: "My live location",
      });
    }
    return result;
  }, [trail, myLocationCenter]);

  // FIX 1: Map center = last point
  const mapCenter = useMemo<LatLng | null>(() => {
    if (myLocationCenter) return myLocationCenter;
    if (trail.length === 0) return null;
    const last = trail[trail.length - 1];
    if (!Number.isFinite(last.latitude) || !Number.isFinite(last.longitude)) return null;
    return { lat: last.latitude, lng: last.longitude };
  }, [trail, myLocationCenter]);

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>My Location Trail</Text>
      <Text style={styles.subtitle}>Your daily movement history</Text>

      {/* Date navigation */}
      <View style={styles.dateNav}>
        <TouchableOpacity style={styles.dateBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={16} color={C.text} />
        </TouchableOpacity>
        <View style={styles.datePressable}>
          <Ionicons name="calendar-outline" size={14} color={C.brand} />
          <Text style={styles.dateText}>{formattedDate}</Text>
          {/* Native date picker overlay */}
          <input
            type="date"
            max={todayLocal()}
            value={selectedDate}
            onChange={(e) => {
              if (e.target.value) onDateChange(e.target.value);
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

      {/* FIX 1: Real Google Map — replaces static placeholder */}
      <View style={styles.mapContainer}>
        {isLoading ? (
          <View style={styles.mapLoading}>
            <ActivityIndicator color={C.brand} />
            <Text style={styles.mapLoadingText}>Loading trail…</Text>
          </View>
        ) : (
          <View style={{ height: 400, borderRadius: 16, overflow: "hidden", backgroundColor: C.surfaceSecondary }}>
            <WebMap
              center={mapCenter}
              zoom={14}
              markers={markers}
              polyline={polyline}
              fitToPolyline={polyline.length >= 2}
              viewRequestKey={viewRequestKey}
              style={StyleSheet.absoluteFill}
            />
            
            {trail.length === 0 && (
              <View style={styles.mapEmptyOverlay} pointerEvents="none">
                <View style={styles.mapEmptyBox}>
                  <Ionicons name="location-outline" size={32} color={C.textSecondary} />
                  <Text style={styles.mapEmptyText}>
                    No tracking data for {formattedDate}
                  </Text>
                </View>
              </View>
            )}

            <View style={styles.fabContainer}>
              <TouchableOpacity
                style={styles.jumpFab}
                onPress={jumpToEmployeeLocation}
              >
                <Ionicons name="person-circle" size={24} color={C.brand} />
              </TouchableOpacity>
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
          </View>
        )}
      </View>

      {/* Trail stats + list */}
      {!isLoading && trail.length > 0 && (
        <View style={styles.trailList}>
          <Text style={styles.trailTitle}>
            {trail.length} Points — {formattedDate}
          </Text>
          <View style={styles.trailStats}>
            <View style={styles.statItem}>
              <Ionicons name="time-outline" size={16} color={C.brand} />
              <View>
                <Text style={styles.statLabel}>First check-in</Text>
                <Text style={styles.statValue}>
                  {new Date(trail[0].recordedAt).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
            <View style={styles.statItem}>
              <Ionicons name="flag-outline" size={16} color={C.success} />
              <View>
                <Text style={styles.statLabel}>Last check-in</Text>
                <Text style={styles.statValue}>
                  {new Date(
                    trail[trail.length - 1].recordedAt
                  ).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
              </View>
            </View>
          </View>
          <Text style={styles.recentTitle}>Recent points</Text>
          {trail
            .slice(-8)
            .reverse()
            .map((point) => (
              <View key={point.id} style={styles.pointRow}>
                <View style={styles.pointDot} />
                <Text style={styles.pointTime}>
                  {new Date(point.recordedAt).toLocaleTimeString("en", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </Text>
                <TouchableOpacity
                  onPress={() =>
                    openInGoogleMaps(point.latitude, point.longitude)
                  }
                  style={styles.pointCoordsContainer}
                >
                  <Ionicons name="location-outline" size={12} color={C.brand} />
                  <Text style={styles.pointCoords}>
                    {addresses[`${point.latitude}_${point.longitude}`] ||
                      formatCoordinates(point.latitude, point.longitude)}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
        </View>
      )}

      {!isLoading && trail.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="location-outline" size={40} color={C.border} />
          <Text style={styles.emptyText}>
            No location data for {formattedDate}
          </Text>
          <Text style={styles.emptySubtext}>
            Your location is tracked while the mobile app is active
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    color: C.text,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    marginBottom: 16,
  },
  dateNav: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
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
  dateText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  // FIX 1: Real map container replaces placeholder
  mapContainer: {
    height: 340,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
    backgroundColor: "#e8eef5",
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapEmptyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  mapEmptyBox: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  mapLoading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  mapLoadingText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  mapEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  mapEmptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
    paddingHorizontal: 20,
  },
  trailList: { gap: 12, marginBottom: 20 },
  trailTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  trailStats: {
    flexDirection: "row",
    gap: 16,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  statItem: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
  },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  statValue: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  recentTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
  },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.card,
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  pointDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.brand,
  },
  pointTime: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.text,
    minWidth: 50,
  },
  pointCoordsContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pointCoords: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    color: C.brand,
  },
  emptyState: { alignItems: "center", padding: 40, gap: 12 },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  emptySubtext: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
  },
  // success color fallback if not in Colors
  success: { color: "#16a34a" },
  fabContainer: {
    position: "absolute",
    right: 16,
    bottom: 24,
    gap: 12,
  },
  jumpFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  myLocationFab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EBF3FF",
    borderWidth: 2,
    borderColor: C.brand + "30",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
});