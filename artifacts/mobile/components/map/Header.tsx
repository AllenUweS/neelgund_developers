import React from 'react';
import { View, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/theme';

type Props = {
  showBack?: boolean;
  employeeName?: string;
  showLive?: boolean;
};

export default function MapHeader({
  showBack = false,
  employeeName,
  showLive = false
}: Props) {
  const C = theme.light.colors;

  return (
    <View style={styles.header}>
      {showBack ? (
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => { /* will be wired later */ }}>
          <Ionicons name="arrow-back" size={24} color={C.text} />
        </TouchableOpacity>
      ) : null}

      <View style={styles.titleContainer}>
        <Text style={[styles.title, { color: C.text }]} numberOfLines={1}>
          {employeeName ? `Trip for ${employeeName}` : 'My Trip'}
        </Text>
      </View>

      {showLive && (
        <View style={[styles.liveDotContainer]}>
          <View style={styles.liveDot} />
          <Text style={[styles.liveText, { color: C.success }]}>LIVE</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    minHeight: 56,
    backgroundColor: theme.light.colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.light.spacing(2),
    gap: theme.light.spacing(1.5),
    zIndex: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.light.colors.border,
  },
  backButton: {
    padding: theme.light.spacing(1),
    backgroundColor: 'transparent',
  },
  titleContainer: { flex: 1, justifyContent: 'center' },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: theme.light.spacing(1.125), // 18px
  },
  liveDotContainer: { flexDirection: 'row', alignItems: 'center', gap: theme.light.spacing(3) },
  liveDot: {
    width: theme.light.spacing(2),
    height: theme.light.spacing(2),
    borderRadius: 999,
    backgroundColor: '#EF4444',
  },
  liveText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.light.spacing(0.875), // 14px
  },
});