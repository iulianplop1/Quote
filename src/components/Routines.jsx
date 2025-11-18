import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Clock, Music, Film, Play, Pause, X, Loader2, Calendar } from 'lucide-react'
import { speakQuote, stopSpeaking, isSpeaking, pauseSpeaking, resumeSpeaking, initializeSpeechSynthesis } from '../lib/textToSpeech'
import { playOriginalQuoteSegment } from '../lib/originalAudio'
import { getMovieMediaConfigPersisted } from '../lib/mediaConfig'
import { buildStoragePath, deleteFileFromBucket, uploadFileToBucket } from '../lib/storage'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Routines() {
  const [routines, setRoutines] = useState([])
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [playingRoutineId, setPlayingRoutineId] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const routineAudioRef = useRef(null)
  const songResolveRef = useRef(null)
  const routineQuotesRef = useRef([])
  const currentQuoteIndexRef = useRef(0)
  const stopPlaybackRef = useRef(null)

  // Form state
  const [routineName, setRoutineName] = useState('')
  const [songFile, setSongFile] = useState(null)
  const [songFileName, setSongFileName] = useState('')
  const [scheduledTime, setScheduledTime] = useState('08:00')
  const [selectedDays, setSelectedDays] = useState([1, 2, 3, 4, 5, 6, 7])
  const [selectedMovies, setSelectedMovies] = useState([])
  const [selectedMovieCounts, setSelectedMovieCounts] = useState({})
  const [processing, setProcessing] = useState(false)

  const scheduledIntervalRef = useRef(null)
  const routinesRef = useRef([])

  useEffect(() => {
    routinesRef.current = routines
  }, [routines])

  useEffect(() => {
    loadRoutines()
    loadMovies()
    initializeSpeechSynthesis()
    registerServiceWorker()

    return () => {
      stopSpeaking()
      if (routineAudioRef.current) {
        routineAudioRef.current.pause()
        routineAudioRef.current = null
      }
      if (stopPlaybackRef.current) {
        stopPlaybackRef.current()
      }
      if (scheduledIntervalRef.current) {
        clearInterval(scheduledIntervalRef.current)
      }
    }
  }, [])

  // Set up scheduled playback when routines change
  useEffect(() => {
    // Clear existing interval
    if (scheduledIntervalRef.current) {
      clearInterval(scheduledIntervalRef.current)
    }

    // Set up new interval - check every 10 seconds for more responsive triggering
    // (Still prevents duplicate playback within 60 seconds)
    scheduledIntervalRef.current = setInterval(() => {
      checkAndPlayRoutines()
    }, 10000) // Check every 10 seconds for better responsiveness

    // Check immediately
    checkAndPlayRoutines()
    
    console.log('[Routine Setup] Scheduled playback checker started (checks every 10 seconds)')

    return () => {
      if (scheduledIntervalRef.current) {
        clearInterval(scheduledIntervalRef.current)
      }
    }
  }, [routines])

  const registerServiceWorker = async () => {
    if ('serviceWorker' in navigator) {
      try {
        // Use correct path based on base URL (for GitHub Pages)
        const base = import.meta.env.MODE === 'production' ? '/Quote' : ''
        const swPath = `${base}/sw.js`
        
        try {
          const registration = await navigator.serviceWorker.register(swPath, {
            scope: base || '/'
          })
          console.log('Service Worker registered successfully:', registration)

          // Request notification permission
          if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission()
          }

          // Request periodic background sync (for Android)
          if ('periodicSync' in registration) {
            try {
              await registration.periodicSync.register('routine-check', {
                minInterval: 60000, // Check every minute
              })
              console.log('Periodic background sync registered')
            } catch (error) {
              console.warn('Periodic background sync not available:', error)
            }
          }

          // Listen for service worker messages
          navigator.serviceWorker.addEventListener('message', (event) => {
            if (event.data && (event.data.type === 'CHECK_ROUTINES' || event.data.type === 'TRIGGER_ROUTINE')) {
              checkAndPlayRoutines()
            }
          })
        } catch (swError) {
          // Service worker registration is optional - don't break the app
          console.warn('Service Worker registration failed (this is OK, routines will still work):', swError.message)
          // Still request notification permission even if SW fails
          if ('Notification' in window && Notification.permission === 'default') {
            await Notification.requestPermission()
          }
        }
      } catch (error) {
        console.warn('Service Worker setup error (non-critical):', error)
      }
    }
  }

  const loadRoutines = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('routines')
        .select(`
          *,
          routine_movies (
            movie_id,
            quote_limit,
            movies (
              id,
              title,
              poster_url
            )
          )
        `)
        .eq('user_id', user.id)
        .order('scheduled_time', { ascending: true })

      if (error) throw error
      setRoutines(data || [])
    } catch (error) {
      console.error('Error loading routines:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMovies = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('movies')
        .select('id, title, poster_url')
        .eq('user_id', user.id)
        .order('title', { ascending: true })

      if (error) throw error
      setMovies(data || [])
    } catch (error) {
      console.error('Error loading movies:', error)
    }
  }

  const handleSaveRoutine = async () => {
    if (!routineName.trim()) {
      alert('Please enter a routine name')
      return
    }

    if (!songFile) {
      alert('Please upload a song')
      return
    }

    if (selectedMovies.length === 0) {
      alert('Please select at least one movie')
      return
    }

    setProcessing(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()

      let uploadedSong = null
      if (songFile) {
        const filePath = buildStoragePath([
          'users',
          user.id,
          'routines',
          `${Date.now()}-${songFile.name}`,
        ])
        uploadedSong = await uploadFileToBucket({ path: filePath, file: songFile })
      }

      // Insert routine
      const { data: routine, error: routineError } = await supabase
        .from('routines')
        .insert({
          user_id: user.id,
          name: routineName,
          song_audio_url: uploadedSong?.publicUrl || '',
          song_audio_filename: songFile?.name || songFileName,
          song_storage_path: uploadedSong?.path || null,
          scheduled_time: scheduledTime,
          enabled: true,
          days_of_week: selectedDays,
        })
        .select()
        .single()

      if (routineError) throw routineError

      // Insert routine movies
      const routineMovies = selectedMovies.map(movieId => ({
        routine_id: routine.id,
        movie_id: movieId,
        quote_limit: Math.max(1, selectedMovieCounts[movieId] || 3),
      }))

      const { error: moviesError } = await supabase
        .from('routine_movies')
        .insert(routineMovies)

      if (moviesError) throw moviesError

      // Reset form
      setRoutineName('')
      setSongFile(null)
      setSongFileName('')
      setScheduledTime('08:00')
      setSelectedDays([1, 2, 3, 4, 5, 6, 7])
      setSelectedMovies([])
      setSelectedMovieCounts({})
      setSelectedMovieCounts({})
      setShowAddModal(false)
      loadRoutines()
    } catch (error) {
      console.error('Error saving routine:', error)
      alert('Error saving routine: ' + error.message)
    } finally {
      setProcessing(false)
    }
  }

  const handleDeleteRoutine = async (routineId) => {
    if (!confirm('Are you sure you want to delete this routine?')) {
      return
    }

    try {
      const routineToDelete = routines.find((r) => r.id === routineId)
      const { error } = await supabase
        .from('routines')
        .delete()
        .eq('id', routineId)

      if (error) throw error
      if (routineToDelete?.song_storage_path) {
        try {
          await deleteFileFromBucket(routineToDelete.song_storage_path)
        } catch (storageError) {
          console.warn('Failed to delete routine song from storage:', storageError.message)
        }
      }
      loadRoutines()
    } catch (error) {
      console.error('Error deleting routine:', error)
      alert('Error deleting routine: ' + error.message)
    }
  }

  const handleToggleRoutine = async (routineId, currentEnabled) => {
    try {
      const { error } = await supabase
        .from('routines')
        .update({ enabled: !currentEnabled })
        .eq('id', routineId)

      if (error) throw error
      loadRoutines()
    } catch (error) {
      console.error('Error toggling routine:', error)
      alert('Error toggling routine: ' + error.message)
    }
  }

  const playRoutine = async (routine) => {
    if (playingRoutineId === routine.id) {
      if (isPaused) {
        if (routineAudioRef.current) {
          routineAudioRef.current.play().catch(err => console.error('Error resuming audio:', err))
        }
        resumeSpeaking()
        setIsPaused(false)
      } else {
        if (routineAudioRef.current) {
          routineAudioRef.current.pause()
        }
        pauseSpeaking()
        setIsPaused(true)
      }
      return
    }

    stopRoutine()

    setPlayingRoutineId(routine.id)
    setIsPaused(false)

    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: routine.name,
        artist: 'Quote App',
        artwork: [{ src: '/vite.svg', sizes: '512x512', type: 'image/svg+xml' }]
      })

      navigator.mediaSession.setActionHandler('play', () => {
        if (routineAudioRef.current) {
          routineAudioRef.current.play()
        }
        resumeSpeaking()
        setIsPaused(false)
      })

      navigator.mediaSession.setActionHandler('pause', () => {
        if (routineAudioRef.current) {
          routineAudioRef.current.pause()
        }
        pauseSpeaking()
        setIsPaused(true)
      })

      navigator.mediaSession.setActionHandler('stop', () => {
        stopRoutine()
      })
    }

    try {
      const movieConfigs = routine.routine_movies || []
      console.log('[Routine] Starting playback', {
        routineId: routine.id,
        quoteSources: movieConfigs.map((rm) => ({
          movieId: rm.movie_id,
          quoteLimit: rm.quote_limit || 3,
          movieTitle: rm.movies?.title,
        })),
      })
      const allQuotes = []

      for (const rm of movieConfigs) {
        const quoteLimit = Math.max(1, rm.quote_limit || 3)
        console.log('[Routine] Fetching quotes for movie', {
          movieId: rm.movie_id,
          requested: quoteLimit,
        })
        const { data: quotes } = await supabase
          .from('quotes')
          .select('*')
          .eq('movie_id', rm.movie_id)
          .gte('significance', 7)
          .order('significance', { ascending: false })
          .limit(quoteLimit)

        if (quotes) {
          console.log('[Routine] Retrieved quotes', {
            movieId: rm.movie_id,
            count: quotes.length,
          })
          allQuotes.push(...quotes)
        }
      }

      routineQuotesRef.current = allQuotes
      currentQuoteIndexRef.current = 0

      if (allQuotes.length > 0) {
        await playQuotesSequentially(routine, allQuotes)
      } else {
        console.warn('[Routine] No quotes available for routine', routine.id)
      }

      if (playingRoutineId !== routine.id) {
        return
      }

      await playRoutineSong(routine)

      if (playingRoutineId === routine.id) {
        setPlayingRoutineId(null)
        setIsPaused(false)
      }
    } catch (error) {
      console.error('Error playing routine:', error)
      alert('Error playing routine: ' + error.message)
      setPlayingRoutineId(null)
      setIsPaused(false)
    }
  }

  const playRoutineSong = async (routine) => {
    if (!routine.song_audio_url || playingRoutineId !== routine.id) {
      console.warn('[Routine] No song audio URL available, skipping song playback', {
        routineId: routine.id,
      })
      return
    }

    await new Promise((resolve, reject) => {
      const audio = new Audio(routine.song_audio_url)
      routineAudioRef.current = audio

      const finalize = () => {
        routineAudioRef.current = null
        songResolveRef.current = null
        resolve()
      }

      songResolveRef.current = finalize

      audio.onended = finalize
      audio.onerror = (event) => {
        console.error('[Routine] Song playback error', event)
        routineAudioRef.current = null
        songResolveRef.current = null
        reject(new Error('Error playing routine song. Please re-upload the file.'))
      }

      audio.play().catch((err) => {
        console.error('[Routine] Song playback failed to start', err)
        routineAudioRef.current = null
        songResolveRef.current = null
        reject(err)
      })
    })
  }

  const playQuotesSequentially = async (routine, quotes) => {
    for (let index = 0; index < quotes.length; index++) {
      if (playingRoutineId !== routine.id) {
        console.log('[Routine] Playback halted before quote sequence finished')
        return
      }
      currentQuoteIndexRef.current = index + 1
      console.log('[Routine] Playing quote', {
        routineId: routine.id,
        index: index + 1,
        total: quotes.length,
        quoteId: quotes[index].id,
      })
      await playQuoteForRoutine(routine.id, quotes[index])
    }
  }

  const playQuoteForRoutine = (routineId, quote) => {
    return new Promise(async (resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        stopPlaybackRef.current = null
        resolve()
      }

      if (playingRoutineId !== routineId) {
        finish()
        return
      }

      const quoteText = `"${quote.quote}"${quote.character ? ` by ${quote.character}` : ''}`

      const fallbackToTTS = () => {
        if (playingRoutineId !== routineId) {
          finish()
          return
        }
        stopPlaybackRef.current = () => {
          finish()
        }
        speakQuote(quoteText, () => finish())
      }

      try {
        const cfg = await getMovieMediaConfigPersisted(quote.movie_id)
        if (cfg.audioUrl && cfg.srtUrl) {
          console.log('[Routine] Attempting original audio playback', {
            routineId,
            quoteId: quote.id,
            movieId: quote.movie_id,
          })
          const stopPlayback = await playOriginalQuoteSegment(quoteText, cfg.audioUrl, cfg.srtUrl, {
            subtitleOffset: cfg.subtitleOffset || 0,
            startTime: quote.start_time || null,
            endTime: quote.end_time || null,
            onEnd: finish,
            onError: () => {
              console.warn('[Routine] Original audio failed, falling back to TTS', {
                routineId,
                quoteId: quote.id,
              })
              fallbackToTTS()
            }
          })
          stopPlaybackRef.current = () => {
            try {
              stopPlayback()
            } catch (e) {
              console.warn('Error stopping routine audio:', e)
            } finally {
              finish()
            }
          }
          return
        }
      } catch (error) {
        console.warn('Error preparing original audio for routine:', error)
      }

      console.log('[Routine] Using TTS for quote', { routineId, quoteId: quote.id })
      fallbackToTTS()
    })
  }

  const stopRoutine = () => {
    stopSpeaking()
    if (routineAudioRef.current) {
      routineAudioRef.current.pause()
    }
    if (stopPlaybackRef.current) {
      stopPlaybackRef.current()
      stopPlaybackRef.current = null
    }
    if (songResolveRef.current) {
      songResolveRef.current()
    } else {
      routineAudioRef.current = null
    }
    setPlayingRoutineId(null)
    setIsPaused(false)
    routineQuotesRef.current = []
    currentQuoteIndexRef.current = 0
  }

  const checkAndPlayRoutines = async () => {
    // Use ref to get current routines (avoids stale closure)
    const currentRoutines = routinesRef.current
    const now = new Date()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    const currentDay = now.getDay() === 0 ? 7 : now.getDay() // Convert Sunday from 0 to 7
    
    // Log time check for debugging
    console.log('[Routine Check]', {
      currentTime: currentTime,
      currentDay: currentDay,
      dayName: DAYS[currentDay - 1],
      routinesCount: currentRoutines.length,
      enabledRoutines: currentRoutines.filter(r => r.enabled).length,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      localTimeString: now.toLocaleTimeString()
    })

    for (const routine of currentRoutines) {
      if (!routine.enabled) {
        console.log(`[Routine Check] Skipping "${routine.name}" - disabled`)
        continue
      }
      
      const routineTime = routine.scheduled_time.substring(0, 5)
      if (routineTime !== currentTime) {
        // Only log once per routine to avoid spam
        if (Math.random() < 0.01) { // Log 1% of the time
          console.log(`[Routine Check] "${routine.name}" - time mismatch: scheduled=${routineTime}, current=${currentTime}`)
        }
        continue
      }
      
      if (!routine.days_of_week.includes(currentDay)) {
        console.log(`[Routine Check] Skipping "${routine.name}" - not scheduled for ${DAYS[currentDay - 1]}`)
        continue
      }
      
      console.log(`[Routine Check] ✓ "${routine.name}" matches! Scheduled: ${routineTime}, Current: ${currentTime}, Day: ${DAYS[currentDay - 1]}`)

      // Check if we already played this routine in the last minute
      const lastPlayedKey = `routine-last-played-${routine.id}`
      const lastPlayed = localStorage.getItem(lastPlayedKey)
      const nowMs = Date.now()
      
      if (lastPlayed && (nowMs - parseInt(lastPlayed)) < 60000) {
        continue // Already played in the last minute
      }

      localStorage.setItem(lastPlayedKey, nowMs.toString())
      
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission()
      }

      // Show notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`Routine: ${routine.name}`, {
          body: 'Starting your routine...',
          icon: '/vite.svg',
          tag: `routine-${routine.id}`,
          requireInteraction: false,
        })
      }

      // Start playing the routine
      playRoutine(routine)
    }
  }


  const toggleDay = (day) => {
    if (selectedDays.includes(day)) {
      setSelectedDays(selectedDays.filter(d => d !== day))
    } else {
      setSelectedDays([...selectedDays, day].sort())
    }
  }

  const toggleMovie = (movieId) => {
    if (selectedMovies.includes(movieId)) {
      setSelectedMovies(selectedMovies.filter(id => id !== movieId))
      setSelectedMovieCounts((prev) => {
        const next = { ...prev }
        delete next[movieId]
        return next
      })
    } else {
      setSelectedMovies([...selectedMovies, movieId])
      setSelectedMovieCounts((prev) => ({
        ...prev,
        [movieId]: prev[movieId] || 3,
      }))
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Routines
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Create scheduled routines that play a song and quotes at specific times
            <br />
            <span className="text-xs">
              Current time: <strong>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</strong> ({Intl.DateTimeFormat().resolvedOptions().timeZone})
              {' • '}
              <button
                onClick={() => {
                  console.log('[Manual Check] Triggering routine check manually...')
                  checkAndPlayRoutines()
                }}
                className="text-primary-600 dark:text-primary-400 hover:underline"
              >
                Test Check Now
              </button>
            </span>
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>Create Routine</span>
        </button>
      </div>

      {routines.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            No routines yet. Create your first routine to get started!
          </p>
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            Create Your First Routine
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {routines.map((routine) => {
            const isPlaying = playingRoutineId === routine.id
            const daysText = routine.days_of_week
              .sort()
              .map(d => DAYS[d - 1].substring(0, 3))
              .join(', ')
            
            // Check if this routine should play now
            const now = new Date()
            const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
            const currentDay = now.getDay() === 0 ? 7 : now.getDay()
            const isScheduledNow = routine.enabled && 
                                   routine.scheduled_time.substring(0, 5) === currentTime &&
                                   routine.days_of_week.includes(currentDay)

            return (
              <div key={routine.id} className="card">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                        {routine.name}
                      </h3>
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          routine.enabled
                            ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                            : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {routine.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {isScheduledNow && (
                        <span className="px-2 py-1 rounded text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 animate-pulse">
                          Playing Now
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 text-sm text-slate-600 dark:text-slate-400">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Clock size={16} />
                        <span>Scheduled: {routine.scheduled_time.substring(0, 5)}</span>
                        <span className="text-xs text-slate-500 dark:text-slate-500">
                          (Your time: {currentTime})
                        </span>
                        <span>•</span>
                        <Calendar size={16} />
                        <span>{daysText}</span>
                      </div>
                      {routine.song_audio_filename && (
                        <div className="flex items-center gap-2">
                          <Music size={16} />
                          <span>{routine.song_audio_filename}</span>
                        </div>
                      )}
                      {routine.routine_movies && routine.routine_movies.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Film size={16} />
                            <span>
                              {routine.routine_movies.length} movie{routine.routine_movies.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <ul className="text-xs text-slate-500 dark:text-slate-400 pl-5 list-disc">
                            {routine.routine_movies.map((rm) => (
                              <li key={`${routine.id}-${rm.movie_id}`}>
                                {(rm.movies && rm.movies.title) || 'Movie'} — {rm.quote_limit || 3} quote
                                {Math.max(1, rm.quote_limit || 3) !== 1 ? 's' : ''}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggleRoutine(routine.id, routine.enabled)}
                      className={`px-3 py-1 rounded text-sm ${
                        routine.enabled
                          ? 'bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600'
                          : 'bg-green-200 dark:bg-green-800 hover:bg-green-300 dark:hover:bg-green-700'
                      }`}
                    >
                      {routine.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      onClick={() => isPlaying ? stopRoutine() : playRoutine(routine)}
                      className="btn-primary flex items-center space-x-2"
                    >
                      {isPlaying && !isPaused ? (
                        <>
                          <Pause size={18} />
                          <span>Pause</span>
                        </>
                      ) : (
                        <>
                          <Play size={18} />
                          <span>Play</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => handleDeleteRoutine(routine.id)}
                      className="p-2 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      <Trash2 size={18} className="text-red-600 dark:text-red-400" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="card max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold">Create New Routine</h2>
              <button
                onClick={() => {
                  setShowAddModal(false)
                  setRoutineName('')
                  setSongFile(null)
                  setSongFileName('')
                  setScheduledTime('08:00')
                  setSelectedDays([1, 2, 3, 4, 5, 6, 7])
                  setSelectedMovies([])
                  setSelectedMovieCounts({})
                }}
                className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg"
              >
                <X size={24} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Routine Name
                </label>
                <input
                  type="text"
                  value={routineName}
                  onChange={(e) => setRoutineName(e.target.value)}
                  className="input-field"
                  placeholder="Morning Motivation"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Song (Audio File)
                </label>
                <input
                  type="file"
                  accept=".mp3,.wav,.ogg,.m4a,.aac"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setSongFile(file)
                      setSongFileName(file.name)
                    }
                  }}
                  className="input-field"
                />
                {songFileName && (
                  <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                    Selected: {songFileName}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Scheduled Time
                </label>
                <input
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="input-field"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Uses your device's local time. Current time: {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  <br />
                  Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Days of Week
                </label>
                <div className="flex flex-wrap gap-2">
                  {DAYS.map((day, index) => {
                    const dayNum = index + 1
                    const isSelected = selectedDays.includes(dayNum)
                    return (
                      <button
                        key={dayNum}
                        onClick={() => toggleDay(dayNum)}
                        className={`px-3 py-1 rounded text-sm transition-colors ${
                          isSelected
                            ? 'bg-primary-500 text-white'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {day.substring(0, 3)}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Select Movies (for quotes)
                </label>
                <div className="max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2">
                  {movies.length === 0 ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">
                      No movies available. Add movies in the Library first.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {movies.map((movie) => {
                        const isSelected = selectedMovies.includes(movie.id)
                        const currentCount = selectedMovieCounts[movie.id] || 3
                        return (
                          <div
                            key={movie.id}
                            className={`rounded-lg border transition-colors ${
                              isSelected
                                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/10'
                                : 'border-transparent bg-slate-50 dark:bg-slate-800'
                            }`}
                          >
                            <button
                              onClick={() => toggleMovie(movie.id)}
                              className="w-full flex items-center gap-3 p-2"
                            >
                              {movie.poster_url && (
                                <img
                                  src={movie.poster_url}
                                  alt={movie.title}
                                  className="w-12 h-12 object-cover rounded"
                                />
                              )}
                              <span className="flex-1 text-left text-sm font-medium">
                                {movie.title}
                              </span>
                              {isSelected && (
                                <span className="text-primary-600 dark:text-primary-400">✓</span>
                              )}
                            </button>
                            {isSelected && (
                              <div className="px-3 pb-3 flex items-center gap-2 text-xs sm:text-sm">
                                <label className="font-medium text-slate-600 dark:text-slate-300">
                                  Quotes:
                                </label>
                                <input
                                  type="number"
                                  min="1"
                                  max="20"
                                  value={currentCount}
                                  onChange={(e) => {
                                    const value = Math.max(1, Math.min(20, Number(e.target.value) || 1))
                                    setSelectedMovieCounts((prev) => ({
                                      ...prev,
                                      [movie.id]: value,
                                    }))
                                  }}
                                  className="w-20 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                                />
                                <span className="text-slate-500 dark:text-slate-400">
                                  per routine
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setRoutineName('')
                    setSongFile(null)
                    setSongFileName('')
                    setScheduledTime('08:00')
                    setSelectedDays([1, 2, 3, 4, 5, 6, 7])
                    setSelectedMovies([])
                    setSelectedMovieCounts({})
                  }}
                  className="btn-secondary flex-1"
                  disabled={processing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveRoutine}
                  disabled={processing}
                  className="btn-primary flex-1 flex items-center justify-center space-x-2"
                >
                  {processing && <Loader2 className="animate-spin" size={18} />}
                  <span>{processing ? 'Saving...' : 'Create Routine'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

