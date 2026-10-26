/** Privacy policy and terms links, required for Meta App Review and shown on every screen. */
export const PRIVACY_URL = 'https://www.shiprocket.in/privacy-policy/';
export const TERMS_URL = 'https://www.shiprocket.in/terms-conditions/';

export default function LegalLinks({ style }: { style?: React.CSSProperties }) {
  return (
    <p className="hint" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', ...style }}>
      <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Privacy Policy</a>
      <a href={TERMS_URL} target="_blank" rel="noreferrer">Terms &amp; Conditions</a>
      <span>© Shiprocket</span>
    </p>
  );
}
