/**
 * Where this build is going, fixed when the bundle is made.
 *
 * The APK on GitHub updates itself: it asks GitHub for a newer release and
 * can hand one to Android's installer. A build made by F-Droid
 * (`EXPO_PUBLIC_DISTRIBUTION=fdroid`) must not. F-Droid updates it, its
 * policy forbids an app fetching its own code, and an APK from GitHub would
 * not even install over one F-Droid signed. The same variable takes the
 * install permission out of the manifest (`plugins/withTrimmedPermissions`).
 */
export const DISTRIBUTION = process.env.EXPO_PUBLIC_DISTRIBUTION === 'fdroid' ? 'fdroid' : 'github';

/** Whether the app looks for and installs its own updates. */
export const SELF_UPDATES = DISTRIBUTION === 'github';
