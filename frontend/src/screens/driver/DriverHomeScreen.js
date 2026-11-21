import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, Switch, ActivityIndicator, RefreshControl } from 'react-native';
import client from '../../api/client';
import { getSocket } from '../../api/socket';
import { getErrorMessage } from '../../api/errors';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { useLiveLocation } from '../../utils/location';
import LiveLocationCard from '../../components/LiveLocationCard';
import { formatDeparture } from '../../utils/pricing';

// Sec. II-B.2.d: incoming requests are shown to the car "in a first come
// first serve manner" — the queue below is sorted oldest-request-first
// (see GET /api/rides/queue), and a fresh request pushed over the
// ride:new-request socket event is prepended immediately.
export default function DriverHomeScreen({ navigation }) {
  const { user, logout, setUser } = useAuth();
  const [queue, setQueue] = useState([]);
  const [offers, setOffers] = useState([]);
  const [activeRide, setActiveRide] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const live = useLiveLocation();

  const load = useCallback(async () => {
    setError('');
    try {
      const [{ data: mine }, { data: q }, { data: posted }] = await Promise.all([
        client.get('/rides/mine'),
        client.get('/rides/queue'),
        client.get('/offers/mine'),
      ]);
      setOffers(posted.offers.filter((o) => o.status === 'open' || o.status === 'started'));
      const current = mine.rides.find((r) => r.status === 'accepted');
      setActiveRide(current || null);
      setQueue(q.rides);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 4000);

    const socket = getSocket();
    function onNewRequest(ride) {
      setQueue((prev) => (prev.some((r) => r.id === ride.id) ? prev : [...prev, ride]));
    }
    socket?.on('ride:new-request', onNewRequest);

    const unsub = navigation.addListener('focus', load);

    return () => {
      clearInterval(pollRef.current);
      socket?.off('ride:new-request', onNewRequest);
      unsub();
    };
  }, [load, navigation]);

  useEffect(() => {
    if (activeRide) navigation.navigate('DriverRide', { rideId: activeRide.id });
  }, [activeRide, navigation]);

  async function toggleAvailability(value) {
    setUser({ ...user, isAvailable: value });
    try {
      const { data } = await client.post('/drivers/availability', { isAvailable: value });
      setUser(data.user);
    } catch (err) {
      setUser({ ...user, isAvailable: !value });
      setError(getErrorMessage(err));
    }
  }

  async function respond(rideId, decision) {
    setBusyId(rideId);
    try {
      const { data } = await client.post(`/rides/${rideId}/${decision}`);
      setQueue((prev) => prev.filter((r) => r.id !== rideId));
      if (decision === 'accept') navigation.navigate('DriverRide', { rideId: data.ride.id });
    } catch (err) {
      setError(getErrorMessage(err));
      load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.firstName} 👋</Text>
          <Text style={styles.subtitle}>
            {user?.vehicle?.make || 'Car'} · {user?.vehicle?.seatsTotal} seats
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('Support')} style={styles.helpButton}>
            <Text style={styles.helpText}>🎧 Help</Text>
          </Pressable>
          <Pressable onPress={logout}>
            <Text style={styles.logout}>Log out</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.availabilityRow}>
        <Text style={styles.availabilityLabel}>{user?.isAvailable ? 'Available for requests' : 'Offline'}</Text>
        <Switch value={Boolean(user?.isAvailable)} onValueChange={toggleAvailability} trackColor={{ true: colors.primary }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={queue}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          ListHeaderComponent={
            <View style={{ gap: 12 }}>
              <Pressable style={styles.postButton} onPress={() => navigation.navigate('PostRide')}>
                <Text style={styles.postText}>＋ Post a ride</Text>
                <Text style={styles.postSub}>Share your route — riders on the way book seats</Text>
              </Pressable>
              {offers.length ? <Text style={styles.sectionTitle}>Your posted rides</Text> : null}
              {offers.map((o) => (
                <Pressable key={o.id} style={styles.offerCard} onPress={() => navigation.navigate('OfferDetail', { offerId: o.id })}>
                  <Text style={styles.riderName}>
                    {o.stops[0].label} → {o.stops[o.stops.length - 1].label}
                  </Text>
                  <Text style={styles.meta}>
                    {formatDeparture(o.departureAt)} · {o.stops.length - 2} stop(s) · {o.bookedCount} seat(s) booked ·{' '}
                    {o.status === 'started' ? 'on the way' : 'open'}
                  </Text>
                </Pressable>
              ))}
              <LiveLocationCard
                title="Your car's live location"
                location={live.location}
                error={live.error}
                onRetry={live.retry}
              />
              <Text style={styles.sectionTitle}>Incoming requests (first come, first serve)</Text>
            </View>
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {user?.isAvailable ? 'No pending requests right now.' : 'Go available to start receiving requests.'}
            </Text>
          }
          renderItem={({ item, index }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.queuePosition}>#{index + 1}</Text>
                <Text style={styles.riderName}>
                  {item.rider.firstName} {item.rider.lastName}
                </Text>
              </View>
              <Text style={styles.meta}>
                {item.pickup.address} → {item.dropoff.address}
              </Text>
              <Text style={styles.meta}>
                {item.seatsRequested} seat(s) · {item.route?.distanceKm} km · {item.route?.durationMin} min
                {item.fare?.amount != null ? ` · rider pays ₹${item.fare.amount}` : ''}
              </Text>
              <View style={styles.actions}>
                <Pressable style={[styles.actionButton, styles.reject]} disabled={busyId === item.id} onPress={() => respond(item.id, 'reject')}>
                  <Text style={styles.declineText}>Decline</Text>
                </Pressable>
                <Pressable style={[styles.actionButton, styles.accept]} disabled={busyId === item.id} onPress={() => respond(item.id, 'accept')}>
                  {busyId === item.id ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.actionText}>Accept</Text>}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 48,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  greeting: { fontSize: 18, fontWeight: '800', color: colors.primary },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  logout: { color: colors.danger, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  helpButton: { borderWidth: 1, borderColor: colors.primary, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 5 },
  helpText: { color: colors.primary, fontWeight: '700', fontSize: 13 },
  availabilityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  availabilityLabel: { fontWeight: '700', color: colors.text },
  error: { color: colors.danger, textAlign: 'center', marginTop: 12 },
  postButton: { backgroundColor: colors.primary, borderRadius: 14, padding: 16 },
  postText: { color: colors.surface, fontWeight: '800', fontSize: 17 },
  postSub: { color: colors.surface, opacity: 0.85, fontSize: 12, marginTop: 2 },
  offerCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.primary },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, marginBottom: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 20 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  queuePosition: { backgroundColor: colors.primary, color: colors.surface, fontWeight: '800', fontSize: 11, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  riderName: { fontWeight: '700', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  actionButton: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  accept: { backgroundColor: colors.primary },
  reject: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.danger },
  actionText: { color: colors.surface, fontWeight: '700', fontSize: 13 },
  declineText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
});
