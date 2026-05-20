import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import Colors from "@/constants/colors";
import { LoadingOverlay } from "@/components/LoadingOverlay";

const C = Colors.light;

export type LatLng = { lat: number; lng: number };
export type OsmMarkerColor = "blue" | "red" | "green" | "orange";
export type OsmTileMode = "map" | "satellite";

export type OsmMarker = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  color?: OsmMarkerColor;
  label?: string;
  variant?: "dot" | "number" | "vehicle";
};

export type OsmWebMapProps = {
  center?: LatLng | null;
  zoom?: number;
  markers?: OsmMarker[];
  polyline?: LatLng[];
  routePolyline?: LatLng[]; // Road-based route (follows actual roads)
  traveledPolyline?: LatLng[]; // Already traveled portion (green)
  remainingPolyline?: LatLng[]; // Remaining portion (gray)
  fitToPolyline?: boolean;
  fitRequestKey?: number;
  tileMode?: OsmTileMode;
  onMarkerPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_CENTER: LatLng = { lat: 15.3647, lng: 75.124 };
const DEFAULT_ZOOM = 8;

const HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>OSM</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e8eef5; }
  .leaflet-control-attribution { font-size: 10px; }
  .osm-pin-outer { position: relative; width: 22px; height: 22px; }
  .osm-pin-dot { position: absolute; top: 0; left: 0; width: 22px; height: 22px; border-radius: 11px; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); }
  .osm-number-pin { width: 34px; height: 34px; border-radius: 17px; background: #F4A820; color: white; display: flex; align-items: center; justify-content: center; font: 700 16px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 2px solid rgba(255,255,255,0.9); }
  .osm-vehicle-pin { width: 30px; height: 30px; border-radius: 15px; background: #0B3A57; color: white; display: flex; align-items: center; justify-content: center; font: 700 14px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.35); border: 2px solid white; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
(function () {
  function post(obj) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch (e) {}
  }

  function boot() {
    if (typeof L === 'undefined') { post({ type: 'error', message: 'leaflet-missing' }); return; }

    var map = L.map('map', { zoomControl: false, attributionControl: true, tap: true })
      .setView([15.3647, 75.124], 8);
    var tileLayer = null;
    var tileMode = 'map';
    var tileDefs = {
      map: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        options: { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', crossOrigin: true }
      },
      satellite: {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        options: { maxZoom: 19, attribution: 'Tiles &copy; Esri' }
      }
    };

    function setTile(mode) {
      var nextMode = mode === 'satellite' ? 'satellite' : 'map';
      if (tileLayer && tileMode === nextMode) return;
      if (tileLayer) map.removeLayer(tileLayer);
      tileMode = nextMode;
      var def = tileDefs[tileMode];
      tileLayer = L.tileLayer(def.url, def.options).addTo(map);
    }

    setTile('map');

    var markerLayer = L.layerGroup().addTo(map);
    var polylineLayer = null;
    var routePolylineLayer = null;
    var traveledPolylineLayer = null;
    var remainingPolylineLayer = null;

    function iconFor(color) {
      var palette = { blue: '#1E4E8A', red: '#dc2626', green: '#16a34a', orange: '#f97316' };
      var hex = palette[color] || '#1E4E8A';
      return L.divIcon({
        className: '',
        html: '<div class="osm-pin-outer"><div class="osm-pin-dot" style="background:' + hex + ';"></div></div>',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });
    }

    function markerIcon(m) {
      var label = m && m.label != null ? String(m.label) : '';
      if (m && m.variant === 'number') {
        return L.divIcon({
          className: '',
          html: '<div class="osm-number-pin">' + label + '</div>',
          iconSize: [34, 34],
          iconAnchor: [17, 17]
        });
      }
      if (m && m.variant === 'vehicle') {
        var vPalette = { blue: '#1E4E8A', red: '#dc2626', green: '#16a34a', orange: '#f97316' };
        var vHex = vPalette[m.color] || '#0B3A57';
        return L.divIcon({
          className: '',
          html: '<div class="osm-vehicle-pin" style="background:' + vHex + ';">' + (label || '&#9654;') + '</div>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        });
      }
      return iconFor(m && m.color);
    }

    window.__osm = {
      setView: function (lat, lng, zoom) {
        if (!isFinite(lat) || !isFinite(lng)) return;
        map.setView([lat, lng], isFinite(zoom) ? zoom : map.getZoom(), { animate: true });
      },
      setTileMode: setTile,
      setMarkers: function (list) {
        markerLayer.clearLayers();
        (list || []).forEach(function (m) {
          if (!m || !isFinite(m.lat) || !isFinite(m.lng)) return;
          var mk = L.marker([m.lat, m.lng], { icon: markerIcon(m), keyboard: false });
          if (m.title) mk.bindTooltip(String(m.title), { direction: 'top', offset: [0, -10] });
          mk.on('click', function () { post({ type: 'marker', id: String(m.id) }); });
          mk.addTo(markerLayer);
        });
      },
      setPolyline: function (coords) {
        if (polylineLayer) { map.removeLayer(polylineLayer); polylineLayer = null; }
        if (routePolylineLayer) { map.removeLayer(routePolylineLayer); routePolylineLayer = null; }
        if (traveledPolylineLayer) { map.removeLayer(traveledPolylineLayer); traveledPolylineLayer = null; }
        if (remainingPolylineLayer) { map.removeLayer(remainingPolylineLayer); remainingPolylineLayer = null; }
        if (!coords || coords.length < 2) return;
        var pts = [];
        for (var i = 0; i < coords.length; i++) {
          var c = coords[i];
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lat, c.lng]);
        }
        if (pts.length < 2) return;
        // Dashed lighter blue for raw GPS trail (visible when route hasn't loaded yet)
        polylineLayer = L.polyline(pts, { color: '#1687F2', weight: 4, opacity: 0.55, dashArray: '8, 10' }).addTo(map);
      },
      setRoutePolyline: function (coords) {
        if (polylineLayer) { map.removeLayer(polylineLayer); polylineLayer = null; }
        if (routePolylineLayer) { map.removeLayer(routePolylineLayer); routePolylineLayer = null; }
        if (!coords || coords.length < 2) return;
        var pts = [];
        for (var i = 0; i < coords.length; i++) {
          var c = coords[i];
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lat, c.lng]);
        }
        if (pts.length < 2) return;
        // Solid dark blue for road-based route
        routePolylineLayer = L.polyline(pts, { color: '#0B3A57', weight: 5, opacity: 0.95 }).addTo(map);
      },
      setTraveledPolyline: function (coords) {
        if (traveledPolylineLayer) { map.removeLayer(traveledPolylineLayer); traveledPolylineLayer = null; }
        if (!coords || coords.length < 2) return;
        var pts = [];
        for (var i = 0; i < coords.length; i++) {
          var c = coords[i];
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lat, c.lng]);
        }
        if (pts.length < 2) return;
        traveledPolylineLayer = L.polyline(pts, { color: '#10B981', weight: 5, opacity: 0.9 }).addTo(map);
      },
      setRemainingPolyline: function (coords) {
        if (remainingPolylineLayer) { map.removeLayer(remainingPolylineLayer); remainingPolylineLayer = null; }
        if (!coords || coords.length < 2) return;
        var pts = [];
        for (var i = 0; i < coords.length; i++) {
          var c = coords[i];
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lat, c.lng]);
        }
        if (pts.length < 2) return;
        remainingPolylineLayer = L.polyline(pts, { color: '#D1D5DB', weight: 4, opacity: 0.7, dashArray: '6, 8' }).addTo(map);
      },
      fitTo: function (coords) {
        var pts = [];
        (coords || []).forEach(function (c) {
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lat, c.lng]);
        });
        if (pts.length === 0) return;
        if (pts.length === 1) { map.setView(pts[0], 15, { animate: true }); return; }
        try { map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 }); } catch (e) {}
      }
    };

    post({ type: 'ready' });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
</script>
</body>
</html>`;

export function OsmWebMap({
  center,
  zoom,
  markers,
  polyline,
  routePolyline,
  traveledPolyline,
  remainingPolyline,
  fitToPolyline,
  fitRequestKey,
  tileMode,
  onMarkerPress,
  style,
}: OsmWebMapProps) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const lastFitKeyRef = useRef<string | null>(null);
  const lastMarkersKeyRef = useRef<string | null>(null);
  const lastPolylineKeyRef = useRef<string | null>(null);
  const lastRoutePolylineKeyRef = useRef<string | null>(null);
  const lastTraveledPolylineKeyRef = useRef<string | null>(null);
  const lastRemainingPolylineKeyRef = useRef<string | null>(null);
  const lastTileModeRef = useRef<OsmTileMode | null>(null);
  const lastViewKeyRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  const payload = useMemo(
    () => {
      const safeMarkers = (markers || []).filter((m) => Number.isFinite(m.lat) && Number.isFinite(m.lng));
      const safePolyline = (polyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const safeRoutePolyline = (routePolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const safeTraveledPolyline = (traveledPolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const safeRemainingPolyline = (remainingPolyline || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
      const polylineIdentity =
        safePolyline.length > 0
          ? `${safePolyline.length}:${safePolyline[0]?.lat},${safePolyline[0]?.lng}:${safePolyline[safePolyline.length - 1]?.lat},${safePolyline[safePolyline.length - 1]?.lng}`
          : "empty";
      const routePolylineIdentity =
        safeRoutePolyline.length > 0
          ? `${safeRoutePolyline.length}:${safeRoutePolyline[0]?.lat},${safeRoutePolyline[0]?.lng}:${safeRoutePolyline[safeRoutePolyline.length - 1]?.lat},${safeRoutePolyline[safeRoutePolyline.length - 1]?.lng}`
          : "empty";
      const traveledPolylineIdentity =
        safeTraveledPolyline.length > 0
          ? `${safeTraveledPolyline.length}:${safeTraveledPolyline[0]?.lat},${safeTraveledPolyline[0]?.lng}`
          : "empty";
      const remainingPolylineIdentity =
        safeRemainingPolyline.length > 0
          ? `${safeRemainingPolyline.length}:${safeRemainingPolyline[0]?.lat},${safeRemainingPolyline[0]?.lng}`
          : "empty";
      return {
        center: center && Number.isFinite(center.lat) && Number.isFinite(center.lng) ? center : null,
        zoom: typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null,
        markers: safeMarkers,
        markersKey: safeMarkers
          .map((m) => `${m.id}:${m.lat.toFixed(6)}:${m.lng.toFixed(6)}:${m.label ?? ""}:${m.variant ?? ""}:${m.color ?? ""}`)
          .join("|"),
        polyline: safePolyline,
        polylineKey: polylineIdentity,
        routePolyline: safeRoutePolyline,
        routePolylineKey: routePolylineIdentity,
        traveledPolyline: safeTraveledPolyline,
        traveledPolylineKey: traveledPolylineIdentity,
        remainingPolyline: safeRemainingPolyline,
        remainingPolylineKey: remainingPolylineIdentity,
        fitToPolyline: !!fitToPolyline,
        fitRequestKey: fitRequestKey ?? 0,
        tileMode: (tileMode === "satellite" ? "satellite" : "map") as OsmTileMode,
        fitIdentity: routePolylineIdentity !== "empty" ? routePolylineIdentity : polylineIdentity,
      };
    },
    [center, zoom, markers, polyline, routePolyline, traveledPolyline, remainingPolyline, fitToPolyline, fitRequestKey, tileMode],
  );

  const applyState = useCallback(() => {
    if (!readyRef.current || !webRef.current) return;
    const hasPolyline = payload.polyline.length >= 2 || payload.routePolyline.length >= 2;
    const shouldFit =
      payload.fitToPolyline &&
      hasPolyline &&
      lastFitKeyRef.current !== `${payload.fitRequestKey}:${payload.fitIdentity}`;
    if (shouldFit) lastFitKeyRef.current = `${payload.fitRequestKey}:${payload.fitIdentity}`;

    const shouldSetTile = lastTileModeRef.current !== payload.tileMode;
    const shouldSetMarkers = lastMarkersKeyRef.current !== payload.markersKey;
    const shouldSetPolyline = lastPolylineKeyRef.current !== payload.polylineKey;
    const shouldSetRoutePolyline = lastRoutePolylineKeyRef.current !== payload.routePolylineKey;
    const shouldSetTraveledPolyline = lastTraveledPolylineKeyRef.current !== payload.traveledPolylineKey;
    const shouldSetRemainingPolyline = lastRemainingPolylineKeyRef.current !== payload.remainingPolylineKey;
    const viewKey = payload.center
      ? `${payload.center.lat.toFixed(6)}:${payload.center.lng.toFixed(6)}:${payload.zoom ?? DEFAULT_ZOOM}`
      : null;
    const shouldSetView = !shouldFit && !!payload.center && lastViewKeyRef.current !== viewKey;

    if (shouldSetTile) lastTileModeRef.current = payload.tileMode;
    if (shouldSetMarkers) lastMarkersKeyRef.current = payload.markersKey;
    if (shouldSetPolyline) lastPolylineKeyRef.current = payload.polylineKey;
    if (shouldSetRoutePolyline) lastRoutePolylineKeyRef.current = payload.routePolylineKey;
    if (shouldSetTraveledPolyline) lastTraveledPolylineKeyRef.current = payload.traveledPolylineKey;
    if (shouldSetRemainingPolyline) lastRemainingPolylineKeyRef.current = payload.remainingPolylineKey;
    if (shouldSetView && viewKey) lastViewKeyRef.current = viewKey;

    const fitCoords = payload.routePolyline.length >= 2 ? payload.routePolyline : payload.polyline;

    const js = `
      try {
        if (window.__osm) {
          ${shouldSetTile ? `window.__osm.setTileMode(${JSON.stringify(payload.tileMode)});` : ""}
          ${shouldSetMarkers ? `window.__osm.setMarkers(${JSON.stringify(payload.markers)});` : ""}
          ${shouldSetRoutePolyline ? `window.__osm.setRoutePolyline(${JSON.stringify(payload.routePolyline)});` : ""}
          ${shouldSetPolyline && payload.routePolyline.length < 2 && payload.traveledPolyline.length < 2 ? `window.__osm.setPolyline(${JSON.stringify(payload.polyline)});` : ""}
          ${shouldSetTraveledPolyline ? `window.__osm.setTraveledPolyline(${JSON.stringify(payload.traveledPolyline)});` : ""}
          ${shouldSetRemainingPolyline ? `window.__osm.setRemainingPolyline(${JSON.stringify(payload.remainingPolyline)});` : ""}
          ${shouldFit
            ? `window.__osm.fitTo(${JSON.stringify(fitCoords)});`
            : shouldSetView && payload.center
            ? `window.__osm.setView(${payload.center.lat}, ${payload.center.lng}, ${payload.zoom ?? DEFAULT_ZOOM});`
            : ""}
        }
      } catch (e) {}
      true;
    `;
    try {
      webRef.current.injectJavaScript(js);
    } catch {
      // ignore
    }
  }, [payload]);

  useEffect(() => {
    applyState();
  }, [applyState]);

  const handleMessage = useCallback(
    (e: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(e.nativeEvent.data);
        if (msg?.type === "ready") {
          readyRef.current = true;
          setLoading(false);
          applyState();
        } else if (msg?.type === "marker" && msg.id) {
          onMarkerPress?.(String(msg.id));
        } else if (msg?.type === "error") {
          setErrored(true);
          setLoading(false);
        }
      } catch {
        // ignore
      }
    },
    [applyState, onMarkerPress],
  );

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html: HTML, baseUrl: "https://tile.openstreetmap.org/" }}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        cacheEnabled
        androidLayerType="hardware"
        startInLoadingState={false}
        onError={() => {
          setErrored(true);
          setLoading(false);
        }}
        onHttpError={() => {
          // tile errors are normal on transient network; don't treat as fatal
        }}
        style={styles.web}
      />
      {loading && !errored ? (
        <LoadingOverlay visible={loading && !errored} />
      ) : null}
      {errored ? (
        <LoadingOverlay visible={errored} errorText="Map couldn't load" showRetry={false} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#e8eef5" },
  web: { flex: 1, backgroundColor: "#e8eef5" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(232,238,245,0.85)",
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
