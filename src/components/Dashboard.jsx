import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { Clock, Film, User, Eye, EyeOff, Sparkles, Volume2, VolumeX, Pause, Play, Settings } from 'lucide-react'
import { getQuoteContext } from '../lib/gemini'
import CharacterAnalysis from './CharacterAnalysis'
import { 
  speakQuote, 
  pauseSpeaking, 
  resumeSpeaking, 
  stopSpeaking, 
  isSpeaking, 
  isPaused, 
  initializeSpeechSynthesis,
  setTTSSettings,
  getTTSSettings,
  getAvailableVoices,
  getElevenLabsVoices,
  getCinematicVoices,
  isElevenLabsAvailable,
} from '../lib/textToSpeech'
import { playOriginalQuoteSegment } from '../lib/originalAudio'
import { getMovieMediaConfigPersisted } from '../lib/mediaConfig'

export default function Dashboard() {
  const [todayQuote, setTodayQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showContext, setShowContext] = useState(false)
  const [context, setContext] = useState('')
  const [loadingContext, setLoadingContext] = useState(false)
  const [hideInfo, setHideInfo] = useState(false)
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [showCharacterAnalysis, setShowCharacterAnalysis] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isPausedState, setIsPausedState] = useState(false)
  const [showTTSSettings, setShowTTSSettings] = useState(false)
  const [ttsSettings, setTtsSettingsState] = useState(getTTSSettings())
  const [elevenLabsVoices, setElevenLabsVoices] = useState([])
  const [browserVoices, setBrowserVoices] = useState([])
  const [loadingVoices, setLoadingVoices] = useState(false)

  useEffect(() => {
    loadTodayQuote()
    loadScheduleTime()
    initializeSpeechSynthesis()
    loadVoices()

    // Cleanup: stop speech when component unmounts
    return () => {
      stopSpeaking()
    }
  }, [])

  const loadVoices = async () => {
    setLoadingVoices(true)
    try {
      // Load browser voices
      const voices = getAvailableVoices()
      setBrowserVoices(voices)

      // Load ElevenLabs voices if available
      const isAvailable = isElevenLabsAvailable()
      console.log('ElevenLabs available:', isAvailable)
      
      if (isAvailable) {
        try {
          const elVoices = await getElevenLabsVoices()
          setElevenLabsVoices(elVoices)
        } catch (error) {
          console.error('Error loading ElevenLabs voices:', error)
          // Fallback to cinematic voices
          setElevenLabsVoices(getCinematicVoices())
        }
      } else {
        console.warn('ElevenLabs API key not found. Make sure VITE_ELEVEN_LABS_API_KEY is set in your .env file and restart the dev server.')
        setElevenLabsVoices(getCinematicVoices())
      }
    } catch (error) {
      console.error('Error loading voices:', error)
    } finally {
      setLoadingVoices(false)
    }
  }

  const handleTTSSettingsChange = (key, value) => {
    const newSettings = { ...ttsSettings, [key]: value }
    setTtsSettingsState(newSettings)
    setTTSSettings(newSettings)
  }

  const loadScheduleTime = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('user_settings')
      .select('schedule_time')
      .eq('user_id', user.id)
      .maybeSingle()
    
    if (data?.schedule_time) {
      setScheduleTime(data.schedule_time)
    }
  }

  const loadTodayQuote = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      // Check if there's a quote for today
      const today = format(new Date(), 'yyyy-MM-dd')
      const { data: quoteData, error } = await supabase
        .from('daily_quotes')
        .select(`
          *,
          quotes (
            id,
            quote,
            character,
            movies (
              id,
              title,
              poster_url
            )
          )
        `)
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()

      if (error) {
        throw error
      }

      if (quoteData) {
        setTodayQuote(quoteData)
      } else {
        // Generate a new quote for today
        await generateTodayQuote()
      }
    } catch (error) {
      console.error('Error loading quote:', error)
    } finally {
      setLoading(false)
    }
  }

  const generateTodayQuote = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      
      // Get all user's movies
      const { data: movies, error: moviesError } = await supabase
        .from('movies')
        .select('id')
        .eq('user_id', user.id)

      if (moviesError) {
        console.error('Error fetching movies:', moviesError)
        setLoading(false)
        return
      }

      if (!movies || movies.length === 0) {
        setLoading(false)
        return
      }

      // Get all shown quote IDs
      const { data: shownQuotes, error: shownError } = await supabase
        .from('daily_quotes')
        .select('quote_id')
        .eq('user_id', user.id)

      if (shownError) {
        console.error('Error fetching shown quotes:', shownError)
      }

      const shownIds = new Set(shownQuotes?.map(q => q.quote_id) || [])

      // Get a batch of quotes with significance >= 7 (like the edge function does)
      let { data: quotes, error: quotesError } = await supabase
        .from('quotes')
        .select('*')
        .in('movie_id', movies.map(m => m.id))
        .gte('significance', 7)
        .limit(100)

      if (quotesError) {
        console.error('Error fetching high-significance quotes:', quotesError)
        quotes = []
      }

      // Filter out already shown quotes
      let availableQuotes = quotes?.filter(q => !shownIds.has(q.id)) || []

      if (availableQuotes.length === 0) {
        // Fallback to any quote if no high-significance quotes available
        const { data: fallbackQuotes, error: fallbackError } = await supabase
          .from('quotes')
          .select('*')
          .in('movie_id', movies.map(m => m.id))
          .limit(100)

        if (fallbackError) {
          console.error('Error fetching fallback quotes:', fallbackError)
          setLoading(false)
          return
        }

        availableQuotes = fallbackQuotes?.filter(q => !shownIds.has(q.id)) || []

        if (availableQuotes.length === 0) {
          console.log('No available quotes to show')
          setLoading(false)
          return
        }
      }

      // Pick a random quote from available quotes
      const randomQuote = availableQuotes[Math.floor(Math.random() * availableQuotes.length)]
      await saveDailyQuote(randomQuote.id)
    } catch (error) {
      console.error('Error generating quote:', error)
      setLoading(false)
    }
  }

  const saveDailyQuote = async (quoteId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const today = format(new Date(), 'yyyy-MM-dd')

      // First, check if a quote already exists for today
      const { data: existingQuote, error: checkError } = await supabase
        .from('daily_quotes')
        .select(`
          *,
          quotes (
            id,
            quote,
            character,
            movies (
              id,
              title,
              poster_url
            )
          )
        `)
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()

      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 is "not found" which is expected if no quote exists
        console.error('Error checking for existing quote:', checkError)
      }

      if (existingQuote) {
        // Quote already exists for today, just use it
        setTodayQuote(existingQuote)
        setLoading(false)
        return
      }

      // Insert the daily quote
      const { data: dailyQuote, error: insertError } = await supabase
        .from('daily_quotes')
        .insert({
          user_id: user.id,
          quote_id: quoteId,
          date: today,
        })
        .select(`
          *,
          quotes (
            id,
            quote,
            character,
            movies (
              id,
              title,
              poster_url
            )
          )
        `)
        .single()

      if (insertError) {
        // Handle 409 conflict or other errors
        if (insertError.code === '23505' || insertError.message?.includes('duplicate') || insertError.status === 409) {
          // Duplicate key error - quote already exists, load it
          const { data: existingQuoteAfterConflict, error: loadError } = await supabase
            .from('daily_quotes')
            .select(`
              *,
              quotes (
                id,
                quote,
                character,
                movies (
                  id,
                  title,
                  poster_url
                )
              )
            `)
            .eq('user_id', user.id)
            .eq('date', today)
            .maybeSingle()
          
          if (!loadError && existingQuoteAfterConflict) {
            setTodayQuote(existingQuoteAfterConflict)
          } else {
            console.error('Error loading existing quote after conflict:', loadError)
          }
        } else {
          console.error('Error inserting daily quote:', insertError)
        }
        setLoading(false)
        return
      }

      if (dailyQuote) {
        setTodayQuote(dailyQuote)
        setLoading(false)
      } else {
        console.error('No data returned from insert')
        setLoading(false)
      }
    } catch (error) {
      console.error('Error saving daily quote:', error)
      setLoading(false)
    }
  }

  const handleShowContext = async () => {
    if (showContext) {
      setShowContext(false)
      return
    }

    setLoadingContext(true)
    try {
      // Get the script text for this movie
      const { data: movie } = await supabase
        .from('movies')
        .select('script_text')
        .eq('id', todayQuote.quotes.movies.id)
        .single()

      if (movie?.script_text) {
        const contextText = await getQuoteContext(todayQuote.quotes.quote, movie.script_text)
        setContext(contextText)
        setShowContext(true)
      }
    } catch (error) {
      console.error('Error loading context:', error)
    } finally {
      setLoadingContext(false)
    }
  }

  const handlePlayQuote = async () => {
    if (!todayQuote?.quotes) return

    // Check current state
    const speaking = isSpeaking()
    const paused = isPaused()

    if (paused) {
      // Resume if paused
      resumeSpeaking()
      setIsPausedState(false)
      setIsPlaying(true)
    } else if (speaking) {
      // Pause if speaking
      pauseSpeaking()
      setIsPausedState(true)
      setIsPlaying(true) // Still playing, just paused
    } else {
      // Start new playback
      const quoteText = `"${todayQuote.quotes.quote}"`
      const characterText = todayQuote.quotes.character ? ` by ${todayQuote.quotes.character}` : ''
      const fullText = `${quoteText}${characterText}`

      try {
        await speakQuote(
          fullText,
          () => {
            // On end
            setIsPlaying(false)
            setIsPausedState(false)
          },
          (error) => {
            // On error
            console.error('Error playing quote:', error)
            setIsPlaying(false)
            setIsPausedState(false)
            alert('Error playing quote. Please try again.')
          }
        )
        setIsPlaying(true)
        setIsPausedState(false)
      } catch (error) {
        console.error('Error starting playback:', error)
        setIsPlaying(false)
        setIsPausedState(false)
        alert('Error playing quote. Please try again.')
      }
    }
  }

  const handleStopQuote = () => {
    stopSpeaking()
    setIsPlaying(false)
    setIsPausedState(false)
  }

  // Update playing state periodically to sync with actual speech state
  useEffect(() => {
    if (!isPlaying) return

    const interval = setInterval(() => {
      const speaking = isSpeaking()
      const paused = isPaused()
      
      if (!speaking && !paused) {
        setIsPlaying(false)
        setIsPausedState(false)
      } else if (paused !== isPausedState) {
        setIsPausedState(paused)
      }
    }, 100)

    return () => clearInterval(interval)
  }, [isPlaying, isPausedState])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-xl text-slate-600 dark:text-slate-400">Loading your quote...</div>
      </div>
    )
  }

  if (!todayQuote) {
    return (
      <div className="card text-center">
        <Film className="mx-auto mb-4 text-slate-400" size={48} />
        <h2 className="text-2xl font-bold mb-2">No Quotes Yet</h2>
        <p className="text-slate-600 dark:text-slate-400 mb-6">
          Add some movies to your library to start receiving daily quotes!
        </p>
        <Link to="/library" className="btn-primary inline-block">
          Go to Library
        </Link>
      </div>
    )
  }

  const quote = todayQuote.quotes
  const movie = quote.movies

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            Today's Quote
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {format(new Date(), 'EEEE, MMMM d, yyyy')}
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Clock size={20} className="text-slate-400" />
          <span className="text-sm text-slate-600 dark:text-slate-400">
            Scheduled: {scheduleTime}
          </span>
        </div>
      </div>

      <div className="card max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row gap-6">
          {movie.poster_url && (
            <img
              src={movie.poster_url}
              alt={movie.title}
              className="w-full md:w-48 h-72 md:h-auto object-cover rounded-lg"
            />
          )}
          <div className="flex-1">
            <div className="mb-6">
              <div className="text-2xl md:text-3xl font-medium text-slate-900 dark:text-slate-100 mb-4 leading-relaxed">
                "{quote.quote}"
              </div>
              
              {!hideInfo && (
                <div className="space-y-2 text-slate-600 dark:text-slate-400">
                  <div className="flex items-center space-x-2">
                    <User size={18} />
                    <button
                      onClick={() => setShowCharacterAnalysis(true)}
                      className="font-medium hover:text-primary-600 dark:hover:text-primary-400 transition-colors cursor-pointer"
                    >
                      {quote.character}
                    </button>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Film size={18} />
                    <span>{movie.title}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setHideInfo(!hideInfo)}
                className="btn-secondary flex items-center space-x-2"
              >
                {hideInfo ? <Eye size={18} /> : <EyeOff size={18} />}
                <span>{hideInfo ? 'Reveal' : 'Hide'} Info</span>
              </button>
              
              <button
                onClick={handleShowContext}
                disabled={loadingContext}
                className="btn-secondary flex items-center space-x-2"
              >
                <Sparkles size={18} />
                <span>{showContext ? 'Hide' : 'Show'} Context</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePlayQuote}
                  className="btn-primary flex items-center space-x-2"
                  disabled={loadingContext}
                >
                  {isPausedState ? (
                    <>
                      <Play size={18} />
                      <span>Resume</span>
                    </>
                  ) : isPlaying ? (
                    <>
                      <Pause size={18} />
                      <span>Pause</span>
                    </>
                  ) : (
                    <>
                      <Volume2 size={18} />
                      <span>Listen</span>
                    </>
                  )}
                </button>
                
                {isPlaying && (
                  <button
                    onClick={handleStopQuote}
                    className="btn-secondary flex items-center space-x-2"
                    title="Stop"
                  >
                    <VolumeX size={18} />
                  </button>
                )}

                <button
                  onClick={() => setShowTTSSettings(!showTTSSettings)}
                  className="btn-secondary flex items-center space-x-2"
                  title="TTS Settings"
                >
                  <Settings size={18} />
                </button>

                <button
                  onClick={async () => {
                    if (!todayQuote?.quotes) return
                    try {
                      const movieId = todayQuote.quotes.movies.id
                      const cfg = await getMovieMediaConfigPersisted(movieId)
                      const audioUrl = cfg.audioUrl
                      const srtUrl = cfg.srtUrl
                      if (!audioUrl || !srtUrl) {
                        alert('Audio file or subtitle file is not configured for this movie. Please configure them in the Library section.')
                        return
                      }
                      const quoteText = `"${todayQuote.quotes.quote}"${todayQuote.quotes.character ? ` by ${todayQuote.quotes.character}` : ''}`
                      await playOriginalQuoteSegment(quoteText, audioUrl, srtUrl, {
                        subtitleOffset: cfg.subtitleOffset || 0,
                        onStart: () => {
                          setIsPlaying(true)
                          setIsPausedState(false)
                        },
                        onEnd: () => {
                          setIsPlaying(false)
                          setIsPausedState(false)
                        },
                        onError: (e) => {
                          console.error('Original clip playback error:', e)
                          const errorMsg = e?.message || 'Could not play original clip'
                          alert(`Error: ${errorMsg}\n\nPlease ensure:\n- You have uploaded both an audio file and a subtitle file in the Library section\n- The subtitle file is a valid SRT format\n- The quote text matches the subtitle content`)
                          setIsPlaying(false)
                          setIsPausedState(false)
                        }
                      })
                    } catch (e) {
                      console.error(e)
                    }
                  }}
                  className="btn-secondary flex items-center space-x-2"
                  title="Play Original Clip"
                >
                  <Film size={18} />
                  <span>Original</span>
                </button>
              </div>
            </div>

            {showTTSSettings && (
              <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Voice & Speed Settings</h3>
                
                {/* Speed Control */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Speed: {ttsSettings.speed.toFixed(2)}x
                  </label>
                  <input
                    type="range"
                    min="0.25"
                    max="2"
                    step="0.05"
                    value={ttsSettings.speed}
                    onChange={(e) => handleTTSSettingsChange('speed', parseFloat(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span>0.25x</span>
                    <span>1.0x</span>
                    <span>2.0x</span>
                  </div>
                </div>

                {/* Voice Selection */}
                {isElevenLabsAvailable() ? (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                      ElevenLabs Voice
                    </label>
                    <select
                      value={ttsSettings.voiceId || ''}
                      onChange={(e) => handleTTSSettingsChange('voiceId', e.target.value || null)}
                      className="input-field"
                      disabled={loadingVoices}
                    >
                      <option value="">Default (Josh)</option>
                      {elevenLabsVoices.map((voice) => (
                        <option key={voice.voice_id || voice.id} value={voice.voice_id || voice.id}>
                          {voice.name} {voice.description ? `- ${voice.description}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="p-3 bg-slate-100 dark:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-500">
                    <p className="text-sm text-slate-700 dark:text-slate-300 mb-1">
                      <strong>ElevenLabs Premium Voices</strong>
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      To enable premium voices, add <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 rounded">VITE_ELEVEN_LABS_API_KEY</code> to your <code className="text-xs bg-slate-200 dark:bg-slate-700 px-1 rounded">.env</code> file.
                      <br />
                      <strong>Important:</strong> Restart your dev server after adding the key!
                      <br />
                      Get your free API key at <a href="https://elevenlabs.io/" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 underline">elevenlabs.io</a>
                    </p>
                  </div>
                )}

                {/* Browser Voice Selection */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Browser Voice (Fallback)
                  </label>
                  <select
                    value={ttsSettings.browserVoice || ''}
                    onChange={(e) => handleTTSSettingsChange('browserVoice', e.target.value || null)}
                    className="input-field"
                    disabled={loadingVoices}
                  >
                    <option value="">Auto-select best voice</option>
                    {browserVoices.map((voice, index) => (
                      <option key={index} value={voice.name}>
                        {voice.name} {voice.lang ? `(${voice.lang})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {showContext && context && (
              <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Context:
                </p>
                <p className="text-slate-600 dark:text-slate-400 italic">{context}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCharacterAnalysis && todayQuote && (
        <CharacterAnalysis
          characterName={todayQuote.quotes.character}
          movieId={todayQuote.quotes.movies.id}
          onClose={() => setShowCharacterAnalysis(false)}
        />
      )}
    </div>
  )
}

