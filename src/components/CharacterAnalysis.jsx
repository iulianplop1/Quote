import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { analyzeCharacter } from '../lib/gemini'
import { X, Loader2, User } from 'lucide-react'

export default function CharacterAnalysis({ characterName, movieId, onClose }) {
  const [analysis, setAnalysis] = useState('')
  const [loading, setLoading] = useState(true)
  const [movie, setMovie] = useState(null)

  useEffect(() => {
    if (characterName && movieId) {
      loadAnalysis()
    }
  }, [characterName, movieId])

  const loadAnalysis = async () => {
    try {
      // Get movie info
      const { data: movieData } = await supabase
        .from('movies')
        .select('title, script_text')
        .eq('id', movieId)
        .single()

      setMovie(movieData)

      if (movieData?.script_text) {
        const analysisText = await analyzeCharacter(
          characterName,
          movieData.title,
          movieData.script_text
        )
        setAnalysis(analysisText)
      }
    } catch (error) {
      console.error('Error loading character analysis:', error)
      setAnalysis('Error loading analysis. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="card max-w-2xl w-full max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary-100 dark:bg-primary-900 rounded-lg">
              <User className="text-primary-600 dark:text-primary-400" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {characterName}
              </h2>
              {movie && (
                <p className="text-sm text-slate-600 dark:text-slate-400">{movie.title}</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-primary-600" size={32} />
          </div>
        ) : (
          <div className="prose dark:prose-invert max-w-none">
            <p className="text-slate-700 dark:text-slate-300 leading-relaxed">{analysis}</p>
          </div>
        )}
      </div>
    </div>
  )
}

