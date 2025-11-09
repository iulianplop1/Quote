# Quote - Daily Movie Quotes App

A beautiful, minimalistic web app that delivers daily movie quotes from your favorite scripts. Built with React, Supabase, and Gemini AI.

## Features

- 🎬 **Script Management**: Upload movie scripts or fetch from URLs (e.g., IMSDB)
- 🤖 **AI-Powered Parsing**: Uses Gemini 2.5 Flash to intelligently parse scripts and extract quotes
- 📅 **Scheduled Quotes**: Automatic daily quote generation at your preferred time
- 🎯 **Smart Selection**: Only shows high-significance quotes (score ≥ 7) when possible
- 🔄 **No Repeats**: Tracks all shown quotes to ensure you never see the same one twice
- 🎨 **Beautiful UI**: Minimalistic, intuitive design with light/dark mode
- 🎭 **Context Feature**: See the scene context around any quote
- 🔍 **Thematic Search**: Discover quotes by theme across your entire library
- 🎪 **Gamification**: "Guess the Quote" mode to test your movie knowledge
- 🖼️ **Movie Posters**: Automatic poster fetching from TMDB

## Tech Stack

- **Frontend**: React + Vite
- **Styling**: Tailwind CSS
- **Backend**: Supabase (Auth + Database)
- **AI**: Google Gemini 2.5 Flash API
- **Hosting**: GitHub Pages

## Setup Instructions

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd Quote
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to SQL Editor and run the SQL from `supabase/schema.sql`
3. Get your project URL and anon key from Settings > API

### 4. Set Up Environment Variables

1. Copy `.env.example` to `.env`
2. Fill in your credentials:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_TMDB_API_KEY=your_tmdb_api_key  # Optional
```

### 5. Deploy Supabase Edge Function

1. Install Supabase CLI: `npm install -g supabase`
2. Login: `supabase login`
3. Link your project: `supabase link --project-ref your-project-ref`
4. Deploy the function:

```bash
supabase functions deploy generate-daily-quotes
```

5. Set up a cron job or use Supabase's pg_cron extension to call this function daily

### 6. Set Up Scheduled Quote Generation

You have two options:

**Option A: Using pg_cron (Recommended)**

Run this SQL in your Supabase SQL Editor:

```sql
-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the function to run every hour
SELECT cron.schedule(
  'generate-daily-quotes',
  '0 * * * *', -- Every hour at minute 0
  $$
  SELECT
    net.http_post(
      url := 'https://your-project-ref.supabase.co/functions/v1/generate-daily-quotes',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**Option B: External Cron Service**

Use a service like [cron-job.org](https://cron-job.org) to call your Edge Function URL every hour.

### 7. Run Development Server

```bash
npm run dev
```

### 8. Build for Production

```bash
npm run build
```

### 9. Deploy to GitHub Pages

1. Update `vite.config.js` with your repository name (if different from "Quote")
2. Install GitHub Pages deploy plugin or use GitHub Actions
3. Push to your repository
4. Enable GitHub Pages in repository settings

## Project Structure

```
Quote/
├── src/
│   ├── components/       # React components
│   │   ├── Dashboard.jsx # Main quote display
│   │   ├── Library.jsx   # Movie management
│   │   ├── Discover.jsx  # Thematic search
│   │   ├── Settings.jsx  # User settings
│   │   ├── Login.jsx     # Authentication
│   │   └── Layout.jsx    # App layout
│   ├── lib/              # Utilities
│   │   ├── supabase.js   # Supabase client
│   │   ├── gemini.js     # Gemini API functions
│   │   ├── tmdb.js       # TMDB API
│   │   └── scriptFetcher.js # Script fetching
│   ├── App.jsx           # Main app component
│   ├── main.jsx          # Entry point
│   └── index.css         # Global styles
├── supabase/
│   ├── functions/        # Edge Functions
│   │   └── generate-daily-quotes/
│   └── schema.sql        # Database schema
├── package.json
├── vite.config.js
└── README.md
```

## Usage

1. **Sign Up/Login**: Create an account or sign in
2. **Add Movies**: Go to Library and add movies by URL or file upload
3. **Set Schedule**: Configure your preferred quote time in Settings
4. **View Quotes**: Check your Dashboard daily for new quotes
5. **Explore**: Use Discover to search quotes by theme
6. **Context**: Click "Show Context" on any quote to see the scene

## API Keys

- **Gemini API**: Get from [Google AI Studio](https://makersuite.google.com/app/apikey)
- **TMDB API**: Get from [The Movie Database](https://www.themoviedb.org/settings/api) (optional)
- **Supabase**: Get from your Supabase project settings

## License

MIT

## Contributing

Feel free to submit issues and enhancement requests!

