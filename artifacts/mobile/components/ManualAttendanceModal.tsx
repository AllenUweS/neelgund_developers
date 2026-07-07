import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { UserBasic } from "@/lib/types";
import { todayISODate } from "@/lib/utils";

const C = Colors.light;

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: {
    employeeId: string;
    date: string;
    checkInTime: string;
    checkOutTime: string;
    notes: string;
  }) => void;
  isSubmitting: boolean;
  users: UserBasic[];
};

export function ManualAttendanceModal({ visible, onClose, onSubmit, isSubmitting, users }: Props) {
  const [form, setForm] = useState({
    employeeId: "",
    date: todayISODate(),
    checkInTime: "",
    checkOutTime: "",
    notes: "",
  });

  const handleSubmit = () => {
    onSubmit(form);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Manual Attendance Entry</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ gap: 20 }}>
            {/* Employee Selection */}
            <View>
              <Text style={styles.label}>Employee *</Text>
              <select
                value={form.employeeId}
                onChange={(e) => setForm(f => ({ ...f, employeeId: e.target.value }))}
                style={webInputStyle}
              >
                <option value="" disabled>Select employee</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </View>

            {/* Date Range */}
            <View>
              <Text style={styles.label}>Date * (YYYY-MM-DD)</Text>
              <input
                type="date"
                max={todayISODate()}
                value={form.date}
                onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                style={webInputStyle}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Check-in Time</Text>
                <input
                  type="time"
                  value={form.checkInTime}
                  onChange={(e) => setForm(f => ({ ...f, checkInTime: e.target.value }))}
                  style={webInputStyle}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Check-out Time</Text>
                <input
                  type="time"
                  value={form.checkOutTime}
                  onChange={(e) => setForm(f => ({ ...f, checkOutTime: e.target.value }))}
                  style={webInputStyle}
                />
              </View>
            </View>

            <View>
              <Text style={styles.label}>Status Rules</Text>
              <View style={styles.rulesCard}>
                <Text style={styles.rulesText}>8h or more = Present</Text>
                <Text style={styles.rulesText}>4h to less than 8h = Half Day</Text>
                <Text style={styles.rulesText}>Less than 4h = Absent</Text>
              </View>
            </View>

            <View>
              <Text style={styles.label}>Notes</Text>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Reason for manual entry..."
                style={{ ...webInputStyle, minHeight: 80, resize: "vertical" }}
              />
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <Text style={styles.submitText}>Saving...</Text>
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                  <Text style={styles.submitText}>Save Record</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const webInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px",
  borderRadius: "12px",
  border: `1px solid ${C.border}`,
  backgroundColor: C.card,
  fontSize: "15px",
  fontFamily: "inherit",
  outline: "none",
  color: C.text,
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    backgroundColor: C.background,
    borderRadius: 24,
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  title: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: C.text,
  },
  body: {
    padding: 24,
  },
  label: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    color: C.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
  },
  rulesCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 6,
  },
  rulesText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.card,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.brand,
    borderRadius: 16,
    height: 54,
    gap: 8,
  },
  submitText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
