# 🎬 Quote — AI-Powered Daily Wisdom from Iconic Scripts

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://iulianplop1.github.io/Quote/)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-blue)](https://github.com/iulianplop1/Quote)

**Quote** is a premium web application designed for cinephiles who want to start their day with a dose of inspiration. It transforms complex movie scripts into a curated daily experience, using AI to extract the most significant moments from cinematic history.

---

## ✨ The Vision

Traditional script reading is a dense, manual process. **Quote** reimagines this by acting as a digital curator. It doesn't just store scripts; it understands them. Whether it's the philosophical grit of *Fight Club* or the chaotic wisdom of *Joker*, the app delivers high-impact dialogue directly to your dashboard.

### 🌟 Key Features

*   🎭 **AI Script Analysis**: Leverages **Gemini 2.5 Flash** to intelligently parse raw scripts and extract quotes based on narrative significance.
*   📅 **Morning Routine Integration**: Schedule your daily quote to arrive exactly when you need it.
*   🔍 **Thematic Discovery**: Search your entire library by abstract themes like "courage," "betrayal," or "justice" using semantic AI search.
*   🎬 **Cinematic Context**: Instantly view the scene surrounding a quote to relive the moment.
*   🔊 **Premium Voice Synthesis**: Integrated with **ElevenLabs** for high-fidelity, character-appropriate text-to-speech.
*   🌘 **Modern Aesthetics**: A glassmorphic, responsive interface with deep dark mode support.

---

## 🛠️ Technical Architecture

Built with a focus on performance, scalability, and modern DX:

*   **Frontend**: React 18 + Vite (for lightning-fast HMR).
*   **Styling**: Tailwind CSS for a bespoke, premium UI.
*   **Backend**: Supabase (PostgreSQL + Auth + Storage).
*   **AI Engine**: Google Gemini Pro & Flash for script parsing and thematic search.
*   **DevOps**: Automated deployment via GitHub Actions to GitHub Pages.

---

## 🚀 Experience the Demo

I've restored the project with a **full Demo Mode** featuring 90+ iconic quotes from my personal collection:

1.  Visit the [Live Demo](https://iulianplop1.github.io/Quote/).
2.  Click the **"Try Demo"** button on the login screen.
3.  Explore the Library, Dashboard, and Routines with pre-loaded data from *The Dark Knight*, *Inception*, *Fight Club*, and more.

---

## 📖 Setup & Development

If you'd like to run your own instance:

1.  **Clone & Install**:
    ```bash
    git clone https://github.com/iulianplop1/Quote.git
    npm install
    ```
2.  **Environment**: Copy `env.example` to `.env` and add your Supabase and Gemini keys.
3.  **Database**: Run `supabase/schema.sql` in your Supabase SQL Editor.
4.  **Run**: `npm run dev`

---

## 📄 License

MIT © [Iulian Plop](https://github.com/iulianplop1)
