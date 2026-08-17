import {describe, expect, it} from 'vitest';
import type {InlineResultItem} from '../../svelte/src/lib/telegram/settings';

describe('inline bot results mapping', () => {
  it('extracts thumbnail identifiers and preview metadata from media results', () => {
    const rawResult = {
      query_id: '123456789',
      results: [
        {
          _: 'botInlineMediaResult',
          id: 'media_1',
          type: 'photo',
          title: 'A cat photo',
          description: 'Cute cat',
          photo: {
            _: 'photo',
            id: 9999,
            sizes: [{_: 'photoSize', type: 'm', w: 100, h: 100, size: 1024}]
          }
        },
        {
          _: 'botInlineResult',
          id: 'web_1',
          type: 'photo',
          title: 'External image',
          description: 'A web photo',
          thumb: {
            _: 'webDocument',
            url: 'https://example.com/thumb.jpg',
            mime_type: 'image/jpeg',
            access_hash: 111,
            size: 512
          }
        }
      ]
    };

    const mapped: InlineResultItem[] = rawResult.results.map((item: any) => ({
      queryAndResultId: `${rawResult.query_id}_${item.id}`,
      title: item.title ?? 'Result',
      description: item.description ?? '',
      type: item.type ?? '',
      thumbDocId: item.document?.id ? String(item.document.id) : undefined,
      thumbPhotoId: item.photo?.id ? String(item.photo.id) : undefined,
      thumbUrl: item.thumb?.mime_type?.startsWith('image/') ? item.thumb.url : undefined
    }));

    expect(mapped).toEqual([
      {
        queryAndResultId: '123456789_media_1',
        title: 'A cat photo',
        description: 'Cute cat',
        type: 'photo',
        thumbDocId: undefined,
        thumbPhotoId: '9999',
        thumbUrl: undefined
      },
      {
        queryAndResultId: '123456789_web_1',
        title: 'External image',
        description: 'A web photo',
        type: 'photo',
        thumbDocId: undefined,
        thumbPhotoId: undefined,
        thumbUrl: 'https://example.com/thumb.jpg'
      }
    ]);
  });
});
