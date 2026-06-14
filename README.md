# Event Tag Dictionary

Internal web app for classifying events by topic. Staff paste an event URL, the app scrapes key pages, and GPT-4o recommends tags from your curated dictionary.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment file and add your OpenAI API key:

```bash
cp .env.example .env.local
```

3. Start the dev server:

```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000)

## Usage

- **Scan Event** (`/`) — Staff paste an event URL, review AI tag recommendations, accept/adjust, or escalate to admin
- **Admin** (`/admin`) — Review escalations; approve new tags (added to `data/approved-tags.json`), merge into existing tags, or reject

## Data files

- `data/approved-tags.json` — Production topic dictionary (26 curated tags)
- `data/proposals.json` — Staff escalation queue

## Requirements

- Node.js 18+
- OpenAI API key with access to `gpt-4o`
