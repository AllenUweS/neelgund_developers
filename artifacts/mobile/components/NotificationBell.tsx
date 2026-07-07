import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal, ScrollView, ActivityIndicator, Platform, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { listPendingAttendanceRegularizations, approveAttendanceRegularization } from "@/lib/api";

const C = Colors.light;

export default function NotificationBell() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === "admin" || user?.role === "super_admin" || user?.role === "manager" || user?.role === "hr";
  const [modalVisible, setModalVisible] = useState(false);
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  
  const { data: pendingRequests, isLoading, refetch } = useQuery({
    queryKey: ["pending-regularizations"],
    queryFn: listPendingAttendanceRegularizations,
    refetchInterval: 60000, // auto refetch every 1 minute
    enabled: isAdminOrManager,
  });
  
  const mutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "approved" | "rejected" }) => {
      await approveAttendanceRegularization(id, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pending-regularizations"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => {
      Alert.alert("Action Failed", err.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  });

  const requests = pendingRequests ?? [];
  const hasNotifications = requests.length > 0;

  if (!isAdminOrManager) return null;

  return (
    <>
      <TouchableOpacity 
        style={styles.bellBtn} 
        onPress={() => {
          setModalVisible(true);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
      >
        <Ionicons name="notifications-outline" size={24} color={C.text} />
        {hasNotifications && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{requests.length > 99 ? "99+" : requests.length}</Text>
          </View>
        )}
      </TouchableOpacity>

      <Modal
        visible={modalVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: Platform.OS === "web" ? 67 : Math.max(insets.top + 16, 30) }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setModalVisible(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Notifications</Text>
            <TouchableOpacity onPress={() => refetch()} disabled={isLoading}>
               {isLoading ? <ActivityIndicator size="small" color={C.brand} /> : <Ionicons name="refresh" size={20} color={C.brand} />}
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            {!hasNotifications ? (
              <View style={styles.emptyState}>
                <Ionicons name="checkmark-circle-outline" size={48} color={C.success} />
                <Text style={styles.emptyTitle}>All caught up!</Text>
                <Text style={styles.emptySubtitle}>There are no pending regularization requests.</Text>
              </View>
            ) : (
              requests.map((req) => (
                <View key={req.id} style={styles.notificationCard}>
                  <View style={styles.cardHeader}>
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {(req.employeeName ?? "E").charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.cardInfo}>
                      <Text style={styles.empName}>{req.employeeName ?? "Unknown Employee"}</Text>
                      <Text style={styles.reqDate}>For: {new Date(req.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                    </View>
                  </View>
                  
                  <View style={styles.reqDetails}>
                    <Text style={styles.detailText}>
                      <Text style={{ fontFamily: "Inter_600SemiBold" }}>Reason: </Text>
                      {req.reason ?? "No reason provided"}
                    </Text>
                    <Text style={styles.detailText}>
                      <Text style={{ fontFamily: "Inter_600SemiBold" }}>Requested Times: </Text>
                      {req.requestedCheckInTime ? new Date(req.requestedCheckInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"} - {req.requestedCheckOutTime ? new Date(req.requestedCheckOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "N/A"}
                    </Text>
                  </View>

                  <View style={styles.actionRow}>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.rejectBtn]}
                      onPress={() => mutation.mutate({ id: req.id, status: "rejected" })}
                      disabled={mutation.isPending}
                    >
                      <Ionicons name="close-circle-outline" size={16} color={C.danger} />
                      <Text style={styles.rejectText}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.actionBtn, styles.approveBtn]}
                      onPress={() => mutation.mutate({ id: req.id, status: "approved" })}
                      disabled={mutation.isPending}
                    >
                      <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                      <Text style={styles.approveText}>Approve</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bellBtn: {
    padding: 4,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    backgroundColor: C.danger,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: C.background,
    paddingHorizontal: 20,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  scrollContent: {
    paddingBottom: 40,
    gap: 12,
  },
  emptyState: {
    paddingTop: 60,
    alignItems: "center",
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    textAlign: "center",
  },
  notificationCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.brand + "18",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: C.brand,
  },
  cardInfo: {
    flex: 1,
  },
  empName: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    color: C.text,
  },
  reqDate: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: C.brand,
    marginTop: 2,
  },
  reqDetails: {
    backgroundColor: C.surfaceSecondary,
    padding: 12,
    borderRadius: 10,
    gap: 6,
  },
  detailText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    color: C.textSecondary,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    height: 36,
    borderRadius: 8,
    gap: 6,
  },
  rejectBtn: {
    backgroundColor: C.danger + "15",
  },
  rejectText: {
    color: C.danger,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  approveBtn: {
    backgroundColor: C.brand,
  },
  approveText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
});
