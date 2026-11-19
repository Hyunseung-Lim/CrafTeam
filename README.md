# CrafTeam

CrafTeam is a technology probe for forming human–multi-agent teams and ideating with them.

## Project Overview

CrafTeam is a web application where users create AI agents with distinct personas and roles, organize them into a team, carry out design ideation with the team, and review how the team worked. It was developed for the following paper:

> Hyunseung Lim, Dasom Choi, Sooyohn Nam, Bogoan Kim, and Hwajung Hong. 2026. Understanding Human–Multi-Agent Team Formation for Creative Work. In *Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems*. https://doi.org/10.1145/3772318.3791166

This repository is the English version of the system. In the study reported in the paper, the prompts instructed the agents to write in Korean.

## Key Features

- 🤖 **AI Agent Creation**: Create unique AI agents with names, ages, genders, personalities, values, and design styles
- 👥 **Team Building**: Select created agents and assign roles to form teams
- 💬 **Team-Based Ideation**: Generate, evaluate, and give feedback on design ideas together with your team
- 🔐 **User Authentication**: Secure login/signup via NextAuth

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Upstash Redis
- **Authentication**: NextAuth.js
- **UI Components**: Custom components (shadcn/ui style)
- **Icons**: Lucide React
- **Language model**: OpenAI gpt-4o (prompts in `src/core/prompts.ts`, calls in `src/lib/openai.ts`)

## Model Settings

- Temperature 0.8 for agent actions (planning, idea generation, idea evaluation, feedback, and request)
- Temperature 0.5 for general operations (memory updates, persona summaries, and feedback session summaries)
- An agent in the Wait state returns to planning after 30–60 seconds

## Installation & Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd CrafTeam
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env.local` file with the following variables:

- `OPENAI_API_KEY`: OpenAI API key
- `UPSTASH_REDIS_REST_URL`: Upstash Redis REST URL
- `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis REST Token
- `NEXTAUTH_URL`: NextAuth URL (use http://localhost:3000 for development)
- `NEXTAUTH_SECRET`: NextAuth secret key

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

## Project Structure

```
src/
├── app/                      # Next.js App Router pages
│   ├── (auth)/              # Authentication pages
│   ├── api/                 # API routes
│   ├── dashboard/           # Dashboard pages
│   └── layout.tsx           # Root layout
├── components/              # React components
│   ├── auth/               # Authentication components
│   ├── providers/          # Context Providers
│   └── ui/                 # Reusable UI components
├── lib/                    # Utilities and configuration
│   ├── auth.ts            # NextAuth configuration
│   ├── redis.ts           # Redis client and data functions
│   └── types.ts           # TypeScript type definitions
└── actions/               # Server Actions
    ├── agent.actions.ts   # Agent-related actions
    └── team.actions.ts    # Team-related actions
```

## Main Pages

- `/` - Landing page
- `/login` - Login page
- `/sign-up` - Sign-up page
- `/dashboard` - Dashboard home
- `/dashboard/agents` - Agent list
- `/dashboard/agents/new` - Create new agent
- `/dashboard/teams` - Team list
- `/dashboard/teams/new` - Create new team

## Data Models

### User

- id, email, name, createdAt

### AIAgent

- id, ownerId, name, age, gender, personality, value, designStyle, createdAt

### Team

- id, ownerId, teamName, members, createdAt

### TeamMember

- agentId, roles[]

### AgentRole

- Idea Generation, Idea Evaluation, Feedback, Request

## License

This project is an experimental prototype.
