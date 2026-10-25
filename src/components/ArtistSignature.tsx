import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';

import { useT } from '@/i18n';
import { getArtistSignature } from '@/lib/signatureCache';
import { colors, fontSize, spacing } from '@/theme';
import { useSettings } from '@/store/settings';
import { publicHttpsUrl } from '@/lib/artworkSources';

/** The real name remains accessible and visible until an autograph has drawn. */
export function ArtistSignature({ name, width }: { name: string; width: number }) {
  const t = useT();
  const enabled = useSettings((s) => s.artistSignaturesEnabled);
  const api = useSettings((s) => s.artistSignaturesApi);
  const { data } = useQuery({
    queryKey: ['artist-signature', api, name],
    queryFn: () => getArtistSignature(name, api),
    enabled: enabled && !!publicHttpsUrl(api),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const [displayed, setDisplayed] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const signature = enabled && publicHttpsUrl(api) ? data : null;
  const shown = !!signature && displayed === signature.imageUrl && failed !== signature.imageUrl;
  const imageWidth = Math.min(280, width - spacing.lg * 2);
  return (
    <Pressable
      accessibilityRole={shown ? 'button' : undefined}
      accessibilityLabel={name}
      accessibilityHint={shown ? t('Show signature source') : undefined}
      disabled={!shown}
      onPress={() => Alert.alert(name, signature?.attribution || name)}
      style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.md, minHeight: 104, justifyContent: 'flex-end', alignItems: 'center' }}
    >
      {shown ? <View style={{ height: 88 }} /> : (
        <Text numberOfLines={2} style={{ color: colors.text, fontSize: fontSize.xxl, fontWeight: '600', textAlign: 'center' }}>{name}</Text>
      )}
      {signature && failed !== signature.imageUrl ? (
        <Image
          source={{ uri: signature.imageUrl }}
          style={{ position: 'absolute', left: (width - imageWidth) / 2, bottom: spacing.md, width: imageWidth, height: 88, opacity: shown ? 1 : 0 }}
          contentFit="contain"
          contentPosition="bottom"
          tintColor={colors.text}
          cachePolicy="memory-disk"
          onDisplay={() => setDisplayed(signature.imageUrl)}
          onError={() => setFailed(signature.imageUrl)}
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}
