import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Upload, Link as LinkIcon, Loader2, Quote, X, Volume2, VolumeX, Pause, Play, Settings, PlayCircle, Film } from 'lucide-react'
import { parseScript, parseSubtitleFile } from '../lib/gemini'
import { fetchScriptFromUrl } from '../lib/scriptFetcher'
import { getMoviePoster } from '../lib/tmdb'
import { 
  speakQuote, 
  pauseSpeaking, 
  resumeSpeaking, 
  stopSpeaking, 
  isSpeaking, 
  isPaused, 
  initializeSpeechSynthesis,
  addQuotesToQueue,
  clearQueue,
  playQuoteQueue,
  stopQueue,
  isQueuePlaying,
  setTTSSettings,
  getTTSSettings,
  getAvailableVoices,
  getElevenLabsVoices,
  getCinematicVoices,
  isElevenLabsAvailable,
} from '../lib/textToSpeech'
import { playOriginalQuoteSegment } from '../lib/originalAudio'
import { getMovieMediaConfigPersisted, setMovieMediaConfigPersisted, isLocalSrtContent, createLocalSrtUrl, getLocalSrtContent, isLocalAudioContent, createLocalAudioUrl, getLocalAudioContent } from '../lib/mediaConfig'

const SUBTITLE_OFFSET_MIN = -600000 // -10 minutes in milliseconds
const SUBTITLE_OFFSET_MAX = 600000 // +10 minutes in milliseconds
const SUBTITLE_OFFSET_STEP = 100 // 0.1 second increments

// Format timestamp in milliseconds to HH:MM:SS format
const formatTimestamp = (ms) => {
  if (ms === null || ms === undefined) return ''
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function Library() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMethod, setAddMethod] = useState('url') // 'url', 'upload', or 'subtitle'
  const [movieTitle, setMovieTitle] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [scriptFile, setScriptFile] = useState(null)
  const [subtitleFile, setSubtitleFile] = useState(null)
  const [processing, setProcessing] = useState(false)
  const [processingProgress, setProcessingProgress] = useState(null)
  const [selectedMovie, setSelectedMovie] = useState(null)
  const [movieQuotes, setMovieQuotes] = useState([])
  const [loadingQuotes, setLoadingQuotes] = useState(false)
  const [playingQuoteId, setPlayingQuoteId] = useState(null)
  const [isPausedState, setIsPausedState] = useState(false)
  const [isPlayingAll, setIsPlayingAll] = useState(false)
  const [currentQueueIndex, setCurrentQueueIndex] = useState(0)
  const [showTTSSettings, setShowTTSSettings] = useState(false)
  const [ttsSettings, setTtsSettingsState] = useState(getTTSSettings())
  const [elevenLabsVoices, setElevenLabsVoices] = useState([])
  const [browserVoices, setBrowserVoices] = useState([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [showMediaSettings, setShowMediaSettings] = useState(false)
  const [mediaConfig, setMediaConfig] = useState({ videoUrl: '', audioUrl: '', srtUrl: '', subtitleOffset: 0 })
  const [srtFileName, setSrtFileName] = useState('')
  const [audioFileName, setAudioFileName] = useState('')
  const originalAudioStopRef = useRef(null)

  useEffect(() => {
    loadMovies()
    initializeSpeechSynthesis()
    loadVoices()

    // Cleanup: stop speech when component unmounts
    return () => {
      stopSpeaking()
      stopQueue()
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

  const handlePlayAll = async () => {
    if (isPlayingAll) {
      stopQueue()
      setIsPlayingAll(false)
      setCurrentQueueIndex(0)
      return
    }

    if (movieQuotes.length === 0) return

    // Clear any existing queue and add all quotes
    clearQueue()
    addQuotesToQueue(movieQuotes)
    setIsPlayingAll(true)
    setCurrentQueueIndex(0)

    await playQuoteQueue(
      (current, total, quote) => {
        // On progress - update UI
        setCurrentQueueIndex(current)
        setPlayingQuoteId(quote.id)
      },
      () => {
        // On complete
        setIsPlayingAll(false)
        setCurrentQueueIndex(0)
        setPlayingQuoteId(null)
      },
      (error) => {
        // On error
        console.error('Error playing queue:', error)
        setIsPlayingAll(false)
        setCurrentQueueIndex(0)
        setPlayingQuoteId(null)
      }
    )
  }

  const loadMovies = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase
        .from('movies')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      setMovies(data || [])
    } catch (error) {
      console.error('Error loading movies:', error)
    } finally {
      setLoading(false)
    }
  }

  // Check for duplicate quotes (normalized comparison)
  const normalizeQuote = (text) => {
    return text.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ')
  }

  const checkDuplicateQuotes = async (movieId, newQuotes) => {
    // Get existing quotes for this movie
    const { data: existingQuotes, error } = await supabase
      .from('quotes')
      .select('quote')
      .eq('movie_id', movieId)

    if (error) {
      console.error('Error checking duplicates:', error)
      return newQuotes // If check fails, proceed with all quotes
    }

    const existingNormalized = new Set(
      (existingQuotes || []).map(q => normalizeQuote(q.quote))
    )

    // Filter out duplicates
    const uniqueQuotes = newQuotes.filter(q => {
      const normalized = normalizeQuote(q.quote)
      return !existingNormalized.has(normalized)
    })

    const duplicatesCount = newQuotes.length - uniqueQuotes.length
    if (duplicatesCount > 0) {
      console.log(`Filtered out ${duplicatesCount} duplicate quotes`)
    }

    return uniqueQuotes
  }

  const handleAddMovie = async () => {
    if (!movieTitle.trim()) {
      alert('Please enter a movie title')
      return
    }

    setProcessing(true)
    try {
      let quotes = []
      let scriptText = ''
      let srtText = null // Store SRT text for later use

      if (addMethod === 'subtitle') {
        // Handle subtitle file
        if (!subtitleFile) {
          alert('Please select a subtitle file')
          setProcessing(false)
          return
        }

        srtText = await subtitleFile.text()
        setProcessingProgress({ current: 0, total: 0, message: 'Parsing subtitle file...' })
        
        quotes = await parseSubtitleFile(srtText, movieTitle, (current, total) => {
          setProcessingProgress({ current, total, message: `Processing subtitle chunk ${current} of ${total}...` })
        })
        
        if (!quotes || quotes.length === 0) {
          throw new Error('No quotes were extracted from the subtitle file. Please check the file format.')
        }
        
        console.log(`Extracted ${quotes.length} quotes from subtitle file`)
        scriptText = `Subtitle file: ${subtitleFile.name}` // Store filename as script_text for subtitle-based movies
      } else {
        // Handle script URL or file upload
        if (addMethod === 'url') {
          if (!scriptUrl.trim()) {
            alert('Please enter a script URL')
            setProcessing(false)
            return
          }
          scriptText = await fetchScriptFromUrl(scriptUrl)
        } else {
          if (!scriptFile) {
            alert('Please select a file')
            setProcessing(false)
            return
          }
          scriptText = await scriptFile.text()
        }

        // Parse script with Gemini (with progress feedback)
        setProcessingProgress({ current: 0, total: 0, message: 'Parsing script...' })
        quotes = await parseScript(scriptText, movieTitle, (current, total) => {
          setProcessingProgress({ current, total, message: `Processing script part ${current} of ${total}...` })
        })
        
        if (!quotes || quotes.length === 0) {
          throw new Error('No quotes were extracted from the script. Please check the script format.')
        }
        
        console.log(`Extracted ${quotes.length} quotes from script`)
      }
      
      setProcessingProgress({ current: 1, total: 1, message: `Processing ${quotes.length} quotes...` })

      // Get movie poster (works for all methods including subtitle files)
      console.log(`[Movie Poster] Fetching poster for: "${movieTitle}"`)
      const posterUrl = await getMoviePoster(movieTitle)
      console.log(`[Movie Poster] Retrieved poster URL: ${posterUrl ? posterUrl.substring(0, 100) : 'null'}`)

      // Save to Supabase
      const { data: { user } } = await supabase.auth.getUser()

      // Check if movie already exists
      const { data: existingMovies } = await supabase
        .from('movies')
        .select('id')
        .eq('user_id', user.id)
        .eq('title', movieTitle)
        .maybeSingle()

      let movie
      if (existingMovies) {
        // Movie exists, use it
        movie = existingMovies
        setProcessingProgress({ current: 1, total: 1, message: `Adding quotes to existing movie...` })
      } else {
        // Insert movie
        const { data: newMovie, error: movieError } = await supabase
          .from('movies')
          .insert({
            user_id: user.id,
            title: movieTitle,
            script_text: scriptText,
            poster_url: posterUrl,
          })
          .select()
          .single()

        if (movieError) throw movieError
        movie = newMovie
      }

      // Filter quotes by significance - only keep high-quality quotes (significance >= 7)
      // For subtitle files, quotes already have significance >= 7
      let quotesToSave = []
      if (addMethod === 'subtitle') {
        // Subtitle quotes are already filtered for significance >= 7
        quotesToSave = quotes.filter(q => {
          const quoteText = (q.quote || '').trim()
          return quoteText.length > 10 && quoteText.length < 500
        })
      } else {
        const highQualityQuotes = quotes.filter(q => {
          const significance = q.significance || 5
          const quoteText = (q.quote || '').trim()
          return significance >= 7 && quoteText.length > 10 && quoteText.length < 500
        })

        if (highQualityQuotes.length === 0) {
          console.warn('No high-quality quotes found (significance >= 7). All quotes:', quotes.length)
          const sortedQuotes = [...quotes].sort((a, b) => (b.significance || 5) - (a.significance || 5))
          quotesToSave = sortedQuotes.slice(0, Math.max(10, Math.floor(quotes.length * 0.2)))
          if (quotesToSave.length === 0) {
            throw new Error('No valid quotes to save. The script may not contain memorable dialogue.')
          }
          console.log(`Using fallback: saving top ${quotesToSave.length} quotes by significance`)
        } else {
          console.log(`Filtered to ${highQualityQuotes.length} high-quality quotes (significance >= 7) out of ${quotes.length} total`)
          quotesToSave = highQualityQuotes
        }
      }

      // Check for duplicates
      const uniqueQuotes = await checkDuplicateQuotes(movie.id, quotesToSave)
      
      if (uniqueQuotes.length === 0) {
        throw new Error('All quotes are duplicates. No new quotes to add.')
      }

      // Insert quotes in batches to avoid timeout issues
      const BATCH_SIZE = 100
      const quotesToInsert = uniqueQuotes.map(q => ({
        movie_id: movie.id,
        character: q.character || 'UNKNOWN',
        quote: q.quote || '',
        significance: q.significance || 7,
        start_time: q.start_time || null,
        end_time: q.end_time || null,
      })).filter(q => q.quote.trim().length > 0) // Filter out empty quotes

      if (quotesToInsert.length === 0) {
        throw new Error('No valid quotes to save after filtering')
      }

      // Insert in batches
      for (let i = 0; i < quotesToInsert.length; i += BATCH_SIZE) {
        const batch = quotesToInsert.slice(i, i + BATCH_SIZE)
        const { error: quotesError } = await supabase
          .from('quotes')
          .insert(batch)

        if (quotesError) {
          console.error(`Error inserting quotes batch ${Math.floor(i / BATCH_SIZE) + 1}:`, quotesError)
          throw quotesError
        }
        
        setProcessingProgress({
          current: Math.min(i + BATCH_SIZE, quotesToInsert.length),
          total: quotesToInsert.length,
          message: `Saving quotes ${Math.min(i + BATCH_SIZE, quotesToInsert.length)} / ${quotesToInsert.length}...`
        })
      }
      
      console.log(`Successfully saved ${quotesToInsert.length} quotes to database`)

      // If adding from subtitle file, automatically save the SRT file to media config
      if (addMethod === 'subtitle' && srtText) {
        try {
          console.log(`[Auto-save SRT] Saving SRT file for movie ${movie.id}, length: ${srtText.length}`)
          const srtUrl = createLocalSrtUrl(srtText)
          await setMovieMediaConfigPersisted(movie.id, {
            videoUrl: '',
            audioUrl: '', // User will need to upload audio separately
            srtUrl: srtUrl
          })
          localStorage.setItem(`movie-srt-filename-${movie.id}`, subtitleFile.name)
          console.log(`[Auto-save SRT] Successfully saved SRT file "${subtitleFile.name}" for movie ${movie.id}`)
        } catch (error) {
          console.error('[Auto-save SRT] Error saving SRT file automatically:', error)
          // Don't throw - this is not critical
        }
      }

      // Reset form and reload
      setMovieTitle('')
      setScriptUrl('')
      setScriptFile(null)
      setSubtitleFile(null)
      setProcessingProgress(null)
      setShowAddModal(false)
      loadMovies()
    } catch (error) {
      console.error('Error adding movie:', error)
      alert('Error adding movie: ' + error.message)
    } finally {
      setProcessing(false)
      setProcessingProgress(null)
    }
  }

  const handleDeleteMovie = async (movieId) => {
    if (!confirm('Are you sure you want to delete this movie and all its quotes?')) {
      return
    }

    try {
      // Delete quotes first (foreign key constraint)
      await supabase.from('quotes').delete().eq('movie_id', movieId)
      
      // Then delete movie
      const { error } = await supabase.from('movies').delete().eq('id', movieId)
      
      if (error) throw error
      
      // Close quotes modal if open for this movie
      if (selectedMovie?.id === movieId) {
        setSelectedMovie(null)
        setMovieQuotes([])
      }
      
      loadMovies()
    } catch (error) {
      console.error('Error deleting movie:', error)
      alert('Error deleting movie: ' + error.message)
    }
  }

  const handleDeleteQuote = async (quoteId) => {
    if (!confirm('Are you sure you want to delete this quote?')) {
      return
    }

    try {
      const { error } = await supabase.from('quotes').delete().eq('id', quoteId)
      
      if (error) throw error
      
      // Remove from local state
      setMovieQuotes(movieQuotes.filter(q => q.id !== quoteId))
      
      // If this quote was playing, stop it
      if (playingQuoteId === quoteId) {
        stopSpeaking()
        stopOriginalAudio()
        setPlayingQuoteId(null)
        setIsPausedState(false)
      }
    } catch (error) {
      console.error('Error deleting quote:', error)
      alert('Error deleting quote: ' + error.message)
    }
  }

  const handleViewQuotes = async (movie) => {
    // Stop any currently playing quote
    stopSpeaking()
    setPlayingQuoteId(null)
    setIsPausedState(false)
    
    // Load media config for this movie
    const cfg = await getMovieMediaConfigPersisted(movie.id)
    setMediaConfig({ ...cfg, subtitleOffset: cfg.subtitleOffset || 0 })
    // Try to get filename from localStorage if available
    if (isLocalSrtContent(cfg.srtUrl)) {
      const storedFileName = localStorage.getItem(`movie-srt-filename-${movie.id}`)
      setSrtFileName(storedFileName || 'Uploaded file')
    } else {
      setSrtFileName('')
    }
    setShowMediaSettings(false)
    
    setSelectedMovie(movie)
    setLoadingQuotes(true)
    try {
      const { data: quotes, error } = await supabase
        .from('quotes')
        .select('*')
        .eq('movie_id', movie.id)
        .order('significance', { ascending: false })
        .order('created_at', { ascending: true })

      if (error) throw error
      setMovieQuotes(quotes || [])
    } catch (error) {
      console.error('Error loading quotes:', error)
      alert('Error loading quotes: ' + error.message)
    } finally {
      setLoadingQuotes(false)
    }
  }

  const stopOriginalAudio = () => {
    if (originalAudioStopRef.current) {
      try {
        originalAudioStopRef.current()
      } catch (error) {
        console.warn('Error stopping original audio playback:', error)
      } finally {
        originalAudioStopRef.current = null
      }
    }
  }

  const handlePlayQuote = async (quote) => {
    const quoteText = `"${quote.quote}"`
    const characterText = quote.character ? ` by ${quote.character}` : ''
    const fullText = `${quoteText}${characterText}`

    // If this quote is already playing, pause/resume it
    if (playingQuoteId === quote.id) {
      if (isPausedState) {
        resumeSpeaking()
        setIsPausedState(false)
      } else if (isSpeaking()) {
        pauseSpeaking()
        setIsPausedState(true)
      }
      return
    }

    // Stop any other quote and play this one
    stopSpeaking()
    stopOriginalAudio()
    setPlayingQuoteId(quote.id)
    setIsPausedState(false)

    try {
      await speakQuote(
        fullText,
        () => {
          // On end
          setPlayingQuoteId(null)
          setIsPausedState(false)
        },
        (error) => {
          // On error
          console.error('Error playing quote:', error)
          setPlayingQuoteId(null)
          setIsPausedState(false)
        }
      )
    } catch (error) {
      console.error('Error starting playback:', error)
      setPlayingQuoteId(null)
      setIsPausedState(false)
    }
  }

  const handleStopQuote = () => {
    stopSpeaking()
    stopOriginalAudio()
    setPlayingQuoteId(null)
    setIsPausedState(false)
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            My Library
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Manage your movie scripts and quotes
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>Add Movie</span>
        </button>
      </div>

      {movies.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-slate-600 dark:text-slate-400 mb-6">
            No movies in your library yet. Add your first movie to get started!
          </p>
          <button onClick={() => setShowAddModal(true)} className="btn-primary">
            Add Your First Movie
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {movies.map((movie) => (
            <div key={movie.id} className="card group">
              <div className="relative">
                {movie.poster_url ? (
                  <img
                    src={movie.poster_url}
                    alt={movie.title}
                    className="w-full h-64 object-cover rounded-lg mb-4"
                  />
                ) : (
                  <div className="w-full h-64 bg-slate-200 dark:bg-slate-700 rounded-lg mb-4 flex items-center justify-center">
                    <span className="text-slate-400">{movie.title}</span>
                  </div>
                )}
                <button
                  onClick={() => handleDeleteMovie(movie.id)}
                  className="absolute top-2 right-2 p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-2">
                {movie.title}
              </h3>
              <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                Added {new Date(movie.created_at).toLocaleDateString()}
              </p>
              <button
                onClick={() => handleViewQuotes(movie)}
                className="btn-secondary w-full flex items-center justify-center space-x-2"
              >
                <Quote size={18} />
                <span>View Quotes</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Quotes Modal */}
      {selectedMovie && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="card max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                  Quotes from {selectedMovie.title}
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {movieQuotes.length} {movieQuotes.length === 1 ? 'quote' : 'quotes'} found
                  {isPlayingAll && ` • Playing ${currentQueueIndex} of ${movieQuotes.length}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {movieQuotes.length > 0 && (
                  <button
                    onClick={handlePlayAll}
                    className="btn-primary flex items-center space-x-2"
                    title={isPlayingAll ? 'Stop playing all' : 'Play all quotes'}
                  >
                    <PlayCircle size={18} />
                    <span>{isPlayingAll ? 'Stop All' : 'Play All'}</span>
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
                  onClick={() => setShowMediaSettings(!showMediaSettings)}
                  className="btn-secondary flex items-center space-x-2"
                  title="Edit Video & Subtitle URLs"
                >
                  <LinkIcon size={18} />
                </button>
                <button
                  onClick={() => {
                    stopSpeaking()
                    stopQueue()
                    setSelectedMovie(null)
                    setMovieQuotes([])
                    setPlayingQuoteId(null)
                    setIsPausedState(false)
                    setIsPlayingAll(false)
                    setCurrentQueueIndex(0)
                    setShowMediaSettings(false)
                    setMediaConfig({ videoUrl: '', audioUrl: '', srtUrl: '' })
                    setSrtFileName('')
                    setAudioFileName('')
                  }}
                  className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
            </div>

            {showTTSSettings && (
              <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 space-y-4">
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

            {showMediaSettings && (
              <div className="mb-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-600 space-y-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Audio & Subtitle Files</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Upload an audio file and subtitle file. When you click a quote, the app will find the timestamps in the subtitle file and play the matching audio segment.
                </p>
                
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Audio File
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Upload an audio file. The app will play the audio segment matching the quote timestamps from the subtitle file.
                  </p>
                  <div className="space-y-2 mb-2">
                      <input
                        type="file"
                        accept=".mp3,.wav,.ogg,.m4a,.aac"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          
                          // Check file size (warn if > 10MB, but allow up to 175MB)
                          const maxRecommendedSize = 10 * 1024 * 1024 // 10MB
                          const maxSize = 175 * 1024 * 1024 // 175MB
                            if (file.size > maxSize) {
                              alert(`File is too large (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximum size is ${(maxSize / 1024 / 1024).toFixed(0)}MB. Please use a smaller file.`)
                              return
                            }
                          if (file.size > maxRecommendedSize) {
                            const proceed = confirm(
                              `Warning: This file is large (${(file.size / 1024 / 1024).toFixed(2)}MB). ` +
                              `Large files may take longer to process and use more storage. Continue?`
                            )
                            if (!proceed) return
                          }
                          
                          try {
                            // Store file as Blob directly - more efficient than base64
                            // Create a marker URL that indicates the blob is stored in IndexedDB
                            const audioUrl = createLocalAudioUrl('blob-stored')
                            console.log('Audio file uploaded, size:', file.size, 'bytes, type:', file.type)
                            
                            // Store the blob directly in IndexedDB immediately
                            if (selectedMovie) {
                              const storageKey = `movie-audio-content-${selectedMovie.id}`
                              try {
                                // Store blob directly in IndexedDB
                                const db = await new Promise((resolve, reject) => {
                                  const request = indexedDB.open('QuoteAppDB', 2) // Use version 2
                                  request.onerror = () => reject(request.error)
                                  request.onsuccess = () => resolve(request.result)
                                  request.onupgradeneeded = (event) => {
                                    const db = event.target.result
                                    if (!db.objectStoreNames.contains('movie-audio-files')) {
                                      db.createObjectStore('movie-audio-files')
                                    }
                                    if (!db.objectStoreNames.contains('routine-songs')) {
                                      db.createObjectStore('routine-songs')
                                    }
                                  }
                                })
                                
                                await new Promise((resolve, reject) => {
                                  const transaction = db.transaction(['movie-audio-files'], 'readwrite')
                                  const store = transaction.objectStore('movie-audio-files')
                                  const request = store.put(file, storageKey)
                                  request.onsuccess = () => resolve()
                                  request.onerror = () => reject(request.error)
                                })
                                
                                // Mark as stored in IndexedDB
                                localStorage.setItem(storageKey + '-idb', 'true')
                                localStorage.setItem(storageKey + '-type', file.type || 'audio/mpeg')
                                console.log('Audio blob stored in IndexedDB, key:', storageKey)
                              } catch (storageError) {
                                console.error('Error storing audio blob:', storageError)
                                alert('Error storing audio file: ' + storageError.message)
                                return
                              }
                              
                              localStorage.setItem(`movie-audio-filename-${selectedMovie.id}`, file.name)
                            }
                            
                            setMediaConfig({ ...mediaConfig, audioUrl })
                            setAudioFileName(file.name)
                          } catch (error) {
                            console.error('Error reading audio file:', error)
                            if (error.name === 'QuotaExceededError') {
                              alert('Error: The audio file is too large to store. Please use a smaller file.')
                            } else {
                              alert('Error reading audio file: ' + error.message)
                            }
                          }
                        }}
                        className="input-field"
                      />
                      {audioFileName && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Selected: {audioFileName}
                        </p>
                      )}
                      {isLocalAudioContent(mediaConfig.audioUrl) && !audioFileName && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                          ✓ Audio file already uploaded
                        </p>
                      )}
                    </div>
                </div>

                {/* Subtitle Timing Offset */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Subtitle Timing Offset
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Adjust if subtitles don't match the audio timing. Positive values shift forward, negative shifts backward.
                  </p>
                  <div className="flex items-center space-x-4">
                    <input
                      type="range"
                      min={SUBTITLE_OFFSET_MIN}
                      max={SUBTITLE_OFFSET_MAX}
                      step={SUBTITLE_OFFSET_STEP}
                      value={mediaConfig.subtitleOffset || 0}
                      onChange={(e) => setMediaConfig({ ...mediaConfig, subtitleOffset: parseInt(e.target.value) || 0 })}
                      className="flex-1"
                    />
                    <div className="w-24 text-right">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                        {(mediaConfig.subtitleOffset || 0) > 0 ? '+' : ''}
                        {((mediaConfig.subtitleOffset || 0) / 1000).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400 mt-1">
                    <span>-10m</span>
                    <span>0.0s</span>
                    <span>+10m</span>
                  </div>
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Custom Offset (seconds)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={SUBTITLE_OFFSET_MIN / 1000}
                        max={SUBTITLE_OFFSET_MAX / 1000}
                        step="0.01"
                        value={(mediaConfig.subtitleOffset || 0) / 1000}
                        onChange={(e) => {
                          const rawSeconds = parseFloat(e.target.value)
                          if (Number.isNaN(rawSeconds)) {
                            setMediaConfig({ ...mediaConfig, subtitleOffset: 0 })
                            return
                          }
                          const clampedSeconds = Math.min(
                            SUBTITLE_OFFSET_MAX / 1000,
                            Math.max(SUBTITLE_OFFSET_MIN / 1000, rawSeconds)
                          )
                          setMediaConfig({
                            ...mediaConfig,
                            subtitleOffset: Math.round(clampedSeconds * 1000)
                          })
                        }}
                        className="input-field"
                      />
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Up to ±10 minutes with 10ms precision
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 flex space-x-2">
                    <button
                      onClick={() => setMediaConfig({ ...mediaConfig, subtitleOffset: (mediaConfig.subtitleOffset || 0) - 500 })}
                      className="btn-secondary text-xs px-3 py-1"
                    >
                      -0.5s
                    </button>
                    <button
                      onClick={() => setMediaConfig({ ...mediaConfig, subtitleOffset: (mediaConfig.subtitleOffset || 0) + 500 })}
                      className="btn-secondary text-xs px-3 py-1"
                    >
                      +0.5s
                    </button>
                    <button
                      onClick={() => setMediaConfig({ ...mediaConfig, subtitleOffset: 0 })}
                      className="btn-secondary text-xs px-3 py-1"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Subtitle File
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Upload an SRT subtitle file. The app will find the quote timestamps in this file.
                  </p>
                  <div className="space-y-2">
                      <input
                        type="file"
                        accept=".srt,.txt"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          
                          try {
                            // Check file extension
                            const fileName = file.name.toLowerCase()
                            const isAudioFile = fileName.endsWith('.mp3') || fileName.endsWith('.wav') || 
                                                fileName.endsWith('.ogg') || fileName.endsWith('.m4a') || 
                                                fileName.endsWith('.aac') || fileName.endsWith('.flac')
                            
                            if (isAudioFile) {
                              alert('Error: You selected an audio file. Please select a subtitle file (.srt or .txt format).\n\nTo upload audio, use the "Audio Source" section above.')
                              return
                            }
                            
                            // Read first few bytes to check for binary file signatures
                            const arrayBuffer = await file.arrayBuffer()
                            const uint8Array = new Uint8Array(arrayBuffer.slice(0, 10))
                            
                            // Check for common binary file signatures
                            // ID3 (MP3): 49 44 33 (ASCII "ID3")
                            if (uint8Array[0] === 0x49 && uint8Array[1] === 0x44 && uint8Array[2] === 0x33) {
                              alert('Error: This appears to be an MP3 audio file, not a subtitle file.\n\nPlease select a valid SRT subtitle file (.srt format).\n\nTo upload audio, use the "Audio Source" section above.')
                              return
                            }
                            
                            // Check for other binary formats
                            const isBinary = uint8Array.some(byte => byte === 0 && uint8Array.indexOf(byte) < 5)
                            if (isBinary && !fileName.endsWith('.srt') && !fileName.endsWith('.txt')) {
                              alert('Error: This appears to be a binary file, not a text-based subtitle file.\n\nPlease select a valid SRT subtitle file (.srt format).')
                              return
                            }
                            
                            const content = await file.text()
                            
                            // Validate SRT content
                            if (!content || !content.trim()) {
                              alert('The subtitle file appears to be empty. Please select a valid SRT file.')
                              return
                            }
                            
                            // Quick validation - check if it looks like an SRT file
                            const hasTimestamp = /(\d{2}:\d{2}:\d{2}[,\.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,\.]\d{3})/.test(content)
                            if (!hasTimestamp) {
                              const confirm = window.confirm(
                                'Warning: The file does not appear to contain SRT timestamp format (HH:MM:SS,mmm --> HH:MM:SS,mmm).\n\n' +
                                'The file may not be a valid SRT subtitle file. Do you want to continue anyway?'
                              )
                              if (!confirm) return
                            }
                            
                            console.log('SRT file uploaded, content length:', content.length, 'first 100 chars:', content.substring(0, 100))
                            
                            // Validate content is actually there
                            if (!content || content.trim().length < 10) {
                              alert('Error: The subtitle file appears to be empty or too small. Please select a valid SRT file.')
                              return
                            }
                            
                            const srtUrl = createLocalSrtUrl(content)
                            console.log('Created SRT URL, length:', srtUrl.length)
                            setMediaConfig({ ...mediaConfig, srtUrl })
                            setSrtFileName(file.name)
                            // Store filename for later reference
                            if (selectedMovie) {
                              localStorage.setItem(`movie-srt-filename-${selectedMovie.id}`, file.name)
                            }
                          } catch (error) {
                            console.error('Error reading file:', error)
                            alert('Error reading subtitle file: ' + error.message)
                          }
                        }}
                        className="input-field"
                      />
                      {srtFileName && (
                        <p className="text-sm text-slate-600 dark:text-slate-400">
                          Selected: {srtFileName}
                        </p>
                      )}
                      {isLocalSrtContent(mediaConfig.srtUrl) && !srtFileName && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                          ✓ Subtitle file already uploaded
                        </p>
                      )}
                    </div>
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!mediaConfig.audioUrl) {
                        alert('Please upload an audio file')
                        return
                      }
                      if (!mediaConfig.srtUrl) {
                        alert('Please upload a subtitle file')
                        return
                      }
                      try {
                        console.log('Saving media config:', {
                          audioUrl: mediaConfig.audioUrl ? (mediaConfig.audioUrl.substring(0, 50) + '...') : 'empty',
                          srtUrl: mediaConfig.srtUrl ? (mediaConfig.srtUrl.substring(0, 50) + '...') : 'empty',
                          isLocalAudio: isLocalAudioContent(mediaConfig.audioUrl),
                          isLocalSrt: isLocalSrtContent(mediaConfig.srtUrl)
                        })
                        
                        // Validate that we have actual content, not just markers
                        if (isLocalAudioContent(mediaConfig.audioUrl)) {
                          const audioContent = getLocalAudioContent(mediaConfig.audioUrl)
                          if (!audioContent || audioContent === 'stored' || audioContent.trim() === '') {
                            alert('Error: Audio file content is missing. Please re-upload your audio file.')
                            return
                          }
                          console.log('Audio content length:', audioContent.length)
                        }
                        
                        if (isLocalSrtContent(mediaConfig.srtUrl)) {
                          const srtContent = getLocalSrtContent(mediaConfig.srtUrl)
                          if (!srtContent || srtContent === 'stored' || srtContent.trim() === '') {
                            alert('Error: Subtitle file content is missing. Please re-upload your subtitle file.')
                            return
                          }
                          console.log('SRT content length:', srtContent.length)
                        }
                        
                        await setMovieMediaConfigPersisted(selectedMovie.id, {
                          videoUrl: '', // No longer used
                          audioUrl: isLocalAudioContent(mediaConfig.audioUrl)
                            ? mediaConfig.audioUrl
                            : '',
                          srtUrl: isLocalSrtContent(mediaConfig.srtUrl) 
                            ? mediaConfig.srtUrl 
                            : ''
                        })
                        
                        // Save subtitle offset
                        const LS_PREFIX = 'movie-media-'
                        const raw = localStorage.getItem(LS_PREFIX + selectedMovie.id)
                        const cfg = raw ? JSON.parse(raw) : {}
                        cfg.subtitleOffset = mediaConfig.subtitleOffset || 0
                        localStorage.setItem(LS_PREFIX + selectedMovie.id, JSON.stringify(cfg))
                        alert('Media configuration saved successfully!')
                        setShowMediaSettings(false)
                      } catch (error) {
                        console.error('Error saving media config:', error)
                        if (error.name === 'QuotaExceededError') {
                          alert('Error: The audio file is too large to store locally. Please use a smaller file or provide an audio URL instead.')
                        } else {
                          alert('Error saving configuration: ' + error.message)
                        }
                      }
                    }}
                    className="btn-primary"
                  >
                    Save Configuration
                  </button>
                  <button
                    onClick={() => setShowMediaSettings(false)}
                    className="btn-secondary"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto pr-2">
              {loadingQuotes ? (
                <div className="text-center py-12">
                  <Loader2 className="animate-spin mx-auto mb-4" size={32} />
                  <p className="text-slate-600 dark:text-slate-400">Loading quotes...</p>
                </div>
              ) : movieQuotes.length === 0 ? (
                <div className="text-center py-12">
                  <Quote className="mx-auto mb-4 text-slate-400" size={48} />
                  <p className="text-slate-600 dark:text-slate-400">No quotes found for this movie.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {movieQuotes.map((quote, index) => {
                    const isPlaying = playingQuoteId === quote.id
                    const isPaused = isPlaying && isPausedState
                    
                    return (
                      <div
                        key={quote.id}
                        className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="text-lg text-slate-900 dark:text-slate-100 mb-2">
                              "{quote.quote}"
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-slate-600 dark:text-slate-400">
                              <span className="font-medium">{quote.character}</span>
                              <span>•</span>
                              <span>Significance: {quote.significance}/10</span>
                              {quote.start_time !== null && quote.end_time !== null && (
                                <>
                                  <span>•</span>
                                  <span className="text-xs">
                                    {formatTimestamp(quote.start_time)} - {formatTimestamp(quote.end_time)}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePlayQuote(quote)}
                              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                              title={isPlaying ? (isPaused ? 'Resume' : 'Pause') : 'Listen to quote'}
                            >
                              {isPaused ? (
                                <Play size={18} className="text-primary-600 dark:text-primary-400" />
                              ) : isPlaying ? (
                                <Pause size={18} className="text-primary-600 dark:text-primary-400" />
                              ) : (
                                <Volume2 size={18} className="text-slate-600 dark:text-slate-400" />
                              )}
                            </button>
                            <button
                              onClick={async () => {
                                try {
                                  stopSpeaking()
                                  stopOriginalAudio()
                                  console.log('Film button clicked, loading media config...')
                                  // Reload media config to ensure we have the latest
                                  const cfg = await getMovieMediaConfigPersisted(selectedMovie.id)
                                  console.log('Media config loaded:', { 
                                    hasAudio: !!cfg.audioUrl, 
                                    hasSrt: !!cfg.srtUrl,
                                    audioType: cfg.audioUrl ? (cfg.audioUrl.startsWith('data:local-audio:') ? 'local' : 'url') : 'none',
                                    srtType: cfg.srtUrl ? (cfg.srtUrl.startsWith('data:local-srt:') ? 'local' : 'url') : 'none'
                                  })
                                  
                                  const audioUrl = cfg.audioUrl
                                  const srtUrl = cfg.srtUrl
                                  
                                  if (!audioUrl || !srtUrl) {
                                    console.warn('Missing files:', { audioUrl: !!audioUrl, srtUrl: !!srtUrl })
                                    // If files are not set, prompt user to configure them
                                    const shouldConfigure = confirm('Audio file or subtitle file is not configured. Would you like to configure them now?')
                                    if (shouldConfigure) {
                                      setShowMediaSettings(true)
                                      return
                                    }
                                    return // Don't proceed if user cancels
                                  }
                                  
                                  const quoteText = quote.quote || ''
                                  console.log('=== QUOTE PLAYBACK DEBUG ===')
                                  console.log('Quote ID:', quote.id)
                                  console.log('Quote text:', quoteText)
                                  console.log('Quote text (first 100 chars):', quoteText.substring(0, 100))
                                  console.log('Character:', quote.character)
                                  console.log('Stored timestamps:', {
                                    start_time: quote.start_time,
                                    end_time: quote.end_time,
                                    start_formatted: quote.start_time ? formatTimestamp(quote.start_time) : 'N/A',
                                    end_formatted: quote.end_time ? formatTimestamp(quote.end_time) : 'N/A',
                                    duration_ms: quote.start_time && quote.end_time ? (quote.end_time - quote.start_time) : null,
                                    duration_sec: quote.start_time && quote.end_time ? ((quote.end_time - quote.start_time) / 1000).toFixed(2) : null
                                  })
                                  console.log('Media config:', {
                                    hasAudio: !!audioUrl,
                                    hasSrt: !!srtUrl,
                                    audioType: audioUrl ? (audioUrl.startsWith('data:local-audio:') ? 'local' : 'url') : 'none',
                                    srtType: srtUrl ? (srtUrl.startsWith('data:local-srt:') ? 'local' : 'url') : 'none',
                                    subtitleOffset: mediaConfig.subtitleOffset || 0
                                  })
                                  console.log('Using stored timestamps:', !!(quote.start_time && quote.end_time))
                                  console.log('==========================')
                                  
                                  const stopPlayback = await playOriginalQuoteSegment(quoteText, audioUrl, srtUrl, {
                                    subtitleOffset: mediaConfig.subtitleOffset || 0,
                                    startTime: quote.start_time || null,
                                    endTime: quote.end_time || null,
                                    onStart: () => {
                                      console.log('[QUOTE PLAYBACK] Started successfully')
                                      console.log('[QUOTE PLAYBACK] Playing quote:', quoteText.substring(0, 50))
                                      if (quote.start_time && quote.end_time) {
                                        console.log('[QUOTE PLAYBACK] Using stored timestamps:', formatTimestamp(quote.start_time), 'to', formatTimestamp(quote.end_time))
                                      }
                                      setPlayingQuoteId(quote.id)
                                      setIsPausedState(false)
                                    },
                                    onEnd: () => {
                                      console.log('[QUOTE PLAYBACK] Ended successfully')
                                      originalAudioStopRef.current = null
                                      setPlayingQuoteId(null)
                                      setIsPausedState(false)
                                    },
                                    onError: (e) => {
                                      console.error('[QUOTE PLAYBACK] Error occurred:', e)
                                      console.error('[QUOTE PLAYBACK] Error message:', e?.message)
                                      console.error('[QUOTE PLAYBACK] Error stack:', e?.stack)
                                      const errorMsg = e?.message || 'Could not play original clip'
                                      
                                      // If files are not configured, offer to open settings
                                      if (errorMsg.includes('not configured') || errorMsg.includes('not set up') || errorMsg.includes('missing')) {
                                        const shouldConfigure = confirm('Audio or subtitle file is not configured or missing. Would you like to configure them now?')
                                        if (shouldConfigure) {
                                          setShowMediaSettings(true)
                                        }
                                      } else {
                                        alert(`Error: ${errorMsg}\n\nPlease ensure:\n- You have uploaded both an audio file and a subtitle file\n- The subtitle file is a valid SRT format\n- The quote text matches the subtitle content`)
                                      }
                                      originalAudioStopRef.current = null
                                      setPlayingQuoteId(null)
                                      setIsPausedState(false)
                                    }
                                  })
                                  if (typeof stopPlayback === 'function') {
                                    originalAudioStopRef.current = stopPlayback
                                  }
                                } catch (e) {
                                  console.error('Error in Film button handler:', e)
                                  alert(`Error: ${e.message || 'Unknown error occurred. Please check the console for details.'}`)
                                }
                              }}
                              className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                              title="Play original clip (video audio)"
                            >
                              <Film size={18} className="text-slate-600 dark:text-slate-400" />
                            </button>
                            {isPlaying && (
                              <button
                                onClick={handleStopQuote}
                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                title="Stop"
                              >
                                <VolumeX size={18} className="text-slate-600 dark:text-slate-400" />
                              </button>
                            )}
                            <button
                              onClick={() => handleDeleteQuote(quote.id)}
                              className="p-2 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                              title="Delete quote"
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
            </div>
          </div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="card max-w-2xl w-full">
            <h2 className="text-2xl font-bold mb-6">Add New Movie</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Movie Title
                </label>
                <input
                  type="text"
                  value={movieTitle}
                  onChange={(e) => setMovieTitle(e.target.value)}
                  className="input-field"
                  placeholder="The Dark Knight"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                  Add Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setAddMethod('url')}
                    className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                      addMethod === 'url'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <LinkIcon className="mx-auto mb-1" size={20} />
                    <span className="text-sm">From URL</span>
                  </button>
                  <button
                    onClick={() => setAddMethod('upload')}
                    className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                      addMethod === 'upload'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <Upload className="mx-auto mb-1" size={20} />
                    <span className="text-sm">Script File</span>
                  </button>
                  <button
                    onClick={() => setAddMethod('subtitle')}
                    className={`px-4 py-2 rounded-lg border-2 transition-colors ${
                      addMethod === 'subtitle'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <Film className="mx-auto mb-1" size={20} />
                    <span className="text-sm">Subtitle File</span>
                  </button>
                </div>
              </div>

              {addMethod === 'url' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Script URL
                  </label>
                  <input
                    type="url"
                    value={scriptUrl}
                    onChange={(e) => setScriptUrl(e.target.value)}
                    className="input-field"
                    placeholder="https://imsdb.com/scripts/Dark-Knight-Rises,-The.html"
                  />
                </div>
              ) : addMethod === 'upload' ? (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Script File
                  </label>
                  <input
                    type="file"
                    accept=".txt,.html"
                    onChange={(e) => setScriptFile(e.target.files[0])}
                    className="input-field"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Subtitle File (SRT)
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Upload an SRT subtitle file. The app will extract meaningful quotes with timestamps.
                  </p>
                  <input
                    type="file"
                    accept=".srt,.txt"
                    onChange={(e) => setSubtitleFile(e.target.files[0])}
                    className="input-field"
                  />
                </div>
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setMovieTitle('')
                    setScriptUrl('')
                    setScriptFile(null)
                    setSubtitleFile(null)
                    setProcessingProgress(null)
                  }}
                  className="btn-secondary flex-1"
                  disabled={processing}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMovie}
                  disabled={processing}
                  className="btn-primary flex-1 flex items-center justify-center space-x-2"
                >
                  {processing && <Loader2 className="animate-spin" size={18} />}
                  <span>{processing ? 'Processing...' : 'Add Movie'}</span>
                </button>
              </div>

              {processingProgress && (
                <div className="mt-4 p-4 bg-slate-50 dark:bg-slate-700 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {processingProgress.message}
                    </span>
                    {processingProgress.total > 0 && (
                      <span className="text-sm text-slate-600 dark:text-slate-400">
                        {processingProgress.current} / {processingProgress.total}
                      </span>
                    )}
                  </div>
                  {processingProgress.total > 0 && (
                    <div className="w-full bg-slate-200 dark:bg-slate-600 rounded-full h-2">
                      <div
                        className="bg-primary-500 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${(processingProgress.current / processingProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

