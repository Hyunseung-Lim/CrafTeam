# AI Team Builder

A creative team building platform powered by AI agents.

## Project Overview

This is an experimental web application where users can create AI agents with distinct personalities and roles, organize them into teams, and generate ideas for design projects.

## Key Features

- 🤖 **AI Agent Creation**: Create unique AI agents with names, ages, genders, personalities, values, and design styles
- 👥 **Team Building**: Select created agents and assign roles to form teams
- 💬 **Idea Generation**: Generate creative design ideas through conversations with your team (coming soon)
- 🔐 **User Authentication**: Secure login/signup via NextAuth

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Database**: Upstash Redis
- **Authentication**: NextAuth.js
- **UI Components**: Custom components (shadcn/ui style)
- **Icons**: Lucide React

## Installation & Setup

### 1. Clone the repository

```bash
git clone <repository-url>
cd teambuilder
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env.local` file by referencing `.env.local.example` and fill in the required variables:

```bash
cp .env.local.example .env.local
```

Required environment variables:

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

- Propose idea, Develop idea, Evaluate idea, Discard idea, Discuss, Give feedback

## Roadmap

- [ ] Integrate OpenAI API for real AI chat functionality
- [ ] Save and retrieve conversation logs per team
- [ ] Edit and delete agents and teams
- [ ] Team performance analytics and statistics
- [ ] Real-time collaboration features

## License

This project is an experimental prototype.
