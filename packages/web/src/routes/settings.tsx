import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
        <p>Daemon configuration and system preferences</p>
      </div>

      <div className="form-section">
        <div className="form-section-title">General</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Daemon Address</label>
            <input
              type="text"
              className="form-input"
              defaultValue="0.0.0.0:7778"
              readOnly
            />
          </div>
          <div className="form-group">
            <label className="form-label">Data Directory</label>
            <input
              type="text"
              className="form-input font-mono"
              defaultValue="/var/lib/rioku"
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">Store</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Driver</label>
            <select className="form-select" defaultValue="sqlite">
              <option value="sqlite">SQLite</option>
              <option value="postgres">PostgreSQL</option>
              <option value="mysql">MySQL / MariaDB</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Connection String</label>
            <input
              type="text"
              className="form-input font-mono"
              defaultValue="/var/lib/rioku/store.db"
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">PKI</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">CA Algorithm</label>
            <select className="form-select" defaultValue="ecdsa-p256">
              <option value="ecdsa-p256">ECDSA P-256</option>
              <option value="ecdsa-p384">ECDSA P-384</option>
              <option value="ed25519">Ed25519</option>
              <option value="rsa-4096">RSA 4096</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Rotation Threshold</label>
            <input
              type="text"
              className="form-input"
              defaultValue="30 days"
              readOnly
            />
          </div>
        </div>
      </div>

      <div className="form-section">
        <div className="form-section-title">AI</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Trace Store</label>
            <select className="form-select" defaultValue="sqlite">
              <option value="sqlite">SQLite</option>
              <option value="postgres">PostgreSQL</option>
              <option value="none">Disabled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Retention Period</label>
            <input
              type="text"
              className="form-input"
              defaultValue="90 days"
              readOnly
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="btn btn-secondary">Reset</button>
        <button className="btn btn-primary">Save Changes</button>
      </div>
    </>
  )
}
