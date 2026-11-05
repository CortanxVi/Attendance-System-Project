import { QRCodeSVG } from 'qrcode.react';

interface FloatingQrWindowProps {
  courseCode: string;
  courseName: string;
  qrValue: string;
  hasToken: boolean;
  error: string | null;
}

/**
 * Content of the floating Picture-in-Picture window.
 * It lives in a separate document that does not load the app's Tailwind CSS, so
 * everything here uses inline styles.
 */
export default function FloatingQrWindow({ courseCode, courseName, qrValue, hasToken, error }: FloatingQrWindowProps) {
  return (
    <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minHeight: '100vh', padding: 10, background: '#f8fafc', color: '#1e293b' }}>
      <div style={{ textAlign: 'center', lineHeight: 1.25 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{courseCode}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{courseName}</div>
      </div>
      <div style={{ boxSizing: 'border-box', width: '100%', maxWidth: 'min(100%, 70vh)', aspectRatio: '1 / 1', padding: 8, background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
        {hasToken ? (
          <QRCodeSVG value={qrValue} size={256} level="H" style={{ width: '100%', height: '100%', display: 'block' }} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 13, color: '#64748b' }}>กำลังสร้าง QR Code...</div>
        )}
      </div>
      {error && <div role="alert" style={{ fontSize: 12, color: '#b91c1c', textAlign: 'center' }}>{error}</div>}
    </div>
  );
}
