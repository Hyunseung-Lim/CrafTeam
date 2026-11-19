# CrafTeam
CrafTeam is a research prototype (technology probe) that lets users form their own Human–Multi-Agent Teams (HMATs) and carry out design ideation with them. A user forms a team of LLM-based agents, ideates with the team, and reviews how the team worked, and can then re-form the team for the next cycle. The system is a Next.js application that uses OpenAI models for the agents and Upstash Redis for storage. This document focuses on running the system locally.

CrafTeam was developed for the following paper:

> Hyunseung Lim, Dasom Choi, Sooyohn Nam, Bogoan Kim, and Hwajung Hong. 2026. Understanding Human–Multi-Agent Team Formation for Creative Work. In *Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems (CHI '26)*. https://doi.org/10.1145/3772318.3791166

This repository is the English version of the system. In the study reported in the paper, the prompts instructed the agents to write in Korean.

## Repository Layout
```
CrafTeam/
├── src/
│   ├── app/                # Pages and API routes (Next.js App Router)
│   │   ├── dashboard/      # Agent and team lists, team formation
│   │   ├── ideation/       # Team-based ideation and review
│   │   └── api/            # Teams, ideas, feedback sessions, agent states, auth
│   ├── components/         # UI components (relationship graph, idea and feedback modals)
│   ├── core/prompts.ts     # Prompts of the agent action pipelines
│   ├── lib/                # Agent logic: model calls, memory, agent states, Redis
│   └── actions/            # Server actions for agents, teams, and ideation
├── middleware.ts           # Route protection (NextAuth)
└── package.json
```

## Prerequisites
- Node.js 18.18+ (with npm)
- OpenAI API key with access to GPT-4o
- An Upstash Redis database (REST URL and token)

## Setup
1. **Install packages**
   ```bash
   git clone https://github.com/Hyunseung-Lim/CrafTeam.git
   cd CrafTeam
   npm install
   ```
2. **Configure environment variables**  
   Create `.env.local` in the project root with:
   ```
   OPENAI_API_KEY=sk-your-key
   UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
   UPSTASH_REDIS_REST_TOKEN=your-token
   NEXTAUTH_URL=http://localhost:3000
   NEXTAUTH_SECRET=a-long-random-string
   ```
3. **Start the development server**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`, sign up, and log in.

## Using CrafTeam
1. **Form a team (`/dashboard/teams/new`)**  
   Team formation has five steps, one for each dimension of team formation.
   - **Team size**: name the team, set the ideation topic, and choose 3 to 6 members including yourself.
   - **Team structure**: connect members with hierarchical or peer relationships. Only directly connected members can interact.
   - **Role allocation**: assign each member one or more of four roles: Idea Generation, Idea Evaluation, Feedback, and Request.
   - **Member composition**: write a persona for each agent (age, gender, education, occupation, personality, skills, and so on).
   - **Shared mental model**: describe how the team should work on the task and as a team.
2. **Ideate with the team (`/ideation/[teamId]`)**  
   The user and the agents generate ideas, evaluate them on novelty, completeness, and quality, hold feedback sessions, and send requests to one another, each within their assigned roles. Agents act on their own by cycling through Plan, Act, Reflect, and Wait states, and their current states are shown in the interface.
3. **Review the session (`/ideation/[teamId]/review`)**  
   The review page shows the session summary, each member's actions by role, the flow of feedback and requests between members, the action timeline, and the generated ideas.

## Agents and Model Settings
- Each agent has a profile, a short-term memory (recent actions, pending requests, the ongoing feedback conversation), and a long-term memory (design knowledge, action strategies, relationships with other members). See `src/lib/memory-v2.ts`.
- The prompts for planning, idea generation, idea evaluation, feedback, feedback response, request, and reflection are in `src/core/prompts.ts`, and the model calls are in `src/lib/openai.ts`.
- All calls use GPT-4o. The temperature is 0.8 for agent actions (planning, idea generation, idea evaluation, feedback, and request) and 0.5 for general operations (memory updates, persona summaries, and feedback session summaries).
- An agent in the Wait state returns to planning after 30–60 seconds, or immediately when it receives a request or feedback.

## Citation
```
@inproceedings{10.1145/3772318.3791166,
author = {Lim, Hyunseung and Choi, Dasom and Nam, Sooyohn and Kim, Bogoan and Hong, Hwajung},
title = {Understanding Human–Multi-Agent Team Formation for Creative Work},
year = {2026},
isbn = {9798400722783},
publisher = {Association for Computing Machinery},
address = {New York, NY, USA},
url = {https://doi.org/10.1145/3772318.3791166},
doi = {10.1145/3772318.3791166},
abstract = {Team-based collaboration is a cornerstone of modern creative work. Recent advances in generative AI open possibilities for humans to collaborate with multiple AI agents in distinct roles to address complex creative workflows. Yet, how to form Human–Multi-Agent Teams (HMATs) is underexplored, especially given that inter-agent interactions increase complexity and the risk of unexpected behaviors. In this exploratory study, we aim to understand how to form HMATs for creative work using CrafTeam, a technology probe that allows users to form and collaborate with their teams. We conducted a study with 12 design practitioners, in which participants iterated through a three-step cycle: forming HMATs, ideating with their teams, and reflecting on their teams’ ideation. Our findings reveal that while participants initially attempted autonomous team operations, they ultimately adopted team formations in which they directly orchestrated agents. We discuss design considerations for HMAT formation that humans can effectively orchestrate multiple agents.},
booktitle = {Proceedings of the 2026 CHI Conference on Human Factors in Computing Systems},
articleno = {70},
numpages = {21},
keywords = {Human–Multi-Agent Team, Human-AI Team, Multi-Agent, Team Formation},
location = {Barcelona, Spain},
series = {CHI '26}
}
```
