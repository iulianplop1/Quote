import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Clock, Save, Check } from 'lucide-react'

export default function Settings() {
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase
        .from('user_settings')
        .select('schedule_time')
        .eq('user_id', user.id)
        .single()

      if (data?.schedule_time) {
        setScheduleTime(data.schedule_time)
      }
    } catch (error) {
      // Settings might not exist yet, that's okay
      console.log('No settings found, using default')
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    setSaved(false)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      // Upsert settings
      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          schedule_time: scheduleTime,
        })

      if (error) throw error

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Error saving settings: ' + error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Settings
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Manage your preferences
        </p>
      </div>

      <div className="card max-w-2xl">
        <div className="space-y-6">
          <div>
            <label className="flex items-center space-x-2 text-lg font-medium text-slate-900 dark:text-slate-100 mb-4">
              <Clock size={20} />
              <span>Daily Quote Schedule</span>
            </label>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Set the time when you'd like to receive your daily quote. The quote will be
              prepared in advance by our scheduled system.
            </p>
            <div className="flex items-center space-x-4">
              <input
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="input-field w-auto"
              />
              <button
                onClick={saveSettings}
                disabled={saving}
                className="btn-primary flex items-center space-x-2"
              >
                {saving ? (
                  <>
                    <Clock className="animate-spin" size={18} />
                    <span>Saving...</span>
                  </>
                ) : saved ? (
                  <>
                    <Check size={18} />
                    <span>Saved!</span>
                  </>
                ) : (
                  <>
                    <Save size={18} />
                    <span>Save</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-2">
              About Scheduled Quotes
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Your quotes are generated automatically by our Supabase Edge Function that runs
              on a schedule. This ensures you always have a fresh quote ready, even if you
              haven't visited the site yet. The system automatically avoids showing you
              quotes you've already seen.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

