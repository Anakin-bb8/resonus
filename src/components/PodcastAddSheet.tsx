/** Sheet to add a podcast: paste the address of a feed. */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { refreshChannel } from '@/api/podcasts';
import { useT } from '@/i18n';
import { colors, fontSize, radius, spacing, themed } from '@/theme';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onAdded: () => void;
}

export function PodcastAddSheet({ visible, onCancel, onAdded }: Props) {
  const t = useT();
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resets fields every time it opens.
  useEffect(() => {
    if (visible) {
      setFeedUrl('');
      setError(null);
      setBusy(null);
    }
  }, [visible]);

  // Errors go on the sheet: a toast would be hidden under the modal.
  async function run(feed: string) {
    setBusy(feed);
    setError(null);
    try {
      await refreshChannel(feed);
      onAdded();
      onCancel();
    } catch {
      setError(t("Couldn't read that feed."));
    } finally {
      setBusy(null);
    }
  }

  const pasted = feedUrl.trim();
  const urlOk = /^https?:\/\//i.test(pasted);
  const showUrlError = pasted.length > 0 && !urlOk;
  const canAdd = urlOk && busy === null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable hitSlop={12} onPress={onCancel}>
            <Text style={[styles.headerAction, { color: colors.accent }]}>{t('Cancel')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('Add podcast')}</Text>
          <Pressable hitSlop={12} disabled={!canAdd} onPress={() => void run(pasted)}>
            <Text
              style={[styles.headerAction, { color: colors.accent }, !canAdd && styles.disabled]}
            >
              {t('Add')}
            </Text>
          </Pressable>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>{t('Feed URL')}</Text>
            <TextInput
              style={styles.input}
              value={feedUrl}
              onChangeText={setFeedUrl}
              placeholder="https://…"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
            />
            {busy !== null ? (
              <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.accent} />
            ) : showUrlError ? (
              <Text style={styles.error}>
                {t('The feed URL must start with http:// or https://')}
              </Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = themed((colors) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: '500' },
  headerAction: { color: colors.accent, fontSize: fontSize.md, fontWeight: '600' },
  disabled: { color: colors.textMuted },
  content: { padding: spacing.lg, gap: spacing.sm },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '500',
    marginTop: spacing.md,
  },
  input: {
    backgroundColor: colors.surfaceHighlight,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: fontSize.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  error: { color: colors.danger, fontSize: fontSize.sm, marginTop: spacing.xs },
}));
