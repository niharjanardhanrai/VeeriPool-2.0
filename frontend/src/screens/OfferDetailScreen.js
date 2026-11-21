import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import client from '../api/client';
import { getSocket } from '../api/socket';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';
import { formatDeparture } from '../utils/pricing';
import MiniMap from '../components/MiniMap';

const STATUS_LABEL = { open: 'Open for bookings', started: 'On the way', completed: 'Completed', cancelled: 'Cancelled' };

// A posted ride, seen by its driver (bookings, money, start/finish) or by a
// rider who booked a seat on it (their stops, their fare).
export default function OfferDetailScreen({ route, navigation }) {
  const { offerId } = route.params;
  const [offer, setOffer] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await client.get(`/offers/${offerId}`);
      setOffer(data.offer);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [offerId]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 8000);
    const socket = getSocket();
    function onUpdate(o) {
      if (o.id === offerId) load();
    }
    socket?.on('offer:booked', onUpdate);
    socket?.on('offer:status', onUpdate);
    return () => {
      clearInterval(poll);
      socket?.off('offer:booked', onUpdate);
      socket?.off('offer:status', onUpdate);
    };
  }, [load, offerId]);

  async function act(path, body) {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post(`/offers/${offerId}/${path}`, body);
      setOffer(data.offer);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!offer) {
    return (
      <View style={styles.center}>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </View>
    );
  }

  const first = offer.stops[0];
  const last = offer.stops[offer.stops.length - 1];
  const mine = offer.myBooking;
  const highlight = mine ? [mine.boardIndex, mine.alightIndex] : [];

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.container}>
      <Pressable onPress={() => navigation.goBack()}>
        <Text style={styles.back}>← Back</Text>
      </Pressable>
      <Text style={styles.status}>{STATUS_LABEL[offer.status]}</Text>
      <Text style={styles.title}>
        {first.label} → {last.label}
      </Text>
      <Text style={styles.meta}>
        {formatDeparture(offer.departureAt)} · {offer.distanceKm} km · {offer.durationMin} min
        {offer.routeSource === 'ors' ? ' · road route' : ''}
      </Text>

      <View style={{ marginTop: 14 }}>
        <MiniMap
          pickup={{ ...first }}
          dropoff={{ ...last }}
          stops={offer.stops.slice(1, -1)}
          waypoints={offer.waypoints}
          showHint={false}
        />
      </View>

      {!offer.isMine ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            Driver: {offer.driver.firstName} {offer.driver.lastName}
          </Text>
          <Text style={styles.meta}>
            {offer.driver.vehicle?.make} {offer.driver.vehicle?.plate ? `· ${offer.driver.vehicle.plate}` : ''} · 📞 {offer.driver.phone}
          </Text>
          {mine ? (
            <>
              <Text style={styles.mineRoute}>
                You: {mine.board} → {mine.alight} · {mine.seats} seat(s)
              </Text>
              <Text style={styles.fare}>₹{mine.fare}</Text>
              <Text style={styles.meta}>
                Never more than your quote of ₹{mine.quotedFare}. It drops if more riders share your part of the route.
              </Text>
              {offer.status === 'open' ? (
                <Pressable style={styles.dangerButton} disabled={busy} onPress={() => act('cancel-booking')}>
                  <Text style={styles.dangerText}>Cancel my booking</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <Text style={styles.meta}>You don't have a seat on this ride.</Text>
          )}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {offer.bookedCount} seat(s) booked · {offer.seatsTotal} offered per leg
          </Text>
          <View style={styles.moneyRow}>
            <Money label="Trip cost" value={offer.tripCost} />
            <Money label="Riders pay" value={offer.collected} />
            <Money label="Your share" value={Math.max(0, offer.tripCost - offer.collected)} />
          </View>
          {offer.bookings.filter((b) => b.status === 'booked').length === 0 ? (
            <Text style={styles.meta}>No bookings yet — riders near your stops can find this ride now.</Text>
          ) : null}
          {offer.bookings
            .filter((b) => b.status === 'booked')
            .map((b) => (
              <View key={b.id} style={styles.booking}>
                <Text style={styles.bookingName}>
                  {b.rider.firstName} {b.rider.lastName} · {b.seats} seat(s) · ₹{b.fare}
                </Text>
                <Text style={styles.meta}>
                  {b.board} → {b.alight} · 📞 {b.rider.phone}
                </Text>
              </View>
            ))}
          <View style={styles.actions}>
            {offer.status === 'open' ? (
              <>
                <Pressable style={styles.dangerButton} disabled={busy} onPress={() => act('status', { status: 'cancelled' })}>
                  <Text style={styles.dangerText}>Cancel ride</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} disabled={busy} onPress={() => act('status', { status: 'started' })}>
                  <Text style={styles.primaryText}>Start ride</Text>
                </Pressable>
              </>
            ) : null}
            {offer.status === 'started' ? (
              <Pressable style={styles.primaryButton} disabled={busy} onPress={() => act('status', { status: 'completed' })}>
                <Text style={styles.primaryText}>Finish ride</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.section}>Route & seats per leg</Text>
      {offer.stops.map((s, i) => {
        const isHighlight = highlight.includes(i);
        return (
          <View key={s.hotspotId}>
            <View style={styles.stopRow}>
              <View style={[styles.stopDot, i === 0 && styles.dotStart, i === offer.stops.length - 1 && styles.dotEnd]} />
              <Text style={[styles.stopName, isHighlight && styles.stopHighlight]}>
                {s.label}
                {mine && i === mine.boardIndex ? '  · you board' : ''}
                {mine && i === mine.alightIndex ? '  · you get off' : ''}
              </Text>
            </View>
            {i < offer.legs.length ? (
              <Text style={styles.leg}>
                {offer.legs[i].km} km · {offer.seatsUsedPerLeg[i]}/{offer.seatsTotal} seats taken
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function Money({ label, value }) {
  return (
    <View style={styles.money}>
      <Text style={styles.moneyValue}>₹{value}</Text>
      <Text style={styles.moneyLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 20, paddingTop: 48, paddingBottom: 60 },
  back: { color: colors.primary, fontWeight: '700', marginBottom: 10 },
  status: { color: colors.accent, fontWeight: '800', fontSize: 12, textTransform: 'uppercase' },
  title: { fontSize: 20, fontWeight: '800', color: colors.primary, marginTop: 4 },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 3 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, marginTop: 16, gap: 4 },
  cardTitle: { fontWeight: '800', color: colors.text },
  mineRoute: { fontWeight: '700', color: colors.text, marginTop: 10 },
  fare: { fontSize: 28, fontWeight: '800', color: colors.primary, marginTop: 4 },
  moneyRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  money: { flex: 1, backgroundColor: colors.background, borderRadius: 10, padding: 10, alignItems: 'center' },
  moneyValue: { fontWeight: '800', fontSize: 16, color: colors.primary },
  moneyLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  booking: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, marginTop: 6 },
  bookingName: { fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryButton: { flex: 1, backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  primaryText: { color: colors.surface, fontWeight: '800' },
  dangerButton: { flex: 1, borderWidth: 1, borderColor: colors.danger, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  dangerText: { color: colors.danger, fontWeight: '800' },
  error: { color: colors.danger, marginTop: 12, fontSize: 13 },
  section: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginTop: 22, marginBottom: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stopDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  dotStart: { backgroundColor: colors.primary },
  dotEnd: { backgroundColor: colors.danger },
  stopName: { fontSize: 13, color: colors.text, fontWeight: '600', flex: 1 },
  stopHighlight: { color: colors.primary, fontWeight: '800' },
  leg: { fontSize: 11, color: colors.textMuted, marginLeft: 20, marginVertical: 4 },
});
