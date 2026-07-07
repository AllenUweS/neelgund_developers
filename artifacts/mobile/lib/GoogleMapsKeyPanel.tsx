/**
 * GoogleMapsKeyPanel.tsx
 *
 * Admin panel card for managing the Google Maps API key stored in Supabase.
 * Drop this into your super-admin or admin tab screen.
 *
 * Features:
 *  • Shows current key (masked) with a "reveal" toggle
 *  • Validates the key format before saving
 *  • Live-updates the in-app key cache after save
 *  • Beautiful confirmation flow with timestamp of last update
 *  • Shows who last updated the key (if profile data is available)
 */

import React, { useState, useCallback } from "react";
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Animated,
    Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Colors from "@/constants/colors";
import { listAppConfig, updateGoogleMapsKey } from "@/lib/api.appConfig";
import { refreshGoogleMapsKey } from "@/lib/googleMapsKey";
import { formatWhen } from "@/lib/utils";

const C = Colors.light;

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskKey(key: string): string {
    if (!key || key.length < 8) return key || "Not set";
    return key.slice(0, 8) + "••••••••••••••••" + key.slice(-4);
}

/** Basic Google Maps API key validation (starts with AIzaSy, ~39 chars) */
function isValidGoogleKey(key: string): boolean {
    return /^AIzaSy[A-Za-z0-9_-]{33}$/.test(key.trim());
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function GoogleMapsKeyPanel() {
    const queryClient = useQueryClient();

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState("");
    const [revealed, setRevealed] = useState(false);
    const [saved, setSaved] = useState(false);

    // Load config from DB
    const { data: configs, isLoading } = useQuery({
        queryKey: ["app_config"],
        queryFn: listAppConfig,
    });

    const row = configs?.find((r) => r.key === "google_maps_api_key");
    const currentKey = row?.value ?? "";
    const lastUpdated = row?.updated_at
        ? formatWhen(row.updated_at)
        : "Never updated";

    // Save mutation
    const mutation = useMutation({
        mutationFn: async (newKey: string) => {
            await updateGoogleMapsKey(newKey);
            // Bust the in-app memory + local cache so the new key is used immediately
            await refreshGoogleMapsKey();
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["app_config"] });
            setEditing(false);
            setDraft("");
            setSaved(true);
            setTimeout(() => setSaved(false), 4000);
        },
        onError: (err: unknown) => {
            const message =
                err instanceof Error ? err.message : "Unknown error occurred";
            Alert.alert("Save Failed", message);
        },
    });

    const handleSave = useCallback(() => {
        const trimmed = draft.trim();

        if (!trimmed) {
            Alert.alert("Empty Key", "Please paste your Google Maps API key.");
            return;
        }

        if (!isValidGoogleKey(trimmed)) {
            Alert.alert(
                "Invalid Key Format",
                "Google Maps API keys start with 'AIzaSy' and are 39 characters long. Double-check the key you copied from Google Cloud Console.",
                [
                    { text: "Cancel", style: "cancel" },
                    {
                        text: "Save Anyway",
                        style: "destructive",
                        onPress: () => confirmSave(trimmed),
                    },
                ]
            );
            return;
        }

        confirmSave(trimmed);
    }, [draft]);

    const confirmSave = (key: string) => {
        const preview = key.slice(0, 8) + "…" + key.slice(-4);
        Alert.alert(
            "Confirm API Key Update",
            `You're about to replace the Google Maps API key used by all app users.\n\nNew key: ${preview}\n\nThis takes effect immediately — no APK rebuild needed.`,
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: "Save & Apply",
                    style: "default",
                    onPress: () => mutation.mutate(key),
                },
            ]
        );
    };

    const handleCancel = () => {
        setEditing(false);
        setDraft("");
    };

    // ── Render ────────────────────────────────────────────────────────────────

    return (
        <View style={styles.card}>
            {/* Header */}
            <View style={styles.cardHeader}>
                <View style={styles.iconWrap}>
                    <Ionicons name="map" size={20} color={C.brand} />
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Google Maps API Key</Text>
                    <Text style={styles.cardSubtitle}>
                        Controls maps, geocoding, directions & road-snapping
                    </Text>
                </View>
                {/* Status badge */}
                <View
                    style={[
                        styles.badge,
                        { backgroundColor: currentKey ? C.success + "20" : C.danger + "20" },
                    ]}
                >
                    <View
                        style={[
                            styles.dot,
                            { backgroundColor: currentKey ? C.success : C.danger },
                        ]}
                    />
                    <Text
                        style={[
                            styles.badgeText,
                            { color: currentKey ? C.success : C.danger },
                        ]}
                    >
                        {currentKey ? "Active" : "Missing"}
                    </Text>
                </View>
            </View>

            {/* Current key display */}
            {!editing && (
                <View style={styles.currentKeyRow}>
                    <View style={styles.keyValueWrap}>
                        {isLoading ? (
                            <ActivityIndicator size="small" color={C.brand} />
                        ) : (
                            <Text style={styles.keyValue} numberOfLines={1}>
                                {revealed ? currentKey || "Not set" : maskKey(currentKey)}
                            </Text>
                        )}
                        <Text style={styles.lastUpdated}>Last updated: {lastUpdated}</Text>
                    </View>
                    <TouchableOpacity
                        style={styles.revealBtn}
                        onPress={() => setRevealed((v) => !v)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                        <Ionicons
                            name={revealed ? "eye-off-outline" : "eye-outline"}
                            size={18}
                            color={C.textSecondary}
                        />
                    </TouchableOpacity>
                </View>
            )}

            {/* Success banner */}
            {saved && (
                <View style={styles.successBanner}>
                    <Ionicons name="checkmark-circle" size={18} color={C.success} />
                    <Text style={styles.successText}>
                        Key updated and applied — no rebuild needed!
                    </Text>
                </View>
            )}

            {/* Edit form */}
            {editing ? (
                <View style={styles.editBlock}>
                    <Text style={styles.editLabel}>Paste new API key</Text>
                    <TextInput
                        style={styles.textInput}
                        value={draft}
                        onChangeText={setDraft}
                        placeholder="AIzaSy…"
                        placeholderTextColor={C.placeholder}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry={false}
                        multiline={false}
                        editable={!mutation.isPending}
                    />
                    {draft.length > 0 && !isValidGoogleKey(draft) && (
                        <Text style={styles.validationHint}>
                            ⚠️ Key doesn't match expected format (AIzaSy… 39 chars)
                        </Text>
                    )}
                    <Text style={styles.hint}>
                        Find your key at{" "}
                        <Text style={styles.hintLink}>
                            console.cloud.google.com → APIs & Services → Credentials
                        </Text>
                    </Text>

                    <View style={styles.editActions}>
                        <TouchableOpacity
                            style={[styles.btn, styles.btnSecondary]}
                            onPress={handleCancel}
                            disabled={mutation.isPending}
                        >
                            <Text style={styles.btnSecondaryText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.btn,
                                styles.btnPrimary,
                                mutation.isPending && styles.btnDisabled,
                            ]}
                            onPress={handleSave}
                            disabled={mutation.isPending}
                        >
                            {mutation.isPending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <>
                                    <Ionicons name="save-outline" size={16} color="#fff" />
                                    <Text style={styles.btnPrimaryText}>Save & Apply</Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </View>
            ) : (
                <TouchableOpacity
                    style={styles.editTrigger}
                    onPress={() => {
                        setDraft("");
                        setEditing(true);
                    }}
                >
                    <Ionicons name="pencil-outline" size={16} color={C.brand} />
                    <Text style={styles.editTriggerText}>Update API Key</Text>
                </TouchableOpacity>
            )}

            {/* Info footer */}
            <View style={styles.infoFooter}>
                <Ionicons
                    name="information-circle-outline"
                    size={14}
                    color={C.textSecondary}
                />
                <Text style={styles.infoText}>
                    The key is fetched from the database at app startup. Rotating the key
                    here instantly affects all users — no APK rebuild required.
                </Text>
            </View>
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    card: {
        backgroundColor: C.card,
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: C.border,
        ...Platform.select({
            ios: {
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.06,
                shadowRadius: 8,
            },
            android: { elevation: 2 },
        }),
    },
    cardHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginBottom: 16,
    },
    iconWrap: {
        width: 40,
        height: 40,
        borderRadius: 12,
        backgroundColor: C.brand + "15",
        alignItems: "center",
        justifyContent: "center",
    },
    cardTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: C.text,
        marginBottom: 2,
    },
    cardSubtitle: {
        fontSize: 12,
        color: C.textSecondary,
    },
    badge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 20,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 4,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: "600",
    },
    currentKeyRow: {
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: C.surfaceSecondary,
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
        gap: 8,
    },
    keyValueWrap: { flex: 1 },
    keyValue: {
        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
        fontSize: 13,
        color: C.text,
        letterSpacing: 0.5,
    },
    lastUpdated: {
        fontSize: 11,
        color: C.textSecondary,
        marginTop: 4,
    },
    revealBtn: {
        padding: 4,
    },
    successBanner: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: C.success + "15",
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
    },
    successText: {
        fontSize: 13,
        color: C.success,
        fontWeight: "600",
        flex: 1,
    },
    editBlock: {
        backgroundColor: C.surfaceSecondary,
        borderRadius: 12,
        padding: 14,
        marginBottom: 14,
    },
    editLabel: {
        fontSize: 13,
        fontWeight: "600",
        color: C.text,
        marginBottom: 8,
    },
    textInput: {
        backgroundColor: C.card,
        borderWidth: 1.5,
        borderColor: C.brand,
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 11,
        fontSize: 13,
        color: C.text,
        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
        marginBottom: 8,
    },
    validationHint: {
        fontSize: 12,
        color: C.warning,
        marginBottom: 6,
    },
    hint: {
        fontSize: 12,
        color: C.textSecondary,
        marginBottom: 14,
        lineHeight: 18,
    },
    hintLink: {
        color: C.brand,
        fontWeight: "500",
    },
    editActions: {
        flexDirection: "row",
        gap: 10,
    },
    btn: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 11,
        borderRadius: 10,
        gap: 6,
    },
    btnPrimary: {
        backgroundColor: C.brand,
    },
    btnSecondary: {
        backgroundColor: C.border,
    },
    btnDisabled: {
        opacity: 0.6,
    },
    btnPrimaryText: {
        color: "#fff",
        fontWeight: "700",
        fontSize: 14,
    },
    btnSecondaryText: {
        color: C.text,
        fontWeight: "600",
        fontSize: 14,
    },
    editTrigger: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        alignSelf: "flex-start",
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        backgroundColor: C.brand + "12",
        marginBottom: 14,
    },
    editTriggerText: {
        color: C.brand,
        fontWeight: "600",
        fontSize: 14,
    },
    infoFooter: {
        flexDirection: "row",
        gap: 6,
        alignItems: "flex-start",
    },
    infoText: {
        fontSize: 12,
        color: C.textSecondary,
        flex: 1,
        lineHeight: 17,
    },
});