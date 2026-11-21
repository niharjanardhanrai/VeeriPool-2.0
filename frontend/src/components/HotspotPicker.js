import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { SAFE_HOTSPOTS, AREAS } from '../utils/hotspots';

// Area tabs (Nitte / Karkala / Mangaluru) over a wrap of hotspot chips.
// `selectedIds` lets the same picker show several picks (e.g. via-stops);
// `leading` renders extra chips before the hotspots (e.g. "My location").
export default function HotspotPicker({ selectedIds = [], onPick, disabledIds = [], leading = null, tone = 'primary', initialArea }) {
  const [area, setArea] = useState(initialArea || AREAS[0]);
  const activeStyle = tone === 'danger' ? styles.chipDanger : tone === 'info' ? styles.chipInfo : styles.chipPrimary;

  return (
    <View>
      <View style={styles.tabs}>
        {AREAS.map((a) => (
          <Pressable key={a} style={[styles.tab, area === a && styles.tabActive]} onPress={() => setArea(a)}>
            <Text style={[styles.tabText, area === a && styles.tabTextActive]}>{a}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.chips}>
        {leading}
        {SAFE_HOTSPOTS.filter((h) => h.area === area).map((h) => {
          const selected = selectedIds.includes(h.id);
          const disabled = disabledIds.includes(h.id);
          return (
            <Pressable
              key={h.id}
              style={[styles.chip, selected && activeStyle, disabled && styles.chipDisabled]}
              onPress={() => onPick(h)}
              disabled={disabled}
            >
              <Text style={[styles.chipText, selected && styles.chipTextActive]}>{h.night ? '🌙 ' : ''}{h.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export const chipStyles = StyleSheet.create({
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextActive: { color: colors.surface },
});

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 10, padding: 3, marginBottom: 10 },
  tab: { flex: 1, paddingVertical: 7, paddingHorizontal: 2, borderRadius: 8, alignItems: 'center' },
  tabActive: { backgroundColor: colors.surface },
  tabText: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: colors.primary, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: chipStyles.chip,
  chipPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipDanger: { backgroundColor: colors.danger, borderColor: colors.danger },
  chipInfo: { backgroundColor: colors.info, borderColor: colors.info },
  chipDisabled: { opacity: 0.35 },
  chipText: chipStyles.chipText,
  chipTextActive: chipStyles.chipTextActive,
});
