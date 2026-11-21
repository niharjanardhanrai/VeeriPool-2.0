import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';

function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(iso).toLocaleDateString();
}

// Admins act as customer care agents: every rider/driver who has written
// to support shows up here, newest first, with unread counts. Refreshes
// live on support:message.
export default function SupportInboxScreen({ navigation }) {
  const [threads, setThreads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await client.get('/support/threads');
      setThreads(data.threads);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket?.on('support:message', load);
    const unsub = navigation.addListener('focus', load);
    return () => {
      socket?.off('support:message', load);
      unsub();
    };
  }, [load, navigation]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Support inbox</Text>
          <Text style={styles.subtitle}>Reply to riders and drivers as customer care</Text>
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => String(item.userId)}
          contentContainerStyle={{ padding: 16, gap: 10 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          ListEmptyComponent={<Text style={styles.empty}>No support conversations yet.</Text>}
          renderItem={({ item }) => (
            <Pressable
              style={[styles.card, item.unread > 0 && styles.cardUnread, item.emergency && styles.cardEmergency]}
              onPress={() => navigation.navigate('SupportThread', { userId: item.userId, name: item.name })}
            >
              <View style={styles.cardTop}>
                <Text style={styles.name}>
                  {item.name} <Text style={styles.role}>· {item.role}</Text>
                </Text>
                <Text style={styles.time}>{timeAgo(item.lastAt)}</Text>
              </View>
              <View style={styles.tagRow}>
                {item.emergency ? <Text style={[styles.tag, styles.tagEmergency]}>🚨 Emergency</Text> : null}
                {item.needsAgent && !item.emergency ? <Text style={[styles.tag, styles.tagAgent]}>Needs agent</Text> : null}
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.preview} numberOfLines={1}>
                  {item.lastFrom === 'user' ? '' : item.lastFrom === 'bot' ? '🤖 ' : '🎧 You: '}
                  {item.lastText}
                </Text>
                {item.unread > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{item.unread}</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    paddingTop: 48,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontWeight: '700', fontSize: 15 },
  title: { fontSize: 18, fontWeight: '800', color: colors.primary },
  subtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 30 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  cardUnread: { borderColor: colors.accent, borderWidth: 2 },
  cardEmergency: { borderColor: colors.danger, borderWidth: 2 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontWeight: '700', color: colors.text, fontSize: 14 },
  role: { fontWeight: '400', color: colors.textMuted, fontSize: 12 },
  time: { fontSize: 11, color: colors.textMuted },
  tagRow: { flexDirection: 'row', gap: 6 },
  tag: { fontSize: 11, fontWeight: '800', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  tagEmergency: { backgroundColor: colors.danger, color: colors.surface },
  tagAgent: { backgroundColor: colors.accent, color: colors.primaryDark },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  preview: { flex: 1, color: colors.textMuted, fontSize: 13 },
  badge: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '800', color: colors.primaryDark },
});
