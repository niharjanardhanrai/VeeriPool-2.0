import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { MapContainer, Marker, Polyline, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { colors } from '../theme/colors';
import MapTiles from './MapTiles';

function dot(color, size, pulse = false) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 2px ${color}55, 0 1px 4px rgba(0,0,0,.35);${
      pulse ? 'animation:veripool-pulse 1.6s ease-in-out infinite;' : ''
    }"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const startIcon = dot(colors.primary, 18);
const endIcon = dot(colors.danger, 18);
const stopIcon = dot(colors.accent, 13);
const carIcon = dot(colors.info, 18, true);
const meIcon = dot('#1A73E8', 16);
const focusIcon = dot('#111111', 12);

// Fits the whole route once, then flies to a step when one is tapped.
function Camera({ bounds, focus }) {
  const map = useMap();
  const fittedFor = useRef('');
  const routeKey = bounds.length > 1 ? `${bounds[0]}|${bounds[bounds.length - 1]}|${bounds.length}` : '';
  useEffect(() => {
    if (!routeKey || fittedFor.current === routeKey) return;
    map.fitBounds(bounds, { padding: [40, 40] });
    fittedFor.current = routeKey;
  }, [routeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (focus) map.flyTo([focus.lat, focus.lng], 17, { duration: 0.8 });
  }, [focus, map]);
  return null;
}

// Full-screen Leaflet map: the road route, every stop, the car, the
// viewer's own GPS position, and the step currently selected in the list.
export default function FullRouteMap({ stops, geometry, driverLocation, myLocation, focus }) {
  const line = (geometry?.length > 1 ? geometry : stops).map((p) => [p.lat, p.lng]);
  const last = stops.length - 1;

  return (
    <View style={{ flex: 1 }}>
      <MapContainer center={line[0]} zoom={14} style={{ height: '100%', width: '100%' }} zoomControl>
        <MapTiles />
        <Polyline positions={line} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.9 }} />
        <Polyline positions={line} pathOptions={{ color: '#1A73E8', weight: 6, opacity: 0.95 }} />
        {stops.map((s, i) => (
          <Marker key={`${s.lat},${s.lng},${i}`} position={[s.lat, s.lng]} icon={i === 0 ? startIcon : i === last ? endIcon : stopIcon}>
            {s.label ? <Tooltip direction="top">{s.label}</Tooltip> : null}
          </Marker>
        ))}
        {driverLocation ? (
          <Marker position={[driverLocation.lat, driverLocation.lng]} icon={carIcon}>
            <Tooltip direction="top">Car</Tooltip>
          </Marker>
        ) : null}
        {myLocation ? (
          <Marker position={[myLocation.lat, myLocation.lng]} icon={meIcon}>
            <Tooltip direction="top">You</Tooltip>
          </Marker>
        ) : null}
        {focus ? <Marker position={[focus.lat, focus.lng]} icon={focusIcon} /> : null}
        <Camera bounds={line} focus={focus} />
      </MapContainer>
    </View>
  );
}
