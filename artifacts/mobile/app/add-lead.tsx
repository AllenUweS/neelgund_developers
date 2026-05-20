import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  type KeyboardTypeOptions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import DateTimePicker from "@react-native-community/datetimepicker";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { createLead } from "@/lib/api";
import type { Lead } from "@/lib/types";
import { enqueueLead } from "@/lib/offlineQueue";
import { reverseGeocode, openInGoogleMaps, formatCoordinates } from "@/lib/geocoding";

const C = Colors.light;

import { STATUS_LABELS, SOURCE_LABELS, PRIORITY_COLORS, statusColor } from "@/lib/utils";

const STATUSES = ["new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"] as const;
const SOURCES = ["referral", "walk_in", "online", "social", "broker", "cold_call", "field_activity"] as const;
const PRIORITIES = ["hot", "warm", "cold"] as const;

const HOUSING_TYPES = ["rent", "owned"] as const;
const HOUSING_LABELS: Record<string, string> = {
  rent: "Rent",
  owned: "Owned",
};

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AddLeadScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isTransport =
    user?.role === "transport" ||
    (user?.department != null && user.department.toLowerCase() === "transport");
  const [loading, setLoading] = useState(false);
  const [locLoading, setLocLoading] = useState(false);
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    propertyInterest: "",
    status: "new" as typeof STATUSES[number],
    notes: "",
    latitude: null as number | null,
    longitude: null as number | null,
    source: "" as typeof SOURCES[number] | "",
    budget: "",
    priority: "" as typeof PRIORITIES[number] | "",
    currentHousing: "" as typeof HOUSING_TYPES[number] | "",
    followUpDate: "",
    address: "",
  });

  useEffect(() => {
    autoCaptureLocation();
  }, []);

  // Fetch address when location is captured
  useEffect(() => {
    if (form.latitude && form.longitude) {
      reverseGeocode(form.latitude, form.longitude).then(result => {
        if (result) {
          setAddress(result.address);
        }
      });
    }
  }, [form.latitude, form.longitude]);

  const autoCaptureLocation = async () => {
    setLocLoading(true);
    try {
      if (Platform.OS === "web") {
        if (typeof navigator !== "undefined" && "geolocation" in navigator) {
          await new Promise<void>((resolve) => {
            navigator.geolocation.getCurrentPosition(
              (pos) => {
                setForm(f => ({ ...f, latitude: pos.coords.latitude, longitude: pos.coords.longitude }));
                resolve();
              },
              () => resolve(),
              { timeout: 10000, enableHighAccuracy: true }
            );
          });
        }
      } else {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status === "granted") {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          setForm(f => ({ ...f, latitude: loc.coords.latitude, longitude: loc.coords.longitude }));
        }
      }
    } catch {
      // ignore
    } finally {
      setLocLoading(false);
    }
  };

  const submitLead = async () => {
    setLoading(true);
    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email || null,
      propertyInterest: form.propertyInterest || null,
      status: form.status,
      notes: form.notes || null,
      latitude: form.latitude,
      longitude: form.longitude,
      source: form.source || null,
      budget: form.budget || null,
      priority: form.priority || null,
      currentHousing: form.currentHousing || null,
      followUpDate: form.followUpDate || null,
      address: form.address || null,
    };
    try {
      await createLead(payload);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      router.back();
    } catch (err) {
      Alert.alert(
        "Failed to Save",
        "Could not create the lead right now. Save it locally and sync when you're back online?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save Locally",
            onPress: async () => {
              try {
                await enqueueLead(payload);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                router.back();
              } catch {
                Alert.alert("Error", "Could not save lead locally either.");
              }
            },
          },
        ]
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (isTransport) {
      Alert.alert("Not allowed", "Your account is limited to tracking only and cannot create leads.");
      router.back();
      return;
    }
    if (!form.name.trim() || !form.phone.trim()) {
      Alert.alert("Required", "Name and phone number are required");
      return;
    }
    if (form.latitude === null) {
      Alert.alert(
        "GPS Required",
        "Lead location could not be captured. Please retry or check that location is enabled for this app.",
        [
          {
            text: "Retry GPS",
            onPress: () => {
              // Only retry the location capture — do NOT recursively call
              // handleSubmit() here, or an infinite Alert loop can form.
              autoCaptureLocation();
            },
          },
          { text: "Cancel", style: "cancel" },
        ]
      );
      return;
    }

    // Duplicate lead detection by phone number
    const normalizedPhone = form.phone.trim().replace(/\s+/g, "").replace(/^\+?91/, "");
    const cachedLeads = queryClient.getQueryData<Lead[]>(["leads"]);
    const duplicate = cachedLeads?.find((l) => {
      const lp = l.phone.trim().replace(/\s+/g, "").replace(/^\+?91/, "");
      return lp === normalizedPhone;
    });
    if (duplicate) {
      Alert.alert(
        "Duplicate Lead",
        `A lead with this phone number already exists: "${duplicate.name}" (${duplicate.status}). Do you want to continue?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Continue", onPress: () => submitLead() },
        ]
      );
      return;
    }

    submitLead();
  };

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined} enabled={Platform.OS !== "web"}>
      <ScrollView
        style={[styles.container, { paddingTop: topPad }]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Nav */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Ionicons name="chevron-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle}>New Lead</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            style={[styles.saveBtn, loading && { opacity: 0.6 }]}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.content}>
          {/* Location */}
          <TouchableOpacity
            style={styles.locRow}
            onPress={() => {
              if (form.latitude && form.longitude) {
                openInGoogleMaps(form.latitude, form.longitude);
              }
            }}
            disabled={!form.latitude}
          >
            <View style={[styles.locDot, { backgroundColor: form.latitude ? C.success : C.textSecondary }]} />
            <Text style={styles.locText}>
              {locLoading
                ? "Capturing location..."
                : form.latitude
                ? address || `Location captured (${formatCoordinates(form.latitude, form.longitude!)})`
                : "Location not available"}
            </Text>
            {!form.latitude && !locLoading && Platform.OS !== "web" && (
              <TouchableOpacity onPress={autoCaptureLocation}>
                <Ionicons name="refresh-outline" size={16} color={C.brand} />
              </TouchableOpacity>
            )}
            {form.latitude && (
              <Ionicons name="open-outline" size={16} color={C.textSecondary} />
            )}
          </TouchableOpacity>

          {/* Contact Info */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact Info</Text>
            <Field label="Full Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="Amit Kumar" />
            <Field label="Phone *" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+91 98765 43210" keyboardType="phone-pad" />
            <Field label="Email" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="amit@email.com" keyboardType="email-address" />
            <Field label="Address" value={form.address} onChange={v => setForm(f => ({ ...f, address: v }))} placeholder="Client address or location" multiline numberOfLines={2} />
          </View>

          {/* Lead Details */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Lead Details</Text>
            <Field
              label="Property Interest"
              value={form.propertyInterest}
              onChange={v => setForm(f => ({ ...f, propertyInterest: v }))}
              placeholder="e.g. 2BHK Flat, Commercial Plot"
            />
            <Field label="Budget" value={form.budget} onChange={v => setForm(f => ({ ...f, budget: v }))} placeholder="e.g. ₹50L – ₹75L" />

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Current Housing</Text>
              <View style={styles.checkboxRow}>
                {HOUSING_TYPES.map(housing => (
                  <TouchableOpacity
                    key={housing}
                    style={styles.checkboxOption}
                    onPress={() => setForm(f => ({ ...f, currentHousing: f.currentHousing === housing ? "" : housing }))}
                  >
                    <View style={[styles.checkboxBox, form.currentHousing === housing && styles.checkboxBoxChecked]}>
                      {form.currentHousing === housing ? <Ionicons name="checkmark" size={14} color="#FFFFFF" /> : null}
                    </View>
                    <Text style={styles.checkboxLabel}>{HOUSING_LABELS[housing]}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Follow-up Date */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Follow-up Date</Text>
              {Platform.OS === "web" ? (
                <View style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10, position: "relative", overflow: "hidden" }]}>
                  <Ionicons name="calendar-outline" size={18} color={form.followUpDate ? C.text : C.placeholder} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: form.followUpDate ? C.text : C.placeholder }}>
                    {form.followUpDate ? formatDisplayDate(form.followUpDate) : "Select date"}
                  </Text>
                  <input
                    type="date"
                    min={localDateStr(new Date())}
                    value={form.followUpDate || ""}
                    onChange={(e) => setForm(f => ({ ...f, followUpDate: e.target.value || "" }))}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      opacity: 0,
                      cursor: "pointer",
                      width: "100%",
                      height: "100%",
                    }}
                  />
                </View>
              ) : (
                <>
                  <TouchableOpacity
                    style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10 }]}
                    onPress={() => setShowFollowUpPicker(true)}
                  >
                    <Ionicons name="calendar-outline" size={18} color={form.followUpDate ? C.text : C.placeholder} />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: form.followUpDate ? C.text : C.placeholder }}>
                      {form.followUpDate ? formatDisplayDate(form.followUpDate) : "Select date"}
                    </Text>
                  </TouchableOpacity>
                  {showFollowUpPicker && (
                    <DateTimePicker
                      mode="date"
                      value={form.followUpDate ? new Date(form.followUpDate + "T00:00:00") : new Date()}
                      minimumDate={new Date()}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_evt, date) => {
                        setShowFollowUpPicker(Platform.OS === "ios");
                        if (date) {
                          setForm(f => ({ ...f, followUpDate: date.toISOString().split("T")[0] }));
                        }
                      }}
                    />
                  )}
                </>
              )}
            </View>

            {/* Source */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Lead Source</Text>
              <View style={styles.chipGrid}>
                {SOURCES.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, form.source === s && styles.chipActive]}
                    onPress={() => setForm(f => ({ ...f, source: f.source === s ? "" : s }))}
                  >
                    <Text style={[styles.chipText, form.source === s && styles.chipTextActive]}>
                      {SOURCE_LABELS[s]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Priority */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Priority</Text>
              <View style={styles.priorityRow}>
                {PRIORITIES.map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.priorityChip,
                      form.priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] },
                    ]}
                    onPress={() => setForm(f => ({ ...f, priority: f.priority === p ? "" : p }))}
                  >
                    <View style={[styles.priorityDot, { backgroundColor: form.priority === p ? "#fff" : PRIORITY_COLORS[p] }]} />
                    <Text style={[styles.priorityText, form.priority === p && { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Status */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Status</Text>
              <View style={styles.statusGrid}>
                {STATUSES.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.statusOption,
                      form.status === s && { backgroundColor: statusColor(s), borderColor: statusColor(s) },
                    ]}
                    onPress={() => setForm(f => ({ ...f, status: s }))}
                  >
                    <Text style={[styles.statusOptionText, form.status === s && { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" }]}>
                      {STATUS_LABELS[s]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <Field
              label="Notes"
              value={form.notes}
              onChange={v => setForm(f => ({ ...f, notes: v }))}
              placeholder="Any additional notes..."
              multiline
              numberOfLines={3}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
  numberOfLines,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  numberOfLines?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.formField}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, multiline && { height: (numberOfLines ?? 3) * 24 + 16, textAlignVertical: "top" }]}
        placeholder={placeholder}
        placeholderTextColor={C.placeholder}
        value={value}
        onChangeText={onChange}
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize ?? "words"}
        multiline={multiline}
        numberOfLines={numberOfLines}
      />
    </View>
  );
}



const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  navBack: { padding: 8 },
  navTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  saveBtn: {
    backgroundColor: C.brand,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 60,
    alignItems: "center",
  },
  saveBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: "#FFFFFF" },
  content: { paddingHorizontal: 20, gap: 20 },
  locRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  locDot: { width: 8, height: 8, borderRadius: 4 },
  locText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary },
  section: { gap: 12 },
  sectionTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: {
    backgroundColor: C.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
  },
  chipActive: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
  chipTextActive: { color: "#FFFFFF" },
  checkboxRow: { flexDirection: "row", gap: 16 },
  checkboxOption: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxBoxChecked: {
    backgroundColor: C.brand,
    borderColor: C.brand,
  },
  checkboxLabel: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    color: C.text,
  },
  priorityRow: { flexDirection: "row", gap: 10 },
  priorityChip: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: C.card,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  priorityText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.surfaceSecondary,
  },
  statusOptionText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    color: C.textSecondary,
  },
});
