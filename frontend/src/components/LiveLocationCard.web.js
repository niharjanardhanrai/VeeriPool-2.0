import { useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapContainer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colors } from '../theme/colors';
import MapTiles from './MapTiles';
import ExpandMapButton from './ExpandMapButton';

// "You are here" map on real OpenStreetMap tiles, following the device's
// live GPS position (useLiveLocation). Native uses LiveLocationCard.js.
const youIcon = L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:${colors.info};border:3px solid white;box-shadow:0 0 0 2px ${colors.info}66;"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

// Centers on the first fix, then keeps panning to follow the device.
function Follow({ position }) {
  const map = useMap();
  const centered = useRef(false);
  useEffect(() => {
    if (!position) return;
    if (!centered.current) {
      map.setView(position, 17);
      centered.current = true;
    } else {
      map.panTo(position);
    }
  }, [position?.[0], position?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function LiveLocationCard({ location, error, onRetry, title = 'Your live location', height = 220 }) {
  const position = location ? [location.lat, location.lng] : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.liveDot, { backgroundColor: location && !error ? colors.success : colors.border }]} />
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={[styles.mapWrap, { height }]}>
        <MapContainer
          center={position || [20, 0]}
          zoom={position ? 17 : 2}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={false}
          attributionControl={false}
        >
          <MapTiles />
          {position ? (
            <>
              {location.accuracy ? (
                <Circle
                  center={position}
                  radius={location.accuracy}
                  pathOptions={{ color: colors.info, weight: 1, fillOpacity: 0.12 }}
                />
              ) : null}
              <Marker position={position} icon={youIcon} />
            </>
          ) : null}
          <Follow position={position} />
        </MapContainer>
        <Text style={styles.attribution}>© OpenStreetMap</Text>
        {location ? <ExpandMapButton points={[{ ...location, label: 'Your location' }]} /> : null}
      </View>

      {error ? (
        <View style={styles.errorRow}>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <Text style={styles.meta}>
          {location
            ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${
                location.accuracy ? ` · ±${Math.round(location.accuracy)} m` : ''
              }`
            : 'Getting your location… allow location access if your browser asks.'}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontWeight: '700', color: colors.text, fontSize: 14 },
  mapWrap: { borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, position: 'relative' },
  attribution: {
    position: 'absolute',
    bottom: 2,
    right: 6,
    fontSize: 9,
    color: colors.textMuted,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 4,
    zIndex: 1000,
  },
  meta: { color: colors.textMuted, fontSize: 12 },
  errorRow: { gap: 8 },
  error: { color: colors.danger, fontSize: 12 },
  retry: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
});
