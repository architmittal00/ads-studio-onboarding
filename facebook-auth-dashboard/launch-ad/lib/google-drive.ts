/* eslint-disable @typescript-eslint/no-explicit-any */
// "Choose from Google Drive" for the ad upload. Runs entirely in the browser: Google's sign-in popup asks for access
// to just the file the person picks (the drive.file scope), the Google Picker shows their Drive, and the picked file is
// downloaded with that short-lived token and handed to the same upload as a file chosen from the computer.
// Needs a Google Cloud OAuth client + API key (see README "Google Drive upload"); without them the button is hidden.

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY || '';
// The Google Cloud project number; lets the Picker grant this app access to the picked file.
const APP_ID = process.env.NEXT_PUBLIC_GOOGLE_APP_ID || '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const driveConfigured = () => !!(CLIENT_ID && API_KEY);

export interface DriveDoc { id: string; name: string; mimeType: string; sizeBytes: number }

const scripts = new Map<string, Promise<void>>();
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => { scripts.delete(src); reject(new Error('Could not load Google Drive. Check your connection or ad blocker.')); };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

async function ensurePicker(): Promise<void> {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
  const w = window as any;
  if (w.google?.picker) return;
  await new Promise<void>((resolve, reject) => w.gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Could not load the Google Drive picker.')) }));
}

function accessToken(): Promise<string> {
  const w = window as any;
  return new Promise((resolve, reject) => {
    const client = w.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r: any) => (r?.access_token ? resolve(r.access_token) : reject(new Error(r?.error === 'access_denied' ? 'Google Drive access was not allowed.' : 'Could not sign in to Google Drive.'))),
      error_callback: (e: any) => reject(new Error(e?.type === 'popup_closed' ? 'cancelled' : 'Could not sign in to Google Drive.')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

function pick(token: string, mimeTypes: string): Promise<DriveDoc | null> {
  const w = window as any;
  return new Promise((resolve) => {
    const view = new w.google.picker.DocsView(w.google.picker.ViewId.DOCS).setMimeTypes(mimeTypes).setIncludeFolders(true).setSelectFolderEnabled(false);
    const builder = new w.google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setTitle('Choose an image or video')
      .setCallback((data: any) => {
        if (data.action === w.google.picker.Action.PICKED) {
          const d = data.docs[0];
          resolve({ id: d.id, name: d.name, mimeType: d.mimeType, sizeBytes: Number(d.sizeBytes) || 0 });
        } else if (data.action === w.google.picker.Action.CANCEL) resolve(null);
      });
    if (APP_ID) builder.setAppId(APP_ID);
    builder.build().setVisible(true);
  });
}

/**
 * Opens Google Drive, lets the person pick one image or video, and returns it as a File (null if they close the picker).
 * `check` can refuse a pick before anything is downloaded (return the message to show); `onProgress` gets 0..1.
 */
export async function pickFromDrive(mimeTypes: string, check: (doc: DriveDoc) => string | null, onProgress: (fraction: number) => void): Promise<File | null> {
  await ensurePicker();
  let token: string;
  try { token = await accessToken(); } catch (e: any) { if (e?.message === 'cancelled') return null; throw e; }
  const doc = await pick(token, mimeTypes);
  if (!doc) return null;
  const refused = check(doc);
  if (refused) throw new Error(refused);

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(doc.id)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok || !res.body) throw new Error(res.status === 403 || res.status === 404 ? 'Google Drive would not share that file. Try picking it again.' : `Google Drive returned an error (${res.status}).`);
  const total = doc.sizeBytes || Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length;
    if (total) onProgress(Math.min(1, got / total));
  }
  return new File(parts as BlobPart[], doc.name, { type: doc.mimeType });
}
