# AI Syndicate

A WhatsApp-inspired multi-AI chat prototype with a modern product-style interface. This project combines group chat, AI mentions, status updates, and YouTube watchroom functionality in a single local app.

## Highlights

- AI group chat experience with mention support
- Multi-provider AI responses: Gemini, Groq, and local Ollama
- Status feed with three modes:
  - Thread-style updates
  - Photo status
  - Video status
- Full status CRUD support in the UI
- YouTube-style content page / watchstream interface
- Local JSON persistence for app state
- Environment-based API configuration

## Stack

- Node.js
- Express
- JavaScript / HTML / CSS
- dotenv
- Local file-based JSON store

## Project structure

```text
.
├── public/
│   └── index.html
├── data/
│   └── db.json
├── server.js
├── package.json
├── .gitignore
├── README.md
└── .env
```

## Prerequisites

- Node.js 18+
- npm
- Optional:
  - Gemini API key
  - Groq API key
  - Ollama installed and running locally

## Installation

```bash
npm install
```

## Run the app

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

For development with live reload:

```bash
npm run dev
```

## Environment variables

Create a `.env` file in the project root and add the keys you need.

Example:

```env
PORT=3000
GEMINI_API_KEY=your_gemini_key_here
GEMINI_MODEL=gemini-2.0-flash
GROQ_API_KEY=your_groq_key_here
GROQ_MODEL=openai/gpt-oss-120b
OLLAMA_MODEL=llama3.2
YOUTUBE_API_KEY=your_youtube_data_api_key_here
YOUTUBE_REGION=ID
```

Notes:
- `.env` is ignored by Git via `.gitignore`
- Ollama can work without an API key as long as Ollama is running locally
- Watchstream search uses the YouTube Data API v3 and requires `YOUTUBE_API_KEY`
- If the env variables are not set, some AI routes may fall back to defaults or produce limited behavior

## Features overview

### Chat
- Create group-style messaging experience
- Mention AI members using `@Gemini`, `@Groq`, `@Ollama`, or `@all`
- AI replies are generated via server-side API calls
- File attachments and generated content can be included in chat flow

### Status
- Real-time status strip in the sidebar
- Create status cards in three forms:
  - thread
  - photo
  - video
- Edit and delete existing status cards
- Status preview modal for detailed viewing

### Watchstream / YouTube page
- YouTube-inspired UI shell
- Search and browse-like layout for video content
- Integrated video viewing area

## Security note

This project uses a local `.env` file for secrets. Do not commit sensitive keys to GitHub.

The repository already includes a `.gitignore` entry for:

```git
.env
.env.*
node_modules/
```

## License

This project is intended for prototype/demo purposes and is not a production SaaS deployment.

## Notes

This app is designed as a local prototype and is best suited for demos, product exploration, and learning experiences.
