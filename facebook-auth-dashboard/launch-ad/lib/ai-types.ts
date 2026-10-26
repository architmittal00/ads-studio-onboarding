/** Shared by the server (writes the text) and the browser (shows it). */
export type CopyLanguage = 'EN' | 'HINGLISH' | 'HI';

export interface CopyRequest {
  accountId: string;
  kind: 'IMAGE' | 'VIDEO';
  /** The image, or the video's cover image (kept as a fallback when the video can't be opened) */
  imageHash: string;
  /** Empty while the video is still uploading */
  videoId: string;
  /** A small low-resolution copy of the whole video made in the browser (MP4 as base64), if it could be made */
  proxy?: string;
  pageName: string;
  link: string;
  /** The call-to-action button's label, e.g. "Shop now" */
  cta: string;
  language: CopyLanguage;
  /** Offer or details the person wants mentioned. The only source of offers the AI may use. */
  offer: string;
  /** What is already written; the AI improves on it instead of ignoring it */
  draft: { message: string; headline: string; description: string };
}

export interface CopyOption {
  primary_text: string;
  headline: string;
  description: string;
  /** Things in the text that Meta or ASCI often reject, or that need checking */
  warnings: string[];
}

export interface CopyResult {
  copy: CopyOption;
  /** What the AI actually looked at */
  saw: 'VIDEO' | 'IMAGE' | 'COVER';
  /** Video only: the browser's low-resolution copy (silent), or the link to the video on Meta */
  via?: 'copy' | 'link';
  note?: string;
  model: string;
}

export interface AiStatus { enabled: boolean; model: string; maxVideoSeconds: number; /** The browser should make a low-resolution copy of videos */ videoCopy: boolean }

export const COPY_LIMITS = { primary: 600, headline: 40, description: 250 };
