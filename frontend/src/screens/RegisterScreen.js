import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../context/AuthContext';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';

// Fields follow the paper's registration process (Sec. II-B.1.a): university
// ID, email, first/last name, phone, password — plus a role toggle since
// GO-DRiVeS treats "Cars (drivers)" and "Users" as separate stakeholders.
// Drivers additionally attach a license photo — see the automated check in
// backend/src/services/licenseCheck.js — and everyone verifies their email
// with a code on the next screen instead of going straight to an admin queue.
export default function RegisterScreen({ navigation }) {
  const { register } = useAuth();
  const [role, setRole] = useState('rider');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [universityId, setUniversityId] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [seatsTotal, setSeatsTotal] = useState('3');
  const [plate, setPlate] = useState('');
  const [licenseAsset, setLicenseAsset] = useState(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function pickLicense() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Photo library access is needed to attach your license.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLicenseAsset(result.assets[0]);
    }
  }

  async function handleSubmit() {
    setError('');

    if (!firstName.trim() || !lastName.trim() || !universityId.trim() || !email.trim() || !phone.trim() || !password) {
      setError('Please fill in every field.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (role === 'driver' && (!seatsTotal || Number(seatsTotal) < 1)) {
      setError('Please enter how many seats your car has.');
      return;
    }
    if (role === 'driver' && !licenseAsset) {
      setError('Please attach a photo of your driving license.');
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append('firstName', firstName.trim());
      formData.append('lastName', lastName.trim());
      formData.append('universityId', universityId.trim());
      formData.append('email', email.trim());
      formData.append('phone', phone.trim());
      formData.append('password', password);
      formData.append('role', role);
      if (role === 'driver') {
        formData.append('vehicleSeatsTotal', String(seatsTotal));
        formData.append('vehiclePlate', plate.trim());

        if (Platform.OS === 'web') {
          const resp = await fetch(licenseAsset.uri);
          const blob = await resp.blob();
          formData.append('license', new File([blob], licenseAsset.fileName || 'license.jpg', { type: blob.type || 'image/jpeg' }));
        } else {
          formData.append('license', {
            uri: licenseAsset.uri,
            name: licenseAsset.fileName || 'license.jpg',
            type: licenseAsset.mimeType || 'image/jpeg',
          });
        }
      }

      const data = await register(formData);
      navigation.replace('VerifyOtp', { identifier: data.user.username, email: data.user.email });
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
        <Text style={styles.subtitle}>Create your verified campus account</Text>

        <View style={styles.card}>
          <Text style={styles.title}>Sign up</Text>

          <View style={styles.roleRow}>
            {['rider', 'driver'].map((r) => (
              <Pressable key={r} style={[styles.roleButton, role === r && styles.roleButtonActive]} onPress={() => setRole(r)}>
                <Text style={[styles.roleButtonText, role === r && styles.roleButtonTextActive]}>
                  {r === 'rider' ? 'I need a ride' : 'I have a car'}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>First name</Text>
          <TextInput style={styles.input} placeholder="Priya" placeholderTextColor={colors.textMuted} value={firstName} onChangeText={setFirstName} />

          <Text style={styles.label}>Last name</Text>
          <TextInput style={styles.input} placeholder="Shah" placeholderTextColor={colors.textMuted} value={lastName} onChangeText={setLastName} />

          <Text style={styles.label}>University ID</Text>
          <TextInput
            style={styles.input}
            placeholder="NNM23CC030"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            value={universityId}
            onChangeText={setUniversityId}
          />

          <Text style={styles.label}>University email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@college.edu"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />

          <Text style={styles.label}>Phone number</Text>
          <TextInput
            style={styles.input}
            placeholder="9998887771"
            placeholderTextColor={colors.textMuted}
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
          />

          {role === 'driver' ? (
            <>
              <Text style={styles.label}>Car seats available</Text>
              <TextInput
                style={styles.input}
                placeholder="3"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                value={seatsTotal}
                onChangeText={setSeatsTotal}
              />
              <Text style={styles.label}>Plate number (optional)</Text>
              <TextInput style={styles.input} placeholder="KA20AB1234" placeholderTextColor={colors.textMuted} value={plate} onChangeText={setPlate} />

              <Text style={styles.label}>Driving license photo</Text>
              <Pressable style={styles.licensePicker} onPress={pickLicense}>
                {licenseAsset ? (
                  <Image source={{ uri: licenseAsset.uri }} style={styles.licensePreview} resizeMode="cover" />
                ) : (
                  <Text style={styles.licensePickerText}>Tap to attach a photo of your license</Text>
                )}
              </Pressable>
              <Text style={styles.licenseNote}>
                We auto-check this photo (name, license number, expiry) — no real government database is queried, so a
                human reviews anything the check can't confirm.
              </Text>
            </>
          ) : null}

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input}
            placeholder="Re-enter your password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable style={[styles.button, isSubmitting && styles.buttonDisabled]} onPress={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>Create account</Text>}
          </Pressable>

          <Pressable onPress={() => navigation.navigate('Login')}>
            <Text style={styles.link}>
              Already have an account? <Text style={styles.linkStrong}>Log in</Text>
            </Text>
          </Pressable>
        </View>
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
  roleRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  roleButtonActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  roleButtonText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  roleButtonTextActive: { color: colors.surface },
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
  licensePicker: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 10,
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  licensePickerText: { color: colors.textMuted, fontSize: 13, padding: 12, textAlign: 'center' },
  licensePreview: { width: '100%', height: 140 },
  licenseNote: { fontSize: 11, color: colors.textMuted, marginTop: 6, lineHeight: 15 },
  error: { color: colors.danger, marginTop: 14, fontSize: 13 },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 24 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  link: { textAlign: 'center', marginTop: 18, color: colors.textMuted, fontSize: 13 },
  linkStrong: { color: colors.primary, fontWeight: '700' },
});
