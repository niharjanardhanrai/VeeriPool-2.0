import { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { colors } from '../theme/colors';

// Shared message list + composer for customer care — used by the rider/
// driver's own chat (viewer="user") and the admin's thread view
// (viewer="agent"). Messages come from the user, the FAQ bot, or an agent.
const SENDER_LABEL = { bot: '🤖 VeriPool AI', agent: '🎧 Support' };

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function SupportConversation({ messages, viewer, onSend, quickReplies = [], emptyText, error, botLabel }) {
  const [text, setText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const showTyping = isSending && viewer === 'user';
  const listRef = useRef(null);

  async function send(value) {
    const trimmed = (value ?? text).trim();
    if (!trimmed || isSending) return;
    setIsSending(true);
    try {
      await onSend(trimmed);
      if (value === undefined) setText('');
    } finally {
      setIsSending(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => String(item.id)}
        style={styles.flex}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        ListFooterComponent={showTyping ? <Text style={styles.typing}>{(botLabel || SENDER_LABEL.bot) + ' is typing…'}</Text> : null}
        renderItem={({ item }) => {
          // The viewer's own side of the conversation sits on the right.
          const mine = viewer === 'user' ? item.from === 'user' : item.from === 'agent';
          const label =
            item.from === 'agent' && item.agentName
              ? `🎧 ${item.agentName} · Support`
              : item.from === 'bot' && botLabel
                ? botLabel
                : SENDER_LABEL[item.from];
          return (
            <View style={[styles.row, mine && styles.rowMine]}>
              <View
                style={[
                  styles.bubble,
                  mine ? styles.bubbleMine : item.from === 'bot' ? styles.bubbleBot : styles.bubbleTheirs,
                ]}
              >
                {!mine && label ? <Text style={styles.sender}>{label}</Text> : null}
                <Text style={[styles.text, mine && styles.textMine]}>{item.text}</Text>
                <Text style={[styles.time, mine && styles.timeMine]}>{formatTime(item.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />

      {quickReplies.length > 0 ? (
        <View style={styles.quickRow}>
          {quickReplies.map((q) => (
            <Pressable key={q} style={styles.quick} onPress={() => send(q)} disabled={isSending}>
              <Text style={styles.quickText}>{q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Type your message"
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => send()}
          returnKeyType="send"
          maxLength={1000}
        />
        <Pressable style={[styles.sendButton, isSending && { opacity: 0.6 }]} onPress={() => send()} disabled={isSending}>
          {isSending ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.sendText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  empty: { textAlign: 'center', color: colors.textMuted, fontSize: 13, marginTop: 40, paddingHorizontal: 24 },
  row: { flexDirection: 'row' },
  rowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: colors.primary },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleBot: { backgroundColor: '#EAF2FB', borderWidth: 1, borderColor: '#CFE0F3' },
  sender: { fontSize: 11, fontWeight: '700', color: colors.info, marginBottom: 3 },
  text: { fontSize: 14, color: colors.text, lineHeight: 19 },
  textMine: { color: colors.surface },
  time: { fontSize: 10, color: colors.textMuted, marginTop: 4, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.75)' },
  typing: { fontSize: 12, color: colors.textMuted, fontStyle: 'italic', marginTop: 4 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingTop: 8 },
  quick: { borderWidth: 1, borderColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface },
  quickText: { color: colors.primary, fontSize: 12, fontWeight: '600' },
  error: { color: colors.danger, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
  inputRow: { flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, marginTop: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.background,
  },
  sendButton: { backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center', minWidth: 70, alignItems: 'center' },
  sendText: { color: colors.surface, fontWeight: '700', fontSize: 14 },
});
