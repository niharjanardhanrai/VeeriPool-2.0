import { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import client from '../../api/client';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';
import { estimateRoute } from '../../utils/geo';
import { COST_PER_KM, soloFare } from '../../utils/pricing';
import { SAFE_HOTSPOTS, AREAS } from '../../utils/hotspots';
import MiniMap from '../../components/MiniMap';
import { getCurrentPoint } from '../../utils/location';
import { useNightMode } from '../../utils/nightMode';

const MY_LOCATION_LABEL = 'My current location';

function AreaTabs({ value, onChange }) {
  return (
    <View style={styles.tabs}>
      {AREAS.map((a) => (
        <Pressable key={a} style={[styles.tab, value === a && styles.tabActive]} onPress={() => onChange(a)}>
          <Text style={[styles.tabText, value === a && styles.tabTextActive]}>{a}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Sec. II-B.2.a/b/c: "Where to" (drop-off) -> "From" (pickup) -> seats ->
// confirm. Pickup can be the rider's real GPS position (Expo Location) or a
// hotspot; drop-off must be one of the safe hotspots (enforced server-side).
export default function RequestRideScreen({ navigation }) {
  const [pickup, setPickup] = useState(null);
  const [dropoff, setDropoff] = useState(null);
  const [seats, setSeats] = useState(1);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [pickupArea, setPickupArea] = useState(AREAS[0]);
  const [dropoffArea, setDropoffArea] = useState(AREAS[0]);
  const { night, window: nightWindow } = useNightMode();

  // A day-only drop-off picked earlier is cleared once night mode is known.
  const dropoffBlocked = night && dropoff && !dropoff.night;

  async function pickMyLocation() {
    setError('');
    setIsLocating(true);
    try {
      const point = await getCurrentPoint();
      setPickup({ label: MY_LOCATION_LABEL, ...point });
    } catch (err) {
      setError(`Couldn't get your location: ${err.message}`);
    } finally {
      setIsLocating(false);
    }
  }

  const route = useMemo(() => (pickup && dropoff ? estimateRoute(pickup, dropoff) : null), [pickup, dropoff]);

  async function confirm() {
    setError('');
    if (!pickup || !dropoff) {
      setError('Choose a pickup and a drop-off point.');
      return;
    }
    if (dropoffBlocked) {
      setError(`Night mode: ${dropoff.label} isn't staffed at night — choose a 🌙 spot.`);
      return;
    }
    if (pickup.label === dropoff.label) {
      setError('Pickup and drop-off cannot be the same place.');
      return;
    }
    setIsSubmitting(true);
    try {
      const { data } = await client.post('/rides', {
        pickup: { lat: pickup.lat, lng: pickup.lng, address: pickup.label },
        dropoff: { lat: dropoff.lat, lng: dropoff.lng, address: dropoff.label },
        seatsRequested: seats,
      });
      navigation.replace('Waiting', { rideId: data.ride.id });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Request a ride</Text>

      <Text style={styles.label}>From (pickup)</Text>
      <AreaTabs value={pickupArea} onChange={setPickupArea} />
      <View style={styles.presetRow}>
        <Pressable
          style={[styles.preset, pickup?.label === MY_LOCATION_LABEL && styles.presetActivePickup]}
          onPress={pickMyLocation}
          disabled={isLocating}
        >
          <Text style={[styles.presetText, pickup?.label === MY_LOCATION_LABEL && styles.presetTextActive]}>
            {isLocating ? 'Locating…' : `📍 ${MY_LOCATION_LABEL}`}
          </Text>
        </Pressable>
        {SAFE_HOTSPOTS.filter((p) => p.area === pickupArea).map((p) => (
          <Pressable
            key={p.id}
            style={[styles.preset, pickup?.label === p.label && styles.presetActivePickup]}
            onPress={() => setPickup(p)}
          >
            <Text style={[styles.presetText, pickup?.label === p.label && styles.presetTextActive]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Where to (drop-off)</Text>
      <Text style={styles.hint}>
        🛡️ Drop-offs are only at safe hotspots — public, well-lit places that are staffed or busy. 🌙 = staffed all night.
      </Text>
      {night ? (
        <View style={styles.nightBanner}>
          <Text style={styles.nightTitle}>🌙 Night mode ({nightWindow})</Text>
          <Text style={styles.nightText}>
            Only spots staffed through the night — police stations, 24x7 hospitals and terminals, guarded campus gates — can be
            drop-offs now. Your route will also be watched more closely.
          </Text>
        </View>
      ) : null}
      <AreaTabs value={dropoffArea} onChange={setDropoffArea} />
      <View style={styles.hotspotList}>
        {SAFE_HOTSPOTS.filter((h) => h.area === dropoffArea).map((h) => {
          const selected = dropoff?.id === h.id;
          const closed = night && !h.night;
          return (
            <Pressable
              key={h.id}
              style={[styles.hotspot, selected && styles.hotspotActive, closed && styles.hotspotClosed]}
              onPress={() => setDropoff(h)}
              disabled={closed}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.hotspotName, selected && styles.presetTextActive]}>
                  {h.night ? '🌙 ' : ''}
                  {h.label}
                  {closed ? ' · not at night' : ''}
                </Text>
                <Text style={[styles.hotspotWhy, selected && styles.presetTextActive]}>{h.why}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>Seats needed</Text>
      <View style={styles.seatsRow}>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.max(1, s - 1))}>
          <Text style={styles.seatButtonText}>−</Text>
        </Pressable>
        <Text style={styles.seatsValue}>{seats}</Text>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.min(6, s + 1))}>
          <Text style={styles.seatButtonText}>+</Text>
        </Pressable>
      </View>

      {pickup && dropoff ? (
        <View style={styles.previewCard}>
          <MiniMap pickup={pickup} dropoff={dropoff} />
          <Text style={styles.previewText}>
            Estimated {route.distanceKm} km · {route.durationMin} min · about ₹{soloFare(route.distanceKm, seats)}
          </Text>
          <Text style={styles.fareNote}>
            Fair share: fuel + wear (₹{COST_PER_KM}/km) split equally between the driver and your {seats} seat(s). No surge,
            no profit.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.confirm, isSubmitting && styles.confirmDisabled]} onPress={confirm} disabled={isSubmitting}>
        {isSubmitting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.confirmText}>Confirm request</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, paddingTop: 56, paddingBottom: 60 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 20 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 16, marginBottom: 8 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface },
  presetActivePickup: { backgroundColor: colors.primary, borderColor: colors.primary },
  presetActiveDropoff: { backgroundColor: colors.danger, borderColor: colors.danger },
  presetText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  presetTextActive: { color: colors.surface },
  tabs: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontWeight: '800' },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 10 },
  hotspotList: { gap: 8 },
  hotspot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    backgroundColor: colors.surface,
  },
  hotspotActive: { backgroundColor: colors.danger, borderColor: colors.danger },
  hotspotClosed: { opacity: 0.4 },
  nightBanner: { backgroundColor: '#1F2A44', borderRadius: 12, padding: 12, marginBottom: 10 },
  nightTitle: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  nightText: { color: '#D5DCEB', fontSize: 12, marginTop: 4 },
  hotspotName: { fontSize: 14, fontWeight: '700', color: colors.text },
  hotspotWhy: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  seatButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  seatButtonText: { fontSize: 20, fontWeight: '800', color: colors.primary },
  seatsValue: { fontSize: 20, fontWeight: '800', color: colors.text, minWidth: 24, textAlign: 'center' },
  previewCard: { marginTop: 20, backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  fareNote: { textAlign: 'center', color: colors.textMuted, fontSize: 11 },
  previewText: { textAlign: 'center', color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  error: { color: colors.danger, marginTop: 16, fontSize: 13 },
  confirm: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 28 },
  confirmDisabled: { opacity: 0.6 },
  confirmText: { color: colors.surface, fontWeight: '800', fontSize: 16 },
});
