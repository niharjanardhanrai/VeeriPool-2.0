import { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import client from '../../api/client';
import { getErrorMessage } from '../../api/errors';
import { colors } from '../../theme/colors';
import { formatDeparture } from '../../utils/pricing';
import { getCurrentPoint } from '../../utils/location';
import HotspotPicker, { chipStyles } from '../../components/HotspotPicker';

const MY_LOCATION_LABEL = 'My current location';

function walk(km) {
  return km < 0.05 ? 'at the stop' : `${Math.round(km * 1000)} m walk`;
}

// Find a ride a driver has posted that passes near you and stops at (or
// near) your destination. The backend narrows the search with geohash cells
// around your pickup, then quotes each match's fair fare.
export default function FindRideScreen({ navigation }) {
  const [pickup, setPickup] = useState(null);
  const [dest, setDest] = useState(null);
  const [seats, setSeats] = useState(1);
  const [matches, setMatches] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [bookingId, setBookingId] = useState(null);
  const [error, setError] = useState('');

  async function pickMyLocation() {
    setError('');
    setIsLocating(true);
    try {
      const point = await getCurrentPoint();
      setPickup({ id: 'me', label: MY_LOCATION_LABEL, ...point });
      setMatches(null);
    } catch (err) {
      setError(`Couldn't get your location: ${err.message}`);
    } finally {
      setIsLocating(false);
    }
  }

  async function search() {
    setError('');
    if (!pickup || !dest) {
      setError('Choose where you are and where you want to go.');
      return;
    }
    if (pickup.id === dest.id) {
      setError('Pickup and destination cannot be the same place.');
      return;
    }
    setIsSearching(true);
    try {
      const { data } = await client.get('/offers/search', {
        params: { lat: pickup.lat, lng: pickup.lng, toId: dest.id, seats },
      });
      setMatches(data.matches);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsSearching(false);
    }
  }

  async function book(m) {
    setBookingId(m.offer.id);
    setError('');
    try {
      await client.post(`/offers/${m.offer.id}/book`, { boardIndex: m.boardIndex, alightIndex: m.alightIndex, seats });
      navigation.replace('OfferDetail', { offerId: m.offer.id });
    } catch (err) {
      setError(getErrorMessage(err));
      search();
    } finally {
      setBookingId(null);
    }
  }

  const myLocationChip = (
    <Pressable
      style={[chipStyles.chip, pickup?.id === 'me' && chipStyles.chipActive]}
      onPress={pickMyLocation}
      disabled={isLocating}
    >
      <Text style={[chipStyles.chipText, pickup?.id === 'me' && chipStyles.chipTextActive]}>
        {isLocating ? 'Locating…' : `📍 ${MY_LOCATION_LABEL}`}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.title}>Find a posted ride</Text>
      <Text style={styles.hint}>Rides drivers have posted, passing within a short walk of you.</Text>

      <Text style={styles.label}>I'm at {pickup ? `· ${pickup.label}` : ''}</Text>
      <HotspotPicker
        selectedIds={pickup ? [pickup.id] : []}
        onPick={(h) => {
          setPickup(h);
          setMatches(null);
        }}
        leading={myLocationChip}
      />

      <Text style={styles.label}>Going to {dest ? `· ${dest.label}` : ''}</Text>
      <HotspotPicker
        selectedIds={dest ? [dest.id] : []}
        onPick={(h) => {
          setDest(h);
          setMatches(null);
        }}
        tone="danger"
      />

      <Text style={styles.label}>Seats</Text>
      <View style={styles.seatsRow}>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.max(1, s - 1))}>
          <Text style={styles.seatButtonText}>−</Text>
        </Pressable>
        <Text style={styles.seatsValue}>{seats}</Text>
        <Pressable style={styles.seatButton} onPress={() => setSeats((s) => Math.min(6, s + 1))}>
          <Text style={styles.seatButtonText}>+</Text>
        </Pressable>
      </View>

      <Pressable style={[styles.confirm, isSearching && styles.confirmDisabled]} onPress={search} disabled={isSearching}>
        {isSearching ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.confirmText}>Search rides</Text>}
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {matches ? (
        <View style={{ marginTop: 20, gap: 12 }}>
          <Text style={styles.label}>{matches.length ? `${matches.length} ride(s) found` : 'No posted rides match yet'}</Text>
          {matches.length === 0 ? (
            <Text style={styles.hint}>
              Drivers planning a route now will see that someone is waiting here. You can also request an on-demand ride
              from the home screen.
            </Text>
          ) : null}
          {matches.map((m) => (
            <View key={m.offer.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.when}>{formatDeparture(m.offer.departureAt)}</Text>
                <Text style={styles.fare}>₹{m.fare}</Text>
              </View>
              <Text style={styles.driver}>
                {m.offer.driver.firstName} {m.offer.driver.lastName} · {m.offer.driver.vehicle?.make || 'Car'}
              </Text>
              <Text style={styles.leg}>
                🟢 Board at {m.board} ({walk(m.walkToBoardKm)})
              </Text>
              <Text style={styles.leg}>
                🔴 Get off at {m.alight} ({walk(m.walkFromAlightKm)})
              </Text>
              <Text style={styles.meta}>
                {m.rideKm} km of the driver's {m.offer.distanceKm} km route · {m.freeSeats} seat(s) free
              </Text>
              <Text style={styles.meta}>
                Fair share: ₹{m.fare}
                {m.aloneFare > m.fare ? ` (₹${m.aloneFare} if nobody else shared it)` : ''} · only drops if more riders join
              </Text>
              {m.alreadyBooked ? (
                <Pressable style={styles.secondary} onPress={() => navigation.navigate('OfferDetail', { offerId: m.offer.id })}>
                  <Text style={styles.secondaryText}>You're booked — view</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.bookButton} disabled={bookingId === m.offer.id} onPress={() => book(m)}>
                  {bookingId === m.offer.id ? (
                    <ActivityIndicator color={colors.surface} />
                  ) : (
                    <Text style={styles.bookText}>Book {seats} seat(s)</Text>
                  )}
                </Pressable>
              )}
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  container: { padding: 20, paddingTop: 48, paddingBottom: 60 },
  back: { color: colors.primary, fontWeight: '700', marginBottom: 10 },
  title: { fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 6 },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 18, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textMuted },
  seatsRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  seatButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  seatButtonText: { fontSize: 20, fontWeight: '800', color: colors.primary },
  seatsValue: { fontSize: 20, fontWeight: '800', color: colors.text, minWidth: 24, textAlign: 'center' },
  confirm: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
  confirmDisabled: { opacity: 0.6 },
  confirmText: { color: colors.surface, fontWeight: '800', fontSize: 16 },
  error: { color: colors.danger, marginTop: 16, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 3 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  when: { fontWeight: '800', color: colors.text, fontSize: 15 },
  fare: { fontWeight: '800', color: colors.primary, fontSize: 20 },
  driver: { color: colors.textMuted, fontSize: 13, marginBottom: 4 },
  leg: { fontSize: 13, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  bookButton: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  bookText: { color: colors.surface, fontWeight: '800' },
  secondary: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10, paddingVertical: 11, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: colors.primary, fontWeight: '800' },
});
