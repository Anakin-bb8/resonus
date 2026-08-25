/**
 * What a "browse everything" screen sits in.
 *
 * On its own it is a screen: it starts under the status bar and there is a
 * back arrow above it. Inside the Library tab it is the body of somebody
 * else's screen, and the chrome above it is theirs — the tab has already taken
 * the inset and already says which section you are in, so a second header
 * there would be the section named twice.
 *
 * Only the frame is shared. Each screen keeps its own header markup, because
 * what goes in it differs (a view menu, an add button, the swap the song list
 * does while selecting) and hiding that behind props made the headers harder
 * to read than the four lines it saved.
 */
import { type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { themed } from '@/theme';

export function BrowseFrame({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  if (embedded) return <View style={styles.frame}>{children}</View>;
  return (
    <SafeAreaView style={styles.frame} edges={['top']}>
      {children}
    </SafeAreaView>
  );
}

const styles = themed((colors) => ({
  frame: { flex: 1, backgroundColor: colors.background },
}));
