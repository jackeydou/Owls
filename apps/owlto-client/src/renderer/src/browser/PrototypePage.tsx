import type { ReactNode } from 'react'
import type { BrowserTab } from '../../../shared/browser-panel'
import './prototype-pages.css'

/*
 * Stand-in web pages for the browser panel prototype. They play the part of the
 * WebContentsView a real tab shows, so their text is page content, not app copy, and
 * stays untranslated like any website would.
 */

function TaskboardSettings({ cursor }: { cursor: ReactNode }) {
  return (
    <div className="mock-page mock-taskboard">
      <nav>
        <b>▦ Taskboard</b>
        <span>Boards</span>
        <span>Reports</span>
        <span data-on>Settings</span>
      </nav>
      <main>
        <h1>Workspace settings</h1>
        <p>Name, reminders, and who can see this workspace.</p>
        <section>
          <div className="mock-field">
            <span>Workspace name</span>
            <i>Product team</i>
          </div>
          <div className="mock-field">
            <span>Daily reminder</span>
            <i>09:30</i>
          </div>
          <div className="mock-check">
            <i data-on /> Email me when a task is overdue
          </div>
          <div className="mock-check">
            <i /> Make this workspace public
          </div>
        </section>
        <div className="mock-actions">
          <span className="mock-btn" data-primary data-target>
            Save changes
            {cursor}
          </span>
          <span className="mock-btn">Cancel</span>
        </div>
      </main>
    </div>
  )
}

function SignIn() {
  return (
    <div className="mock-page mock-signin">
      <div className="mock-card">
        <b className="mock-logo">◆ Example</b>
        <h1>Sign in</h1>
        <p>Use your work account to continue to Billing.</p>
        <div className="mock-field">
          <span>Email</span>
          <i>you@company.com</i>
        </div>
        <div className="mock-field">
          <span>Password</span>
          <i>••••••••••</i>
        </div>
        <span className="mock-btn" data-primary data-wide>
          Continue
        </span>
        <small>Protected by a verification step.</small>
      </div>
    </div>
  )
}

function Docs() {
  return (
    <div className="mock-page mock-docs">
      <aside>
        <b>Example Docs</b>
        <span>Getting started</span>
        <span>Authentication</span>
        <span data-on>Webhooks</span>
        <span>Rate limits</span>
      </aside>
      <main>
        <h1>Webhooks</h1>
        <p>
          Webhooks send an HTTP POST to your endpoint when an event happens. Verify the signature
          header before you trust the payload.
        </p>
        <pre>{`POST /hooks/billing
X-Example-Signature: t=1700000000,v1=5257a8…
{ "type": "invoice.paid", "id": "evt_19x" }`}</pre>
        <h2>Retries</h2>
        <p>Failed deliveries retry with backoff for up to three days.</p>
      </main>
    </div>
  )
}

/** The page a tab shows, with the worker's pointer on what it last clicked while it drives. */
export function PrototypePage({ tab, cursorLabel }: { tab: BrowserTab; cursorLabel: string }) {
  const host = /^[a-z]+:\/\/([^/]+)/i.exec(tab.url)?.[1] ?? ''
  const cursor =
    tab.control.kind === 'agent' && tab.owner.kind === 'worker' ? (
      <span className="browser-agent-cursor" role="img" aria-label={cursorLabel}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 1.75 L13 8.25 L8.25 9.25 L5.75 13.75 Z" />
        </svg>
      </span>
    ) : null
  if (host.startsWith('localhost')) return <TaskboardSettings cursor={cursor} />
  if (host.startsWith('accounts.')) return <SignIn />
  return <Docs />
}
