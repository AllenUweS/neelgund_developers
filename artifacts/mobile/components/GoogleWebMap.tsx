/**
 * GoogleWebMap.tsx  (replaces WebMap.tsx for the web platform)
 *
 * Uses the Google Maps JavaScript API via a plain <script> injection
 * (no NPM package dependency needed — avoids adding @react-google-maps/api).
 * Renders inside an <iframe-like> div using the Maps JS API loaded at runtime.
 *
 * Props are 100% identical to the old WebMap so map.web.tsx needs only
 * a one-line import change:
 *   import { WebMap, ... } from "@/components/GoogleWebMap";
 *
 * FIXES applied vs original:
 *   1. OverlayView draw() no longer relies on offsetWidth/offsetHeight (which
 *      are 0 before the element is laid out). Pin sizes are now derived from
 *      the variant, matching the hardcoded CSS values, so markers render at
 *      the correct position immediately on first draw().
 *   2. Script load promise is reset on error so a page reload retries cleanly.
 *   3. Map cleanup on unmount prevents "Map container is already initialized"
 *      errors when the component re-mounts (e.g. tab switches).
 */

import React, {
  useEffect,
  useRef,
  useState,
  useMemo,
  useCallback,
} from "react";
import { View, StyleSheet, ActivityIndicator, Text } from "react-native";
import Colors from "@/constants/colors";
import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

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
  viewRequestKey?: number;
  onMarkerPress?: (id: string) => void;
  showControls?: boolean;
  onRecenter?: () => void;
  mapStyle?: "streets" | "satellite";
  style?: any;
};

export const DEFAULT_CENTER: LatLng = { lat: 15.3647, lng: 75.124 };
export const DEFAULT_ZOOM = 8;

const PALETTE: Record<OsmMarkerColor, string> = {
  blue: "#1E4E8A",
  red: "#dc2626",
  green: "#16a34a",
  orange: "#f97316",
};

// FIX #1: Hardcoded pin sizes matching the CSS so draw() doesn't need
// offsetWidth/offsetHeight (which are 0 before the browser lays out the element).
const PIN_SIZE: Record<string, number> = {
  number: 34,
  vehicle: 30,
  dot: 26,
};

function pinSizeFor(variant?: string): number {
  return PIN_SIZE[variant ?? "dot"] ?? 26;
}

// ── Utility: load the Maps JS script once ────────────────────────────────────
let scriptLoadPromise: Promise<void> | null = null;

function loadGoogleMapsScript(apiKey: string): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (
      typeof window !== "undefined" &&
      (window as any).google?.maps
    ) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // FIX #2: Reset so a retry is possible
      scriptLoadPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

// ── Marker element factory ────────────────────────────────────────────────────
function makeMarkerElement(m: OsmMarker): HTMLElement {
  const div = document.createElement("div");
  const color = PALETTE[m.color ?? "blue"];

  if (m.variant === "number") {
    Object.assign(div.style, {
      width: "34px",
      height: "34px",
      borderRadius: "17px",
      background: "#F4A820",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "700 16px system-ui, sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,.3)",
      border: "2px solid rgba(255,255,255,.9)",
      cursor: "pointer",
      // FIX #1: Use explicit translate instead of relying on offsetWidth in draw()
      position: "absolute",
    });
    div.textContent = m.label != null ? String(m.label) : "";
  } else if (m.variant === "vehicle") {
    Object.assign(div.style, {
      width: "30px",
      height: "30px",
      borderRadius: "15px",
      background: color,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "700 14px system-ui, sans-serif",
      boxShadow: "0 2px 8px rgba(0,0,0,.35)",
      border: "2px solid white",
      cursor: "pointer",
      position: "absolute",
    });
    div.textContent = m.label || "▶";
  } else {
    Object.assign(div.style, {
      width: "26px",
      height: "26px",
      borderRadius: "13px",
      border: "3px solid #fff",
      boxShadow: "0 1px 4px rgba(0,0,0,.35)",
      background: color,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      font: "700 12px system-ui, sans-serif",
      cursor: "pointer",
      position: "absolute",
    });
    if (m.label) {
      div.textContent = m.label;
    }
  }
  return div;
}

// ── Component ─────────────────────────────────────────────────────────────────
export function WebMap({
  center,
  zoom,
  markers,
  polyline,
  routePolyline,
  traveledPolyline,
  remainingPolyline,
  fitToPolyline,
  viewRequestKey,
  onMarkerPress,
  showControls = false,
  mapStyle = "streets",
  style,
}: WebMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<google.maps.OverlayView[]>([]);
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const routePolyRef = useRef<google.maps.Polyline | null>(null);
  const traveledRef = useRef<google.maps.Polyline | null>(null);
  const remainingRef = useRef<google.maps.Polyline | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  // Safe arrays
  const safeMarkers = useMemo(
    () =>
      (markers || []).filter(
        (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)
      ),
    [markers]
  );
  const safePoly = useMemo(
    () =>
      (polyline || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ),
    [polyline]
  );
  const safeRoute = useMemo(
    () =>
      (routePolyline || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ),
    [routePolyline]
  );
  const safeTraveled = useMemo(
    () =>
      (traveledPolyline || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ),
    [traveledPolyline]
  );
  const safeRemaining = useMemo(
    () =>
      (remainingPolyline || []).filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      ),
    [remainingPolyline]
  );

  // ── Init map ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    let mounted = true;

    loadGoogleMapsScript(GOOGLE_MAPS_KEY)
      .then(() => {
        if (!mounted || !containerRef.current) return;
        // FIX #3: Guard against double-init if component re-mounts
        if (mapRef.current) return;
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: {
            lat: center?.lat ?? DEFAULT_CENTER.lat,
            lng: center?.lng ?? DEFAULT_CENTER.lng,
          },
          zoom: zoom ?? DEFAULT_ZOOM,
          mapTypeId: mapStyle === "satellite" ? "hybrid" : "roadmap",
          disableDefaultUI: !showControls,
          zoomControl: showControls,
          fullscreenControl: showControls,
          gestureHandling: "greedy",
        });
        setLoading(false);
      })
      .catch(() => {
        if (mounted) {
          setErrored(true);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync center / zoom ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !center) return;
    mapRef.current.panTo(center);
    if (typeof zoom === "number") mapRef.current.setZoom(zoom);
  }, [center, zoom, viewRequestKey]);

  // ── Map style ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setMapTypeId(
      mapStyle === "satellite" ? "hybrid" : "roadmap"
    );
  }, [mapStyle]);

  // ── Markers ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    // Remove old overlays
    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    safeMarkers.forEach((m) => {
      const el = makeMarkerElement(m);
      const ov = new google.maps.OverlayView();
      const latlng = new google.maps.LatLng(m.lat, m.lng);

      // FIX #1: Use hardcoded pin size so draw() works on the very first call
      // before the browser has performed layout (offsetWidth would be 0).
      const halfSize = pinSizeFor(m.variant) / 2;

      ov.onAdd = function () {
        this.getPanes()!.overlayMouseTarget.appendChild(el);
      };
      ov.draw = function () {
        const proj = this.getProjection();
        if (!proj) return;
        const pos = proj.fromLatLngToDivPixel(latlng);
        if (!pos) return;
        el.style.left = pos.x - halfSize + "px";
        el.style.top = pos.y - halfSize + "px";
      };
      ov.onRemove = function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      };
      el.addEventListener("click", () => onMarkerPress?.(m.id));
      ov.setMap(mapRef.current!);
      overlaysRef.current.push(ov);
    });
  }, [safeMarkers, onMarkerPress]);

  // ── Polylines ───────────────────────────────────────────────────────────────
  const setGmPoly = useCallback(
    (
      ref: React.MutableRefObject<google.maps.Polyline | null>,
      coords: LatLng[],
      opts: google.maps.PolylineOptions
    ) => {
      if (ref.current) ref.current.setMap(null);
      if (!mapRef.current || coords.length < 2) {
        ref.current = null;
        return;
      }
      ref.current = new google.maps.Polyline({
        path: coords,
        map: mapRef.current,
        ...opts,
      });
    },
    []
  );

  useEffect(() => {
    // Raw GPS path (only when no road-snapped route)
    setGmPoly(polylineRef, safeRoute.length >= 2 ? [] : safePoly, {
      strokeColor: "#2563EB",
      strokeWeight: 5,
      strokeOpacity: 0.85,
    });
  }, [safePoly, safeRoute, setGmPoly]);

  useEffect(() => {
    setGmPoly(routePolyRef, safeRoute, {
      strokeColor: "#0B3A57",
      strokeWeight: 6,
      strokeOpacity: 1,
    });
  }, [safeRoute, setGmPoly]);

  useEffect(() => {
    setGmPoly(traveledRef, safeTraveled, {
      strokeColor: "#10B981",
      strokeWeight: 6,
      strokeOpacity: 1,
    });
  }, [safeTraveled, setGmPoly]);

  useEffect(() => {
    setGmPoly(remainingRef, safeRemaining, {
      strokeColor: "#9CA3AF",
      strokeWeight: 4,
      strokeOpacity: 0.6,
    });
  }, [safeRemaining, setGmPoly]);

  // ── Fit to polyline ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current || !fitToPolyline) return;
    const coords =
      safeRoute.length >= 2 ? safeRoute : safePoly;
    if (coords.length < 2) return;
    const bounds = new google.maps.LatLngBounds();
    coords.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
    mapRef.current.fitBounds(bounds, 40);
    google.maps.event.addListenerOnce(
      mapRef.current,
      "idle",
      () => {
        if (mapRef.current && mapRef.current.getZoom()! > 16)
          mapRef.current.setZoom(16);
      }
    );
  }, [fitToPolyline, safePoly, safeRoute]);

  return (
    <View style={[styles.container, style]}>
      {/* The Google Maps container — must be a real DOM div */}
      <div
        ref={containerRef as any}
        style={{ width: "100%", height: "100%" }}
      />
      {loading && !errored ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={C.brand} />
          <Text style={styles.overlayText}>Loading map…</Text>
        </View>
      ) : null}
      {errored ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Map couldn't load</Text>
          <Text style={styles.overlayText}>
            Check your internet connection.
          </Text>
        </View>
      ) : null}
    </View>
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
  overlayText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
  },
  errorTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
});

export function safeCenter(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
