/**
 * Settings as a tab (Settings › Appearance › Navigation bar, off by default):
 * the same screen the gear on Home opens, with no back arrow.
 */
import SettingsScreen from '../settings/index';

export default function OptionsTab() {
  return <SettingsScreen asTab />;
}
