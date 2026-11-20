import { useEffect, useState, type FormEvent } from 'react'
import type { OperationResult, Printer, ReportResult } from '../../shared/types'

type Step = 'login' | 'ready' | 'serial' | 'print'

function App() {
  const [step, setStep] = useState<Step>('login')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [batteryHealth, setBatteryHealth] = useState<number | null>(null)
  const [printer, setPrinter] = useState<Printer>('default')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (step !== 'ready' || busy) return

    const handleEnter = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        void generateReport()
      }
    }

    window.addEventListener('keydown', handleEnter)
    return () => window.removeEventListener('keydown', handleEnter)
  }, [step, busy])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const result = await window.rbms.login(email, password)
    setBusy(false)

    if (result.ok) {
      setPassword('')
      setStep('ready')
    } else {
      setNotice({ ok: false, text: result.error })
    }
  }

  async function generateReport() {
    if (busy) return
    setBusy(true)
    setNotice(null)
    setBatteryHealth(null)
    const result: ReportResult = await window.rbms.generateReport()
    setBusy(false)

    if (result.ok) {
      setBatteryHealth(result.health)
      setSerialNumber('')
      setStep('serial')
    } else {
      setNotice({ ok: false, text: result.error })
    }
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    setBusy(true)
    const result: OperationResult = await window.rbms.uploadReport(serialNumber)
    setBusy(false)
    if (result.ok) {
      setStep('print')
    } else {
      setBatteryHealth(null)
      setSerialNumber('')
      setStep('ready')
    }
    setNotice(
      result.ok
        ? { ok: true, text: result.message ?? 'Battery report saved on RBMS.' }
        : { ok: false, text: result.error },
    )
  }

  async function handlePrint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setNotice(null)
    const result = await window.rbms.printLabel(printer)
    setBusy(false)
    if (result.ok) {
      setBatteryHealth(null)
      setSerialNumber('')
      setStep('ready')
      setNotice({ ok: true, text: result.message ?? 'Label sent to the printer.' })
    } else {
      setNotice({ ok: false, text: result.error })
    }
  }

  function skipPrinting() {
    setBatteryHealth(null)
    setSerialNumber('')
    setNotice({ ok: true, text: 'Battery report saved on RBMS. Label printing skipped.' })
    setStep('ready')
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">RB</div>
        <div>
          <p className="eyebrow">Rugged Books Management System</p>
          <h1>Battery Reporter</h1>
        </div>
      </header>

      {step === 'login' ? (
        <section className="card login-card">
          <div className="step-label">Sign in</div>
          <h2>Log in to RBMS</h2>
          <p className="muted">
            Your session stays active only while this app is open.
          </p>
          <form onSubmit={handleLogin} className="form-stack">
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <button type="submit" className="primary-button" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </section>
      ) : (
        <section className="card workflow-card">
          <div className="step-track" aria-label="Upload steps">
            <div className={`step-dot ${step === 'ready' ? 'active' : 'complete'}`}>
              <span>1</span>
              <span>Generate report</span>
            </div>
            <div className="step-line" />
            <div className={`step-dot ${step === 'serial' ? 'active' : step === 'print' ? 'complete' : ''}`}>
              <span>2</span>
              <span>Scan serial number</span>
            </div>
            <div className="step-line" />
            <div className={`step-dot ${step === 'print' ? 'active' : ''}`}>
              <span>3</span>
              <span>Print label</span>
            </div>
          </div>

          {step === 'ready' ? (
            <div className="step-content">
              <div className="step-label">Step 1 of 3</div>
              <h2>Insert the battery</h2>
              <p className="prompt">
                Insert the battery and press enter to generate the report.
              </p>
              <p className="muted">
                The report will not be uploaded until you enter the battery
                serial number.
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={() => void generateReport()}
                disabled={busy}
              >
                {busy ? 'Generating report…' : 'Generate report'}
              </button>
            </div>
          ) : step === 'serial' ? (
            <div className="step-content">
              <div className="step-label">Step 2 of 3</div>
              <h2>Enter the battery serial number</h2>
              <p className="prompt">
                Remove the battery and scan or enter its serial number to upload
                the report to RBMS.
              </p>
              <div className="health-panel">
                <span>Current battery health</span>
                <strong>{batteryHealth}%</strong>
              </div>
              {batteryHealth !== null && batteryHealth > 100 && (
                <p className="warning">
                  Health exceeds 100%. RBMS may reject this report.
                </p>
              )}
              <form onSubmit={handleUpload} className="form-stack">
                <label>
                  Battery serial number
                  <input
                    type="text"
                    autoFocus
                    required
                    value={serialNumber}
                    onChange={(event) => setSerialNumber(event.target.value)}
                    disabled={busy}
                    placeholder="Scan or type the serial number"
                  />
                </label>
                <button
                  type="submit"
                  className="primary-button"
                  disabled={busy || !serialNumber.trim()}
                >
                  {busy ? 'Uploading…' : 'Upload to RBMS'}
                </button>
              </form>
            </div>
          ) : (
            <div className="step-content">
              <div className="step-label">Step 3 of 3</div>
              <h2>Print the battery label</h2>
              <p className="prompt">
                The report was uploaded. Select a printer to print the battery label.
              </p>
              <form onSubmit={handlePrint} className="form-stack">
                <label>
                  Printer
                  <select
                    value={printer}
                    onChange={(event) => {
                      const value = event.target.value
                      if (value === 'default' || value === 'backup') setPrinter(value)
                    }}
                    disabled={busy}
                  >
                    <option value="default">Default printer (192.168.50.140)</option>
                    <option value="backup">Backup printer (192.168.51.111)</option>
                  </select>
                </label>
                <button type="submit" className="primary-button" disabled={busy}>
                  {busy ? 'Sending to printer…' : 'Print label'}
                </button>
                <button type="button" className="secondary-button" onClick={skipPrinting} disabled={busy}>
                  Skip printing
                </button>
              </form>
            </div>
          )}
        </section>
      )}

      {notice && (
        <div
          className={`notice ${notice.ok ? 'success' : 'error'}`}
          role={notice.ok ? 'status' : 'alert'}
        >
          <span className="notice-icon" aria-hidden="true">
            {notice.ok ? '✓' : '!'}
          </span>
          <span>{notice.text}</span>
        </div>
      )}

      <footer>
        <span>RBMS session is stored in memory only.</span>
        <span>Battery reports are uploaded after serial entry.</span>
      </footer>
    </main>
  )
}

export default App
