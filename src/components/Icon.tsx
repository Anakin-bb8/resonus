/**
 * The app's icons: Phosphor, spoken to in Ionicons names.
 *
 * Every screen was written against Ionicons, whose names say both what the
 * icon is and whether it is filled (`heart`) or drawn in outline
 * (`heart-outline`). `icon-map.json` keeps that vocabulary and says which
 * Phosphor icon, and which of its two weights, answers to each name, so the
 * call sites stay as they were. A name the map doesn't know is drawn by
 * Ionicons, which is what a new icon looks like until it is added there and
 * `pnpm icons` is run.
 */
import { createIconSet } from '@expo/vector-icons';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import MAP from './icon-map.json';
import { FILL, REGULAR } from './iconGlyphs';

const Regular = createIconSet(REGULAR, 'phosphor', require('../../assets/fonts/Phosphor.ttf'));
const Fill = createIconSet(FILL, 'phosphor-fill', require('../../assets/fonts/Phosphor-Fill.ttf'));

const map = MAP as unknown as Record<string, [string, 'r' | 'f']>;

type Props = ComponentProps<typeof Ionicons>;

export default function Icon({ name, ...props }: Props) {
  const to = map[name as string];
  if (!to) return <Ionicons name={name} {...props} />;
  const [glyph, weight] = to;
  return weight === 'f' ? <Fill name={glyph} {...props} /> : <Regular name={glyph} {...props} />;
}

/** The names `Icon` takes, for props typed as `keyof typeof Icon.glyphMap`. */
Icon.glyphMap = Ionicons.glyphMap;
