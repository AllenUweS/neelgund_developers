import React, { useEffect, useRef } from "react";
import { View, StyleSheet, Animated, DimensionValue } from "react-native";

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: any;
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 8, style }: SkeletonProps) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 1200,
          useNativeDriver: true,
        }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  const translateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-200, 200],
  });

  return (
    <View style={[{ width, height, borderRadius, overflow: "hidden", backgroundColor: "#E2E8F0" }, style]}>
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: "#F1F5F9",
            opacity: 0.6,
            transform: [{ translateX }],
          },
        ]}
      />
    </View>
  );
}

export function StatCardSkeleton() {
  return (
    <View style={skeletonStyles.statCard}>
      <Skeleton width={40} height={40} borderRadius={12} />
      <Skeleton width={60} height={28} borderRadius={6} />
      <Skeleton width={80} height={14} borderRadius={6} />
    </View>
  );
}

export function LeadRowSkeleton() {
  return (
    <View style={skeletonStyles.row}>
      <Skeleton width={40} height={40} borderRadius={12} />
      <View style={{ flex: 1, gap: 6 }}>
        <Skeleton width="70%" height={16} borderRadius={6} />
        <Skeleton width="40%" height={12} borderRadius={6} />
      </View>
    </View>
  );
}

export function HotCardSkeleton() {
  return (
    <View style={skeletonStyles.hotCard}>
      <Skeleton width={36} height={36} borderRadius={10} />
      <Skeleton width={80} height={16} borderRadius={6} />
      <Skeleton width={60} height={12} borderRadius={6} />
      <Skeleton width={50} height={18} borderRadius={6} />
    </View>
  );
}

export function LeaderboardRowSkeleton() {
  return (
    <View style={skeletonStyles.lbRow}>
      <Skeleton width={32} height={32} borderRadius={10} />
      <Skeleton width="60%" height={16} borderRadius={6} />
      <Skeleton width={40} height={16} borderRadius={6} />
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  statCard: {
    flex: 1,
    minWidth: "44%",
    borderRadius: 16,
    padding: 16,
    gap: 8,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 3,
    borderLeftColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
  hotCard: {
    width: 130,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E2E8F0",
  },
});
