# Household Hub

Household Hub is a voice-first Progressive Web App (PWA) designed to act as an ambient, low-friction household whiteboard. It replaces traditional checklists with a natural language interface, allowing users to speak unstructured thoughts and relying on AI to parse, categorize, and store the items accurately. 

Currently configured as "Ben and Em's Whiteboard," the interface is designed for rapid capture on mobile devices and high-contrast visibility for read-only e-ink or wall-mounted dashboard displays.

## Features

* **Voice-First Capture:** Tap the marker icon and speak naturally. The app uses the Web Speech API for transcription and routes the raw text to the backend.
* **Intelligent Categorization:** Integrates with the Google Gemini API to parse natural language and automatically route items into four distinct zones: Groceries, Home & Tools, Storage Log, and Action Items.
* **Semantic Retrieval:** The Storage Log supports conversational querying, allowing users to ask where an item is stored rather than manually searching a list. It prioritizes active items over completed ones.
* **Native PWA Integration:** Fully installable as a standalone app on iOS and Android. Features a seamless handoff from the native OS splash screen to a custom React-based marker cap "pop" micro-interaction.
* **Ambient Display Ready:** High-contrast CSS layout tailored for low-power, always-on displays or e-ink tablets mounted in common areas.

## Tech Stack

* **Framework:** Next.js (App Router)
* **Language:** TypeScript
* **Styling:** Tailwind CSS 
* **Database:** Supabase (PostgreSQL)
* **AI Processing:** Google Gemini API
* **Deployment:** Vercel

## Local Development

### Prerequisites
* Node.js (v18+)
* A Supabase project
* A Google Gemini API key

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/Bengician/household-hub.git](https://github.com/Bengician/household-hub.git)
   cd household-hub
