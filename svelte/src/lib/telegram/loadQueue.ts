/**
 * Bounded queue for media downloads.
 *
 * The GIF and sticker grids can hold hundreds of items, and each one resolves to
 * a full document download. Firing them all at once buries the MTProto worker and
 * the browser's memory alongside it, so only a handful are ever in flight and the
 * rest wait their turn.
 */
const PARALLEL_LIMIT = 6;

let active = 0;
const waiting: (() => void)[] = [];

function next() {
  if(active >= PARALLEL_LIMIT) return;
  const run = waiting.shift();
  if(!run) return;
  active++;
  run();
}

export function enqueueLoad<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    waiting.push(() => {
      task().then(resolve, reject).finally(() => {
        active--;
        next();
      });
    });
    next();
  });
}
