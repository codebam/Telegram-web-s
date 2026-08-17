import {describe, expect, it} from 'vitest';
import type {InlineResultItem} from '../../svelte/src/lib/telegram/settings';

describe('inline bot results mapping', () => {
  it('extracts thumbnail identifiers and preview metadata from media results', () => {
    const rawResult = {
      query_id: '123456789',
      pFlags: {gallery: true},
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
          _: 'botInlineMediaResult',
          id: 'gif_1',
          type: 'gif',
          title: 'Dancing cat',
          description: 'Animation',
          document: {
            _: 'document',
            id: 8888,
            mime_type: 'video/mp4',
            attributes: [{_: 'documentAttributeAnimated'}]
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

    const mapped: InlineResultItem[] = rawResult.results.map((item: any) => {
      const doc = item.document;
      const attributes = doc?.attributes ?? [];
      const isGif = Boolean(item.type === 'gif' || (doc && (attributes.some((a: any) => a._ === 'documentAttributeAnimated') || doc.type === 'gif' || doc.mime_type === 'video/mp4')));

      return {
        queryAndResultId: `${rawResult.query_id}_${item.id}`,
        title: item.title ?? 'Result',
        description: item.description ?? '',
        type: item.type ?? '',
        isGif,
        thumbDocId: doc?.id ? String(doc.id) : undefined,
        thumbPhotoId: item.photo?.id ? String(item.photo.id) : undefined,
        thumbUrl: item.thumb?.mime_type?.startsWith('image/') ? item.thumb.url : undefined
      };
    });

    expect(mapped).toEqual([
      {
        queryAndResultId: '123456789_media_1',
        title: 'A cat photo',
        description: 'Cute cat',
        type: 'photo',
        isGif: false,
        thumbDocId: undefined,
        thumbPhotoId: '9999',
        thumbUrl: undefined
      },
      {
        queryAndResultId: '123456789_gif_1',
        title: 'Dancing cat',
        description: 'Animation',
        type: 'gif',
        isGif: true,
        thumbDocId: '8888',
        thumbPhotoId: undefined,
        thumbUrl: undefined
      },
      {
        queryAndResultId: '123456789_web_1',
        title: 'External image',
        description: 'A web photo',
        type: 'photo',
        isGif: false,
        thumbDocId: undefined,
        thumbPhotoId: undefined,
        thumbUrl: 'https://example.com/thumb.jpg'
      }
    ]);
  });
});
