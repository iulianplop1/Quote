# GitHub Pages Deployment Guide

## Important: Repository Name

The app is configured to work with a repository named **"Quote"**. If your repository has a different name, you need to update the base path in `vite.config.js`.

### If your repository name is different:

1. Open `vite.config.js`
2. Find this line:
   ```js
   const base = isProduction ? '/Quote/' : '/'
   ```
3. Replace `'/Quote/'` with `'/[YOUR-REPO-NAME]/'`
   - For example, if your repo is `my-quote-app`, use `'/my-quote-app/'`

## Deployment Steps

1. **Add GitHub Secrets** (Settings > Secrets and variables > Actions):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GEMINI_API_KEY`
   - `VITE_TMDB_API_KEY` (optional)

2. **Enable GitHub Pages**:
   - Go to Settings > Pages
   - Source: GitHub Actions
   - Save

3. **Push to main branch**:
   - The workflow will automatically build and deploy

4. **Verify deployment**:
   - Check Actions tab for build status
   - Visit your GitHub Pages URL (usually `https://[username].github.io/Quote/`)

## Troubleshooting

**Blank page on GitHub Pages:**
- Check browser console for 404 errors
- Verify repository name matches base path in `vite.config.js`
- Make sure all environment variables are set as GitHub Secrets
- Check that the build completed successfully in Actions

**404 errors for routes:**
- The build automatically creates a `404.html` file
- Make sure GitHub Pages is set to use the `gh-pages` branch (created by the workflow)
- If still having issues, check that the base path is correct

**Assets not loading:**
- Verify the base path in `vite.config.js` matches your repository name
- Check that all paths use the base path prefix

