import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { DemoProvider, useDemo, DEMO_USER } from './lib/demoContext'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import Library from './components/Library'
import Discover from './components/Discover'
import Settings from './components/Settings'
import Routines from './components/Routines'
import Layout from './components/Layout'

function AppInner() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const { isDemo } = useDemo()

  useEffect(() => {
    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-slate-600 dark:text-slate-400">Loading...</div>
      </div>
    )
  }

  const activeUser = isDemo ? DEMO_USER : user

  // Use basename for GitHub Pages deployment
  const basename = import.meta.env.MODE === 'production' ? '/Quote' : ''

  return (
    <Router 
      basename={basename}
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <Routes>
        <Route path="/login" element={!activeUser ? <Login /> : <Navigate to="/" />} />
        <Route
          path="/"
          element={
            activeUser ? (
              <Layout>
                <Dashboard />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/library"
          element={
            activeUser ? (
              <Layout>
                <Library />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/discover"
          element={
            activeUser ? (
              <Layout>
                <Discover />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/routines"
          element={
            activeUser ? (
              <Layout>
                <Routines />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/settings"
          element={
            activeUser ? (
              <Layout>
                <Settings />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </Router>
  )
}

function App() {
  return (
    <DemoProvider>
      <AppInner />
    </DemoProvider>
  )
}

export default App
