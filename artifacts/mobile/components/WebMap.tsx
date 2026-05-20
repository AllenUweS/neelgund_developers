import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import Map, { Marker, Source, Layer, NavigationControl, FullscreenControl, type MapRef } from "react-map-gl/mapbox";
import type { CircleLayer, LineLayer } from "mapbox-gl";
import Colors from "@/constants/colors";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { MAPBOX_ACCESS_TOKEN } from "@/lib/mapboxToken";

const C = Colors.light;

export type LatLng = { lat: number; lng: number };
export type OsmMarkerColor = "blue" | "red" | "green" | "orange";

export type OsmMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  color?: OsmMarkerColor;
  label?: string;
  variant?: "dot" | "number" | "vehicle";
};

export type WebMapProps = {
  center?: LatLng | null;
  zoom?: number;
  markers?: OsmMarker[];
  polyline?: LatLng[];
  routePolyline?: LatLng[];
  traveledPolyline?: LatLng[];
  remainingPolyline?: LatLng[];
  fitToPolyline?: boolean;
  onMarkerPress?: (id: string) => void;
  showControls?: boolean;
  onRecenter?: () => void;
  mapStyle?: "streets" | "satellite";
  style?: any;
};

const DEFAULT_CENTER: LatLng = { lat: 15.3647, lng: 75.124 };
const DEFAULT_ZOOM = 8;

function toGeoJSONLine(coords: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: coords
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p) => [p.lng, p.lat]),
    },
  };
}

function speedColorGeoJSON(
  points: { lat: number; lng: number; speed?: number }[],
): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: number[][] = [];
  const colors: string[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    coordinates.push([p.lng, p.lat]);
    const speed = p.speed ?? 0;
    if (speed <= 1) colors.push("#EF4444"); // stopped - red
    else if (speed <= 20) colors.push("#F59E0B"); // slow - yellow
    else colors.push("#10B981"); // fast - green
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

const routeLayerStyle: LineLayer = {
  id: "route-line",
  type: "line",
  source: "route",
  paint: {
    "line-color": "#0B3A57",
    "line-width": 6,
    "line-opacity": 1,
  },
};

const polylineLayerStyle: LineLayer = {
  id: "polyline",
  type: "line",
  source: "polyline",
  paint: {
    "line-color": "#2563EB",
    "line-width": 5,
    "line-opacity": 0.85,
  },
};

const traveledLayerStyle: LineLayer = {
  id: "traveled-line",
  type: "line",
  source: "traveled",
  paint: {
    "line-color": "#10B981",
    "line-width": 6,
    "line-opacity": 1,
  },
};

const remainingLayerStyle: LineLayer = {
  id: "remaining-line",
  type: "line",
  source: "remaining",
  paint: {
    "line-color": "#9CA3AF",
    "line-width": 4,
    "line-opacity": 0.6,
  },
};

export function WebMap({
  center,
  zoom,
  markers,
  polyline,
  routePolyline,
  traveledPolyline,
  remainingPolyline,
  fitToPolyline,
  onMarkerPress,
  showControls = false,
  onRecenter,
  mapStyle = "streets",
  style,
}: WebMapProps) {
  const mapRef = useRef<MapRef>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const styleUrl =
    mapStyle === "satellite"
      ? "mapbox://styles/mapbox/satellite-streets-v12"
      : "mapbox://styles/mapbox/streets-v12";

  const initialView = useMemo(
    () => ({
      latitude: center?.lat ?? DEFAULT_CENTER.lat,
      longitude: center?.lng ?? DEFAULT_CENTER.lng,
      zoom: zoom ?? DEFAULT_ZOOM,
    }),
    [], // only on mount
  );

  // Update center/zoom when props change
  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.easeTo({
      center: [center.lng, center.lat],
      zoom: zoom ?? DEFAULT_ZOOM,
      duration: 600,
    });
  }, [center, zoom]);

  // Fit to polyline bounds
  useEffect(() => {
    if (!mapRef.current || !fitToPolyline) return;
    const coords = routePolyline && routePolyline.length >= 2 ? routePolyline : polyline;
    if (!coords || coords.length < 2) return;
    const bounds = coords.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (bounds.length < 2) return;
    const lngs = bounds.map((p) => p.lng);
    const lats = bounds.map((p) => p.lat);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 40, maxZoom: 16, duration: 800 },
    );
  }, [fitToPolyline, polyline, routePolyline]);

  const handleLoad = useCallback(() => {
    setLoading(false);
  }, []);

  const handleError = useCallback(() => {
    setErrored(true);
    setLoading(false);
  }, []);

  const safeMarkers = useMemo(
    () => (markers || []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)),
    [markers],
  );

  const safePolyline = useMemo(
    () => (polyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [polyline],
  );
  const safeRoutePolyline = useMemo(
    () => (routePolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [routePolyline],
  );
  const safeTraveled = useMemo(
    () => (traveledPolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [traveledPolyline],
  );
  const safeRemaining = useMemo(
    () => (remainingPolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [remainingPolyline],
  );

  return (
    <View style={[styles.container, style]}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_ACCESS_TOKEN}
        initialViewState={initialView}
        style={{ width: "100%", height: "100%" }}
        mapStyle={styleUrl}
        onLoad={handleLoad}
        onError={handleError}
        attributionControl={true}
        logoPosition="bottom-left"
      >
        {showControls && <NavigationControl position="bottom-right" />}
        {showControls && <FullscreenControl position="bottom-right" />}

        {safeMarkers.map((m) => (
          <Marker
            key={m.id}
            latitude={m.lat}
            longitude={m.lng}
            anchor="center"
            onClick={() => onMarkerPress?.(String(m.id))}
          >
            <MarkerContent marker={m} />
          </Marker>
        ))}

        {/* Raw GPS fallback — only shown when no road-snapped route exists */}
        {safePolyline.length >= 2 && safeRoutePolyline.length < 2 && (
          <Source id="polyline" type="geojson" data={toGeoJSONLine(safePolyline)}>
            <Layer {...polylineLayerStyle} />
          </Source>
        )}

        {safeRoutePolyline.length >= 2 && (
          <Source id="route" type="geojson" data={toGeoJSONLine(safeRoutePolyline)}>
            <Layer {...routeLayerStyle} />
          </Source>
        )}

        {safeTraveled.length >= 2 && (
          <Source id="traveled" type="geojson" data={toGeoJSONLine(safeTraveled)}>
            <Layer {...traveledLayerStyle} />
          </Source>
        )}

        {safeRemaining.length >= 2 && (
          <Source id="remaining" type="geojson" data={toGeoJSONLine(safeRemaining)}>
            <Layer {...remainingLayerStyle} />
          </Source>
        )}
      </Map>

      {loading && !errored ? (
        <LoadingOverlay visible={loading && !errored} />
      ) : null}
      {errored ? (
        <LoadingOverlay visible={errored} errorText="Map couldn't load" showRetry={false} />
      ) : null}
    </View>
  );
}

function MarkerContent({ marker }: { marker: OsmMarker }) {
  const palette: Record<OsmMarkerColor, string> = {
    blue: "#1E4E8A",
    red: "#dc2626",
    green: "#16a34a",
    orange: "#f97316",
  };
  const hex = palette[marker.color || "blue"];

  if (marker.variant === "number") {
    return (
      <div
        title={marker.title || ""}
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          background: "#F4A820",
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "700 16px system-ui, -apple-system, sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          border: "2px solid rgba(255,255,255,0.9)",
          cursor: "pointer",
          transform: "translate(-50%, -50%)",
        }}
      >
        {marker.label}
      </div>
    );
  }

  if (marker.variant === "vehicle") {
    return (
      <div
        title={marker.title || ""}
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          background: hex,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: "700 14px system-ui, -apple-system, sans-serif",
          boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
          border: "2px solid white",
          cursor: "pointer",
          transform: "translate(-50%, -50%)",
        }}
      >
        {marker.label || "▶"}
      </div>
    );
  }

  return (
    <div
      title={marker.title || ""}
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        border: "3px solid #fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
        background: hex,
        cursor: "pointer",
        transform: "translate(-50%, -50%)",
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#e8eef5" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(232,238,245,0.85)",
    zIndex: 10,
  },
  overlayText: { fontSize: 13, fontFamily: "Inter_400Regular", color: C.textSecondary },
  errorTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", color: C.text },
});

export function safeCenter(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export { DEFAULT_CENTER, DEFAULT_ZOOM };
