import React, { useState, useEffect, ComponentType, type ComponentProps } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Linking,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
type IoniconsName = ComponentProps<typeof Ionicons>["name"];
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import {
  addLeadActivity,
  addLeadDocument,
  addLeadMeeting,
  deleteLead,
  deleteLeadActivity,
  deleteLeadMeeting,
  getLeadById,
  listLeadActivities,
  listLeadDocuments,
  listLeadMeetings,
  updateLead,
  updateLeadMeeting,
  updateLeadStatus,
} from "@/lib/api";
import type { Lead, LeadMeeting, LeadDocument, LeadActivity } from "@/lib/types";
import { PRIORITY_LABELS } from "@/lib/utils";
import { UploadFileError, pickAndUploadFile, resolveDocURL } from "@/utils/uploadFile";
import { reverseGeocode, openInGoogleMaps, formatCoordinates } from "@/lib/geocoding";

const C = Colors.light;

import { SOURCE_LABELS, PRIORITY_COLORS, statusColor, STATUS_LABELS } from "@/lib/utils";

const STATUSES = ["new", "not_contacted", "follow_up", "meeting_scheduled", "negotiation", "closed_won", "closed_lost"] as const;
const SOURCES = ["referral", "walk_in", "online", "social", "broker", "cold_call", "field_activity"] as const;
const PRIORITIES = ["hot", "warm", "cold"] as const;

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type ActivityType = "note" | "call" | "email" | "whatsapp" | "site_visit" | "meeting_done" | "status_change" | "other";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

// ─── Custom Date Picker Modal (For Follow Up Date) ───────────────────────────

interface CustomDatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: (date: Date) => void;
  initialDate?: Date;
  title?: string;
}

function CustomDatePickerModal({
  visible,
  onClose,
  onConfirm,
  initialDate,
  title,
}: CustomDatePickerModalProps) {
  const now = initialDate || new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [day, setDay] = useState(now.getDate());

  useEffect(() => {
    if (visible && initialDate) {
      setYear(initialDate.getFullYear());
      setMonth(initialDate.getMonth());
      setDay(initialDate.getDate());
    }
  }, [visible, initialDate]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const Spinner = ({
    value,
    min,
    max,
    onChange,
    label,
    formatter,
  }: {
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
    label: string;
    formatter?: (v: number) => string;
  }) => (
    <View style={dpStyles.spinnerCol}>
      <Text style={dpStyles.spinnerLabel}>{label}</Text>
      <TouchableOpacity
        style={dpStyles.spinnerBtn}
        onPress={() => onChange(value >= max ? min : value + 1)}
      >
        <Ionicons name="chevron-up" size={18} color={C.brand} />
      </TouchableOpacity>
      <View style={dpStyles.spinnerValueBox}>
        <Text style={dpStyles.spinnerValue}>
          {formatter ? formatter(value) : pad(value)}
        </Text>
      </View>
      <TouchableOpacity
        style={dpStyles.spinnerBtn}
        onPress={() => onChange(value <= min ? max : value - 1)}
      >
        <Ionicons name="chevron-down" size={18} color={C.brand} />
      </TouchableOpacity>
    </View>
  );

  const handleConfirm = () => {
    const safeDay = Math.min(day, daysInMonth);
    const date = new Date(year, month, safeDay, 0, 0, 0, 0);
    onConfirm(date);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dpStyles.overlay}>
        <View style={dpStyles.sheet}>
          <View style={dpStyles.sheetHeader}>
            <Text style={dpStyles.sheetTitle}>{title || "Select Date"}</Text>
            <TouchableOpacity onPress={onClose} style={dpStyles.sheetClose}>
              <Ionicons name="close" size={20} color={C.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={dpStyles.divider} />

          <View style={dpStyles.spinnersRow}>
            {/* Day */}
            <Spinner
              value={day}
              min={1}
              max={daysInMonth}
              onChange={setDay}
              label="Day"
            />
            <View style={dpStyles.spinnerSep} />
            {/* Month */}
            <Spinner
              value={month}
              min={0}
              max={11}
              onChange={setMonth}
              label="Month"
              formatter={(v) => MONTHS[v]}
            />
            <View style={dpStyles.spinnerSep} />
            {/* Year */}
            <Spinner
              value={year}
              min={new Date().getFullYear() - 1}
              max={new Date().getFullYear() + 10}
              onChange={setYear}
              label="Year"
              formatter={(v) => String(v)}
            />
          </View>

          <View style={dpStyles.divider} />

          <View style={dpStyles.previewRow}>
            <Ionicons name="time-outline" size={14} color={C.brand} />
            <Text style={dpStyles.previewText}>
              {`${day} ${MONTHS[month]} ${year}`}
            </Text>
          </View>

          <View style={dpStyles.sheetActions}>
            <TouchableOpacity style={dpStyles.cancelBtn} onPress={onClose}>
              <Text style={dpStyles.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={dpStyles.confirmBtn} onPress={handleConfirm}>
              <Text style={dpStyles.confirmBtnText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showStatusSheet, setShowStatusSheet] = useState(false);
  const [showMeetingModal, setShowMeetingModal] = useState(false);
  const [showDocModal, setShowDocModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showFollowUpPicker, setShowFollowUpPicker] = useState(false);
  const [meetingDate, setMeetingDate] = useState(new Date());
  const [meetingNotes, setMeetingNotes] = useState("");
  const [docForm, setDocForm] = useState({ name: "", url: "", mimeType: "" });
  const [docUploadMode, setDocUploadMode] = useState<"upload" | "link">("upload");
  const [isDocUploading, setIsDocUploading] = useState(false);
  const [activeTab, setActiveTab] = useState<"info" | "meetings" | "timeline" | "documents">("info");
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activityType, setActivityType] = useState<ActivityType>("note");
  const [activityDescription, setActivityDescription] = useState("");
  const [showMeetingEditModal, setShowMeetingEditModal] = useState(false);
  const [editMeetingId, setEditMeetingId] = useState<number | null>(null);
  const [editMeetingNotes, setEditMeetingNotes] = useState("");
  const [editForm, setEditForm] = useState<{
    name: string;
    phone: string;
    email: string;
    propertyInterest: string;
    status: string;
    notes: string;
    source: string;
    budget: string;
    priority: string;
    followUpDate: string;
    address: string;
  }>({
    name: "", phone: "", email: "", propertyInterest: "",
    status: "new", notes: "", source: "", budget: "",
    priority: "", followUpDate: "", address: "",
  });
  const [address, setAddress] = useState<string | null>(null);

  const leadId = parseInt(id, 10);
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const canDeleteLead = user?.role === "admin" || user?.role === "super_admin" || user?.role === "hr";

  if (isNaN(leadId)) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: topPad }]}>
        <Text style={styles.errorText}>Invalid lead ID</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: C.brand, fontFamily: "Inter_600SemiBold" }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const leadQ = useQuery({
    queryKey: ["lead", leadId],
    queryFn: async () => {
      const result = await getLeadById(leadId);
      return result ?? undefined;
    },
    staleTime: 60_000,
  });

  const meetingsQ = useQuery<LeadMeeting[]>({
    queryKey: ["lead-meetings", leadId],
    queryFn: async () => listLeadMeetings(leadId),
    staleTime: 60_000,
  });

  const docsQ = useQuery<LeadDocument[]>({
    queryKey: ["lead-docs", leadId],
    queryFn: async () => listLeadDocuments(leadId),
    staleTime: 60_000,
  });

  const activitiesQ = useQuery<LeadActivity[]>({
    queryKey: ["lead-activities", leadId],
    queryFn: async () => listLeadActivities(leadId),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (leadQ.data?.latitude && leadQ.data?.longitude) {
      reverseGeocode(leadQ.data.latitude, leadQ.data.longitude).then(result => {
        if (result) {
          setAddress(result.address);
        }
      });
    }
  }, [leadQ.data?.latitude, leadQ.data?.longitude]);

  const addActivityMutation = useMutation({
    mutationFn: async () => {
      await addLeadActivity(leadId, { type: activityType, description: activityDescription });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      setShowActivityModal(false);
      setActivityDescription("");
      setActivityType("note");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to add activity"),
  });

  const deleteActivityMutation = useMutation({
    mutationFn: async (activityId: number) => {
      await deleteLeadActivity(activityId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-activities", leadId] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const updateMeetingMutation = useMutation({
    mutationFn: async () => {
      if (!editMeetingId) return;
      await updateLeadMeeting(editMeetingId, editMeetingNotes);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-meetings", leadId] });
      setShowMeetingEditModal(false);
      setEditMeetingId(null);
      setEditMeetingNotes("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update meeting notes"),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      await updateLeadStatus(leadId, status);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setShowStatusSheet(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const updateLeadMutation = useMutation({
    mutationFn: async () => {
      await updateLead(leadId, {
        name: editForm.name,
        phone: editForm.phone,
        email: editForm.email || null,
        propertyInterest: editForm.propertyInterest || null,
        status: editForm.status,
        notes: editForm.notes || null,
        source: editForm.source || null,
        budget: editForm.budget || null,
        priority: editForm.priority || null,
        followUpDate: editForm.followUpDate || null,
        address: editForm.address || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setShowEditModal(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update lead"),
  });

  const deleteLeadMutation = useMutation({
    mutationFn: async () => {
      await deleteLead(leadId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    },
    onError: (err: Error) => Alert.alert("Delete Failed", err.message || "Unable to delete lead"),
  });

  const addMeetingMutation = useMutation({
    mutationFn: async () => {
      await addLeadMeeting(leadId, meetingDate.toISOString(), meetingNotes || null);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-meetings", leadId] });
      queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setShowMeetingModal(false);
      setMeetingNotes("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const deleteMeetingMutation = useMutation({
    mutationFn: async (meetingId: number) => {
      await deleteLeadMeeting(meetingId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-meetings", leadId] });
    },
  });

  const addDocMutation = useMutation({
    mutationFn: async () => {
      await addLeadDocument(leadId, { name: docForm.name, url: docForm.url, mimeType: docForm.mimeType || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead-docs", leadId] });
      setShowDocModal(false);
      setDocForm({ name: "", url: "", mimeType: "" });
      setDocUploadMode("upload");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to attach document"),
  });

  const openEditModal = (lead: Lead) => {
    setEditForm({
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? "",
      propertyInterest: lead.propertyInterest ?? "",
      status: lead.status,
      notes: lead.notes ?? "",
      source: lead.source ?? "",
      budget: lead.budget ?? "",
      priority: lead.priority ?? "",
      followUpDate: lead.followUpDate ?? "",
      address: lead.address ?? "",
    });
    setShowEditModal(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const lead = leadQ.data;
  const meetings = meetingsQ.data ?? [];
  const docs = docsQ.data ?? [];
  const activities = activitiesQ.data ?? [];

  if (!lead && leadQ.isLoading) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: topPad }]}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  if (!lead) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: topPad }]}>
        <Text style={styles.errorText}>Lead not found</Text>
      </View>
    );
  }

  const sc = statusColor(lead.status);
  const confirmDeleteLead = () => {
    Alert.alert("Delete Lead", `Delete ${lead.name}? This action cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteLeadMutation.mutate() },
    ]);
  };

  const initialsStr = lead.name.charAt(0).toUpperCase();

  function formatDisplayDate(dateStr: string): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  }

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      {/* Nav */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
          <Ionicons name="chevron-back" size={24} color="#1E293B" />
        </TouchableOpacity>
        <Text style={styles.navTitle} numberOfLines={1}>{lead.name}</Text>
        <View style={styles.navActions}>
          {canDeleteLead ? (
            <TouchableOpacity onPress={confirmDeleteLead} style={styles.navDeleteBtn}>
              <Ionicons name="trash-outline" size={20} color={C.danger} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => openEditModal(lead)} style={styles.navEditBtn}>
            <Ionicons name="pencil-outline" size={20} color={C.brand} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Hero */}
      <View style={styles.hero}>
        <View style={[styles.heroAvatar, { backgroundColor: "#EBF3FC" }]}>
          <Text style={[styles.heroAvatarText, { color: C.brand }]}>{initialsStr}</Text>
        </View>
        <Text style={styles.heroName}>{lead.name}</Text>
        <View style={styles.heroBadgeRow}>
          {/* Status Badge Dropdown */}
          <TouchableOpacity
            style={[styles.statusBadge, { backgroundColor: sc + "15" }]}
            onPress={() => setShowStatusSheet(true)}
          >
            <Text style={[styles.statusText, { color: sc }]}>{STATUS_LABELS[lead.status]}</Text>
            <Ionicons name="chevron-down" size={12} color={sc} />
          </TouchableOpacity>

          {/* Priority Pill */}
          {lead.priority ? (
            <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[lead.priority] + "15" }]}>
              <View style={[styles.priorityDot, { backgroundColor: PRIORITY_COLORS[lead.priority] }]} />
              <Text style={[styles.priorityText, { color: PRIORITY_COLORS[lead.priority] }]}>
                {lead.priority.charAt(0).toUpperCase() + lead.priority.slice(1)}
              </Text>
            </View>
          ) : (
            <View style={[styles.priorityBadge, { backgroundColor: "#F1F5F9" }]}>
              <View style={[styles.priorityDot, { backgroundColor: "#94A3B8" }]} />
              <Text style={[styles.priorityText, { color: "#64748B" }]}>Warm</Text>
            </View>
          )}
        </View>

        {/* 4 Action Buttons Row */}
        <View style={styles.heroActions}>
          <TouchableOpacity style={styles.heroAction} onPress={() => Linking.openURL(`tel:${lead.phone}`)}>
            <Ionicons name="call-outline" size={20} color={C.brand} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.heroAction, !lead.email && { opacity: 0.5 }]}
            onPress={() => {
              if (lead.email) {
                Linking.openURL(`mailto:${lead.email}`);
              } else {
                Alert.alert("Info", "No email address provided for this lead.");
              }
            }}
          >
            <Ionicons name="mail-outline" size={20} color={C.brand} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.heroAction}
            onPress={() => {
              setShowMeetingModal(true);
              setActiveTab("meetings");
            }}
          >
            <Ionicons name="calendar-outline" size={20} color={C.brand} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.heroAction}
            onPress={() => {
              setShowDocModal(true);
              setActiveTab("documents");
            }}
          >
            <Ionicons name="attach-outline" size={20} color={C.brand} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={{ borderBottomWidth: 1, borderBottomColor: "#E2E8F0" }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {(["info", "meetings", "timeline", "documents"] as const).map(tab => {
            const label =
              tab === "info" ? "Info"
              : tab === "meetings" ? `Meetings${meetings.length > 0 ? ` (${meetings.length})` : ""}`
              : tab === "timeline" ? `Timeline${activities.length > 0 ? ` (${activities.length})` : ""}`
              : `Docs${docs.length > 0 ? ` (${docs.length})` : ""}`;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Content */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 16, gap: 12, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "info" && (
          <>
            <InfoRow icon="call-outline" label="Phone" value={lead.phone} />
            <InfoRow icon="mail-outline" label="Email" value={lead.email || "Pinky@gma.com"} />
            <InfoRow icon="home-outline" label="Property Interest" value={lead.propertyInterest || "Sjskj"} />
            <InfoRow icon="cash-outline" label="Budget" value={lead.budget || "25"} />
            <InfoRow icon="location-outline" label="Address" value={lead.address || "Ajjasj"} />
            {lead.source ? <InfoRow icon="git-network-outline" label="Lead Source" value={SOURCE_LABELS[lead.source] ?? lead.source} /> : null}
            {lead.priority ? (
              <InfoRow
                icon="flame-outline"
                label="Priority"
                value={lead.priority.charAt(0).toUpperCase() + lead.priority.slice(1)}
                valueColor={PRIORITY_COLORS[lead.priority]}
              />
            ) : null}
            {lead.followUpDate ? <InfoRow icon="calendar-outline" label="Follow-up Date" value={lead.followUpDate} /> : null}
            {lead.employeeName ? <InfoRow icon="person-outline" label="Sales Rep" value={lead.employeeName} /> : null}
            {lead.latitude ? (
              <TouchableOpacity
                onPress={() => openInGoogleMaps(lead.latitude!, lead.longitude!)}
                style={styles.locationRow}
              >
                <View style={styles.locationIcon}>
                  <Ionicons name="map-outline" size={18} color={C.brand} />
                </View>
                <View style={styles.locationContent}>
                  <Text style={styles.locationLabel}>GPS Location</Text>
                  <Text style={styles.locationAddress}>
                    {address || formatCoordinates(lead.latitude!, lead.longitude!)}
                  </Text>
                  {!address && (
                    <Text style={styles.locationCoords}>
                      {formatCoordinates(lead.latitude!, lead.longitude!)}
                    </Text>
                  )}
                </View>
                <Ionicons name="open-outline" size={16} color={C.textSecondary} />
              </TouchableOpacity>
            ) : null}
            {lead.notes ? (
              <View style={styles.notesCard}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{lead.notes}</Text>
              </View>
            ) : null}
            <View style={styles.dateRow}>
              <Text style={styles.dateText}>Created {new Date(lead.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Text>
              <Text style={styles.dateText}>Updated {new Date(lead.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</Text>
            </View>
          </>
        )}

        {activeTab === "meetings" && (
          <>
            <TouchableOpacity style={styles.addActionBtn} onPress={() => setShowMeetingModal(true)}>
              <Ionicons name="calendar-outline" size={18} color={C.brand} />
              <Text style={styles.addActionText}>Schedule Meeting</Text>
            </TouchableOpacity>
            {meetings.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="calendar-outline" size={36} color={C.border} />
                <Text style={styles.emptyText}>No meetings scheduled</Text>
              </View>
            ) : (
              meetings.map(m => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.meetingCard}
                  onPress={() => {
                    setEditMeetingId(m.id);
                    setEditMeetingNotes(m.notes ?? "");
                    setShowMeetingEditModal(true);
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                  activeOpacity={0.8}
                >
                  <View style={styles.meetingLeft}>
                    <View style={styles.meetingDateBadge}>
                      <Text style={styles.meetingDay}>{new Date(m.scheduledAt).getDate()}</Text>
                      <Text style={styles.meetingMonth}>{new Date(m.scheduledAt).toLocaleDateString("en", { month: "short" })}</Text>
                    </View>
                  </View>
                  <View style={styles.meetingInfo}>
                    <Text style={styles.meetingTime}>{new Date(m.scheduledAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}</Text>
                    {m.notes ? (
                      <Text style={styles.meetingNotes} numberOfLines={2}>{m.notes}</Text>
                    ) : (
                      <Text style={[styles.meetingNotes, { color: C.textSecondary, fontStyle: "italic" }]}>Tap to add notes / outcome</Text>
                    )}
                  </View>
                  <View style={{ gap: 10 }}>
                    <TouchableOpacity
                      onPress={(e) => {
                        e.stopPropagation();
                        Alert.alert("Delete Meeting", "Remove this meeting?", [
                          { text: "Cancel", style: "cancel" },
                          { text: "Delete", style: "destructive", onPress: () => deleteMeetingMutation.mutate(m.id) },
                        ]);
                      }}
                    >
                      <Ionicons name="trash-outline" size={18} color={C.danger} />
                    </TouchableOpacity>
                    <Ionicons name="create-outline" size={18} color={C.brand} />
                  </View>
                </TouchableOpacity>
              ))
            )}
          </>
        )}

        {activeTab === "timeline" && (
          <>
            <TouchableOpacity style={styles.addActionBtn} onPress={() => { setShowActivityModal(true); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}>
              <Ionicons name="add-circle-outline" size={18} color={C.brand} />
              <Text style={styles.addActionText}>Add Activity</Text>
            </TouchableOpacity>
            {activitiesQ.isLoading ? (
              <ActivityIndicator color={C.brand} />
            ) : activities.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="time-outline" size={36} color={C.border} />
                <Text style={styles.emptyText}>No activities yet</Text>
                <Text style={[styles.emptyText, { fontSize: 13, marginTop: 4 }]}>Add calls, notes, or site visit logs</Text>
              </View>
            ) : (
              <View style={styles.timeline}>
                {activities.map((act, idx) => {
                  const typeConfig: Record<ActivityType, { icon: string; color: string; label: string }> = {
                    note: { icon: "document-text-outline", color: C.brand, label: "Note" },
                    call: { icon: "call-outline", color: C.success, label: "Call" },
                    email: { icon: "mail-outline", color: "#8B5CF6", label: "Email" },
                    whatsapp: { icon: "logo-whatsapp", color: "#25D366", label: "WhatsApp" },
                    site_visit: { icon: "location-outline", color: C.accent, label: "Site Visit" },
                    meeting_done: { icon: "people-outline", color: "#F59E0B", label: "Meeting Done" },
                    status_change: { icon: "git-compare-outline", color: C.warning, label: "Status Change" },
                    other: { icon: "ellipsis-horizontal-outline", color: C.textSecondary, label: "Other" },
                  };
                  const cfg = typeConfig[act.type as ActivityType] ?? typeConfig.note;
                  const isLast = idx === activities.length - 1;
                  return (
                    <View key={act.id} style={styles.timelineItem}>
                      <View style={styles.timelineLeft}>
                        <View style={[styles.timelineDot, { backgroundColor: cfg.color + "20", borderColor: cfg.color }]}>
                          <Ionicons name={cfg.icon as "document-text-outline"} size={14} color={cfg.color} />
                        </View>
                        {!isLast && <View style={styles.timelineLine} />}
                      </View>
                      <View style={styles.timelineContent}>
                        <View style={styles.timelineHeader}>
                          <View style={[styles.timelineTypeBadge, { backgroundColor: cfg.color + "15" }]}>
                            <Text style={[styles.timelineTypeText, { color: cfg.color }]}>{cfg.label}</Text>
                          </View>
                          <TouchableOpacity
                            onPress={() => Alert.alert("Delete Activity", "Remove this activity?", [
                              { text: "Cancel", style: "cancel" },
                              { text: "Delete", style: "destructive", onPress: () => deleteActivityMutation.mutate(act.id) },
                            ])}
                          >
                            <Ionicons name="trash-outline" size={15} color={C.danger} />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.timelineDesc}>{act.description}</Text>
                        <Text style={styles.timelineMeta}>
                          {act.createdByName ?? "Unknown"} · {new Date(act.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} {new Date(act.createdAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </>
        )}

        {activeTab === "documents" && (
          <>
            <TouchableOpacity style={styles.addActionBtn} onPress={() => setShowDocModal(true)}>
              <Ionicons name="attach-outline" size={18} color={C.brand} />
              <Text style={styles.addActionText}>Add Document</Text>
            </TouchableOpacity>
            {docs.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="document-outline" size={36} color={C.border} />
                <Text style={styles.emptyText}>No documents attached</Text>
              </View>
            ) : (
              docs.map(doc => (
                <TouchableOpacity
                  key={doc.id}
                  style={styles.docCard}
                  onPress={() => Linking.openURL(resolveDocURL(doc.url, ""))}
                >
                  <Ionicons name="document-text-outline" size={22} color={C.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName} numberOfLines={1}>{doc.name}</Text>
                    <Text style={styles.docDate}>{new Date(doc.createdAt).toLocaleDateString("en-IN")}</Text>
                  </View>
                  <Ionicons name="open-outline" size={16} color={C.textSecondary} />
                </TouchableOpacity>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Status Sheet */}
      <Modal visible={showStatusSheet} animationType="slide" transparent onRequestClose={() => setShowStatusSheet(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowStatusSheet(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.sheetTitle}>Update Status</Text>
            {STATUSES.map(s => {
              const color = statusColor(s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.sheetOption, lead.status === s && { backgroundColor: color + "12" }]}
                  onPress={() => updateStatusMutation.mutate(s)}
                >
                  <View style={[styles.sheetDot, { backgroundColor: color }]} />
                  <Text style={[styles.sheetOptionText, lead.status === s && { color, fontFamily: "Inter_600SemiBold" }]}>
                    {STATUS_LABELS[s]}
                  </Text>
                  {lead.status === s && <Ionicons name="checkmark" size={18} color={color} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Edit Lead Modal */}
      <Modal visible={showEditModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowEditModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowEditModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Edit Lead</Text>
            <TouchableOpacity onPress={() => {
              if (!editForm.name.trim() || !editForm.phone.trim()) {
                Alert.alert("Required", "Name and phone are required");
                return;
              }
              updateLeadMutation.mutate();
            }}>
              {updateLeadMutation.isPending ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <EditSectionLabel title="Contact Info" />
            <EditField label="Full Name *" value={editForm.name} onChange={v => setEditForm(f => ({ ...f, name: v }))} placeholder="Amit Kumar" />
            <EditField label="Phone *" value={editForm.phone} onChange={v => setEditForm(f => ({ ...f, phone: v }))} placeholder="+91 98765 43210" keyboardType="phone-pad" />
            <EditField label="Email" value={editForm.email} onChange={v => setEditForm(f => ({ ...f, email: v }))} placeholder="amit@email.com" keyboardType="email-address" autoCapitalize="none" />
            <EditField label="Address" value={editForm.address} onChange={v => setEditForm(f => ({ ...f, address: v }))} placeholder="Client address" multiline numberOfLines={2} />

            <EditSectionLabel title="Lead Details" />
            <EditField label="Property Interest" value={editForm.propertyInterest} onChange={v => setEditForm(f => ({ ...f, propertyInterest: v }))} placeholder="2BHK Flat, Commercial Plot" />
            <EditField label="Budget" value={editForm.budget} onChange={v => setEditForm(f => ({ ...f, budget: v }))} placeholder="₹50L – ₹75L" />
            
            {/* Follow-up Date custom picker */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Follow-up Date</Text>
              <TouchableOpacity
                onPress={() => setShowFollowUpPicker(true)}
                style={[styles.fieldInput, { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "space-between" }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="calendar-outline" size={18} color={editForm.followUpDate ? C.text : C.placeholder} />
                  <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: editForm.followUpDate ? C.text : C.placeholder }}>
                    {editForm.followUpDate
                      ? formatDisplayDate(editForm.followUpDate)
                      : "Select date"}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Lead Source */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Lead Source</Text>
              <View style={styles.chipGrid}>
                {SOURCES.map(s => (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, editForm.source === s && styles.chipActive]}
                    onPress={() => setEditForm(f => ({ ...f, source: f.source === s ? "" : s }))}
                  >
                    <Text style={[styles.chipText, editForm.source === s && styles.chipTextActive]}>
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
                      editForm.priority === p && { backgroundColor: PRIORITY_COLORS[p], borderColor: PRIORITY_COLORS[p] },
                    ]}
                    onPress={() => setEditForm(f => ({ ...f, priority: f.priority === p ? "" : p }))}
                  >
                    <View style={[styles.priorityDotSmall, { backgroundColor: editForm.priority === p ? "#fff" : PRIORITY_COLORS[p] }]} />
                    <Text style={[styles.priorityChipText, editForm.priority === p && { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>
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
                      editForm.status === s && { backgroundColor: statusColor(s), borderColor: statusColor(s) },
                    ]}
                    onPress={() => setEditForm(f => ({ ...f, status: s }))}
                  >
                    <Text style={[styles.statusOptionText, editForm.status === s && { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" }]}>
                      {STATUS_LABELS[s]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <EditField label="Notes" value={editForm.notes} onChange={v => setEditForm(f => ({ ...f, notes: v }))} placeholder="Any notes..." multiline numberOfLines={3} />
          </ScrollView>
        </View>
      </Modal>

      {/* Meeting Modal */}
      <Modal visible={showMeetingModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowMeetingModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowMeetingModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Schedule Meeting</Text>
            <TouchableOpacity onPress={() => addMeetingMutation.mutate()}>
              {addMeetingMutation.isPending ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          
          <Text style={styles.fieldLabel}>Date & Time</Text>
          <View style={styles.inlineSpinnersContainer}>
            {/* Inline Spinners */}
            <View style={dpStyles.spinnersRow}>
              {/* Day Spinner */}
              <View style={dpStyles.spinnerCol}>
                <Text style={dpStyles.spinnerLabel}>Day</Text>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const days = new Date(meetingDate.getFullYear(), meetingDate.getMonth() + 1, 0).getDate();
                  const nextDay = meetingDate.getDate() >= days ? 1 : meetingDate.getDate() + 1;
                  const newD = new Date(meetingDate); newD.setDate(nextDay); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-up" size={18} color={C.brand} />
                </TouchableOpacity>
                <View style={dpStyles.spinnerValueBox}>
                  <Text style={dpStyles.spinnerValue}>{pad(meetingDate.getDate())}</Text>
                </View>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const days = new Date(meetingDate.getFullYear(), meetingDate.getMonth() + 1, 0).getDate();
                  const prevDay = meetingDate.getDate() <= 1 ? days : meetingDate.getDate() - 1;
                  const newD = new Date(meetingDate); newD.setDate(prevDay); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-down" size={18} color={C.brand} />
                </TouchableOpacity>
              </View>
              <View style={dpStyles.spinnerSep} />
              
              {/* Month Spinner */}
              <View style={dpStyles.spinnerCol}>
                <Text style={dpStyles.spinnerLabel}>Month</Text>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const nextM = meetingDate.getMonth() >= 11 ? 0 : meetingDate.getMonth() + 1;
                  const newD = new Date(meetingDate); newD.setMonth(nextM); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-up" size={18} color={C.brand} />
                </TouchableOpacity>
                <View style={dpStyles.spinnerValueBox}>
                  <Text style={dpStyles.spinnerValue}>{MONTHS[meetingDate.getMonth()]}</Text>
                </View>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const prevM = meetingDate.getMonth() <= 0 ? 11 : meetingDate.getMonth() - 1;
                  const newD = new Date(meetingDate); newD.setMonth(prevM); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-down" size={18} color={C.brand} />
                </TouchableOpacity>
              </View>
              <View style={dpStyles.spinnerSep} />

              {/* Year Spinner */}
              <View style={dpStyles.spinnerCol}>
                <Text style={dpStyles.spinnerLabel}>Year</Text>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const newD = new Date(meetingDate); newD.setFullYear(meetingDate.getFullYear() + 1); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-up" size={18} color={C.brand} />
                </TouchableOpacity>
                <View style={dpStyles.spinnerValueBox}>
                  <Text style={dpStyles.spinnerValue}>{meetingDate.getFullYear()}</Text>
                </View>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const newD = new Date(meetingDate); newD.setFullYear(meetingDate.getFullYear() - 1); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-down" size={18} color={C.brand} />
                </TouchableOpacity>
              </View>
              <View style={[dpStyles.spinnerSep, { marginHorizontal: 8 }]} />

              {/* Hour Spinner */}
              <View style={dpStyles.spinnerCol}>
                <Text style={dpStyles.spinnerLabel}>HH</Text>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const nextH = meetingDate.getHours() >= 23 ? 0 : meetingDate.getHours() + 1;
                  const newD = new Date(meetingDate); newD.setHours(nextH); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-up" size={18} color={C.brand} />
                </TouchableOpacity>
                <View style={dpStyles.spinnerValueBox}>
                  <Text style={dpStyles.spinnerValue}>{pad(meetingDate.getHours())}</Text>
                </View>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const prevH = meetingDate.getHours() <= 0 ? 23 : meetingDate.getHours() - 1;
                  const newD = new Date(meetingDate); newD.setHours(prevH); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-down" size={18} color={C.brand} />
                </TouchableOpacity>
              </View>
              <Text style={dpStyles.colonSep}>:</Text>

              {/* Minute Spinner */}
              <View style={dpStyles.spinnerCol}>
                <Text style={dpStyles.spinnerLabel}>MM</Text>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const nextM = meetingDate.getMinutes() >= 59 ? 0 : meetingDate.getMinutes() + 1;
                  const newD = new Date(meetingDate); newD.setMinutes(nextM); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-up" size={18} color={C.brand} />
                </TouchableOpacity>
                <View style={dpStyles.spinnerValueBox}>
                  <Text style={dpStyles.spinnerValue}>{pad(meetingDate.getMinutes())}</Text>
                </View>
                <TouchableOpacity style={dpStyles.spinnerBtn} onPress={() => {
                  const prevM = meetingDate.getMinutes() <= 0 ? 59 : meetingDate.getMinutes() - 1;
                  const newD = new Date(meetingDate); newD.setMinutes(prevM); setMeetingDate(newD);
                }}>
                  <Ionicons name="chevron-down" size={18} color={C.brand} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={dpStyles.previewRow}>
              <Ionicons name="time-outline" size={14} color={C.brand} />
              <Text style={dpStyles.previewText}>
                {`${meetingDate.getDate()} ${MONTHS[meetingDate.getMonth()]} ${meetingDate.getFullYear()} at ${pad(meetingDate.getHours())}:${pad(meetingDate.getMinutes())}`}
              </Text>
            </View>
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 8 }]}>Notes</Text>
          <TextInput
            style={[styles.fieldInput, { height: 80, textAlignVertical: "top" }]}
            placeholder="Meeting agenda or notes..."
            placeholderTextColor={C.placeholder}
            value={meetingNotes}
            onChangeText={setMeetingNotes}
            multiline
          />
        </View>
      </Modal>

      {/* Doc Modal */}
      <Modal visible={showDocModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => {
        setShowDocModal(false);
        setDocForm({ name: "", url: "", mimeType: "" });
        setDocUploadMode("upload");
      }}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => { setShowDocModal(false); setDocForm({ name: "", url: "", mimeType: "" }); setDocUploadMode("upload"); }}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Document</Text>
            <TouchableOpacity
              disabled={addDocMutation.isPending || isDocUploading}
              onPress={() => {
                if (!docForm.name.trim()) { Alert.alert("Required", "Document name is required"); return; }
                if (!docForm.url) { Alert.alert("Required", docUploadMode === "upload" ? "Please pick a file first" : "URL is required"); return; }
                addDocMutation.mutate();
              }}
            >
              {addDocMutation.isPending ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>

          {/* Upload / Link mode toggle */}
          <View style={styles.modeRow}>
            {(["upload", "link"] as const).map(mode => (
              <TouchableOpacity
                key={mode}
                style={[styles.modeBtn, docUploadMode === mode && styles.modeBtnActive]}
                onPress={() => { setDocUploadMode(mode); setDocForm(f => ({ ...f, url: "", mimeType: "" })); }}
              >
                <Ionicons
                  name={mode === "upload" ? "cloud-upload-outline" : "link-outline"}
                  size={16}
                  color={docUploadMode === mode ? "#fff" : C.textSecondary}
                />
                <Text style={[styles.modeBtnText, docUploadMode === mode && styles.modeBtnTextActive]}>
                  {mode === "upload" ? "Upload File" : "Add Link"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Document Name *</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Quotation PDF"
              placeholderTextColor={C.placeholder}
              value={docForm.name}
              onChangeText={v => setDocForm(f => ({ ...f, name: v }))}
            />
          </View>

          {docUploadMode === "upload" ? (
            <View>
              {(() => {
                const hasUploadedObjectPath =
                  !!docForm.url && !docForm.url.startsWith("http://") && !docForm.url.startsWith("https://");
                return (
              <TouchableOpacity
                style={[styles.uploadBtn, hasUploadedObjectPath && styles.uploadBtnDone]}
                disabled={isDocUploading}
                onPress={async () => {
                  try {
                    setIsDocUploading(true);
                    const uploaded = await pickAndUploadFile("");
                    if (!uploaded) return;
                    setDocForm(f => ({ ...f, name: f.name || uploaded.name, url: uploaded.objectPath, mimeType: uploaded.mimeType }));
                    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                  } catch (e) {
                    if (e instanceof UploadFileError && e.code === "file_too_large") {
                      Alert.alert("File Too Large", e.message);
                    } else {
                      const message = e instanceof Error ? e.message : "Could not upload the file. Please try again.";
                      Alert.alert("Upload Failed", message);
                    }
                  } finally {
                    setIsDocUploading(false);
                  }
                }}
              >
                {isDocUploading ? (
                  <><ActivityIndicator color={C.brand} size="small" /><Text style={styles.uploadBtnText}>Uploading…</Text></>
                ) : hasUploadedObjectPath ? (
                  <><Ionicons name="checkmark-circle" size={20} color={C.success} /><Text style={[styles.uploadBtnText, { color: C.success }]}>File uploaded — tap to replace</Text></>
                ) : (
                  <><Ionicons name="cloud-upload-outline" size={20} color={C.brand} /><Text style={styles.uploadBtnText}>Pick a file to upload</Text></>
                )}
              </TouchableOpacity>
                );
              })()}
            </View>
          ) : (
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>URL *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="https://example.com/doc"
                placeholderTextColor={C.placeholder}
                value={docForm.url}
                onChangeText={v => setDocForm(f => ({ ...f, url: v }))}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>
          )}
        </View>
      </Modal>

      {/* Activity Modal */}
      <Modal visible={showActivityModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowActivityModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowActivityModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Add Activity</Text>
            <TouchableOpacity onPress={() => addActivityMutation.mutate()}>
              {addActivityMutation.isPending ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          <Text style={styles.fieldLabel}>Activity Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 8 }} style={{ flexGrow: 0 }}>
            {(["note", "call", "email", "whatsapp", "site_visit", "meeting_done", "other"] as const).map(type => {
              const label =
                type === "note" ? "Note" : type === "call" ? "Call" : type === "email" ? "Email"
                : type === "whatsapp" ? "WhatsApp" : type === "site_visit" ? "Site Visit"
                : type === "meeting_done" ? "Meeting Outcome" : "Other";
              return (
                <TouchableOpacity
                  key={type}
                  style={[styles.chip, activityType === type && styles.chipActive]}
                  onPress={() => setActivityType(type)}
                >
                  <Text style={[styles.chipText, activityType === type && styles.chipTextActive]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <Text style={styles.fieldLabel}>Description *</Text>
          <TextInput
            style={[styles.fieldInput, { height: 120, textAlignVertical: "top", marginTop: 8 }]}
            placeholder="What happened? What was discussed?"
            placeholderTextColor={C.placeholder}
            value={activityDescription}
            onChangeText={setActivityDescription}
            multiline
          />
        </View>
      </Modal>

      {/* Edit Meeting Notes Modal */}
      <Modal visible={showMeetingEditModal} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setShowMeetingEditModal(false)}>
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowMeetingEditModal(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Meeting Notes</Text>
            <TouchableOpacity onPress={() => updateMeetingMutation.mutate()}>
              {updateMeetingMutation.isPending ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
            </TouchableOpacity>
          </View>
          <Text style={styles.fieldLabel}>Notes / Outcome</Text>
          <TextInput
            style={[styles.fieldInput, { height: 160, textAlignVertical: "top", marginTop: 8 }]}
            placeholder="Meeting outcome, decisions, next steps..."
            placeholderTextColor={C.placeholder}
            value={editMeetingNotes}
            onChangeText={setEditMeetingNotes}
            multiline
          />
        </View>
      </Modal>

      {/* Follow-up Custom Date Picker */}
      <CustomDatePickerModal
        visible={showFollowUpPicker}
        onClose={() => setShowFollowUpPicker(false)}
        onConfirm={(date) => {
          setEditForm(f => ({ ...f, followUpDate: localDateStr(date) }));
        }}
        initialDate={editForm.followUpDate ? new Date(editForm.followUpDate + "T00:00:00") : new Date()}
        title="Select Follow-up Date"
      />
    </View>
  );
}

function EditSectionLabel({ title }: { title: string }) {
  return <Text style={editSectionStyle}>{title}</Text>;
}

const editSectionStyle: import("react-native").TextStyle = {
  fontSize: 12,
  fontFamily: "Inter_600SemiBold",
  color: C.textSecondary,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  marginTop: 4,
};

function EditField({
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
  keyboardType?: import("react-native").KeyboardTypeOptions;
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

function InfoRow({ icon, label, value, valueColor }: { icon: IoniconsName; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={18} color={C.brand} />
      </View>
      <View style={{ flex: 1, justifyContent: "center" }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, valueColor ? { color: valueColor, fontFamily: "Inter_700Bold" } : null]}>{value}</Text>
      </View>
    </View>
  );
}

const dpStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingBottom: 34,
    paddingTop: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  sheetTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    color: "#0F172A",
  },
  sheetClose: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 24,
  },
  spinnersRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 20,
    paddingHorizontal: 12,
  },
  spinnerCol: {
    alignItems: "center",
    minWidth: 44,
  },
  spinnerLabel: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    color: "#64748B",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  spinnerBtn: {
    padding: 6,
  },
  spinnerValueBox: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 44,
    alignItems: "center",
  },
  spinnerValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    color: "#0F172A",
  },
  spinnerSep: {
    width: 6,
  },
  colonSep: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    color: "#3B82F6",
    marginHorizontal: 2,
    marginTop: 18,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
  },
  previewText: {
    fontSize: 13,
    color: "#2563EB",
    fontFamily: "Inter_600SemiBold",
  },
  sheetActions: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  cancelBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    color: "#64748B",
  },
  confirmBtn: {
    flex: 1.5,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
  },
  confirmBtnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    color: "#FFFFFF",
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  center: { alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 16, fontFamily: "Inter_400Regular", color: C.textSecondary },
  nav: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 16, paddingVertical: 12,
  },
  navBack: { padding: 8 },
  navTitle: { flex: 1, textAlign: "center", fontSize: 17, fontFamily: "Inter_700Bold", color: C.text },
  navActions: { flexDirection: "row", alignItems: "center", gap: 2 },
  navEditBtn: { padding: 8 },
  navDeleteBtn: { padding: 8 },
  hero: { alignItems: "center", paddingVertical: 20, gap: 10 },
  heroAvatar: { width: 88, height: 88, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  heroAvatarText: { fontSize: 36, fontFamily: "Inter_700Bold" },
  heroName: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text },
  heroBadgeRow: { flexDirection: "row", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "center" },
  statusBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
  },
  statusText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  priorityBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  priorityDot: { width: 6, height: 6, borderRadius: 3 },
  priorityText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  heroActions: { flexDirection: "row", gap: 16, marginTop: 8 },
  heroAction: {
    width: 48, height: 48, borderRadius: 16, backgroundColor: "#E2E8F0" + "60",
    alignItems: "center", justifyContent: "center",
  },
  tabs: { flexDirection: "row", paddingHorizontal: 20, gap: 6, marginTop: 12, marginBottom: 12 },
  tab: {
    paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12,
    backgroundColor: "#F1F5F9", alignItems: "center",
  },
  tabActive: { backgroundColor: C.brand },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold", color: C.textSecondary },
  tabTextActive: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" },
  infoRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "#F1F5F9",
  },
  infoIconWrap: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.brand + "10", alignItems: "center", justifyContent: "center" },
  infoLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#64748B" },
  infoValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginTop: 2 },
  notesCard: { backgroundColor: C.card, borderRadius: 16, padding: 16, gap: 6, borderWidth: 1, borderColor: "#F1F5F9" },
  notesLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  notesText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 22 },
  dateRow: { flexDirection: "row", justifyContent: "space-between" },
  dateText: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  locationIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.brand + "10",
    alignItems: "center",
    justifyContent: "center",
  },
  locationContent: { flex: 1 },
  locationLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: "#64748B" },
  locationAddress: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginTop: 2 },
  locationCoords: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  addActionBtn: {
    flexDirection: "row", alignItems: "center", gap: 8, height: 46,
    backgroundColor: C.brand + "12", borderRadius: 12, paddingHorizontal: 16,
    borderWidth: 1, borderColor: C.brand + "30",
  },
  addActionText: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.brand },
  emptyState: { paddingVertical: 40, alignItems: "center", gap: 10 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  meetingCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "#F1F5F9",
  },
  meetingLeft: {},
  meetingDateBadge: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: C.brand + "15",
    alignItems: "center", justifyContent: "center",
  },
  meetingDay: { fontSize: 16, fontFamily: "Inter_700Bold", color: C.brand },
  meetingMonth: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.brand },
  meetingInfo: { flex: 1 },
  meetingTime: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  meetingNotes: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  docCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: C.card, borderRadius: 16, padding: 14,
    borderWidth: 1, borderColor: "#F1F5F9",
  },
  docName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  docDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 20, paddingHorizontal: 20, gap: 4,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", color: C.text, marginBottom: 12 },
  sheetOption: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 12, borderRadius: 12,
  },
  sheetDot: { width: 8, height: 8, borderRadius: 4 },
  sheetOptionText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium", color: C.text },
  modal: { flex: 1, backgroundColor: C.background, padding: 20, gap: 16 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: {
    backgroundColor: C.surfaceSecondary, borderRadius: 12,
    paddingHorizontal: 14, height: 48,
    fontSize: 15, fontFamily: "Inter_400Regular", color: C.text,
  },
  chipGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border,
  },
  chipActive: { backgroundColor: C.brand, borderColor: C.brand },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  chipTextActive: { color: "#FFFFFF" },
  priorityRow: { flexDirection: "row", gap: 10 },
  priorityChip: {
    flex: 1, height: 42, borderRadius: 12, borderWidth: 1.5, borderColor: C.border,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: C.card,
  },
  priorityDotSmall: { width: 7, height: 7, borderRadius: 4 },
  priorityChipText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  statusOption: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surfaceSecondary,
  },
  statusOptionText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  // Timeline
  timeline: { gap: 0 },
  timelineItem: { flexDirection: "row", gap: 14 },
  timelineLeft: { alignItems: "center", width: 36 },
  timelineDot: {
    width: 36, height: 36, borderRadius: 10, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  timelineLine: { flex: 1, width: 2, backgroundColor: C.border, marginVertical: 4 },
  timelineContent: { flex: 1, paddingBottom: 20, gap: 4 },
  timelineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  timelineTypeBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  timelineTypeText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  timelineDesc: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 22 },
  timelineMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  modeRow: { flexDirection: "row", gap: 10 },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: 42, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surfaceSecondary,
  },
  modeBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  modeBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary },
  modeBtnTextActive: { color: "#fff" },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 80, borderRadius: 16,
    borderWidth: 1.5, borderStyle: "dashed", borderColor: C.brand,
    backgroundColor: C.brand + "08",
  },
  uploadBtnDone: { borderColor: C.success, backgroundColor: C.success + "08", borderStyle: "solid" },
  uploadBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.brand },
  inlineSpinnersContainer: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 12,
    marginVertical: 10,
  },
});
