/**
 * Settings › Theme: the appearance (dark or light) and the accent colour. Both
 * apply the moment they are chosen.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { SelectList, SettingsPage, settingsStyles } from '@/components/SettingsUI';
import { useT } from '@/i18n';
import { ACCENT_OPTIONS, useSettings } from '@/store/settings';
import { fontSize, spacing, themed, useTheme, type ThemeMode } from '@/theme';

export default function ThemeSettings() {
  // Repaints on a change of appearance or accent: a stack keeps this screen
  // mounted while you are on another one, out of reach of anything else.
  useTheme();
  const t = useT();
  const accentColor = useSettings((s) => s.accentColor);
  const setAccentColor = useSettings((s) => s.setAccentColor);
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);

  return (
    <SettingsPage title={t('Theme')}>
      <ScrollView contentContainerStyle={settingsStyles.content}>
        {/* "Mode" and not "Appearance": Appearance is the screen this one hangs
            off, and two headings with the same word one level apart read as a
            mistake. */}
        <Text style={styles.label}>{t('Mode')}</Text>
        <SelectList<ThemeMode>
          collapsible={false}
          value={themeMode}
          onChange={setThemeMode}
          options={[
            { value: 'dark', label: t('Dark (default)') },
            { value: 'light', label: t('Light (experimental)') },
          ]}
        />

        <Text style={[styles.label, styles.secondLabel]}>{t('Accent color')}</Text>
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
  secondLabel: { marginTop: spacing.xl },
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
