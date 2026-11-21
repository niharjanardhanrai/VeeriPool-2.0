import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colors } from '../theme/colors';
import MapTiles from './MapTiles';
import ExpandMapButton from './ExpandMapButton';

// Web build of MiniMap — real OpenStreetMap tiles via Leaflet (free, no API
// key: https://www.openstreetmap.org/copyright), replacing the SVG grid
// used on native. Metro picks this file automatically for web builds
// because of the ".web.js" extension; native keeps the plain SVG version in
// MiniMap.js. Route line uses real road geometry from ORS when the backend
// has an ORS_API_KEY configured (ride.route.waypoints), otherwise falls
// back to a straight line between pickup and drop-off.
function dot(color, pulse, size = 16) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 2px ${color}55;${
      pulse ? 'animation:veripool-pulse 1.6s ease-in-out infinite;' : ''
    }"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const pickupIcon = dot(colors.primary, false);
const dropoffIcon = dot(colors.danger, false);
const driverIcon = dot(colors.info, true);
const stopIcon = dot(colors.accent, false, 11);

function FitBounds({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 15);
      return;
    }
    map.fitBounds(points, { padding: [30, 30] });
  }, [JSON.stringify(points)]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

let styleInjected = false;
function ensurePulseStyle() {
  if (styleInjected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.innerHTML = `@keyframes veripool-pulse { 0% { transform: scale(1); opacity: 1; } 70% { transform: scale(1.8); opacity: 0.35; } 100% { transform: scale(1); opacity: 1; } }`;
  document.head.appendChild(style);
  styleInjected = true;
}

// `stops`: intermediate stops on a posted route, drawn as small dots with
// their name on hover.
export default function MiniMap({ pickup, dropoff, driverLocation, waypoints, stops = [], height = 260, showHint = true, expandable = true }) {
  ensurePulseStyle();
  if (!pickup || !dropoff) return null;

  const pickupPos = [pickup.lat, pickup.lng];
  const dropoffPos = [dropoff.lat, dropoff.lng];
  const driverPos = driverLocation ? [driverLocation.lat, driverLocation.lng] : null;

  const routeLine =
    waypoints && waypoints.length > 1 ? waypoints.map((p) => [p.lat, p.lng]) : [pickupPos, dropoffPos];

  const boundsPoints = [pickupPos, dropoffPos, ...stops.map((s) => [s.lat, s.lng]), ...(driverPos ? [driverPos] : [])];

  return (
    <View style={[styles.wrapper, { height }]}>
      <MapContainer
        center={pickupPos}
        zoom={15}
        style={{ height: '100%', width: '100%', borderRadius: 12 }}
        scrollWheelZoom={false}
        attributionControl={false}
      >
        <MapTiles />
        <Polyline positions={routeLine} pathOptions={{ color: colors.primary, weight: 4, opacity: 0.7 }} />
        {stops.map((s) => (
          <Marker key={`${s.lat},${s.lng}`} position={[s.lat, s.lng]} icon={stopIcon}>
            {s.label ? <Tooltip>{s.label}</Tooltip> : null}
          </Marker>
        ))}
        <Marker position={pickupPos} icon={pickupIcon}>
          {pickup.label ? <Tooltip>{pickup.label}</Tooltip> : null}
        </Marker>
        <Marker position={dropoffPos} icon={dropoffIcon}>
          {dropoff.label ? <Tooltip>{dropoff.label}</Tooltip> : null}
        </Marker>
        {driverPos ? <Marker position={driverPos} icon={driverIcon} /> : null}
        <FitBounds points={boundsPoints} />
      </MapContainer>
      <Text style={styles.attribution}>© OpenStreetMap</Text>
      {expandable ? <ExpandMapButton points={[pickup, ...stops, dropoff]} driverLocation={driverLocation} /> : null}
      {showHint && !driverLocation ? <Text style={styles.hint}>Car location will appear here once tracking starts</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
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
  hint: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 11,
    color: colors.text,
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingVertical: 2,
    zIndex: 1000,
  },
});
