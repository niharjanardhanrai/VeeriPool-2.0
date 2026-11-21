import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';

// Real device GPS — Expo Location on a phone (the library the paper uses,
// Sec. II-A "Tracking"), and the browser's own Geolocation API on web.
// expo-location's web watchPositionAsync mixes up its internal watch id with
// the browser's, so callbacks get dropped; on web we call the browser
// directly instead. Browser geolocation needs https or localhost.
const isWeb = Platform.OS === 'web';

function toPoint(pos) {
  return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
}

function webError(err) {
  if (err?.code === 1) {
    return new Error('Location permission was denied. Click the location icon in the address bar and choose Allow.');
  }
  if (err?.code === 2) {
    return new Error(
      "Your device couldn't determine its position. On Windows, turn on Settings → Privacy & security → Location."
    );
  }
  if (err?.code === 3) return new Error('Timed out waiting for a GPS fix. Still trying…');
  return new Error(err?.message || 'Location unavailable');
}

async function ensureNativePermission() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission was denied. Allow it in your phone settings.');
  }
}

// One-off fix, e.g. to use the rider's current spot as their pickup.
export async function getCurrentPoint() {
  if (isWeb) {
    if (!navigator?.geolocation) throw new Error('This browser has no GPS support');
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(toPoint(pos)),
        (err) => reject(webError(err)),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });
  }
  await ensureNativePermission();
  return toPoint(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
}

// Continuous updates while a ride is active. Returns a stop() function that
// is safe to call before the watch has finished starting.
export function watchPoint(onPoint, onError) {
  if (isWeb) {
    if (!navigator?.geolocation) {
      onError?.(new Error('This browser has no GPS support'));
      return () => {};
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => onPoint(toPoint(pos)),
      (err) => onError?.(webError(err)),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }

  let subscription = null;
  let stopped = false;

  (async () => {
    try {
      await ensureNativePermission();
      if (stopped) return;
      const sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (pos) => onPoint(toPoint(pos))
      );
      if (stopped) sub.remove();
      else subscription = sub;
    } catch (err) {
      if (!stopped) onError?.(err);
    }
  })();

  return () => {
    stopped = true;
    subscription?.remove();
  };
}

// React hook: the device's live position, updating as it moves. `error` is
// a human-readable reason when GPS isn't available; `retry` starts over
// (e.g. after the user allows the permission).
export function useLiveLocation(enabled = true) {
  const [location, setLocation] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    setError('');
    return watchPoint(
      (point) => {
        setError('');
        setLocation(point);
      },
      (err) => setError(err.message)
    );
  }, [enabled, attempt]);

  return { location, error, retry: () => setAttempt((n) => n + 1) };
}
