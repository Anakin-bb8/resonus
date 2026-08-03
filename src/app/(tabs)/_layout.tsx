/**
 * Main tab navigation: Home, Search and Library.
 * Solid bottom bar over the app background.
 *
 * With "Always show the navigation bar" on, the drawing is handed over to
 * `GlobalTabBar`, which sits next to the Stack and so can stay on screen
 * outside the tabs too. One bar either way: two would have to be kept looking
 * identical by hand, and the handover between them showed as a blink of empty
 * space in the middle of every back animation.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useT } from '@/i18n';
import { useSettings } from '@/store/settings';
import { colors, TAB_BAR_HEIGHT } from '@/theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const t = useT();
  const alwaysShowTabs = useSettings((s) => s.alwaysShowTabs);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Tabs
        // `undefined` leaves the navigator's own bar in place; the global one
        // draws nothing while that is the case.
        tabBar={alwaysShowTabs ? () => null : undefined}
        screenOptions={{
          headerShown: false,
          // The tab you are not on stops re-rendering until you go back to it
          // (see the root layout, where the same is done for the stack).
          freezeOnBlur: true,
          // Short crossfade when switching tabs, instead of the default hard
          // cut ('shift' felt slow).
          animation: 'fade',
          transitionSpec: {
            animation: 'timing',
            config: { duration: 80 },
          },
          tabBarActiveTintColor: colors.text,
          tabBarInactiveTintColor: colors.textSecondary,
          sceneStyle: { backgroundColor: colors.background },
          tabBarStyle: {
            position: 'absolute',
            backgroundColor: colors.background,
            borderTopWidth: 0,
            elevation: 0,
            height: TAB_BAR_HEIGHT + insets.bottom,
            paddingTop: 6,
            paddingBottom: insets.bottom,
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: t('Home'),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'home' : 'home-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          options={{
            title: t('Search'),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'search' : 'search-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="library"
          options={{
            title: t('Library'),
            tabBarIcon: ({ focused, color, size }) => (
              <Ionicons name={focused ? 'library' : 'library-outline'} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </View>
  );
}
