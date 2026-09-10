import {bootTelegram} from '$lib/telegram/client';

/**
 * One file queued in the send dialog, with the choices made for it there.
 *
 * The decision is per item rather than per batch: a screenshot and the PDF next
 * to it in the same drop want different treatment, and only the inline ones can
 * carry a spoiler.
 */
export type SendFileItem = {
  file: File;
  /** Send compressed and inline (photo/video) rather than as a document. */
  asPhoto: boolean;
  /** Cover the media until the recipient taps it. Inline media only. */
  spoiler: boolean;
};

/** Live state of one item's upload, in the same order as the batch. */
export type UploadProgress = {
  /** 0…1. Stays at 1 once the file is on the server. */
  progress: number;
  /** Non-empty when this item failed; the batch keeps the rest. */
  error: string;
};

export type SendFilesOptions = {
  caption?: string;
  threadId?: number;
  replyToMsgId?: number;
  /** Called on every progress tick with the whole batch's state. */
  onprogress?: (items: UploadProgress[]) => void;
};

export type UploadHandle = {
  /** Resolves once every file has been handed to the server. */
  promise: Promise<void>;
  /** Abort whatever is still uploading; already-sent items stay sent. */
  cancel: () => void;
};

/**
 * Telegram caps a media group at ten items, and refuses to mix compressed media
 * with documents inside one group — so a batch becomes a run of albums rather
 * than a single one.
 */
const MAX_ALBUM_SIZE = 10;

/**
 * Upload file names minted by tweb's `getFileNameForUpload`. Uploads and
 * downloads share the `download_progress` event, so a batch has to be able to
 * tell its own traffic from a photo the chat happens to be fetching.
 */
const UPLOAD_FILE_NAME = /^(photo|video|audio|document)\d+_\d+\.|^upload-/;

const isVisual = (file: File) =>
  file.type.startsWith('image/') || file.type.startsWith('video/');

/** Whether this item goes as inline media rather than as a document. */
const asMedia = (item: SendFileItem) => item.asPhoto && isVisual(item.file);

/**
 * Split a batch into the chunks that can legally travel as one album: same
 * media-vs-document kind, at most ten, order preserved.
 */
function chunkForAlbums(items: SendFileItem[]): {isMedia: boolean; indices: number[]}[] {
  const chunks: {isMedia: boolean; indices: number[]}[] = [];

  items.forEach((item, index) => {
    const media = asMedia(item);
    const last = chunks[chunks.length - 1];
    if(last && last.isMedia === media && last.indices.length < MAX_ALBUM_SIZE) {
      last.indices.push(index);
    } else {
      chunks.push({isMedia: media, indices: [index]});
    }
  });

  return chunks;
}

/**
 * Follows a batch's upload progress.
 *
 * tweb reports progress on `download_progress` keyed by an internal file name
 * the sender never sees, so the batch has to claim those names as they first
 * appear. The claim is by exact byte size against an item that has not been
 * claimed yet — anything that matches no pending item is somebody else's
 * transfer and is ignored.
 */
class BatchTracker {
  public readonly items: UploadProgress[];
  private claimed = new Map<string, number>();
  private taken = new Set<number>();
  private waiters = new Map<number, () => void>();
  private detach: (() => void) | undefined;

  constructor(private files: File[], private onprogress?: (items: UploadProgress[]) => void) {
    this.items = files.map(() => ({progress: 0, error: ''}));
  }

  public async attach() {
    const {default: rootScope} = await import('@lib/rootScope');
    const handler = (details: any) => this.onTick(details);
    rootScope.addEventListener('download_progress', handler);
    this.detach = () => rootScope.removeEventListener('download_progress', handler);
  }

  public release() {
    this.detach?.();
    this.detach = undefined;
    this.settleAll();
  }

  /** File names claimed so far — what a cancel has to abort. */
  public fileNames(): string[] {
    return Array.from(this.claimed.keys());
  }

  public fail(indices: number[], message: string) {
    for(const index of indices) this.items[index].error = message;
    this.settleAll();
    this.emit();
  }

  public complete(indices: number[]) {
    for(const index of indices) {
      if(!this.items[index].error) this.items[index].progress = 1;
    }
    this.settleAll();
    this.emit();
  }

  /**
   * Wait until one item has finished uploading.
   *
   * A single file does not travel as an album, and tweb's `sendFile` hands back
   * a pending message long before the bytes are on the server — the only signal
   * left is the progress feed itself. The timer is a guard, not the mechanism:
   * a file small enough to go up in one part still reports its last tick, but a
   * batch must never hang on a feed that stayed silent.
   */
  public settle(index: number, timeoutMs = 15000): Promise<void> {
    if(this.items[index].progress >= 1 || this.items[index].error) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(index);
        resolve();
      }, timeoutMs);

      this.waiters.set(index, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  public settleAll() {
    for(const resolve of this.waiters.values()) resolve();
    this.waiters.clear();
  }

  private onTick({fileName, done, total}: {fileName: string; done: number; total: number}) {
    if(!fileName) return;

    let index = this.claimed.get(fileName);
    if(index === undefined) {
      if(!UPLOAD_FILE_NAME.test(fileName)) return;
      index = this.files.findIndex((file, i) => !this.taken.has(i) && file.size === total);
      if(index === -1) return;
      this.claimed.set(fileName, index);
      this.taken.add(index);
    }

    this.items[index].progress = total ? Math.min(done / total, 1) : 0;
    if(this.items[index].progress >= 1) {
      this.waiters.get(index)?.();
      this.waiters.delete(index);
    }
    this.emit();
  }

  private emit() {
    // A fresh array each tick: the caller holds it in reactive state, and
    // mutating in place would not register as a change.
    this.onprogress?.(this.items.map((item) => ({...item})));
  }
}

/**
 * Upload and send a batch of files, grouping what can be grouped into albums.
 *
 * Multiple photos/videos go out as a single media group the way the official
 * clients send them, so they arrive as one album bubble rather than a stack of
 * separate messages. The caption belongs to the album as a whole and rides on
 * its first item, which is where Telegram expects it.
 */
export function sendFilesGrouped(
  peerId: number,
  items: SendFileItem[],
  options: SendFilesOptions = {}
): UploadHandle {
  const tracker = new BatchTracker(items.map((item) => item.file), options.onprogress);

  let cancelled = false;
  let cancelUploads: () => void = () => {
    cancelled = true;
  };

  const promise = (async() => {
    if(!items.length) return;

    const {managers} = await bootTelegram();
    await tracker.attach();

    cancelUploads = () => {
      cancelled = true;
      // Aborting the transfer is what actually stops the send: tweb's uploader
      // rejects, and the manager drops the pending message with it.
      for(const fileName of tracker.fileNames()) {
        managers.apiFileManager.cancelDownload(fileName).catch(() => {});
      }
      tracker.settleAll();
    };
    if(cancelled) cancelUploads();

    try {
      const chunks = chunkForAlbums(items);

      for(const [chunkIndex, chunk] of chunks.entries()) {
        if(cancelled) break;

        try {
          await managers.appMessagesManager.sendGrouped({
            peerId,
            isMedia: chunk.isMedia,
            // Only the first album carries the caption, like the official
            // clients — repeating it under every group would be noise.
            caption: chunkIndex === 0 ? options.caption : undefined,
            threadId: options.threadId,
            replyToMsgId: options.replyToMsgId ?? options.threadId,
            clearDraft: chunkIndex === 0,
            sendFileDetails: chunk.indices.map((index) => ({
              file: items[index].file,
              spoiler: chunk.isMedia && items[index].spoiler
            }))
          } as any);

          // An album's promise covers the whole upload; a lone file's does not
          // — `sendGrouped` forwards it to `sendFile`, which returns as soon as
          // the pending message exists. Wait for the bytes instead.
          if(chunk.indices.length === 1 && !cancelled) {
            await tracker.settle(chunk.indices[0]);
          }

          tracker.complete(chunk.indices);
        } catch(err: any) {
          if(cancelled) break;
          tracker.fail(chunk.indices, err?.type || err?.message || 'Upload failed');
          throw err;
        }
      }
    } finally {
      tracker.release();
    }
  })();

  return {
    promise,
    cancel: () => cancelUploads()
  };
}
