/*
 * A dice / animated-random message: 🎲 🎯 🎳 ⚽ 🏀 🎰.
 *
 * Not ported from `svelte/` — neither client ever rendered one, so the message
 * arrived as a completely empty bubble. The animation comes from the sticker set
 * Telegram keeps for the emoji (`loadDiceDocuments`), which tweb indexes the same
 * way (`src/components/chat/bubbleParts/dice.ts`): document 0 is the roll and
 * 1..N the outcomes, each value being one complete animation rather than a frame
 * sequence the caller drives. A dice that was already read shows its settled
 * frame instead of replaying — upstream's `play = unknown || isInUnread`.
 *
 * The slot machine (🎰) is not one animation but a sprite sheet of independent
 * parts stacked on top of each other: a background, a handle, three reels and
 * eighteen symbols. The index tables below are upstream's, including the
 * hard-coded `frame` constant it uses to wait before swapping in a win
 * background — we play each part whole, so ours is the same table without the
 * mid-animation swap.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {loadStickerBlob} from '$lib/telegram/chats';
import {loadDiceDocuments} from '$lib/telegram/stickers';
import type {DiceExtra} from '$lib/telegram/messageTypes';
import type LottiePlayer from '@lib/lottie/lottiePlayer';

interface Props {
  extra: DiceExtra;
  /** Play the reveal. False renders the outcome frame directly — see the note above. */
  play: boolean;
}

/** Upstream's box for a one-document dice, and for the slot's full canvas. */
const DICE_SIZE = 180;
const SLOT_SIZE = 180;

const SLOT_WIN_VALUE = 64;
const SLOT_BACKGROUND = 0;
const SLOT_BACKGROUND_WIN = 1;
const SLOT_HANDLE = 2;
const SLOT_REELS = [8, 14, 20];
/** Reel symbol order, so reel positions read left-to-right as digits do. */
const SLOT_MAP = [1, 2, 3, 0];

/**
 * The three symbol parts of a settled slot. A win is always the first three
 * symbols of each reel; anything else is one of four symbols per reel, selected
 * by two bits each — the mapping upstream uses to keep a loss from repeating.
 */
function slotSymbols(value: number): number[] {
  if(value === SLOT_WIN_VALUE) return [3, 9, 15];

  const offset = Math.max(0, value - 1);
  return [
    4 + SLOT_MAP[offset & 3],
    10 + SLOT_MAP[(offset >> 2) & 3],
    16 + SLOT_MAP[(offset >> 4) & 3]
  ];
}

interface PartProps {
  docId: string;
  size: number;
  /** The roll loops; an outcome does not. */
  loop: boolean;
  /** Play from the first frame; false renders the settled last frame. */
  autoplay: boolean;
}

/**
 * One stacked part of a dice. Same pipeline as AnimatedSticker, except that a
 * settled part is constructed clamped to its last frame (`initFrame: Infinity`)
 * — handing the player the whole animation and pausing it would paint frame 0,
 * which for a dice is the start of the roll, not the result.
 */
function DicePart({docId, size, loop, autoplay}: PartProps) {
  const container = useRef<HTMLDivElement>(null);
  const player = useRef<LottiePlayer | null>(null);

  useEffect(() => {
    const node = container.current;
    if(!node) return;

    let cancelled = false;

    (async() => {
      const [blob, {default: lottieLoader}] = await Promise.all([
        loadStickerBlob(docId),
        import('@lib/lottie/lottieLoader')
      ]);

      if(cancelled || !blob) return;

      try {
        const animation = await lottieLoader.loadAnimationWorker({
          container: node,
          animationData: blob,
          width: size,
          height: size,
          loop,
          autoplay,
          initFrame: !loop && !autoplay ? Number.POSITIVE_INFINITY : undefined,
          needUpscale: true,
          name: `doc${docId}`
        });

        if(cancelled) {
          animation.remove();
          return;
        }

        player.current = animation;
      } catch(err) {
        // A dice that cannot be decoded still shows its emoji below.
      }
    })();

    return () => {
      cancelled = true;
      player.current?.remove();
      player.current = null;
    };
  }, [docId, size, loop, autoplay]);

  return <div class="dice-part" ref={container} style={{width: `${size}px`, height: `${size}px`}} />;
}

export function Dice({extra, play}: Props) {
  const documents = useSignal<{docId: string}[]>([]);
  const isSlot = extra.emoticon === '🎰';
  const rolling = extra.value === 0;
  const size = isSlot ? SLOT_SIZE : DICE_SIZE;

  useEffect(() => {
    let cancelled = false;
    documents.value = [];

    loadDiceDocuments(extra.emoticon).then((list) => {
      if(!cancelled) documents.value = list;
    });

    return () => {
      cancelled = true;
    };
  }, [extra.emoticon]);

  const docs = documents.value;
  let indexes: number[];
  if(isSlot) {
    indexes = rolling ?
      [SLOT_BACKGROUND, SLOT_HANDLE, ...SLOT_REELS] :
      [extra.value === SLOT_WIN_VALUE ? SLOT_BACKGROUND_WIN : SLOT_BACKGROUND, ...slotSymbols(extra.value)];
  } else {
    indexes = [Math.min(Math.max(extra.value, 0), Math.max(docs.length - 1, 0))];
  }

  return (
    <div
      class="dice"
      data-dice={extra.emoticon}
      title={rolling ? '' : `${extra.emoticon} ${extra.value}`}
      style={{width: `${size}px`, height: `${size}px`}}
    >
      {indexes.map((index, i) => {
        const doc = docs[index];
        if(!doc) return null;

        return (
          <DicePart
            key={`${index}_${i}`}
            docId={doc.docId}
            size={size}
            loop={rolling}
            autoplay={rolling || play}
          />
        );
      })}
      {!docs.length ? <span class="dice-fallback">{extra.emoticon}</span> : null}
    </div>
  );
}
