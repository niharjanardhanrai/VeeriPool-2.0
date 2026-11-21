import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import client from '../api/client';
import { getSocket } from '../api/socket';
import { colors } from '../theme/colors';

// In-ride chat between the matched rider and driver — not from the paper,
// added on top of it. Loads history over REST, then stays live over the
// same ride:message socket event the rest of the tracking flow uses.
export default function ChatPanel({ rideId, currentUserId, otherPartyName }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    client.get(`/rides/${rideId}/messages`).then(({ data }) => {
      if (!cancelled) setMessages(data.messages);
    });

    const socket = getSocket();
    function onMessage(msg) {
      if (String(msg.ride) === String(rideId)) {
        setMessages((prev) => [...prev, msg]);
      }
    }
    socket?.on('ride:message', onMessage);

    return () => {
      cancelled = true;
      socket?.off('ride:message', onMessage);
    };
  }, [rideId]);

  async function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    const { data } = await client.post(`/rides/${rideId}/messages`, { text: trimmed });
    setMessages((prev) => [...prev, data.message]);
  }

  const unread = expanded ? 0 : messages.length;

  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.toggle} onPress={() => setExpanded((e) => !e)}>
        <Text style={styles.toggleText}>💬 Chat with {otherPartyName || 'the other side'}</Text>
        {!expanded && messages.length > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unread}</Text>
          </View>
        ) : null}
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            style={styles.list}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ListEmptyComponent={<Text style={styles.empty}>Say hello 👋</Text>}
            renderItem={({ item }) => {
              const mine = String(item.sender) === String(currentUserId);
              return (
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{item.text}</Text>
                  </View>
                </View>
              );
            }}
          />
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Type a message"
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              onSubmitEditing={send}
              returnKeyType="send"
            />
            <Pressable style={styles.sendButton} onPress={send}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  toggle: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 8 },
  toggleText: { flex: 1, fontWeight: '700', color: colors.text, fontSize: 14 },
  chevron: { color: colors.textMuted },
  badge: { backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 1 },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },
  list: { maxHeight: 220, paddingHorizontal: 12 },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 12, paddingVertical: 16 },
  bubbleRow: { flexDirection: 'row', marginVertical: 4 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '78%', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleTheirs: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleText: { fontSize: 13, color: colors.text },
  bubbleTextMine: { color: colors.surface },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: colors.text,
    backgroundColor: colors.background,
  },
  sendButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  sendText: { color: colors.surface, fontWeight: '700', fontSize: 13 },
});
