// import { useEffect, useRef, useState, useCallback } from "react";
// import type { MapRef } from "react-map-gl/mapbox";
// import { RefreshCw, Moon, Sun, MapPinned, Eye, EyeOff, Play, Pause, SkipBack, SkipForward } from "lucide-react";
// import { toast } from "sonner";
// import { supabase } from "../lib/supabase";
// import { useGetEmployeesToday, useListZones } from "@workspace/api-client-react";
// import type { LocationPoint } from "@workspace/api-client-react";
// import LiveMap from "../components/tracking/LiveMap";
// import EmployeeSidebar from "../components/tracking/EmployeeSidebar";
// import ZoneManager from "../components/tracking/ZoneManager";
// import DateTrailPicker from "../components/tracking/DateTrailPicker";
// import ActivityFeed from "../components/tracking/ActivityFeed";
// import StopLog from "../components/tracking/StopLog";
// import DailyReport from "../components/tracking/DailyReport";

// const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;

// interface TrackerStatus {
//   employee_id: string;
//   tracker_state: string;
//   permission_state: string;
//   platform: string | null;
//   last_ping_at: string | null;
//   updated_at: string;
//   employees?: { name: string; department?: string };
// }

// export default function TrackingPage() {
//   const mapRef = useRef<MapRef | null>(null);
//   const [trackers, setTrackers] = useState<TrackerStatus[]>([]);
//   const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
//   const [visibleEmployeeIds, setVisibleEmployeeIds] = useState<Set<string>>(new Set());
//   const [trails, setTrails] = useState<LocationPoint[]>([]);
//   const [matchedRoute, setMatchedRoute] = useState<number[][] | undefined>(undefined);
//   const [showRawTrail, setShowRawTrail] = useState(true);
//   const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/streets-v12");
//   const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
//   const [loading, setLoading] = useState(true);
//   const [trailDate, setTrailDate] = useState<string | null>(null);

//   // Playback state
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [playbackIndex, setPlaybackIndex] = useState(0);
//   const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

//   const {
//     data: employeesToday,
//     refetch: refetchEmployees,
//     isLoading: employeesLoading,
//   } = useGetEmployeesToday({ query: { refetchInterval: 30000 } as any });

//   const { data: zones } = useListZones({ query: { refetchInterval: 30000 } as any });

//   async function fetchTracking() {
//     setLoading(true);
//     const { data } = await supabase
//       .from("tracking_status")
//       .select(
//         "id, employee_id, permission_state, tracker_state, platform, last_ping_at, updated_at, profiles!tracking_status_employee_id_fkey(name, department)"
//       )
//       .order("updated_at", { ascending: false });
//     setTrackers((data ?? []) as unknown as TrackerStatus[]);
//     setLoading(false);
//   }

//   useEffect(() => {
//     fetchTracking();
//     const iv = setInterval(fetchTracking, 30000);
//     return () => clearInterval(iv);
//   }, []);

//   // Initialize visibility set when employees load
//   useEffect(() => {
//     if (employeesToday) {
//       setVisibleEmployeeIds((prev) => {
//         const next = new Set(prev);
//         employeesToday.forEach((e) => next.add(String(e.employeeId)));
//         return next;
//       });
//     }
//   }, [employeesToday]);

//   // Playback loop
//   useEffect(() => {
//     if (!isPlaying || trails.length < 2) return;
//     playbackRef.current = setInterval(() => {
//       setPlaybackIndex((prev) => {
//         if (prev >= trails.length - 1) {
//           setIsPlaying(false);
//           return prev;
//         }
//         const next = prev + 1;
//         const point = trails[next];
//         if (point && mapRef.current) {
//           mapRef.current.flyTo({
//             center: [point.longitude, point.latitude],
//             zoom: 16,
//             duration: 300,
//           });
//         }
//         return next;
//       });
//     }, 800);
//     return () => {
//       if (playbackRef.current) clearInterval(playbackRef.current);
//     };
//   }, [isPlaying, trails]);

//   const handleSelectEmployee = useCallback(
//     (id: string) => {
//       setSelectedEmployeeId(id);
//       const emp = employeesToday?.find((e) => String(e.employeeId) === id);
//       if (emp && mapRef.current) {
//         mapRef.current.flyTo({
//           center: [emp.longitude, emp.latitude],
//           zoom: 15,
//           duration: 1500,
//         });
//       }
//     },
//     [employeesToday]
//   );

//   const handleToggleVisibility = useCallback((id: string) => {
//     setVisibleEmployeeIds((prev) => {
//       const next = new Set(prev);
//       if (next.has(id)) next.delete(id);
//       else next.add(id);
//       return next;
//     });
//   }, []);

//   const handleRefresh = useCallback(() => {
//     fetchTracking();
//     refetchEmployees();
//     toast.success("Refreshed");
//   }, [refetchEmployees]);

//   const handleTrailLoaded = useCallback((trail: LocationPoint[], route?: number[][]) => {
//     setTrails(trail);
//     setMatchedRoute(route);
//     setPlaybackIndex(0);
//     setIsPlaying(false);
//     const allPoints = route && route.length > 0 ? route : trail.map((p) => [p.longitude, p.latitude]);
//     if (allPoints.length > 0 && mapRef.current) {
//       const lons = allPoints.map((p) => p[0]);
//       const lats = allPoints.map((p) => p[1]);
//       const minLon = Math.min(...lons);
//       const maxLon = Math.max(...lons);
//       const minLat = Math.min(...lats);
//       const maxLat = Math.max(...lats);
//       mapRef.current.fitBounds(
//         [
//           [minLon, minLat],
//           [maxLon, maxLat],
//         ],
//         { padding: 60, duration: 1500 }
//       );
//     }
//   }, []);

//   const handleCenterMap = useCallback((lat: number, lng: number) => {
//     if (mapRef.current) {
//       mapRef.current.flyTo({ center: [lng, lat], zoom: 17, duration: 1200 });
//     }
//   }, []);

//   const isDark = mapStyle.includes("dark");

//   const activePoint = trails[playbackIndex];

//   return (
//     <div className="flex h-full">
//       <EmployeeSidebar
//         employees={(employeesToday ?? []) as unknown as any[]}
//         trackerStatus={trackers}
//         visibleEmployeeIds={visibleEmployeeIds}
//         selectedEmployeeId={selectedEmployeeId}
//         onToggleVisibility={handleToggleVisibility}
//         onSelectEmployee={handleSelectEmployee}
//       />

//       <div className="flex-1 flex flex-col min-w-0">
//         {/* Top bar */}
//         <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border">
//           <div className="flex items-center gap-3">
//             <DateTrailPicker
//               employees={(employeesToday ?? []) as unknown as any[]}
//               onTrailLoaded={handleTrailLoaded}
//               onDateChange={setTrailDate}
//             />
//           </div>

//           <div className="flex items-center gap-2">
//             {/* Playback controls */}
//             {trails.length > 0 && (
//               <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-lg">
//                 <button
//                   onClick={() => {
//                     setPlaybackIndex(0);
//                     setIsPlaying(false);
//                   }}
//                   className="p-1 hover:bg-accent rounded"
//                   title="Reset"
//                 >
//                   <SkipBack className="w-4 h-4" />
//                 </button>
//                 <button
//                   onClick={() => setIsPlaying((p) => !p)}
//                   className="p-1 hover:bg-accent rounded"
//                   title={isPlaying ? "Pause" : "Play"}
//                 >
//                   {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
//                 </button>
//                 <button
//                   onClick={() => {
//                     setPlaybackIndex((i) => Math.min(trails.length - 1, i + 10));
//                     setIsPlaying(false);
//                   }}
//                   className="p-1 hover:bg-accent rounded"
//                   title="Skip forward"
//                 >
//                   <SkipForward className="w-4 h-4" />
//                 </button>
//                 {activePoint && (
//                   <span className="text-xs text-muted-foreground ml-1">
//                     {Math.round((playbackIndex / Math.max(1, trails.length - 1)) * 100)}%
//                     {" · "}
//                     {(activePoint as any).speedKmh != null
//                       ? `${Math.round((activePoint as any).speedKmh)} km/h`
//                       : "—"}
//                   </span>
//                 )}
//               </div>
//             )}

//             <button
//               onClick={() =>
//                 setMapStyle((s) =>
//                   s.includes("dark")
//                     ? "mapbox://styles/mapbox/streets-v12"
//                     : "mapbox://styles/mapbox/dark-v11"
//                 )
//               }
//               className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
//             >
//               {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
//               {isDark ? "Light" : "Dark"}
//             </button>

//             {trails.length > 0 && (
//               <button
//                 onClick={() => setShowRawTrail((v) => !v)}
//                 className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
//                 title={showRawTrail ? "Hide raw GPS trail" : "Show raw GPS trail"}
//               >
//                 {showRawTrail ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
//                 Raw GPS
//               </button>
//             )}

//             <button
//               onClick={() => setZoneManagerOpen(true)}
//               className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
//             >
//               <MapPinned className="w-4 h-4" />
//               Zones
//             </button>

//             <button
//               onClick={handleRefresh}
//               className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
//             >
//               <RefreshCw className="w-4 h-4" />
//               Refresh
//             </button>
//           </div>
//         </div>

//         {/* Map */}
//         <div className="flex-1 relative">
//           {(loading || employeesLoading) && (
//             <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
//               <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
//             </div>
//           )}
//           <LiveMap
//             mapRef={mapRef}
//             mapStyle={mapStyle}
//             employees={(employeesToday ?? []) as unknown as any[]}
//             trails={trails}
//             matchedRoute={matchedRoute}
//             zones={(zones ?? []) as unknown as any[]}
//             selectedEmployeeId={selectedEmployeeId}
//             visibleEmployeeIds={visibleEmployeeIds}
//             onSelectEmployee={handleSelectEmployee}
//             showRawTrail={showRawTrail}
//           />
//         </div>

//         {/* Stop log panel */}
//         {selectedEmployeeId && trailDate && (
//           <div className="border-t border-border">
//             <StopLog
//               employeeId={selectedEmployeeId}
//               date={trailDate}
//               onCenterMap={handleCenterMap}
//             />
//           </div>
//         )}

//         {/* Daily report panel */}
//         {selectedEmployeeId && trailDate && (
//           <div className="border-t border-border p-4">
//             <DailyReport
//               employeeId={selectedEmployeeId}
//               employeeName={employeesToday?.find((e) => String(e.employeeId) === selectedEmployeeId)?.employeeName ?? "Employee"}
//               date={trailDate}
//             />
//           </div>
//         )}
//       </div>

//       <ActivityFeed employeeId={selectedEmployeeId} />

//       <ZoneManager open={zoneManagerOpen} onClose={() => setZoneManagerOpen(false)} />
//     </div>
//   );
// }


import { useEffect, useRef, useState, useCallback } from "react";
import { RefreshCw, Moon, Sun, MapPinned, Eye, EyeOff, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../lib/supabase";
import { useGetEmployeesToday, useListZones } from "@workspace/api-client-react";
import type { LocationPoint } from "@workspace/api-client-react";
import LiveMap from "../components/tracking/LiveMap";
import EmployeeSidebar from "../components/tracking/EmployeeSidebar";
import ZoneManager from "../components/tracking/ZoneManager";
import DateTrailPicker from "../components/tracking/DateTrailPicker";
import ActivityFeed from "../components/tracking/ActivityFeed";
import StopLog from "../components/tracking/StopLog";
import DailyReport from "../components/tracking/DailyReport";

interface TrackerStatus {
  employee_id: string;
  tracker_state: string;
  permission_state: string;
  platform: string | null;
  last_ping_at: string | null;
  updated_at: string;
  employees?: { name: string; department?: string };
}

export default function TrackingPage() {
  // Google Maps ref instead of Mapbox MapRef
  const mapRef = useRef<google.maps.Map | null>(null);

  const [trackers, setTrackers] = useState<TrackerStatus[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [visibleEmployeeIds, setVisibleEmployeeIds] = useState<Set<string>>(new Set());
  const [trails, setTrails] = useState<LocationPoint[]>([]);
  const [matchedRoute, setMatchedRoute] = useState<number[][] | undefined>(undefined);
  const [showRawTrail, setShowRawTrail] = useState(true);
  const [isDark, setIsDark] = useState(false);
  const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trailDate, setTrailDate] = useState<string | null>(null);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: employeesToday, refetch: refetchEmployees, isLoading: employeesLoading } = useGetEmployeesToday({ query: { refetchInterval: 30000 } as any });
  const { data: zones } = useListZones({ query: { refetchInterval: 30000 } as any });

  async function fetchTracking() {
    setLoading(true);
    const { data } = await supabase
      .from("tracking_status")
      .select("id, employee_id, permission_state, tracker_state, platform, last_ping_at, updated_at, profiles!tracking_status_employee_id_fkey(name, department)")
      .order("updated_at", { ascending: false });
    setTrackers((data ?? []) as unknown as TrackerStatus[]);
    setLoading(false);
  }

  useEffect(() => {
    fetchTracking();
    const iv = setInterval(fetchTracking, 30000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (employeesToday) {
      setVisibleEmployeeIds(prev => {
        const next = new Set(prev);
        employeesToday.forEach(e => next.add(String(e.employeeId)));
        return next;
      });
    }
  }, [employeesToday]);

  // Playback loop — pan Google Maps instead of flyTo
  useEffect(() => {
    if (!isPlaying || trails.length < 2) return;
    playbackRef.current = setInterval(() => {
      setPlaybackIndex(prev => {
        if (prev >= trails.length - 1) { setIsPlaying(false); return prev; }
        const next = prev + 1;
        const point = trails[next];
        if (point && mapRef.current) {
          mapRef.current.panTo({ lat: point.latitude, lng: point.longitude });
          mapRef.current.setZoom(16);
        }
        return next;
      });
    }, 800);
    return () => { if (playbackRef.current) clearInterval(playbackRef.current); };
  }, [isPlaying, trails]);

  const handleSelectEmployee = useCallback((id: string) => {
    setSelectedEmployeeId(id);
    const emp = employeesToday?.find(e => String(e.employeeId) === id);
    if (emp && mapRef.current) {
      mapRef.current.panTo({ lat: emp.latitude, lng: emp.longitude });
      mapRef.current.setZoom(15);
    }
  }, [employeesToday]);

  const handleToggleVisibility = useCallback((id: string) => {
    setVisibleEmployeeIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleRefresh = useCallback(() => {
    fetchTracking();
    refetchEmployees();
    toast.success("Refreshed");
  }, [refetchEmployees]);

  const handleTrailLoaded = useCallback((trail: LocationPoint[], route?: number[][]) => {
    setTrails(trail);
    setMatchedRoute(route);
    setPlaybackIndex(0);
    setIsPlaying(false);

    // Fit bounds using Google Maps
    const allPoints = route && route.length > 0
      ? route.map(([lng, lat]) => ({ lat, lng }))
      : trail.map(p => ({ lat: p.latitude, lng: p.longitude }));

    if (allPoints.length > 0 && mapRef.current) {
      const bounds = new google.maps.LatLngBounds();
      allPoints.forEach(p => bounds.extend(p));
      mapRef.current.fitBounds(bounds, 60);
    }
  }, []);

  const handleCenterMap = useCallback((lat: number, lng: number) => {
    if (mapRef.current) {
      mapRef.current.panTo({ lat, lng });
      mapRef.current.setZoom(17);
    }
  }, []);

  const activePoint = trails[playbackIndex];

  return (
    <div className="flex h-full">
      <EmployeeSidebar
        employees={(employeesToday ?? []) as unknown as any[]}
        trackerStatus={trackers}
        visibleEmployeeIds={visibleEmployeeIds}
        selectedEmployeeId={selectedEmployeeId}
        onToggleVisibility={handleToggleVisibility}
        onSelectEmployee={handleSelectEmployee}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-card border-b border-border gap-3 flex-wrap">
          <DateTrailPicker
            employees={(employeesToday ?? []) as unknown as any[]}
            onTrailLoaded={handleTrailLoaded}
            onDateChange={setTrailDate}
          />

          <div className="flex items-center gap-2 flex-wrap">
            {/* Playback controls */}
            {trails.length > 0 && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-secondary rounded-lg">
                <button onClick={() => { setPlaybackIndex(0); setIsPlaying(false); }} className="p-1 hover:bg-accent rounded" title="Reset">
                  <SkipBack className="w-4 h-4" />
                </button>
                <button onClick={() => setIsPlaying(p => !p)} className="p-1 hover:bg-accent rounded" title={isPlaying ? "Pause" : "Play"}>
                  {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                </button>
                <button onClick={() => { setPlaybackIndex(i => Math.min(trails.length - 1, i + 10)); setIsPlaying(false); }} className="p-1 hover:bg-accent rounded" title="Skip forward">
                  <SkipForward className="w-4 h-4" />
                </button>
                {activePoint && (
                  <span className="text-xs text-muted-foreground ml-1">
                    {Math.round((playbackIndex / Math.max(1, trails.length - 1)) * 100)}%
                    {" · "}
                    {(activePoint as any).speedKmh != null ? `${Math.round((activePoint as any).speedKmh)} km/h` : "—"}
                  </span>
                )}
              </div>
            )}

            <button
              onClick={() => setIsDark(d => !d)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              {isDark ? "Light" : "Dark"}
            </button>

            {trails.length > 0 && (
              <button
                onClick={() => setShowRawTrail(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
              >
                {showRawTrail ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                Raw GPS
              </button>
            )}

            <button
              onClick={() => setZoneManagerOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              <MapPinned className="w-4 h-4" />
              Zones
            </button>

            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg text-sm font-medium hover:bg-accent transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Map */}
        <div className="flex-1 relative">
          {(loading || employeesLoading) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
              <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
          )}
          <LiveMap
            mapRef={mapRef}
            isDark={isDark}
            employees={(employeesToday ?? []) as unknown as any[]}
            trails={trails}
            matchedRoute={matchedRoute}
            zones={(zones ?? []) as unknown as any[]}
            selectedEmployeeId={selectedEmployeeId}
            visibleEmployeeIds={visibleEmployeeIds}
            onSelectEmployee={handleSelectEmployee}
            showRawTrail={showRawTrail}
          />
        </div>

        {selectedEmployeeId && trailDate && (
          <div className="border-t border-border">
            <StopLog employeeId={selectedEmployeeId} date={trailDate} onCenterMap={handleCenterMap} />
          </div>
        )}

        {selectedEmployeeId && trailDate && (
          <div className="border-t border-border p-4">
            <DailyReport
              employeeId={selectedEmployeeId}
              employeeName={employeesToday?.find(e => String(e.employeeId) === selectedEmployeeId)?.employeeName ?? "Employee"}
              date={trailDate}
            />
          </div>
        )}
      </div>

      <ActivityFeed employeeId={selectedEmployeeId} />
      <ZoneManager open={zoneManagerOpen} onClose={() => setZoneManagerOpen(false)} />
    </div>
  );
}