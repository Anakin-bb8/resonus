/** Radio card for the Home shelf: the generated icon file when there is one,
 *  the same collage drawn as views when there isn't, artists underneath. */
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { COVER, coverArtUrl } from '@/api/data';
import { Cover } from './Cover';
import { textOn } from '@/lib/radioArt';
import { useRadios, type RadioDef, type RadioArtist } from '@/store/radios';
import { colors, fontSize, radius, spacing, themed, useTheme } from '@/theme';

/** The three covers in the collage: seed first, then similar artists. */
function collageArtists(def: RadioDef): RadioArtist[] {
  return [def.seed, ...def.similar].slice(0, 3);
}

/**
 * The icon as the native module draws it, in views: same layout, so the
 * shelf looks the same on a build without the module as on one with it.
 */
function RadioCollage({
  def,
  width,
  bare,
}: {
  def: RadioDef;
  width: number;
  /** No words on the picture: the screen that wears this as its header says
   *  the name underneath it already. */
  bare?: boolean;
}) {
  const bg = def.color || colors.surfaceHighlight;
  const ink = textOn(bg);
  // The covers as URLs: `coverArt` is a server id, like every other card
  // asks for its picture (see AlbumCard).
  const covers = collageArtists(def).map((a) => coverArtUrl(a.coverArt ?? a.id, COVER.card));
  const sideD = Math.round(width * 0.4);
  const centerD = Math.round(width * 0.6);
  const circle = (uri: string | undefined, size: number, left: number, top: number, key: string) => (
    <Cover
      key={key}
      uri={uri}
      size={size}
      rounded
      placeholderIcon="person-outline"
      transition={0}
      style={{ position: 'absolute', left, top }}
    />
  );
  return (
    <View style={[styles.collage, { width, height: width, backgroundColor: bg }]}>
      {/* Sides first, the seed's own cover on top of them — the same order
          the native renderer paints in, and the same numbers (its 0.10/0.90
          centres): the file and the views are one picture. */}
      {circle(covers[1], sideD, -Math.round(sideD * 0.25), Math.round(width * 0.34), 'left')}
      {circle(covers[2], sideD, width - sideD + Math.round(sideD * 0.25), Math.round(width * 0.34), 'right')}
      {circle(covers[0], centerD, Math.round((width - centerD) / 2), Math.round(width * 0.16), 'center')}
      {bare ? null : (
        <>
          <Text
            style={[styles.collageWord, { color: ink, textShadowColor: shadow(ink) }]}
            numberOfLines={1}
          >
            RADIO
          </Text>
          <Text
            style={[styles.collageName, { color: ink, textShadowColor: shadow(ink) }]}
            numberOfLines={2}
          >
            {def.seed.name}
          </Text>
        </>
      )}
    </View>
  );
}

/** The name sits over covers nobody chose: a shadow keeps it readable on
 *  whichever of them is bright. White on dark ink, black on light. */
function shadow(ink: string): string {
  return ink === '#FFFFFF' ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
}

/** The radio's picture: the generated icon file when there is one, the same
 *  collage drawn as views when there isn't. Shared with the radio screen, so
 *  the shelf and the screen show one image. `cropHeight` turns the square
 *  into a shorter, full-bleed rectangle for the screen's header: the art is
 *  bottom-aligned inside it, so the crop takes the top off — the decorative
 *  RADIO word goes, the artist's name at the bottom stays, untouched. `bare`
 *  is the header's variant: no words at all, since the file would carry the
 *  name baked in and the title underneath says it already. */
export function RadioArt({
  def,
  width,
  cropHeight,
  bare,
}: {
  def: RadioDef;
  width: number;
  cropHeight?: number;
  bare?: boolean;
}) {
  const uri = useRadios((s) => s.icons[def.seed.id]);
  const height = cropHeight ?? width;
  // Corners only when the art is the card's full square: the screen's cover
  // runs edge to edge of the display and has none.
  const frame = {
    width,
    height,
    overflow: 'hidden' as const,
    borderRadius: cropHeight == null ? radius.md : 0,
  };
  const art = !bare && uri ? (
    <Image source={{ uri }} style={{ width, height: width }} contentFit="cover" transition={150} />
  ) : (
    <RadioCollage def={def} width={width} bare={bare} />
  );
  if (height >= width) return <View style={frame}>{art}</View>;
  // The square hangs from the bottom of the rectangle: whatever is cut off
  // is cut from above, which is where the word is.
  return (
    <View style={frame}>
      <View style={{ width, height: width, marginTop: height - width }}>{art}</View>
    </View>
  );
}

export const RadioCard = memo(function RadioCard({
  def,
  width,
}: {
  def: RadioDef;
  width: number;
}) {
  // Memoised, so it has to ask for a repaint on a theme change itself.
  useTheme();
  const similar = def.similar.slice(0, 3).map((a) => a.name);
  const artists = similar.length > 0 ? similar.join(', ') : def.seed.name;

  return (
    <Link href={`/artist-radio/${def.seed.id}`} asChild>
      <Pressable
        style={StyleSheet.flatten([styles.container, { width }])}
        accessibilityRole="button"
        accessibilityLabel={def.seed.name}
      >
        <RadioArt def={def} width={width} />
        <Text style={styles.artists} numberOfLines={1}>
          {artists}
        </Text>
      </Pressable>
    </Link>
  );
});

const styles = themed((t) => ({
  container: { gap: spacing.xs },
  artists: {
    color: t.textSecondary,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  collage: {
    // The radius is the frame's, outside: the collage only has to keep its
    // circles inside the square.
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  collageWord: {
    position: 'absolute',
    right: spacing.md,
    top: spacing.sm,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.5,
    textShadowRadius: 3,
  },
  collageName: {
    color: t.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    textShadowRadius: 4,
  },
}));
