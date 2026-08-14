/**
 * Settings › Theme: the accent colour, applied the moment it is chosen.
 *
 * There is a light appearance too, and everything behind it works — the second
 * palette, `applyThemeMode`, the `themeMode` setting and its writing to disk.
 * What is not here is the two rows that would let anybody reach it, on purpose
 * and for now: it is new and wants looking at on a real screen before it is
 * offered. Putting them back is a `SelectList` over `themeMode`; nothing else
 * has to be undone, so none of what it drives is dead code.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { ACCENT_OPTIONS, useSettings } from '@/store/settings';
import { fontSize, spacing, themed, useTheme } from '@/theme';

export default function ThemeSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const accentColor = useSettings((s) => s.accentColor);
  const setAccentColor = useSettings((s) => s.setAccentColor);

  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        <Text style={styles.label}>{t('Accent color')}</Text>
        <View style={styles.swatches}>
          {ACCENT_OPTIONS.map((opt) => {
            const active = opt.color.toLowerCase() === accentColor.toLowerCase();
            return (
              <Pressable
                key={opt.color}
                onPress={() => setAccentColor(opt.color)}
                accessibilityRole="button"
                accessibilityLabel={t(opt.name)}
                style={[styles.swatch, { backgroundColor: opt.color }, active && styles.swatchActive]}
              >
                {/* The swatches are the colours as named — the vivid ones — in
                    both appearances, so black is always the tick that reads on
                    them. What the light theme paints with is a darkened version
                    of whichever one is picked (see `readableOn` in the theme):
                    the same colour, taken down to where it can be read on
                    white. */}
                {active ? <Ionicons name="checkmark" size={24} color="#000" /> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SettingsPage>
  );
}

const styles = themed((colors) => ({
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.md,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  swatch: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchActive: { borderWidth: 3, borderColor: colors.text },
}));
