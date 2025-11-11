import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase URL:', supabaseUrl)
  console.error('Supabase Key:', supabaseAnonKey ? 'Present' : 'Missing')
  throw new Error('Missing Supabase environment variables. Please check your .env file and restart the dev server.')
}

if (supabaseUrl.includes('supabase.com/dashboard')) {
  throw new Error(
    'Invalid Supabase URL. Use the project API URL (https://<project-ref>.supabase.co), not the dashboard URL.'
  )
}

// Log in development to help debug
if (import.meta.env.DEV) {
  console.log('Connecting to Supabase:', supabaseUrl)
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  db: {
    schema: 'public',
  },
})

