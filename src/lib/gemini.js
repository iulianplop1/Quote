import { GoogleGenerativeAI } from '@google/generative-ai'

const apiKey = import.meta.env.VITE_GEMINI_API_KEY

if (!apiKey) {
  throw new Error('Missing Gemini API key')
}

const genAI = new GoogleGenerativeAI(apiKey)
// Using gemini-2.0-flash-exp (latest flash model) - can be changed to gemini-1.5-flash if needed
export const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' })

// Parse script and extract quotes with significance scores
export async function parseScript(scriptText, movieTitle) {
  const prompt = `You are a movie script parser. Parse this movie script and extract every line of dialogue. Return a JSON array in this exact format:

[
  {
    "character": "CHARACTER_NAME",
    "quote": "The dialogue line.",
    "significance": 7
  },
  ...
]

Rules:
1. Extract ALL dialogue lines, not just important ones
2. For "significance", score each quote from 1-10 based on how memorable, thematic, or impactful it is to the story
3. Remove stage directions and action lines - only include dialogue
4. Character names should be clean (no extra formatting)
5. Return ONLY valid JSON, no markdown or extra text
6. If a character name is unclear, use "UNKNOWN"

Script for "${movieTitle}":
${scriptText}`

  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()
    
    // Clean the response to extract JSON
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }
    
    const quotes = JSON.parse(jsonMatch[0])
    return quotes
  } catch (error) {
    console.error('Error parsing script:', error)
    throw error
  }
}

// Get quote context
export async function getQuoteContext(quote, scriptText) {
  const prompt = `Find this quote in the script: "${quote}"

Return the 2-3 lines of dialogue or action that came immediately before this quote. Format as a simple text response, no JSON.`

  try {
    const result = await model.generateContent(prompt + '\n\nScript:\n' + scriptText)
    const response = await result.response
    return response.text()
  } catch (error) {
    console.error('Error getting context:', error)
    throw error
  }
}

// Thematic search
export async function searchThemes(theme, scripts) {
  const prompt = `Search through these movie scripts and find up to 5 quotes related to the theme of "${theme}".

Return a JSON array in this format:
[
  {
    "character": "CHARACTER_NAME",
    "quote": "The quote",
    "movie": "Movie Title"
  },
  ...
]

Scripts:
${scripts.map(s => `Movie: ${s.title}\n${s.text}`).join('\n\n---\n\n')}`

  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    const text = response.text()
    
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('No JSON found in response')
    }
    
    return JSON.parse(jsonMatch[0])
  } catch (error) {
    console.error('Error searching themes:', error)
    throw error
  }
}

// Character analysis
export async function analyzeCharacter(characterName, movieTitle, scriptText) {
  const prompt = `Analyze all of ${characterName}'s lines from "${movieTitle}" and provide a brief summary (2-3 sentences) of their personality, motivations, and role in the story.

Script:
${scriptText}`

  try {
    const result = await model.generateContent(prompt)
    const response = await result.response
    return response.text()
  } catch (error) {
    console.error('Error analyzing character:', error)
    throw error
  }
}

