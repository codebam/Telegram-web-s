import Currencies from '@config/currencies';
import {bootTelegram} from './client';
import {adoptSticker, type StickerItem} from './chats';

/**
 * Payments: invoice checkout, Stars, star gifts, Premium, paid media, boosts
 * and giveaways.
 *
 * Same discipline as the rest of `$lib/telegram`: nothing raw crosses into
 * Svelte state. A payment form is stateful across several round trips (form →
 * validated info → shipping option → credentials → send), so the raw MTProto
 * objects live in the module-level `checkouts` map and the UI only ever holds
 * the plain `Checkout` snapshot plus its id.
 *
 * Money rule: every step here is a real manager call. Nothing reports success
 * the server did not confirm, and a branch a browser cannot complete is
 * reported as unavailable rather than faked.
 */

export const STARS_CURRENCY = 'XTR';
export const TON_CURRENCY = 'TON';

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** `starsAmount` carries whole stars plus nanos (a billionth of a star). */
export function starsToNumber(amount: any): number {
  if(amount === undefined || amount === null) return 0;
  if(typeof amount === 'object') {
    const whole = Number(amount.amount ?? 0);
    if(amount._ === 'starsTonAmount') return whole / 1e9;
    return whole + Number(amount.nanos ?? 0) / 1e9;
  }
  return Number(amount);
}

/** Nanoton (10^-9 TON) rendered with two decimals, as the other clients do. */
function formatTon(amount: number | string): string {
  let str = String(amount);
  let negative = false;
  if(str.startsWith('-')) {
    negative = true;
    str = str.slice(1);
  }

  str = str.padStart(10, '0');
  const int = str.slice(0, str.length - 9);
  const frac = str.slice(-9).slice(0, 2);
  return `${negative ? '-' : ''}${Number(int).toLocaleString()}.${frac} TON`;
}

/**
 * Renders a minor-unit amount the way Telegram does: `Currencies[code].exp`
 * decimal places, the currency's own separators, and the symbol on the side
 * that currency puts it.
 */
export function formatAmount(amount: number | string, currency: string): string {
  if(currency === TON_CURRENCY) return formatTon(amount);
  if(currency === STARS_CURRENCY) return `★ ${Math.round(Number(amount)).toLocaleString()}`;

  const data = Currencies[currency];
  const value = Number(amount);
  if(!data) return `${value} ${currency}`;

  const negative = value < 0;
  const units = Math.abs(value) / Math.pow(10, data.exp);
  const exp = currency === 'IRR' && Number.isInteger(units) ? 0 : data.exp;

  const [int, frac = ''] = units.toFixed(exp).split('.');
  const grouped = int.replace(/\B(?=(?:\d{3})+(?!\d))/g, data.thousands_sep);
  const body = frac ? grouped + data.decimal_sep + frac : grouped;

  const space = data.space_between ? ' ' : '';
  const withSymbol = data.symbol_left ?
    `${data.symbol}${space}${body}` :
    `${body}${space}${data.symbol}`;
  return negative ? `-${withSymbol}` : withSymbol;
}

export function formatStars(amount: any): string {
  const value = starsToNumber(amount);
  return (Math.round(value * 100) / 100).toLocaleString(undefined, {maximumFractionDigits: 2});
}

/* ------------------------------------------------------------------ */
/* Checkout — plain shapes                                             */
/* ------------------------------------------------------------------ */

export type PriceLine = {label: string; amount: number};

export type SavedCard = {id: string; title: string};

/** An extra provider-hosted payment method offered alongside the card form. */
export type ExtraMethod = {url: string; title: string};

export type RequestedInfo = {
  name: string;
  email: string;
  phone: string;
  streetLine1: string;
  streetLine2: string;
  city: string;
  state: string;
  countryIso2: string;
  postCode: string;
};

export const EMPTY_INFO: RequestedInfo = {
  name: '',
  email: '',
  phone: '',
  streetLine1: '',
  streetLine2: '',
  city: '',
  state: '',
  countryIso2: '',
  postCode: ''
};

export type ShippingOption = {
  id: string;
  title: string;
  amount: number;
  prices: PriceLine[];
};

export type Checkout = {
  /** Handle into the module-level raw session map. */
  id: string;
  /** `receipt` is a finished payment, shown read-only. */
  mode: 'form' | 'receipt';
  /** How the invoice is settled: a card, Telegram Stars, or TON. */
  pay: 'card' | 'stars' | 'ton';
  title: string;
  description: string;
  /** Only set when the provider gave a plain URL we may load directly. */
  photoUrl: string;
  currency: string;
  prices: PriceLine[];
  /** Sum of `prices` — the invoice before tip and shipping. */
  itemsTotal: number;
  shippingAmount: number;
  tipAmount: number;
  total: number;
  maxTipAmount: number;
  suggestedTips: number[];
  /** Test invoice — the provider will not really charge the card. */
  test: boolean;
  recurring: boolean;
  termsUrl: string;
  needName: boolean;
  needEmail: boolean;
  needPhone: boolean;
  needShippingAddress: boolean;
  /** Shipping options only exist after the address has been validated. */
  shippingOptions: ShippingOption[];
  selectedShippingId: string;
  infoValidated: boolean;
  savedInfo: RequestedInfo | null;
  savedCards: SavedCard[];
  canSaveCard: boolean;
  /**
   * '' when the provider has no in-page form — the card must then be entered
   * on the provider's own page (`providerUrl`).
   */
  nativeProvider: '' | 'stripe' | 'smartglocal';
  needCardholderName: boolean;
  needCountry: boolean;
  needZip: boolean;
  /** Provider-hosted checkout page, used when there is no native form. */
  providerUrl: string;
  extraMethods: ExtraMethod[];
  /** The card chosen for this checkout, '' when none has been picked yet. */
  cardTitle: string;
  botTitle: string;
  providerTitle: string;
  /** Set on a receipt. */
  date: number;
};

type Session = {
  id: string;
  inputInvoice: any;
  form: any;
  nativeParams: any;
  /** payments.validatedRequestedInfo from the last successful validation. */
  requestedInfo: any;
  shippingOption: any;
  tipAmount: number;
  /** Tokenized card awaiting `payCheckout`. */
  token: any;
  cardTitle: string;
  saveCard: boolean;
  savedCardId: string;
  tmpPassword: {password: string; validUntil: number} | null;
  peerId: number;
  mid: number;
};

const checkouts = new Map<string, Session>();
let checkoutSeq = 0;

function sessionOf(id: string): Session {
  const session = checkouts.get(id);
  if(!session) throw new Error('This checkout has expired — reopen the invoice.');
  return session;
}

export function closeCheckout(id: string): void {
  checkouts.delete(id);
}

function pricesOf(prices: any[]): PriceLine[] {
  return (prices ?? []).map((price: any) => ({
    label: price.label ?? '',
    amount: Number(price.amount ?? 0)
  }));
}

function sumPrices(prices: PriceLine[]): number {
  return prices.reduce((total, price) => total + price.amount, 0);
}

function infoOf(info: any): RequestedInfo | null {
  if(!info) return null;
  const address = info.shipping_address ?? {};
  return {
    name: info.name ?? '',
    email: info.email ?? '',
    phone: info.phone ?? '',
    streetLine1: address.street_line1 ?? '',
    streetLine2: address.street_line2 ?? '',
    city: address.city ?? '',
    state: address.state ?? '',
    countryIso2: address.country_iso2 ?? '',
    postCode: address.post_code ?? ''
  };
}

function photoUrlOf(photo: any): string {
  // A `webDocumentNoProxy` carries a plain URL an <img> can use. The proxied
  // variant has to be downloaded through the file API, which is not worth a
  // round trip for a checkout thumbnail.
  return photo?._ === 'webDocumentNoProxy' ? (photo.url ?? '') : '';
}

async function peerTitleOf(peerId: number): Promise<string> {
  if(!peerId) return '';
  const {managers} = await bootTelegram();
  const peer: any = await managers.appPeersManager.getPeer(peerId).catch(() => null);
  if(!peer) return '';
  return [peer.first_name, peer.last_name].filter(Boolean).join(' ') || peer.title || '';
}

function optionsOf(validated: any): ShippingOption[] {
  return (validated?.shipping_options ?? []).map((option: any) => {
    const prices = pricesOf(option.prices);
    return {
      id: String(option.id ?? ''),
      title: option.title ?? '',
      amount: sumPrices(prices),
      prices
    };
  });
}

async function snapshot(session: Session): Promise<Checkout> {
  const {form} = session;
  const isReceipt = form._ === 'payments.paymentReceipt' || form._ === 'payments.paymentReceiptStars';
  const invoice = form.invoice ?? {};
  const currency: string = invoice.currency ?? form.currency ?? '';

  const prices = pricesOf(invoice.prices);
  const itemsTotal = sumPrices(prices);

  const shippingOptions = optionsOf(session.requestedInfo);
  const shippingAmount = session.shippingOption ?
    sumPrices(pricesOf(session.shippingOption.prices)) :
    0;
  const tipAmount = isReceipt ? Number(form.tip_amount ?? 0) : session.tipAmount;

  const [botTitle, providerTitle] = await Promise.all([
    peerTitleOf(form.bot_id ? Number(form.bot_id) : 0),
    peerTitleOf(form.provider_id ? Number(form.provider_id) : 0)
  ]);

  const pay: Checkout['pay'] =
    currency === TON_CURRENCY ? 'ton' :
    currency === STARS_CURRENCY ? 'stars' :
    'card';

  const nativeProvider = form.native_provider === 'stripe' || form.native_provider === 'smartglocal' ?
    form.native_provider :
    '';

  return {
    id: session.id,
    mode: isReceipt ? 'receipt' : 'form',
    pay,
    title: form.title ?? '',
    description: form.description ?? '',
    photoUrl: photoUrlOf(form.photo),
    currency,
    prices,
    itemsTotal,
    shippingAmount,
    tipAmount,
    total: itemsTotal + shippingAmount + tipAmount,
    maxTipAmount: Number(invoice.max_tip_amount ?? 0),
    suggestedTips: (invoice.suggested_tip_amounts ?? []).map(Number),
    test: !!invoice.pFlags?.test,
    recurring: !!invoice.pFlags?.recurring,
    termsUrl: invoice.terms_url ?? '',
    needName: !!invoice.pFlags?.name_requested,
    needEmail: !!invoice.pFlags?.email_requested,
    needPhone: !!invoice.pFlags?.phone_requested,
    needShippingAddress: !!invoice.pFlags?.shipping_address_requested,
    shippingOptions,
    selectedShippingId: session.shippingOption ? String(session.shippingOption.id) : '',
    infoValidated: !!session.requestedInfo,
    savedInfo: infoOf(form.saved_info ?? form.info),
    savedCards: (form.saved_credentials ?? []).map((card: any) => ({
      id: String(card.id ?? ''),
      title: card.title ?? ''
    })),
    canSaveCard: !!form.pFlags?.can_save_credentials,
    nativeProvider,
    needCardholderName: !!session.nativeParams?.need_cardholder_name,
    needCountry: !!session.nativeParams?.need_country,
    needZip: !!session.nativeParams?.need_zip,
    providerUrl: form.url ?? '',
    extraMethods: (form.additional_methods ?? []).map((method: any) => ({
      url: method.url ?? '',
      title: method.title ?? ''
    })),
    cardTitle: session.cardTitle || form.credentials_title || '',
    botTitle,
    providerTitle,
    date: Number(form.date ?? 0)
  };
}

/* ------------------------------------------------------------------ */
/* Checkout — flow                                                     */
/* ------------------------------------------------------------------ */

/**
 * Fetches a payment form and opens a checkout session for it. Every purchase
 * in this module — invoice, Stars top-up, gift, Premium, giveaway, paid media
 * — funnels through here; only the `InputInvoice` differs.
 */
async function startCheckout(inputInvoice: any, peerId = 0, mid = 0): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const form: any = await managers.appPaymentsManager.getPaymentForm(inputInvoice);

  let nativeParams: any = null;
  if(form.native_params?.data) {
    try {
      nativeParams = JSON.parse(form.native_params.data);
    } catch(err) {
      nativeParams = null;
    }
  }

  const session: Session = {
    id: `checkout${++checkoutSeq}`,
    inputInvoice,
    form,
    nativeParams,
    requestedInfo: null,
    shippingOption: null,
    tipAmount: 0,
    token: null,
    cardTitle: '',
    saveCard: false,
    savedCardId: '',
    tmpPassword: null,
    peerId,
    mid
  };

  checkouts.set(session.id, session);

  // Saved address: revalidate straight away so the shipping options and the
  // requested-info id are ready without the user retyping anything, the same
  // as tweb does on open.
  if(form.saved_info && form.invoice?.pFlags?.shipping_address_requested) {
    try {
      session.requestedInfo = await managers.appPaymentsManager.validateRequestedInfo(
        inputInvoice,
        form.saved_info
      );
    } catch(err) {
      session.requestedInfo = null;
    }
  }

  return snapshot(session);
}

/** Opens the checkout for an invoice message. */
export async function openInvoice(peerId: number, mid: number): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const inputInvoice = await managers.appPaymentsManager.getInputInvoiceByPeerId(peerId, mid);
  return startCheckout(inputInvoice, peerId, mid);
}

/** Opens the checkout for a `t.me/$slug` invoice link. */
export async function openInvoiceSlug(slug: string): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const inputInvoice = await managers.appPaymentsManager.getInputInvoiceBySlug(slug);
  return startCheckout(inputInvoice);
}

/** Opens the read-only receipt of a payment that already went through. */
export async function openReceipt(peerId: number, mid: number): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const receipt: any = await managers.appPaymentsManager.getPaymentReceipt(peerId, mid);

  const session: Session = {
    id: `receipt${++checkoutSeq}`,
    inputInvoice: null,
    form: receipt,
    nativeParams: null,
    requestedInfo: null,
    shippingOption: receipt.shipping ?? null,
    tipAmount: Number(receipt.tip_amount ?? 0),
    token: null,
    cardTitle: receipt.credentials_title ?? '',
    saveCard: false,
    savedCardId: '',
    tmpPassword: null,
    peerId,
    mid
  };

  checkouts.set(session.id, session);
  return snapshot(session);
}

/**
 * Refetches the payment form. `form_id` is single-use, so a retry after a
 * failure — `FORM_EXPIRED` above all — must start from a fresh form.
 */
export async function reloadCheckout(id: string): Promise<Checkout> {
  const session = sessionOf(id);
  if(!session.inputInvoice) return snapshot(session);
  const {managers} = await bootTelegram();
  session.form = await managers.appPaymentsManager.getPaymentForm(session.inputInvoice);
  return snapshot(session);
}

export type ValidationResult = {
  ok: boolean;
  /** Field the server rejected, '' when the failure is not field-specific. */
  field: string;
  error: string;
  checkout: Checkout;
};

const INFO_ERROR_FIELDS: Record<string, string> = {
  ADDRESS_STREET_LINE1_INVALID: 'streetLine1',
  ADDRESS_STREET_LINE2_INVALID: 'streetLine2',
  ADDRESS_CITY_INVALID: 'city',
  ADDRESS_STATE_INVALID: 'state',
  ADDRESS_COUNTRY_INVALID: 'countryIso2',
  ADDRESS_POSTCODE_INVALID: 'postCode',
  REQ_INFO_NAME_INVALID: 'name',
  REQ_INFO_EMAIL_INVALID: 'email',
  REQ_INFO_PHONE_INVALID: 'phone'
};

/** Sends the shipping address / contact details for server validation. */
export async function validateCheckoutInfo(
  id: string,
  info: RequestedInfo,
  save: boolean
): Promise<ValidationResult> {
  const session = sessionOf(id);
  const {managers} = await bootTelegram();

  const needsAddress = !!session.form.invoice?.pFlags?.shipping_address_requested;
  const payload: any = {
    _: 'paymentRequestedInfo',
    name: info.name || undefined,
    email: info.email || undefined,
    phone: info.phone || undefined,
    shipping_address: needsAddress ? {
      _: 'postAddress',
      street_line1: info.streetLine1 ?? '',
      street_line2: info.streetLine2 ?? '',
      city: info.city ?? '',
      state: info.state ?? '',
      country_iso2: (info.countryIso2 ?? '').toUpperCase(),
      post_code: info.postCode ?? ''
    } : undefined
  };

  try {
    session.requestedInfo = await managers.appPaymentsManager.validateRequestedInfo(
      session.inputInvoice,
      payload,
      save || undefined
    );
    // A fresh address invalidates the option picked against the old one.
    session.shippingOption = null;
    return {ok: true, field: '', error: '', checkout: await snapshot(session)};
  } catch(err: any) {
    const type = err?.type || err?.message || 'VALIDATION_FAILED';
    return {
      ok: false,
      field: INFO_ERROR_FIELDS[type] ?? '',
      error: type,
      checkout: await snapshot(session)
    };
  }
}

export async function selectShippingOption(id: string, optionId: string): Promise<Checkout> {
  const session = sessionOf(id);
  const option = (session.requestedInfo?.shipping_options ?? [])
  .find((candidate: any) => String(candidate.id) === optionId);
  if(!option) throw new Error('Unknown shipping option');
  session.shippingOption = option;
  return snapshot(session);
}

export async function setTip(id: string, amount: number): Promise<Checkout> {
  const session = sessionOf(id);
  const max = Number(session.form.invoice?.max_tip_amount ?? 0);
  session.tipAmount = Math.max(0, Math.min(Math.round(amount) || 0, max));
  return snapshot(session);
}

/** Chooses one of the cards already saved with this Telegram account. */
export async function selectSavedCard(id: string, cardId: string): Promise<Checkout> {
  const session = sessionOf(id);
  const card = (session.form.saved_credentials ?? [])
  .find((candidate: any) => String(candidate.id) === cardId);
  if(!card) throw new Error('Unknown saved card');
  session.savedCardId = String(card.id);
  session.cardTitle = card.title ?? '';
  session.token = null;
  return snapshot(session);
}

export type CardInput = {
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
  cardholder: string;
  country: string;
  zip: string;
  save: boolean;
};

/**
 * Tokenizes a card with the invoice's own provider. The card number never
 * reaches Telegram or this app: Stripe and SmartGlocal hand back an opaque
 * token, and that token is what `payments.sendPaymentForm` receives.
 */
export async function tokenizeCard(id: string, card: CardInput): Promise<Checkout> {
  const session = sessionOf(id);
  const provider = session.form.native_provider;
  const params = session.nativeParams ?? {};
  const number = card.number.replace(/\D/g, '');

  let token: any;
  if(provider === 'stripe') {
    const query = new URLSearchParams({
      'card[number]': number,
      'card[exp_month]': String(card.expiryMonth),
      'card[exp_year]': String(card.expiryYear),
      'card[cvc]': card.cvc
    });
    if(card.zip) query.set('card[address_zip]', card.zip);
    if(card.country) query.set('card[address_country]', card.country);
    if(card.cardholder) query.set('card[name]', card.cardholder);

    const response = await fetch(`https://api.stripe.com/v1/tokens?${query}`, {
      method: 'POST',
      headers: {Authorization: `Bearer ${params.publishable_key}`}
    });
    const json: any = await response.json();
    if(json.error) throw new Error(json.error.message || 'The card was declined.');
    // Stripe hands back a token object; only its id travels to Telegram.
    token = {type: 'card', id: json.id};
  } else if(provider === 'smartglocal') {
    const response = await fetch(smartGlocalUrl(params.tokenize_url), {
      method: 'POST',
      headers: {
        'X-PUBLIC-TOKEN': params.public_token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        card: {
          number,
          expiration_month: String(card.expiryMonth).padStart(2, '0'),
          expiration_year: String(card.expiryYear),
          security_code: card.cvc
        }
      })
    });
    const json: any = await response.json();
    if(!json?.data?.token) throw new Error(json?.error?.description || 'The card was declined.');
    token = {type: 'card', token: json.data.token};
  } else {
    throw new Error('This invoice needs the provider\'s own payment page.');
  }

  session.token = token;
  session.savedCardId = '';
  session.saveCard = !!card.save;
  session.cardTitle = `•••• ${number.slice(-4)}`;
  return snapshot(session);
}

/** Only smart-glocal.com may override the tokenize endpoint. */
function smartGlocalUrl(url: string | undefined): string {
  const fallback = 'https://tgb.smart-glocal.com/cds/v1/tokenize/card';
  if(!url) return fallback;
  try {
    const parsed = new URL(url);
    const ok = parsed.protocol === 'https:' &&
      /(^|\.)smart-glocal\.com$/.test(parsed.hostname) &&
      parsed.pathname === '/cds/v1/tokenize/card';
    return ok ? url : fallback;
  } catch(err) {
    return fallback;
  }
}

/**
 * Accepts the credentials a provider-hosted page posted back over the
 * `payment_form_submit` web event. The payload is the provider's own opaque
 * blob and is forwarded verbatim, exactly as the official clients do.
 */
export async function acceptProviderCredentials(
  id: string,
  credentials: any,
  title: string
): Promise<Checkout> {
  const session = sessionOf(id);
  session.token = credentials;
  session.savedCardId = '';
  session.cardTitle = title || 'Card';
  return snapshot(session);
}

export type PayResult =
  | {status: 'done'}
  | {status: 'verify'; url: string}
  | {status: 'needPassword'};

/**
 * Sends the payment form. A saved card needs a temporary password derived from
 * the account's 2FA password — call again with `password` after `needPassword`.
 */
export async function payCheckout(id: string, password?: string): Promise<PayResult> {
  const session = sessionOf(id);
  const {managers} = await bootTelegram();

  let credentials: any;
  if(session.savedCardId) {
    const now = Math.floor(Date.now() / 1000);
    if(!session.tmpPassword || session.tmpPassword.validUntil <= now) {
      if(!password) return {status: 'needPassword'};

      const state: any = await managers.passwordManager.getState();
      const srp = await managers.passwordManager.getInputCheckPassword(password, state);
      const tmp: any = await managers.passwordManager.getTmpPassword(srp, 60);
      session.tmpPassword = {
        password: tmp.tmp_password,
        validUntil: Number(tmp.valid_until ?? 0)
      };
    }

    credentials = {
      _: 'inputPaymentCredentialsSaved',
      id: session.savedCardId,
      tmp_password: session.tmpPassword.password
    };
  } else if(session.token) {
    credentials = {
      _: 'inputPaymentCredentials',
      data: {_: 'dataJSON', data: JSON.stringify(session.token)},
      pFlags: session.saveCard ? {save: true} : {}
    };
  } else {
    throw new Error('Choose a payment method first.');
  }

  const result: any = await managers.appPaymentsManager.sendPaymentForm(
    session.inputInvoice,
    session.form.form_id,
    session.requestedInfo?.id,
    session.shippingOption ? String(session.shippingOption.id) : undefined,
    credentials,
    session.tipAmount || undefined
  );

  if(result?._ === 'payments.paymentVerificationNeeded') {
    return {status: 'verify', url: result.url};
  }

  return {status: 'done'};
}

/**
 * Settles a Stars/TON invoice. There are no credentials — the balance is the
 * payment method — so an insufficient balance is a hard error the caller has
 * to resolve by topping up first.
 */
export async function payWithStars(id: string): Promise<PayResult> {
  const session = sessionOf(id);
  const {managers} = await bootTelegram();

  const isTon = session.form.invoice?.currency === TON_CURRENCY;
  const price = sumPrices(pricesOf(session.form.invoice?.prices));
  const status: any = isTon ?
    await managers.appPaymentsManager.getStarsStatusTon() :
    await managers.appPaymentsManager.getStarsStatus();

  if(starsToNumber(status?.balance) < price) {
    throw Object.assign(new Error('Not enough Stars.'), {type: 'BALANCE_TOO_LOW'});
  }

  await managers.appPaymentsManager.sendStarsForm(session.inputInvoice, session.form.form_id);
  return {status: 'done'};
}

/** Pays a checkout by whichever means its currency implies. */
export function payAnyCheckout(id: string, password?: string): Promise<PayResult> {
  const session = sessionOf(id);
  const currency = session.form.invoice?.currency;
  return currency === STARS_CURRENCY || currency === TON_CURRENCY ?
    payWithStars(id) :
    payCheckout(id, password);
}

/**
 * Fires when the server confirms the payment for a message — the
 * `messageActionPaymentSent` service message. Provider verification finishes
 * out of band, so this is the signal that the money actually moved.
 */
export async function onPaymentSent(
  peerId: number,
  mid: number,
  callback: () => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = (event: any) => {
    if(Number(event?.peerId) === peerId && Number(event?.mid) === mid) callback();
  };
  rootScope.addEventListener('payment_sent', handler);
  return () => rootScope.removeEventListener('payment_sent', handler);
}

/* ------------------------------------------------------------------ */
/* Stars                                                               */
/* ------------------------------------------------------------------ */

export type StarsBalance = {stars: number; ton: number};

export async function loadStarsBalance(refresh = false): Promise<StarsBalance> {
  const {managers} = await bootTelegram();
  const [stars, ton] = await Promise.all([
    managers.appPaymentsManager.getStarsStatus(refresh).catch(() => null),
    managers.appPaymentsManager.getStarsStatusTon(refresh).catch(() => null)
  ]);
  return {
    stars: starsToNumber((stars as any)?.balance),
    ton: starsToNumber((ton as any)?.balance)
  };
}

/** The worker pushes a new balance on every `updateStarsBalance`. */
export async function onStarsBalance(callback: () => void): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  rootScope.addEventListener('stars_balance', callback);
  return () => rootScope.removeEventListener('stars_balance', callback);
}

export type TopupOption = {
  stars: number;
  currency: string;
  amount: number;
  /** Hidden behind "show more" in the official clients. */
  extended: boolean;
};

export async function loadTopupOptions(): Promise<TopupOption[]> {
  const {managers} = await bootTelegram();
  const options: any = await managers.appPaymentsManager.getStarsTopupOptions();
  return (options ?? []).map((option: any) => ({
    stars: Number(option.stars ?? 0),
    currency: option.currency ?? '',
    amount: Number(option.amount ?? 0),
    extended: !!option.pFlags?.extended
  }));
}

/** True when the server has switched star purchases off for this account. */
export async function starsPurchaseBlocked(): Promise<boolean> {
  const {managers} = await bootTelegram();
  const config: any = await managers.apiManager.getAppConfig().catch(() => null);
  return !!config?.stars_purchase_blocked;
}

/**
 * Buying stars is a real-money invoice, so it opens the ordinary card
 * checkout — `sendStarsForm` only ever *spends* stars already owned.
 */
export async function startStarsTopup(option: TopupOption): Promise<Checkout> {
  const inputInvoice = {
    _: 'inputInvoiceStars',
    purpose: {
      _: 'inputStorePaymentStarsTopup',
      amount: option.amount,
      currency: option.currency,
      stars: option.stars
    }
  };
  return startCheckout(inputInvoice);
}

/** Buys stars as a gift for another user. */
export async function startStarsGift(userId: number, option: TopupOption): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const inputInvoice = {
    _: 'inputInvoiceStars',
    purpose: {
      _: 'inputStorePaymentStarsGift',
      amount: option.amount,
      currency: option.currency,
      stars: option.stars,
      user_id: await managers.appUsersManager.getUserInput(userId)
    }
  };
  return startCheckout(inputInvoice);
}

export type StarsTransaction = {
  id: string;
  amount: number;
  ton: boolean;
  date: number;
  title: string;
  description: string;
  incoming: boolean;
  refund: boolean;
  pending: boolean;
  failed: boolean;
  /** Peer the stars went to or came from, 0 when it was a platform transfer. */
  peerId: number;
  peerTitle: string;
};

export type TransactionPage = {items: StarsTransaction[]; next: string};

const PLATFORM_PEERS: Record<string, string> = {
  starsTransactionPeerAppStore: 'App Store',
  starsTransactionPeerPlayMarket: 'Play Market',
  starsTransactionPeerPremiumBot: 'Telegram',
  starsTransactionPeerFragment: 'Fragment',
  starsTransactionPeerAds: 'Telegram Ads',
  starsTransactionPeerAPI: 'Telegram API',
  starsTransactionPeerUnsupported: 'Unsupported'
};

/**
 * One page of the star transaction history. `offset` is the server's opaque
 * cursor: '' for the first page, then whatever the previous page returned.
 */
export async function loadTransactions(
  offset = '',
  direction: 'all' | 'in' | 'out' = 'all',
  ton = false
): Promise<TransactionPage> {
  const {managers} = await bootTelegram();
  const inbound = direction === 'all' ? undefined : direction === 'in';
  const status: any = await managers.appPaymentsManager.getStarsTransactions(offset, inbound, ton);

  const items = await Promise.all((status?.history ?? []).map(async(entry: any) => {
    const amount = starsToNumber(entry.amount);
    const peerId = entry.peer?._ === 'starsTransactionPeer' ?
      Number(await getPeerId(entry.peer.peer)) :
      0;

    return {
      id: String(entry.id ?? `${entry.date}`),
      amount: Math.abs(amount),
      ton: entry.amount?._ === 'starsTonAmount',
      date: Number(entry.date ?? 0),
      title: entry.title || PLATFORM_PEERS[entry.peer?._] || '',
      description: entry.description ?? '',
      incoming: amount >= 0,
      refund: !!entry.pFlags?.refund,
      pending: !!entry.pFlags?.pending,
      failed: !!entry.pFlags?.failed,
      peerId,
      peerTitle: peerId ? await peerTitleOf(peerId) : ''
    };
  }));

  return {items, next: status?.next_offset ?? ''};
}

async function getPeerId(peer: any): Promise<number> {
  const {default: getPeerIdImpl} = await import('@appManagers/utils/peers/getPeerId');
  return Number(getPeerIdImpl(peer));
}

/* ------------------------------------------------------------------ */
/* Star gifts                                                          */
/* ------------------------------------------------------------------ */

export type GiftOption = {
  giftId: string;
  sticker: StickerItem;
  stars: number;
  /** How many stars converting this gift back would yield, 0 when it cannot. */
  convertStars: number;
  upgradeStars: number;
  limited: boolean;
  soldOut: boolean;
  remains: number;
  total: number;
  premiumOnly: boolean;
};

export async function loadGiftCatalog(): Promise<GiftOption[]> {
  const {managers} = await bootTelegram();
  const gifts: any[] = await managers.appGiftsManager.getStarGiftOptions() as any;

  return (gifts ?? [])
  .filter((gift) => gift?.raw?._ === 'starGift' && !gift.isResale)
  .map((gift) => ({
    giftId: String(gift.raw.id),
    sticker: adoptSticker(gift.sticker),
    stars: Number(gift.raw.stars ?? 0),
    convertStars: Number(gift.raw.convert_stars ?? 0),
    upgradeStars: Number(gift.raw.upgrade_stars ?? 0),
    limited: !!gift.raw.availability_total,
    soldOut: !!gift.raw.availability_total && !gift.raw.availability_remains,
    remains: Number(gift.raw.availability_remains ?? 0),
    total: Number(gift.raw.availability_total ?? 0),
    premiumOnly: !!gift.raw.pFlags?.require_premium
  }));
}

export type SendGiftOptions = {
  peerId: number;
  giftId: string;
  message?: string;
  /** Hide the sender's name on the recipient's profile. */
  anonymous?: boolean;
  includeUpgrade?: boolean;
};

/**
 * Sends a star gift. The gift is priced in stars, so the form comes back as
 * `paymentFormStarGift` and is settled straight from the balance.
 */
export async function sendStarGift(options: SendGiftOptions): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const inputInvoice: any = {
    _: 'inputInvoiceStarGift',
    pFlags: {
      hide_name: options.anonymous || undefined,
      include_upgrade: options.includeUpgrade || undefined
    },
    peer: await managers.appPeersManager.getInputPeerById(options.peerId),
    gift_id: options.giftId,
    message: options.message ?
      {_: 'textWithEntities', text: options.message, entities: []} :
      undefined
  };
  return startCheckout(inputInvoice, options.peerId, 0);
}

export type OwnedGift = {
  /** Opaque handle for `convertGift` / `setGiftShownOnProfile`. */
  key: string;
  sticker: StickerItem;
  title: string;
  stars: number;
  convertStars: number;
  date: number;
  fromId: number;
  fromTitle: string;
  message: string;
  /** False when the gift is hidden from the owner's profile. */
  shown: boolean;
  converted: boolean;
  unique: boolean;
  incoming: boolean;
  canConvert: boolean;
};

/** Raw `InputSavedStarGift`s, keyed by the handle handed to the UI. */
const giftInputs = new Map<string, any>();
let giftSeq = 0;

export type GiftPage = {items: OwnedGift[]; next: string; count: number};

export async function loadProfileGifts(peerId: number, offset = ''): Promise<GiftPage> {
  const {managers} = await bootTelegram();
  const result: any = await managers.appGiftsManager.getProfileGifts({peerId, offset});

  const items = await Promise.all((result?.gifts ?? []).map(async(gift: any) => {
    const key = `gift${++giftSeq}`;
    giftInputs.set(key, gift.input);

    const saved = gift.saved ?? {};
    const fromId = saved.from_id ? Number(await getPeerId(saved.from_id)) : 0;
    const raw = gift.raw ?? {};

    return {
      key,
      sticker: adoptSticker(gift.sticker),
      title: raw._ === 'starGiftUnique' ? (raw.title ?? 'Collectible gift') : 'Gift',
      stars: Number(raw.stars ?? 0),
      convertStars: Number(saved.convert_stars ?? 0),
      date: Number(saved.date ?? 0),
      fromId,
      fromTitle: fromId ? await peerTitleOf(fromId) : '',
      message: saved.message?.text ?? '',
      shown: !saved.pFlags?.unsaved,
      converted: !!gift.isConverted,
      unique: raw._ === 'starGiftUnique',
      incoming: !!gift.isIncoming,
      canConvert: !!saved.convert_stars && !!gift.isIncoming && !gift.isConverted
    };
  }));

  return {items, next: result?.next ?? '', count: Number(result?.count ?? items.length)};
}

/** Turns a received gift back into stars. Irreversible. */
export async function convertGift(key: string): Promise<void> {
  const input = giftInputs.get(key);
  if(!input) throw new Error('This gift is no longer loaded — reopen the list.');
  const {managers} = await bootTelegram();
  await managers.appGiftsManager.convertGift(input);
}

/** Show or hide a received gift on the owner's profile. */
export async function setGiftShownOnProfile(key: string, shown: boolean): Promise<void> {
  const input = giftInputs.get(key);
  if(!input) throw new Error('This gift is no longer loaded — reopen the list.');
  const {managers} = await bootTelegram();
  await managers.appGiftsManager.toggleGiftHidden(input, !shown);
}

/** Fires whenever a gift list for this peer changed server-side. */
export async function onGiftListUpdate(
  peerId: number,
  callback: () => void
): Promise<() => void> {
  const {default: rootScope} = await import('@lib/rootScope');
  const handler = (event: any) => {
    if(Number(event?.peerId) === peerId) callback();
  };
  rootScope.addEventListener('star_gift_list_update', handler);
  return () => rootScope.removeEventListener('star_gift_list_update', handler);
}

/* ------------------------------------------------------------------ */
/* Premium                                                             */
/* ------------------------------------------------------------------ */

/**
 * The feature list is client-side in every Telegram client; the server only
 * sends the order (`appConfig.premium_promo_order`) and the promo videos.
 */
const PREMIUM_FEATURES: Record<string, {title: string; description: string}> = {
  stories: {title: 'Upgraded stories', description: 'Priority order, stealth mode, permanent view history and more.'},
  double_limits: {title: 'Doubled limits', description: 'More channels, folders, pinned chats, saved GIFs and favourite stickers.'},
  more_upload: {title: 'Larger uploads', description: 'Send files of up to 4 GB each.'},
  faster_download: {title: 'Faster downloads', description: 'No speed limit on media and documents.'},
  voice_to_text: {title: 'Voice-to-text', description: 'Transcribe any voice message into text.'},
  no_ads: {title: 'No ads', description: 'Sponsored messages in public channels are hidden.'},
  infinite_reactions: {title: 'Unique reactions', description: 'React with any emoji, not just the default set.'},
  premium_stickers: {title: 'Premium stickers', description: 'Exclusive packs with full-screen effects.'},
  animated_emoji: {title: 'Animated emoji', description: 'Custom animated emoji anywhere in a message.'},
  emoji_status: {title: 'Emoji status', description: 'Show an animated status next to your name.'},
  profile_badge: {title: 'Profile badge', description: 'A premium star beside your name.'},
  animated_userpics: {title: 'Animated profile photos', description: 'Your profile picture plays for everyone.'},
  advanced_chat_management: {title: 'Chat management', description: 'Set a default folder, auto-archive and hide new chats.'},
  translations: {title: 'Real-time translation', description: 'Translate whole chats as you read them.'},
  peer_colors: {title: 'Name colour', description: 'Pick the colour and pattern of your messages.'},
  wallpapers: {title: 'Wallpapers', description: 'Set a per-chat wallpaper both sides can see.'},
  saved_tags: {title: 'Saved-message tags', description: 'Tag saved messages and filter by tag.'},
  last_seen: {title: 'Last seen control', description: 'Hide your last seen without losing everyone else\'s.'},
  message_privacy: {title: 'Message privacy', description: 'Only let people you choose message you.'},
  pm_noforwards: {title: 'Restrict forwarding', description: 'Stop your private messages being forwarded.'}
};

export type PremiumOption = {
  months: number;
  currency: string;
  amount: number;
  /** Per-month price, for the "€X per month" line. */
  monthly: number;
  current: boolean;
  /**
   * Where the purchase actually happens. Telegram Web does not process the
   * subscription itself — the server hands out a bot URL that runs the real
   * payment flow, and that is what the official web client opens too.
   */
  botUrl: string;
};

export type PremiumPage = {
  active: boolean;
  /** Free-text status line from the server ("your subscription ends on…"). */
  statusText: string;
  features: {key: string; title: string; description: string}[];
  options: PremiumOption[];
  /** The server can disable purchases entirely for an account or region. */
  purchaseBlocked: boolean;
};

export async function loadPremiumPage(): Promise<PremiumPage> {
  const {managers} = await bootTelegram();
  const [self, promo, config] = await Promise.all([
    managers.appUsersManager.getSelf().catch((): any => null),
    managers.appPaymentsManager.getPremiumPromo().catch((): any => null),
    managers.apiManager.getAppConfig().catch((): any => null)
  ]);

  const order: string[] = (config as any)?.premium_promo_order ?? Object.keys(PREMIUM_FEATURES);
  const features = order
  .filter((key) => PREMIUM_FEATURES[key])
  .map((key) => ({key, ...PREMIUM_FEATURES[key]}));

  const periodOptions: any[] = (promo as any)?.period_options ?? [];
  const options: PremiumOption[] = periodOptions.map((option: any) => ({
    months: Number(option.months ?? 0),
    currency: option.currency ?? '',
    amount: Number(option.amount ?? 0),
    monthly: Math.round(Number(option.amount ?? 0) / Math.max(1, Number(option.months ?? 1))),
    current: !!option.pFlags?.current,
    botUrl: option.bot_url ?? ''
  }));

  return {
    active: !!(self as any)?.pFlags?.premium,
    statusText: (promo as any)?.status_text ?? '',
    features,
    options,
    purchaseBlocked: !!(config as any)?.premium_purchase_blocked
  };
}

export type PremiumGiftOption = {
  months: number;
  currency: string;
  amount: number;
  starsAmount: number;
  discountPercent: number;
};

/** Raw `PremiumGiftCodeOption`s, kept out of Svelte state. */
const premiumGiftRaw = new Map<number, any>();

export async function loadPremiumGiftOptions(): Promise<PremiumGiftOption[]> {
  const {managers} = await bootTelegram();
  const options: any[] = await managers.appGiftsManager.getPremiumGiftOptions() as any;

  premiumGiftRaw.clear();
  return (options ?? []).filter(Boolean).map((option: any) => {
    premiumGiftRaw.set(option.months, option.raw);
    return {
      months: Number(option.months ?? 0),
      currency: option.currency ?? '',
      amount: Number(option.price ?? 0),
      starsAmount: Number(option.priceStars ?? 0),
      discountPercent: Math.round(Number(option.discountPercent ?? 0))
    };
  });
}

/**
 * Gifts Premium to a user. `withStars` picks the stars-priced variant, which
 * settles from the balance instead of a card.
 */
export async function giftPremium(
  userId: number,
  months: number,
  withStars = false,
  message = ''
): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const user = await managers.appUsersManager.getUserInput(userId);
  const text = message ? {_: 'textWithEntities', text: message, entities: []} : undefined;

  if(withStars) {
    return startCheckout({
      _: 'inputInvoicePremiumGiftStars',
      user_id: user,
      months,
      message: text
    }, userId, 0);
  }

  const option = premiumGiftRaw.get(months);
  if(!option) throw new Error('Reload the gift options first.');

  return startCheckout({
    _: 'inputInvoicePremiumGiftCode',
    option,
    purpose: {
      _: 'inputStorePaymentPremiumGiftCode',
      users: [user],
      currency: option.currency,
      amount: option.amount,
      message: text
    }
  }, userId, 0);
}

/* ------------------------------------------------------------------ */
/* Paid media and paid reactions                                       */
/* ------------------------------------------------------------------ */

/**
 * Opens the checkout that unlocks a paid-media post. It is an ordinary message
 * invoice priced in stars, so the caller pays it with `payWithStars`; the
 * unlocked media then arrives as a normal message edit.
 */
export function unlockPaidMedia(peerId: number, mid: number): Promise<Checkout> {
  return openInvoice(peerId, mid);
}

/**
 * Sends a paid (star) reaction. The stars leave the balance immediately —
 * there is no confirmation step server-side, so the caller must confirm first.
 */
export async function sendPaidReaction(
  peerId: number,
  mid: number,
  count: number,
  anonymous = false
): Promise<void> {
  if(!(count > 0)) throw new Error('Choose how many Stars to send.');

  const {managers} = await bootTelegram();
  const balance = await loadStarsBalance();
  if(balance.stars < count) {
    throw Object.assign(new Error('Not enough Stars.'), {type: 'BALANCE_TOO_LOW'});
  }

  const message = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) throw new Error('Message not found');

  // tweb maps the "send as" peer to a PaidReactionPrivacy: the anonymous
  // sentinel hides the name, our own id means "use my default".
  const {SEND_PAID_REACTION_ANONYMOUS_PEER_ID} = await import('@appManagers/constants');
  const self = await managers.appUsersManager.getSelf();
  const sendAsPeerId = anonymous ?
    SEND_PAID_REACTION_ANONYMOUS_PEER_ID :
    Number((self as any)?.id ?? 0);

  await managers.appReactionsManager.sendReaction({
    message,
    reaction: {_: 'reactionPaid'},
    count,
    sendAsPeerId
  } as any);
}

/** Whether posts in this peer accept paid (star) reactions at all. */
export async function paidReactionsAvailable(peerId: number): Promise<boolean> {
  const {managers} = await bootTelegram();
  return !!await managers.appReactionsManager.isPaidReactionAvailable(peerId).catch(() => false);
}

/** Largest paid reaction the server will accept in one go. */
export async function maxPaidReaction(): Promise<number> {
  const {managers} = await bootTelegram();
  const config: any = await managers.apiManager.getAppConfig().catch(() => null);
  return Number(config?.stars_paid_reaction_amount_max ?? 2500);
}

/* ------------------------------------------------------------------ */
/* Boosts                                                              */
/* ------------------------------------------------------------------ */

export type BoostStatus = {
  level: number;
  boosts: number;
  giftBoosts: number;
  currentLevelBoosts: number;
  /** 0 when the channel is already at the top level. */
  nextLevelBoosts: number;
  /** 0..1 through the current level. */
  progress: number;
  maxLevel: boolean;
  premiumAudiencePercent: number;
  boostUrl: string;
  myBoost: boolean;
  myBoostSlots: number[];
};

export async function loadBoostStatus(peerId: number): Promise<BoostStatus> {
  const {managers} = await bootTelegram();
  const status: any = await managers.appBoostsManager.getBoostsStatus(peerId);

  const boosts = Number(status.boosts ?? 0);
  const current = Number(status.current_level_boosts ?? 0);
  const next = status.next_level_boosts === undefined ? 0 : Number(status.next_level_boosts);
  const maxLevel = next === 0;

  return {
    level: Number(status.level ?? 0),
    boosts,
    giftBoosts: Number(status.gift_boosts ?? 0),
    currentLevelBoosts: current,
    nextLevelBoosts: next,
    progress: maxLevel || next === current ? 1 : (boosts - current) / (next - current),
    maxLevel,
    premiumAudiencePercent: status.premium_audience ?
      Math.round((Number(status.premium_audience.part ?? 0) / Math.max(1, Number(status.premium_audience.total ?? 1))) * 100) :
      0,
    boostUrl: status.boost_url ?? '',
    myBoost: !!status.pFlags?.my_boost,
    myBoostSlots: (status.my_boost_slots ?? []).map(Number)
  };
}

export type BoostSlot = {
  slot: number;
  /** 0 when the slot is free. */
  peerId: number;
  peerTitle: string;
  expires: number;
  cooldownUntil: number;
};

export async function loadMyBoostSlots(): Promise<BoostSlot[]> {
  const {managers} = await bootTelegram();
  const mine: any = await managers.appBoostsManager.getMyBoosts();

  return Promise.all((mine?.my_boosts ?? []).map(async(boost: any) => {
    const peerId = boost.peer ? Number(await getPeerId(boost.peer)) : 0;
    return {
      slot: Number(boost.slot ?? 0),
      peerId,
      peerTitle: peerId ? await peerTitleOf(peerId) : '',
      expires: Number(boost.expires ?? 0),
      cooldownUntil: Number(boost.cooldown_until_date ?? 0)
    };
  }));
}

/**
 * Boosts a channel with the given slots. Boosting needs Premium; without it
 * the server refuses with `PREMIUM_ACCOUNT_REQUIRED`.
 */
export async function boostChannel(peerId: number, slots: number[]): Promise<BoostStatus> {
  const {managers} = await bootTelegram();
  await managers.appBoostsManager.applyBoost(peerId, slots);
  return loadBoostStatus(peerId);
}

/* ------------------------------------------------------------------ */
/* Giveaways                                                           */
/* ------------------------------------------------------------------ */

export type GiveawayInfo = {
  /** '' when the giveaway is still running. */
  status: string;
  participating: boolean;
  preparingResults: boolean;
  finished: boolean;
  winner: boolean;
  refunded: boolean;
  startDate: number;
  finishDate: number;
  winnersCount: number;
  activatedCount: number;
  /** Gift-code slug when we won, '' otherwise. */
  giftCodeSlug: string;
  starsPrize: number;
};

export async function loadGiveawayInfo(peerId: number, mid: number): Promise<GiveawayInfo> {
  const {managers} = await bootTelegram();
  const info: any = await managers.appPaymentsManager.getGiveawayInfo(peerId, mid);
  const finished = info._ === 'payments.giveawayInfoResults';

  let status = '';
  if(info.pFlags?.refunded) status = 'The giveaway was cancelled and the payment refunded.';
  else if(finished && info.pFlags?.winner) status = 'You won this giveaway.';
  else if(finished) status = 'You did not win this giveaway.';
  else if(info.joined_too_early_date) status = 'You joined the channel after the giveaway started.';
  else if(info.disallowed_country) status = 'Your country is not eligible for this giveaway.';
  else if(info.admin_disallowed_chat_id) status = 'An admin of one of the channels cannot take part.';
  else if(info.pFlags?.participating) status = 'You are taking part in this giveaway.';

  return {
    status,
    participating: !!info.pFlags?.participating,
    preparingResults: !!info.pFlags?.preparing_results,
    finished,
    winner: !!info.pFlags?.winner,
    refunded: !!info.pFlags?.refunded,
    startDate: Number(info.start_date ?? 0),
    finishDate: Number(info.finish_date ?? 0),
    winnersCount: Number(info.winners_count ?? 0),
    activatedCount: Number(info.activated_count ?? 0),
    giftCodeSlug: info.gift_code_slug ?? '',
    starsPrize: Number(info.stars_prize ?? 0)
  };
}

export type GiveawayLimits = {
  maxPeers: number;
  maxCountries: number;
  maxPeriod: number;
  boostsPerPremium: number;
};

/** Raw `PremiumGiftCodeOption`s for the channel a giveaway is being set up in. */
let giveawayOptions: any[] = [];

export type GiveawaySetup = {
  limits: GiveawayLimits;
  /** Premium prize options, one per (winner count, months) pair. */
  premiumWinnerCounts: number[];
  premiumMonths: number[];
};

export async function loadGiveawaySetup(peerId: number): Promise<GiveawaySetup> {
  const {managers} = await bootTelegram();
  const [options, config] = await Promise.all([
    managers.appPaymentsManager.getPremiumGiftCodeOptions(peerId) as Promise<any>,
    managers.apiManager.getAppConfig().catch((): any => null)
  ]);

  giveawayOptions = options ?? [];

  const winners = [...new Set((giveawayOptions).map((option: any) => Number(option.users)))]
  .filter((count) => count > 0)
  .sort((a, b) => a - b);
  const months = [...new Set((giveawayOptions).map((option: any) => Number(option.months)))]
  .sort((a, b) => a - b);

  return {
    limits: {
      maxPeers: Number((config as any)?.giveaway_add_peers_max ?? 10),
      maxCountries: Number((config as any)?.giveaway_countries_max ?? 10),
      maxPeriod: Number((config as any)?.giveaway_period_max ?? 604800),
      boostsPerPremium: Number((config as any)?.giveaway_boosts_per_premium ?? 1)
    },
    premiumWinnerCounts: winners,
    premiumMonths: months
  };
}

export type CreateGiveawayOptions = {
  peerId: number;
  winners: number;
  months: number;
  untilDate: number;
  onlyNewSubscribers: boolean;
  showWinners: boolean;
  prizeDescription: string;
  countriesIso2: string[];
  additionalPeerIds: number[];
};

/**
 * Opens the checkout that launches a Premium giveaway in a channel. The
 * giveaway only starts once the invoice is paid.
 */
export async function createGiveaway(options: CreateGiveawayOptions): Promise<Checkout> {
  const {managers} = await bootTelegram();
  const option = giveawayOptions.find((candidate: any) =>
    Number(candidate.users) === options.winners && Number(candidate.months) === options.months
  );
  if(!option) throw new Error('That prize combination is not available for this channel.');

  const {randomLong} = await import('@helpers/random');
  const peers = await Promise.all(
    [options.peerId, ...options.additionalPeerIds]
    .map((peerId) => managers.appPeersManager.getInputPeerById(peerId))
  );

  const purpose: any = {
    _: 'inputStorePaymentPremiumGiveaway',
    currency: option.currency,
    amount: option.amount,
    pFlags: {
      only_new_subscribers: options.onlyNewSubscribers || undefined,
      winners_are_visible: options.showWinners || undefined
    },
    boost_peer: peers[0],
    additional_peers: peers.length > 1 ? peers.slice(1) : undefined,
    countries_iso2: options.countriesIso2.length ? options.countriesIso2 : undefined,
    prize_description: options.prizeDescription || undefined,
    random_id: randomLong(),
    until_date: options.untilDate
  };

  return startCheckout({
    _: 'inputInvoicePremiumGiftCode',
    purpose,
    option
  }, options.peerId, 0);
}

export type GiftCodeInfo = {
  slug: string;
  fromId: number;
  fromTitle: string;
  toId: number;
  days: number;
  date: number;
  usedDate: number;
  viaGiveaway: boolean;
};

export async function checkGiftCode(slug: string): Promise<GiftCodeInfo> {
  const {managers} = await bootTelegram();
  const checked: any = await managers.appPaymentsManager.checkGiftCode(slug);
  const fromId = checked.from_id ? Number(await getPeerId(checked.from_id)) : 0;

  return {
    slug,
    fromId,
    fromTitle: fromId ? await peerTitleOf(fromId) : '',
    toId: checked.to_id ? Number(checked.to_id) : 0,
    days: Number(checked.days ?? 0),
    date: Number(checked.date ?? 0),
    usedDate: Number(checked.used_date ?? 0),
    viaGiveaway: !!checked.pFlags?.via_giveaway
  };
}

/** Redeems a Premium gift code onto this account. */
export async function applyGiftCode(slug: string): Promise<void> {
  const {managers} = await bootTelegram();
  await managers.appPaymentsManager.applyGiftCode(slug);
}

/* ------------------------------------------------------------------ */
/* Message previews                                                    */
/* ------------------------------------------------------------------ */

export type PaymentPreview =
  | {
      kind: 'invoice';
      title: string;
      description: string;
      currency: string;
      amount: number;
      /** The invoice has already been paid — open the receipt instead. */
      paid: boolean;
      receiptMid: number;
      test: boolean;
    }
  | {
      kind: 'paidMedia';
      stars: number;
      count: number;
      /** False once the stars have been paid and the media is visible. */
      locked: boolean;
    }
  | {
      kind: 'giveaway';
      quantity: number;
      months: number;
      stars: number;
      untilDate: number;
      onlyNewSubscribers: boolean;
      channelCount: number;
      prizeDescription: string;
    }
  | {
      kind: 'giveawayResults';
      winnersCount: number;
      unclaimedCount: number;
      months: number;
      stars: number;
      refunded: boolean;
    }
  | {
      kind: 'starGift';
      stars: number;
      convertStars: number;
      message: string;
      incoming: boolean;
      converted: boolean;
      unique: boolean;
    }
  | {kind: 'giftCode'; slug: string; months: number}
  | {kind: 'paymentSent'; currency: string; amount: number; recurring: boolean};

/**
 * Extracts everything the bubble needs to render a payment-related message.
 * Pure: it only reads the raw message `chats.ts` already holds.
 */
export function paymentPreviewOf(message: any): PaymentPreview | null {
  const media = message?.media;

  if(media?._ === 'messageMediaInvoice') {
    const extended = media.extended_media;
    return {
      kind: 'invoice',
      title: media.title ?? '',
      description: media.description ?? '',
      currency: media.currency ?? '',
      amount: Number(media.total_amount ?? 0),
      paid: !!media.receipt_msg_id || extended?._ === 'messageExtendedMedia',
      receiptMid: Number(media.receipt_msg_id ?? 0),
      test: !!media.pFlags?.test
    };
  }

  if(media?._ === 'messageMediaPaidMedia') {
    const items: any[] = media.extended_media ?? [];
    return {
      kind: 'paidMedia',
      stars: Number(media.stars_amount ?? 0),
      count: items.length,
      locked: items.some((item) => item?._ === 'messageExtendedMediaPreview')
    };
  }

  if(media?._ === 'messageMediaGiveaway') {
    return {
      kind: 'giveaway',
      quantity: Number(media.quantity ?? 0),
      months: Number(media.months ?? 0),
      stars: Number(media.stars ?? 0),
      untilDate: Number(media.until_date ?? 0),
      onlyNewSubscribers: !!media.pFlags?.only_new_subscribers,
      channelCount: (media.channels ?? []).length,
      prizeDescription: media.prize_description ?? ''
    };
  }

  if(media?._ === 'messageMediaGiveawayResults') {
    return {
      kind: 'giveawayResults',
      winnersCount: Number(media.winners_count ?? 0),
      unclaimedCount: Number(media.unclaimed_count ?? 0),
      months: Number(media.months ?? 0),
      stars: Number(media.stars ?? 0),
      refunded: !!media.pFlags?.refunded
    };
  }

  const action = message?.action;

  if(action?._ === 'messageActionStarGift' || action?._ === 'messageActionStarGiftUnique') {
    const gift = action.gift ?? {};
    return {
      kind: 'starGift',
      stars: Number(gift.stars ?? 0),
      convertStars: Number(action.convert_stars ?? gift.convert_stars ?? 0),
      message: action.message?.text ?? '',
      incoming: !message?.pFlags?.out,
      converted: !!action.pFlags?.converted,
      unique: action._ === 'messageActionStarGiftUnique'
    };
  }

  if(action?._ === 'messageActionGiftCode') {
    return {
      kind: 'giftCode',
      slug: action.slug ?? '',
      months: Number(action.months ?? 0)
    };
  }

  if(action?._ === 'messageActionPaymentSent' || action?._ === 'messageActionPaymentSentMe') {
    return {
      kind: 'paymentSent',
      currency: action.currency ?? '',
      amount: Number(action.total_amount ?? 0),
      recurring: !!action.pFlags?.recurring_used || !!action.pFlags?.recurring_init
    };
  }

  return null;
}
