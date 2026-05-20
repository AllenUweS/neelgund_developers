/**
 * Road-based routing utility using OSRM (Open Source Routing Machine)
 * Free, no API key required
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export type LatLng = {
  lat: number;
  lng: number;
};

export type RouteResult = {
  coordinates: LatLng[];
  distance: number; // in meters
  duration: number; // in seconds
};

const CACHE_KEY = "routing_cache";
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

type CacheEntry = {
  route: LatLng[];
  timestamp: number;
};

/**
 * Get road-based route between two points using OSRM
 */
export async function getRoute(
  start: LatLng,
  end: LatLng
): Promise<RouteResult | null> {
  try {
    const cacheKey = `${start.lat.toFixed(6)}_${start.lng.toFixed(6)}_${end.lat.toFixed(6)}_${end.lng.toFixed(6)}`;
    const cached = await getCachedRoute(cacheKey);
    if (cached) {
      return {
        coordinates: cached,
        distance: calculateDistance(cached),
        duration: estimateDuration(cached),
      };
    }

    // OSRM API - free public server
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NeelgundTracker/1.0',
      },
    });

    if (!response.ok) {
      throw new Error('Routing failed');
    }

    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    const coordinates: LatLng[] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({
      lat,
      lng,
    }));

    // Cache the result
    await cacheRoute(cacheKey, coordinates);

    return {
      coordinates,
      distance: route.distance,
      duration: route.duration,
    };
  } catch (error) {
    console.error('Routing error:', error);
    return null;
  }
}

/**
 * Get road-based route for multiple points (waypoints)
 * Segments the route into chunks to avoid API limits
 */
export async function getRouteForWaypoints(
  waypoints: LatLng[]
): Promise<RouteResult | null> {
  if (waypoints.length < 2) {
    return null;
  }

  if (waypoints.length === 2) {
    return getRoute(waypoints[0], waypoints[1]);
  }

  // For many points, segment into chunks of 10
  const chunkSize = 10;
  const allCoordinates: LatLng[] = [];
  let totalDistance = 0;
  let totalDuration = 0;

  for (let i = 0; i < waypoints.length - 1; i += chunkSize - 1) {
    const chunk = waypoints.slice(i, i + chunkSize);
    if (chunk.length < 2) break;

    // Get route for this chunk
    const route = await getRouteForChunk(chunk);
    if (route) {
      // Skip first coordinate of subsequent chunks to avoid duplicates at boundaries
      const coords = i === 0 ? route.coordinates : route.coordinates.slice(1);
      allCoordinates.push(...coords);
      totalDistance += route.distance;
      totalDuration += route.duration;
    } else {
      // Fallback to straight line for this segment
      const fallback = i === 0 ? chunk : chunk.slice(1);
      allCoordinates.push(...fallback);
      totalDistance += calculateDistance(chunk);
      totalDuration += estimateDuration(chunk);
    }
  }

  return {
    coordinates: allCoordinates,
    distance: totalDistance,
    duration: totalDuration,
  };
}

/**
 * Get route for a chunk of waypoints
 */
async function getRouteForChunk(waypoints: LatLng[]): Promise<RouteResult | null> {
  if (waypoints.length === 2) {
    return getRoute(waypoints[0], waypoints[1]);
  }

  // For more than 2 points, use OSRM's waypoint feature
  try {
    const coords = waypoints.map(wp => `${wp.lng},${wp.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'NeelgundTracker/1.0',
      },
    });

    if (!response.ok) {
      throw new Error('Routing failed');
    }

    const data = await response.json();
    
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    const coordinates: LatLng[] = route.geometry.coordinates.map(([lng, lat]: [number, number]) => ({
      lat,
      lng,
    }));

    return {
      coordinates,
      distance: route.distance,
      duration: route.duration,
    };
  } catch (error) {
    console.error('Chunk routing error:', error);
    return null;
  }
}

/**
 * Calculate total distance from coordinates (Haversine formula)
 */
function calculateDistance(coordinates: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversine(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

/**
 * Estimate duration based on distance (assumes 30 km/h average speed)
 */
function estimateDuration(coordinates: LatLng[]): number {
  const distance = calculateDistance(coordinates);
  return (distance / 1000) / 30 * 3600; // seconds
}

/**
 * Haversine formula for distance between two points
 */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const Δφ = ((b.lat - a.lat) * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;

  const α = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(α), Math.sqrt(1 - α));

  return R * c;
}

/**
 * Get cached route from AsyncStorage
 */
async function getCachedRoute(key: string): Promise<LatLng[] | null> {
  try {
    const cacheJson = await AsyncStorage.getItem(CACHE_KEY);
    if (!cacheJson) return null;

    const cache: Record<string, CacheEntry> = JSON.parse(cacheJson);
    const entry = cache[key];

    if (!entry) return null;

    // Check if cache is expired
    if (Date.now() - entry.timestamp > CACHE_DURATION) {
      delete cache[key];
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
      return null;
    }

    return entry.route;
  } catch {
    return null;
  }
}

/**
 * Cache route in AsyncStorage
 */
async function cacheRoute(key: string, route: LatLng[]): Promise<void> {
  try {
    const cacheJson = await AsyncStorage.getItem(CACHE_KEY);
    const cache: Record<string, CacheEntry> = cacheJson ? JSON.parse(cacheJson) : {};

    cache[key] = {
      route,
      timestamp: Date.now(),
    };

    // Limit cache size
    const keys = Object.keys(cache);
    if (keys.length > 50) {
      const sortedKeys = keys.sort((a, b) => cache[a].timestamp - cache[b].timestamp);
      for (let i = 0; i < 5; i++) {
        delete cache[sortedKeys[i]];
      }
    }

    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch (error) {
    console.error('Cache error:', error);
  }
}

/**
 * Simplify coordinates using Douglas-Peucker algorithm (optional optimization)
 */
export function simplifyCoordinates(
  coordinates: LatLng[],
  tolerance: number = 0.0001
): LatLng[] {
  if (coordinates.length <= 2) return coordinates;

  let maxDistance = 0;
  let maxIndex = 0;
  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];

  for (let i = 1; i < coordinates.length - 1; i++) {
    const distance = perpendicularDistance(coordinates[i], first, last);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance > tolerance) {
    const left = simplifyCoordinates(coordinates.slice(0, maxIndex + 1), tolerance);
    const right = simplifyCoordinates(coordinates.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  }

  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(point: LatLng, lineStart: LatLng, lineEnd: LatLng): number {
  const dx = lineEnd.lng - lineStart.lng;
  const dy = lineEnd.lat - lineStart.lat;
  const mag = Math.sqrt(dx * dx + dy * dy);
  
  if (mag === 0) return haversine(point, lineStart);

  const u = ((point.lng - lineStart.lng) * dx + (point.lat - lineStart.lat) * dy) / (mag * mag);
  const closestX = lineStart.lng + u * dx;
  const closestY = lineStart.lat + u * dy;
  
  const closest = { lat: closestY, lng: closestX };
  return haversine(point, closest);
}
