import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { PlanDecision } from "@/lib/types";
import { createAgentContextSections } from "@/core/prompts";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: NextRequest) {
  try {
    const { agentId, prompt, agentProfile, memory, sharedMentalModel } = await request.json();

    console.log(`🤖 Plan API 호출 - 에이전트: ${agentId}`);

    // Create enhanced system prompt with agent context
    let systemPrompt = "You are an AI agent planning your next action in a team ideation session. Respond only with valid JSON.";
    
    if (agentProfile) {
      const { profileContext, memoryContext } = createAgentContextSections(
        agentProfile,
        memory,
        sharedMentalModel,
        "Plan your actions strategically based on your personality, relationships, and team dynamics."
      ) as any;
      
      systemPrompt = `${profileContext}${memoryContext}

## Planning Guidelines
You are planning your next action in a team ideation session. Consider:

1. **Your Personality & Role**: Act according to your professional background, skills, and personality traits
2. **Team Relationships**: Consider your relationships with team members and past interactions
3. **Shared Mental Model**: Align your planning with the team's shared understanding and goals
4. **Strategic Thinking**: Balance team needs with your unique contributions and expertise
5. **Collaboration Style**: Match your communication and action style to your personality

## Response Format
Respond only with valid JSON that reflects your strategic decision-making process.

Your planning should demonstrate authentic personality-driven decision making that considers team dynamics and your role within the group.`;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.8,
      max_tokens: 800,
    });

    const responseText = completion.choices[0]?.message?.content;

    if (!responseText) {
      throw new Error("OpenAI 응답이 비어있습니다");
    }

    console.log(`🧠 Plan 응답 원본:`, responseText);

    // JSON 파싱 시도
    let decision: PlanDecision;
    try {
      // JSON 블록 추출 (```json ... ``` 형태일 수 있음)
      const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) ||
        responseText.match(/```\s*([\s\S]*?)\s*```/) || [null, responseText];

      const jsonText = jsonMatch[1] || responseText;
      decision = JSON.parse(jsonText.trim());

      // 필수 필드 검증
      if (typeof decision.shouldAct !== "boolean") {
        throw new Error("shouldAct 필드가 boolean이 아닙니다");
      }

      if (decision.shouldAct && !decision.actionType) {
        throw new Error("shouldAct가 true인데 actionType이 없습니다");
      }

      if (!decision.reasoning) {
        throw new Error("reasoning 필드가 없습니다");
      }
    } catch (parseError) {
      console.error(`❌ JSON 파싱 실패:`, parseError);
      console.error(`원본 응답:`, responseText);

      // 파싱 실패 시 기본 결정
      decision = {
        shouldAct: false,
        reasoning: `JSON 파싱 실패로 인한 기본 대기 결정. 원본 응답: ${responseText.substring(
          0,
          100
        )}...`,
      };
    }

    console.log(`✅ Plan 결정:`, decision);

    return NextResponse.json(decision);
  } catch (error) {
    console.error("❌ Plan API 오류:", error);

    // 오류 시 기본 결정 반환
    const fallbackDecision: PlanDecision = {
      shouldAct: false,
      reasoning: `API 오류로 인한 기본 대기 결정: ${
        error instanceof Error ? error.message : "알 수 없는 오류"
      }`,
    };

    return NextResponse.json(fallbackDecision);
  }
}
