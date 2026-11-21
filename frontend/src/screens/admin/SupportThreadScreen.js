import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';
import SupportConversation from '../../components/SupportConversation';

// One rider/driver's customer care conversation, seen by an admin acting
// as a support agent. Opening it marks the user's messages as read.
export default function SupportThreadScreen({ route, navigation }) {
  const { userId, name } = route.params;
  const [thread, setThread] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/support/threads/${userId}`);
      setThread(data.user);
      setMessages(data.messages);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [userId]);

  useEffect(() => {
    load();
    const socket = getSocket();
    function onMessage(msg) {
      if (String(msg.user) !== String(userId)) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      // Viewing the thread counts as reading it.
      if (msg.from === 'user') client.get(`/support/threads/${userId}`).catch(() => {});
    }
    socket?.on('support:message', onMessage);
    return () => socket?.off('support:message', onMessage);
  }, [load, userId]);

  async function send(text) {
    setError('');
    try {
      const { data } = await client.post(`/support/threads/${userId}`, { text });
      setMessages((prev) => (prev.some((m) => m.id === data.message.id) ? prev : [...prev, data.message]));
    } catch (err) {
      setError(getErrorMessage(err));
      throw err;
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Inbox</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{thread?.name || name}</Text>
          {thread ? (
            <Text style={styles.subtitle}>
              <Text style={styles.role}>{thread.role}</Text> · @{thread.username}
            </Text>
          ) : null}
        </View>
      </View>
      {!thread && !error ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <SupportConversation
          messages={messages}
          viewer="agent"
          onSend={send}
          error={error}
          emptyText="No messages in this conversation."
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
  role: { textTransform: 'capitalize' },
});
