import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// Native (Expo Go) version of the live-location card. There's no free tile
// map on native without a Google Maps key (see MiniMap.js), so this shows the
// live coordinates instead; the web build (LiveLocationCard.web.js) draws
// them on OpenStreetMap.
export default function LiveLocationCard({ location, error, onRetry, title = 'Your live location' }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.liveDot, { backgroundColor: location && !error ? colors.success : colors.border }]} />
        <Text style={styles.title}>{title}</Text>
      </View>
      {error ? (
        <>
          <Text style={styles.error}>{error}</Text>
          <Pressable onPress={onRetry} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </>
      ) : location ? (
        <>
          <Text style={styles.coords}>
            {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
          </Text>
          {location.accuracy ? <Text style={styles.meta}>Accurate to ±{Math.round(location.accuracy)} m</Text> : null}
        </>
      ) : (
        <Text style={styles.meta}>Getting your location…</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  title: { fontWeight: '700', color: colors.text, fontSize: 14 },
  coords: { fontSize: 18, fontWeight: '800', color: colors.primary },
  meta: { color: colors.textMuted, fontSize: 12 },
  error: { color: colors.danger, fontSize: 12 },
  retry: { alignSelf: 'flex-start', borderWidth: 1, borderColor: colors.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  retryText: { color: colors.primary, fontWeight: '700', fontSize: 12 },
});
