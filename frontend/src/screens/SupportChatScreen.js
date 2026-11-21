import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import client from '../api/client';
import { getSocket } from '../api/socket';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';
import SupportConversation from '../components/SupportConversation';

const QUICK_REPLIES = ['Safe drop-off hotspots', 'Cancel a ride', 'I lost an item', 'GPS not working', 'Talk to an agent'];

// Customer care for riders and drivers: an AI assistant (Claude, on the
// backend) answers instantly and hands off to a human support agent when
// needed; agent replies arrive live over the support:message socket event.
export default function SupportChatScreen({ navigation }) {
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);

  useEffect(() => {
    let cancelled = false;
    client
      .get('/support/messages')
      .then(({ data }) => {
        if (cancelled) return;
        setMessages(data.messages);
        setAiEnabled(data.ai !== false);
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)))
      .finally(() => !cancelled && setIsLoading(false));

    const socket = getSocket();
    function onMessage(msg) {
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    }
    socket?.on('support:message', onMessage);
    return () => {
      cancelled = true;
      socket?.off('support:message', onMessage);
    };
  }, []);

  async function send(text) {
    setError('');
    // Show the user's message straight away; the AI reply can take a few
    // seconds. Swapped for the saved copy when the server responds.
    const temp = { id: `pending-${Date.now()}`, from: 'user', text, createdAt: new Date().toISOString() };
    setMessages((prev) => [...prev, temp]);
    try {
      const { data } = await client.post('/support/messages', { text });
      setMessages((prev) => {
        const rest = prev.filter((m) => m.id !== temp.id);
        return [...rest, ...data.messages.filter((m) => !rest.some((p) => p.id === m.id))];
      });
    } catch (err) {
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      setError(getErrorMessage(err));
      throw err;
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Customer care</Text>
          <Text style={styles.subtitle}>
            {aiEnabled ? 'Chat with our AI assistant · a person steps in when needed' : 'Instant answers · a person replies to anything else'}
          </Text>
        </View>
      </View>
      <View style={styles.emergency}>
        <Text style={styles.emergencyText}>In danger? Call 112 right away.</Text>
      </View>
      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <SupportConversation
          messages={messages}
          viewer="user"
          onSend={send}
          quickReplies={QUICK_REPLIES}
          error={error}
          botLabel={aiEnabled ? '🤖 VeriPool AI' : '🤖 VeriPool bot'}
          emptyText="Hi! How can we help? Ask anything about your rides, or pick a topic below."
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
  emergency: { backgroundColor: colors.danger + '15', paddingVertical: 8, paddingHorizontal: 16 },
  emergencyText: { color: colors.danger, fontSize: 12, fontWeight: '700', textAlign: 'center' },
});
