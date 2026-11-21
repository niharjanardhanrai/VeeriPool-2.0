import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';

export default function LoginScreen({ navigation }) {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError('');
    if (!identifier.trim() || !password) {
      setError('Please enter your username and password.');
      return;
    }
    setIsSubmitting(true);
    try {
      await login(identifier.trim(), password);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.brand}>VeriPool 2.o</Text>
        <Text style={styles.subtitle}>Campus ride requesting &amp; real-time tracking</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Log in</Text>

          <Text style={styles.label}>Username or email</Text>
          <TextInput
            style={styles.input}
            placeholder="first.last"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            value={identifier}
            onChangeText={setIdentifier}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={[styles.button, isSubmitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>Log in</Text>}
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Register')}>
            <Text style={styles.link}>
              New here? <Text style={styles.linkStrong}>Create an account</Text>
            </Text>
          </Pressable>
        </View>

        <Text style={styles.footnote}>Demo admin: admin.veripool / admin12345</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { fontSize: 32, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  subtitle: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: 32 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 24, borderWidth: 1, borderColor: colors.border },
  title: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.background,
  },
  error: { color: colors.danger, marginTop: 14, fontSize: 13 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  link: { textAlign: 'center', marginTop: 18, color: colors.textMuted, fontSize: 13 },
  linkStrong: { color: colors.primary, fontWeight: '700' },
  footnote: { textAlign: 'center', marginTop: 18, color: colors.textMuted, fontSize: 11 },
});
