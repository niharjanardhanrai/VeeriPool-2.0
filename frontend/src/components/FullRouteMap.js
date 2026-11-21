import { View } from 'react-native';
import MiniMap from './MiniMap';

// Native fallback for the full-screen map: the SVG MiniMap drawn larger
// along the road geometry. The web build uses FullRouteMap.web.js (Leaflet).
export default function FullRouteMap({ stops, geometry, driverLocation }) {
  return (
    <View style={{ flex: 1, padding: 12 }}>
      <MiniMap
        pickup={stops[0]}
        dropoff={stops[stops.length - 1]}
        stops={stops.slice(1, -1)}
        waypoints={geometry}
        driverLocation={driverLocation}
        height={360}
        showHint={false}
        expandable={false}
      />
    </View>
  );
}
