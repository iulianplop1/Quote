import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Plus, Trash2, Upload, Link as LinkIcon, Loader2 } from 'lucide-react'
import { parseScript } from '../lib/gemini'
import { fetchScriptFromUrl } from '../lib/scriptFetcher'
import { getMoviePoster } from '../lib/tmdb'

export default function Library() {
  const [movies, setMovies] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addMethod, setAddMethod] = useState('url') // 'url' or 'upload'
  const [movieTitle, setMovieTitle] = useState('')
  const [scriptUrl, setScriptUrl] = useState('')
  const [scriptFile, setScriptFile] = useState(null)
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    loadMovies()
  }, [])

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

      // Parse script with Gemini
      const quotes = await parseScript(scriptText, movieTitle)

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

      // Insert quotes
      const quotesToInsert = quotes.map(q => ({
        movie_id: movie.id,
        character: q.character,
        quote: q.quote,
        significance: q.significance || 5,
      }))

      const { error: quotesError } = await supabase
        .from('quotes')
        .insert(quotesToInsert)

      if (quotesError) throw quotesError

      // Reset form and reload
      setMovieTitle('')
      setScriptUrl('')
      setScriptFile(null)
      setShowAddModal(false)
      loadMovies()
    } catch (error) {
      console.error('Error adding movie:', error)
      alert('Error adding movie: ' + error.message)
    } finally {
      setProcessing(false)
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
      
      loadMovies()
    } catch (error) {
      console.error('Error deleting movie:', error)
      alert('Error deleting movie: ' + error.message)
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
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Added {new Date(movie.created_at).toLocaleDateString()}
              </p>
            </div>
          ))}
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
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

