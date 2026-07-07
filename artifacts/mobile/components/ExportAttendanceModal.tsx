import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Colors from "@/constants/colors";
import type { AppUser } from "@/lib/api";
import { localDateStr } from "@/lib/utils";

let NativeDatePicker: typeof import("@react-native-community/datetimepicker").default | null = null;
try {
  NativeDatePicker = require("@react-native-community/datetimepicker").default;
} catch {}

const C = Colors.light;

type Props = {
  visible: boolean;
  onClose: () => void;
  onExport: (employeeId: string | null, startDate: string, endDate: string) => void;
  users: AppUser[];
};

export function ExportAttendanceModal({ visible, onClose, onExport, users }: Props) {
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  
  // Default to last 30 days
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return localDateStr(d);
  });
  const [endDate, setEndDate] = useState(() => localDateStr(new Date()));

  const [pickerOpen, setPickerOpen] = useState<"start" | "end" | null>(null);
  const [empPickerOpen, setEmpPickerOpen] = useState(false);

  const handleExport = () => {
    onExport(selectedEmpId, startDate, endDate);
    onClose();
  };

  const selectedEmpName = selectedEmpId
    ? users.find((u) => u.id === selectedEmpId)?.name || "Unknown"
    : "All Employees";

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Export Attendance</Text>
            <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
              <Ionicons name="close" size={24} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} contentContainerStyle={{ gap: 20 }}>
            {/* Employee Selection */}
            <View>
              <Text style={styles.label}>Select Employee</Text>
              <TouchableOpacity
                style={styles.selectBtn}
                onPress={() => setEmpPickerOpen(!empPickerOpen)}
              >
                <Text style={[styles.selectText, !selectedEmpId && { color: C.textSecondary }]}>
                  {selectedEmpName}
                </Text>
                <Ionicons name={empPickerOpen ? "chevron-up" : "chevron-down"} size={20} color={C.textSecondary} />
              </TouchableOpacity>
              
              {empPickerOpen && (
                <View style={styles.dropdown}>
                  <TouchableOpacity
                    style={styles.dropdownItem}
                    onPress={() => { setSelectedEmpId(null); setEmpPickerOpen(false); }}
                  >
                    <Text style={styles.dropdownItemText}>All Employees</Text>
                  </TouchableOpacity>
                  {users.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      style={styles.dropdownItem}
                      onPress={() => { setSelectedEmpId(u.id); setEmpPickerOpen(false); }}
                    >
                      <Text style={styles.dropdownItemText}>{u.name}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Date Range */}
            <View style={{ flexDirection: "row", gap: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Start Date</Text>
                {Platform.OS === "web" ? (
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    style={webInputStyle}
                  />
                ) : (
                  <TouchableOpacity style={styles.selectBtn} onPress={() => setPickerOpen("start")}>
                    <Text style={styles.selectText}>{startDate}</Text>
                  </TouchableOpacity>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>End Date</Text>
                {Platform.OS === "web" ? (
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    style={webInputStyle}
                  />
                ) : (
                  <TouchableOpacity style={styles.selectBtn} onPress={() => setPickerOpen("end")}>
                    <Text style={styles.selectText}>{endDate}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {Platform.OS !== "web" && pickerOpen && NativeDatePicker && (
              <NativeDatePicker
                mode="date"
                value={new Date((pickerOpen === "start" ? startDate : endDate) + "T00:00:00")}
                display={Platform.OS === "ios" ? "spinner" : "default"}
                onChange={(evt: any, date?: Date) => {
                  setPickerOpen(Platform.OS === "ios" ? pickerOpen : null);
                  if (date) {
                    if (pickerOpen === "start") setStartDate(localDateStr(date));
                    else setEndDate(localDateStr(date));
                  }
                }}
              />
            )}
            
            {Platform.OS === "ios" && pickerOpen && (
              <TouchableOpacity style={styles.doneBtn} onPress={() => setPickerOpen(null)}>
                <Text style={styles.doneText}>Done</Text>
              </TouchableOpacity>
            )}

          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity style={styles.exportBtn} onPress={handleExport}>
              <Ionicons name="download-outline" size={20} color="#fff" />
              <Text style={styles.exportText}>Export to CSV</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const webInputStyle = {
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
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: C.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    minHeight: "50%",
    maxHeight: "80%",
    paddingBottom: Platform.OS === "ios" ? 20 : 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
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
  selectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
  },
  selectText: {
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
  dropdown: {
    marginTop: 6,
    backgroundColor: C.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    maxHeight: 200,
    overflow: "hidden",
  },
  dropdownItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.background,
  },
  dropdownItemText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  doneBtn: {
    alignSelf: "flex-end",
    padding: 8,
    marginTop: -8,
  },
  doneText: {
    color: C.brand,
    fontFamily: "Inter_600SemiBold",
    fontSize: 16,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  exportBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.brand,
    borderRadius: 16,
    height: 54,
    gap: 8,
  },
  exportText: {
    color: "#fff",
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
});
