"use server";

import {
  getAgentById,
  getIdeas,
  addIdea,
  addChatMessage,
  getTeamById,
  getUserByEmail,
  getUserAgents,
  updateIdea,
  getAgentMemory,
  updateAgentMemory,
  initializeAgentMemory,
  redis,
} from "@/lib/redis";
import {
  preIdeationAction,
  executeIdeationAction,
  preEvaluationAction,
  executeEvaluationAction,
} from "@/lib/openai";
import { Idea, AgentMemory } from "@/lib/types";
import { getServerSession } from "next-auth";
import { AgentRequest } from "@/lib/types";

// 한국어 조사 선택 함수
function getKoreanParticle(
  name: string,
  hasConsonant: string,
  noConsonant: string
): string {
  if (!name) return hasConsonant;

  const lastChar = name.charAt(name.length - 1);
  const lastCharCode = lastChar.charCodeAt(0);

  // 한글 범위 확인 (가-힣)
  if (lastCharCode >= 0xac00 && lastCharCode <= 0xd7a3) {
    // 받침 있는지 확인 (유니코드 계산)
    const hasJongseong = (lastCharCode - 0xac00) % 28 !== 0;
    return hasJongseong ? hasConsonant : noConsonant;
  }

  // 한글이 아닌 경우 기본값
  return hasConsonant;
}

// 요청을 Redis 큐에 추가하는 헬퍼 함수 (기존 queueRetrospective 패턴과 동일)
async function addRequestToQueue(
  teamId: string,
  agentId: string,
  request: AgentRequest
): Promise<void> {
  try {
    // Redis 큐에 추가 (기존 요청 시스템과 동일한 방식)
    const queueKey = `agent_queue:${teamId}:${agentId}`;
    await redis.lpush(queueKey, JSON.stringify(request));
    
    console.log(`✅ ${agentId} 요청이 Redis 큐에 추가됨 (key: ${queueKey})`);
  } catch (error) {
    console.error(`❌ ${agentId} 요청 큐잉 실패:`, error);
    throw error;
  }
}

export async function generateIdeaViaRequest({
  teamId,
  agentId,
  requesterName,
  requestMessage,
}: {
  teamId: string;
  agentId: string;
  requesterName: string;
  requestMessage: string;
}) {
  console.log("=== 요청 기반 아이디어 생성 시작 ===");
  console.log("요청 정보:", { teamId, agentId, requesterName, requestMessage });

  try {
    // AgentRequest 객체 생성
    const request: AgentRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: "generate_idea",
      requesterName,
      payload: {
        message: requestMessage,
      },
      timestamp: new Date().toISOString(),
      teamId,
    };

    // Redis 큐에 요청 추가 (기존 큐 시스템 사용)
    await addRequestToQueue(teamId, agentId, request);

    console.log(`✅ 에이전트 ${agentId}에게 아이디어 생성 요청 추가 완료`);
    return { success: true, message: "요청이 에이전트에게 전달되었습니다." };
  } catch (error) {
    console.error("❌ 요청 기반 아이디어 생성 실패:", error);
    throw error;
  }
}

export async function evaluateIdeaViaRequest({
  teamId,
  agentId,
  ideaId,
  requesterName,
  requestMessage,
}: {
  teamId: string;
  agentId: string;
  ideaId: number;
  requesterName: string;
  requestMessage: string;
}) {
  console.log("=== 요청 기반 아이디어 평가 시작 ===");
  console.log("요청 정보:", {
    teamId,
    agentId,
    ideaId,
    requesterName,
    requestMessage,
  });

  try {
    // AgentRequest 객체 생성
    const request: AgentRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: "evaluate_idea",
      requesterName,
      payload: {
        message: requestMessage,
        ideaId,
      },
      timestamp: new Date().toISOString(),
      teamId,
    };

    // Redis 큐에 요청 추가 (기존 큐 시스템 사용)
    await addRequestToQueue(teamId, agentId, request);

    console.log(`✅ 에이전트 ${agentId}에게 아이디어 평가 요청 추가 완료`);
    return {
      success: true,
      message: "평가 요청이 에이전트에게 전달되었습니다.",
    };
  } catch (error) {
    console.error("❌ 요청 기반 아이디어 평가 실패:", error);
    throw error;
  }
}

// 평가 후 메모리를 업데이트하는 헬퍼 함수
async function updateMemoryAfterEvaluation(
  memory: AgentMemory,
  evaluatorId: string,
  authorId: string,
  evaluation: any,
  ideaId: number
): Promise<AgentMemory> {
  console.log("=== updateMemoryAfterEvaluation 시작 ===");
  console.log("입력 파라미터:", { evaluatorId, authorId, ideaId });
  console.log("평가 내용:", JSON.stringify(evaluation, null, 2));

  // Short-term memory 업데이트
  memory.shortTerm.lastAction = {
    type: "evaluate_idea",
    timestamp: new Date().toISOString(),
    payload: {
      ideaId: ideaId,
      authorId,
      scores: evaluation.scores,
    },
  };
  console.log("Short-term memory 업데이트 완료");

  // Long-term memory 업데이트
  // 1. 자기 성찰 추가
  const reflection = {
    reflection: `I evaluated ${authorId}'s idea with comprehensive scores: Novelty ${evaluation.scores.novelty}/7, Completeness ${evaluation.scores.completeness}/7, Quality ${evaluation.scores.quality}/7. Comment: ${evaluation.comment || 'No additional comments provided'}`,
    triggeringEvent: "evaluated_idea",
    relatedIdeaId: ideaId,
    timestamp: new Date().toISOString(),
  };

  // longTerm.self가 배열인지 확인하고 초기화
  if (!Array.isArray(memory.longTerm.self)) {
    (memory.longTerm as any).self = [];
  }

  (memory.longTerm.self as unknown as any[]).push(reflection);
  console.log("자기 성찰 추가:", reflection);

  // 2. 상호작용 기록 추가
  // authorId를 올바른 관계 키로 변환
  // "Me"는 그대로, 에이전트 ID는 그대로 사용
  const relationKey = authorId === "Me" ? "Me" : authorId;
  console.log("관계 키 변환:", { authorId, relationKey });
  console.log("현재 관계 목록:", Object.keys(memory.longTerm.relations));

  if (memory.longTerm.relations[relationKey]) {
    const interactionRecord = {
      action: "evaluated_their_idea",
      content: `Evaluated their idea with full assessment: Novelty ${evaluation.scores.novelty}/7, Completeness ${evaluation.scores.completeness}/7, Quality ${evaluation.scores.quality}/7. Comment: ${evaluation.comment || 'No additional comments provided'}`,
      timestamp: new Date().toISOString(),
    };
    memory.longTerm.relations[relationKey].interactionHistory.push(
      interactionRecord
    );
    console.log("상호작용 기록 추가:", interactionRecord);

    // 3. 관계에 대한 의견 업데이트 (간단한 예시)
    const newOpinion = `최근 그의 아이디어를 평가했다. ${
      evaluation.scores.novelty > 4
        ? "꽤나 창의적인 아이디어를 내는 것 같다."
        : "조금 더 분발해야 할 것 같다."
    }`;
    memory.longTerm.relations[relationKey].myOpinion = newOpinion;
    console.log("관계 의견 업데이트:", newOpinion);
  } else {
    console.warn(
      `관계 정보를 찾을 수 없음: ${relationKey} (원본: ${authorId})`
    );
    console.log("현재 관계 목록:", Object.keys(memory.longTerm.relations));

    // 관계가 없는 경우에도 기본 관계 정보 생성
    console.log("기본 관계 정보 생성 시도...");
    memory.longTerm.relations[relationKey] = {
      agentInfo: {
        id: authorId,
        name: authorId === "Me" ? "Me" : `에이전트 ${authorId}`,
        professional: "알 수 없음",
        personality: "알 수 없음",
        skills: "알 수 없음",
      },
      relationship: "NULL",
      interactionHistory: [
        {
          action: "evaluated_their_idea",
          content: `평가 점수: ${JSON.stringify(evaluation.scores)}. 코멘트: ${
            evaluation.comment
          }`,
          timestamp: new Date().toISOString(),
        },
      ],
      myOpinion: `최근 그의 아이디어를 평가했다. ${
        evaluation.scores.novelty > 4
          ? "꽤나 창의적인 아이디어를 내는 것 같다."
          : "조금 더 분발해야 할 것 같다."
      }`,
    };
    console.log(
      "기본 관계 정보 생성 완료:",
      memory.longTerm.relations[relationKey]
    );
  }

  console.log("=== updateMemoryAfterEvaluation 완료 ===");
  return memory;
}

// 초기 아이디어 생성 완료 후 에이전트 상태 시스템 시작
export async function startAgentStateSystem(teamId: string) {
  console.log(`🚀 팀 ${teamId}의 에이전트 상태 시스템 시작`);

  try {
    const team = await getTeamById(teamId);
    if (!team) {
      console.error(`팀 ${teamId}를 찾을 수 없음`);
      return;
    }

    // 모든 에이전트를 Idle 상태로 전환 - 기존 API 사용
    for (const member of team.members) {
      if (!member.isUser && member.agentId) {
        console.log(`😴 에이전트 ${member.agentId} → Idle 상태 전환`);
        
        // 기존 상태 관리 API 사용
        const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:3000`;
        try {
          const response = await fetch(
            `${baseUrl}/api/teams/${teamId}/agent-states`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "TeamBuilder-Internal",
              },
              body: JSON.stringify({
                agentId: member.agentId,
                currentState: "idle",
                forceClear: true,
              }),
            }
          );
          
          if (!response.ok) {
            console.error(`❌ 에이전트 ${member.agentId} 상태 전환 실패:`, response.status);
          }
        } catch (error) {
          console.error(`❌ 에이전트 ${member.agentId} 상태 전환 오류:`, error);
        }
      }
    }

    console.log(`✅ 팀 ${teamId}의 모든 에이전트가 Idle 상태로 전환됨`);
  } catch (error) {
    console.error(`❌ 에이전트 상태 시스템 시작 실패:`, error);
  }
}
