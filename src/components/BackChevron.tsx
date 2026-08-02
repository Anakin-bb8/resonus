/**
 * The back chevron every screen's top bar draws.
 *
 * A tap goes back one screen, as it always did. A long press goes Home and
 * drops the whole pile on the way: an artist, its album, another artist off a
 * track and a genre from there is four taps back to somewhere you can search
 * from (#96). Home and not the tab the app opens on, which may be the Library:
 * "back" landing on a list of albums when you came from an artist is a riddle,
 * not a shortcut.
 *
 * Nothing on screen announces the long press, which is why it is a shortcut and
 * not the answer: whoever wants the way out in plain sight turns on the
 * navigation bar in Settings › Appearance.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useT } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { colors } from '@/theme';

interface Props {
  size?: number;
  color?: string;
  /** For the screens whose chevron reads as "close" rather than "back". */
  label?: string;
  style?: StyleProp<ViewStyle>;
  /** Where a tap goes, when it is not simply one screen back. */
  onPress?: () => void;
}

export function BackChevron({ size = 26, color = colors.text, label, style, onPress }: Props) {
  const router = useRouter();
  const t = useT();
  return (
    <Pressable
      hitSlop={12}
      style={style}
      accessibilityRole="button"
      accessibilityLabel={label ?? t('Back')}
      accessibilityHint={t('Hold to go Home')}
      onPress={onPress ?? (() => router.back())}
      onLongPress={() => {
        haptic('medium');
        // `canDismiss`, not `canGoBack`: the second is true wherever there is
        // history at all, and popping a stack that isn't there is the
        // navigator warning about POP_TO_TOP going unhandled.
        if (router.canDismiss()) router.dismissAll();
        router.navigate('/');
      }}
    >
      <Ionicons name="chevron-back" size={size} color={color} />
    </Pressable>
  );
}
