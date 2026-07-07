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
  photoUrl?: string;
};

export type PlaybackMarkerData = {
  lat: number;
  lng: number;
  label: string;   // employee name or initials
  bearing?: number; // direction of travel in degrees
  photoUrl?: string | null; // profile photo URL — shown instead of car icon
};

export type LiveTrail = {
  id: string;
  color?: string;
  path: LatLng[];
};

export type OsmWebMapProps = {
  center?: LatLng | null;
  zoom?: number;
  markers?: OsmMarker[];
  playbackMarker?: PlaybackMarkerData | null;  // dedicated smooth replay marker
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
  liveTrails?: LiveTrail[];  // per-employee live trail polylines for fleet map
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
  .pin-photo{width:38px;height:38px;border-radius:19px;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer;overflow:hidden;}
  /* Replay marker */
  .replay-marker-wrap{position:absolute;transform:translate(-50%,-50%);pointer-events:none;display:flex;flex-direction:column;align-items:center;gap:3px;}
  .replay-marker-icon{width:44px;height:44px;border-radius:50%;background:#1E4E8A;border:3px solid #fff;box-shadow:0 3px 12px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;position:relative;}
  .replay-marker-icon::after{content:'';position:absolute;inset:0;border-radius:50%;background:#1E4E8A;opacity:0.35;animation:rmpulse 1.6s ease-out infinite;}
  .replay-marker-icon.has-photo::after{background:transparent;}
  .replay-marker-arrow{font-size:22px;color:#fff;line-height:1;display:block;transform-origin:center;}
  .replay-marker-photo{width:44px;height:44px;border-radius:50%;object-fit:cover;display:block;}
  .replay-marker-label{background:rgba(15,35,70,0.88);color:#fff;font:600 11px system-ui,sans-serif;padding:2px 7px;border-radius:10px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.3);}
  @keyframes rmpulse{0%{transform:scale(1);opacity:0.35;}70%{transform:scale(2.2);opacity:0;}100%{transform:scale(2.2);opacity:0;}}
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
      liveTrails={},
      polyline=null,
      routePoly=null,
      traveledPoly=null,
      remainingPoly=null,
      replayOverlay=null,
      replayEl=null;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function loadPhotoIcon(url, cb) {
    var img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = 44; canvas.height = 44;
      var ctx = canvas.getContext('2d');
      ctx.beginPath(); ctx.arc(22, 22, 21, 0, Math.PI*2);
      ctx.fillStyle = 'white'; ctx.fill();
      ctx.save(); ctx.clip();
      
      var w = img.width, h = img.height;
      var s = Math.min(w, h);
      var sx = (w - s) / 2, sy = (h - s) / 2;
      ctx.drawImage(img, sx, sy, s, s, 4, 4, 36, 36);
      
      ctx.restore();
      ctx.beginPath(); ctx.arc(22, 22, 21, 0, Math.PI*2);
      ctx.lineWidth = 3; ctx.strokeStyle = 'white'; ctx.stroke();
      cb(canvas.toDataURL());
    };
    img.onerror = function() { cb(null); };
    img.src = url;
  }

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
    if(m.photoUrl){
      div.className='pin-photo';
      div.style.backgroundImage='url('+m.photoUrl+')';
      div.style.backgroundSize='cover';
      div.style.backgroundPosition='center';
    }else if(m.variant==='number'){
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

  // ── makeNativeIcon: creates a Google Maps icon descriptor from marker data ──
  // Uses a data-URI SVG so we get crisp custom shapes without extra HTTP requests.
  function makeNativeIcon(m){
    var size,anchor,url;
    if(m.variant==='number'){
      var color=COLORS[m.color]||'#F4A820';
      var label=m.label!=null?String(m.label):'';
      var svg='<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34">'+
        '<circle cx="17" cy="17" r="16" fill="'+color+'" stroke="rgba(255,255,255,0.9)" stroke-width="2"/>'+
        '<text x="17" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="14" fill="white">'+label+'</text>'+
        '</svg>';
      url='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
      size=new google.maps.Size(34,34);
      anchor=new google.maps.Point(17,17);
    }else if(m.variant==='vehicle'){
      var color=COLORS[m.color]||'#0B3A57';
      var label=m.label||'▶';
      var svg='<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30">'+
        '<circle cx="15" cy="15" r="14" fill="'+color+'" stroke="white" stroke-width="2"/>'+
        '<text x="15" y="20" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="12" fill="white">'+label+'</text>'+
        '</svg>';
      url='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
      size=new google.maps.Size(30,30);
      anchor=new google.maps.Point(15,15);
    }else{
      var color=COLORS[m.color]||'#1E4E8A';
      var label=m.label!=null?String(m.label):'';
      var svg='<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26">'+
        '<circle cx="13" cy="13" r="12" fill="'+color+'" stroke="white" stroke-width="3"/>'+
        '<text x="13" y="18" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="700" font-size="11" fill="white">'+label+'</text>'+
        '</svg>';
      url='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
      size=new google.maps.Size(26,26);
      anchor=new google.maps.Point(13,13);
    }
    return{url:url,scaledSize:size,anchor:anchor};
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
      setView:function(lat,lng,zoom,applyZoom){
        if(!isFinite(lat)||!isFinite(lng))return;
        map.panTo({lat:lat,lng:lng});
        // Only apply zoom when explicitly requested (e.g. user tapped +/- or jumped to location).
        // During playback follow-pans, applyZoom is false so pinch-zoom is never overridden.
        if(applyZoom&&isFinite(zoom))map.setZoom(zoom);
      },
      updatePlaybackMarker:function(data){
        // data = {lat, lng, label, bearing, photoUrl} or null to hide
        if(!data){
          if(replayOverlay){replayOverlay.setMap(null);replayOverlay=null;replayEl=null;}
          return;
        }
        if(!replayEl){
          replayEl=document.createElement('div');
          replayEl.className='replay-marker-wrap';
          replayEl.innerHTML=
            '<div class="replay-marker-icon">'+
              '<span class="replay-marker-arrow">&#x1F464;</span>'+
            '</div>'+
            '<div class="replay-marker-label"></div>';
        }
        // Show profile photo or person icon
        var iconDiv=replayEl.querySelector('.replay-marker-icon');
        var labelEl=replayEl.querySelector('.replay-marker-label');
        if(data.photoUrl){
          if(iconDiv){
            iconDiv.className='replay-marker-icon has-photo';
            iconDiv.style.background='transparent';
            var existingImg=iconDiv.querySelector('img.replay-marker-photo');
            if(!existingImg||existingImg.src!==data.photoUrl){
              iconDiv.innerHTML='';
              var img=document.createElement('img');
              img.className='replay-marker-photo';
              img.src=data.photoUrl;
              img.onerror=function(){
                iconDiv.innerHTML='<span class="replay-marker-arrow">&#x1F464;</span>';
                iconDiv.className='replay-marker-icon';
                iconDiv.style.background='#1E4E8A';
              };
              iconDiv.appendChild(img);
            }
          }
        }else{
          if(iconDiv&&!iconDiv.querySelector('.replay-marker-arrow')){
            iconDiv.className='replay-marker-icon';
            iconDiv.style.background='#1E4E8A';
            iconDiv.innerHTML='<span class="replay-marker-arrow">&#x1F464;</span>';
          }
          // Do not rotate the person icon as it would look strange upside down
        }
        if(labelEl)labelEl.textContent=data.label||'';
        if(!replayOverlay){
          replayOverlay=new google.maps.OverlayView();
          replayOverlay.onAdd=function(){
            this.getPanes().overlayMouseTarget.appendChild(replayEl);
          };
          replayOverlay.draw=function(){
            var proj=this.getProjection();
            if(!proj||!replayOverlay._pos)return;
            var px=proj.fromLatLngToDivPixel(replayOverlay._pos);
            if(!px)return;
            replayEl.style.position='absolute';
            replayEl.style.left=px.x+'px';
            replayEl.style.top=px.y+'px';
          };
          replayOverlay.onRemove=function(){
            if(replayEl&&replayEl.parentNode)replayEl.parentNode.removeChild(replayEl);
          };
          replayOverlay.setMap(map);
        }
        replayOverlay._pos=new google.maps.LatLng(data.lat,data.lng);
        replayOverlay.draw();
      },
      setTileMode:function(mode){
        map.setMapTypeId(mode==='satellite'?'hybrid':'roadmap');
      },
      smoothUpdateMarkers:function(list){
        // Use native google.maps.Marker so markers are properly geo-anchored.
        // OverlayView CSS-positioned divs drift on pan/zoom — native Markers never do.
        var newIds=(list||[])
          .filter(function(m){return isFinite(m.lat)&&isFinite(m.lng);})
          .map(function(m){return String(m.id);});
        // Remove markers no longer in list
        markers=markers.filter(function(mk){
          if(newIds.indexOf(String(mk._markerId))===-1){mk.setMap(null);return false;}
          return true;
        });
        // Update or add
        (list||[]).forEach(function(m){
          if(!isFinite(m.lat)||!isFinite(m.lng))return;
          var existing=null;
          for(var i=0;i<markers.length;i++){
            if(String(markers[i]._markerId)===String(m.id)){existing=markers[i];break;}
          }
          if(existing){
            existing.setPosition({lat:m.lat,lng:m.lng});
            if(m.photoUrl&&existing._photoUrl!==m.photoUrl){
              existing._photoUrl=m.photoUrl;
              existing.setIcon(makeNativeIcon(m)); // fallback first
              loadPhotoIcon(m.photoUrl, function(url) {
                if (url && existing._photoUrl === m.photoUrl) {
                  existing.setIcon({ url: url, scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 22) });
                }
              });
            }
            return;
          }
          var mk=new google.maps.Marker({
            position:{lat:m.lat,lng:m.lng},
            map:map,
            title:m.title||'',
            icon:makeNativeIcon(m),
            optimized:false,
          });
          mk._markerId=m.id;
          mk._photoUrl=m.photoUrl||null;
          if (m.photoUrl) {
            loadPhotoIcon(m.photoUrl, function(url) {
              if (url && mk._photoUrl === m.photoUrl) {
                mk.setIcon({ url: url, scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 22) });
              }
            });
          }
          (function(id){
            mk.addListener('click',function(){post({type:'marker',id:String(id)});});
          })(m.id);
          markers.push(mk);
        });
      },
      updateLiveTrails:function(trails){
        // trails = [{id, color, path:[{lat,lng},...]}]
        // Grow per-employee trail polylines in real time.
        var keepIds=(trails||[]).map(function(t){return String(t.id);});
        Object.keys(liveTrails).forEach(function(id){
          if(keepIds.indexOf(id)===-1){liveTrails[id].setMap(null);delete liveTrails[id];}
        });
        (trails||[]).forEach(function(t){
          if(!t.path||t.path.length<2)return;
          var pts=t.path.filter(function(p){return isFinite(p.lat)&&isFinite(p.lng);});
          if(pts.length<2)return;
          if(liveTrails[String(t.id)]){
            liveTrails[String(t.id)].setPath(pts);
          }else{
            liveTrails[String(t.id)]=new google.maps.Polyline({
              path:pts,map:map,
              strokeColor:'#1E4E8A',
              strokeWeight:4,strokeOpacity:0.75,geodesic:true,
            });
          }
        });
      },
      setMarkers:function(list){
        markers.forEach(function(m){m.setMap(null);});
        markers=[];
        (list||[]).forEach(function(m){
          if(!isFinite(m.lat)||!isFinite(m.lng))return;
          var el=pinEl(m);
          var ov=new google.maps.OverlayView();
          ov._markerId=m.id;
          ov._markerLat=m.lat;
          ov._markerLng=m.lng;
          ov._elem=el;
          (function(elem,data){
            ov.onAdd=function(){
              var pane=this.getPanes().overlayMouseTarget;
              pane.appendChild(elem);
            };
            ov.draw=function(){
              var proj=this.getProjection();
              if(!proj)return;
              var pos=proj.fromLatLngToDivPixel(new google.maps.LatLng(this._markerLat||data.lat,this._markerLng||data.lng));
              if(!pos)return;
              var w=parseInt(elem.className==='pin-number'?'34':(elem.className==='pin-vehicle'?'30':(elem.className==='pin-photo'?'38':'26')),10);
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
        // Only clear traveled/remaining when resetting to raw GPS path (no route snapping)
        traveledPoly=clearPolyline(traveledPoly);
        remainingPoly=clearPolyline(remainingPoly);
        polyline=makePoly(coords,{strokeColor:'#2563EB',strokeWeight:5,strokeOpacity:0.85});
      },
      setRoutePolyline:function(coords){
        // Replace raw GPS polyline with snapped route; keep traveled/remaining overlays intact
        polyline=clearPolyline(polyline);
        routePoly=clearPolyline(routePoly);
        if(!coords||coords.length<2)return;
        routePoly=makePoly(coords,{strokeColor:'#0B3A57',strokeWeight:6,strokeOpacity:1});
      },
      setTraveledPolyline:function(coords){
        // Overlaid on top of route — do NOT clear polyline or routePoly
        traveledPoly=clearPolyline(traveledPoly);
        if(!coords||coords.length<2)return;
        traveledPoly=makePoly(coords,{strokeColor:'#10B981',strokeWeight:7,strokeOpacity:1,zIndex:5});
      },
      setRemainingPolyline:function(coords){
        // Overlaid on top of route — do NOT clear polyline or routePoly
        remainingPoly=clearPolyline(remainingPoly);
        if(!coords||coords.length<2)return;
        remainingPoly=makePoly(coords,{strokeColor:'#9CA3AF',strokeWeight:4,strokeOpacity:0.6,zIndex:4});
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
  playbackMarker,
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
  liveTrails,
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
  const lastZoomViewKeyRef = useRef<string | null>(null);
  const lastPlaybackMarkerKeyRef = useRef<string | null>(null);
  const lastLiveTrailsKeyRef = useRef<string | null>(null);
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
          `${m.id}:${m.lat.toFixed(6)}:${m.lng.toFixed(6)}:${m.label ?? ""}:${m.variant ?? ""}:${m.color ?? ""}:${m.photoUrl ?? ""}`
      )
      .join("|");

    const safeLiveTrails = (liveTrails || []).map((t) => ({
      id: t.id,
      color: t.color,
      path: t.path.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    })).filter((t) => t.path.length >= 2);
    const liveTrailsKey = safeLiveTrails
      .map((t) => `${t.id}:${t.path.length}:${t.path[t.path.length - 1]?.lat?.toFixed(5)}`)
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
      liveTrails: safeLiveTrails,
      liveTrailsKey,
    };
  }, [
    center, zoom, markers, polyline, routePolyline,
    traveledPolyline, remainingPolyline, fitToPolyline, fitRequestKey, viewRequestKey, tileMode, liveTrails,
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
    // positionKey: changes when center moves (playback panning) — does NOT include zoom
    // so that user pinch-zoom is never clobbered by a pan-only update.
    const positionKey = payload.center
      ? `${payload.center.lat.toFixed(6)}:${payload.center.lng.toFixed(6)}:${payload.viewRequestKey}`
      : null;
    // zoomViewKey: changes only when the caller explicitly requests a zoom change
    // (viewRequestKey bumped by +/- buttons, jump-to-location, etc.)
    const zoomViewKey = `${payload.zoom ?? DEFAULT_ZOOM}:${payload.viewRequestKey}`;
    const shouldView =
      !shouldFit && !!payload.center && lastViewKeyRef.current !== positionKey;
    const shouldApplyZoom = lastZoomViewKeyRef.current !== zoomViewKey;

    const fitCoords =
      payload.routePolyline.length >= 2
        ? payload.routePolyline
        : payload.polyline;

    const shouldLiveTrails = lastLiveTrailsKeyRef.current !== payload.liveTrailsKey;

    const js = `
try {
  if (window.__gm) {
    ${shouldTile ? `window.__gm.setTileMode(${JSON.stringify(payload.tileMode)});` : ""}
    ${shouldMarkers ? `window.__gm.smoothUpdateMarkers(${JSON.stringify(payload.markers)});` : ""}
    ${shouldLiveTrails ? `window.__gm.updateLiveTrails(${JSON.stringify(payload.liveTrails)});` : ""}
    ${shouldRoute ? `window.__gm.setRoutePolyline(${JSON.stringify(payload.routePolyline)});` : ""}
    ${
      // Show raw GPS polyline only when no road-snapped route AND not in replay mode
      shouldPoly &&
        payload.routePolyline.length < 2 &&
        payload.traveledPolyline.length < 2
        ? `window.__gm.setPolyline(${JSON.stringify(payload.polyline)});`
        : // When replay ends (traveledPolyline goes empty), clear traveled/remaining and re-show route
        shouldTraveled && payload.traveledPolyline.length < 2
          ? `window.__gm.setTraveledPolyline([]);window.__gm.setRemainingPolyline([]);`
          : ""
      }
    ${shouldTraveled && payload.traveledPolyline.length >= 2 ? `window.__gm.setTraveledPolyline(${JSON.stringify(payload.traveledPolyline)});` : ""}
    ${shouldRemaining ? `window.__gm.setRemainingPolyline(${JSON.stringify(payload.remainingPolyline)});` : ""}
    ${shouldFit
        ? `window.__gm.fitTo(${JSON.stringify(fitCoords)});`
        : shouldView && payload.center
          ? `window.__gm.setView(${payload.center.lat},${payload.center.lng},${payload.zoom ?? DEFAULT_ZOOM},${shouldApplyZoom});`
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
      if (shouldView && positionKey) lastViewKeyRef.current = positionKey;
      if (shouldApplyZoom) lastZoomViewKeyRef.current = zoomViewKey;
      if (shouldLiveTrails) lastLiveTrailsKeyRef.current = payload.liveTrailsKey;
    } catch {
      // ignore; next render will retry
    }
  }, [payload]);

  useEffect(() => {
    applyState();
  }, [applyState]);

  // ── Dedicated playback marker injection (runs independently of applyState) ──
  // This runs on every render so the marker position stays in sync with interpPos
  // without going through the full applyState payload/key machinery.
  useEffect(() => {
    if (!readyRef.current || !webRef.current) return;
    const pm = playbackMarker;
    const key = pm
      ? `${pm.lat.toFixed(6)}:${pm.lng.toFixed(6)}:${(pm.bearing ?? 0).toFixed(1)}:${pm.label}`
      : "null";
    if (lastPlaybackMarkerKeyRef.current === key) return;
    lastPlaybackMarkerKeyRef.current = key;
    const js = pm
      ? `try{if(window.__gm)window.__gm.updatePlaybackMarker(${JSON.stringify(pm)});}catch(e){}true;`
      : `try{if(window.__gm)window.__gm.updatePlaybackMarker(null);}catch(e){}true;`;
    try { webRef.current.injectJavaScript(js); } catch { /* retry next render */ }
  });

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
          lastLiveTrailsKeyRef.current = null;
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