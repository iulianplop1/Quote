import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'
import { Clock, Film, User, Eye, EyeOff, Sparkles } from 'lucide-react'
import { getQuoteContext } from '../lib/gemini'
import CharacterAnalysis from './CharacterAnalysis'

export default function Dashboard() {
  const [todayQuote, setTodayQuote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showContext, setShowContext] = useState(false)
  const [context, setContext] = useState('')
  const [loadingContext, setLoadingContext] = useState(false)
  const [hideInfo, setHideInfo] = useState(false)
  const [scheduleTime, setScheduleTime] = useState('08:00')
  const [showCharacterAnalysis, setShowCharacterAnalysis] = useState(false)

  useEffect(() => {
    loadTodayQuote()
    loadScheduleTime()
  }, [])

  const loadScheduleTime = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('user_settings')
      .select('schedule_time')
      .eq('user_id', user.id)
      .single()
    
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
        .single()

      if (error && error.code !== 'PGRST116') {
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
      const { data: movies } = await supabase
        .from('movies')
        .select('id')
        .eq('user_id', user.id)

      if (!movies || movies.length === 0) {
        setLoading(false)
        return
      }

      // Get all shown quote IDs
      const { data: shownQuotes } = await supabase
        .from('daily_quotes')
        .select('quote_id')
        .eq('user_id', user.id)

      const shownIds = shownQuotes?.map(q => q.quote_id) || []

      // Get a random quote that hasn't been shown, with significance >= 7
      const { data: quotes } = await supabase
        .from('quotes')
        .select('*')
        .in('movie_id', movies.map(m => m.id))
        .gte('significance', 7)
        .not('id', 'in', `(${shownIds.length > 0 ? shownIds.join(',') : '0'})`)
        .limit(1)

      if (!quotes || quotes.length === 0) {
        // If no high-significance quotes, get any unshown quote
        const { data: fallbackQuotes } = await supabase
          .from('quotes')
          .select('*')
          .in('movie_id', movies.map(m => m.id))
          .not('id', 'in', `(${shownIds.length > 0 ? shownIds.join(',') : '0'})`)
          .limit(1)

        if (fallbackQuotes && fallbackQuotes.length > 0) {
          await saveDailyQuote(fallbackQuotes[0].id)
        }
        return
      }

      await saveDailyQuote(quotes[0].id)
    } catch (error) {
      console.error('Error generating quote:', error)
    }
  }

  const saveDailyQuote = async (quoteId) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const today = format(new Date(), 'yyyy-MM-dd')

      const { data: quote } = await supabase
        .from('quotes')
        .select(`
          *,
          movies (
            id,
            title,
            poster_url
          )
        `)
        .eq('id', quoteId)
        .single()

      const { data: dailyQuote } = await supabase
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

      setTodayQuote(dailyQuote)
    } catch (error) {
      console.error('Error saving daily quote:', error)
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
        <a href="/library" className="btn-primary inline-block">
          Go to Library
        </a>
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
            </div>

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

