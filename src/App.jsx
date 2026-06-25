import { useEffect, useMemo, useState } from 'react'
import './App.css'

const storageKey = 'lifecoach-mvp-state'
const callTime = '8:30 PM CT'

const starterState = {
  phase: 'setup',
  phoneNumber: '',
  initialGoals: '',
  finalizedGoals: null,
  updatedAt: null,
}

function loadState() {
  try {
    const saved = localStorage.getItem(storageKey)
    return saved ? { ...starterState, ...JSON.parse(saved) } : starterState
  } catch {
    return starterState
  }
}

function formatDate(value) {
  if (!value) return 'Not started'
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function App() {
  const [state, setState] = useState(loadState)
  const [draft, setDraft] = useState({
    phoneNumber: state.phoneNumber,
    initialGoals: state.initialGoals,
  })

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(state))
  }, [state])

  const status = useMemo(() => {
    if (state.phase === 'execution') {
      return {
        label: 'Phase 2',
        title: 'Execution calls are active.',
        body: 'Your finalized goals are locked on the website. Each call reviews today, detects patterns, and adjusts your plan through coaching.',
      }
    }

    if (state.phase === 'discovery') {
      return {
        label: 'Phase 1',
        title: 'Goal discovery calls are active.',
        body: 'LifeCoach will use each call to clarify what matters, challenge vague goals, and shape the final plan with you.',
      }
    }

    return {
      label: 'Setup',
      title: 'Start with one goal dump.',
      body: 'After this, the product moves to the phone call. No dashboards, no daily typing.',
    }
  }, [state.phase])

  function startDiscovery(event) {
    event.preventDefault()

    setState({
      ...starterState,
      phase: 'discovery',
      phoneNumber: draft.phoneNumber.trim(),
      initialGoals: draft.initialGoals.trim(),
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <main className="shell">
      <section className="hero">
        <p>{status.label}</p>
        <h1>LifeCoach</h1>
        <span>{status.title}</span>
      </section>

      <section className="status-panel" aria-label="LifeCoach status">
        <div>
          <span>Daily outbound call</span>
          <strong>{callTime}</strong>
        </div>
        <div>
          <span>Last updated</span>
          <strong>{formatDate(state.updatedAt)}</strong>
        </div>
      </section>

      {state.phase === 'setup' ? (
        <form className="card" onSubmit={startDiscovery}>
          <label>
            Phone number
            <input
              required
              value={draft.phoneNumber}
              onChange={(event) => setDraft({ ...draft, phoneNumber: event.target.value })}
              placeholder="+1 555 123 4567"
            />
          </label>

          <label>
            Initial goals
            <textarea
              required
              value={draft.initialGoals}
              onChange={(event) => setDraft({ ...draft, initialGoals: event.target.value })}
              placeholder="Paste everything you know so far: long-term goals, short-term goals, worries, ideas, what you want to change..."
            />
          </label>

          <button type="submit">Start phase 1</button>
        </form>
      ) : (
        <section className="card quiet">
          <p>{status.body}</p>
          <div className="call-note">
            <span>Phone</span>
            <strong>{state.phoneNumber}</strong>
          </div>
          {state.phase === 'discovery' && (
            <p>
              Finalization happens on a call only. Once you and the coach agree, the website will
              show the finalized goals here.
            </p>
          )}
          {state.phase === 'execution' && state.finalizedGoals && (
            <FinalGoals goals={state.finalizedGoals} />
          )}
        </section>
      )}
    </main>
  )
}

function FinalGoals({ goals }) {
  return (
    <div className="final-goals">
      <GoalGroup title="Long-term goals" items={goals.longTerm} />
      <GoalGroup title="Short-term goals" items={goals.shortTerm} />
      <GoalGroup title="Why they matter" items={goals.why} />
      <GoalGroup title="Milestones" items={goals.milestones} />
    </div>
  )
}

function GoalGroup({ title, items = [] }) {
  if (!items.length) return null

  return (
    <section>
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

export default App
