/*
 * Ported from svelte/src/lib/components/InvoiceBubble.svelte.
 *
 * `paid` was `$derived` over a prop (`invoice`) as well as the `paidHere`
 * signal, so it stays a plain `const` recomputed on each render — a
 * `useComputed` only tracks signal reads and would never notice another invoice
 * arriving (CONVERSION.md §4). Reading `paidHere.value` while rendering it is
 * what re-renders the button once the checkout confirms.
 *
 * The `$effect` reads props only, so it is a `useEffect` with those in its
 * dependency list. The original re-read `peerId`/`mid` inside the async callback
 * and compared the pair it started with against the current one to drop a stale
 * cover; a JSX closure only ever sees the render that started the load, so the
 * latest pair is kept in a ref and the same guard stays honest.
 */
import {useEffect, useRef} from 'preact/hooks';
import {useSignal} from '@preact/signals';

import {Checkout} from './Checkout';
import {loadCoverUrl, type InvoiceExtra} from '$lib/telegram/messageTypes';
import {openInvoice, openReceipt, type Checkout as CheckoutData} from '$lib/telegram/payments';

import './InvoiceBubble.css';

interface Props {
  peerId: number;
  mid: number;
  invoice: InvoiceExtra;
  onerror?: (message: string) => void;
}

export function InvoiceBubble({peerId, mid, invoice, onerror}: Props) {
  const url = useSignal<string | null>(null);
  const paying = useSignal(false);
  const checkout = useSignal<CheckoutData | null>(null);
  const paidHere = useSignal(false);

  const paid = !!invoice.receiptMid || paidHere.value;

  const currentKey = useRef(`${peerId}_${mid}`);
  currentKey.current = `${peerId}_${mid}`;

  useEffect(() => {
    if(!invoice.hasPhoto) return;
    const key = `${peerId}_${mid}`;
    url.value = null;
    loadCoverUrl(peerId, mid).then((resolved) => {
      if(key === currentKey.current) url.value = resolved;
    });
  }, [peerId, mid, invoice.hasPhoto]);

  /**
   * Both the payment and the receipt open the in-app checkout sheet — the same
   * one Stars top-ups and gifts use, so no invoice has to leave the client.
   */
  async function pay() {
    if(paying.value) return;
    paying.value = true;
    try {
      checkout.value = paid ?
        await openReceipt(peerId, invoice.receiptMid || mid) :
        await openInvoice(peerId, mid);
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not open the checkout');
    } finally {
      paying.value = false;
    }
  }

  return (
    <>
      <div class="invoice">
        {url.value && <img src={url.value} alt={invoice.title} />}
        <span class="title">{invoice.title}</span>
        {invoice.description && <span class="desc">{invoice.description}</span>}
        <div class="row">
          <span class="price">{invoice.priceText}</span>
          {invoice.test && <span class="tag">Test</span>}
        </div>
        <button onClick={pay} disabled={paying.value}>
          {paying.value ? 'Opening…' : paid ? 'View receipt' : `Pay ${invoice.priceText}`}
        </button>
      </div>

      {checkout.value && (
        <Checkout
          checkout={checkout.value}
          onclose={() => (checkout.value = null)}
          ondone={() => {
            checkout.value = null;
            paidHere.value = true;
          }}
        />
      )}
    </>
  );
}
