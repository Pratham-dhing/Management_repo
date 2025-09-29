Market Intelligence - Final connected demo (frontend + backend with caching)

What's included (new/updated):
- server.js: serves frontend statically and provides API proxy endpoints for quotes, timeseries, news, and sentiment.
  - In-memory caching added to reduce external API calls and mitigate rate limits.
  - Supports NEWSAPI or GNews via NEWS_PROVIDER env var.
- package.json: updated start scripts.
- .env.example: example environment variables (copy to .env).
- index.html, app.js, style.css: frontend; Chart.js added via CDN for plotting in future improvements.

How to run locally (full):
1. Install Node.js (>=16) and npm.
2. Copy .env.example to .env and add your API keys:
   - ALPHAVANTAGE_API_KEY (https://www.alphavantage.co/)
   - NEWSAPI_KEY (https://newsapi.org/) OR GNEWS_API_KEY (https://gnews.io/) and set NEWS_PROVIDER to 'gnews' if using it.
   - Optional: HUGGINGFACE_API_KEY (https://huggingface.co/)
3. From the project folder:
   npm install
   node server.js
4. Open http://localhost:3000 in your browser (the server serves index.html).

Notes & production suggestions:
- Alpha Vantage free tier has strict rate limits (~5 requests/minute). Use caching (already added) and minimize polling. Consider switching to a paid plan or alternative provider for production (Finnhub, TwelveData, etc.).
- For production, deploy the backend to a hosted environment and store API keys in that host's secret manager (Render/Heroku/Vercel).
- Consider adding persistent caching (Redis) and request queuing for high-volume usage.
- To deploy as a single static site + serverless functions, refactor endpoints to your host's serverless functions (Vercel/Netlify) and keep keys server-side.

If you want, I can now:
- Replace Alpha Vantage with another provider (Finnhub/TwelveData) and adapt endpoints + sample responses.
- Add Redis caching and Dockerfile for containerized deployment.
- Implement Chart.js plotting of time series and buy/sell markers on the frontend.
- Prepare a one-click deploy guide for Render (with a render.yaml) or Dockerfile for container deployment.
Pick any/all and I'll update the package immediately.


## Advanced deployment


- Docker: build with `docker build -t market-intel .` and run `docker run -p 3000:3000 -e ALPHAVANTAGE_API_KEY=... market-intel`
- Redis: set REDIS_URL (e.g. redis://:password@host:6379) to enable Redis caching instead of in-memory.
- Swap provider: set PRIMARY_DATA_PROVIDER to 'finnhub' or 'twelvedata' and set the corresponding API key env var (FINNHUB_API_KEY or TWELVEDATA_API_KEY). Finnhub generally has better rate limits for intraday candles.
- Render: a `render.yaml` is included for one-click deploy using Docker. Add your secrets in Render dashboard (ALPHAVANTAGE_API_KEY, FINNHUB_API_KEY, etc.).
- GitHub Actions: workflow included to build and push Docker image to GHCR (you can then use this image for deployment).

Secrets required for CI/CD (set in GitHub repo settings):
- GITHUB_TOKEN (provided by GitHub automatically)


## Full automation: Local Redis + Docker Compose


To run the app with a local Redis instance (recommended for caching):
1. Ensure you have Docker & Docker Compose installed.
2. Populate `.env` with your API keys (ALPHAVANTAGE_API_KEY, NEWSAPI_KEY, etc.).
3. Start services:
   docker-compose up --build -d
4. Open http://localhost:3000
5. To stop: docker-compose down

This compose file builds the app image and runs Redis; `REDIS_URL` is injected into the app service.

## One-click deployment to Render (using Docker)
1. Push this repository to GitHub.
2. In Render dashboard, create a new Web Service > Connect a repo > Select branch.
3. Choose "Deploy using Docker" and ensure `render.yaml` is present (already included).
4. In Render's Service Environment, add environment variables (ALPHAVANTAGE_API_KEY, FINNHUB_API_KEY, NEWSAPI_KEY, HUGGINGFACE_API_KEY, REDIS_URL if you have a managed Redis).
5. Deploy. Render will build the Docker image and run the container.

## GitHub Actions & GHCR
- A workflow is included that builds and pushes the image to GHCR on push to `main`/`master`.
- Ensure repo settings allow GitHub Actions and that packages permissions are correct.
- You may need to add workflow modifications to authenticate with Render or other hosts if you want automated deploys from GHCR.

## Required GitHub Secrets (if you want automated deploys)
- For pushing images: none (GITHUB_TOKEN is sufficient for GHCR in most cases)
- For Render automated deploy via API (optional): RENDER_API_KEY (if you want GH Actions to trigger Render deploys)
- Store any API keys as GitHub repo secrets (ALPHAVANTAGE_API_KEY, FINNHUB_API_KEY, NEWSAPI_KEY, HUGGINGFACE_API_KEY, REDIS_URL)


## Automated Render deploy via GitHub Actions


If you want GitHub Actions to trigger a Render deploy after pushing the image, add these repository secrets in GitHub:
- RENDER_API_KEY     (create in Render > Account > API Keys)
- RENDER_SERVICE_ID  (the service ID shown in Render's service settings; required to trigger deploys)

The workflow will only attempt the Render deploy if both secrets are non-empty. The deploy step uses Render's Deploys API to create a new deploy.
