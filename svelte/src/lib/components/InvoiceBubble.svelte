<script lang="ts">
  import Checkout from './Checkout.svelte';
  import {loadCoverUrl, type InvoiceExtra} from '$lib/telegram/messageTypes';
  import {openInvoice, openReceipt, type Checkout as CheckoutData} from '$lib/telegram/payments';

  let {
    peerId,
    mid,
    invoice,
    onerror
  }: {
    peerId: number;
    mid: number;
    invoice: InvoiceExtra;
    onerror?: (message: string) => void;
  } = $props();

  let url = $state<string | null>(null);
  let paying = $state(false);
  let checkout = $state<CheckoutData | null>(null);
  let paidHere = $state(false);

  const paid = $derived(!!invoice.receiptMid || paidHere);

  $effect(() => {
    if (!invoice.hasPhoto) return;
    const key = `${peerId}_${mid}`;
    url = null;
    loadCoverUrl(peerId, mid).then((resolved) => {
      if (key === `${peerId}_${mid}`) url = resolved;
    });
  });

  /**
   * Both the payment and the receipt open the in-app checkout sheet — the same
   * one Stars top-ups and gifts use, so no invoice has to leave the client.
   */
  async function pay() {
    if (paying) return;
    paying = true;
    try {
      checkout = paid ?
        await openReceipt(peerId, invoice.receiptMid || mid) :
        await openInvoice(peerId, mid);
    } catch (err: any) {
      onerror?.(err?.message || err?.type || 'Could not open the checkout');
    } finally {
      paying = false;
    }
  }
</script>

<div class="invoice">
  {#if url}
    <img src={url} alt={invoice.title} />
  {/if}
  <span class="title">{invoice.title}</span>
  {#if invoice.description}
    <span class="desc">{invoice.description}</span>
  {/if}
  <div class="row">
    <span class="price">{invoice.priceText}</span>
    {#if invoice.test}<span class="tag">Test</span>{/if}
  </div>
  <button onclick={pay} disabled={paying}>
    {paying ? 'Opening…' : paid ? 'View receipt' : `Pay ${invoice.priceText}`}
  </button>
</div>

{#if checkout}
  <Checkout
    {checkout}
    onclose={() => (checkout = null)}
    ondone={() => {
      checkout = null;
      paidHere = true;
    }}
  />
{/if}

<style>
  .invoice {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 320px;
  }

  img {
    width: 100%;
    border-radius: 10px;
    display: block;
  }

  .title {
    font-weight: 600;
    font-size: 14px;
  }

  .desc {
    font-size: 13px;
    color: var(--text-dim);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .price {
    font-weight: 600;
    font-size: 14px;
  }

  .tag {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    color: var(--text-dim);
  }

  button {
    margin-top: 4px;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--accent);
    font-size: 13px;
    cursor: pointer;
  }

  button:disabled {
    color: var(--text-dim);
    cursor: default;
  }
</style>
