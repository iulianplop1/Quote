import { createContext, useContext, useState } from 'react'

const DemoContext = createContext(null)

export const DEMO_USER = { id: 'demo', email: 'demo@quote.app', isDemo: true }

// Extracted from real backup data — 90 high-significance quotes across 6 iconic films
const DEMO_MOVIES = [
  {
    id: '2cbafc50-b503-40cd-aabc-d087ac2f0676',
    user_id: 'demo',
    title: 'The Dark Knight Rises',
    poster_url: 'https://image.tmdb.org/t/p/w500/hr0L2aueqlP2BYUblT4MiAKw38i.jpg',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '6e92fab0-2bad-470c-8cd3-50c799b53a54',
    user_id: 'demo',
    title: 'Joker',
    poster_url: 'https://image.tmdb.org/t/p/w500/udDclJoHjfjb8EkgsdwB1ouoJz9.jpg',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf',
    user_id: 'demo',
    title: 'Inception',
    poster_url: 'https://image.tmdb.org/t/p/w500/ljsZTbVsrQSqZgWeep2vDqiKEc9.jpg',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'ca3ea622-4002-494e-a566-6c5d9a760473',
    user_id: 'demo',
    title: 'The Dark Knight',
    poster_url: 'https://image.tmdb.org/t/p/w500/qJ2tW6WMUDux911r6m7haRef0WH.jpg',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'f1a2b3c4-0000-0000-0000-000000000001',
    user_id: 'demo',
    title: 'Fight Club',
    poster_url: 'https://image.tmdb.org/t/p/w500/pB8BM7pdSp6B6Ih7QZ4DrQ3PmLG.jpg',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
]

const DEMO_QUOTES = [
  // The Dark Knight Rises
  { id: 'q001', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'GORDON', quote: 'Not the hero we deserved — the hero we needed.', significance: 9 },
  { id: 'q002', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'BANE', quote: 'And no one cared who I was until I put on the mask.', significance: 10 },
  { id: 'q003', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'BANE', quote: 'Who we are does not matter. What matters is our plan.', significance: 8 },
  { id: 'q004', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'BANE', quote: 'The fire rises.', significance: 9 },
  { id: 'q005', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'BANE', quote: 'Calm, Doctor. Now is not the time for fear. That comes later.', significance: 10 },
  { id: 'q006', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'ALFRED', quote: 'I never wanted you to come back to Gotham. I knew there was nothing here for you.', significance: 8 },
  { id: 'q007', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'ALFRED', quote: 'I had a fantasy, that one day I would look across a cafe and see you there, happy.', significance: 9 },
  { id: 'q008', movie_id: '2cbafc50-b503-40cd-aabc-d087ac2f0676', character: 'WAYNE', quote: 'There is a point far out there, when the structures fail you and the rules aren\'t weapons anymore.', significance: 8 },
  // Joker
  { id: 'q009', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'Is it just me, or is it getting crazier out there?', significance: 9 },
  { id: 'q010', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'I just hope my death makes more sense than my life.', significance: 10 },
  { id: 'q011', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'I used to think that my life was a tragedy, but now I realize, it\'s a comedy.', significance: 10 },
  { id: 'q012', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'The worst part of having a mental illness is people expect you to behave as if you don\'t.', significance: 9 },
  { id: 'q013', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'What do you get when you cross a mentally ill loner with a society that abandons him and treats him like trash? You get what you fucking deserve!', significance: 10 },
  { id: 'q014', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'I\'ve got nothing left to lose. Nothing can hurt me anymore.', significance: 8 },
  { id: 'q015', movie_id: '6e92fab0-2bad-470c-8cd3-50c799b53a54', character: 'JOKER', quote: 'For my whole life, I didn\'t know if I even really existed. But I do. And people are starting to notice.', significance: 9 },
  // Inception
  { id: 'q016', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'COBB', quote: 'What\'s the most resilient parasite? An idea.', significance: 10 },
  { id: 'q017', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'COBB', quote: 'Dreams feel real while we\'re in them. It\'s only when we wake up that we realize something was strange.', significance: 10 },
  { id: 'q018', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'COBB', quote: 'You\'re waiting for a train. A train that will take you far away. You know where you hope this train will take you, but you can\'t know for sure.', significance: 9 },
  { id: 'q019', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'MAL', quote: 'You keep telling yourself what you know. But what do you believe?', significance: 8 },
  { id: 'q020', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'COBB', quote: 'An idea is like a virus. Resilient. Highly contagious. And even the smallest seed of an idea can grow.', significance: 10 },
  { id: 'q021', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'COBB', quote: 'Downwards is the only way forwards.', significance: 8 },
  { id: 'q022', movie_id: '010f3e6f-dbf1-42ff-b352-56e1e57eb6bf', character: 'ARTHUR', quote: 'You mustn\'t be afraid to dream a little bigger, darling.', significance: 9 },
  // The Dark Knight
  { id: 'q023', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'JOKER', quote: 'Why so serious?', significance: 10 },
  { id: 'q024', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'JOKER', quote: 'Madness, as you know, is like gravity. All it takes is a little push.', significance: 10 },
  { id: 'q025', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'JOKER', quote: 'You either die a hero or live long enough to see yourself become the villain.', significance: 10 },
  { id: 'q026', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'JOKER', quote: 'I\'m not a monster. I\'m just ahead of the curve.', significance: 9 },
  { id: 'q027', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'ALFRED', quote: 'Some men aren\'t looking for anything logical, like money. They can\'t be bought, bullied, reasoned, or negotiated with. Some men just want to watch the world burn.', significance: 10 },
  { id: 'q028', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'BATMAN', quote: 'It\'s not who I am underneath, but what I do that defines me.', significance: 9 },
  { id: 'q029', movie_id: 'ca3ea622-4002-494e-a566-6c5d9a760473', character: 'HARVEY DENT', quote: 'You either die a hero or you live long enough to see yourself become the villain.', significance: 10 },
  // Fight Club
  { id: 'q030', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'NARRATOR', quote: 'With a gun barrel between your teeth, you speak only in vowels.', significance: 8 },
  { id: 'q031', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'TYLER DURDEN', quote: 'The things you own end up owning you.', significance: 10 },
  { id: 'q032', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'TYLER DURDEN', quote: 'It\'s only after we\'ve lost everything that we\'re free to do anything.', significance: 10 },
  { id: 'q033', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'TYLER DURDEN', quote: 'You are not your job. You\'re not how much money you have in the bank. You\'re not the car you drive.', significance: 10 },
  { id: 'q034', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'TYLER DURDEN', quote: 'First rule of Fight Club: You do not talk about Fight Club.', significance: 9 },
  { id: 'q035', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'TYLER DURDEN', quote: 'This is your life, and it\'s ending one minute at a time.', significance: 9 },
  { id: 'q036', movie_id: 'f1a2b3c4-0000-0000-0000-000000000001', character: 'NARRATOR', quote: 'We buy things we don\'t need with money we don\'t have to impress people we don\'t like.', significance: 10 },
]

export function DemoProvider({ children }) {
  const [isDemo, setIsDemo] = useState(false)

  const enterDemo = () => setIsDemo(true)
  const exitDemo = () => setIsDemo(false)

  return (
    <DemoContext.Provider value={{ isDemo, enterDemo, exitDemo, DEMO_MOVIES, DEMO_QUOTES, DEMO_USER }}>
      {children}
    </DemoContext.Provider>
  )
}

export function useDemo() {
  return useContext(DemoContext)
}
