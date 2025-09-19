import {
  getAgentMemory,
  updateAgentMemory,
  getAgentById,
  getTeamById,
  getChatHistory,
  getIdeas,
  redis,
} from "./redis";
import {
  createSelfReflectionPrompt,
  createRelationOpinionPrompt,
  createDeepSelfReflectionPrompt,
  createMemoryCompressionPrompt,
} from "@/core/prompts";
import {
  AgentMemory,
  ChatMessage,
  AIAgent,
  Team,
  RelationalMemory,
  Idea,
} from "./types";
import * as OpenAI from "./openai";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

// LangChain LLM 인스턴스 생성
const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0.5,
});

// 텍스트 응답을 위한 헬퍼 함수
async function getTextResponse(prompt: string): Promise<string> {
  try {
    const response = await llm.invoke([new HumanMessage(prompt)]);
    return response.content.toString().trim();
  } catch (error) {
    console.error("텍스트 응답 생성 실패:", error);
    throw error;
  }
}

// 메모리 이벤트 타입 정의 - 더 포괄적으로 확장
type MemoryEvent =
  | {
      type: "IDEA_GENERATED";
      payload: {
        teamId: string;
        authorId: string;
        idea: Idea;
        isAutonomous?: boolean;
        requesterId?: string;
      };
    }
  | {
      type: "IDEA_EVALUATED";
      payload: {
        teamId: string;
        evaluatorId: string;
        ideaId: number;
        ideaAuthorId: string;
        evaluation: any;
        isAutonomous?: boolean;
        requesterId?: string;
      };
    }
  | {
      type: "FEEDBACK_GIVEN";
      payload: {
        teamId: string;
        feedbackerId: string;
        targetId: string;
        content: string;
        targetIdeaId?: number;
        isAutonomous?: boolean;
      };
    }
  | {
      type: "REQUEST_MADE";
      payload: {
        teamId: string;
        requesterId: string;
        targetId: string;
        requestType: string;
        content: string;
      };
    }
  | {
      type: "CHAT_MESSAGE_SENT";
      payload: {
        teamId: string;
        senderId: string;
        message: ChatMessage;
      };
    }
  | {
      type: "FEEDBACK_SESSION_ENDED";
      payload: {
        teamId: string;
        sessionId: string;
        session: any;
        summary: string;
        keyPoints: string[];
      };
    }
  | {
      type: "FEEDBACK_SESSION_COMPLETED";
      payload: {
        teamId: string;
        sessionId: string;
        session: any;
        summary: string;
        keyPoints: string[];
      };
    };

/**
 * 액션 완료 시 모든 관련 에이전트의 메모리를 업데이트하는 중앙 함수
 * @param event 발생한 이벤트
 */
export async function processMemoryUpdate(event: MemoryEvent): Promise<void> {
  try {
    console.log("📝 메모리 업데이트 시작:", event.type);

    if (event.type === "IDEA_GENERATED") {
      const { teamId, authorId, idea, isAutonomous } = event.payload;

      // 메모리 업데이트 시작 - reflecting 상태로 전환
      await updateAgentState(
        teamId,
        authorId,
        "reflecting",
        "아이디어 생성 후 자기 성찰 중"
      );

      // 에이전트 프로필 정보 가져오기
      const agentProfile = await getAgentById(authorId);
      if (!agentProfile) {
        console.error(`❌ 에이전트 ${authorId} 프로필을 찾을 수 없음`);
        return;
      }

      // 팀 정보 가져오기
      const team = await getTeamById(teamId);
      if (!team) {
        console.error(`❌ 팀 ${teamId}를 찾을 수 없음`);
        return;
      }

      // 기존 메모리 가져오기
      let agentMemory = await getAgentMemory(authorId);

      // 메모리가 없으면 초기화
      if (!agentMemory) {
        agentMemory = await createInitialMemory(authorId, team);
      }

      // 자기 성찰 생성
      const selfReflectionPrompt = createSelfReflectionPrompt(
        agentProfile,
        team,
        idea,
        isAutonomous || false,
        typeof agentMemory.longTerm.self === "string" && agentMemory.longTerm.self.trim()
          ? agentMemory.longTerm.self
          : "아직 특별한 성찰 내용이 없습니다."
      );

      try {
        const reflection = await getTextResponse(selfReflectionPrompt);
        if (reflection && reflection.trim()) {
          // 기존 호환성 로직 적용
          if (typeof agentMemory.longTerm.self === "string") {
            agentMemory.longTerm.self = reflection.trim();
          } else if (Array.isArray(agentMemory.longTerm.self)) {
            // 배열인 경우 가장 최근 reflection으로 변환
            agentMemory.longTerm.self = reflection.trim();
          } else {
            agentMemory.longTerm.self = reflection.trim();
          }

          console.log(
            `✅ ${agentProfile.name} 아이디어 생성 후 자기 성찰 업데이트 완료`
          );
        }
      } catch (error) {
        console.error("❌ 자기 성찰 생성 실패:", error);
      }

      // lastAction 업데이트
      agentMemory.shortTerm.lastAction = {
        type: "IDEA_GENERATED",
        timestamp: new Date().toISOString(),
        payload: {
          ideaId: idea.id,
          ideaContent: idea.content.object,
          isAutonomous,
        },
      };

      // 메모리 저장
      await updateAgentMemory(authorId, agentMemory);

      // reflecting 완료 후 idle 상태로 전환
      await updateAgentState(teamId, authorId, "idle");

      console.log(`✅ ${agentProfile.name} 아이디어 생성 메모리 업데이트 완료`);
      return; // 특정 이벤트 처리 완료
    }

    // 🔒 피드백 세션 종료도 개별 처리
    if (
      event.type === "FEEDBACK_SESSION_ENDED" ||
      event.type === "FEEDBACK_SESSION_COMPLETED"
    ) {
      console.log(`📝 피드백 세션 종료: 개별 처리`);
      if (event.type === "FEEDBACK_SESSION_ENDED") {
        await handleFeedbackSessionEnded(event.payload);

        // 🔄 피드백 세션 종료 후 팀 전체 상태 정리
        console.log(`🔄 피드백 세션 종료 후 팀 전체 상태 정리 시작`);
        await cleanupTeamAgentStatesAfterFeedbackSession(event.payload.teamId);
      }
      return; // 개별 처리 완료
    }

    // 다른 이벤트 타입들은 기존 방식으로 처리 (팀 전체)
    // 팀 정보 조회
    const team = await getTeamById(event.payload.teamId);
    if (!team) {
      console.error(`팀을 찾을 수 없음: ${event.payload.teamId}`);
      return;
    }

    // 에이전트 ID 목록 추출 (사용자 제외)
    const agentIds = team.members
      .filter((member) => !member.isUser && member.agentId)
      .map((member) => member.agentId!);

    if (agentIds.length === 0) {
      console.log("업데이트할 에이전트가 없음");
      return;
    }

    console.log(`📝 ${agentIds.length}개 에이전트 메모리 업데이트 시작`);

    // 모든 에이전트의 메모리를 병렬로 업데이트
    const updateResults = await Promise.allSettled(
      agentIds.map((agentId) => updateAgentMemoryForEvent(agentId, event, team))
    );

    // 결과 확인
    const successful = updateResults.filter(
      (result) => result.status === "fulfilled"
    ).length;
    const failed = updateResults.filter(
      (result) => result.status === "rejected"
    ).length;

    console.log(
      `✅ 메모리 업데이트 완료: ${successful}성공, ${failed}실패 (총 ${agentIds.length}개)`
    );

    if (failed > 0) {
      const errors = updateResults
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason);
      console.error("실패한 메모리 업데이트 오류들:", errors);
    }
  } catch (error) {
    console.error(`❌ 메모리 업데이트 실패: ${event.type}`, error);
  }
}

/**
 * 에이전트 상태를 업데이트하는 헬퍼 함수
 */
async function updateAgentState(
  teamId: string,
  agentId: string,
  state: "idle" | "plan" | "action" | "reflecting",
  taskDescription?: string
): Promise<void> {
  try {
    // 직접 함수 호출로 변경 (HTTP 호출 대신)
    const { setAgentState, createNewIdleTimer } = await import("@/lib/agent-state-utils");

    const stateData = {
      agentId,
      currentState: state,
      lastStateChange: new Date().toISOString(),
      isProcessing: state !== "idle",
      ...(state === "idle" && { idleTimer: createNewIdleTimer() }),
      ...(taskDescription && {
        currentTask: {
          type: state === "reflecting" ? "reflecting" : "thinking",
          description: taskDescription || (state === "reflecting" ? "경험을 바탕으로 자기 성찰 중" : ""),
          startTime: new Date().toISOString(),
          estimatedDuration: state === "reflecting" ? 10 : 30,
          trigger: "autonomous",
        }
      })
    };

    await setAgentState(teamId, agentId, stateData);
  } catch (error) {
    console.error(`에이전트 ${agentId} 상태 업데이트 오류:`, error);
  }
}

/**
 * 개별 에이전트의 메모리를 이벤트에 따라 업데이트
 */
async function updateAgentMemoryForEvent(
  agentId: string,
  event: MemoryEvent,
  team: Team
): Promise<void> {
  try {
    console.log(
      `🔧 에이전트 ${agentId} 메모리 업데이트 시작 (이벤트: ${event.type})`
    );

    // 🔒 피드백 세션 중인지 확인
    const teamId = (event.payload as any).teamId || team.id;
    const { getAgentState, isFeedbackSessionActive } = await import(
      "@/lib/agent-state-utils"
    );

    const currentState = await getAgentState(teamId, agentId);
    const isInFeedbackSession =
      currentState && isFeedbackSessionActive(currentState);

    const isInPlanningState = currentState && currentState.currentState === "plan";
    
    if (isInFeedbackSession) {
      console.log(
        `🔒 에이전트 ${agentId}는 피드백 세션 중이므로 reflecting 상태 전환 스킵 (메모리 업데이트는 진행)`
      );
    } else if (isInPlanningState) {
      // planning 중인 경우 회고를 큐에 추가
      console.log(
        `📋 에이전트 ${agentId}는 planning 중이므로 retrospective를 큐에 추가`
      );
      await queueRetrospective(teamId, agentId, event);
      return; // 메모리 업데이트는 나중에 큐에서 처리할 때 진행
    } else {
      // 피드백 세션 중이 아니고 planning 중이 아닌 경우에만 회고 상태로 변경
      await updateAgentState(teamId, agentId, "reflecting");
    }

    // 메모리 조회 또는 생성
    let memory = await getAgentMemory(agentId);
    if (!memory) {
      console.log(
        `💡 에이전트 ${agentId}의 메모리가 실제로 없음 - 초기화 시작`
      );
      memory = await createInitialMemory(agentId, team);
      console.log(`✅ 초기 메모리 생성 완료: ${agentId}`);
    } else {
      console.log(`✅ 에이전트 ${agentId}의 기존 메모리 발견 - 업데이트 진행`);
      console.log(
        `📊 메모리 상태: self="${
          typeof memory.longTerm.self === "string"
            ? memory.longTerm.self.substring(0, 50)
            : JSON.stringify(memory.longTerm.self).substring(0, 50)
        }...", relations=${Object.keys(memory.longTerm.relations).length}개`
      );

      // 기존 배열 형태의 self를 문자열로 마이그레이션
      if (Array.isArray(memory.longTerm.self)) {
        console.log(
          `🔄 에이전트 ${agentId} self 메모리 마이그레이션: 배열 -> 문자열`
        );
        const reflections = memory.longTerm.self as any[];
        if (reflections.length > 0) {
          // 가장 최근 reflection을 문자열로 사용
          const latestReflection = reflections[reflections.length - 1];
          memory.longTerm.self =
            typeof latestReflection === "string"
              ? latestReflection
              : latestReflection.reflection ||
                "팀에서 활동하며 다양한 경험을 쌓고 있습니다.";
        } else {
          memory.longTerm.self =
            "팀에 새로 합류했습니다. 앞으로 팀원들과 좋은 관계를 맺고 협력하여 좋은 결과를 만들어가고 싶습니다.";
        }
        console.log(
          `✅ 마이그레이션 완료: "${memory.longTerm.self.substring(0, 50)}..."`
        );
      }
    }

    // 이벤트 타입에 따른 메모리 업데이트 (항상 수행)
    try {
      const eventType = event.type;
      switch (eventType) {
        case "IDEA_GENERATED":
          await updateMemoryForIdeaGeneration(memory, event.payload, agentId);
          break;
        case "IDEA_EVALUATED":
          await updateMemoryForIdeaEvaluation(memory, event.payload, agentId);
          break;
        case "FEEDBACK_GIVEN":
          await updateMemoryForFeedback(memory, event.payload, agentId);
          break;
        case "REQUEST_MADE":
          await updateMemoryForRequest(memory, event.payload, agentId);
          break;
        case "CHAT_MESSAGE_SENT":
          await updateMemoryForChatMessage(memory, event.payload, agentId);
          break;
        case "FEEDBACK_SESSION_COMPLETED":
          await updateMemoryForFeedbackSessionCompleted(
            memory,
            event.payload,
            agentId
          );
          break;
        default:
          console.warn(`알 수 없는 이벤트 타입: ${eventType}`);
          // 🔒 피드백 세션 중이 아닌 경우에만 idle 전환
          if (!isInFeedbackSession) {
            await updateAgentState(teamId, agentId, "idle");
          }
          return;
      }
      console.log(`✅ ${agentId} 이벤트 처리 완료: ${eventType}`);
    } catch (eventError) {
      console.error(
        `❌ ${agentId} 이벤트 처리 실패 (${event.type}):`,
        eventError
      );
      // 이벤트 처리 실패해도 메모리는 저장 시도
    }

    // 메모리 압축 확인 및 적용 (항상 수행)
    try {
      const beforeRelationsCount = Object.values(
        memory.longTerm.relations
      ).reduce((sum, rel) => sum + rel.interactionHistory.length, 0);

      memory = await compressLongTermMemory(memory);

      const afterRelationsCount = Object.values(
        memory.longTerm.relations
      ).reduce((sum, rel) => sum + rel.interactionHistory.length, 0);

      if (beforeRelationsCount !== afterRelationsCount) {
        console.log(
          `🗜️ ${agentId} 메모리 압축 수행: relations ${beforeRelationsCount}->${afterRelationsCount}`
        );
      } else {
        console.log(`✅ ${agentId} 메모리 압축 불필요 (크기 적절)`);
      }
    } catch (compressionError) {
      console.error(`❌ ${agentId} 메모리 압축 실패:`, compressionError);
      // 압축 실패해도 원본 메모리는 저장
    }

    // 메모리 저장 (항상 수행)
    await updateAgentMemory(agentId, memory);
    console.log(`✅ 에이전트 ${agentId} 메모리 업데이트 완료`);

    // 🔒 reflecting 완료 후 피드백 세션 중이 아닌 경우에만 idle 상태로 전환
    if (!isInFeedbackSession) {
      await updateAgentState(teamId, agentId, "idle");
    } else {
      console.log(
        `🔒 에이전트 ${agentId}는 피드백 세션 중이므로 idle 전환 스킵 (메모리 업데이트는 완료)`
      );
    }
  } catch (error) {
    console.error(`❌ ${agentId} 메모리 업데이트 실패:`, error);
  }
}

/**
 * 아이디어 생성에 대한 메모리 업데이트
 */
async function updateMemoryForIdeaGeneration(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const { authorId, idea, isAutonomous, requesterId } = payload;

  // Short-term memory 업데이트
  if (currentAgentId === authorId) {
    // 아이디어를 생성한 에이전트
    memory.shortTerm.lastAction = {
      type: isAutonomous
        ? "autonomous_idea_generation"
        : "requested_idea_generation",
      timestamp: new Date().toISOString(),
      payload: {
        ideaId: idea.id,
        ideaTitle: idea.content.object,
        requesterId: requesterId || null,
      },
    };

    // Long-term self reflection은 요청받았을 때만 업데이트
    if (!isAutonomous && requesterId) {
      const requesterName = await getAgentNameById(requesterId);
      const newReflection = await generateSelfReflection(
        memory.longTerm.self,
        `Generated the idea "${idea.content.object}" based on ${requesterName}'s request. I felt proud to be able to help by responding to a teammate's request. I want to continue maintaining a cooperative attitude while valuing teamwork.`,
        "requested_idea_generation"
      );
      memory.longTerm.self = newReflection;
    }
  } else {
    // 다른 에이전트가 아이디어를 생성한 경우
    const authorName = await getAgentNameById(authorId);

    // 관계 메모리 업데이트
    const relationKey = getRelationKey(authorId);
    if (memory.longTerm.relations[relationKey]) {
      memory.longTerm.relations[relationKey].interactionHistory.push({
        action: "generated_idea",
        content: `${authorName} generated the idea "${idea.content.object}".`,
        timestamp: new Date().toISOString(),
      });

      // LLM을 사용하여 관계에 대한 의견 업데이트
      await updateRelationOpinion(
        memory.longTerm.relations[relationKey],
        "아이디어 생성을 목격"
      );
    }
  }
}

/**
 * 아이디어 평가에 대한 메모리 업데이트
 */
async function updateMemoryForIdeaEvaluation(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const {
    evaluatorId,
    ideaId,
    ideaAuthorId,
    evaluation,
    isAutonomous,
    requesterId,
  } = payload;

  if (currentAgentId === evaluatorId) {
    // 평가를 한 에이전트
    memory.shortTerm.lastAction = {
      type: isAutonomous ? "autonomous_evaluation" : "requested_evaluation",
      timestamp: new Date().toISOString(),
      payload: {
        ideaId,
        authorId: ideaAuthorId,
        scores: evaluation.scores,
        requesterId: requesterId || null,
      },
    };

    // 요청받아서 평가한 경우에만 self reflection 업데이트
    if (!isAutonomous && requesterId) {
      const requesterName = await getAgentNameById(requesterId);
      const newReflection = await generateSelfReflection(
        memory.longTerm.self,
        `I evaluated an idea upon ${requesterName}'s request. I strived to provide an objective and fair assessment, aiming to help the team through constructive evaluation. I believe responding sincerely to others' requests is fundamental to good teamwork.`,
        "requested_evaluation"
      );
      memory.longTerm.self = newReflection;
    }

    // 평가받은 사람과의 관계 업데이트
    const relationKey = getRelationKey(ideaAuthorId);
    if (memory.longTerm.relations[relationKey]) {
      // Generate full evaluation summary instead of just insights
      const evaluationSummary = `Evaluated their idea with scores: Novelty ${evaluation.scores.novelty}/7, Completeness ${evaluation.scores.completeness}/7, Quality ${evaluation.scores.quality}/7. Comment: ${evaluation.comment || 'No additional comments'}`;
      
      memory.longTerm.relations[relationKey].interactionHistory.push({
        action: "evaluated_their_idea",
        content: evaluationSummary,
        timestamp: new Date().toISOString(),
      });

      await updateRelationOpinion(
        memory.longTerm.relations[relationKey],
        "provided idea evaluation"
      );
    }
  } else if (currentAgentId === ideaAuthorId) {
    // 평가를 받은 에이전트 - self reflection 업데이트
    const evaluatorName = await getAgentNameById(evaluatorId);

    memory.shortTerm.lastAction = {
      type: "received_evaluation",
      timestamp: new Date().toISOString(),
      payload: {
        evaluatorId,
        ideaId,
        scores: evaluation.scores,
      },
    };

    // 평가를 받았을 때 self reflection 업데이트
    const newReflection = await generateSelfReflection(
      memory.longTerm.self,
      `My idea was evaluated by ${evaluatorName}. Receiving feedback from different perspectives is valuable for improving my ideas. I will deeply reflect on the evaluation and find areas for improvement to create better ideas in the future.`,
      "received_evaluation"
    );
    memory.longTerm.self = newReflection;

    // 평가자와의 관계 업데이트
    const relationKey = getRelationKey(evaluatorId);
    if (memory.longTerm.relations[relationKey]) {
      // Generate full evaluation summary instead of just insights
      const receivedEvaluationSummary = `Received evaluation on my idea with scores: Novelty ${evaluation.scores.novelty}/7, Completeness ${evaluation.scores.completeness}/7, Quality ${evaluation.scores.quality}/7. Comment: ${evaluation.comment || 'No additional comments'}`;
      
      memory.longTerm.relations[relationKey].interactionHistory.push({
        action: "received_evaluation_from",
        content: receivedEvaluationSummary,
        timestamp: new Date().toISOString(),
      });

      await updateRelationOpinion(
        memory.longTerm.relations[relationKey],
        "received evaluation"
      );
    }
  } else {
    // 제3자가 평가를 관찰한 경우
    const evaluatorName = await getAgentNameById(evaluatorId);
    const authorName = await getAgentNameById(ideaAuthorId);

    // 두 관계 모두 업데이트 (있다면)
    const evaluatorKey = getRelationKey(evaluatorId);
    const authorKey = getRelationKey(ideaAuthorId);

    if (memory.longTerm.relations[evaluatorKey]) {
      memory.longTerm.relations[evaluatorKey].interactionHistory.push({
        action: "observed_evaluation_by",
        content: `${evaluatorName}이 ${authorName}의 아이디어를 평가하는 것을 목격`,
        timestamp: new Date().toISOString(),
      });
    }

    if (memory.longTerm.relations[authorKey]) {
      memory.longTerm.relations[authorKey].interactionHistory.push({
        action: "observed_evaluation_of",
        content: `${authorName}의 아이디어가 ${evaluatorName}에 의해 평가받는 것을 목격`,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

/**
 * 피드백에 대한 메모리 업데이트
 */
async function updateMemoryForFeedback(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const { feedbackerId, targetId, content, targetIdeaId, isAutonomous } =
    payload;

  if (currentAgentId === feedbackerId) {
    // 피드백을 한 에이전트
    memory.shortTerm.lastAction = {
      type: isAutonomous ? "autonomous_feedback" : "requested_feedback",
      timestamp: new Date().toISOString(),
      payload: {
        targetId,
        content,
        targetIdeaId,
      },
    };

    // 자율적이지 않은 피드백(요청받은 피드백)인 경우에만 self reflection 업데이트
    if (!isAutonomous) {
      const targetName = await getAgentNameById(targetId);
      const newReflection = await generateSelfReflection(
        memory.longTerm.self,
        `${targetName}에게 피드백을 제공했습니다. 건설적인 피드백으로 팀에 도움이 되고자 했습니다. 다른 사람의 성장을 돕는 것이 팀워크의 중요한 부분이라고 생각하며, 앞으로도 진심어린 조언을 아끼지 않겠습니다.`,
        "gave_feedback"
      );
      memory.longTerm.self = newReflection;
    }
  } else if (currentAgentId === targetId) {
    // 피드백을 받은 에이전트 - self reflection 업데이트
    const feedbackerName = await getAgentNameById(feedbackerId);

    memory.shortTerm.lastAction = {
      type: "received_feedback",
      timestamp: new Date().toISOString(),
      payload: {
        feedbackerId,
        content,
        targetIdeaId,
      },
    };

    // 피드백을 받았을 때 self reflection 업데이트
    const newReflection = await generateSelfReflection(
      memory.longTerm.self,
      `${feedbackerName}로부터 피드백을 받았습니다. 다른 사람의 관점과 조언이 매우 도움이 됩니다. 받은 피드백을 겸허히 받아들이고 성장의 기회로 삼아 더 나은 모습이 되도록 노력하겠습니다.`,
      "received_feedback"
    );
    memory.longTerm.self = newReflection;
  }
}

/**
 * 요청에 대한 메모리 업데이트
 */
async function updateMemoryForRequest(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const { requesterId, targetId, requestType, content } = payload;

  if (currentAgentId === requesterId) {
    // 요청을 한 에이전트
    const targetName = await getAgentNameById(targetId);

    memory.shortTerm.lastAction = {
      type: "made_request",
      timestamp: new Date().toISOString(),
      payload: {
        targetId,
        requestType,
        content,
      },
    };

    // 요청을 했을 때는 self reflection 업데이트하지 않음 (응답을 받았을 때만)
  } else if (currentAgentId === targetId) {
    // 요청을 받은 에이전트 - self reflection 업데이트
    const requesterName = await getAgentNameById(requesterId);

    memory.shortTerm.lastAction = {
      type: "received_request",
      timestamp: new Date().toISOString(),
      payload: {
        requesterId,
        requestType,
        content,
      },
    };

    // 요청을 받았을 때 self reflection 업데이트
    const newReflection = await generateSelfReflection(
      memory.longTerm.self,
      `${requesterName}로부터 ${requestType} 요청을 받았습니다. 팀원의 요청에 성실히 응답하는 것이 중요하다고 생각합니다. 서로 도움을 주고받는 협력적인 관계를 통해 더 좋은 결과를 만들어가고 싶습니다.`,
      "received_request"
    );
    memory.longTerm.self = newReflection;
  }
}

/**
 * 채팅 메시지에 대한 메모리 업데이트
 */
async function updateMemoryForChatMessage(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const { senderId, message } = payload;

  if (currentAgentId !== senderId) {
    // 다른 사람의 메시지를 관찰
    memory.shortTerm.activeChat = {
      targetAgentId: senderId,
      messages: [message], // 최근 메시지만 저장
    };
  }
}

/**
 * LLM을 사용하여 관계에 대한 의견을 업데이트
 */
async function updateRelationOpinion(
  relation: RelationalMemory,
  context: string
): Promise<void> {
  try {
    const recentInteractions = relation.interactionHistory.slice(-5); // 최근 5개 상호작용

    if (recentInteractions.length === 0) {
      console.log("상호작용 기록이 없어 관계 의견 업데이트 생략");
      return;
    }

    const prompt = createRelationOpinionPrompt(relation, context);

    const response = await getTextResponse(prompt);
    if (response && response.trim()) {
      relation.myOpinion = response.trim();
      console.log(`✅ 관계 의견 업데이트 성공: ${relation.agentInfo.name}`);
    } else {
      console.log("❌ LLM 응답이 비어있어 관계 의견 업데이트 생략");
    }
  } catch (error) {
    console.error("관계 의견 업데이트 실패:", error);
    // 실패해도 기존 의견 유지하며 계속 진행
  }
}

/**
 * 반성적 자기 성찰을 생성하는 함수
 */
async function generateSelfReflection(
  currentReflection: string,
  newExperience: string,
  triggeringEvent: string
): Promise<string> {
  try {
    const prompt = createDeepSelfReflectionPrompt(
      currentReflection,
      newExperience,
      triggeringEvent
    );

    const response = await getTextResponse(prompt);
    if (response && response.trim()) {
      return response.trim();
    } else {
      // LLM 실패 시 기본 성찰 반환
      return currentReflection || newExperience;
    }
  } catch (error) {
    console.error("Self reflection 생성 실패:", error);
    // 실패 시 기존 성찰 유지하거나 새 경험으로 대체
    return currentReflection || newExperience;
  }
}

/**
 * Long-term memory를 압축하고 요약
 */
async function compressLongTermMemory(
  memory: AgentMemory
): Promise<AgentMemory> {
  // Self reflection은 이미 단일 문자열이므로 압축 불필요
  console.log(
    `✅ ${memory.agentId} Self reflection은 단일 문자열로 압축 불필요`
  );

  // 관계별 상호작용 히스토리 압축
  for (const [relationKey, relation] of Object.entries(
    memory.longTerm.relations
  )) {
    if (relation.interactionHistory.length > 30) {
      try {
        console.log(
          `🗜️ ${relationKey} 관계 히스토리 압축 시작: ${relation.interactionHistory.length}개`
        );

        const oldInteractions = relation.interactionHistory.slice(0, -10);
        const recentInteractions = relation.interactionHistory.slice(-10);

        const prompt = createMemoryCompressionPrompt(
          relation.agentInfo.name,
          oldInteractions
        );

        const response = await getTextResponse(prompt);
        if (response && response.trim()) {
          try {
            // JSON 파싱 시도
            const cleanedResponse = response
              .replace(/```json\n?|```/g, "")
              .trim();
            const parsedResponse = JSON.parse(cleanedResponse);
            if (Array.isArray(parsedResponse) && parsedResponse.length > 0) {
              memory.longTerm.relations[relationKey].interactionHistory = [
                ...parsedResponse,
                ...recentInteractions,
              ];
              console.log(
                `✅ ${relationKey} 관계 히스토리 압축 완료: ${oldInteractions.length} -> ${parsedResponse.length}`
              );
            } else {
              console.log(
                `❌ ${relationKey} 관계 히스토리 압축 실패 - 원본 유지`
              );
            }
          } catch (parseError) {
            console.error(`JSON 파싱 실패 for ${relationKey}:`, parseError);
            console.log(
              `❌ ${relationKey} 관계 히스토리 압축 실패 - 원본 유지`
            );
          }
        } else {
          console.log(`❌ ${relationKey} 관계 히스토리 압축 실패 - 원본 유지`);
        }
      } catch (error) {
        console.error(`관계 ${relationKey} 상호작용 압축 실패:`, error);
        // 실패 시 원본 유지
      }
    }
  }

  return memory;
}

/**
 * 초기 메모리 생성
 */
async function createInitialMemory(
  agentId: string,
  team: Team
): Promise<AgentMemory> {
  console.log(`🧠 에이전트 ${agentId} 초기 메모리 생성`);

  const agentProfile = await getAgentById(agentId);
  if (!agentProfile) {
    throw new Error(`에이전트 프로필을 찾을 수 없습니다: ${agentId}`);
  }

  const relations: Record<string, RelationalMemory> = {};

  for (const member of team.members) {
    if (member.agentId === agentId) continue; // 자기 자신 제외

    let otherAgentId: string;
    let otherAgentName: string;
    let otherAgentProfile: any;

    if (member.isUser) {
      otherAgentId = "Me";
      otherAgentName = "Me";
      // Check if user is actually the leader
      const userRole = false /* member.isLeader removed */ ? "팀 리더" : "팀원";
      const userSkills = false /* member.isLeader removed */ ? "리더십" : "협업";
      otherAgentProfile = {
        id: "Me",
        name: "Me",
        professional: userRole,
        personality: "알 수 없음",
        skills: userSkills,
      };
    } else {
      otherAgentId = member.agentId!;
      const otherAgent = await getAgentById(otherAgentId);
      if (!otherAgent) continue;

      otherAgentName = otherAgent.name;
      otherAgentProfile = {
        id: otherAgent.id,
        name: otherAgent.name,
        professional: otherAgent.professional,
        personality: otherAgent.personality,
        skills: otherAgent.skills,
      };
    }

    const relationship = team.relationships.find(
      (rel) =>
        (rel.from === agentProfile.name && rel.to === otherAgentName) ||
        (rel.from === otherAgentName && rel.to === agentProfile.name)
    );

    const relationKey = member.isUser ? "Me" : otherAgentId;
    relations[relationKey] = {
      agentInfo: otherAgentProfile,
      relationship: relationship ? relationship.type : "NULL",
      interactionHistory: [],
      myOpinion: "아직 상호작용이 없어 의견이 없습니다.",
    };
  }

  return {
    agentId,
    shortTerm: {
      lastAction: null,
      activeChat: null,
      feedbackSessionChat: null,
    },
    longTerm: {
      self: "팀에 새로 합류했습니다. 앞으로 팀원들과 좋은 관계를 맺고 협력하여 좋은 결과를 만들어가고 싶습니다.", // 초기 성찰
      relations,
    },
  };
}

/**
 * 에이전트 이름 조회 헬퍼
 */
async function getAgentNameById(agentId: string): Promise<string> {
  if (agentId === "Me") return "Me";

  const agent = await getAgentById(agentId);
  return agent?.name || `에이전트 ${agentId}`;
}

/**
 * 관계 키 생성 헬퍼
 */
function getRelationKey(agentId: string): string {
  return agentId === "Me" ? "Me" : agentId;
}

// Legacy compatibility functions

export async function createAgentMemory(
  agent: AIAgent,
  team: Team
): Promise<AgentMemory> {
  return createInitialMemory(agent.id, team);
}

// 피드백 세션 메시지 처리 - 외부에서 직접 호출 가능하도록 export
export async function handleFeedbackSessionMessage(payload: {
  teamId: string;
  sessionId: string;
  participantId: string;
  message: any;
  otherParticipants: any[];
}): Promise<void> {
  const { teamId, sessionId, participantId, message, otherParticipants } =
    payload;

  // 사용자의 경우 메모리 업데이트하지 않음
  if (participantId === "Me") {
    return;
  }

  try {
    const memory = await getAgentMemory(participantId);
    if (!memory) {
      console.log(`❌ 에이전트 ${participantId} 메모리를 찾을 수 없음`);
      return;
    }

    // Short-term memory에 피드백 세션 전용 채팅 저장
    if (!memory.shortTerm.feedbackSessionChat) {
      memory.shortTerm.feedbackSessionChat = {
        sessionId,
        targetAgentId: otherParticipants[0]?.id || "unknown",
        targetAgentName: otherParticipants[0]?.name || "unknown",
        messages: [],
      };
    }

    // 현재 세션이 진행 중이면 메시지 추가
    if (memory.shortTerm.feedbackSessionChat.sessionId === sessionId) {
      // 에이전트 이름 조회
      const senderName =
        message.sender === participantId
          ? memory.shortTerm.feedbackSessionChat.targetAgentName || "Me"
          : (async () => {
              if (message.sender === "Me") return "Me";
              const senderAgent = await getAgentById(message.sender);
              return senderAgent?.name || message.sender;
            })();

      const resolvedSenderName =
        typeof senderName === "string" ? senderName : await senderName;

      // 피드백 세션 메시지를 간단한 형태로 저장
      const sessionMessage = {
        id: message.id,
        sender: message.sender,
        senderName: resolvedSenderName,
        content: message.content,
        timestamp: message.timestamp,
      };

      memory.shortTerm.feedbackSessionChat.messages.push(sessionMessage);

      // 메시지가 너무 많으면 최근 20개만 유지 (피드백 세션은 길어질 수 있음)
      if (memory.shortTerm.feedbackSessionChat.messages.length > 20) {
        memory.shortTerm.feedbackSessionChat.messages =
          memory.shortTerm.feedbackSessionChat.messages.slice(-20);
      }
    }

    // Last action 업데이트
    memory.shortTerm.lastAction = {
      type: "feedback_session_participate",
      timestamp: new Date().toISOString(),
      payload: {
        sessionId,
        messageContent: message.content,
        participants: otherParticipants.map((p) => p.name),
      },
    };

    await updateAgentMemory(participantId, memory);
    console.log(`✅ 피드백 세션 메시지 메모리 업데이트 완료: ${participantId}`);
  } catch (error) {
    console.error(
      `❌ 피드백 세션 메시지 메모리 업데이트 실패 (${participantId}):`,
      error
    );
  }
}

// 피드백 세션 종료 처리
async function handleFeedbackSessionEnded(payload: {
  teamId: string;
  sessionId: string;
  session: any;
  summary: string;
  keyPoints: string[];
}): Promise<void> {
  const { teamId, sessionId, session, summary, keyPoints } = payload;

  console.log(`🏁 피드백 세션 종료 메모리 처리 시작: ${sessionId}`);

  for (const participant of session.participants) {
    // 사용자의 경우 메모리 업데이트하지 않음
    if (participant.id === "Me") {
      continue;
    }

    try {
      const memory = await getAgentMemory(participant.id);
      if (!memory) {
        console.log(`❌ 에이전트 ${participant.id} 메모리를 찾을 수 없음`);
        continue;
      }

      // Short-term memory의 feedbackSessionChat을 Long-term memory로 이동
      if (
        memory.shortTerm.feedbackSessionChat &&
        memory.shortTerm.feedbackSessionChat.sessionId === sessionId
      ) {
        // 피드백 세션 대화 내용을 요약하여 저장
        const sessionMessages = memory.shortTerm.feedbackSessionChat.messages;
        const conversationText = sessionMessages
          .map((msg) => `${msg.senderName}: ${msg.content}`)
          .join("\n");

        // Long-term memory에 세션 상세 정보 추가
        const sessionDate = new Date(session.createdAt).toLocaleDateString();
        const sessionTime = new Date(session.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });

        // Self memory에 피드백 세션 경험 추가
        const sessionExperience =
          `\n\n[피드백 세션 ${sessionDate} ${sessionTime}]\n` +
          `참가자: ${session.participants
            .map((p: any) => p.name)
            .join(", ")}\n` +
          `지속 시간: ${Math.floor(
            (new Date(session.endedAt).getTime() -
              new Date(session.createdAt).getTime()) /
              (1000 * 60)
          )}분\n` +
          `요약: ${summary}\n` +
          `주요 포인트: ${keyPoints.join("; ")}\n` +
          `전체 대화:\n${conversationText}\n` +
          `이 세션을 통해 동료와 깊이 있는 대화를 나누며 서로의 관점을 이해할 수 있었습니다.`;

        memory.longTerm.self += sessionExperience;

        // Short-term feedbackSessionChat 클리어
        memory.shortTerm.feedbackSessionChat = null;
      }

      // Active chat도 클리어 (기존 로직 유지)
      memory.shortTerm.activeChat = null;

      // 다른 참가자들과의 관계 업데이트
      for (const otherParticipant of session.participants) {
        if (
          otherParticipant.id !== participant.id &&
          otherParticipant.id !== "Me"
        ) {
          if (!memory.longTerm.relations[otherParticipant.id]) {
            // 새로운 관계 생성
            const otherAgent = await getAgentById(otherParticipant.id);
            memory.longTerm.relations[otherParticipant.id] = {
              agentInfo: {
                id: otherParticipant.id,
                name: otherParticipant.name,
                professional: otherAgent?.professional || "",
                personality: otherAgent?.personality || "",
                skills: otherAgent?.skills || "",
              },
              relationship: "NULL",
              interactionHistory: [],
              myOpinion: "",
            };
          }

          // 상호작용 기록에 상세한 피드백 세션 정보 추가
          memory.longTerm.relations[
            otherParticipant.id
          ].interactionHistory.push({
            timestamp: new Date().toISOString(),
            action: "participated_in_feedback_session",
            content: `피드백 세션에서 ${Math.floor(
              (new Date(session.endedAt).getTime() -
                new Date(session.createdAt).getTime()) /
                (1000 * 60)
            )}분간 대화함. 요약: ${summary}. 주요 포인트: ${keyPoints.join(
              ", "
            )}`,
          });

          // 대화 내용을 바탕으로 관계 의견도 업데이트
          try {
            const myMessages = session.messages.filter(
              (msg: any) =>
                msg.sender === participant.id && msg.type === "message"
            );
            const theirMessages = session.messages.filter(
              (msg: any) =>
                msg.sender === otherParticipant.id && msg.type === "message"
            );

            if (myMessages.length > 0 && theirMessages.length > 0) {
              const conversationContext = `피드백 세션에서 ${
                otherParticipant.name
              }과 ${
                myMessages.length + theirMessages.length
              }개의 메시지를 주고받았습니다. 주요 내용: ${summary}`;
              await updateRelationOpinion(
                memory.longTerm.relations[otherParticipant.id],
                conversationContext
              );
            }
          } catch (opinionError) {
            console.error(
              `관계 의견 업데이트 실패 (${participant.id} -> ${otherParticipant.id}):`,
              opinionError
            );
          }

          // 상호작용 기록이 너무 많으면 최근 20개만 유지
          if (
            memory.longTerm.relations[otherParticipant.id].interactionHistory
              .length > 20
          ) {
            memory.longTerm.relations[otherParticipant.id].interactionHistory =
              memory.longTerm.relations[
                otherParticipant.id
              ].interactionHistory.slice(-20);
          }
        }
      }

      await updateAgentMemory(participant.id, memory);
      console.log(
        `✅ 피드백 세션 종료 메모리 업데이트 완료: ${participant.id}`
      );
    } catch (error) {
      console.error(
        `❌ 피드백 세션 종료 메모리 업데이트 실패 (${participant.id}):`,
        error
      );
    }
  }
}

/**
 * 피드백 세션 종료 후 팀 전체 에이전트 상태 정리
 * reflecting 상태에 머물러 있는 에이전트들을 idle로 복구
 */
async function cleanupTeamAgentStatesAfterFeedbackSession(
  teamId: string
): Promise<void> {
  try {
    const { getAgentState, setAgentState, createNewIdleTimer } = await import(
      "@/lib/agent-state-utils"
    );

    // 팀 정보 조회
    const team = await getTeamById(teamId);
    if (!team) {
      console.error(`❌ 팀을 찾을 수 없음: ${teamId}`);
      return;
    }

    // 에이전트 ID 목록 추출 (사용자 제외)
    const agentIds = team.members
      .filter((member) => !member.isUser && member.agentId)
      .map((member) => member.agentId!);

    if (agentIds.length === 0) {
      console.log("정리할 에이전트가 없음");
      return;
    }

    console.log(`🔄 ${agentIds.length}개 에이전트 상태 정리 시작`);

    // 현재 활성 피드백 세션 목록 조회
    const activeSessions = await redis.smembers(
      `team:${teamId}:active_feedback_sessions`
    );
    const agentsInFeedbackSession = new Set<string>();

    for (const sessionId of activeSessions) {
      const sessionData = await redis.get(`feedback_session:${sessionId}`);
      if (sessionData) {
        const session =
          typeof sessionData === "string"
            ? JSON.parse(sessionData)
            : sessionData;
        if (session.status === "active") {
          for (const participant of session.participants) {
            if (!participant.isUser && participant.id !== "Me") {
              agentsInFeedbackSession.add(participant.id);
            }
          }
        }
      } else {
        // 존재하지 않는 세션은 set에서 제거
        redis.srem(`team:${teamId}:active_feedback_sessions`, sessionId);
      }
    }

    // 각 에이전트 상태 확인 및 정리
    let cleanedCount = 0;
    for (const agentId of agentIds) {
      try {
        // 피드백 세션 중인 에이전트는 건드리지 않음
        if (agentsInFeedbackSession.has(agentId)) {
          console.log(`🔒 ${agentId}는 피드백 세션 중이므로 상태 정리 스킵`);
          continue;
        }

        const currentState = await getAgentState(teamId, agentId);
        if (!currentState) {
          console.log(`⚠️ ${agentId} 상태 정보 없음 - 스킵`);
          continue;
        }

        // reflecting 상태인 에이전트만 idle로 복구
        if (currentState.currentState === "reflecting") {
          console.log(`🔄 ${agentId} reflecting → idle 상태 복구`);

          // API를 통한 강제 상태 변경 시도
          let apiSuccess = false;
          try {
            const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
            const response = await fetch(
              `${baseUrl}/api/teams/${teamId}/agent-states`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "User-Agent": "TeamBuilder-Internal",
                },
                body: JSON.stringify({
                  agentId,
                  currentState: "idle",
                  forceClear: true,
                }),
              }
            );

            if (response.ok) {
              apiSuccess = true;
              console.log(`✅ ${agentId} API를 통한 상태 복구 성공`);
            } else {
              console.warn(
                `⚠️ ${agentId} API를 통한 상태 복구 실패: ${response.status}`
              );
            }
          } catch (apiError) {
            console.warn(`⚠️ ${agentId} API 호출 오류:`, apiError);
          }

          // API 실패시 직접 상태 변경 시도
          if (!apiSuccess) {
            console.log(`🔄 ${agentId} 직접 상태 변경 시도`);

            const newState = {
              ...currentState,
              currentState: "idle" as const,
              lastStateChange: new Date().toISOString(),
              isProcessing: false,
              idleTimer: createNewIdleTimer(),
            };

            // currentTask와 plannedAction 제거
            delete newState.currentTask;
            delete newState.plannedAction;

            await setAgentState(teamId, agentId, newState);
            console.log(`✅ ${agentId} 직접 상태 복구 성공`);
          }

          cleanedCount++;
        }
      } catch (error) {
        console.error(`❌ ${agentId} 상태 정리 실패:`, error);
      }
    }

    console.log(`✅ 팀 상태 정리 완료: ${cleanedCount}개 에이전트 복구됨`);
  } catch (error) {
    console.error(`❌ 팀 상태 정리 실패:`, error);
  }
}

/**
 * 피드백 세션 종료에 대한 메모리 업데이트
 */
async function updateMemoryForFeedbackSessionCompleted(
  memory: AgentMemory,
  payload: any,
  currentAgentId: string
): Promise<void> {
  const {
    sessionId,
    participantId,
    otherParticipant,
    summary,
    keyInsights,
    targetIdea,
    messageCount,
  } = payload;

  if (currentAgentId === participantId) {
    // 피드백 세션에 참가한 에이전트
    memory.shortTerm.lastAction = {
      type: "completed_feedback_session",
      timestamp: new Date().toISOString(),
      payload: {
        sessionId,
        otherParticipantId: otherParticipant?.id,
        summary,
        keyInsights,
        messageCount,
      },
    };

    // 피드백 세션 완료 후 self reflection 업데이트
    const otherParticipantName = otherParticipant?.name || "동료";
    const newReflection = await generateSelfReflection(
      memory.longTerm.self,
      `${otherParticipantName}와 피드백 세션을 완료했습니다. ${messageCount}개의 메시지를 주고받으며 깊이 있는 대화를 나누었습니다. 요약: ${summary}. 주요 통찰: ${keyInsights.join(
        ", "
      )}. 이런 진솔한 대화를 통해 서로를 더 잘 이해하게 되었고, 팀워크가 한층 더 향상되었다고 느낍니다.`,
      "feedback_session_completed"
    );
    memory.longTerm.self = newReflection;

    // 상대방과의 관계 업데이트
    if (otherParticipant && otherParticipant.id !== "user") {
      const relationKey = getRelationKey(otherParticipant.id);
      if (memory.longTerm.relations[relationKey]) {
        memory.longTerm.relations[relationKey].interactionHistory.push({
          action: "completed_feedback_session",
          content: `피드백 세션 완료. ${messageCount}개 메시지 교환. 핵심 내용: ${summary}`,
          timestamp: new Date().toISOString(),
        });

        await updateRelationOpinion(
          memory.longTerm.relations[relationKey],
          `피드백 세션을 통한 깊이 있는 대화`
        );
      }
    }
  }
}

// 유틸리티: 에이전트 ID로부터 팀 ID 추출
async function extractTeamIdFromAgentId(
  agentId: string
): Promise<string | null> {
  try {
    const { redis } = await import("@/lib/redis");

    // Redis에서 agent_state 키 패턴으로 팀 ID 찾기
    // 패턴: agent_state:teamId:agentId
    const stateKeys = await redis.keys(`agent_state:*:${agentId}`);

    if (stateKeys.length > 0) {
      // 첫 번째 키에서 팀 ID 추출
      const keyParts = stateKeys[0].split(":");
      if (keyParts.length >= 3) {
        const teamId = keyParts[1]; // agent_state:{teamId}:agentId
        return teamId;
      }
    }

    return null;
  } catch (error) {
    console.error(`❌ ${agentId} 팀 ID 추출 오류:`, error);
    return null;
  }
}

/**
 * Planning 중인 에이전트의 retrospective를 큐에 추가
 */
async function queueRetrospective(
  teamId: string,
  agentId: string,
  memoryEvent: MemoryEvent
): Promise<void> {
  try {
    // retrospective 요청 생성
    const retrospectiveRequest = {
      id: `retro_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      type: "retrospective",
      requesterName: "System",
      payload: {
        message: "Memory update retrospective",
        memoryEvent: memoryEvent,
      },
      timestamp: new Date().toISOString(),
      teamId: teamId,
    };

    // Redis 큐에 추가 (기존 요청 시스템과 동일한 방식)
    const queueKey = `agent_queue:${teamId}:${agentId}`;
    await redis.lpush(queueKey, JSON.stringify(retrospectiveRequest));
    
    console.log(`✅ ${agentId} retrospective Redis 큐에 추가됨 (key: ${queueKey})`);
  } catch (error) {
    console.error(`❌ ${agentId} retrospective 큐잉 실패:`, error);
  }
}
