import { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import client from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../theme/colors';
import { STAGE_LABELS } from '../../utils/stages';
import { useLiveLocation } from '../../utils/location';
import LiveLocationCard from '../../components/LiveLocationCard';
import { formatDeparture } from '../../utils/pricing';

// Sec. II-B.2.a: "This process starts first in the User Dashboard, as the
// user has to tab on the 'where to' button".
export default function RiderHomeScreen({ navigation }) {
  const { user, logout } = useAuth();
  const [rides, setRides] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const live = useLiveLocation();

  const load = useCallback(async () => {
    try {
      const [{ data }, { data: booked }] = await Promise.all([client.get('/rides/mine'), client.get('/offers/mine')]);
      setRides(data.rides);
      setBookings(booked.offers.filter((o) => o.myBooking && (o.status === 'open' || o.status === 'started')));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [load, navigation]);

  const active = rides.find((r) => r.status === 'pending' || r.status === 'accepted');
  const past = rides.filter((r) => r.status === 'completed' || r.status === 'rejected' || r.status === 'cancelled');

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hi, {user?.firstName} 👋</Text>
          <Text style={styles.subtitle}>@{user?.username}</Text>
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

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={past}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
          ListHeaderComponent={
            <View style={{ gap: 12, marginBottom: 12 }}>
              {active ? (
                <Pressable
                  style={styles.activeCard}
                  onPress={() =>
                    navigation.navigate(active.status === 'pending' ? 'Waiting' : 'Tracking', { rideId: active.id })
                  }
                >
                  <Text style={styles.activeLabel}>Active ride</Text>
                  <Text style={styles.activeStage}>{STAGE_LABELS[active.stage] || active.status}</Text>
                  <Text style={styles.activeMeta}>
                    {active.pickup.address || 'Pickup'} → {active.dropoff.address || 'Drop-off'}
                  </Text>
                </Pressable>
              ) : (
                <Pressable style={styles.whereTo} onPress={() => navigation.navigate('RequestRide')}>
                  <Text style={styles.whereToText}>Where to?</Text>
                  <Text style={styles.whereToArrow}>→</Text>
                </Pressable>
              )}
              <Pressable style={styles.findButton} onPress={() => navigation.navigate('FindRide')}>
                <Text style={styles.findText}>🚗 Find a posted ride</Text>
                <Text style={styles.findSub}>Join a driver already heading your way and split the cost fairly</Text>
              </Pressable>
              {bookings.length ? <Text style={styles.sectionTitle}>Your booked seats</Text> : null}
              {bookings.map((o) => (
                <Pressable key={o.id} style={styles.bookingCard} onPress={() => navigation.navigate('OfferDetail', { offerId: o.id })}>
                  <Text style={styles.historyStatus}>
                    {o.myBooking.board} → {o.myBooking.alight}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {formatDeparture(o.departureAt)} · {o.driver.firstName} · ₹{o.myBooking.fare}
                    {o.status === 'started' ? ' · on the way' : ''}
                  </Text>
                </Pressable>
              ))}
              <LiveLocationCard location={live.location} error={live.error} onRetry={live.retry} />
              {past.length > 0 ? <Text style={styles.sectionTitle}>Ride history</Text> : null}
            </View>
          }
          ListEmptyComponent={!active ? <Text style={styles.empty}>No past rides yet.</Text> : null}
          renderItem={({ item }) => (
            <View style={styles.historyCard}>
              <Text style={styles.historyStatus}>{item.status}</Text>
              <Text style={styles.historyMeta}>
                {item.pickup.address || 'Pickup'} → {item.dropoff.address || 'Drop-off'}
              </Text>
              <Text style={styles.historyMeta}>
                {item.route?.distanceKm ?? '—'} km · {item.route?.durationMin ?? '—'} min
                {item.fare?.amount != null ? ` · ₹${item.fare.amount}` : ''}
              </Text>
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
  whereTo: {
    backgroundColor: colors.primary,
    borderRadius: 16,
    padding: 22,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  whereToText: { color: colors.surface, fontSize: 20, fontWeight: '800' },
  whereToArrow: { color: colors.surface, fontSize: 22, fontWeight: '800' },
  findButton: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, borderWidth: 2, borderColor: colors.primary },
  findText: { color: colors.primary, fontSize: 17, fontWeight: '800' },
  findSub: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  bookingCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.primary },
  activeCard: { backgroundColor: colors.accent, borderRadius: 16, padding: 20 },
  activeLabel: { color: colors.primaryDark, fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  activeStage: { color: colors.primaryDark, fontWeight: '800', fontSize: 17, marginTop: 6 },
  activeMeta: { color: colors.primaryDark, fontSize: 13, marginTop: 4 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: 20 },
  historyCard: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border },
  historyStatus: { fontWeight: '700', color: colors.text, textTransform: 'capitalize' },
  historyMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
});
