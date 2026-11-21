import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator, Image } from 'react-native';
import client, { API_BASE_URL } from '../../api/client';
import { getErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';

const FILE_BASE = API_BASE_URL.replace(/\/api$/, '');

function CheckPill({ label, passed }) {
  return (
    <View style={[pillStyles.pill, passed ? pillStyles.pass : pillStyles.fail]}>
      <Text style={pillStyles.text}>{passed ? '✓' : '✕'} {label}</Text>
    </View>
  );
}

const pillStyles = StyleSheet.create({
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  pass: { backgroundColor: '#e3f3e9' },
  fail: { backgroundColor: colors.danger + '22' },
  text: { fontSize: 11, fontWeight: '700', color: colors.text },
});

// Sec. II-B.1.b "Validation Process": riders and clearly-verified drivers
// never reach this screen — they're auto-approved the moment their OTP is
// confirmed (see backend/src/controllers/authController.js). Only a driver
// whose automated license check couldn't confidently pass or fail lands in
// the queue below, with the specific reason and the photo shown so the
// human decision is fast. "Recent activity" below it is a transparency log
// of everything the automation resolved on its own.
export default function AdminApprovalsScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [flagged, setFlagged] = useState([]);
  const [recent, setRecent] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [{ data: f }, { data: r }] = await Promise.all([
        client.get('/admin/flagged'),
        client.get('/admin/recent'),
      ]);
      setFlagged(f.users);
      setRecent(r.users);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(id, decision) {
    setBusyId(id);
    try {
      await client.post(`/admin/users/${id}/${decision}`);
      setFlagged((prev) => prev.filter((u) => u.id !== id));
      load();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Admin · {user?.firstName}</Text>
          <Text style={styles.subtitle}>Registration is automated — this queue is only what it couldn't resolve</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('SupportInbox')} style={styles.helpButton}>
            <Text style={styles.helpText}>🎧 Support inbox</Text>
          </Pressable>
          <Pressable onPress={logout}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={flagged}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListHeaderComponent={<Text style={styles.sectionTitle}>Needs review ({flagged.length})</Text>}
          ListEmptyComponent={<Text style={styles.empty}>Nothing waiting on you. 🎉</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardRow}>
                {item.license?.photoUrl ? (
                  <Image source={{ uri: `${FILE_BASE}${item.license.photoUrl}` }} style={styles.licenseImg} resizeMode="cover" />
                ) : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {item.firstName} {item.lastName} <Text style={styles.role}>({item.role})</Text>
                  </Text>
                  <Text style={styles.meta}>Username: {item.username}</Text>
                  <Text style={styles.meta}>University ID: {item.universityId}</Text>
                  <Text style={styles.meta}>{item.email} · {item.phone}</Text>
                  {item.vehicle?.seatsTotal ? (
                    <Text style={styles.meta}>Seats: {item.vehicle.seatsTotal} {item.vehicle.plate ? `· ${item.vehicle.plate}` : ''}</Text>
                  ) : null}
                </View>
              </View>

              {item.license?.checks ? (
                <View style={styles.pillRow}>
                  <CheckPill label="Photo readable" passed={item.license.checks.readable} />
                  <CheckPill label="Name matches" passed={item.license.checks.nameMatch} />
                  <CheckPill label="License # found" passed={item.license.checks.numberPlausible} />
                  <CheckPill label="Not expired" passed={item.license.checks.notExpired} />
                </View>
              ) : null}
              {item.license?.extractedNumber ? (
                <Text style={styles.ocr}>OCR read license #: {item.license.extractedNumber}</Text>
              ) : null}

              <View style={styles.actions}>
                <Pressable style={[styles.actionButton, styles.reject]} disabled={busyId === item.id} onPress={() => decide(item.id, 'reject')}>
                  <Text style={styles.rejectText}>Reject</Text>
                </Pressable>
                <Pressable style={[styles.actionButton, styles.accept]} disabled={busyId === item.id} onPress={() => decide(item.id, 'approve')}>
                  {busyId === item.id ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.actionText}>Accept</Text>}
                </Pressable>
              </View>
            </View>
          )}
          ListFooterComponent={
            <View style={{ marginTop: 8 }}>
              <Text style={styles.sectionTitle}>Recent activity (auto + manual)</Text>
              {recent.length === 0 ? (
                <Text style={styles.empty}>Nothing yet.</Text>
              ) : (
                recent.map((item) => (
                  <View key={item.id} style={styles.recentRow}>
                    <View style={[styles.statusDot, item.status === 'accepted' ? styles.statusAccepted : styles.statusRejected]} />
                    <Text style={styles.recentText}>
                      {item.firstName} {item.lastName} ({item.role}) — {item.status}
                      {item.role === 'rider'
                        ? ' · auto-approved on OTP'
                        : item.role === 'driver' && item.license?.checks
                        ? item.license.checks.readable && item.license.checks.nameMatch && item.license.checks.numberPlausible && item.license.checks.notExpired
                          ? ' · auto-approved by license check'
                          : ' · reviewed by admin'
                        : ''}
                    </Text>
                  </View>
                ))
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 48,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: { fontSize: 18, fontWeight: '800', color: colors.primary },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, maxWidth: 260 },
  logout: { color: colors.danger, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  helpButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  helpText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 10, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 12, marginBottom: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  cardRow: { flexDirection: 'row', gap: 12 },
  licenseImg: { width: 84, height: 84, borderRadius: 8, backgroundColor: colors.background },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  role: { fontWeight: '400', color: colors.textMuted, fontSize: 13 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ocr: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  accept: { backgroundColor: colors.primary },
  reject: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  actionText: { color: colors.surface, fontWeight: '700', fontSize: 13 },
  rejectText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 16 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusAccepted: { backgroundColor: colors.primary },
  statusRejected: { backgroundColor: colors.danger },
  recentText: { fontSize: 12, color: colors.textMuted, flex: 1 },
});
