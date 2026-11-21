import { View, Text, StyleSheet } from 'react-native';
import Svg, { Polyline, Circle, Text as SvgText } from 'react-native-svg';
import { colors } from '../theme/colors';
import ExpandMapButton from './ExpandMapButton';

// Native (iOS/Android/Expo Go) fallback — a dependency-free SVG grid stand-in
// for the paper's "Expo map (Google maps)" (Sec. II-A "Map"). react-native-maps
// would need a Google Maps API key on Android, so this avoids that entirely.
// The web build (MiniMap.web.js) uses real free OpenStreetMap tiles instead —
// Metro picks whichever file matches the platform automatically.
const SIZE = 260;
const PADDING = 30;

export default function MiniMap({ pickup, dropoff, driverLocation, waypoints, stops = [], height = SIZE, showHint = true, expandable = true }) {
  if (!pickup || !dropoff) return null;

  const routePoints = waypoints && waypoints.length > 1 ? waypoints : [pickup, dropoff];
  const lats = [...routePoints.map((p) => p.lat), driverLocation?.lat].filter((v) => typeof v === 'number');
  const lngs = [...routePoints.map((p) => p.lng), driverLocation?.lng].filter((v) => typeof v === 'number');
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 0.001;
  const spanLng = maxLng - minLng || 0.001;

  function project(point) {
    const x = PADDING + ((point.lng - minLng) / spanLng) * (SIZE - PADDING * 2);
    // invert y: higher latitude = further "north" = smaller y on screen
    const y = height - PADDING - ((point.lat - minLat) / spanLat) * (height - PADDING * 2);
    return { x, y };
  }

  const p = project(pickup);
  const d = project(dropoff);
  const driverPoint = driverLocation ? project(driverLocation) : null;
  const routeLine = routePoints.map((pt) => project(pt)).map(({ x, y }) => `${x},${y}`).join(' ');
  const stopPoints = stops.map((s) => project(s));

  return (
    <View style={[styles.wrapper, { height }]}>
      <Svg width="100%" height={height} viewBox={`0 0 ${SIZE} ${height}`}>
        <Polyline
          points={routeLine}
          fill="none"
          stroke={colors.border}
          strokeWidth={3}
          strokeDasharray={routePoints.length > 2 ? undefined : '6,6'}
        />

        {stopPoints.map((s, i) => (
          <Circle key={i} cx={s.x} cy={s.y} r={4} fill={colors.accent} />
        ))}

        <Circle cx={p.x} cy={p.y} r={8} fill={colors.primary} />
        <SvgText x={p.x} y={p.y - 12} fontSize="11" fill={colors.text} textAnchor="middle">
          Pickup
        </SvgText>

        <Circle cx={d.x} cy={d.y} r={8} fill={colors.danger} />
        <SvgText x={d.x} y={d.y - 12} fontSize="11" fill={colors.text} textAnchor="middle">
          Drop-off
        </SvgText>

        {driverPoint ? (
          <>
            <Circle cx={driverPoint.x} cy={driverPoint.y} r={10} fill={colors.info} opacity={0.25} />
            <Circle cx={driverPoint.x} cy={driverPoint.y} r={6} fill={colors.info} />
          </>
        ) : null}
      </Svg>
      {showHint && !driverLocation ? <Text style={styles.hint}>Car location will appear here once tracking starts</Text> : null}
      {expandable ? <ExpandMapButton points={[pickup, ...stops, dropoff]} driverLocation={driverLocation} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  hint: {
    position: 'absolute',
    bottom: 8,
    fontSize: 11,
    color: colors.textMuted,
  },
});
