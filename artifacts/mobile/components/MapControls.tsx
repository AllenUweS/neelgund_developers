import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, ActivityIndicator, Text,
  Platform, PermissionsAndroid, Linking
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import Colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { openInGoogleMaps } from '@/lib/geocoding';

const C = Colors.light;

interface MapControlsProps {
  showTileSwitch?: boolean;
  showZoomControls?: boolean;
  showFollowPlayback?: boolean;
  showMyLocation?: boolean;
  onTileModeChange?: (mode: 'map' | 'satellite') => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFollowPlaybackToggle?: (follow: boolean) => void;
  onMyLocationPress?: () => void;
  onMyLocationToggle?: (enabled: boolean) => void;
  tileMode?: 'map' | 'satellite';
  zoom?: number;
  followPlayback?: boolean;
  myLocationEnabled?: boolean;
  locating?: boolean;
  onRecenter?: () => void;
  style?: any;
}

export function MapControls({
  showTileSwitch = true,
  showZoomControls = true,
  showFollowPlayback = true,
  showMyLocation = true,
  onTileModeChange,
  onZoomIn,
  onZoomOut,
  onFollowPlaybackToggle,
  onMyLocationPress,
  onMyLocationToggle,
  tileMode = 'map',
  zoom,
  followPlayback = false,
  myLocationEnabled = false,
  locating = false,
  onRecenter,
  style,
}: MapControlsProps) {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'manager';
  const [myLocation, setMyLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'unknown'>('unknown');
  const [isLocating, setIsLocating] = useState(false);

  // Haptic feedback helper
  const safeHaptic = useCallback((kind: 'impact' | 'selection' | 'success') => {
    if (Platform.OS === 'web') return;
    try {
      if (kind === 'impact') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (kind === 'selection') Haptics.selectionAsync();
      if (kind === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch { /* ignore */ }
  }, []);

  // Request location permissions
  const requestLocationPermission = useCallback(async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'Neelgund needs access to your location to show your live position on the map.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK'
          }
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          setPermissionStatus('granted');
          return true;
        } else {
          setPermissionStatus('denied');
          return false;
        }
      } else {
        const { status } = await Location.requestForegroundPermissionsAsync();
        setPermissionStatus(status === 'granted' ? 'granted' : 'denied');
        return status === 'granted';
      }
    } catch (err) {
      console.warn('Location permission error:', err);
      setPermissionStatus('denied');
      return false;
    }
  }, []);

  // Get current location
  const getCurrentLocation = useCallback(async () => {
    setLocationError(null);
    setIsLocating(true);
    try {
      let location;
      if (Platform.OS === 'web') {
        if (!navigator.geolocation) throw new Error('Geolocation not available');
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
        });
        location = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude
        };
      } else {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== 'granted') {
          const { status: requestedStatus } = await Location.requestForegroundPermissionsAsync();
          if (requestedStatus !== 'granted') throw new Error('Location permission denied');
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        location = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude
        };
      }
      setMyLocation(location);
      return location;
    } catch (err) {
      console.warn('Location error:', err);
      setLocationError(err instanceof Error ? err.message : 'Unknown error');
      return null;
    } finally {
      setIsLocating(false);
    }
  }, []);

  // Open location in external maps
  const handleOpenInMaps = useCallback(() => {
    if (myLocation) {
      openInGoogleMaps(myLocation.latitude, myLocation.longitude);
      safeHaptic('selection');
    }
  }, [myLocation, safeHaptic]);

  // Handle my location button press
  const handleMyLocationPress = useCallback(async () => {
    safeHaptic('impact');
    if (onMyLocationPress) {
      onMyLocationPress();
      return;
    }

    if (myLocationEnabled) {
      // Disable following
      onMyLocationToggle?.(false);
    } else {
      // Enable following - first get current location
      const location = await getCurrentLocation();
      if (location) {
        onMyLocationToggle?.(true);
        if (onRecenter) onRecenter();
      }
    }
  }, [myLocationEnabled, onMyLocationPress, onMyLocationToggle, onRecenter, getCurrentLocation, safeHaptic]);

  // Handle tap on my location indicator when following
  const handleMyLocationIndicatorPress = useCallback(() => {
    safeHaptic('selection');
    handleOpenInMaps();
  }, [handleOpenInMaps, safeHaptic]);

  return (
    <View style={[styles.container, style]}>
      {/* Tile Switch */}
      {showTileSwitch && (
        <View style={styles.tileSwitch}>
          {(['map', 'satellite'] as const).map(mode => (
            <TouchableOpacity
              key={mode}
              style={[
                styles.tileButton,
                tileMode === mode && styles.tileButtonActive
              ]}
              onPress={() => {
                safeHaptic('selection');
                onTileModeChange?.(mode);
              }}
            >
              <Text style={styles.tileText}>{mode === 'map' ? 'Map' : 'Satellite'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Zoom Controls */}
      {showZoomControls && (
        <View style={styles.mapControls}>
          <TouchableOpacity
            style={[
              styles.mapControlBtn,
              styles.zoomInBtn
            ]}
            onPress={() => {
              safeHaptic('impact');
              onZoomIn?.();
            }}
          >
            <Ionicons name="add-circle-outline" size={24} color={C.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.mapControlBtn,
              styles.zoomOutBtn
            ]}
            onPress={() => {
              safeHaptic('impact');
              onZoomOut?.();
            }}
          >
            <Ionicons name="remove-circle-outline" size={24} color={C.text} />
          </TouchableOpacity>
          {showFollowPlayback && (
            <TouchableOpacity
              style={[
                styles.mapControlBtn,
                followPlayback && styles.mapControlBtnActive
              ]}
              onPress={() => {
                safeHaptic('selection');
                onFollowPlaybackToggle?.(!followPlayback);
              }}
            >
              <Ionicons name={followPlayback ? 'navigate' : 'navigate-outline'} size={22} color={followPlayback ? C.brand : C.text} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* My Location Button */}
      {showMyLocation && (
        <View style={styles.myLocationContainer}>
          {locating || isLocating ? (
            <View style={styles.myLocationBtn}>
              <ActivityIndicator size="small" color={C.brand} />
            </View>
          ) : myLocationEnabled ? (
            <TouchableOpacity
              style={[
                styles.myLocationBtn,
                styles.myLocationBtnActive
              ]}
              onPress={handleMyLocationPress}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate" size={22} color={C.brand} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[
                styles.myLocationBtn,
                permissionStatus === 'denied' && styles.myLocationBtnDenied
              ]}
              onPress={async () => {
                safeHaptic('impact');
                const granted = await requestLocationPermission();
                if (granted) {
                  const location = await getCurrentLocation();
                  if (location) {
                    onMyLocationToggle?.(true);
                    if (onRecenter) onRecenter();
                  }
                }
              }}
              activeOpacity={0.8}
            >
              {permissionStatus === 'denied' ? (
                <Ionicons name="location-outline" size={22} color={C.textSecondary} />
              ) : (
                <Ionicons name="locate" size={22} color={C.brand} />
              )}
            </TouchableOpacity>
          )}
          {!locating && myLocation && !myLocationEnabled && (
            <TouchableOpacity
              style={styles.myLocationIndicator}
              onPress={handleMyLocationIndicatorPress}
              activeOpacity={0.8}
            >
              <View style={styles.myLocationDot} />
              <Text style={styles.myLocationLabel}>My Location</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    padding: 8,
  },
  tileSwitch: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    overflow: 'hidden',
    elevation: 3,
  },
  tileButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: 'rgba(245,245,245,0.96)',
  },
  tileButtonActive: {
    backgroundColor: '#fff',
  },
  tileText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  mapControls: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    gap: 8,
  },
  mapControlBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  mapControlBtnActive: {
    backgroundColor: C.brand + '15',
    borderWidth: 1,
    borderColor: C.brand + '40',
  },
  zoomInBtn: {
    marginRight: 4,
  },
  zoomOutBtn: {
    marginLeft: 4,
  },
  myLocationContainer: {
    position: 'absolute',
    right: 12,
    bottom: 12,
  },
  myLocationBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
  },
  myLocationBtnActive: {
    backgroundColor: C.brand + '10',
    borderColor: C.brand + '30',
  },
  myLocationBtnDenied: {
    backgroundColor: '#FEF3C7',
    borderColor: '#FBBF24',
  },
  myLocationIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 20,
  },
  myLocationDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.brand,
  },
  myLocationLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: C.text,
  },
});