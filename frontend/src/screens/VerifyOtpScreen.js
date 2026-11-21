import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';

// The automated Sec. II-B.1.b "Validation Process": a 6-digit code was
// just emailed (see backend/src/services/mailer.js). Verifying it either
// logs the user straight in (App.js re-renders once AuthContext's user is
// set) or, for a driver whose automated license check couldn't confirm
// something, routes to the Pending screen with the reason shown.
export default function VerifyOtpScreen({ route, navigation }) {
  const { identifier, email } = route.params;
  const { verifyOtp, resendOtp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResending, setIsResending] = useState(false);

  async function handleVerify() {
    setError('');
    setNotice('');
    if (code.trim().length !== 6) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setIsSubmitting(true);
    try {
      const data = await verifyOtp(identifier, code.trim());
      if (!data.token) {
        navigation.replace('Pending', { message: data.message, reason: data.flaggedReason });
      }
      // else: AuthContext now has `user` set — App.js swaps to the right stack.
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setNotice('');
    setIsResending(true);
    try {
      await resendOtp(identifier);
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsResending(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.icon}>✉️</Text>
      <Text style={styles.title}>Check your email</Text>
      <Text style={styles.body}>
        We sent a 6-digit code to{email ? ` ${email}` : ' your inbox'}. Enter it below to verify your account.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="000000"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        maxLength={6}
        value={code}
        onChangeText={setCode}
        textAlign="center"
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      <Pressable style={[styles.button, isSubmitting && styles.buttonDisabled]} onPress={handleVerify} disabled={isSubmitting}>
        {isSubmitting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>Verify</Text>}
      </Pressable>

      <Pressable onPress={handleResend} disabled={isResending}>
        <Text style={styles.link}>{isResending ? 'Sending…' : "Didn't get it? Resend code"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  icon: { fontSize: 40, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, textAlign: 'center' },
  body: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: 10, marginBottom: 24, lineHeight: 20, maxWidth: 320 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 14,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 8,
    color: colors.text,
    backgroundColor: colors.surface,
    width: 220,
  },
  error: { color: colors.danger, marginTop: 14, fontSize: 13, textAlign: 'center' },
  notice: { color: colors.primary, marginTop: 14, fontSize: 13, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 48, marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  link: { textAlign: 'center', marginTop: 20, color: colors.textMuted, fontSize: 13 },
});
