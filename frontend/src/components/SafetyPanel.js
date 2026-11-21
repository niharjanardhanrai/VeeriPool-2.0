import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Share, Platform, ActivityIndicator } from 'react-native';
import client from '../api/client';
import { getSocket } from '../api/socket';
import { getErrorMessage } from '../api/errors';
import { colors } from '../theme/colors';

const KIND = {
  off_route: 'left the planned route',
  wrong_way: 'heading away from your drop-off',
  long_stop: 'stopped for a while away from a safe spot',
  sos: 'SOS',
};

// The rider's side of route-deviation monitoring (backend
// services/safetyMonitor.js): monitoring status, the "Are you safe?"
// check-in with its countdown, an SOS button, and a guardian link that
// anyone can open in a browser to follow the trip live.
export default function SafetyPanel({ ride, onRideChange }) {
  const [checkIn, setCheckIn] = useState(null); // { message, endsAt }
  const [escalated, setEscalated] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [error, setError] = useState('');

  const safety = ride.safety;
  const active = ride.status === 'accepted';

  // A check-in can already be waiting when the screen opens.
  useEffect(() => {
    const awaiting = [...(safety?.alerts || [])].reverse().find((a) => a.status === 'awaiting');
    if (awaiting && safety?.profile && !checkIn) {
      const endsAt = new Date(awaiting.at).getTime() + safety.profile.responseSec * 1000;
      setCheckIn({ message: `Your car has ${KIND[awaiting.type]} (${awaiting.detail}). Are you safe?`, endsAt });
    }
  }, [safety]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const socket = getSocket();
    function onAlert(p) {
      if (String(p.rideId) !== String(ride.id)) return;
      setEscalated('');
      setCheckIn({ message: p.message, endsAt: Date.now() + (p.deadline - new Date(p.alert.at).getTime()) });
    }
    function onEscalated(p) {
      if (String(p.rideId) !== String(ride.id)) return;
      setCheckIn(null);
      setEscalated(p.message);
    }
    socket?.on('ride:safety-alert', onAlert);
    socket?.on('ride:safety-escalated', onEscalated);
    return () => {
      socket?.off('ride:safety-alert', onAlert);
      socket?.off('ride:safety-escalated', onEscalated);
    };
  }, [ride.id]);

  useEffect(() => {
    if (!checkIn) return undefined;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((checkIn.endsAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [checkIn]);

  async function answer(kind) {
    setBusy(true);
    setError('');
    try {
      const { data } = await client.post(`/rides/${ride.id}/safety/${kind === 'sos' ? 'sos' : 'respond'}`, kind === 'sos' ? {} : { answer: kind });
      setCheckIn(null);
      if (kind !== 'ok') setEscalated(data.message);
      const fresh = await client.get(`/rides/${ride.id}`);
      onRideChange?.(fresh.data.ride);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function shareTrip() {
    setError('');
    try {
      const { data } = await client.post(`/rides/${ride.id}/share`);
      setShareUrl(data.url);
      const message = `Follow my VeriPool ride live: ${data.url}`;
      if (Platform.OS === 'web') {
        if (navigator.share) await navigator.share({ title: 'My VeriPool trip', text: message, url: data.url }).catch(() => {});
        else await navigator.clipboard?.writeText(data.url).catch(() => {});
      } else {
        await Share.share({ message });
      }
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  if (!active && !safety?.alerts?.length) return null;

  const monitoring = safety?.monitoring && ride.stage === 'ride_started';
  const reading = safety?.lastReading;

  return (
    <View style={styles.wrap}>
      {checkIn ? (
        <View style={styles.checkIn}>
          <Text style={styles.checkInTitle}>⚠️ Are you safe?</Text>
          <Text style={styles.checkInText}>{checkIn.message}</Text>
          <Text style={styles.checkInTimer}>
            If you don't answer in {secondsLeft}s, support is alerted with your live location.
          </Text>
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnOk]} onPress={() => answer('ok')} disabled={busy}>
              <Text style={styles.btnText}>I'm OK</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnHelp]} onPress={() => answer('help')} disabled={busy}>
              <Text style={styles.btnText}>Get help</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {escalated ? (
        <View style={styles.escalated}>
          <Text style={styles.escalatedText}>🚨 {escalated}</Text>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.title}>
          🛡️ {monitoring ? 'Route monitored' : 'Route monitoring'}
          {safety?.night ? ' · 🌙 night mode' : ''}
        </Text>
        <Text style={styles.text}>
          {monitoring
            ? `Watching for detours over ${safety.profile.corridorM} m, wrong-way driving and long stops.${
                reading ? ` ${reading.offRouteM} m from the route · ${(reading.remainingM / 1000).toFixed(1)} km to go.` : ''
              }`
            : ride.stage === 'ride_ended' || ride.stage === 'finished'
            ? 'Monitoring has ended for this ride.'
            : 'Starts automatically when the driver taps "Start ride".'}
        </Text>
        {active ? (
          <View style={styles.row}>
            <Pressable style={[styles.btn, styles.btnShare]} onPress={shareTrip}>
              <Text style={styles.btnText}>📤 Share live trip</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.btnHelp]} onPress={() => answer('sos')} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.btnText}>🆘 SOS</Text>}
            </Pressable>
          </View>
        ) : null}
        {shareUrl ? (
          <Text selectable style={styles.link}>
            Link {Platform.OS === 'web' ? 'copied' : 'ready'}: {shareUrl}
          </Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 8 },
  title: { fontWeight: '800', color: colors.primary, fontSize: 14 },
  text: { color: colors.textMuted, fontSize: 12 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  btnOk: { backgroundColor: colors.success },
  btnHelp: { backgroundColor: colors.danger },
  btnShare: { backgroundColor: colors.info },
  btnText: { color: colors.surface, fontWeight: '800', fontSize: 14 },
  checkIn: { backgroundColor: '#FDF2E0', borderRadius: 14, padding: 16, borderWidth: 2, borderColor: colors.accent, gap: 6 },
  checkInTitle: { fontWeight: '800', fontSize: 16, color: '#7A4B00' },
  checkInText: { color: colors.text, fontSize: 14 },
  checkInTimer: { color: '#7A4B00', fontSize: 12, fontWeight: '600' },
  escalated: { backgroundColor: '#FBE7E5', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: colors.danger },
  escalatedText: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  link: { fontSize: 11, color: colors.info },
  error: { color: colors.danger, fontSize: 12 },
});
