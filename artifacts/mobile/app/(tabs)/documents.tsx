import React, { useState } from "react";
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
  Linking,
  KeyboardAvoidingView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
type IoniconsName = ComponentProps<typeof Ionicons>["name"];
import * as Haptics from "expo-haptics";
import Colors from "@/constants/colors";
import { useAuth } from "@/context/AuthContext";
import {
  listCompanyDocuments,
  createCompanyDocument,
  updateCompanyDocument,
  deleteCompanyDocument,
} from "@/lib/api";
import type { CompanyDocument } from "@/lib/types";
import { UploadFileError, pickAndUploadFile, resolveDocURL } from "@/utils/uploadFile";

const C = Colors.light;

type DocMode = "upload" | "link";

function docIcon(mimeType?: string): IoniconsName {
  if (!mimeType) return "document-outline";
  if (mimeType.includes("pdf")) return "document-text-outline";
  if (mimeType.includes("image")) return "image-outline";
  if (mimeType.includes("sheet") || mimeType.includes("excel")) return "grid-outline";
  if (mimeType.includes("word")) return "document-outline";
  return "document-outline";
}

function docColor(mimeType?: string) {
  if (!mimeType) return C.textSecondary;
  if (mimeType.includes("pdf")) return C.danger;
  if (mimeType.includes("image")) return "#8B5CF6";
  if (mimeType.includes("sheet")) return C.success;
  if (mimeType.includes("word")) return C.brand;
  return C.textSecondary;
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [editingDoc, setEditingDoc] = useState<CompanyDocument | null>(null);
  const [docMode, setDocMode] = useState<DocMode>("upload");
  const [form, setForm] = useState({ name: "", url: "", mimeType: "", category: "" });
  const [isUploading, setIsUploading] = useState(false);
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + (Platform.OS === "web" ? 34 : 0) + 90;

  const { data, isLoading, refetch, isFetching } = useQuery<CompanyDocument[]>({
    queryKey: ["company-documents"],
    queryFn: listCompanyDocuments,
    staleTime: 5 * 60_000,
  });

  const addMutation = useMutation({
    mutationFn: async (doc: { name: string; url: string; mimeType?: string; category?: string }) => {
      await createCompanyDocument(doc);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-documents"] });
      setShowAdd(false);
      setForm({ name: "", url: "", mimeType: "", category: "" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to save document"),
  });

  const editMutation = useMutation({
    mutationFn: async ({ id, doc }: { id: number; doc: { name: string; url: string; mimeType?: string; category?: string } }) => {
      await updateCompanyDocument(id, doc);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-documents"] });
      setEditingDoc(null);
      setForm({ name: "", url: "", mimeType: "", category: "" });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: () => Alert.alert("Error", "Failed to update document"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await deleteCompanyDocument(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-documents"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
    onError: (err: Error) => Alert.alert("Delete Failed", err.message || "Could not delete document"),
  });

  const docs = data ?? [];

  const handlePickFile = async () => {
    try {
      setIsUploading(true);
      const uploaded = await pickAndUploadFile("");
      if (!uploaded) return;
      setForm(f => ({
        ...f,
        name: f.name || uploaded.name,
        url: uploaded.objectPath,
        mimeType: uploaded.mimeType,
      }));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      if (e instanceof UploadFileError && e.code === "file_too_large") {
        Alert.alert("File Too Large", e.message);
      } else {
        const message = e instanceof Error ? e.message : "Could not upload the file. Please try again.";
        Alert.alert("Upload Failed", message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      Alert.alert("Required", "Document name is required");
      return;
    }
    if (!form.url.trim()) {
      Alert.alert("Required", docMode === "upload" ? "Please pick a file to upload first" : "URL is required");
      return;
    }
    const payload = {
      name: form.name,
      url: form.url,
      mimeType: form.mimeType || undefined,
      category: form.category || undefined,
    };
    if (editingDoc) {
      editMutation.mutate({ id: editingDoc.id, doc: payload });
    } else {
      addMutation.mutate(payload);
    }
  };

  const openEdit = (doc: CompanyDocument) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingDoc(doc);
    setDocMode("link");
    setForm({ name: doc.name, url: doc.url, mimeType: doc.mimeType ?? "", category: doc.category ?? "" });
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditingDoc(null);
    setForm({ name: "", url: "", mimeType: "", category: "" });
    setDocMode("upload");
  };

  const openDoc = (doc: CompanyDocument) => {
    Haptics.selectionAsync();
    const url = resolveDocURL(doc.url, "");
    if (Platform.OS === "web") {
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      if (!opened) window.location.href = url;
      return;
    }
    void Linking.openURL(url);
  };

  const confirmAndDelete = (id: number) => {
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Delete this document?");
      if (confirmed) deleteMutation.mutate(id);
      return;
    }
    Alert.alert("Delete Document", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteMutation.mutate(id) },
    ]);
  };

  const isSaving = addMutation.isPending || editMutation.isPending || isUploading;
  const fileUploaded = docMode === "upload" && !!form.url;

  return (
    <View style={[styles.container, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Documents</Text>
        {isAdmin && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAdd(true);
            }}
          >
            <Ionicons name="add" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator size="large" color={C.brand} />
        </View>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 12, gap: 10, paddingBottom: bottomPad }}
          showsVerticalScrollIndicator={false}
          initialNumToRender={Platform.OS === "web" ? 20 : 10}
          maxToRenderPerBatch={Platform.OS === "web" ? 15 : 8}
          windowSize={Platform.OS === "web" ? 10 : 7}
          removeClippedSubviews={Platform.OS !== "web"}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refetch} tintColor={C.brand} />}
          renderItem={({ item }) => {
            const color = docColor(item.mimeType);
            const isStoredFile = !item.url.startsWith("http://") && !item.url.startsWith("https://");
            return (
              <View style={styles.docCard}>
                <TouchableOpacity
                  style={styles.docOpenArea}
                  onPress={() => openDoc(item)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.docIcon, { backgroundColor: color + "18" }]}>
                    <Ionicons name={docIcon(item.mimeType)} size={24} color={color} />
                  </View>
                  <View style={styles.docInfo}>
                    <Text style={styles.docName} numberOfLines={2}>{item.name}</Text>
                    <View style={styles.docMeta}>
                      {item.category && <Text style={styles.docCategory}>{item.category}</Text>}
                      {isStoredFile && (
                        <View style={styles.uploadedBadge}>
                          <Ionicons name="cloud-done-outline" size={10} color={C.success} />
                          <Text style={styles.uploadedBadgeText}>Uploaded</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.docDate}>
                      {new Date(item.updatedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                    </Text>
                  </View>
                  <Ionicons name="open-outline" size={16} color={C.textSecondary} />
                </TouchableOpacity>
                {isAdmin && (
                  <View style={styles.docActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(item)}>
                      <Ionicons name="pencil-outline" size={18} color={C.brand} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => confirmAndDelete(item.id)}
                    >
                      <Ionicons name="trash-outline" size={18} color={C.danger} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="folder-open-outline" size={48} color={C.border} />
              <Text style={styles.emptyTitle}>No documents yet</Text>
              {isAdmin && <Text style={styles.emptySubtitle}>Upload files or add links for your team</Text>}
            </View>
          }
        />
      )}

      <Modal visible={showAdd || editingDoc !== null} animationType="slide" presentationStyle="formSheet" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} enabled={Platform.OS !== "web"} style={{ flex: 1 }}>
          <View style={[styles.modal, { paddingTop: Platform.OS === "web" ? 67 : 20 }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeModal}>
                <Ionicons name="close" size={24} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.modalTitle}>{editingDoc ? "Edit Document" : "Add Document"}</Text>
              <TouchableOpacity onPress={handleSave} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color={C.brand} /> : <Ionicons name="checkmark" size={24} color={C.brand} />}
              </TouchableOpacity>
            </View>

          {!editingDoc && (
            <View style={styles.modeRow}>
              {(["upload", "link"] as DocMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeBtn, docMode === mode && styles.modeBtnActive]}
                  onPress={() => {
                    setDocMode(mode);
                    setForm(f => ({ ...f, url: "", mimeType: "" }));
                  }}
                >
                  <Ionicons
                    name={mode === "upload" ? "cloud-upload-outline" : "link-outline"}
                    size={16}
                    color={docMode === mode ? "#fff" : C.textSecondary}
                  />
                  <Text style={[styles.modeBtnText, docMode === mode && styles.modeBtnTextActive]}>
                    {mode === "upload" ? "Upload File" : "Add Link"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Document Name *</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Q1 Sales Report"
              placeholderTextColor={C.placeholder}
              value={form.name}
              onChangeText={v => setForm(f => ({ ...f, name: v }))}
            />
          </View>

          {docMode === "upload" && !editingDoc ? (
            <View style={styles.uploadSection}>
              <TouchableOpacity
                style={[styles.uploadBtn, fileUploaded && styles.uploadBtnDone]}
                onPress={handlePickFile}
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <ActivityIndicator color={fileUploaded ? C.success : C.brand} size="small" />
                    <Text style={styles.uploadBtnText}>Uploading…</Text>
                  </>
                ) : fileUploaded ? (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color={C.success} />
                    <Text style={[styles.uploadBtnText, { color: C.success }]}>File uploaded — tap to replace</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color={C.brand} />
                    <Text style={styles.uploadBtnText}>Pick a file to upload</Text>
                  </>
                )}
              </TouchableOpacity>
              {fileUploaded && (
                <Text style={styles.uploadedName} numberOfLines={1}>{form.name}</Text>
              )}
            </View>
          ) : (
            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>URL *</Text>
              <TextInput
                style={styles.fieldInput}
                placeholder="https://..."
                placeholderTextColor={C.placeholder}
                value={form.url}
                onChangeText={v => setForm(f => ({ ...f, url: v }))}
                autoCapitalize="none"
              />
            </View>
          )}

          <View style={styles.formField}>
            <Text style={styles.fieldLabel}>Category</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="e.g. Finance, HR, Marketing"
              placeholderTextColor={C.placeholder}
              value={form.category}
              onChangeText={v => setForm(f => ({ ...f, category: v }))}
            />
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
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
    paddingBottom: 12,
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", color: C.text },
  addBtn: {
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: C.brand, alignItems: "center", justifyContent: "center",
  },
  loadingState: { flex: 1, alignItems: "center", justifyContent: "center" },
  docCard: {
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  docOpenArea: { flexDirection: "row", alignItems: "center", gap: 12 },
  docIcon: { width: 48, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  docInfo: { flex: 1, gap: 3 },
  docName: { fontSize: 14, fontFamily: "Inter_600SemiBold", color: C.text },
  docMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  docCategory: { fontSize: 11, fontFamily: "Inter_500Medium", color: C.brand },
  uploadedBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    backgroundColor: C.success + "15", borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2,
  },
  uploadedBadgeText: { fontSize: 10, fontFamily: "Inter_500Medium", color: C.success },
  docDate: { fontSize: 11, fontFamily: "Inter_400Regular", color: C.textSecondary },
  docActions: { marginTop: 8, flexDirection: "row", justifyContent: "flex-end", gap: 4 },
  actionBtn: { padding: 6 },
  emptyState: { paddingTop: 80, alignItems: "center", gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: "Inter_600SemiBold", color: C.text },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary },
  modal: { flex: 1, backgroundColor: C.background, padding: 20, gap: 16 },
  modalHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4,
  },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold", color: C.text },
  modeRow: { flexDirection: "row", gap: 10, marginBottom: 4 },
  modeBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 6, height: 42, borderRadius: 12,
    borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surfaceSecondary,
  },
  modeBtnActive: { backgroundColor: C.brand, borderColor: C.brand },
  modeBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.textSecondary },
  modeBtnTextActive: { color: "#fff" },
  formField: { gap: 6 },
  fieldLabel: { fontSize: 13, fontFamily: "Inter_500Medium", color: C.textSecondary },
  fieldInput: {
    backgroundColor: C.surfaceSecondary,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    color: C.text,
  },
  uploadSection: { gap: 8 },
  uploadBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    height: 80, borderRadius: 16,
    borderWidth: 1.5, borderStyle: "dashed", borderColor: C.brand,
    backgroundColor: C.brand + "08",
  },
  uploadBtnDone: { borderColor: C.success, backgroundColor: C.success + "08", borderStyle: "solid" },
  uploadBtnText: { fontSize: 14, fontFamily: "Inter_500Medium", color: C.brand },
  uploadedName: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, textAlign: "center" },
});
