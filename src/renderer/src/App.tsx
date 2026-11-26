import { useEffect, useState, type FormEvent } from 'react'
import type { BatteryPresence, Printer, ReportResult, UpdateCheckResult, UploadResult } from '../../shared/types'

type Step = 'login' | 'ready' | 'serial' | 'print'

function App() {
  const [step, setStep] = useState<Step>('login')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [serialNumber, setSerialNumber] = useState('')
  const [batteryHealth, setBatteryHealth] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [printer, setPrinter] = useState<Printer>('default')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [presence, setPresence] = useState<BatteryPresence | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [update, setUpdate] = useState<Extract<UpdateCheckResult, { ok: true }> | null>(null)
  const [updateAction, setUpdateAction] = useState<'checking' | 'installing' | null>(null)

  useEffect(() => {
    if (step !== 'ready' || settingsOpen) return

    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    setPresence(null)

    async function refresh() {
      try {
        const result = await window.rbms.batteryPresence()
        if (active) setPresence(result)
      } catch (error) {
        if (active) {
          setPresence({
            ok: false,
            error: error instanceof Error ? error.message : 'Battery detection failed.',
          })
        }
      } finally {
        if (active) timer = setTimeout(refresh, 3000)
      }
    }

    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [step, settingsOpen])

  useEffect(() => {
    if (step !== 'ready' || busy || settingsOpen) return

    const handleEnter = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button, input, select, textarea, a, [contenteditable="true"]')
      ) return
      if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        void generateReport()
      }
    }

    window.addEventListener('keydown', handleEnter)
    return () => window.removeEventListener('keydown', handleEnter)
  }, [step, busy, settingsOpen])

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
    setUploadError(null)
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
    const result: UploadResult = await window.rbms.uploadReport(serialNumber)
    setBusy(false)
    if (result.ok || result.canPrint) {
      setUploadError(result.ok ? null : result.error)
      setStep('print')
    } else {
      setBatteryHealth(null)
      setSerialNumber('')
      setStep('ready')
    }
    setNotice(
      result.ok
        ? { ok: true, text: result.message ?? 'Battery report saved on RBMS.' }
        : { ok: false, text: `Report upload was not confirmed: ${result.error}` },
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
      setNotice(uploadError
        ? { ok: false, text: `Report upload was not confirmed: ${uploadError} ${result.message ?? 'Label sent to the printer.'}` }
        : { ok: true, text: result.message ?? 'Label sent to the printer.' })
    } else {
      setNotice({
        ok: false,
        text: uploadError ? `Report upload was not confirmed: ${uploadError} Printing failed: ${result.error}` : result.error,
      })
    }
  }

  function skipPrinting() {
    setBatteryHealth(null)
    setSerialNumber('')
    setNotice(uploadError
      ? { ok: false, text: `Report upload was not confirmed: ${uploadError} Label printing skipped.` }
      : { ok: true, text: 'Battery report saved on RBMS. Label printing skipped.' })
    setStep('ready')
  }

  async function handleTestPrint(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setSettingsNotice(null)
    try {
      const result = await window.rbms.printTestLabel(printer)
      setSettingsNotice(
        result.ok
          ? { ok: true, text: result.message ?? 'Printer accepted the test request. Check the printer for the test label.' }
          : { ok: false, text: result.error },
      )
    } catch (error) {
      setSettingsNotice({
        ok: false,
        text: error instanceof Error ? error.message : 'Test printing failed.',
      })
    } finally {
      setBusy(false)
    }
  }

  async function checkForUpdate() {
    if (busy) return
    setBusy(true)
    setUpdateAction('checking')
    setUpdate(null)
    setSettingsNotice(null)
    try {
      const result = await window.rbms.checkForUpdate()
      if (result.ok) setUpdate(result)
      else setSettingsNotice({ ok: false, text: result.error })
    } catch (error) {
      setSettingsNotice({ ok: false, text: error instanceof Error ? error.message : 'Update check failed.' })
    } finally {
      setBusy(false)
      setUpdateAction(null)
    }
  }

  async function installUpdate() {
    if (busy) return
    setBusy(true)
    setUpdateAction('installing')
    setSettingsNotice(null)
    try {
      const result = await window.rbms.installUpdate()
      if (!result.ok) setSettingsNotice({ ok: false, text: result.error })
    } catch (error) {
      setSettingsNotice({ ok: false, text: error instanceof Error ? error.message : 'Update failed.' })
    } finally {
      setBusy(false)
      setUpdateAction(null)
    }
  }

  const visibleNotice = settingsOpen ? settingsNotice : notice

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">RB</div>
        <div>
          <p className="eyebrow">Rugged Books Management System</p>
          <h1>Battery Reporter</h1>
        </div>
        <button
          type="button"
          className="settings-button"
          disabled={busy}
          onClick={() => {
            setSettingsOpen(!settingsOpen)
            setSettingsNotice(null)
          }}
        >
          {settingsOpen ? 'Back' : 'Settings'}
        </button>
      </header>

      {settingsOpen ? (
        <section className="card login-card">
          <div className="step-label">Settings</div>
          <h2>Printer test</h2>
          <p className="muted">
            Print a clearly marked sample battery label without logging in or uploading a report.
            The printer selected here is also used for the next battery label.
          </p>
          <form onSubmit={handleTestPrint} className="form-stack">
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
              {busy && !updateAction ? 'Sending test label…' : 'Print test label'}
            </button>
          </form>
          <div className="settings-section">
            <h2>App updates</h2>
            <p className="muted">Check GitHub for a newer Windows portable release.</p>
            <button type="button" className="secondary-button update-button" onClick={() => void checkForUpdate()} disabled={busy}>
              {updateAction === 'checking' ? 'Checking…' : 'Check for updates'}
            </button>
            {update && (
              <div className="update-status" role="status">
                <p>
                  Current version: {update.currentVersion}.{' '}
                  {update.available ? `Version ${update.latestVersion} is available.` : 'You are up to date.'}
                </p>
                {update.available && (update.canInstall ? (
                  <>
                    <p className="muted">Updating closes and restarts the app. Your current session will end.</p>
                    <button type="button" className="primary-button" onClick={() => void installUpdate()} disabled={busy}>
                      {updateAction === 'installing' ? 'Downloading update…' : 'Update now'}
                    </button>
                  </>
                ) : (
                  <p className="muted">Automatic installation is only available in the Windows portable executable.</p>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : step === 'login' ? (
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
              <div
                className={`battery-presence ${
                  presence === null ? 'checking' : !presence.ok ? 'unknown' : presence.count ? 'detected' : 'absent'
                }`}
                role="status"
              >
                <span className="presence-dot" aria-hidden="true" />
                <div>
                  <strong>
                    {presence === null
                      ? 'Checking for batteries…'
                      : !presence.ok
                        ? 'Battery detection unavailable'
                        : presence.count === 0
                          ? 'No battery detected'
                          : `${presence.count} ${presence.count === 1 ? 'battery' : 'batteries'} detected`}
                  </strong>
                  <p>
                    {presence === null
                      ? 'Waiting for the operating system.'
                      : !presence.ok
                        ? `${presence.error} You can still try generating a report.`
                        : presence.count === 0
                          ? 'Insert the battery and wait for detection.'
                          : 'This includes internal batteries and does not identify the battery being tested.'}
                  </p>
                </div>
              </div>
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
                {uploadError
                  ? 'The report upload could not be confirmed. You can still select a printer to print the battery label.'
                  : 'The report was uploaded. Select a printer to print the battery label.'}
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

      {visibleNotice && (
        <div
          className={`notice ${visibleNotice.ok ? 'success' : 'error'}`}
          role={visibleNotice.ok ? 'status' : 'alert'}
        >
          <span className="notice-icon" aria-hidden="true">
            {visibleNotice.ok ? '✓' : '!'}
          </span>
          <span>{visibleNotice.text}</span>
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
