import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Switch } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';
import { STAGE_ORDER, STAGE_LABELS, NEXT_STAGE } from '../../utils/stages';
import { lerp, pointAlong } from '../../utils/geo';
import { watchPoint } from '../../utils/location';
import { useAuth } from '../../context/AuthContext';
import MiniMap from '../../components/MiniMap';
import ChatPanel from '../../components/ChatPanel';

// Sec. II-B.3.b: the driver manually taps through start_journey ->
// head_to_pickup -> arrived_pickup -> ride_started -> ride_ended -> finished.
// The car's position, sent over the same ride:location socket event either
// way, comes from one of two sources:
//  - real GPS via Expo Location (on by default) — streamed for the whole
//    active ride, on a phone or in the browser;
//  - a simulated animation toward the pickup/drop-off, used if the driver
//    turns real GPS off or location permission is denied, so the demo still
//    looks right when you're not actually near the ride's coordinates.
const ACTIVE_STAGES = ['start_journey', 'head_to_pickup', 'arrived_pickup', 'ride_started', 'ride_ended'];

export default function DriverRideScreen({ route: navRoute, navigation }) {
  const { rideId } = navRoute.params;
  const { user } = useAuth();
  const [ride, setRide] = useState(null);
  const [error, setError] = useState('');
  const [isAdvancing, setIsAdvancing] = useState(false);
  const [useRealGps, setUseRealGps] = useState(true);
  const [gpsError, setGpsError] = useState('');
  const simRef = useRef(null);
  const tRef = useRef(0);
  const [simLocation, setSimLocation] = useState(null);
  const [simulateDetour, setSimulateDetour] = useState(false);
  const [safetyNotice, setSafetyNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/rides/${rideId}`);
      setRide(data.ride);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [rideId]);

  useEffect(() => {
    load();
  }, [load]);

  // The backend's route monitor tells the driver (neutrally) when the car
  // has left the planned route and the rider is being asked to check in.
  useEffect(() => {
    const socket = getSocket();
    function onNotice(p) {
      if (String(p.rideId) === String(rideId)) setSafetyNotice(p.message);
    }
    socket?.on('ride:safety-notice', onNotice);
    return () => socket?.off('ride:safety-notice', onNotice);
  }, [rideId]);

  // Drive the GPS ping — real Expo Location for the whole active ride, or
  // the simulated animation while the car is moving.
  useEffect(() => {
    clearInterval(simRef.current);
    if (!ride) return undefined;

    if (useRealGps && ACTIVE_STAGES.includes(ride.stage)) {
      setGpsError('');
      return watchPoint(
        (point) => {
          setSimLocation(point);
          getSocket()?.emit('ride:location', { rideId, lat: point.lat, lng: point.lng, accuracy: point.accuracy });
        },
        (err) => {
          setGpsError(`GPS unavailable (${err.message}) — simulating movement instead.`);
          setUseRealGps(false);
        }
      );
    }

    const moving = ride.stage === 'head_to_pickup' || ride.stage === 'ride_started';
    if (!moving) return undefined;

    const from = ride.stage === 'head_to_pickup' ? ride.dropoff : ride.pickup; // arbitrary starting bearing
    const to = ride.stage === 'head_to_pickup' ? ride.pickup : ride.dropoff;
    tRef.current = 0;

    // On the ride itself, follow the road line the safety monitor watches.
    const roadLine = ride.stage === 'ride_started' ? ride.safety?.routeLine : null;
    // A detour needs time off-route to count, so the demo drives slower.
    const stepT = simulateDetour && ride.stage === 'ride_started' ? 0.015 : 0.08;

    simRef.current = setInterval(() => {
      // On the ride, run all the way in (parking short of the drop-off would
      // look like a long stop to the monitor); the detour demo stays out.
      const cap = ride.stage === 'ride_started' && !simulateDetour ? 1 : 0.92;
      tRef.current = Math.min(cap, tRef.current + stepT);
      let point = roadLine?.length >= 2 ? pointAlong(roadLine, tRef.current) : lerp(from, to, tRef.current);
      // Demo: swing ~1.5 km off to the side of the route mid-ride, to show
      // the deviation alert without actually driving anywhere.
      if (simulateDetour && ride.stage === 'ride_started') {
        const side = 0.0135 * Math.min(1, tRef.current / 0.15);
        const dLat = to.lat - from.lat;
        const dLng = to.lng - from.lng;
        const len = Math.hypot(dLat, dLng) || 1;
        point = { lat: point.lat - (dLng / len) * side, lng: point.lng + (dLat / len) * side };
      }
      setSimLocation(point);
      getSocket()?.emit('ride:location', { rideId, lat: point.lat, lng: point.lng });
    }, 1500);

    return () => clearInterval(simRef.current);
  }, [ride?.stage, ride?.safety?.routeLine, rideId, useRealGps, simulateDetour]);

  async function advance() {
    const next = NEXT_STAGE[ride.stage];
    if (!next) return;
    setIsAdvancing(true);
    setError('');
    try {
      const { data } = await client.post(`/rides/${rideId}/stage`, { stage: next.stage });
      setRide(data.ride);
      if (next.stage === 'finished') {
        clearInterval(simRef.current);
        setTimeout(() => navigation.replace('DriverHome'), 800);
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsAdvancing(false);
    }
  }

  if (!ride) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const next = NEXT_STAGE[ride.stage];
  const stageIndex = STAGE_ORDER.indexOf(ride.stage);

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Active ride</Text>

      <MiniMap
        pickup={ride.pickup}
        dropoff={ride.dropoff}
        driverLocation={simLocation || ride.driverLocation}
        waypoints={ride.safety?.routeLine?.length ? ride.safety.routeLine : ride.route?.waypoints}
        height={220}
      />

      <View style={styles.gpsRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.gpsLabel}>Use my real GPS location</Text>
          <Text style={styles.gpsHint}>
            {useRealGps ? "Sharing this device's live location with the rider" : 'Simulating movement toward the target'}
          </Text>
          {gpsError ? <Text style={styles.gpsError}>{gpsError}</Text> : null}
        </View>
        <Switch value={useRealGps} onValueChange={setUseRealGps} trackColor={{ true: colors.primary }} />
      </View>

      {!useRealGps ? (
        <View style={styles.gpsRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.gpsLabel}>Demo: simulate a detour</Text>
            <Text style={styles.gpsHint}>Moves the simulated car ~1.5 km off the route during the ride, to show the rider's safety check-in.</Text>
          </View>
          <Switch value={simulateDetour} onValueChange={setSimulateDetour} trackColor={{ true: colors.danger }} />
        </View>
      ) : null}

      {safetyNotice ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>🛡️ {safetyNotice}</Text>
        </View>
      ) : null}

      <View style={styles.riderCard}>
        <Text style={styles.riderName}>
          {ride.rider.firstName} {ride.rider.lastName}
        </Text>
        <Text style={styles.meta}>
          {ride.pickup.address} → {ride.dropoff.address}
        </Text>
        <Text style={styles.meta}>
          {ride.seatsRequested} seat(s) · {ride.route?.distanceKm} km · {ride.route?.durationMin} min
        </Text>
      </View>

      <ChatPanel rideId={ride.id} currentUserId={user?.id} otherPartyName={ride.rider.firstName} />

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

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {next ? (
        <Pressable style={[styles.button, isAdvancing && styles.buttonDisabled]} onPress={advance} disabled={isAdvancing}>
          {isAdvancing ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.buttonText}>{next.label}</Text>}
        </Pressable>
      ) : (
        <Text style={styles.done}>Ride finished ✅</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 56, paddingBottom: 60, gap: 16 },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 12,
  },
  gpsLabel: { fontWeight: '700', color: colors.text, fontSize: 13 },
  gpsHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  gpsError: { color: colors.danger, fontSize: 11, marginTop: 4 },
  notice: { backgroundColor: '#FDF2E0', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.accent },
  noticeText: { color: '#7A4B00', fontSize: 13, fontWeight: '600' },
  riderCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  riderName: { fontWeight: '700', fontSize: 15, color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  timeline: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 10 },
  timelineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.border },
  dotDone: { backgroundColor: colors.primary },
  timelineText: { color: colors.textMuted, fontSize: 13 },
  timelineTextDone: { color: colors.text, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.surface, fontWeight: '800', fontSize: 16 },
  done: { textAlign: 'center', color: colors.primary, fontWeight: '800', fontSize: 16 },
});
