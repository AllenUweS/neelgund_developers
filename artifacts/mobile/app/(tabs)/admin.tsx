import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Platform,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import DateTimePicker from "@react-native-community/datetimepicker";
import { router } from "expo-router";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import { listUsers, listManagers, createUser, updateUser, deleteUser, resetUserPassword, type AppRole, type AppUser } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";

const C = Colors.light;

const ALL_ROLES: AppRole[] = ["super_admin", "hr", "manager", "employee", "transport"];

type User = AppUser;

type FormState = {
  name: string;
  email: string;
  password: string;
  role: AppRole;
  phone: string;
  department: string;
  designation: string;
  joiningDate: string;
  profileNotes: string;
  managerId: string | null;
};

const BLANK_FORM: FormState = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  phone: "",
  department: "",
  designation: "",
  joiningDate: "",
  profileNotes: "",
  managerId: null,
};

function roleNeedsManager(role: AppRole): boolean {
  return role === "employee" || role === "transport";
}

const roleColors: Record<AppRole, string> = {
  admin: C.danger,
  super_admin: "#7C3AED",
  hr: "#EC4899",
  manager: "#8B5CF6",
  employee: C.brand,
  transport: "#F59E0B",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function roleSummaryLabel(role: AppRole): string {
  if (role === "transport") return "Transport";
  if (role === "super_admin") return "Super Admins";
  if (role === "hr") return "HR";
  return role.charAt(0).toUpperCase() + role.slice(1) + "s";
}

function rolePickerLabel(role: AppRole): string {
  if (role === "super_admin") return "Super Admin";
  if (role === "hr") return "HR";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function AdminScreen() {
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isGlobalAdmin = user?.role === "admin" || user?.role === "super_admin";
  const manageableRoles: AppRole[] = isGlobalAdmin
    ? ALL_ROLES
    : ["manager", "employee"];

  const [modalMode, setModalMode] = useState<"add" | "edit" | null>(null);
  const [profileUser, setProfileUser] = useState<User | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [managerPickerOpen, setManagerPickerOpen] = useState(false);

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90;

  const { data, isLoading, refetch, isFetching } = useQuery<User[]>({
    queryKey: ["users"],
    queryFn: async () => (await listUsers()) as User[],
    staleTime: 2 * 60_000,
  });

  const managersQuery = useQuery<AppUser[]>({
    queryKey: ["managers"],
    queryFn: () => listManagers(),
    staleTime: 5 * 60_000,
  });
  const managers = managersQuery.data ?? [];
  const managerNameById = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const mgr of managers) m.set(mgr.id, mgr.name);
    return m;
  }, [managers]);

  const addMutation = useMutation({
    mutationFn: async (user: FormState) => {
      await createUser({
        name: user.name,
        email: user.email,
        password: user.password,
        role: user.role,
        phone: user.phone || null,
        department: user.department || null,
        designation: user.designation || null,
        joiningDate: user.joiningDate || null,
        profileNotes: user.profileNotes || null,
        managerId: roleNeedsManager(user.role) ? user.managerId : null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["managers"] });
      closeModal();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, data: payload }: { id: string; data: Partial<FormState> }) => {
      if (payload.password && payload.password.trim()) {
        await resetUserPassword(id, payload.password.trim());
      }
      await updateUser(id, {
        ...payload,
        joiningDate: payload.joiningDate,
        profileNotes: payload.profileNotes,
        managerId: payload.managerId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["managers"] });
      closeModal();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => Alert.alert("Error", err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await deleteUser(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["managers"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => {
      Alert.alert("Delete Failed", err.message || "Unable to delete user");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    },
  });

  const openAdd = () => {
    setEditingUser(null);
    setForm(BLANK_FORM);
    setModalMode("add");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      phone: user.phone ?? "",
      department: user.department ?? "",
      designation: user.designation ?? "",
      joiningDate: user.joiningDate ?? "",
      profileNotes: user.profileNotes ?? "",
      managerId: user.managerId ?? null,
    });
    setModalMode("edit");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const closeModal = () => {
    setModalMode(null);
    setEditingUser(null);
    setForm(BLANK_FORM);
    setShowDatePicker(false);
    setManagerPickerOpen(false);
  };

  const handleSave = () => {
    if (modalMode === "add") {
      if (!form.name.trim() || !form.email.trim() || !form.password.trim()) {
        Alert.alert("Required", "Name, email and password are required");
        return;
      }
      if (!EMAIL_REGEX.test(form.email.trim())) {
        Alert.alert("Invalid Email", "Please enter a valid email address");
        return;
      }
      if (form.password.trim().length < 8) {
        Alert.alert("Weak Password", "Password must be at least 8 characters");
        return;
      }
      addMutation.mutate({
        ...form,
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password.trim(),
      });
    } else if (modalMode === "edit" && editingUser) {
      if (!form.name.trim() || !form.email.trim()) {
        Alert.alert("Required", "Name and email are required");
        return;
      }
      if (!EMAIL_REGEX.test(form.email.trim())) {
        Alert.alert("Invalid Email", "Please enter a valid email address");
        return;
      }
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password.trim() || undefined,
        role: form.role,
        phone: form.phone.trim() || null,
        department: form.department.trim() || null,
        designation: form.designation.trim() || null,
        joiningDate: form.joiningDate.trim() || null,
        profileNotes: form.profileNotes.trim() || null,
        managerId: roleNeedsManager(form.role) ? form.managerId : null,
      };
      editMutation.mutate({ id: editingUser.id, data: payload as Partial<FormState> });
    }
  };

  const isPending = addMutation.isPending || editMutation.isPending;
  const users = React.useMemo(
    () => (data ?? []).filter((u) => manageableRoles.includes(u.role)),
    [data, manageableRoles],
  );
  const debouncedSearch = useDebounce(searchQuery.trim().toLowerCase(), 300);
  const filteredUsers = React.useMemo(
    () =>
      users.filter((u) => {
        const roleMatch = roleFilter === "all" || u.role === roleFilter;
        if (!roleMatch) return false;
        if (!debouncedSearch) return true;
        const searchable = `${u.name} ${u.email} ${u.department ?? ""} ${u.designation ?? ""} ${u.managerName ?? ""}`.toLowerCase();
        return searchable.includes(debouncedSearch);
      }),
    [users, roleFilter, debouncedSearch],
  );

  const joiningDateValue = form.joiningDate ? new Date(form.joiningDate + "T00:00:00") : new Date();

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>HR & Admin</Text>
          <Text style={styles.subtitle}>Manage team members, roles and reporting lines</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="person-add" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.toolbar}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={C.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search team members"
            placeholderTextColor={C.placeholder}
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          <RoleFilterChip label="All" active={roleFilter === "all"} onPress={() => setRoleFilter("all")} />
          {manageableRoles.map((role) => (
            <RoleFilterChip
              key={role}
              label={rolePickerLabel(role)}
              active={roleFilter === role}
              onPress={() => setRoleFilter(role)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.summaryRow}>
        {manageableRoles.map(role => (
          <View key={role} style={styles.summaryCard}>
            <Text style={[styles.summaryCount, { color: roleColors[role] }]}>
              {users.filter(u => u.role === role).length}
            </Text>
            <Text style={styles.summaryLabel}>{roleSummaryLabel(role)}</Text>
          </View>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loadingState}><ActivityIndicator size="large" color={C.brand} /></View>
      ) : (
        <FlatList
          data={filteredUsers}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 10, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={Platform.OS === "web" ? 20 : 12}
          maxToRenderPerBatch={Platform.OS === "web" ? 15 : 8}
          windowSize={Platform.OS === "web" ? 10 : 5}
          removeClippedSubviews={Platform.OS !== "web"}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={C.brand} />}
          renderItem={({ item }) => {
            const color = roleColors[item.role];
            return (
              <TouchableOpacity
                style={styles.userCard}
                onPress={() => {
                  setProfileUser(item);
                  Haptics.selectionAsync();
                }}
                activeOpacity={0.85}
              >
                <View style={[styles.userAvatar, { backgroundColor: color + "18" }]}>
                  <Text style={[styles.userAvatarText, { color }]}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.userInfo}>
                  <Text style={styles.userName} numberOfLines={1}>{item.name}</Text>
                  <Text style={styles.userEmail} numberOfLines={1}>{item.email}</Text>
                  {(item.designation || item.department) ? (
                    <Text style={styles.userMeta} numberOfLines={1}>
                      {[item.designation, item.department].filter(Boolean).join(" · ")}
                    </Text>
                  ) : null}
                  {roleNeedsManager(item.role) ? (
                    <Text style={styles.userMeta} numberOfLines={1}>
                      {item.managerName ? `Reports to · ${item.managerName}` : "No manager"}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.roleBadge, { backgroundColor: color + "18" }]}>
                  <Text style={[styles.roleText, { color }]}>{item.role}</Text>
                </View>
                <TouchableOpacity onPress={() => openEdit(item)} style={styles.iconBtn} hitSlop={8}>
                  <Ionicons name="pencil-outline" size={17} color={C.brand} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert("Remove User", `Remove ${item.name}?`, [
                      { text: "Cancel", style: "cancel" },
                      { text: "Remove", style: "destructive", onPress: () => deleteMutation.mutate(item.id) },
                    ]);
                  }}
                  style={styles.iconBtn}
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={17} color={C.danger} />
                </TouchableOpacity>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={28} color={C.textSecondary} />
              <Text style={styles.emptyTitle}>No matching team members</Text>
              <Text style={styles.emptySubtitle}>
                Try another role filter or clear search text.
              </Text>
            </View>
          }
        />
      )}

      {/* Employee Profile Sheet (read-only) */}
      <Modal
        visible={profileUser !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setProfileUser(null)}
      >
        {profileUser && (
          <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : Math.max(insets.top + 16, 30) }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setProfileUser(null)}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Employee Profile</Text>
              <TouchableOpacity
                onPress={() => {
                  setProfileUser(null);
                  openEdit(profileUser);
                }}
              >
                <Ionicons name="pencil-outline" size={22} color={C.brand} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 0, paddingBottom: 40 }}>
              {/* Profile Hero */}
              <View style={styles.profileHero}>
                <View style={[styles.profileAvatar, { backgroundColor: roleColors[profileUser.role] + "20" }]}>
                  <Text style={[styles.profileAvatarText, { color: roleColors[profileUser.role] }]}>
                    {profileUser.name.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.profileName}>{profileUser.name}</Text>
                {profileUser.designation ? (
                  <Text style={styles.profileDesignation}>{profileUser.designation}</Text>
                ) : null}
                <View style={[styles.rolePill, { backgroundColor: roleColors[profileUser.role] + "18" }]}>
                  <Text style={[styles.rolePillText, { color: roleColors[profileUser.role] }]}>
                    {profileUser.role.toUpperCase()}
                  </Text>
                </View>
              </View>

              {/* Info Rows */}
              <View style={styles.profileSection}>
                <Text style={styles.profileSectionTitle}>Contact</Text>
                <ProfileRow icon="mail-outline" label="Email" value={profileUser.email} />
                <ProfileRow icon="call-outline" label="Phone" value={profileUser.phone ?? "—"} />
              </View>

              <View style={styles.profileSection}>
                <Text style={styles.profileSectionTitle}>Work</Text>
                <ProfileRow icon="business-outline" label="Department" value={profileUser.department ?? "—"} />
                <ProfileRow icon="briefcase-outline" label="Designation" value={profileUser.designation ?? "—"} />
                <ProfileRow icon="calendar-outline" label="Joining Date" value={formatDisplayDate(profileUser.joiningDate ?? "")} />
                {roleNeedsManager(profileUser.role) ? (
                  <ProfileRow
                    icon="people-outline"
                    label="Reports To"
                    value={profileUser.managerName ?? "—"}
                  />
                ) : null}
              </View>

              {profileUser.profileNotes ? (
                <View style={styles.profileSection}>
                  <Text style={styles.profileSectionTitle}>Notes</Text>
                  <View style={styles.notesCard}>
                    <Text style={styles.notesText}>{profileUser.profileNotes}</Text>
                  </View>
                </View>
              ) : null}

              {(user?.role === "super_admin" || user?.role === "admin") ? (
                <View style={styles.profileActionsRow}>
                  <TouchableOpacity style={styles.quickLinkBtn} onPress={() => {
                    setProfileUser(null);
                    router.push("/(tabs)/tracking-status");
                  }}>
                    <Ionicons name="pulse-outline" size={15} color={C.brand} />
                    <Text style={styles.quickLinkText}>Tracking Status</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickLinkBtn} onPress={() => {
                    setProfileUser(null);
                    router.push("/(tabs)/super-admin");
                  }}>
                    <Ionicons name="shield-checkmark-outline" size={15} color={C.brand} />
                    <Text style={styles.quickLinkText}>Super Admin</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
            </ScrollView>
          </View>
        )}
      </Modal>

      {/* Add / Edit Modal */}
      <Modal
        visible={modalMode !== null}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={closeModal}
      >
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : Math.max(insets.top + 16, 30) }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeModal}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>
              {modalMode === "add" ? "Add Team Member" : "Edit Team Member"}
            </Text>
            <TouchableOpacity onPress={handleSave} disabled={isPending}>
              <Ionicons name="checkmark" size={24} color={isPending ? C.placeholder : C.brand} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <SectionHeader title="Account Info" />

            <ModalField label="Full Name *" value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="John Doe" autoCapitalize="words" />
            <ModalField label="Email *" value={form.email} onChange={v => setForm(f => ({ ...f, email: v }))} placeholder="john@company.com" autoCapitalize="none" keyboardType="email-address" />
            <ModalField
              label={modalMode === "edit" ? "Password (optional reset)" : "Password *"}
              value={form.password}
              onChange={v => setForm(f => ({ ...f, password: v }))}
              placeholder={modalMode === "edit" ? "Leave blank to keep unchanged" : "Min 8 characters"}
              autoCapitalize="none"
              secureTextEntry
            />

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Role *</Text>
              <View style={styles.roleSelector}>
                {manageableRoles.map(role => (
                  <TouchableOpacity
                    key={role}
                    style={[
                      styles.roleOption,
                      form.role === role && { backgroundColor: roleColors[role], borderColor: roleColors[role] },
                    ]}
                    onPress={() => setForm(f => ({
                      ...f,
                      role,
                      managerId: roleNeedsManager(role) ? f.managerId : null,
                    }))}
                  >
                    <Text style={[styles.roleOptionText, form.role === role && styles.roleOptionTextActive]}>
                      {rolePickerLabel(role)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {roleNeedsManager(form.role) ? (
              <View style={styles.formField}>
                <Text style={styles.fieldLabel}>Reports To *</Text>
                <TouchableOpacity
                  style={[styles.fieldInput, styles.datePickerTrigger]}
                  onPress={() => setManagerPickerOpen(true)}
                >
                  <Ionicons
                    name="people-outline"
                    size={18}
                    color={form.managerId ? C.text : C.placeholder}
                  />
                  <Text
                    style={{
                      fontSize: 15,
                      fontFamily: "Inter_400Regular",
                      color: form.managerId ? C.text : C.placeholder,
                      flex: 1,
                    }}
                    numberOfLines={1}
                  >
                    {form.managerId
                      ? managerNameById.get(form.managerId) ?? "Unknown manager"
                      : managers.length === 0
                      ? "No managers exist yet"
                      : "Select a manager"}
                  </Text>
                  {form.managerId ? (
                    <TouchableOpacity
                      onPress={() => setForm(f => ({ ...f, managerId: null }))}
                      hitSlop={8}
                    >
                      <Ionicons name="close-circle" size={18} color={C.textSecondary} />
                    </TouchableOpacity>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={C.textSecondary} />
                  )}
                </TouchableOpacity>
              </View>
            ) : null}

            <SectionHeader title="Profile Details" />

            <ModalField label="Phone" value={form.phone} onChange={v => setForm(f => ({ ...f, phone: v }))} placeholder="+91 98765 43210" keyboardType="phone-pad" />
            <ModalField label="Designation" value={form.designation} onChange={v => setForm(f => ({ ...f, designation: v }))} placeholder="e.g. Sales Executive" autoCapitalize="words" />
            <ModalField label="Department" value={form.department} onChange={v => setForm(f => ({ ...f, department: v }))} placeholder="e.g. Sales, Operations" autoCapitalize="words" />

            {/* Joining Date Picker */}
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>Joining Date</Text>
              {Platform.OS === "web" ? (
                <View style={[styles.fieldInput, styles.datePickerTrigger, { position: "relative", overflow: "hidden" }]}>
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={form.joiningDate ? C.text : C.placeholder}
                  />
                  <Text
                    style={{
                      fontSize: 15,
                      fontFamily: "Inter_400Regular",
                      color: form.joiningDate ? C.text : C.placeholder,
                    }}
                  >
                    {form.joiningDate ? formatDisplayDate(form.joiningDate) : "Select date"}
                  </Text>
                  <input
                    type="date"
                    max={localDateStr(new Date())}
                    value={form.joiningDate || ""}
                    onChange={(e) => setForm(f => ({ ...f, joiningDate: e.target.value || "" }))}
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
                    style={[styles.fieldInput, styles.datePickerTrigger]}
                    onPress={() => setShowDatePicker(true)}
                  >
                    <Ionicons name="calendar-outline" size={18} color={form.joiningDate ? C.text : C.placeholder} />
                    <Text style={{ fontSize: 15, fontFamily: "Inter_400Regular", color: form.joiningDate ? C.text : C.placeholder }}>
                      {form.joiningDate ? formatDisplayDate(form.joiningDate) : "Select date"}
                    </Text>
                  </TouchableOpacity>
                  {showDatePicker && (
                    <DateTimePicker
                      mode="date"
                      value={joiningDateValue}
                      maximumDate={new Date()}
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_evt, date) => {
                        setShowDatePicker(Platform.OS === "ios");
                        if (date) {
                          const iso = date.toISOString().split("T")[0];
                          setForm(f => ({ ...f, joiningDate: iso }));
                        }
                      }}
                    />
                  )}
                </>
              )}
            </View>

            <ModalField
              label="Profile Notes"
              value={form.profileNotes}
              onChange={v => setForm(f => ({ ...f, profileNotes: v }))}
              placeholder="Any notes about this employee..."
              multiline
              numberOfLines={3}
            />

            {isPending && <ActivityIndicator color={C.brand} />}
          </ScrollView>
        </View>
      </Modal>

      {/* Manager Picker Modal */}
      <Modal
        visible={managerPickerOpen}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setManagerPickerOpen(false)}
      >
        <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : Math.max(insets.top + 16, 30) }]}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setManagerPickerOpen(false)}>
              <Ionicons name="close" size={24} color={C.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Select Manager</Text>
            <View style={{ width: 24 }} />
          </View>

          {managersQuery.isLoading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={C.brand} />
            </View>
          ) : managers.length === 0 ? (
            <View style={[styles.loadingState, { paddingHorizontal: 24 }]}>
              <Ionicons name="people-outline" size={42} color={C.placeholder} />
              <Text style={{ marginTop: 12, color: C.textSecondary, textAlign: "center", fontFamily: "Inter_400Regular" }}>
                No managers exist yet. Create a user with role &quot;Manager&quot; first.
              </Text>
            </View>
          ) : (
            <FlatList
              data={managers}
              keyExtractor={m => m.id}
              contentContainerStyle={{ gap: 10, paddingBottom: 40 }}
              renderItem={({ item }) => {
                const active = form.managerId === item.id;
                return (
                  <TouchableOpacity
                    style={[
                      styles.userCard,
                      active && { borderWidth: 1.5, borderColor: C.brand },
                    ]}
                    onPress={() => {
                      setForm(f => ({ ...f, managerId: item.id }));
                      setManagerPickerOpen(false);
                      Haptics.selectionAsync();
                    }}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.userAvatar, { backgroundColor: roleColors.manager + "18" }]}>
                      <Text style={[styles.userAvatarText, { color: roleColors.manager }]}>
                        {item.name.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.userInfo}>
                      <Text style={styles.userName}>{item.name}</Text>
                      <Text style={styles.userEmail}>{item.email}</Text>
                    </View>
                    {active ? (
                      <Ionicons name="checkmark-circle" size={22} color={C.brand} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

function ProfileRow({ icon, label, value }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; value: string }) {
  return (
    <View style={styles.profileRow}>
      <View style={styles.profileRowIcon}>
        <Ionicons name={icon} size={16} color={C.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.profileRowLabel}>{label}</Text>
        <Text style={styles.profileRowValue}>{value}</Text>
      </View>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={sectionHeaderStyle}>{title}</Text>;
}

function RoleFilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const sectionHeaderStyle: import("react-native").TextStyle = {
  fontSize: 12,
  fontFamily: "Inter_600SemiBold",
  color: C.textSecondary,
  textTransform: "uppercase",
  letterSpacing: 0.8,
  marginTop: 4,
};

function ModalField({
  label,
  value,
  onChange,
  placeholder,
  autoCapitalize,
  keyboardType,
  secureTextEntry,
  multiline,
  numberOfLines,
  editable,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  keyboardType?: import("react-native").KeyboardTypeOptions;
  secureTextEntry?: boolean;
  multiline?: boolean;
  numberOfLines?: number;
  editable?: boolean;
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
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        numberOfLines={numberOfLines}
        editable={editable}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  addBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.brand, alignItems: "center", justifyContent: "center",
  },
  toolbar: { paddingHorizontal: 20, gap: 10, marginBottom: 8 },
  searchBox: {
    height: 44,
    borderRadius: 12,
    backgroundColor: C.surfaceSecondary,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  filterRow: { gap: 8, paddingRight: 8 },
  filterChip: {
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.card,
  },
  filterChipActive: { backgroundColor: C.brand, borderColor: C.brand },
  filterChipText: { fontSize: 12, fontFamily: "Inter_500Medium", color: C.textSecondary },
  filterChipTextActive: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 10, marginBottom: 8 },
  summaryCard: {
    width: "31%", minWidth: 90,
    backgroundColor: C.card, borderRadius: 16, padding: 12, alignItems: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  summaryCount: { fontSize: 22, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.textSecondary, marginTop: 2 },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  userCard: {
    flexDirection: "row", alignItems: "center", backgroundColor: C.card, borderRadius: 16, padding: 14, gap: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1,
  },
  userAvatar: { width: 44, height: 44, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  userAvatarText: { fontSize: 17, fontFamily: "Inter_700Bold" },
  userInfo: { flex: 1 },
  userName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  userEmail: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 2 },
  userMeta: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary, marginTop: 1 },
  roleBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  roleText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  iconBtn: { padding: 5 },
  emptyState: { alignItems: "center", gap: 4, paddingVertical: 42, paddingHorizontal: 16 },
  emptyTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text, marginTop: 8 },
  emptySubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },

  modal: { flex: 1, backgroundColor: C.background, paddingHorizontal: 20, paddingBottom: 20 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },

  profileHero: { alignItems: "center", paddingVertical: 24, gap: 8 },
  profileAvatar: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  profileAvatarText: { fontSize: 32, fontFamily: "Inter_700Bold" },
  profileName: { fontSize: 22, fontFamily: "Inter_700Bold", color: C.text, marginTop: 4 },
  profileDesignation: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  rolePill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20 },
  rolePillText: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 1 },

  profileSection: { paddingHorizontal: 4, marginBottom: 12 },
  profileSectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: C.textSecondary, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 },
  profileRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  profileRowIcon: { width: 32, height: 32, backgroundColor: C.surfaceSecondary, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  profileRowLabel: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  profileRowValue: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.text, marginTop: 2 },
  notesCard: { backgroundColor: C.surfaceSecondary, borderRadius: 12, padding: 14 },
  notesText: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.text, lineHeight: 20 },
  profileActionsRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  quickLinkBtn: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.brand + "44",
    backgroundColor: C.brand + "10",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  quickLinkText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: C.brand },

  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: {
    backgroundColor: C.surfaceSecondary, borderRadius: 12, paddingHorizontal: 14, height: 48,
    fontSize: 15, fontFamily: "Inter_400Regular", color: C.text,
  },
  datePickerTrigger: { flexDirection: "row", alignItems: "center", gap: 10 },
  roleSelector: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  roleOption: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: "22%",
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surfaceSecondary,
  },
  roleOptionText: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  roleOptionTextActive: { color: "#FFFFFF", fontFamily: "Inter_600SemiBold" },
});
