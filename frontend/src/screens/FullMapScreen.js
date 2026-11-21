import { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Linking } from 'react-native';
import client from '../api/client';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';
import { useLiveLocation } from '../utils/location';
import FullRouteMap from '../components/FullRouteMap';
import { SAFE_HOTSPOTS } from '../utils/hotspots';
import { haversineKm } from '../utils/geo';

const ARROWS = {
  left: '⬅', right: '➡', 'slight left': '↖', 'slight right': '↗',
  'sharp left': '↙', 'sharp right': '↘', uturn: '↩', straight: '⬆',
};

function stepIcon(step) {
  if (step.type === 'depart') return '🚗';
  if (step.type === 'arrive') return '📍';
  if (step.type === 'roundabout' || step.type === 'rotary') return '🔄';
  return ARROWS[step.modifier] || '⬆';
}

function formatDistance(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function formatDuration(min) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}

// Google Maps directions link — turn-by-turn voice navigation in the
// Google Maps app on a phone, or the website on a laptop. Google allows
// at most 9 waypoints, so long routes keep an even sample of the stops.
function googleMapsUrl(stops) {
  const fmt = (p) => `${p.lat},${p.lng}`;
  const middle = stops.slice(1, -1);
  const pick = middle.length <= 9 ? middle : Array.from({ length: 9 }, (_, i) => middle[Math.round((i * (middle.length - 1)) / 8)]);
  const params = [
    'api=1',
    `origin=${fmt(stops[0])}`,
    `destination=${fmt(stops[stops.length - 1])}`,
    'travelmode=driving',
  ];
  if (pick.length) params.push(`waypoints=${encodeURIComponent(pick.map(fmt).join('|'))}`);
  return `https://www.google.com/maps/dir/?${params.join('&')}`;
}

// Full-screen map with the road route and Google-Maps-style turn-by-turn
// directions. Opened from the "Full map" button on any small map.
// params: { stops: [{ lat, lng, label }], driverLocation?, title? }
// With a single stop (your live location) it first lists the nearest safe
// hotspots; picking one builds directions from you to it.
export default function FullMapScreen({ route, navigation }) {
  const { driverLocation, title } = route.params;
  const startedFromLocation = route.params.stops.length < 2;
  const [stops, setStops] = useState(route.params.stops);
  const [directions, setDirections] = useState(null);
  const [error, setError] = useState('');
  const [focus, setFocus] = useState(null);
  const [selected, setSelected] = useState(-1);
  const live = useLiveLocation();

  useEffect(() => {
    if (stops.length < 2) return;
    setDirections(null);
    setError('');
    setFocus(null);
    setSelected(-1);
    const points = stops.map((s) => `${s.lat},${s.lng}`).join('|');
    client
      .get('/directions', { params: { points } })
      .then(({ data }) => setDirections(data))
      .catch((err) => setError(getErrorMessage(err)));
  }, [stops]);

  const steps = useMemo(
    () =>
      (directions?.steps || []).map((s) =>
        s.type === 'arrive' && stops[s.legIndex + 1]?.label
          ? { ...s, instruction: `Arrive at ${stops[s.legIndex + 1].label}` }
          : s
      ),
    [directions, stops]
  );

  const origin = live.location || stops[0];
  const nearby = useMemo(
    () =>
      SAFE_HOTSPOTS.map((h) => ({ ...h, km: haversineKm(origin, h) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 10),
    [origin.lat, origin.lng] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const choosing = stops.length < 2;

  function goTo(h) {
    setStops([{ lat: origin.lat, lng: origin.lng, label: 'Your location' }, { lat: h.lat, lng: h.lng, label: h.label }]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {choosing ? 'Your location' : title || `${stops[0].label || 'Start'} → ${stops[stops.length - 1].label || 'Destination'}`}
          </Text>
          {directions ? (
            <Text style={styles.summary}>
              <Text style={styles.summaryStrong}>{formatDuration(directions.durationMin)}</Text> ({directions.distanceKm} km)
              {directions.source === 'osrm' ? ' · by road' : ' · straight line'}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.map}>
        <FullRouteMap
          stops={stops}
          geometry={directions?.geometry}
          driverLocation={driverLocation}
          myLocation={live.location}
          focus={focus}
        />
      </View>

      <View style={styles.sheet}>
        {choosing ? (
          <>
            <Text style={styles.sheetTitle}>Directions to a safe hotspot</Text>
            <FlatList
              data={nearby}
              keyExtractor={(h) => h.id}
              renderItem={({ item }) => (
                <Pressable style={styles.step} onPress={() => goTo(item)}>
                  <Text style={styles.stepIcon}>🛡️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stepText}>{item.label}</Text>
                    <Text style={styles.stepDistance}>
                      {formatDistance(item.km * 1000)} away · {item.area}
                    </Text>
                  </View>
                  <Text style={styles.go}>Go ›</Text>
                </Pressable>
              )}
            />
          </>
        ) : (
          <>
        <View style={styles.sheetActions}>
          <Pressable style={styles.googleButton} onPress={() => Linking.openURL(googleMapsUrl(stops))}>
            <Text style={styles.googleText}>🧭 Open in Google Maps</Text>
          </Pressable>
          {focus ? (
            <Pressable style={styles.overviewButton} onPress={() => { setFocus(null); setSelected(-1); }}>
              <Text style={styles.overviewText}>Clear</Text>
            </Pressable>
          ) : null}
          {startedFromLocation ? (
            <Pressable style={styles.overviewButton} onPress={() => { setStops(route.params.stops); setDirections(null); }}>
              <Text style={styles.overviewText}>Change</Text>
            </Pressable>
          ) : null}
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!directions && !error ? <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} /> : null}
        {directions && steps.length === 0 ? (
          <Text style={styles.muted}>Turn-by-turn steps aren't available right now — use Google Maps for navigation.</Text>
        ) : null}

        <FlatList
          data={steps}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item, index }) => (
            <Pressable
              style={[styles.step, index === selected && styles.stepActive]}
              onPress={() => {
                setSelected(index);
                setFocus({ ...item.location });
              }}
            >
              <Text style={styles.stepIcon}>{stepIcon(item)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.stepText, item.type === 'arrive' && styles.stepArrive]}>{item.instruction}</Text>
                {item.distanceM > 0 ? <Text style={styles.stepDistance}>{formatDistance(item.distanceM)}</Text> : null}
              </View>
            </Pressable>
          )}
        />
        <Text style={styles.credit}>Directions © OpenStreetMap contributors · OSRM</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 12,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { color: colors.primary, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '800', color: colors.text },
  summary: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  summaryStrong: { color: colors.success, fontWeight: '800' },
  map: { flex: 1.3, minHeight: 280 },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    marginTop: -14,
    paddingTop: 14,
    paddingHorizontal: 16,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  sheetActions: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  googleButton: { flex: 1, backgroundColor: '#1A73E8', borderRadius: 22, paddingVertical: 11, alignItems: 'center' },
  googleText: { color: '#fff', fontWeight: '800' },
  overviewButton: { borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingVertical: 11, paddingHorizontal: 16 },
  overviewText: { color: colors.text, fontWeight: '700' },
  step: { flexDirection: 'row', gap: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border, alignItems: 'center' },
  stepActive: { backgroundColor: '#E8F0FE', marginHorizontal: -16, paddingHorizontal: 16 },
  stepIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  stepText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  stepArrive: { color: colors.danger },
  stepDistance: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  muted: { color: colors.textMuted, fontSize: 13, marginTop: 8 },
  error: { color: colors.danger, marginTop: 8 },
  sheetTitle: { fontSize: 15, fontWeight: '800', color: colors.text, marginBottom: 4 },
  go: { color: '#1A73E8', fontWeight: '800' },
  credit: { fontSize: 10, color: colors.textMuted, textAlign: 'center', paddingVertical: 6 },
});
