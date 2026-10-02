/**
 * The rules of the play queue, as plain functions over its state. The store in
 * `store/player.ts` owns the players, the sync and the timers; what the queue
 * looks like after each thing somebody does to it is decided here, where
 * `test/queue.test.ts` can check it without a phone.
 *
 * The "queued" block is the songs put in by hand with Play next: they sit
 * right after the current one, `queuedCount` long. Add to queue goes to the
 * very end instead, and does not touch it (#184).
 */
import type { Song } from '@/api/subsonic';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  queue: Song[];
  index: number;
  queuedCount: number;
}

/** The same song as it goes into the queue by hand: autoplay's mark comes off
 *  (it is here because you put it here, whatever it was doing before) and it
 *  takes one of its own, which is what the player announces while it plays. */
export function handAdded(song: Song): Song {
  const { fromMix: _fromMix, ...rest } = song;
  return { ...rest, queued: true };
}

/** The same song with neither mark on it, for when the queue stops having the
 *  blocks they name (see `shuffleOn`). */
export function unmarked(song: Song): Song {
  if (!song.fromMix && !song.queued) return song;
  const { fromMix: _fromMix, queued: _queued, ...rest } = song;
  return rest;
}

/**
 * A list in a new order, without touching the one handed in. Fisher-Yates,
 * shared by the shuffle button, by starting a list while shuffle is already
 * on and by the mixes, because they have to deal the same way.
 */
export function dealt<T>(list: T[], random: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Add to queue: at the very end, behind the block and the rest of the list. */
export function appendEnd(queue: Song[], songs: Song[]): Song[] {
  return queue.concat(songs.map(handAdded));
}

/** Play next: right after the current song, at the front of the queued block,
 *  which grows with it (#184). Built by hand rather than spread into
 *  `splice`: a playlist of thousands would be that many arguments in one call. */
export function insertNext(st: QueueState, songs: Song[]): QueueState {
  const at = st.index + 1;
  return {
    queue: st.queue.slice(0, at).concat(songs.map(handAdded), st.queue.slice(at)),
    index: st.index,
    queuedCount: st.queuedCount + songs.length,
  };
}

export interface Removal {
  state: QueueState;
  /** It was the one playing: the song now at its position has to be loaded. */
  wasCurrent: boolean;
  /** It was in the queued block, which `restoreRemoved` has to know. */
  inQueuedBlock: boolean;
}

/** Takes one song out, or null if `at` is not in the queue. An empty queue
 *  comes back as such: the caller resets the player. */
export function removeFrom(st: QueueState, at: number): Removal | null {
  const { queue, index, queuedCount } = st;
  if (at < 0 || at >= queue.length) return null;
  const next = queue.filter((_, i) => i !== at);
  if (at === index) {
    // The song after it now plays; if it was the first of the block, that one
    // is consumed by playing.
    return {
      state: { queue: next, index: Math.min(index, next.length - 1), queuedCount: Math.max(0, queuedCount - 1) },
      wasCurrent: true,
      inQueuedBlock: false,
    };
  }
  const inQueuedBlock = at > index && at <= index + queuedCount;
  return {
    state: { queue: next, index: at < index ? index - 1 : index, queuedCount: inQueuedBlock ? queuedCount - 1 : queuedCount },
    wasCurrent: false,
    inQueuedBlock,
  };
}

/** Puts back a song `removeFrom` took out of somewhere other than the current
 *  position, into a queue that may have moved on since. */
export function restoreRemoved(st: QueueState, at: number, song: Song, inQueuedBlock: boolean): QueueState {
  const queue = [...st.queue];
  queue.splice(at, 0, song);
  return {
    queue,
    index: st.index >= at ? st.index + 1 : st.index,
    queuedCount: inQueuedBlock ? st.queuedCount + 1 : st.queuedCount,
  };
}

/**
 * Drags one song to another place, or null for a move that is not one.
 *
 * The current index follows the song it pointed to. The queued block survives
 * reordering within what is coming: a song dragged into it joins it and one
 * dragged out leaves it (Spotify-style). Any move that touches the current
 * song or what already played dissolves the block.
 */
export function moveIn(st: QueueState, from: number, to: number): QueueState | null {
  const { queue, index, queuedCount } = st;
  if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return null;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  let newIndex = index;
  if (from === index) newIndex = to;
  else if (from < index && to >= index) newIndex = index - 1;
  else if (from > index && to <= index) newIndex = index + 1;
  let newQueuedCount = 0;
  if (from > index && to > index) {
    const fromQueued = from - (index + 1) < queuedCount;
    const toQueued = to - (index + 1) < queuedCount;
    newQueuedCount = Math.max(0, queuedCount + (!fromQueued && toQueued ? 1 : 0) - (fromQueued && !toQueued ? 1 : 0));
  }
  return { queue: next, index: newIndex, queuedCount: newQueuedCount };
}

/** The block once playback moves to `next`: advancing by one consumes one
 *  of it, landing anywhere else dissolves it into an ordinary queue. */
export function queuedAfterMove(st: Pick<QueueState, 'index' | 'queuedCount'>, next: number): number {
  if (next === st.index || st.queuedCount === 0) return st.queuedCount;
  return next === st.index + 1 ? st.queuedCount - 1 : 0;
}

/**
 * The next index to play, or null at the end. `ok` says whether an index can
 * be played (offline, a song with no file on the phone cannot). With repeat
 * all it wraps round, the current one included, so a queue with a single
 * playable song repeats it.
 */
export function nextPlayable(
  queue: Song[],
  index: number,
  repeat: RepeatMode,
  ok: (i: number) => boolean = () => true,
): number | null {
  for (let i = index + 1; i < queue.length; i++) if (ok(i)) return i;
  if (repeat === 'all') for (let i = 0; i <= index; i++) if (ok(i)) return i;
  return null;
}

/**
 * Shuffle turned on. The current song keeps playing, first in the new order,
 * unless `keepHead` (a UPnP renderer has the queue too, and its indices must
 * not move), in which case what already played stays put and only what is
 * coming gets dealt. Both marks come off: they name blocks, the mix at the end
 * and the songs added after the current one, and dealt there are none.
 */
export function shuffleOn(
  queue: Song[],
  index: number,
  keepHead: boolean,
  deal: (l: Song[]) => Song[] = dealt,
): { queue: Song[]; index: number } {
  const current = queue[index];
  if (keepHead && current) {
    return { queue: [...queue.slice(0, index + 1), ...deal(queue.slice(index + 1))].map(unmarked), index };
  }
  const rest = deal(queue.filter((_, i) => i !== index));
  return { queue: (current ? [current, ...rest] : rest).map(unmarked), index: 0 };
}

/** Shuffle turned off: where the playing song sits in the order it came in. */
export function indexInOriginal(original: Song[], current: Song): number {
  return Math.max(0, original.findIndex((s) => s.id === current.id));
}
