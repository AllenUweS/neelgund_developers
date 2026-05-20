/**
 * GoogleMapsWebMap.tsx
 * Drop-in replacement for MapboxWebMap.tsx.
 *
 * Renders Google Maps inside a React Native WebView using the
 * Google Maps JavaScript API v3. Supports:
 *   - Street / Satellite tile modes
 *   - Employee marker pins (dot, number, vehicle variants)
 *   - Raw GPS polyline (blue)
 *   - Road-snapped route polyline (dark navy)
 *   - Traveled polyline (green)
 *   - Remaining polyline (grey)
 *   - fitBounds to polyline
 *   - Smooth pan/zoom via setView
 *   - Marker click → onMarkerPress callback
 *
 * FIXES applied vs original:
 *   1. Export renamed from MapboxWebMap → GoogleMapsWebMap (+ compat re-export)
 *   2. COLORS constant hoisted above pinEl() in the injected HTML so it is
 *      defined before it is referenced.
 *   3. WebView baseUrl changed from maps.googleapis.com to about:blank so
 *      the Android WebView does not reject the Maps JS API callback due to
 *      same-origin mismatches.
 *   4. lastXxxKeyRef values are now only updated AFTER injectJavaScript
 *      succeeds, not before. This prevents the "missed update" race where
 *      props change before the map is ready but the refs are already stamped,
 *      causing applyState() to skip the update after ready fires.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import Colors from "@/constants/colors";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { GOOGLE_MAPS_KEY } from "@/lib/googleMapsKey";

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
  viewRequestKey?: number;
  tileMode?: OsmTileMode;
  onMarkerPress?: (id: string) => void;
  style?: StyleProp<ViewStyle>;
};

export const DEFAULT_CENTER: LatLng = { lat: 15.3647, lng: 75.124 };
export const DEFAULT_ZOOM = 8;

// ─── Colour palette ──────────────────────────────────────────────────────────
const COLORS: Record<OsmMarkerColor, string> = {
  blue: "#1E4E8A",
  red: "#dc2626",
  green: "#16a34a",
  orange: "#f97316",
};

// ─── HTML template ────────────────────────────────────────────────────────────
function buildHTML(apiKey: string): string {
  // FIX #2: COLORS is now injected BEFORE pinEl() so the reference resolves.
  // FIX #3: baseUrl is set to "" (about:blank) — see WebView props below.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
<title>Google Maps</title>
<style>
  html,body,#map{margin:0;padding:0;width:100%;height:100%;background:#e8eef5;}
  .gm-style-cc,.gm-fullscreen-control,.gmnoprint{display:none!important;}
  .pin-dot{width:26px;height:26px;border-radius:13px;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);cursor:pointer;display:flex;align-items:center;justify-content:center;font:700 12px system-ui,sans-serif;color:#fff;}
  .pin-number{width:34px;height:34px;border-radius:17px;background:#F4A820;color:#fff;display:flex;align-items:center;justify-content:center;font:700 16px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid rgba(255,255,255,.9);cursor:pointer;}
  .pin-vehicle{width:30px;height:30px;border-radius:15px;background:#0B3A57;color:#fff;display:flex;align-items:center;justify-content:center;font:700 14px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35);border:2px solid #fff;cursor:pointer;}
</style>
</head>
<body>
<div id="map"></div>
<script>
(function(){
  function post(obj){
    try{
      if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    }catch(e){}
  }

  // ── COLORS must be declared BEFORE pinEl() uses it ─────────────────────────
  var COLORS=${JSON.stringify(COLORS)};

  // ── State ─────────────────────────────────────────────────────────────────
  var map,
      infoWindow,
      markers=[],
      polyline=null,
      routePoly=null,
      traveledPoly=null,
      remainingPoly=null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function latLngs(coords){
    return (coords||[])
      .filter(function(c){return isFinite(c.lat)&&isFinite(c.lng);})
      .map(function(c){return{lat:c.lat,lng:c.lng};});
  }

  function clearPolyline(ref){
    if(ref){ref.setMap(null);}
    return null;
  }

  function makePoly(coords,opts){
    if(!coords||coords.length<2)return null;
    var pts=latLngs(coords);
    if(pts.length<2)return null;
    return new google.maps.Polyline(Object.assign({path:pts,map:map},opts));
  }

  function pinEl(m){
    var div=document.createElement('div');
    if(m.variant==='number'){
      div.className='pin-number';
      div.textContent=m.label!=null?String(m.label):'';
    }else if(m.variant==='vehicle'){
      div.className='pin-vehicle';
      div.style.background=COLORS[m.color]||'#0B3A57';
      div.textContent=m.label||'\u25B6';
    }else{
      div.className='pin-dot';
      div.style.background=COLORS[m.color]||'#1E4E8A';
      div.textContent=m.label!=null?String(m.label):'';
    }
    return div;
  }

  // ── Boot (called by Maps callback) ────────────────────────────────────────
  window.initMap=function(){
    map=new google.maps.Map(document.getElementById('map'),{
      center:{lat:15.3647,lng:75.124},
      zoom:8,
      mapTypeId:'roadmap',
      disableDefaultUI:true,
      gestureHandling:'greedy'
    });
    infoWindow=new google.maps.InfoWindow();

    // ── Public API called from React Native via injectJavaScript ──────────
    window.__gm={
      setView:function(lat,lng,zoom){
        if(!isFinite(lat)||!isFinite(lng))return;
        map.panTo({lat:lat,lng:lng});
        if(isFinite(zoom))map.setZoom(zoom);
      },
      setTileMode:function(mode){
        map.setMapTypeId(mode==='satellite'?'hybrid':'roadmap');
      },
      setMarkers:function(list){
        markers.forEach(function(m){m.setMap(null);});
        markers=[];
        (list||[]).forEach(function(m){
          if(!isFinite(m.lat)||!isFinite(m.lng))return;
          var el=pinEl(m);
          var ov=new google.maps.OverlayView();
          (function(elem,data){
            ov.onAdd=function(){
              var pane=this.getPanes().overlayMouseTarget;
              pane.appendChild(elem);
            };
            ov.draw=function(){
              var proj=this.getProjection();
              if(!proj)return;
              var pos=proj.fromLatLngToDivPixel(new google.maps.LatLng(data.lat,data.lng));
              if(!pos)return;
              // Use fixed sizes so offsetWidth/Height are not needed before layout
              var w=parseInt(elem.className==='pin-number'?'34':(elem.className==='pin-vehicle'?'30':'26'),10);
              var h=w;
              elem.style.position='absolute';
              elem.style.left=(pos.x-(w/2))+'px';
              elem.style.top=(pos.y-(h/2))+'px';
            };
            ov.onRemove=function(){if(elem.parentNode)elem.parentNode.removeChild(elem);};
            elem.addEventListener('click',function(){
              post({type:'marker',id:String(data.id)});
            });
            ov.setMap(map);
            markers.push(ov);
          })(el,m);
        });
      },
      setPolyline:function(coords){
        polyline=clearPolyline(polyline);
        routePoly=clearPolyline(routePoly);
        traveledPoly=clearPolyline(traveledPoly);
        remainingPoly=clearPolyline(remainingPoly);
        polyline=makePoly(coords,{strokeColor:'#2563EB',strokeWeight:5,strokeOpacity:0.85});
      },
      setRoutePolyline:function(coords){
        polyline=clearPolyline(polyline);
        routePoly=clearPolyline(routePoly);
        routePoly=makePoly(coords,{strokeColor:'#0B3A57',strokeWeight:6,strokeOpacity:1});
      },
      setTraveledPolyline:function(coords){
        traveledPoly=clearPolyline(traveledPoly);
        traveledPoly=makePoly(coords,{strokeColor:'#10B981',strokeWeight:6,strokeOpacity:1});
      },
      setRemainingPolyline:function(coords){
        remainingPoly=clearPolyline(remainingPoly);
        remainingPoly=makePoly(coords,{strokeColor:'#9CA3AF',strokeWeight:4,strokeOpacity:0.6});
      },
      fitTo:function(coords){
        var pts=latLngs(coords);
        if(pts.length===0)return;
        if(pts.length===1){map.panTo(pts[0]);map.setZoom(15);return;}
        var bounds=new google.maps.LatLngBounds();
        pts.forEach(function(p){bounds.extend(p);});
        map.fitBounds(bounds,{top:40,right:40,bottom:40,left:40});
        google.maps.event.addListenerOnce(map,'idle',function(){
          if(map.getZoom()>16)map.setZoom(16);
        });
      }
    };

    post({type:'ready'});
  };
})();
</script>
<script async defer
  src="https://maps.googleapis.com/maps/api/js?key=${apiKey}&callback=initMap&v=weekly">
</script>
</body>
</html>`;
}

// ─── React component ──────────────────────────────────────────────────────────
// FIX #1: Export is now GoogleMapsWebMap. A compat alias (MapboxWebMap) is
// re-exported at the bottom so TripNavigationView keeps working without changes.
export function GoogleMapsWebMap({
  center,
  zoom,
  markers,
  polyline,
  routePolyline,
  traveledPolyline,
  remainingPolyline,
  fitToPolyline,
  fitRequestKey,
  viewRequestKey,
  tileMode,
  onMarkerPress,
  style,
}: OsmWebMapProps) {
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);

  // FIX #4: These refs track what has ACTUALLY been injected into the WebView.
  // They are only written after a successful injectJavaScript call, not before.
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

  const html = useMemo(() => buildHTML(GOOGLE_MAPS_KEY), []);

  const payload = useMemo(() => {
    const safeMarkers = (markers || []).filter(
      (m) => Number.isFinite(m.lat) && Number.isFinite(m.lng)
    );
    const safePoly = (polyline || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    const safeRoute = (routePolyline || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    const safeTraveled = (traveledPolyline || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );
    const safeRemaining = (remainingPolyline || []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
    );

    const identity = (arr: LatLng[]) =>
      arr.length > 0
        ? `${arr.length}:${arr[0].lat},${arr[0].lng}:${arr[arr.length - 1].lat},${arr[arr.length - 1].lng}`
        : "empty";

    const polyKey = identity(safePoly);
    const routeKey = identity(safeRoute);
    const traveledKey =
      safeTraveled.length > 0
        ? `${safeTraveled.length}:${safeTraveled[0].lat},${safeTraveled[0].lng}`
        : "empty";
    const remainingKey =
      safeRemaining.length > 0
        ? `${safeRemaining.length}:${safeRemaining[0].lat},${safeRemaining[0].lng}`
        : "empty";
    const markersKey = safeMarkers
      .map(
        (m) =>
          `${m.id}:${m.lat.toFixed(6)}:${m.lng.toFixed(6)}:${m.label ?? ""}:${m.variant ?? ""}:${m.color ?? ""}`
      )
      .join("|");

    return {
      center:
        center &&
        Number.isFinite(center.lat) &&
        Number.isFinite(center.lng)
          ? center
          : null,
      zoom: typeof zoom === "number" && Number.isFinite(zoom) ? zoom : null,
      markers: safeMarkers,
      markersKey,
      polyline: safePoly,
      polylineKey: polyKey,
      routePolyline: safeRoute,
      routePolylineKey: routeKey,
      traveledPolyline: safeTraveled,
      traveledPolylineKey: traveledKey,
      remainingPolyline: safeRemaining,
      remainingPolylineKey: remainingKey,
      fitToPolyline: !!fitToPolyline,
      fitRequestKey: fitRequestKey ?? 0,
      viewRequestKey: viewRequestKey ?? 0,
      tileMode: (tileMode === "satellite" ? "satellite" : "map") as OsmTileMode,
      fitIdentity: routeKey !== "empty" ? routeKey : polyKey,
    };
  }, [
    center, zoom, markers, polyline, routePolyline,
    traveledPolyline, remainingPolyline, fitToPolyline, fitRequestKey, viewRequestKey, tileMode,
  ]);

  const applyState = useCallback(() => {
    if (!readyRef.current || !webRef.current) return;

    const hasPolyline =
      payload.polyline.length >= 2 || payload.routePolyline.length >= 2;
    const shouldFit =
      payload.fitToPolyline &&
      hasPolyline &&
      lastFitKeyRef.current !==
        `${payload.fitRequestKey}:${payload.fitIdentity}`;

    const shouldTile = lastTileModeRef.current !== payload.tileMode;
    const shouldMarkers = lastMarkersKeyRef.current !== payload.markersKey;
    const shouldPoly = lastPolylineKeyRef.current !== payload.polylineKey;
    const shouldRoute =
      lastRoutePolylineKeyRef.current !== payload.routePolylineKey;
    const shouldTraveled =
      lastTraveledPolylineKeyRef.current !== payload.traveledPolylineKey;
    const shouldRemaining =
      lastRemainingPolylineKeyRef.current !== payload.remainingPolylineKey;
    const viewKey = payload.center
      ? `${payload.center.lat.toFixed(6)}:${payload.center.lng.toFixed(6)}:${payload.zoom ?? DEFAULT_ZOOM}:${payload.viewRequestKey}`
      : null;
    const shouldView =
      !shouldFit && !!payload.center && lastViewKeyRef.current !== viewKey;

    const fitCoords =
      payload.routePolyline.length >= 2
        ? payload.routePolyline
        : payload.polyline;

    const js = `
try {
  if (window.__gm) {
    ${shouldTile ? `window.__gm.setTileMode(${JSON.stringify(payload.tileMode)});` : ""}
    ${shouldMarkers ? `window.__gm.setMarkers(${JSON.stringify(payload.markers)});` : ""}
    ${shouldRoute ? `window.__gm.setRoutePolyline(${JSON.stringify(payload.routePolyline)});` : ""}
    ${
      shouldPoly &&
      payload.routePolyline.length < 2 &&
      payload.traveledPolyline.length < 2
        ? `window.__gm.setPolyline(${JSON.stringify(payload.polyline)});`
        : ""
    }
    ${shouldTraveled ? `window.__gm.setTraveledPolyline(${JSON.stringify(payload.traveledPolyline)});` : ""}
    ${shouldRemaining ? `window.__gm.setRemainingPolyline(${JSON.stringify(payload.remainingPolyline)});` : ""}
    ${
      shouldFit
        ? `window.__gm.fitTo(${JSON.stringify(fitCoords)});`
        : shouldView && payload.center
        ? `window.__gm.setView(${payload.center.lat},${payload.center.lng},${payload.zoom ?? DEFAULT_ZOOM});`
        : ""
    }
  }
} catch(e) {}
true;
`;

    try {
      webRef.current.injectJavaScript(js);

      // FIX #4: Only stamp the refs AFTER the injection succeeds. This prevents
      // the race where the map isn't ready yet, refs are stamped, then when
      // ready fires applyState() incorrectly skips those updates.
      if (shouldFit)
        lastFitKeyRef.current = `${payload.fitRequestKey}:${payload.fitIdentity}`;
      if (shouldTile) lastTileModeRef.current = payload.tileMode;
      if (shouldMarkers) lastMarkersKeyRef.current = payload.markersKey;
      if (shouldPoly) lastPolylineKeyRef.current = payload.polylineKey;
      if (shouldRoute) lastRoutePolylineKeyRef.current = payload.routePolylineKey;
      if (shouldTraveled)
        lastTraveledPolylineKeyRef.current = payload.traveledPolylineKey;
      if (shouldRemaining)
        lastRemainingPolylineKeyRef.current = payload.remainingPolylineKey;
      if (shouldView && viewKey) lastViewKeyRef.current = viewKey;
    } catch {
      // ignore; next render will retry
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
          // On ready, reset all stamped refs so applyState() sends everything fresh.
          lastFitKeyRef.current = null;
          lastMarkersKeyRef.current = null;
          lastPolylineKeyRef.current = null;
          lastRoutePolylineKeyRef.current = null;
          lastTraveledPolylineKeyRef.current = null;
          lastRemainingPolylineKeyRef.current = null;
          lastTileModeRef.current = null;
          lastViewKeyRef.current = null;
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
    [applyState, onMarkerPress]
  );

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        // FIX #3: Do NOT set baseUrl to maps.googleapis.com. The Maps JS API
        // script uses a callback (initMap) which works fine with the default
        // about:blank origin. Setting it to googleapis.com was causing the
        // Android WebView to apply stricter same-origin restrictions and block
        // the script callback in some versions.
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
          // tile errors are not fatal
        }}
        style={styles.web}
      />
      {loading && !errored ? (
        <LoadingOverlay visible={true} />
      ) : null}
      {errored ? (
        <LoadingOverlay visible={true} errorText="Map couldn't load" showRetry={false} />
      ) : null}
    </View>
  );
}

// Backward-compat alias so TripNavigationView (which imports MapboxWebMap from
// this file) keeps working without any changes.
export { GoogleMapsWebMap as MapboxWebMap };

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
