/**
 * Which of the three tabs the screens on top of it came from (#96).
 *
 * A stack is opened from somewhere: an album reached from the Library belongs
 * to the Library, the same album reached from a search belongs to Search. The
 * navigator has no notion of that, since every one of those screens is pushed
 * onto the single Stack that sits above the tabs, so it is kept here.
 *
 * Module scope on purpose: it outlives every screen that reads it, and losing
 * it on a remount would send somebody back to a tab they were never on. It is
 * only ever written while the tabs themselves are on screen, which is the one
 * moment the answer is known for certain.
 */
export type TabSegment = 'index' | 'search' | 'library';

/** Route of each tab, and the label to call it by (translated where used). */
export const TABS: { segment: TabSegment; href: string; label: string }[] = [
  { segment: 'index', href: '/', label: 'Home' },
  { segment: 'search', href: '/search', label: 'Search' },
  { segment: 'library', href: '/library', label: 'Library' },
];

let origin: TabSegment = 'index';

/** Called while the tabs are on screen: this is where any new stack starts. */
export function rememberTab(segment: string | undefined): void {
  const known = TABS.find((tb) => tb.segment === segment);
  origin = known ? known.segment : 'index';
}

export function tabOrigin(): TabSegment {
  return origin;
}

/** Where "out of here" leads: the tab these screens were opened from. */
export function tabOriginHref(): string {
  return TABS.find((tb) => tb.segment === origin)?.href ?? '/';
}

/** Its name, for whoever has to say it out loud (accessibility hints). */
export function tabOriginLabel(): string {
  return TABS.find((tb) => tb.segment === origin)?.label ?? 'Home';
}
