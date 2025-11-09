# Quick Setup Guide

## Prerequisites

1. Node.js 18+ installed
2. A Supabase account (free tier works)
3. A Google Gemini API key
4. (Optional) A TMDB API key for movie posters

## Step-by-Step Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish initializing
3. Go to **SQL Editor** in your Supabase dashboard
4. Copy and paste the entire contents of `supabase/schema.sql`
5. Click **Run** to execute the SQL
6. Go to **Settings > API** and copy:
   - Project URL
   - `anon` `public` key

### 3. Get API Keys

**Gemini API:**
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the key

**TMDB API (Optional):**
1. Go to [The Movie Database](https://www.themoviedb.org)
2. Create an account
3. Go to Settings > API
4. Request an API key (free)
5. Copy the key

### 4. Configure Environment Variables

1. Copy `env.example` to `.env`:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` and fill in your values:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your_anon_key_here
   VITE_GEMINI_API_KEY=your_gemini_key_here
   VITE_TMDB_API_KEY=your_tmdb_key_here
   ```

### 5. Deploy Supabase Edge Function

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Login to Supabase:
   ```bash
   supabase login
   ```

3. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```
   (Find your project ref in Supabase dashboard URL)

4. Deploy the function:
   ```bash
   supabase functions deploy generate-daily-quotes
   ```

5. Get your function URL from the Supabase dashboard (Functions section)

### 6. Set Up Scheduled Quotes

**Option A: Using pg_cron (Recommended)**

Run this in Supabase SQL Editor (replace with your values):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'generate-daily-quotes',
  '0 * * * *', -- Every hour
  $$
  SELECT
    net.http_post(
      url := 'https://YOUR-PROJECT-REF.supabase.co/functions/v1/generate-daily-quotes',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb,
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
```

**Option B: External Cron Service**

1. Go to [cron-job.org](https://cron-job.org) or similar
2. Create a new cron job
3. Set URL to: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/generate-daily-quotes`
4. Add header: `Authorization: Bearer YOUR_SERVICE_ROLE_KEY`
5. Set to run every hour

### 7. Run Locally

```bash
npm run dev
```

Visit `http://localhost:5173`

### 8. Deploy to GitHub Pages

1. Push your code to GitHub
2. Go to repository Settings > Pages
3. Set source to GitHub Actions
4. The workflow in `.github/workflows/deploy.yml` will automatically deploy
5. Make sure to add your environment variables as GitHub Secrets:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GEMINI_API_KEY`
   - `VITE_TMDB_API_KEY`

## Troubleshooting

**"Missing Supabase environment variables"**
- Make sure your `.env` file exists and has all required variables
- Restart your dev server after changing `.env`

**"No quotes found"**
- Make sure you've added movies to your library
- Check that the script parsing completed successfully
- Verify quotes were inserted into the database

**Edge Function not working**
- Check that the function is deployed
- Verify your service role key is correct
- Check Supabase function logs for errors

**Script parsing fails**
- Make sure your Gemini API key is valid
- Check that the script URL is accessible
- Some scripts may be too large - try a shorter script first

## Next Steps

1. Add your first movie script
2. Set your preferred quote time in Settings
3. Check back tomorrow for your first daily quote!

