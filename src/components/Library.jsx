import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Upload, Link as LinkIcon, Loader2, Quote, X, Volume2, VolumeX, Pause, Play, Settings, PlayCircle } from 'lucide-react'
import { parseScript } from '../lib/gemini'
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

export default function Library() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMethod, setAddMethod] = useState('url') // 'url' or 'upload'
  const [movieTitle, setMovieTitle] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [scriptFile, setScriptFile] = useState(null)
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

  const handleAddMovie = async () => {
    if (!movieTitle.trim()) {
      alert('Please enter a movie title')
      return
    }

    setProcessing(true)
    try {
      let scriptText = ''

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
      const quotes = await parseScript(scriptText, movieTitle, (current, total) => {
        setProcessingProgress({ current, total, message: `Processing script part ${current} of ${total}...` })
      })
      
      if (!quotes || quotes.length === 0) {
        throw new Error('No quotes were extracted from the script. Please check the script format.')
      }
      
      console.log(`Extracted ${quotes.length} quotes from script`)
      setProcessingProgress({ current: 1, total: 1, message: `Saving ${quotes.length} quotes to database...` })

      // Get movie poster
      const posterUrl = await getMoviePoster(movieTitle)

      // Save to Supabase
      const { data: { user } } = await supabase.auth.getUser()

      // Insert movie
      const { data: movie, error: movieError } = await supabase
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

      // Filter quotes by significance - only keep high-quality quotes (significance >= 7)
      // This ensures we only store memorable, meaningful quotes
      const highQualityQuotes = quotes.filter(q => {
        const significance = q.significance || 5
        const quoteText = (q.quote || '').trim()
        // Only keep quotes with significance >= 7 and meaningful content
        return significance >= 7 && quoteText.length > 10 && quoteText.length < 500
      })

      let quotesToSave = []
      if (highQualityQuotes.length === 0) {
        console.warn('No high-quality quotes found (significance >= 7). All quotes:', quotes.length)
        // If no high-quality quotes, keep the top 20% by significance as fallback
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

      // Insert quotes in batches to avoid timeout issues
      const BATCH_SIZE = 100
      const quotesToInsert = quotesToSave.map(q => ({
        movie_id: movie.id,
        character: q.character || 'UNKNOWN',
        quote: q.quote || '',
        significance: q.significance || 5,
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

      // Reset form and reload
      setMovieTitle('')
      setScriptUrl('')
      setScriptFile(null)
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

  const handleViewQuotes = async (movie) => {
    // Stop any currently playing quote
    stopSpeaking()
    setPlayingQuoteId(null)
    setIsPausedState(false)
    
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
                  onClick={() => {
                    stopSpeaking()
                    stopQueue()
                    setSelectedMovie(null)
                    setMovieQuotes([])
                    setPlayingQuoteId(null)
                    setIsPausedState(false)
                    setIsPlayingAll(false)
                    setCurrentQueueIndex(0)
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
                            {isPlaying && (
                              <button
                                onClick={handleStopQuote}
                                className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                                title="Stop"
                              >
                                <VolumeX size={18} className="text-slate-600 dark:text-slate-400" />
                              </button>
                            )}
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
                <div className="flex space-x-4">
                  <button
                    onClick={() => setAddMethod('url')}
                    className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
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
                    className={`flex-1 px-4 py-2 rounded-lg border-2 transition-colors ${
                      addMethod === 'upload'
                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                        : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <Upload className="mx-auto mb-1" size={20} />
                    <span className="text-sm">Upload File</span>
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
              ) : (
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
              )}

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={() => {
                    setShowAddModal(false)
                    setMovieTitle('')
                    setScriptUrl('')
                    setScriptFile(null)
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

