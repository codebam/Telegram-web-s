/*
 * Message translation and voice-to-text.
 *
 * Both are Premium features in Telegram and both live in tweb's managers
 * (`appTranslationsManager.translateText`, `appMessagesManager.transcribeAudio`);
 * neither client ever called them, so a translated message and a transcribed
 * voice note simply did not exist here. Nothing is cached in this module: the
 * managers cache their own results per message and per language, and the UI
 * keeps only what it is currently showing.
 */
import {bootTelegram} from './client';
import {currentLanguage} from './appearance';

export type TranslationResult = {
  text: string;
  /** Entities of the translated text, so formatting survives. */
  entities: any[];
};

/** The message's text in the app's own language, or `lang` when one is given. */
export async function translateMessage(
  peerId: number,
  mid: number,
  lang?: string
): Promise<TranslationResult | null> {
  const {managers} = await bootTelegram();
  const to = lang ?? await currentLanguage();

  const result: any = await managers.appTranslationsManager.translateText({peerId, mid, lang: to});
  if(!result) return null;

  return {text: result.text ?? '', entities: result.entities ?? []};
}

/**
 * Voice-to-text for a voice note or a round video. `noPending` makes the call
 * resolve with the finished text rather than the acknowledgement that a
 * transcription has started, so the caller has one result to render — a long
 * recording streams its text through an update, which is the case that flag
 * exists for.
 */
export async function transcribeVoice(peerId: number, mid: number): Promise<string | null> {
  const {managers} = await bootTelegram();
  const message: any = await managers.appMessagesManager.getMessageByPeer(peerId, mid);
  if(!message) return null;

  const result: any = await managers.appMessagesManager.transcribeAudio(message, true);
  return result?.text ?? '';
}
