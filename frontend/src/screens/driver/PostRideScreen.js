import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput } from 'react-native';
import client from '../../api/client';
import { getErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { HOTSPOT_BY_ID } from '../../utils/hotspots';
import { formatDeparture } from '../../utils/pricing';
import HotspotPicker from '../../components/HotspotPicker';
import MiniMap from '../../components/MiniMap';

const LEAVE_IN = [
  { label: 'Now', minutes: 0 },
  { label: 'In 15 min', minutes: 15 },
  { label: 'In 30 min', minutes: 30 },
  { label: 'In 1 hr', minutes: 60 },
  { label: 'In 2 hr', minutes: 120 },
];

// "17:30" -> the next time it's 17:30 (today, or tomorrow if that's passed).
function parseClock(text) {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const d = new Date();
  d.setHours(h, min, 0, 0);
  if (d.getTime() < Date.now() - 60 * 1000) d.setDate(d.getDate() + 1);
  return d;
}

// The driver publishes a ride ahead of time: start, destination, optional
// stops to pass through, then picks one of the route options the backend's
// planner (geohash graph + A*) suggests. Every stop is a safe hotspot, so
// riders can board or get off anywhere along the way.
export default function PostRideScreen({ navigation }) {
  const { user } = useAuth();
  const carSeats = user?.vehicle?.seatsTotal || 4;
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [vias, setVias] = useState([]);
  const [seats, setSeats] = useState(Math.min(3, carSeats));
  const [leaveIn, setLeaveIn] = useState(15);
  const [clock, setClock] = useState('');
  const [plan, setPlan] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [isPosting, setIsPosting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!from || !to) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    setIsPlanning(true);
    setError('');
    client
      .post('/offers/plan', { fromId: from.id, toId: to.id, viaIds: vias, seatsTotal: seats })
      .then(({ data }) => {
        if (cancelled) return;
        setPlan(data);
        setSelectedKey(data.options.some((o) => o.key === 'custom') ? 'custom' : data.options[0]?.key);
      })
      .catch((err) => !cancelled && setError(getErrorMessage(err)))
      .finally(() => !cancelled && setIsPlanning(false));
    return () => {
      cancelled = true;
    };
  }, [from, to, vias, seats]);

  function pickFrom(h) {
    setFrom(h);
    setVias((v) => v.filter((id) => id !== h.id));
    if (to?.id === h.id) setTo(null);
  }

  function pickTo(h) {
    setTo(h);
    setVias((v) => v.filter((id) => id !== h.id));
    if (from?.id === h.id) setFrom(null);
  }

  function toggleVia(h) {
    setVias((v) => (v.includes(h.id) ? v.filter((id) => id !== h.id) : [...v, h.id]));
  }

  const chosen = plan?.options.find((o) => o.key === selectedKey);
  const customTime = clock ? parseClock(clock) : null;
  const departure = customTime || new Date(Date.now() + leaveIn * 60 * 1000);

  async function post() {
    setError('');
    if (!chosen) {
      setError('Pick a start, a destination and a route.');
      return;
    }
    if (clock && !customTime) {
      setError('Enter the time as HH:MM, e.g. 17:30.');
      return;
    }
    setIsPosting(true);
    try {
      const { data } = await client.post('/offers', {
        stopIds: chosen.stops.map((s) => s.hotspotId),
        routeChoice: chosen.key,
        seatsTotal: seats,
        departureAt: departure.toISOString(),
      });
      navigation.replace('OfferDetail', { offerId: data.offer.id });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsPosting(false);
    }
  }

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>Post a ride</Text>
      <Text style={styles.hint}>
        Riders along your route can book seats between any two stops. Every stop is a safe hotspot.
      </Text>

      <Text style={styles.label}>Starting from {from ? `· ${from.label}` : ''}</Text>
      <HotspotPicker selectedIds={from ? [from.id] : []} onPick={pickFrom} />

      <Text style={styles.label}>Going to {to ? `· ${to.label}` : ''}</Text>
      <HotspotPicker selectedIds={to ? [to.id] : []} onPick={pickTo} tone="danger" />

      <Text style={styles.label}>Pass through (optional)</Text>
      <Text style={styles.hint}>Tap stops you want on your way, in order. Tap again to remove.</Text>
      <HotspotPicker
        selectedIds={vias}
        onPick={toggleVia}
        disabledIds={[from?.id, to?.id].filter(Boolean)}
        tone="info"
      />
      {vias.length ? (
        <Text style={styles.viaList}>Via: {vias.map((id) => HOTSPOT_BY_ID[id]?.label).join(' → ')}</Text>
      ) : null}

      <Text style={styles.label}>Seats to offer</Text>
      <View style={styles.seatsRow}>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.max(1, s - 1))}>
          <Text style={styles.seatButtonText}>−</Text>
        </Pressable>
        <Text style={styles.seatsValue}>{seats}</Text>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.min(carSeats, s + 1))}>
          <Text style={styles.seatButtonText}>+</Text>
        </Pressable>
        <Text style={styles.muted}>of {carSeats} in your car</Text>
      </View>

      <Text style={styles.label}>Leaving</Text>
      <View style={styles.chips}>
        {LEAVE_IN.map((o) => {
          const active = !clock && leaveIn === o.minutes;
          return (
            <Pressable key={o.label} style={[styles.chip, active && styles.chipActive]} onPress={() => { setClock(''); setLeaveIn(o.minutes); }}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
        <TextInput
          style={[styles.clockInput, clock && styles.clockInputActive]}
          placeholder="or HH:MM"
          value={clock}
          onChangeText={setClock}
          maxLength={5}
        />
      </View>
      <Text style={styles.muted}>Departs {formatDeparture(departure.toISOString())}</Text>

      {isPlanning ? <ActivityIndicator style={{ marginTop: 20 }} color={colors.primary} /> : null}

      {plan && !isPlanning ? (
        <View style={{ marginTop: 20, gap: 10 }}>
          <Text style={styles.label}>Choose your route</Text>
          {plan.waitingRiders > 0 ? (
            <Text style={styles.hint}>👥 {plan.waitingRiders} rider(s) are looking for a ride right now.</Text>
          ) : null}
          {plan.options.map((o) => {
            const active = o.key === selectedKey;
            return (
              <Pressable key={o.key} style={[styles.option, active && styles.optionActive]} onPress={() => setSelectedKey(o.key)}>
                <View style={styles.optionHeader}>
                  <Text style={styles.optionTitle}>{o.label}</Text>
                  <Text style={styles.optionMeta}>
                    {o.distanceKm} km · {o.durationMin} min
                  </Text>
                </View>
                <Text style={styles.optionStops} numberOfLines={active ? undefined : 2}>
                  {o.stops.map((s) => s.label).join(' → ')}
                </Text>
                <Text style={styles.optionMeta}>
                  {o.stops.length - 2} stop(s) on the way · {o.ridersNearby} rider(s) waiting near it
                </Text>
                <Text style={styles.optionMeta}>
                  Trip cost ₹{o.tripCost} · about ₹{o.perSeatIfFull}/seat end-to-end if full
                </Text>
              </Pressable>
            );
          })}
          {chosen ? (
            <MiniMap
              pickup={{ ...chosen.stops[0] }}
              dropoff={{ ...chosen.stops[chosen.stops.length - 1] }}
              stops={chosen.stops.slice(1, -1)}
              waypoints={chosen.stops}
              showHint={false}
            />
          ) : null}
          <Text style={styles.hint}>
            💸 Fair pricing: you only recover fuel + wear (₹{plan.costPerKm}/km). Each leg's cost is split equally between you
            and everyone on board for that leg, so riders pay only for the distance they travel.
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={[styles.confirm, (isPosting || !chosen) && styles.confirmDisabled]} onPress={post} disabled={isPosting || !chosen}>
        {isPosting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.confirmText}>Post ride</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, paddingTop: 48, paddingBottom: 60 },
  back: { color: colors.primary, fontWeight: '700', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
  muted: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  viaList: { fontSize: 12, color: colors.info, fontWeight: '700', marginTop: 8 },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  seatButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  seatButtonText: { fontSize: 20, fontWeight: '800', color: colors.primary },
  seatsValue: { fontSize: 20, fontWeight: '800', color: colors.text, minWidth: 24, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.surface },
  clockInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, width: 90, backgroundColor: colors.surface, fontSize: 13 },
  clockInputActive: { borderColor: colors.primary },
  option: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 4 },
  optionActive: { borderColor: colors.primary, borderWidth: 2 },
  optionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionTitle: { fontWeight: '800', color: colors.text, fontSize: 15 },
  optionStops: { fontSize: 12, color: colors.text },
  optionMeta: { fontSize: 12, color: colors.textMuted },
  error: { color: colors.danger, marginTop: 16, fontSize: 13 },
  confirm: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  confirmDisabled: { opacity: 0.5 },
  confirmText: { color: colors.surface, fontWeight: '800', fontSize: 16 },
});
