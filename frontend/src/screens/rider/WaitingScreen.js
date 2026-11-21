import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';

// Sec. II-B.2.d "Request process — From User and Car POV": "he gets
// navigated to a waiting page until the request is accepted". Listens on
// the ride:accepted socket event (pushed the instant a driver accepts) and
// falls back to polling in case the socket connection drops.
export default function WaitingScreen({ route, navigation }) {
  const { rideId } = route.params;
  const [ride, setRide] = useState(null);
  const [error, setError] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRide() {
      try {
        const { data } = await client.get(`/rides/${rideId}`);
        if (cancelled) return;
        setRide(data.ride);
        if (data.ride.status === 'accepted') {
          navigation.replace('Tracking', { rideId });
        } else if (data.ride.status === 'rejected' || data.ride.status === 'cancelled') {
          setError(data.ride.status === 'rejected' ? 'No driver was able to accept this request.' : 'This request was cancelled.');
        }
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      }
    }

    fetchRide();
    pollRef.current = setInterval(fetchRide, 3000);

    const socket = getSocket();
    function onAccepted(payload) {
      if (String(payload.id) === String(rideId)) {
        navigation.replace('Tracking', { rideId });
      }
    }
    socket?.on('ride:accepted', onAccepted);

    return () => {
      cancelled = true;
      clearInterval(pollRef.current);
      socket?.off('ride:accepted', onAccepted);
    };
  }, [rideId, navigation]);

  async function cancel() {
    setIsCancelling(true);
    try {
      await client.post(`/rides/${rideId}/cancel`);
      navigation.replace('RiderHome');
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  }

  const terminal = ride?.status === 'rejected' || ride?.status === 'cancelled';

  return (
    <View style={styles.container}>
      {!terminal ? <ActivityIndicator size="large" color={colors.primary} /> : null}
      <Text style={styles.title}>{terminal ? 'Request closed' : 'Waiting for a driver to accept…'}</Text>
      {ride ? (
        <Text style={styles.meta}>
          {ride.pickup.address} → {ride.dropoff.address} · {ride.seatsRequested} seat(s)
        </Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {terminal ? (
        <Pressable style={styles.button} onPress={() => navigation.replace('RiderHome')}>
          <Text style={styles.buttonText}>Back to dashboard</Text>
        </Pressable>
      ) : (
        <Pressable style={[styles.button, styles.cancelButton]} onPress={cancel} disabled={isCancelling}>
          {isCancelling ? <ActivityIndicator color={colors.danger} /> : <Text style={styles.cancelText}>Cancel request</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: 8 },
  meta: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  error: { fontSize: 13, color: colors.danger, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, marginTop: 24 },
  buttonText: { color: colors.surface, fontWeight: '700', fontSize: 15 },
  cancelButton: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  cancelText: { color: colors.danger, fontWeight: '700', fontSize: 15 },
});
