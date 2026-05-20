import React from "react";
import { ScrollView, View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Colors from "@/constants/colors";

const C = Colors.light;

const UPDATED_ON = "28 Apr 2026";

export default function PrivacyPolicyScreen() {
  const insets = useSafeAreaInsets();
  const topPad = insets.top + (Platform.OS === "web" ? 67 : 0);
  const bottomPad = insets.bottom + 24;

  return (
    <ScrollView
      style={[styles.container, { paddingTop: topPad }]}
      contentContainerStyle={{ paddingBottom: bottomPad }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Privacy Policy</Text>
        <Text style={styles.updated}>Last updated: {UPDATED_ON}</Text>

        <Section
          heading="1. Who we are"
          body="Neelgund Developers (the “Company”, “we”, “our”, or “us”) provides this app to manage employee attendance, lead tracking, field location trails, and company documents."
        />

        <Section
          heading="2. Information we collect"
          body="We may collect account details (name, email, role), profile details (phone, department, designation), attendance records (check-in/check-out timestamps and coordinates), lead information entered by authorized users, uploaded documents, and app usage metadata required for security and reliability."
        />

        <Section
          heading="3. Location data"
          body="If location permission is granted, the app can collect foreground and background location data for attendance verification and field tracking features. Location collection is tied to your authenticated account and can be stopped by revoking permission in device settings."
        />

        <Section
          heading="4. Why we use your data"
          body="We use data to provide core app functions, maintain security and access control, support internal reporting, troubleshoot issues, and comply with legal obligations."
        />

        <Section
          heading="5. Sharing of data"
          body="We do not sell personal data. Data is processed and stored using our service providers (including cloud backend infrastructure) strictly to operate the app and related business workflows."
        />

        <Section
          heading="6. Data retention"
          body="Data is retained as long as needed for operational, contractual, or legal purposes. We may delete or anonymize records when they are no longer required."
        />

        <Section
          heading="7. Security"
          body="We implement reasonable technical and organizational safeguards to protect data. No method of transmission or storage is 100% secure, so absolute security cannot be guaranteed."
        />

        <Section
          heading="8. Your choices"
          body="You may request updates or deletion of your profile data through your organization administrator, subject to applicable legal and operational constraints."
        />

        <Section
          heading="9. Children’s privacy"
          body="This app is intended for workplace/business use and is not directed to children."
        />

        <Section
          heading="10. Contact"
          body="For privacy questions or requests, contact: support@neelgunddevelopers.com"
        />
      </View>
    </ScrollView>
  );
}

function Section({ heading, body }: { heading: string; body: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionHeading}>{heading}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  content: { paddingHorizontal: 20, gap: 14 },
  title: { fontSize: 30, fontFamily: "Inter_700Bold", color: C.text, marginTop: 6 },
  updated: { fontSize: 12, fontFamily: "Inter_400Regular", color: C.textSecondary, marginBottom: 4 },
  section: { gap: 6 },
  sectionHeading: { fontSize: 16, fontFamily: "Inter_600SemiBold", color: C.text },
  sectionBody: { fontSize: 14, fontFamily: "Inter_400Regular", color: C.textSecondary, lineHeight: 22 },
});
