-- Supabase Database Schema for Quote App

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Movies table
CREATE TABLE IF NOT EXISTS movies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  script_text TEXT NOT NULL,
  poster_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  character TEXT NOT NULL,
  quote TEXT NOT NULL,
  significance INTEGER DEFAULT 5 CHECK (significance >= 1 AND significance <= 10),
  start_time INTEGER, -- Start time in milliseconds from subtitle file
  end_time INTEGER, -- End time in milliseconds from subtitle file
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily quotes table (tracks which quotes were shown on which days)
CREATE TABLE IF NOT EXISTS daily_quotes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- User settings table
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  schedule_time TIME DEFAULT '08:00:00',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_movies_user_id ON movies(user_id);
CREATE INDEX IF NOT EXISTS idx_quotes_movie_id ON quotes(movie_id);
CREATE INDEX IF NOT EXISTS idx_quotes_significance ON quotes(significance);
CREATE INDEX IF NOT EXISTS idx_daily_quotes_user_date ON daily_quotes(user_id, date);
CREATE INDEX IF NOT EXISTS idx_daily_quotes_quote_id ON daily_quotes(quote_id);

-- Enable Row Level Security (RLS)
ALTER TABLE movies ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for movies
DROP POLICY IF EXISTS "Users can view their own movies" ON movies;
CREATE POLICY "Users can view their own movies"
  ON movies FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own movies" ON movies;
CREATE POLICY "Users can insert their own movies"
  ON movies FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own movies" ON movies;
CREATE POLICY "Users can update their own movies"
  ON movies FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own movies" ON movies;
CREATE POLICY "Users can delete their own movies"
  ON movies FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for quotes
DROP POLICY IF EXISTS "Users can view quotes from their movies" ON quotes;
CREATE POLICY "Users can view quotes from their movies"
  ON quotes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM movies
      WHERE movies.id = quotes.movie_id
      AND movies.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert quotes for their movies" ON quotes;
CREATE POLICY "Users can insert quotes for their movies"
  ON quotes FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM movies
      WHERE movies.id = quotes.movie_id
      AND movies.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update quotes from their movies" ON quotes;
CREATE POLICY "Users can update quotes from their movies"
  ON quotes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM movies
      WHERE movies.id = quotes.movie_id
      AND movies.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete quotes from their movies" ON quotes;
CREATE POLICY "Users can delete quotes from their movies"
  ON quotes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM movies
      WHERE movies.id = quotes.movie_id
      AND movies.user_id = auth.uid()
    )
  );

-- RLS Policies for daily_quotes
DROP POLICY IF EXISTS "Users can view their own daily quotes" ON daily_quotes;
CREATE POLICY "Users can view their own daily quotes"
  ON daily_quotes FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own daily quotes" ON daily_quotes;
CREATE POLICY "Users can insert their own daily quotes"
  ON daily_quotes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for user_settings
DROP POLICY IF EXISTS "Users can view their own settings" ON user_settings;
CREATE POLICY "Users can view their own settings"
  ON user_settings FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own settings" ON user_settings;
CREATE POLICY "Users can insert their own settings"
  ON user_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own settings" ON user_settings;
CREATE POLICY "Users can update their own settings"
  ON user_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_movies_updated_at ON movies;
CREATE TRIGGER update_movies_updated_at BEFORE UPDATE ON movies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_user_settings_updated_at ON user_settings;
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Routines table
CREATE TABLE IF NOT EXISTS routines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  song_audio_url TEXT, -- URL or local storage reference for the song
  song_audio_filename TEXT,
  scheduled_time TIME NOT NULL,
  enabled BOOLEAN DEFAULT true,
  days_of_week INTEGER[] DEFAULT ARRAY[1,2,3,4,5,6,7], -- 1=Monday, 7=Sunday
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Routine movies junction table (many-to-many)
CREATE TABLE IF NOT EXISTS routine_movies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  routine_id UUID NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  movie_id UUID NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(routine_id, movie_id)
);

-- Create indexes for routines
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
CREATE INDEX IF NOT EXISTS idx_routines_enabled ON routines(enabled);
CREATE INDEX IF NOT EXISTS idx_routine_movies_routine_id ON routine_movies(routine_id);
CREATE INDEX IF NOT EXISTS idx_routine_movies_movie_id ON routine_movies(movie_id);

-- Enable RLS for routines
ALTER TABLE routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_movies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for routines
DROP POLICY IF EXISTS "Users can view their own routines" ON routines;
CREATE POLICY "Users can view their own routines"
  ON routines FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own routines" ON routines;
CREATE POLICY "Users can insert their own routines"
  ON routines FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own routines" ON routines;
CREATE POLICY "Users can update their own routines"
  ON routines FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own routines" ON routines;
CREATE POLICY "Users can delete their own routines"
  ON routines FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for routine_movies
DROP POLICY IF EXISTS "Users can view routine movies from their routines" ON routine_movies;
CREATE POLICY "Users can view routine movies from their routines"
  ON routine_movies FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_movies.routine_id
      AND routines.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert routine movies for their routines" ON routine_movies;
CREATE POLICY "Users can insert routine movies for their routines"
  ON routine_movies FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_movies.routine_id
      AND routines.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can delete routine movies from their routines" ON routine_movies;
CREATE POLICY "Users can delete routine movies from their routines"
  ON routine_movies FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM routines
      WHERE routines.id = routine_movies.routine_id
      AND routines.user_id = auth.uid()
    )
  );

-- Trigger for updated_at on routines
DROP TRIGGER IF EXISTS update_routines_updated_at ON routines;
CREATE TRIGGER update_routines_updated_at BEFORE UPDATE ON routines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

