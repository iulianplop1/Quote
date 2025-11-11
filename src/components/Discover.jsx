import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Search, Sparkles, Loader2 } from 'lucide-react'
import { searchThemes } from '../lib/gemini'

export default function Discover() {
  const [theme, setTheme] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [movies, setMovies] = useState([])

  useEffect(() => {
    loadMovies()
  }, [])

  const loadMovies = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data } = await supabase
        .from('movies')
        .select('id, title, script_text')
        .eq('user_id', user.id)

      setMovies(data || [])
    } catch (error) {
      console.error('Error loading movies:', error)
    }
  }

  const handleSearch = async () => {
    if (!theme.trim() || movies.length === 0) return

    setLoading(true)
    try {
      // Transform movies to match the format expected by searchThemes
      const scripts = movies.map(m => ({
        title: m.title,
        text: m.script_text || ''
      }))
      const quotes = await searchThemes(theme, scripts)
      setResults(quotes)
    } catch (error) {
      console.error('Error searching themes:', error)
      alert('Error searching: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
          Discover
        </h1>
        <p className="text-slate-600 dark:text-slate-400">
          Search your library by theme or topic
        </p>
      </div>

      <div className="card">
        <div className="flex gap-4">
          <div className="flex-1">
            <input
              type="text"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
              className="input-field"
              placeholder="e.g., justice, love, betrayal, courage..."
            />
          </div>
          <button
            onClick={handleSearch}
            disabled={loading || !theme.trim()}
            className="btn-primary flex items-center space-x-2"
          >
            {loading ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <Search size={18} />
            )}
            <span>Search</span>
          </button>
        </div>
      </div>

      {results.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Results for "{theme}"
          </h2>
          <div className="space-y-4">
            {results.map((result, index) => (
              <div key={index} className="card">
                <div className="text-lg text-slate-900 dark:text-slate-100 mb-3">
                  "{result.quote}"
                </div>
                <div className="flex items-center space-x-4 text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">{result.character}</span>
                  <span>•</span>
                  <span>{result.movie}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 && !loading && theme && (
        <div className="card text-center py-12">
          <Sparkles className="mx-auto mb-4 text-slate-400" size={48} />
          <p className="text-slate-600 dark:text-slate-400">
            No results found. Try a different theme or add more movies to your library.
          </p>
        </div>
      )}
    </div>
  )
}

