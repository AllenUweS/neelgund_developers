import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import Colors from "@/constants/colors";
import { MAPBOX_ACCESS_TOKEN } from "@/lib/mapboxToken";

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
  routePolyline?: LatLng[];
  traveledPolyline?: LatLng[];
  remainingPolyline?: LatLng[];
  fitToPolyline?: boolean;
  fitRequestKey?: number;
  tileMode?: OsmTileMode;
  onMarkerPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

const DEFAULT_CENTER: LatLng = { lat: 15.3647, lng: 75.124 };
const DEFAULT_ZOOM = 8;

function buildHTML(token: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>Mapbox</title>
<script src="https://api.mapbox.com/mapbox-gl-js/v3.0.0/mapbox-gl.js"></script>
<link href="https://api.mapbox.com/mapbox-gl-js/v3.0.0/mapbox-gl.css" rel="stylesheet" />
<style>
  html, body, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #e8eef5; }
  .mapboxgl-ctrl-logo { display: none !important; }
  .mapboxgl-ctrl-attribution { font-size: 10px; }
  .mb-pin-dot { width: 26px; height: 26px; border-radius: 13px; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.35); display: flex; align-items: center; justify-content: center; font: 700 12px system-ui, -apple-system, sans-serif; color: white; }
  .mb-number-pin { width: 34px; height: 34px; border-radius: 17px; background: #F4A820; color: white; display: flex; align-items: center; justify-content: center; font: 700 16px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3); border: 2px solid rgba(255,255,255,0.9); }
  .mb-vehicle-pin { width: 30px; height: 30px; border-radius: 15px; background: #0B3A57; color: white; display: flex; align-items: center; justify-content: center; font: 700 14px system-ui, -apple-system, sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.35); border: 2px solid white; }
</style>
</head>
<body>
<div id="map"></div>
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
    if (typeof mapboxgl === 'undefined') { post({ type: 'error', message: 'mapbox-missing' }); return; }

    mapboxgl.accessToken = ${JSON.stringify(token)};

    var map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [75.124, 15.3647],
      zoom: 8,
      attributionControl: true,
      logoPosition: 'bottom-left'
    });

    var tileMode = 'map';
    var styles = {
      map: 'mapbox://styles/mapbox/streets-v12',
      satellite: 'mapbox://styles/mapbox/satellite-streets-v12'
    };

    var markers = [];
    var layers = {};

    function clearMarkers() {
      markers.forEach(function (m) { m.remove(); });
      markers = [];
    }

    function clearLine(name) {
      if (map.getLayer(name)) map.removeLayer(name);
      if (map.getSource(name)) map.removeSource(name);
    }

    function setLine(name, coords, paint) {
      clearLine(name);
      if (!coords || coords.length < 2) return;
      var pts = [];
      for (var i = 0; i < coords.length; i++) {
        var c = coords[i];
        if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lng, c.lat]);
      }
      if (pts.length < 2) return;
      map.addSource(name, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } } });
      map.addLayer({ id: name, type: 'line', source: name, paint: paint });
    }

    function makeElement(html) {
      var el = document.createElement('div');
      el.innerHTML = html;
      return el.firstChild;
    }

    function pinHtml(color, label) {
      var palette = { blue: '#1E4E8A', red: '#dc2626', green: '#16a34a', orange: '#f97316' };
      var hex = palette[color] || '#1E4E8A';
      return '<div class="mb-pin-dot" style="background:' + hex + ';">' + (label || '') + '</div>';
    }

    function markerHtml(m) {
      var label = m && m.label != null ? String(m.label) : '';
      if (m && m.variant === 'number') {
        return '<div class="mb-number-pin">' + label + '</div>';
      }
      if (m && m.variant === 'vehicle') {
        var palette = { blue: '#1E4E8A', red: '#dc2626', green: '#16a34a', orange: '#f97316' };
        var hex = palette[m.color] || '#0B3A57';
        return '<div class="mb-vehicle-pin" style="background:' + hex + ';">' + (label || '\u25B6') + '</div>';
      }
      return pinHtml(m && m.color, label);
    }

    window.__osm = {
      setView: function (lat, lng, zoom) {
        if (!isFinite(lat) || !isFinite(lng)) return;
        map.easeTo({ center: [lng, lat], zoom: isFinite(zoom) ? zoom : map.getZoom(), duration: 600 });
      },
      setTileMode: function (mode) {
        var next = mode === 'satellite' ? 'satellite' : 'map';
        if (tileMode === next) return;
        tileMode = next;
        map.setStyle(styles[tileMode]);
        map.once('style.load', function () {
          // Re-add lines after style change
          post({ type: 'style-loaded' });
        });
      },
      setMarkers: function (list) {
        clearMarkers();
        (list || []).forEach(function (m) {
          if (!m || !isFinite(m.lat) || !isFinite(m.lng)) return;
          var el = makeElement(markerHtml(m));
          el.style.cursor = 'pointer';
          var mk = new mapboxgl.Marker({ element: el, anchor: 'center' }).setLngLat([m.lng, m.lat]).addTo(map);
          if (m.title) mk.setPopup(new mapboxgl.Popup({ offset: 10 }).setText(String(m.title)));
          el.addEventListener('click', function () { post({ type: 'marker', id: String(m.id) }); });
          markers.push(mk);
        });
      },
      setPolyline: function (coords) {
        clearLine('polyline');
        clearLine('route');
        clearLine('traveled');
        clearLine('remaining');
        setLine('polyline', coords, { 'line-color': '#2563EB', 'line-width': 5, 'line-opacity': 0.85 });
      },
      setRoutePolyline: function (coords) {
        clearLine('polyline');
        clearLine('route');
        setLine('route', coords, { 'line-color': '#0B3A57', 'line-width': 6, 'line-opacity': 1, 'line-cap': 'round', 'line-join': 'round' });
      },
      setTraveledPolyline: function (coords) {
        clearLine('traveled');
        setLine('traveled', coords, { 'line-color': '#10B981', 'line-width': 6, 'line-opacity': 1, 'line-cap': 'round', 'line-join': 'round' });
      },
      setRemainingPolyline: function (coords) {
        clearLine('remaining');
        setLine('remaining', coords, { 'line-color': '#9CA3AF', 'line-width': 4, 'line-opacity': 0.6 });
      },
      fitTo: function (coords) {
        var pts = [];
        (coords || []).forEach(function (c) {
          if (c && isFinite(c.lat) && isFinite(c.lng)) pts.push([c.lng, c.lat]);
        });
        if (pts.length === 0) return;
        if (pts.length === 1) { map.easeTo({ center: pts[0], zoom: 15, duration: 600 }); return; }
        var bounds = pts.reduce(function (b, p) { return b.extend(p); }, new mapboxgl.LngLatBounds(pts[0], pts[0]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 800 });
      }
    };

    map.on('load', function () {
      post({ type: 'ready' });
    });

    map.on('error', function (e) {
      // ignore tile/network errors
    });
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
}

export function MapboxWebMap({
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

  const html = useMemo(() => buildHTML(MAPBOX_ACCESS_TOKEN), []);

  const payload = useMemo(() => {
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
  }, [center, zoom, markers, polyline, routePolyline, traveledPolyline, remainingPolyline, fitToPolyline, fitRequestKey, tileMode]);

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
        } else if (msg?.type === "style-loaded") {
          // Re-apply lines after style change
          applyState();
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
        source={{ html, baseUrl: "https://api.mapbox.com/" }}
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
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator size="large" color={C.brand} />
          <Text style={styles.overlayText}>Loading map…</Text>
        </View>
      ) : null}
      {errored ? (
        <View style={styles.overlay}>
          <Text style={styles.errorTitle}>Map couldn&apos;t load</Text>
          <Text style={styles.overlayText}>Check your internet connection.</Text>
        </View>
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
