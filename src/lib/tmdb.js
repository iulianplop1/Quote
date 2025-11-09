// TMDB API for movie posters
const TMDB_API_KEY = import.meta.env.VITE_TMDB_API_KEY
const TMDB_BASE_URL = 'https://api.themoviedb.org/3'

export async function getMoviePoster(movieTitle) {
  if (!TMDB_API_KEY) {
    // Return placeholder if no API key
    return 'https://via.placeholder.com/300x450?text=' + encodeURIComponent(movieTitle)
  }

  try {
    // Search for movie
    const searchUrl = `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(movieTitle)}`
    const searchResponse = await fetch(searchUrl)
    const searchData = await searchResponse.json()
    
    if (searchData.results && searchData.results.length > 0) {
      const posterPath = searchData.results[0].poster_path
      if (posterPath) {
        return `https://image.tmdb.org/t/p/w500${posterPath}`
      }
    }
    
    // Fallback to placeholder
    return 'https://via.placeholder.com/300x450?text=' + encodeURIComponent(movieTitle)
  } catch (error) {
    console.error('Error fetching movie poster:', error)
    return 'https://via.placeholder.com/300x450?text=' + encodeURIComponent(movieTitle)
  }
}

