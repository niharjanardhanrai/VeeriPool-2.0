import { Pressable, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';

const withLabel = (p) => ({ lat: p.lat, lng: p.lng, label: p.label || p.address || '' });

// "⤢ Full map" overlay for the small maps — opens FullMapScreen. With two
// or more points it shows the route with turn-by-turn directions; with one
// point (your live location) it lets you pick a safe hotspot to navigate to.
export default function ExpandMapButton({ points, driverLocation }) {
  const navigation = useNavigation();
  return (
    <Pressable
      style={styles.button}
      onPress={() =>
        navigation.navigate('FullMap', {
          stops: points.map(withLabel),
          driverLocation: driverLocation ? { lat: driverLocation.lat, lng: driverLocation.lng } : null,
        })
      }
    >
      <Text style={styles.text}>⤢ Full map</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 1000,
    backgroundColor: colors.surface,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  text: { color: colors.primary, fontWeight: '800', fontSize: 13 },
});
