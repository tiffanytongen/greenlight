# Greenlight AI proxy

Keeps Anthropic/ElevenLabs keys OFF the phone. The app only knows this
server's URL. Decisions stay on-device; this only structures messy input.

```bash
cp .env.example .env   # add your keys
node index.js          # http://localhost:8787
```

Endpoints: GET /health · POST /interpret · POST /vision · POST /transcribe · POST /speak
No dependencies; Node 18+.
