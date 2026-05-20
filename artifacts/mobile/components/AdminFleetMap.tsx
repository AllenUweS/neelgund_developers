import React, { useMemo, useState } from "react";
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import { MapboxWebMap, type OsmMarker, type OsmTileMode } from "@/components/GoogleMapsWebMap";
import { MapControls } from "@/components/MapControls";
import type { EmployeeLocation } from "@/lib/types";
import { isLive } from "@/lib/utils";

const C = Colors.light;

function formatRelativeTime(dateStr: string) {
  if (!dateStr || new Date(dateStr).getFullYear() < 2000) return "never";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
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

export function AdminFleetMap({
  employees,
  onSelect,
  topPad,
  bottomPad,
}: {
  employees: EmployeeLocation[];
  onSelect: (id: string) => void;
  topPad: number;
  bottomPad: number;
}) {
  const [zoom, setZoom] = useState(12);
  const [tileMode, setTileMode] = useState<OsmTileMode>("map");
  const [fitRequestKey, setFitRequestKey] = useState(0);
  const [viewRequestKey, setViewRequestKey] = useState(0);
  const [focusedLocation, setFocusedLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sheetExpanded, setSheetExpanded] = useState(false);

  const markers = useMemo<OsmMarker[]>(() => {
    // Only plot employees who actually have a location point (lat/lng != 0,0)
    return employees
      .filter((emp) => emp.latitude !== 0 || emp.longitude !== 0)
      .map((emp) => ({
        id: emp.employeeId,
        lat: emp.latitude,
        lng: emp.longitude,
        title: emp.employeeName,
        color: "blue" as const,
        label: emp.employeeName.charAt(0).toUpperCase(),
        variant: "dot" as const,
      }));
  }, [employees]);

  // Use the focused location or the first employee as center or null if empty
  const center = useMemo(() => {
    if (focusedLocation) return focusedLocation;
    if (markers.length === 0) return null;
    const avgLat = markers.reduce((s, m) => s + m.lat, 0) / markers.length;
    const avgLng = markers.reduce((s, m) => s + m.lng, 0) / markers.length;
    return { lat: avgLat, lng: avgLng };
  }, [markers, focusedLocation]);

  const locateEmployee = (emp: EmployeeLocation) => {
    setFocusedLocation({ lat: emp.latitude, lng: emp.longitude });
    setZoom(16);
    setViewRequestKey(k => k + 1);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <MapboxWebMap
        center={center}
        zoom={zoom}
        markers={markers}
        tileMode={tileMode}
        fitRequestKey={fitRequestKey}
        viewRequestKey={viewRequestKey}
        onMarkerPress={onSelect}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.controlsOverlay, { bottom: sheetExpanded ? 320 + bottomPad : 100 + bottomPad, right: 0 }]}>
        <MapControls
          showTileSwitch={true}
          showZoomControls={true}
          showFollowPlayback={false}
          showMyLocation={true}
          tileMode={tileMode as any}
          onTileModeChange={(mode) => setTileMode(mode as OsmTileMode)}
          onZoomIn={() => setZoom((z) => Math.min(18, z + 1))}
          onZoomOut={() => setZoom((z) => Math.max(4, z - 1))}
          onRecenter={() => {
            setFocusedLocation(null);
            setFitRequestKey((k) => k + 1);
          }}
        />
      </View>

      {/* Bottom Sheet */}
      <View
        style={[
          styles.sheet,
          sheetExpanded ? styles.sheetExpanded : styles.sheetCollapsed,
          { paddingBottom: bottomPad },
        ]}
      >
        <TouchableOpacity style={styles.handleHit} onPress={() => setSheetExpanded(!sheetExpanded)}>
          <View style={styles.handle} />
          {!sheetExpanded && (
            <View style={styles.collapsedHeader}>
              <Ionicons name="people" size={20} color={C.brand} />
              <Text style={styles.collapsedTitle}>
                {employees.filter(e => e.trackerState === "running" && isLive(e.recordedAt)).length} Live · {employees.length} Total
              </Text>
              <Ionicons name="chevron-up" size={20} color={C.textSecondary} />
            </View>
          )}
        </TouchableOpacity>

        {sheetExpanded && (
          <View style={{ flex: 1 }}>
            <View style={styles.expandedHeader}>
              <Text style={styles.expandedTitle}>Live Employees</Text>
              <TouchableOpacity onPress={() => setSheetExpanded(false)}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              {employees.map((emp) => {
                // An employee is only truly "live" if their tracker is running
                // AND we've received a ping from them within the last 5 minutes.
                // Trusting trackerState alone is wrong — an employee who crashed
                // the app days ago still has tracker_state="running" in the DB
                // because no logout event was ever written. The ping timestamp
                // (stored in recordedAt after our api.ts fix) tells us whether
                // they are actually active right now.
                const empIsLive =
                  emp.trackerState === "running"
                    ? isLive(emp.recordedAt)   // must also have a fresh ping
                    : emp.trackerState === "stopped"
                    ? false
                    : isLive(emp.recordedAt);  // legacy fallback: no status row
                return (
                  <View key={emp.employeeId} style={styles.riderCard}>
                    <View style={styles.riderInfo}>
                      <View style={styles.riderAvatar}>
                        <Text style={styles.riderAvatarText}>{emp.employeeName.charAt(0).toUpperCase()}</Text>
                        <View style={[styles.statusDot, { backgroundColor: empIsLive ? "#10B981" : "#9CA3AF" }]} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.riderName} numberOfLines={1}>{emp.employeeName}</Text>
                        <Text style={styles.riderStatus}>
                          {empIsLive ? "Live now" : `Last seen ${formatRelativeTime(emp.recordedAt)}`}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.riderActions}>
                      <TouchableOpacity style={styles.actionBtnLocate} onPress={() => locateEmployee(emp)}>
                        <Ionicons name="locate" size={16} color={C.brand} />
                        <Text style={styles.actionTextLocate}>Locate</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.actionBtnPath} onPress={() => onSelect(emp.employeeId)}>
                        <Ionicons name="map" size={16} color="#fff" />
                        <Text style={styles.actionTextPath}>View Path</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
              {employees.length === 0 && (
                <Text style={{ textAlign: "center", color: C.textSecondary, marginTop: 20 }}>No active riders found.</Text>
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  controlsOverlay: {
    position: "absolute",
    alignItems: "flex-end",
    paddingRight: 10,
    gap: 10,
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(0,0,0,0.05)",
  },
  sheetCollapsed: {
    height: Platform.OS === "web" ? 70 : 80,
  },
  sheetExpanded: {
    height: 380,
  },
  handleHit: {
    paddingVertical: 12,
    alignItems: "center",
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    marginBottom: 4,
  },
  collapsedHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    gap: 8,
    width: "100%",
  },
  collapsedTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  expandedHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  expandedTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  riderCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#F9FAFB",
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
  },
  riderInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  riderAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.brand + "20",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  riderAvatarText: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: C.brand,
  },
  statusDot: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#F9FAFB",
  },
  riderName: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  riderStatus: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
    marginTop: 2,
  },
  riderActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionBtnLocate: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: C.brand + "15",
  },
  actionTextLocate: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: C.brand,
  },
  actionBtnPath: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: C.brand,
  },
  actionTextPath: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    color: "#fff",
  },
});