import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// Reached only by a driver whose automated license check (Sec.
// II-B.1.b) couldn't confidently pass or fail — held for a human admin,
// not decided automatically either way. Everyone else (riders, and
// drivers who clearly pass) is logged in immediately after OTP.
export default function PendingScreen({ route, navigation }) {
  const { message, reason } = route.params || {};

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>🔍</Text>
      <Text style={styles.title}>Under review</Text>
      <Text style={styles.body}>{message || 'A quick human check is needed before you can log in.'}</Text>
      {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      <Text style={styles.footnote}>You'll be able to log in once an admin has looked this over.</Text>
      <Pressable style={styles.button} onPress={() => navigation.replace('Login')}>
        <Text style={styles.buttonText}>Back to log in</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 48, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  body: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 12, lineHeight: 20 },
  reason: {
    fontSize: 13,
    color: colors.text,
    textAlign: 'center',
    marginTop: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    maxWidth: 340,
  },
  footnote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 16 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, marginTop: 32 },
  buttonText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
});
