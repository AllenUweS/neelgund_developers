import React, { useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Animated, Easing } from 'react-native';
import Colors from '@/constants/colors';

const C = Colors.light;

interface LoadingOverlayProps {
  visible: boolean;
  loadingText?: string;
  errorText?: string;
  onRetry?: () => void;
  showRetry?: boolean;
  style?: any;
}

export function LoadingOverlay({
  visible,
  loadingText = 'Loading map…',
  errorText = 'Map couldn&apos;t load',
  onRetry,
  showRetry = false,
  style,
}: LoadingOverlayProps) {
  const fadeAnim = React.useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, fadeAnim]);

  if (!visible) return null;

  return (
    <Animated.View style={[
      styles.overlay,
      { opacity: fadeAnim },
      style,
    ]}>
      {errorText && showRetry ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>{errorText}</Text>
          <Text style={styles.overlayText}>
            Check your internet connection.
          </Text>
          {onRetry && (
            <View style={styles.retryButton}>
              <Text style={styles.retryText} onPress={onRetry}>
                Retry
              </Text>
            </View>
          )}
        </View>
      ) : (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={C.brand} />
          <Text style={styles.overlayText}>{loadingText}</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(232,238,245,0.85)',
  },
  loadingContainer: {
    gap: 8,
    alignItems: 'center',
  },
  errorContainer: {
    gap: 12,
    alignItems: 'center',
    padding: 20,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 12,
  },
  errorTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  overlayText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSecondary,
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: C.brand,
    borderRadius: 20,
  },
  retryText: {
    color: '#fff',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
});