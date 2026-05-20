// import { useCallback, useMemo, useState } from "react";
// import Map, {
//   NavigationControl,
//   Source,
//   Layer,
//   type MapRef,
//   type LineLayerSpecification,
//   type FillLayerSpecification,
// } from "react-map-gl/mapbox";
// import type { EmployeeLocation, LocationPoint, Zone } from "@workspace/api-client-react";
// import EmployeeMarker from "./EmployeeMarker";

// const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// interface LiveMapProps {
//   mapStyle: string;
//   employees: EmployeeLocation[];
//   trails: LocationPoint[];
//   matchedRoute?: number[][] | null;
//   zones: Zone[];
//   selectedEmployeeId?: string | null;
//   visibleEmployeeIds: Set<string>;
//   onSelectEmployee: (id: string) => void;
//   mapRef?: React.RefObject<MapRef | null>;
//   showRawTrail?: boolean;
// }

// type SpeedColoredSegment = {
//   coordinates: number[][];
//   color: string;
// };

// function speedColor(speedKmh: number | null | undefined): string {
//   if (speedKmh == null) return "#94a3b8";
//   if (speedKmh <= 2) return "#EF4444"; // red - stopped
//   if (speedKmh <= 15) return "#F59E0B"; // yellow - slow/walking
//   if (speedKmh <= 60) return "#10B981"; // green - normal
//   return "#3B82F6"; // blue - fast
// }

// function buildSpeedColoredSegments(trails: LocationPoint[]): SpeedColoredSegment[] {
//   if (trails.length < 2) return [];
//   const segments: SpeedColoredSegment[] = [];
//   for (let i = 0; i < trails.length - 1; i++) {
//     const p1 = trails[i];
//     const p2 = trails[i + 1];
//     const speed = (p2 as any).speedKmh ?? (p1 as any).speedKmh ?? null;
//     segments.push({
//       coordinates: [
//         [p1.longitude, p1.latitude],
//         [p2.longitude, p2.latitude],
//       ],
//       color: speedColor(speed),
//     });
//   }
//   return segments;
// }

// function buildMatchedRouteGeoJSON(matchedRoute: number[][] | null | undefined) {
//   if (!matchedRoute || matchedRoute.length < 2) return null;
//   return {
//     type: "Feature" as const,
//     properties: {},
//     geometry: {
//       type: "LineString" as const,
//       coordinates: matchedRoute,
//     },
//   };
// }

// type GeoFeature = {
//   type: "Feature";
//   properties: { id: number; name: string; color: string };
//   geometry: any;
// };

// function buildZoneFeatures(zones: Zone[]): GeoFeature[] {
//   return zones
//     .map((zone): GeoFeature | null => {
//       if (zone.type === "polygon" && zone.polygonGeoJson) {
//         try {
//           const geo = JSON.parse(zone.polygonGeoJson);
//           return {
//             type: "Feature",
//             properties: { id: zone.id, name: zone.name, color: zone.color || "#3b82f6" },
//             geometry: geo,
//           };
//         } catch {
//           return null;
//         }
//       }
//       if (zone.type === "circle" && zone.centerLatitude != null && zone.centerLongitude != null && zone.radiusMeters != null) {
//         const points = 32;
//         const coords: number[][] = [];
//         const lat = zone.centerLatitude;
//         const lng = zone.centerLongitude;
//         const r = zone.radiusMeters;
//         for (let i = 0; i <= points; i++) {
//           const angle = (i * 2 * Math.PI) / points;
//           const dx = (r * Math.cos(angle)) / 111320;
//           const dy = (r * Math.sin(angle)) / (111320 * Math.cos((lat * Math.PI) / 180));
//           coords.push([lng + dx, lat + dy]);
//         }
//         return {
//           type: "Feature",
//           properties: { id: zone.id, name: zone.name, color: zone.color || "#3b82f6" },
//           geometry: {
//             type: "Polygon",
//             coordinates: [coords],
//           },
//         };
//       }
//       return null;
//     })
//     .filter((f): f is GeoFeature => f !== null);
// }

// const matchedRouteLayer: LineLayerSpecification = {
//   id: "matched-route-line",
//   type: "line",
//   source: "matched-route",
//   layout: { "line-join": "round", "line-cap": "round" },
//   paint: {
//     "line-color": "#10b981",
//     "line-width": 5,
//     "line-opacity": 0.95,
//   },
// };

// const zoneFillLayer: FillLayerSpecification = {
//   id: "zone-fill",
//   type: "fill",
//   source: "zones",
//   paint: {
//     "fill-color": ["get", "color"],
//     "fill-opacity": 0.2,
//   },
// };

// const zoneOutlineLayer: LineLayerSpecification = {
//   id: "zone-outline",
//   type: "line",
//   source: "zones",
//   paint: {
//     "line-color": ["get", "color"],
//     "line-width": 2,
//     "line-opacity": 0.8,
//   },
// };

// export default function LiveMap({
//   mapStyle,
//   employees,
//   trails,
//   matchedRoute,
//   zones,
//   selectedEmployeeId,
//   visibleEmployeeIds,
//   onSelectEmployee,
//   mapRef,
//   showRawTrail = true,
// }: LiveMapProps) {
//   const [popupInfo, setPopupInfo] = useState<{
//     latitude: number;
//     longitude: number;
//     name: string;
//     lastSeen: string;
//   } | null>(null);

//   const speedSegments = useMemo(() => buildSpeedColoredSegments(trails), [trails]);
//   const matchedRouteFeature = buildMatchedRouteGeoJSON(matchedRoute);
//   const zoneFeatures = buildZoneFeatures(zones);

//   const handleMarkerClick = useCallback(
//     (emp: EmployeeLocation) => {
//       onSelectEmployee(String(emp.employeeId));
//       setPopupInfo({
//         latitude: emp.latitude,
//         longitude: emp.longitude,
//         name: emp.employeeName,
//         lastSeen: emp.recordedAt,
//       });
//     },
//     [onSelectEmployee]
//   );

//   if (!MAPBOX_TOKEN) {
//     return (
//       <div className="flex items-center justify-center h-full bg-muted">
//         <p className="text-muted-foreground">Mapbox token not configured</p>
//       </div>
//     );
//   }

//   return (
//     <Map
//       ref={mapRef}
//       mapboxAccessToken={MAPBOX_TOKEN}
//       style={{ width: "100%", height: "100%" }}
//       mapStyle={mapStyle}
//       initialViewState={{
//         latitude: 20.5937,
//         longitude: 78.9629,
//         zoom: 4,
//       }}
//       onClick={() => setPopupInfo(null)}
//     >
//       <NavigationControl position="top-right" />

//       {/* Speed-colored raw trail segments */}
//       {showRawTrail && speedSegments.map((seg, idx) => (
//         <Source
//           key={`speed-seg-${idx}`}
//           id={`speed-seg-${idx}`}
//           type="geojson"
//           data={{
//             type: "Feature",
//             properties: {},
//             geometry: { type: "LineString", coordinates: seg.coordinates },
//           }}
//         >
//           <Layer
//             id={`speed-seg-layer-${idx}`}
//             type="line"
//             source={`speed-seg-${idx}`}
//             layout={{ "line-join": "round", "line-cap": "round" }}
//             paint={{
//               "line-color": seg.color,
//               "line-width": 4,
//               "line-opacity": 0.85,
//             }}
//           />
//         </Source>
//       ))}

//       {matchedRouteFeature && (
//         <Source id="matched-route" type="geojson" data={matchedRouteFeature}>
//           <Layer {...matchedRouteLayer} />
//         </Source>
//       )}

//       {zoneFeatures.length > 0 && (
//         <Source
//           id="zones"
//           type="geojson"
//           data={{ type: "FeatureCollection", features: zoneFeatures }}
//         >
//           <Layer {...zoneFillLayer} />
//           <Layer {...zoneOutlineLayer} />
//         </Source>
//       )}

//       {employees
//         .filter((e) => visibleEmployeeIds.has(String(e.employeeId)))
//         .map((emp) => (
//           <EmployeeMarker
//             key={String(emp.employeeId)}
//             employee={emp}
//             isSelected={String(emp.employeeId) === selectedEmployeeId}
//             onClick={() => handleMarkerClick(emp)}
//           />
//         ))}

//       {popupInfo && (
//         <div
//           className="absolute z-10 bg-card border border-border rounded-lg shadow-lg p-3 text-sm"
//           style={{
//             left: "50%",
//             top: "50%",
//             transform: "translate(-50%, -120%)",
//             pointerEvents: "none",
//           }}
//         >
//           <p className="font-semibold text-foreground">{popupInfo.name}</p>
//           <p className="text-muted-foreground">
//             {new Date(popupInfo.lastSeen).toLocaleString()}
//           </p>
//         </div>
//       )}
//     </Map>
//   );
// }

import { useEffect, useRef, useCallback } from "react";
import type { EmployeeLocation, LocationPoint, Zone } from "@workspace/api-client-react";

const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

// ── Loader: inject Google Maps script once ────────────────────────────────
let scriptPromise: Promise<void> | null = null;

function loadGoogleMaps(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  if (window.google?.maps) { scriptPromise = Promise.resolve(); return scriptPromise; }
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_KEY}&libraries=geometry`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return scriptPromise;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return `#${((hash & 0x00ffffff) >>> 0).toString(16).padStart(6, "0")}`;
}

function speedColor(kmh: number | null | undefined): string {
  if (kmh == null) return "#94a3b8";
  if (kmh <= 2) return "#EF4444";
  if (kmh <= 15) return "#F59E0B";
  if (kmh <= 60) return "#10B981";
  return "#3B82F6";
}

// ── Types ──────────────────────────────────────────────────────────────────
interface LiveMapProps {
  mapRef?: React.MutableRefObject<google.maps.Map | null>;
  employees: EmployeeLocation[];
  trails: LocationPoint[];
  matchedRoute?: number[][] | null;
  zones: Zone[];
  selectedEmployeeId?: string | null;
  visibleEmployeeIds: Set<string>;
  onSelectEmployee: (id: string) => void;
  showRawTrail?: boolean;
  isDark?: boolean;
}

// Dark map style
const DARK_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8892b0" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#16213e" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#0f3460" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#0f3460" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0d1b2a" }] },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
];

export default function LiveMap({
  mapRef: externalRef,
  employees,
  trails,
  matchedRoute,
  zones,
  selectedEmployeeId,
  visibleEmployeeIds,
  onSelectEmployee,
  showRawTrail = true,
  isDark = false,
}: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement | google.maps.Marker>>(new Map());
  const trailPolylinesRef = useRef<google.maps.Polyline[]>([]);
  const routePolylineRef = useRef<google.maps.Polyline | null>(null);
  const zoneOverlaysRef = useRef<(google.maps.Polygon | google.maps.Circle)[]>([]);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);

  // Init map
  useEffect(() => {
    if (!GOOGLE_KEY) return;
    loadGoogleMaps().then(() => {
      if (!containerRef.current || mapRef.current) return;
      const map = new google.maps.Map(containerRef.current, {
        center: { lat: 20.5937, lng: 78.9629 },
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        styles: isDark ? DARK_STYLE : [],
        gestureHandling: "greedy",
      });
      mapRef.current = map;
      if (externalRef) externalRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
    });
  }, []);

  // Dark/light toggle
  useEffect(() => {
    mapRef.current?.setOptions({ styles: isDark ? DARK_STYLE : [] });
  }, [isDark]);

  // ── Markers ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const currentIds = new Set(employees.map(e => String(e.employeeId)));

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        (marker as any).setMap(null);
        markersRef.current.delete(id);
      }
    });

    employees.forEach(emp => {
      const id = String(emp.employeeId);
      if (!visibleEmployeeIds.has(id)) {
        const m = markersRef.current.get(id);
        if (m) (m as any).setMap(null);
        return;
      }

      const color = stringToColor(emp.employeeName);
      const initial = emp.employeeName?.charAt(0).toUpperCase() ?? "?";
      const isSelected = id === selectedEmployeeId;
      const size = isSelected ? 44 : 36;
      const ring = isSelected ? `box-shadow:0 0 0 3px white,0 0 0 5px ${color};` : "";

      // Build custom marker element
      const el = document.createElement("div");
      el.innerHTML = `
        <div style="
          width:${size}px;height:${size}px;border-radius:50%;
          background:${color};color:white;
          display:flex;align-items:center;justify-content:center;
          font-size:${isSelected ? 15 : 13}px;font-weight:700;
          cursor:pointer;${ring}
          transition:all 0.2s;
          box-shadow:0 2px 8px rgba(0,0,0,0.35);
        ">${initial}</div>
        <div style="
          position:absolute;inset:0;border-radius:50%;
          background:${color};opacity:0.3;
          animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite;
          pointer-events:none;
        "></div>
      `;
      el.style.position = "relative";
      el.style.width = `${size}px`;
      el.style.height = `${size}px`;

      const existing = markersRef.current.get(id) as any;
      if (existing) {
        existing.position = { lat: emp.latitude, lng: emp.longitude };
        existing.content = el;
        existing.setMap(map);
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          position: { lat: emp.latitude, lng: emp.longitude },
          map,
          content: el,
          title: emp.employeeName,
        });
        marker.addListener("click", () => {
          onSelectEmployee(id);
          infoWindowRef.current?.setContent(`
            <div style="font-family:'DM Sans',sans-serif;padding:4px 8px">
              <strong>${emp.employeeName}</strong><br/>
              <span style="color:#666;font-size:12px">${new Date(emp.recordedAt).toLocaleTimeString("en-IN")}</span>
            </div>
          `);
          infoWindowRef.current?.open({ map, anchor: marker });
        });
        markersRef.current.set(id, marker);
      }
    });
  }, [employees, visibleEmployeeIds, selectedEmployeeId, onSelectEmployee]);

  // ── Trail polylines ───────────────────────────────────────────────────────
  useEffect(() => {
    trailPolylinesRef.current.forEach(p => p.setMap(null));
    trailPolylinesRef.current = [];
    if (!mapRef.current || !showRawTrail || trails.length < 2) return;

    for (let i = 0; i < trails.length - 1; i++) {
      const p1 = trails[i];
      const p2 = trails[i + 1];
      const speed = (p2 as any).speedKmh ?? (p1 as any).speedKmh ?? null;
      const poly = new google.maps.Polyline({
        path: [{ lat: p1.latitude, lng: p1.longitude }, { lat: p2.latitude, lng: p2.longitude }],
        strokeColor: speedColor(speed),
        strokeWeight: 4,
        strokeOpacity: 0.85,
        map: mapRef.current,
      });
      trailPolylinesRef.current.push(poly);
    }
  }, [trails, showRawTrail]);

  // ── Matched route ─────────────────────────────────────────────────────────
  useEffect(() => {
    routePolylineRef.current?.setMap(null);
    routePolylineRef.current = null;
    if (!mapRef.current || !matchedRoute || matchedRoute.length < 2) return;

    routePolylineRef.current = new google.maps.Polyline({
      path: matchedRoute.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: "#10B981",
      strokeWeight: 5,
      strokeOpacity: 0.95,
      map: mapRef.current,
    });
  }, [matchedRoute]);

  // ── Zones ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    zoneOverlaysRef.current.forEach(o => o.setMap(null));
    zoneOverlaysRef.current = [];
    if (!mapRef.current) return;

    zones.forEach(zone => {
      const color = zone.color || "#3b82f6";
      if (zone.type === "circle" && zone.centerLatitude != null && zone.centerLongitude != null && zone.radiusMeters != null) {
        const circle = new google.maps.Circle({
          center: { lat: zone.centerLatitude, lng: zone.centerLongitude },
          radius: zone.radiusMeters,
          fillColor: color, fillOpacity: 0.2,
          strokeColor: color, strokeWeight: 2, strokeOpacity: 0.8,
          map: mapRef.current,
        });
        zoneOverlaysRef.current.push(circle as any);
      } else if (zone.type === "polygon" && zone.polygonGeoJson) {
        try {
          const geo = JSON.parse(zone.polygonGeoJson);
          const coords = geo.coordinates?.[0]?.map(([lng, lat]: number[]) => ({ lat, lng }));
          if (coords) {
            const poly = new google.maps.Polygon({
              paths: coords,
              fillColor: color, fillOpacity: 0.2,
              strokeColor: color, strokeWeight: 2, strokeOpacity: 0.8,
              map: mapRef.current,
            });
            zoneOverlaysRef.current.push(poly as any);
          }
        } catch { /* invalid GeoJSON */ }
      }
    });
  }, [zones]);

  if (!GOOGLE_KEY) return (
    <div className="flex items-center justify-center h-full bg-muted">
      <p className="text-muted-foreground text-sm">Google Maps key not configured (VITE_GOOGLE_MAPS_KEY)</p>
    </div>
  );

  return (
    <>
      <style>{`@keyframes ping{75%,100%{transform:scale(2);opacity:0}}`}</style>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </>
  );
}