import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { STAGE_ORDER, STAGE_LABELS } from '../../utils/stages';
import MiniMap from '../../components/MiniMap';
import ChatPanel from '../../components/ChatPanel';
import SafetyPanel from '../../components/SafetyPanel';

// Sec. II-B.3.b "Tracking": the rider watches the driver's live GPS
// position move along the route, and gets pushed notifications as each
// stage changes ("driver-arrived", "ride-ended").
export default function TrackingScreen({ route, navigation }) {
  const { rideId } = route.params;
  const { user } = useAuth();
  const [ride, setRide] = useState(null);
  const [driverLocation, setDriverLocation] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchRide() {
      const { data } = await client.get(`/rides/${rideId}`);
      if (cancelled) return;
      setRide(data.ride);
      if (data.ride.driverLocation?.lat) setDriverLocation(data.ride.driverLocation);
    }
    fetchRide();

    const socket = getSocket();
    function onStage(payload) {
      if (String(payload.id) === String(rideId)) setRide(payload);
    }
    function onLocation(payload) {
      if (String(payload.rideId) === String(rideId)) setDriverLocation({ lat: payload.lat, lng: payload.lng });
    }
    socket?.on('ride:stage', onStage);
    socket?.on('ride:driver-arrived', onStage);
    socket?.on('ride:ended', onStage);
    socket?.on('ride:location', onLocation);

    return () => {
      cancelled = true;
      socket?.off('ride:stage', onStage);
      socket?.off('ride:driver-arrived', onStage);
      socket?.off('ride:ended', onStage);
      socket?.off('ride:location', onLocation);
    };
  }, [rideId]);

  if (!ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const stageIndex = STAGE_ORDER.indexOf(ride.stage);
  const isFinished = ride.status === 'completed';

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.title}>{isFinished ? 'Ride complete 🎉' : 'Tracking your ride'}</Text>

      <MiniMap
        pickup={ride.pickup}
        dropoff={ride.dropoff}
        driverLocation={driverLocation}
        waypoints={ride.safety?.routeLine?.length ? ride.safety.routeLine : ride.route?.waypoints}
        height={220}
      />

      <SafetyPanel ride={ride} onRideChange={setRide} />

      <View style={styles.timeline}>
        {STAGE_ORDER.slice(1).map((s, i) => {
          const idx = i + 1;
          const done = idx <= stageIndex;
          return (
            <View key={s} style={styles.timelineRow}>
              <View style={[styles.dot, done && styles.dotDone]} />
              <Text style={[styles.timelineText, done && styles.timelineTextDone]}>{STAGE_LABELS[s]}</Text>
            </View>
          );
        })}
      </View>

      {ride.driver ? (
        <View style={styles.driverCard}>
          <Text style={styles.driverName}>
            {ride.driver.firstName} {ride.driver.lastName}
          </Text>
          <Text style={styles.driverMeta}>
            {ride.driver.vehicle?.make || 'Car'} {ride.driver.vehicle?.plate ? `· ${ride.driver.vehicle.plate}` : ''}
          </Text>
        </View>
      ) : null}

      {ride.driver ? (
        <ChatPanel rideId={ride.id} currentUserId={user?.id} otherPartyName={ride.driver.firstName} />
      ) : null}

      <View style={styles.tripCard}>
        <Text style={styles.tripLabel}>Pickup</Text>
        <Text style={styles.tripValue}>{ride.pickup.address}</Text>
        <Text style={styles.tripLabel}>Drop-off</Text>
        <Text style={styles.tripValue}>{ride.dropoff.address}</Text>
        <Text style={styles.tripMeta}>
          {ride.route?.distanceKm} km · {ride.route?.durationMin} min estimated · {ride.seatsRequested} seat(s)
        </Text>
      </View>

      {isFinished ? (
        <Pressable style={styles.button} onPress={() => navigation.replace('RiderHome')}>
          <Text style={styles.buttonText}>Back to dashboard</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 56, paddingBottom: 60, gap: 16 },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary },
  timeline: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.primary },
  timelineText: { color: colors.textMuted, fontSize: 13 },
  timelineTextDone: { color: colors.text, fontWeight: '700' },
  driverCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  driverName: { fontWeight: '700', fontSize: 15, color: colors.text },
  driverMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  tripCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  tripLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginTop: 8 },
  tripValue: { fontSize: 14, color: colors.text, marginTop: 2 },
  tripMeta: { fontSize: 12, color: colors.textMuted, marginTop: 12 },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonText: { color: colors.surface, fontWeight: '800', fontSize: 16 },
});
