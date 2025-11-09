// Supabase Edge Function to generate daily quotes for all users
// This should be scheduled using pg_cron or a similar service

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

    // Get all users with their schedule times
    const { data: users, error: usersError } = await supabaseClient
      .from('user_settings')
      .select('user_id, schedule_time')

    if (usersError) throw usersError

    // Get current time
    const now = new Date()
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`

    // Filter users whose schedule time matches (or is within the last hour)
    const targetUsers = users?.filter((user) => {
      if (!user.schedule_time) return false
      const [scheduleHour, scheduleMinute] = user.schedule_time.split(':').map(Number)
      const scheduleTime = scheduleHour * 60 + scheduleMinute
      const currentTimeMinutes = now.getHours() * 60 + now.getMinutes()
      
      // Generate quote if it's the scheduled time (within 1 hour window)
      return Math.abs(currentTimeMinutes - scheduleTime) < 60
    }) || []

    const results = []

    for (const user of targetUsers) {
      // Check if quote already exists for today
      const { data: existingQuote } = await supabaseClient
        .from('daily_quotes')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('date', today)
        .single()

      if (existingQuote) {
        results.push({ user_id: user.user_id, status: 'already_exists' })
        continue
      }

      // Get all user's movies
      const { data: movies } = await supabaseClient
        .from('movies')
        .select('id')
        .eq('user_id', user.user_id)

      if (!movies || movies.length === 0) {
        results.push({ user_id: user.user_id, status: 'no_movies' })
        continue
      }

      // Get all shown quote IDs
      const { data: shownQuotes } = await supabaseClient
        .from('daily_quotes')
        .select('quote_id')
        .eq('user_id', user.user_id)

      const shownIds = shownQuotes?.map((q) => q.quote_id) || []

      // Get a random quote that hasn't been shown, with significance >= 7
      let { data: quotes } = await supabaseClient
        .from('quotes')
        .select('*')
        .in('movie_id', movies.map((m) => m.id))
        .gte('significance', 7)
        .limit(100)

      if (!quotes || quotes.length === 0) {
        // Fallback to any quote
        const { data: fallbackQuotes } = await supabaseClient
          .from('quotes')
          .select('*')
          .in('movie_id', movies.map((m) => m.id))
          .limit(100)

        quotes = fallbackQuotes || []
      }

      // Filter out already shown quotes
      const availableQuotes = quotes.filter((q) => !shownIds.includes(q.id))

      if (availableQuotes.length === 0) {
        results.push({ user_id: user.user_id, status: 'no_available_quotes' })
        continue
      }

      // Pick a random quote
      const randomQuote = availableQuotes[Math.floor(Math.random() * availableQuotes.length)]

      // Save daily quote
      const { error: insertError } = await supabaseClient
        .from('daily_quotes')
        .insert({
          user_id: user.user_id,
          quote_id: randomQuote.id,
          date: today,
        })

      if (insertError) {
        results.push({ user_id: user.user_id, status: 'error', error: insertError.message })
      } else {
        results.push({ user_id: user.user_id, status: 'success', quote_id: randomQuote.id })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        current_time: currentTime,
        users_processed: results.length,
        results,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

