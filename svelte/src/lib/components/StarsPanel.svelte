<script lang="ts">
  import Avatar from './Avatar.svelte';
  import Checkout from './Checkout.svelte';
  import Sticker from './Sticker.svelte';
  import {searchDialogs, type DialogItem} from '$lib/telegram/chats';
  import {
    convertGift,
    formatStars,
    loadGiftCatalog,
    loadProfileGifts,
    loadStarsBalance,
    loadTopupOptions,
    loadTransactions,
    onStarsBalance,
    sendStarGift,
    setGiftShownOnProfile,
    starsPurchaseBlocked,
    startStarsTopup,
    formatAmount,
    type Checkout as CheckoutData,
    type GiftOption,
    type OwnedGift,
    type StarsTransaction,
    type TopupOption
  } from '$lib/telegram/payments';

  let {selfId}: {selfId: number} = $props();

  type Tab = 'balance' | 'history' | 'gifts';
  let tab = $state<Tab>('balance');

  let balance = $state<{stars: number; ton: number} | null>(null);
  let options = $state<TopupOption[]>([]);
  let blocked = $state(false);
  let showAllOptions = $state(false);

  let transactions = $state<StarsTransaction[]>([]);
  let nextOffset = $state('');
  let direction = $state<'all' | 'in' | 'out'>('all');
  let loadingMore = $state(false);

  let catalog = $state<GiftOption[]>([]);
  let myGifts = $state<OwnedGift[]>([]);
  let giftsNext = $state('');
  let giftView = $state<'mine' | 'send'>('mine');

  let checkout = $state<CheckoutData | null>(null);
  let error = $state('');
  let status = $state('');
  let busy = $state('');

  /** Gift being composed: recipient + note. */
  let giftTarget = $state<GiftOption | null>(null);
  let recipientQuery = $state('');
  let recipients = $state<DialogItem[]>([]);
  let recipient = $state<DialogItem | null>(null);
  let giftNote = $state('');
  let giftAnonymous = $state(false);
  let giftUpgrade = $state(false);

  function flash(message: string) {
    status = message;
    setTimeout(() => (status = ''), 2500);
  }

  function report(err: any, fallback: string) {
    error = err?.type || err?.message || fallback;
  }

  async function refreshBalance(force = false) {
    try {
      balance = await loadStarsBalance(force);
    } catch(err) {
      report(err, 'Could not read your balance');
    }
  }

  $effect(() => {
    refreshBalance();
    starsPurchaseBlocked().then((value) => (blocked = value));
    loadTopupOptions().then((value) => (options = value)).catch(() => (options = []));

    let off: (() => void) | undefined;
    onStarsBalance(() => refreshBalance()).then((unsubscribe) => (off = unsubscribe));
    return () => off?.();
  });

  $effect(() => {
    const current = tab;
    if(current === 'history' && !transactions.length) reloadHistory();
    if(current === 'gifts' && !myGifts.length) reloadGifts();
  });

  async function reloadHistory() {
    error = '';
    transactions = [];
    nextOffset = '';
    await moreHistory();
  }

  async function moreHistory() {
    if(loadingMore) return;
    loadingMore = true;
    try {
      const page = await loadTransactions(nextOffset, direction);
      transactions = [...transactions, ...page.items];
      nextOffset = page.next;
    } catch(err) {
      report(err, 'Could not load transactions');
    } finally {
      loadingMore = false;
    }
  }

  async function setDirection(next: 'all' | 'in' | 'out') {
    direction = next;
    await reloadHistory();
  }

  async function reloadGifts() {
    error = '';
    try {
      const page = await loadProfileGifts(selfId, '');
      myGifts = page.items;
      giftsNext = page.next;
    } catch(err) {
      report(err, 'Could not load your gifts');
    }
  }

  async function moreGifts() {
    if(!giftsNext) return;
    try {
      const page = await loadProfileGifts(selfId, giftsNext);
      myGifts = [...myGifts, ...page.items];
      giftsNext = page.next;
    } catch(err) {
      report(err, 'Could not load more gifts');
    }
  }

  async function openCatalog() {
    giftView = 'send';
    if(catalog.length) return;
    try {
      catalog = await loadGiftCatalog();
    } catch(err) {
      report(err, 'Could not load the gift catalogue');
    }
  }

  async function topUp(option: TopupOption) {
    error = '';
    busy = 'topup';
    try {
      checkout = await startStarsTopup(option);
    } catch(err) {
      report(err, 'Could not start the top-up');
    } finally {
      busy = '';
    }
  }

  async function findRecipients() {
    const query = recipientQuery.trim();
    if(!query) {
      recipients = [];
      return;
    }
    try {
      recipients = (await searchDialogs(query, 20)).filter((dialog) => dialog.isUser);
    } catch(err) {
      recipients = [];
    }
  }

  async function confirmGift() {
    if(!giftTarget || !recipient) return;
    error = '';
    busy = 'gift';
    try {
      checkout = await sendStarGift({
        peerId: recipient.peerId,
        giftId: giftTarget.giftId,
        message: giftNote.trim() || undefined,
        anonymous: giftAnonymous,
        includeUpgrade: giftUpgrade
      });
    } catch(err) {
      report(err, 'Could not open the gift checkout');
    } finally {
      busy = '';
    }
  }

  async function convert(gift: OwnedGift) {
    if(!confirm(`Convert this gift into ${gift.convertStars} Stars? This cannot be undone.`)) return;
    try {
      await convertGift(gift.key);
      flash('Converted to Stars');
      await Promise.all([reloadGifts(), refreshBalance(true)]);
    } catch(err) {
      report(err, 'Could not convert the gift');
    }
  }

  async function toggleShown(gift: OwnedGift) {
    try {
      await setGiftShownOnProfile(gift.key, !gift.shown);
      myGifts = myGifts.map((item) =>
        item.key === gift.key ? {...item, shown: !item.shown} : item
      );
    } catch(err) {
      report(err, 'Could not change the gift visibility');
    }
  }

  function dateOf(unix: number) {
    return unix ? new Date(unix * 1000).toLocaleString() : '';
  }

  const visibleOptions = $derived(
    showAllOptions ? options : options.filter((option) => !option.extended)
  );
</script>

<div class="stars">
  {#if error}<p class="error">{error}</p>{/if}
  {#if status}<p class="ok">{status}</p>{/if}

  <div class="tabs">
    {#each [['balance', 'Balance'], ['history', 'History'], ['gifts', 'Gifts']] as [key, label] (key)}
      <button class:on={tab === key} onclick={() => (tab = key as Tab)}>{label}</button>
    {/each}
  </div>

  {#if tab === 'balance'}
    {#if !balance}
      <p class="muted">Loading…</p>
    {:else}
      <p class="balance">★ {formatStars(balance.stars)}</p>
      {#if balance.ton}
        <p class="muted small">{formatAmount(Math.round(balance.ton * 1e9), 'TON')}</p>
      {/if}
    {/if}

    <p class="label">Buy Stars</p>
    {#if blocked}
      <p class="muted small">
        Star purchases are switched off for this account by the server.
      </p>
    {:else if !options.length}
      <p class="muted small">No top-up options are offered right now.</p>
    {:else}
      {#each visibleOptions as option (option.stars)}
        <button class="option" onclick={() => topUp(option)} disabled={busy === 'topup'}>
          <span>★ {option.stars.toLocaleString()}</span>
          <span>{formatAmount(option.amount, option.currency)}</span>
        </button>
      {/each}
      {#if !showAllOptions && options.some((option) => option.extended)}
        <button class="ghost" onclick={() => (showAllOptions = true)}>Show more</button>
      {/if}
    {/if}

  {:else if tab === 'history'}
    <div class="chips">
      {#each [['all', 'All'], ['in', 'Incoming'], ['out', 'Outgoing']] as [key, label] (key)}
        <button
          class:on={direction === key}
          onclick={() => setDirection(key as 'all' | 'in' | 'out')}
        >{label}</button>
      {/each}
    </div>

    {#if !transactions.length}
      <p class="muted small">{loadingMore ? 'Loading…' : 'No transactions yet.'}</p>
    {:else}
      {#each transactions as transaction (transaction.id)}
        <div class="transaction">
          <span class="tx-title">
            {transaction.title || transaction.peerTitle || 'Transaction'}
            {#if transaction.refund}<span class="tag">refund</span>{/if}
            {#if transaction.pending}<span class="tag">pending</span>{/if}
            {#if transaction.failed}<span class="tag bad">failed</span>{/if}
          </span>
          <span class="amount" class:incoming={transaction.incoming}>
            {transaction.incoming ? '+' : '−'}{transaction.ton ? '' : '★ '}{formatStars(transaction.amount)}
          </span>
          {#if transaction.description}
            <span class="muted small">{transaction.description}</span>
          {/if}
          <span class="muted small">{dateOf(transaction.date)}</span>
        </div>
      {/each}
      {#if nextOffset}
        <button class="ghost" onclick={moreHistory} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      {/if}
    {/if}

  {:else}
    <div class="chips">
      <button class:on={giftView === 'mine'} onclick={() => (giftView = 'mine')}>My gifts</button>
      <button class:on={giftView === 'send'} onclick={openCatalog}>Send a gift</button>
    </div>

    {#if giftView === 'mine'}
      {#if !myGifts.length}
        <p class="muted small">You have not received any gifts yet.</p>
      {:else}
        {#each myGifts as gift (gift.key)}
          <div class="gift">
            <Sticker sticker={gift.sticker} size={48} />
            <div class="gift-body">
              <span class="gift-title">{gift.title}</span>
              {#if gift.fromTitle}
                <span class="muted small">from {gift.fromTitle}</span>
              {/if}
              {#if gift.message}
                <span class="muted small">“{gift.message}”</span>
              {/if}
              <span class="muted small">{dateOf(gift.date)}</span>
              <div class="gift-actions">
                {#if gift.incoming}
                  <button class="ghost" onclick={() => toggleShown(gift)}>
                    {gift.shown ? 'Hide from profile' : 'Show on profile'}
                  </button>
                {/if}
                {#if gift.canConvert}
                  <button class="ghost" onclick={() => convert(gift)}>
                    Convert to ★ {gift.convertStars}
                  </button>
                {/if}
              </div>
            </div>
          </div>
        {/each}
        {#if giftsNext}
          <button class="ghost" onclick={moreGifts}>Load more</button>
        {/if}
      {/if}

    {:else if giftTarget}
      <p class="label">Send this gift for ★ {giftTarget.stars.toLocaleString()}</p>
      <div class="gift-preview"><Sticker sticker={giftTarget.sticker} size={72} /></div>

      {#if recipient}
        <button class="option" onclick={() => (recipient = null)}>
          <span><Avatar peerId={recipient.peerId} title={recipient.title} size={24} /> {recipient.title}</span>
          <span class="muted small">change</span>
        </button>
      {:else}
        <label class="field">
          <span>Recipient</span>
          <input bind:value={recipientQuery} oninput={findRecipients} placeholder="Search people" />
        </label>
        {#each recipients as candidate (candidate.peerId)}
          <button class="option" onclick={() => (recipient = candidate)}>
            <span>{candidate.title}</span>
          </button>
        {/each}
      {/if}

      <label class="field">
        <span>Message (optional)</span>
        <input bind:value={giftNote} maxlength="255" />
      </label>
      <label class="toggle">
        <input type="checkbox" bind:checked={giftAnonymous} />
        <span>Hide my name from the recipient's profile</span>
      </label>
      {#if giftTarget.upgradeStars}
        <label class="toggle">
          <input type="checkbox" bind:checked={giftUpgrade} />
          <span>Prepay the upgrade to a collectible (+★ {giftTarget.upgradeStars})</span>
        </label>
      {/if}

      <button class="primary" onclick={confirmGift} disabled={!recipient || busy === 'gift'}>
        {busy === 'gift' ? 'Opening…' : 'Continue'}
      </button>
      <button class="ghost" onclick={() => (giftTarget = null)}>Back to the catalogue</button>

    {:else if !catalog.length}
      <p class="muted small">Loading the gift catalogue…</p>

    {:else}
      <div class="catalog">
        {#each catalog as gift (gift.giftId)}
          <button
            class="catalog-item"
            disabled={gift.soldOut}
            onclick={() => { giftTarget = gift; recipient = null; giftNote = ''; }}
          >
            <Sticker sticker={gift.sticker} size={64} />
            <span class="price">★ {gift.stars.toLocaleString()}</span>
            {#if gift.soldOut}
              <span class="muted small">sold out</span>
            {:else if gift.limited}
              <span class="muted small">{gift.remains.toLocaleString()} left</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>

{#if checkout}
  <Checkout
    checkout={checkout}
    onclose={() => (checkout = null)}
    ondone={() => {
      checkout = null;
      flash('Payment confirmed');
      refreshBalance(true);
      if(tab === 'gifts') reloadGifts();
      if(tab === 'history') reloadHistory();
    }}
  />
{/if}

<style>
  .stars {
    display: grid;
    gap: 10px;
    align-content: start;
  }

  .tabs,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .tabs button,
  .chips button {
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 13px;
  }

  .tabs button.on,
  .chips button.on {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
  }

  .balance {
    margin: 0;
    font-size: 30px;
    font-weight: 700;
    color: var(--accent);
  }

  .label {
    margin: 8px 0 0;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
  }

  .option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-size: 13px;
  }

  .option span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .transaction {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 2px 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
  }

  .tx-title {
    font-weight: 500;
  }

  .amount {
    font-weight: 600;
    color: var(--danger);
    text-align: right;
  }

  .amount.incoming {
    color: #3aa657;
  }

  .tag {
    margin-left: 6px;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .tag.bad {
    color: var(--danger);
    border-color: var(--danger);
  }

  .catalog {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }

  .catalog-item {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 8px 4px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .catalog-item:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .price {
    font-size: 12px;
    font-weight: 600;
  }

  .gift {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }

  .gift-body {
    display: grid;
    gap: 2px;
  }

  .gift-title {
    font-size: 14px;
    font-weight: 500;
  }

  .gift-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .gift-preview {
    justify-self: center;
  }

  .field {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--text-dim);
  }

  .field input {
    padding: 9px 12px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: var(--text);
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .primary,
  .ghost {
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .primary {
    background: var(--accent);
    border-color: transparent;
    color: #fff;
    font-weight: 600;
  }

  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .ghost {
    padding: 6px 10px;
    font-size: 12px;
    justify-self: start;
  }

  .muted {
    color: var(--text-dim);
  }

  .small {
    font-size: 12px;
    margin: 0;
  }

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 13px;
  }

  .ok {
    margin: 0;
    color: var(--accent);
    font-size: 13px;
  }
</style>
