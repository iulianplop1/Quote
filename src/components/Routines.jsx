import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Clock, Music, Film, Play, Pause, X, Loader2, Calendar } from 'lucide-react'
import { createLocalAudioUrl, isLocalAudioContent, getLocalAudioContent } from '../lib/mediaConfig'
import { speakQuote, stopSpeaking, isSpeaking, pauseSpeaking, resumeSpeaking, initializeSpeechSynthesis } from '../lib/textToSpeech'
import { playOriginalQuoteSegment } from '../lib/originalAudio'
import { getMovieMediaConfigPersisted } from '../lib/mediaConfig'

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Routines() {
  const [routines, setRoutines] = useState([])
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [playingRoutineId, setPlayingRoutineId] = useState(null)
  const [isPaused, setIsPaused] = useState(false)
  const routineAudioRef = useRef(null)
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

    if (!songFile && !songFileName) {
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

      // Store audio file in IndexedDB
      let audioUrl = ''
      if (songFile) {
        audioUrl = createLocalAudioUrl('blob-stored')
        const storageKey = `routine-song-${Date.now()}`
        
        try {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('QuoteAppDB', 2) // Increment version to trigger upgrade
            request.onerror = () => reject(request.error)
            request.onsuccess = () => resolve(request.result)
            request.onupgradeneeded = (event) => {
              const db = event.target.result
              // Create routine-songs store if it doesn't exist
              if (!db.objectStoreNames.contains('routine-songs')) {
                db.createObjectStore('routine-songs')
              }
              // Also ensure movie-audio-files exists (for compatibility)
              if (!db.objectStoreNames.contains('movie-audio-files')) {
                db.createObjectStore('movie-audio-files')
              }
            }
          })
          
          await new Promise((resolve, reject) => {
            const transaction = db.transaction(['routine-songs'], 'readwrite')
            const store = transaction.objectStore('routine-songs')
            const request = store.put(songFile, storageKey)
            request.onsuccess = () => {
              console.log(`[Routine] Successfully stored song in IndexedDB, key: ${storageKey}`)
              resolve()
            }
            request.onerror = () => {
              console.error('[Routine] IndexedDB put error:', request.error)
              reject(request.error)
            }
          })
          
          localStorage.setItem(storageKey + '-idb', 'true')
          localStorage.setItem(storageKey + '-type', songFile.type || 'audio/mpeg')
          localStorage.setItem(storageKey + '-url', audioUrl)
          console.log(`[Routine] Stored song metadata in localStorage for key: ${storageKey}`)
        } catch (error) {
          console.error('[Routine] Error storing audio file:', error)
          console.error('[Routine] Error details:', {
            name: error.name,
            message: error.message,
            stack: error.stack
          })
          throw new Error(`Failed to store audio file: ${error.message}`)
        }
      }

      // Insert routine
      const { data: routine, error: routineError } = await supabase
        .from('routines')
        .insert({
          user_id: user.id,
          name: routineName,
          song_audio_url: audioUrl,
          song_audio_filename: songFile?.name || songFileName,
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
      const { error } = await supabase
        .from('routines')
        .delete()
        .eq('id', routineId)

      if (error) throw error
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

    // Stop any currently playing routine
    stopRoutine()

    setPlayingRoutineId(routine.id)
    setIsPaused(false)

    // Set up Media Session API for better Android control
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
      // Step 1: Play song
      if (routine.song_audio_url) {
        const audioUrl = routine.song_audio_url
        let audioSrc = audioUrl

        if (isLocalAudioContent(audioUrl)) {
          const content = getLocalAudioContent(audioUrl)
          if (content && content !== 'stored') {
            // Find the stored blob
            const storageKeys = Object.keys(localStorage).filter(key => 
              key.endsWith('-url') && localStorage.getItem(key) === audioUrl
            )
            
            if (storageKeys.length > 0) {
              const storageKey = storageKeys[0].replace('-url', '')
              const db = await new Promise((resolve, reject) => {
                const request = indexedDB.open('QuoteAppDB', 2) // Use version 2
                request.onerror = () => reject(request.error)
                request.onsuccess = () => resolve(request.result)
                request.onupgradeneeded = (event) => {
                  const db = event.target.result
                  if (!db.objectStoreNames.contains('routine-songs')) {
                    db.createObjectStore('routine-songs')
                  }
                  if (!db.objectStoreNames.contains('movie-audio-files')) {
                    db.createObjectStore('movie-audio-files')
                  }
                }
              })
              
              const blob = await new Promise((resolve, reject) => {
                const transaction = db.transaction(['routine-songs'], 'readonly')
                const store = transaction.objectStore('routine-songs')
                const request = store.get(storageKey)
                request.onsuccess = () => resolve(request.result)
                request.onerror = () => reject(request.error)
              })
              
              if (blob) {
                audioSrc = URL.createObjectURL(blob)
              }
            }
          }
        }

        const audio = new Audio(audioSrc)
        routineAudioRef.current = audio

        await new Promise((resolve, reject) => {
          audio.onended = resolve
          audio.onerror = reject
          audio.play().catch(reject)
        })
      }

      // Step 2: Play quotes from selected movies
      const movieIds = routine.routine_movies?.map(rm => rm.movie_id) || []
      const allQuotes = []

      for (const movieId of movieIds) {
        const { data: quotes } = await supabase
          .from('quotes')
          .select('*')
          .eq('movie_id', movieId)
          .gte('significance', 7)
          .order('significance', { ascending: false })
          .limit(5)

        if (quotes) {
          allQuotes.push(...quotes)
        }
      }

      if (allQuotes.length > 0) {
        routineQuotesRef.current = allQuotes
        currentQuoteIndexRef.current = 0
        await playNextQuote(routine.id, allQuotes, 0)
      }
    } catch (error) {
      console.error('Error playing routine:', error)
      alert('Error playing routine: ' + error.message)
      setPlayingRoutineId(null)
      setIsPaused(false)
    }
  }

  const playNextQuote = async (routineId, quotes, index) => {
    if (index >= quotes.length || playingRoutineId !== routineId) {
      setPlayingRoutineId(null)
      setIsPaused(false)
      return
    }

    const quote = quotes[index]
    const quoteText = `"${quote.quote}"${quote.character ? ` by ${quote.character}` : ''}`

    try {
      // Try to get movie media config for original audio
      const { data: movie } = await supabase
        .from('movies')
        .select('id')
        .eq('id', quote.movie_id)
        .single()

      if (movie) {
        const cfg = await getMovieMediaConfigPersisted(movie.id)
        if (cfg.audioUrl && cfg.srtUrl) {
          const stopPlayback = await playOriginalQuoteSegment(quoteText, cfg.audioUrl, cfg.srtUrl, {
            subtitleOffset: cfg.subtitleOffset || 0,
            startTime: quote.start_time || null,
            endTime: quote.end_time || null,
            onEnd: () => {
              playNextQuote(routineId, quotes, index + 1)
            },
            onError: () => {
              // Fallback to TTS
              speakQuote(quoteText, () => {
                playNextQuote(routineId, quotes, index + 1)
              })
            }
          })
          stopPlaybackRef.current = stopPlayback
          return
        }
      }

      // Fallback to TTS
      speakQuote(quoteText, () => {
        playNextQuote(routineId, quotes, index + 1)
      })
    } catch (error) {
      console.error('Error playing quote:', error)
      // Continue to next quote
      playNextQuote(routineId, quotes, index + 1)
    }
  }

  const stopRoutine = () => {
    stopSpeaking()
    if (routineAudioRef.current) {
      routineAudioRef.current.pause()
      routineAudioRef.current = null
    }
    if (stopPlaybackRef.current) {
      stopPlaybackRef.current()
      stopPlaybackRef.current = null
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
    } else {
      setSelectedMovies([...selectedMovies, movieId])
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
                        <div className="flex items-center gap-2">
                          <Film size={16} />
                          <span>
                            {routine.routine_movies.length} movie{routine.routine_movies.length !== 1 ? 's' : ''}
                          </span>
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
                        return (
                          <button
                            key={movie.id}
                            onClick={() => toggleMovie(movie.id)}
                            className={`w-full flex items-center gap-3 p-2 rounded transition-colors ${
                              isSelected
                                ? 'bg-primary-100 dark:bg-primary-900/20 border-2 border-primary-500'
                                : 'bg-slate-50 dark:bg-slate-800 border-2 border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                            }`}
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

