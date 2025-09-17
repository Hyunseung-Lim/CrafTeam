import {
  getTeamById,
  getAgentById,
  getIdeas,
  addIdea,
  addChatMessage,
  getAgentMemory,
  redis,
} from "@/lib/redis";
import { getNewAgentMemory, triggerMemoryUpdate } from "@/lib/memory-v2";
import { canCreateFeedbackSession } from "@/lib/relationship-utils";
import {
  makeRequestAction,
} from "@/lib/openai";
import {
  getAgentState,
  setAgentState,
  isFeedbackSessionActive,
  createNewIdleTimer,
} from "@/lib/agent-state-utils";

// 실제 에이전트 작업 실행 함수
export async function executeAgentAction(
  teamId: string,
  agentId: string,
  plannedAction: {
    action:
      | "generate_idea"
      | "evaluate_idea"
      | "give_feedback"
      | "make_request"
      | "wait";
    reasoning: string;
    target?: string;
  }
) {
  try {
    const team = await getTeamById(teamId);
    const baseAgentProfile = await getAgentById(agentId);

    if (!team || !baseAgentProfile) {
      console.error(`❌ ${agentId} 팀 또는 에이전트 정보 없음`);
      return;
    }

    // TeamMember 정보로 agentProfile 강화 (isLeader, roles 포함)
    const teamMember = team.members.find((m) => m.agentId === agentId);
    const agentProfile = {
      ...baseAgentProfile,
      roles: teamMember?.roles || [],
      // isLeader: teamMember?.isLeader || false // removed unused property
    };


    console.log(
      `🎯 ${agentProfile.name} 자율 행동 실행: ${plannedAction.action}`
    );

    if (plannedAction.action === "generate_idea") {
      await executeGenerateIdeaAction(teamId, agentId, team, agentProfile);
    }

    if (plannedAction.action === "evaluate_idea") {
      await executeEvaluateIdeaAction(
        teamId,
        agentId,
        team,
        agentProfile,
        false
      );
    }

    if (plannedAction.action === "give_feedback") {
      await executeGiveFeedbackAction(teamId, agentId, team, agentProfile);
    }

    if (plannedAction.action === "make_request") {
      await executeMakeRequestAction(
        teamId,
        agentId,
        team,
        agentProfile,
        plannedAction
      );
    }
  } catch (error) {
    console.error(`❌ ${agentId} 작업 실행 실패:`, error);
    await handleExecutionFailure(teamId, agentId, error);
  }
}

// 아이디어 생성 액션 실행
async function executeGenerateIdeaAction(
  teamId: string,
  agentId: string,
  team: any,
  agentProfile: any
) {
  try {
    const ideas = await getIdeas(teamId);
  
  // Helper function to get author name
  const getAuthorName = async (authorId: string) => {
    if (authorId === "Me") return "Me";
    
    const member = team?.members.find((m: any) => m.agentId === authorId);
    if (member && !member.isUser) {
      // Find agent profile
      const agent = await getAgentById(authorId);
      return agent?.name || `에이전트 ${authorId}`;
    }
    
    return authorId;
  };

  const existingIdeas = await Promise.all(ideas.map(async (idea, index) => ({
    ideaNumber: index + 1,
    authorName: await getAuthorName(idea.author),
    object: idea.content.object,
    function: idea.content.function,
    behavior: idea.content.behavior,
    structure: idea.content.structure,
  })));

  const agentMemory = await getAgentMemory(agentId);
  
  // 큐에서 대기 중인 요청 확인
  const queueKey = `agent_queue:${teamId}:${agentId}`;
  const queuedRequest = await redis.lindex(queueKey, -1); // 마지막 요청 확인 (제거하지 않음)
  
  let requestMessage = "자율적 아이디어 생성";
  
  if (queuedRequest) {
    try {
      const requestData = typeof queuedRequest === "string" ? JSON.parse(queuedRequest) : queuedRequest;
      if (requestData?.type === "generate_idea" && requestData?.payload?.message) {
        requestMessage = requestData.payload.message;
        console.log(`📋 ${agentProfile.name} 큐에서 아이디어 생성 요청 발견: "${requestMessage}"`);
        
        // 사용된 요청은 큐에서 제거
        await redis.rpop(queueKey);
      }
    } catch (error) {
      console.error("❌ 큐 요청 파싱 실패:", error);
    }
  }
  
  // Pre-stage: Analyze and develop strategy
  const { preIdeationAction } = await import("@/lib/openai");
  const preAnalysis = await preIdeationAction(
    requestMessage,
    existingIdeas,
    agentProfile,
    agentMemory || undefined
  );
  
  // Execute with strategy
  const { executeIdeationAction } = await import("@/lib/openai");
  const generatedContent = await executeIdeationAction(
    preAnalysis.decision,
    preAnalysis.ideationStrategy,
    team.topic || "Carbon Emission Reduction",
    preAnalysis.decision === "Update" ? preAnalysis.referenceIdea : undefined,
    agentProfile,
    agentMemory || undefined
  );

  await addIdea(teamId, {
    author: agentId,
    timestamp: new Date().toISOString(),
    content: {
      object: generatedContent.object || "Generated Idea",
      function: generatedContent.function || "Function Description",
      behavior:
        typeof generatedContent.behavior === "object"
          ? JSON.stringify(generatedContent.behavior)
          : generatedContent.behavior || "Behavior Description",
      structure:
        typeof generatedContent.structure === "object"
          ? JSON.stringify(generatedContent.structure)
          : generatedContent.structure || "Structure Description",
    },
    evaluations: [],
  });

  await addChatMessage(teamId, {
    sender: agentId,
    type: "system",
    payload: {
      content: preAnalysis.decision === "Update"
        ? `Generated a new idea by updating an existing one.`
        : `Generated a new idea.`,
    },
  });

  // v2 메모리 업데이트
  try {
    await triggerMemoryUpdate(
      agentId,
      "idea_evaluation", // 아이디어 생성 후 회고
      `Generated a new idea: "${generatedContent.object}" (strategy: ${preAnalysis.ideationStrategy})`,
      undefined,
      teamId
    );
    // console.log(
    //   `✅ 자율적 아이디어 생성 후 v2 메모리 업데이트 성공: ${agentId} -> idea ${newIdea.id}`
    // );
  } catch (memoryError) {
    console.error(
      "❌ 자율적 아이디어 생성 후 v2 메모리 업데이트 실패:",
      memoryError
    );
  }

  console.log(
    `✅ ${agentProfile.name} 아이디어 생성 완료:`,
    generatedContent.object
  );

  // 작업 완료 후 idle 상태로 전환
  await setAgentState(teamId, agentId, {
    agentId,
    currentState: "idle",
    lastStateChange: new Date().toISOString(),
    isProcessing: false,
    idleTimer: createNewIdleTimer(),
  });
  
  console.log(`🔄 에이전트 ${agentId} idle 상태로 전환 완료`);
  } catch (error) {
    console.error(`❌ ${agentProfile.name} 아이디어 생성 실패:`, error);
    
    // 오류 발생 시에도 idle 상태로 전환
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    
    console.log(`🔄 에이전트 ${agentId} 오류 후 idle 상태로 전환 완료`);
  }
}

// 아이디어 평가 액션 실행
async function executeEvaluateIdeaAction(
  teamId: string,
  agentId: string,
  team: any,
  agentProfile: any,
  skipChatMessage: boolean = false
) {
  // Helper function to get author name
  const getAuthorName = (authorId: string) => {
    if (authorId === "Me") return "Me";
    
    const member = team?.members.find((m: any) => m.agentId === authorId);
    if (member && !member.isUser) {
      // Find agent profile in team members or use the current agentProfile if it matches
      return agentProfile?.id === authorId ? agentProfile.name : `에이전트 ${authorId}`;
    }
    
    return authorId;
  };
  
  // Get agent memory for context
  const memory = await getAgentMemory(agentId);
  const ideas = await getIdeas(teamId);

  if (ideas.length === 0) {
    console.log(`⚠️ ${agentProfile.name} 평가할 아이디어가 없음`);
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    return;
  }

  const otherIdeas = ideas.filter((idea) => idea.author !== agentId);

  if (otherIdeas.length === 0) {
    console.log(`⚠️ 에이전트 ${agentId} 평가할 다른 사람의 아이디어가 없음`);
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    return;
  }

  const unevaluatedIdeas = otherIdeas.filter((idea) => {
    const hasAlreadyEvaluated = idea.evaluations.some(
      (evaluation) => evaluation.evaluator === agentId
    );
    return !hasAlreadyEvaluated;
  });

  if (unevaluatedIdeas.length === 0) {
    console.log(
      `⚠️ 에이전트 ${agentId} 평가할 새로운 아이디어가 없음 (모두 평가 완료)`
    );
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    return;
  }

  await setAgentState(teamId, agentId, {
    agentId,
    currentState: "action",
    lastStateChange: new Date().toISOString(),
    isProcessing: true,
    currentTask: {
      type: "evaluate_idea",
      description: `아이디어 평가`,
      startTime: new Date().toISOString(),
      estimatedDuration: 300,
    },
  });

  const randomIdea =
    unevaluatedIdeas[Math.floor(Math.random() * unevaluatedIdeas.length)];

  console.log(
    `📊 ${agentProfile.name} → ${randomIdea.content.object} 평가 시작`
  );

  const selectedIdea = {
    ...randomIdea,
    authorName: getAuthorName(randomIdea.author)
  };

  try {
    // Pre-stage: Analyze and develop evaluation strategy
    const { preEvaluationAction } = await import("@/lib/openai");
    const allIdeas = ideas.map((idea, index) => ({
      ideaNumber: index + 1,
      authorName: getAuthorName(idea.author),
      object: idea.content.object,
      function: idea.content.function
    }));
    
    // 큐에서 대기 중인 평가 요청 확인
    const queueKey = `agent_queue:${teamId}:${agentId}`;
    const queuedRequest = await redis.lindex(queueKey, -1);
    
    let requestMessage = "자율적 아이디어 평가";
    
    if (queuedRequest) {
      try {
        const requestData = typeof queuedRequest === "string" ? JSON.parse(queuedRequest) : queuedRequest;
        if (requestData?.type === "evaluate_idea" && requestData?.payload?.message) {
          requestMessage = requestData.payload.message;
          console.log(`📋 ${agentProfile.name} 큐에서 아이디어 평가 요청 발견: "${requestMessage}"`);
          
          // 사용된 요청은 큐에서 제거
          await redis.rpop(queueKey);
        }
      } catch (error) {
        console.error("❌ 큐 요청 파싱 실패:", error);
      }
    }
    
    const preAnalysis = await preEvaluationAction(
      requestMessage,
      allIdeas,
      agentProfile,
      memory || undefined
    );
    
    // Execute with strategy
    const { executeEvaluationAction } = await import("@/lib/openai");
    const evaluation = await executeEvaluationAction(
      selectedIdea,
      preAnalysis.evaluationStrategy,
      agentProfile,
      memory || undefined
    );

    const response = await fetch(
      `${
        process.env.NEXTAUTH_URL || "http://localhost:3000"
      }/api/teams/${teamId}/ideas/${randomIdea.id}/evaluate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TeamBuilder-Internal",
        },
        body: JSON.stringify({
          evaluator: agentId,
          scores: {
            novelty: evaluation.scores.novelty,
            completeness: evaluation.scores.completeness,
            quality: evaluation.scores.quality,
          },
          comment: evaluation.comment,
        }),
      }
    );

    if (response.ok) {
      console.log(`✅ ${agentProfile.name} 아이디어 평가 완료`);

      // skipChatMessage가 true이면 채팅 메시지를 보내지 않음 (요청 처리에서 별도로 처리)
      if (!skipChatMessage) {
        await addChatMessage(teamId, {
          sender: agentId,
          type: "system",
          payload: {
            content: `Evaluated an idea.`,
          },
        });
      }

      // v2 메모리 업데이트
      try {
        await triggerMemoryUpdate(
          agentId,
          "idea_evaluation",
          `I evaluated "${selectedIdea.content.object}" by ${selectedIdea.authorName} using strategy: ${preAnalysis.evaluationStrategy}. Scores: novelty=${evaluation.scores.novelty}, completeness=${evaluation.scores.completeness}, quality=${evaluation.scores.quality}`,
          selectedIdea.author !== "Me" ? selectedIdea.author : undefined,
          teamId
        );
        console.log(
          `✅ 아이디어 평가 후 v2 메모리 업데이트 성공: ${agentId}`
        );
      } catch (memoryError) {
        console.error(
          "❌ 아이디어 평가 후 v2 메모리 업데이트 실패:",
          memoryError
        );
      }
    } else {
      console.error(`❌ ${agentProfile.name} 평가 저장 실패:`, response.status);
    }
  } catch (evaluationError) {
    console.error(`❌ ${agentProfile.name} 평가 수행 실패:`, evaluationError);
    
    // 오류 발생 시에도 idle 상태로 전환
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    
    console.log(`🔄 에이전트 ${agentId} 오류 후 idle 상태로 전환 완료`);
    return; // 오류 후 함수 종료
  }

  console.log(`✅ 에이전트 ${agentId} 아이디어 평가 요청 처리 완료`);

  // 작업 완료 후 idle 상태로 전환
  await setAgentState(teamId, agentId, {
    agentId,
    currentState: "idle",
    lastStateChange: new Date().toISOString(),
    isProcessing: false,
    idleTimer: createNewIdleTimer(),
  });
  
  console.log(`🔄 에이전트 ${agentId} idle 상태로 전환 완료`);
}

// 피드백 제공 액션 실행
async function executeGiveFeedbackAction(
  teamId: string,
  agentId: string,
  team: any,
  agentProfile: any
) {
  console.log(`💬 ${agentProfile.name} 피드백 세션 시작 로직`);

  const ideas = await getIdeas(teamId);

  if (ideas.length === 0) {
    console.log(`⚠️ ${agentProfile.name} 피드백할 아이디어가 없음`);
    return;
  }

  const otherIdeas = ideas.filter((idea) => idea.author !== agentId);

  if (otherIdeas.length === 0) {
    console.log(`⚠️ ${agentProfile.name} 피드백할 다른 사람의 아이디어가 없음`);
    return;
  }

  const agents = await Promise.all(
    (team?.members || [])
      .filter((m: any) => !m.isUser && m.agentId)
      .map((m: any) => getAgentById(m.agentId!))
  );
  const validAgents = agents.filter((agent) => agent !== null);

  const otherMembers = team.members.filter(
    (member: any) => !member.isUser && member.agentId !== agentId
  );

  if (otherMembers.length === 0) {
    console.log(`⚠️ ${agentProfile.name} 피드백할 다른 팀원이 없음`);
    return;
  }

  // 피드백 세션을 생성할 수 있는 관계인 팀원들만 필터링
  
  const availableMembers = otherMembers.filter((member: any) => {
    const canCreate = canCreateFeedbackSession(agentId, member.agentId!, team);
    console.log(`🎯 ${agentProfile.name} → ${member.name || member.agentId}: ${canCreate ? '✅ 가능' : '❌ 불가능'}`);
    return canCreate;
  });

  console.log(`📋 피드백 가능한 팀원: ${availableMembers.length}명`, availableMembers.map((m: any) => m.name || m.agentId));

  if (availableMembers.length === 0) {
    console.log(`⚠️ ${agentProfile.name} 피드백 세션을 생성할 수 있는 관계인 팀원이 없음`);
    
    // 에이전트를 idle 상태로 전환
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    
    return;
  }

  const targetMember =
    availableMembers[Math.floor(Math.random() * availableMembers.length)];
  const targetAgent = validAgents.find(
    (a: any) => a.id === targetMember.agentId
  );

  if (!targetAgent) {
    console.log(`⚠️ ${agentProfile.name} 대상 에이전트를 찾을 수 없음`);
    return;
  }

  console.log(`✅ ${agentProfile.name} → ${targetAgent.name} 피드백 가능한 관계 확인됨`);

  console.log(`🎯 ${agentProfile.name} → ${targetAgent.name} 피드백 세션 생성`);

  // 락 키 생성
  const lockKey = `feedback_lock:${[agentId, targetAgent.id].sort().join(":")}`;

  const lockAcquired = await redis.set(lockKey, "locked", {
    ex: 30,
    nx: true,
  });

  if (!lockAcquired) {
    console.log(
      `⚠️ ${agentProfile.name} → ${targetAgent.name} 피드백 세션 락 획득 실패`
    );
    await handleLockFailure(teamId, agentId, agentProfile.name);
    return;
  }

  try {
    await createFeedbackSession(teamId, agentId, targetAgent, agentProfile, team, otherIdeas);
  } finally {
    await redis.del(lockKey);
    console.log(`🔓 ${agentProfile.name} → ${targetAgent.name} 락 해제`);
  }
}

// 피드백 세션 생성
async function createFeedbackSession(
  teamId: string,
  agentId: string,
  targetAgent: any,
  agentProfile: any,
  team: any,
  otherIdeas: any[]
) {
  const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:3000`;
  const sessionResponse = await fetch(
    `${baseUrl}/api/teams/${teamId}/feedback-sessions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "TeamBuilder-Internal",
      },
      body: JSON.stringify({
        action: "create",
        initiatorId: agentId,
        targetAgentId: targetAgent.id,
        message: await generateInitialFeedbackMessage(agentId, agentProfile, team, otherIdeas),
        feedbackContext: {
          type: "general_feedback",
          initiatedBy: "ai",
          description: "일반적인 협업과 팀워크에 대한 피드백",
        },
      }),
    }
  );

  if (sessionResponse.ok) {
    const sessionData = await sessionResponse.json();
    console.log(
      `✅ ${agentProfile.name} → ${targetAgent.name} 피드백 세션 생성 성공: ${sessionData.sessionId}`
    );

    await updateAgentStatesForFeedbackSession(
      teamId,
      agentId,
      targetAgent,
      agentProfile,
      sessionData.sessionId
    );

    // 첫 메시지 생성 트리거
    const delay = targetAgent.name === "Me" ? 1000 : 3000;
    setTimeout(async () => {
      await triggerFeedbackMessage(
        teamId,
        sessionData.sessionId,
        agentId,
        agentProfile.name,
        targetAgent.name
      );
    }, delay);
  } else {
    const errorData = await sessionResponse.json();
    console.error(
      `❌ ${agentProfile.name} → ${targetAgent.name} 피드백 세션 생성 실패:`,
      errorData
    );
    await handleSessionCreationFailure(teamId, agentId, agentProfile.name);
  }
}

// 피드백 세션을 위한 에이전트 상태 업데이트
async function updateAgentStatesForFeedbackSession(
  teamId: string,
  agentId: string,
  targetAgent: any,
  agentProfile: any,
  sessionId: string
) {
  const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:3000`;

  // 피드백 제공자 상태 변경
  try {
    const initiatorResponse = await fetch(
      `${baseUrl}/api/teams/${teamId}/agent-states`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TeamBuilder-Internal",
        },
        body: JSON.stringify({
          agentId: agentId,
          currentState: "feedback_session",
          taskType: "feedback_session",
          taskDescription: `${targetAgent.name}와 피드백 세션 진행 중`,
          estimatedDuration: 300,
          trigger: "autonomous",
          sessionInfo: {
            sessionId: sessionId,
            participants: [agentProfile.name, targetAgent.name],
          },
        }),
      }
    );

    if (initiatorResponse.ok) {
      console.log(`✅ ${agentProfile.name} 상태가 feedback_session으로 변경됨`);
    }
  } catch (error) {
    console.error(
      `❌ ${agentProfile.name} feedback_session 상태 변경 오류:`,
      error
    );
  }

  // 대상 에이전트 상태 변경 (인간이 아닌 경우만)
  if (targetAgent.name !== "Me") {
    try {
      const targetResponse = await fetch(
        `${baseUrl}/api/teams/${teamId}/agent-states`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "TeamBuilder-Internal",
          },
          body: JSON.stringify({
            agentId: targetAgent.id,
            currentState: "feedback_session",
            taskType: "feedback_session",
            taskDescription: `${agentProfile.name}와 피드백 세션 진행 중`,
            estimatedDuration: 300,
            trigger: "autonomous",
            sessionInfo: {
              sessionId: sessionId,
              participants: [agentProfile.name, targetAgent.name],
            },
          }),
        }
      );

      if (targetResponse.ok) {
        console.log(
          `✅ ${targetAgent.name} 상태가 feedback_session으로 변경됨`
        );
      }
    } catch (error) {
      console.error(
        `❌ ${targetAgent.name} feedback_session 상태 변경 오류:`,
        error
      );
    }
  }
}

// 피드백 메시지 트리거
async function triggerFeedbackMessage(
  teamId: string,
  sessionId: string,
  agentId: string,
  agentName: string,
  targetName: string
) {
  try {
    const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:3000`;
    const aiProcessResponse = await fetch(
      `${baseUrl}/api/teams/${teamId}/feedback-sessions/${sessionId}/ai-process`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "TeamBuilder-Internal",
        },
        body: JSON.stringify({
          triggerAgentId: agentId,
          action: "respond",
        }),
      }
    );

    if (aiProcessResponse.ok) {
      console.log(
        `✅ ${agentName} 첫 피드백 메시지 생성 트리거 성공 (대상: ${targetName})`
      );
    } else {
      console.error(
        `❌ ${agentName} 첫 피드백 메시지 생성 트리거 실패:`,
        aiProcessResponse.status
      );
    }
  } catch (error) {
    console.error(`❌ ${agentName} 첫 피드백 메시지 생성 트리거 오류:`, error);
  }
}

// 실행 실패 처리
async function handleExecutionFailure(teamId: string, agentId: string, error?: any) {
  console.log(`🔧 에이전트 ${agentId} 실행 실패 - 복구 시작`, { error: error?.message || 'Unknown error' });
  
  try {
    const currentState = await getAgentState(teamId, agentId);
    
    if (currentState && isFeedbackSessionActive(currentState)) {
      // 실제로 활성 피드백 세션이 존재하는지 확인
      const isActuallyInActiveSession = await verifyActiveFeedbackSession(teamId, agentId);
      
      if (isActuallyInActiveSession) {
        console.log(
          `🔒 에이전트 ${agentId}는 활성 피드백 세션 중이므로 실패 후에도 idle 전환 스킵`
        );
        return;
      } else {
        console.log(
          `🧹 에이전트 ${agentId}가 존재하지 않는 피드백 세션에 갇혀있음 - 강제 해제`
        );
      }
    }

    // 즉시 idle 상태로 전환 (딜레이 제거)
    await transitionToIdleState(teamId, agentId, "실패 후 복구");
    console.log(`✅ 에이전트 ${agentId} idle 상태 복구 완료`);
    
  } catch (recoveryError) {
    console.error(`❌ 에이전트 ${agentId} 복구 실패:`, recoveryError);
    
    // 복구 실패 시 강제 초기화 시도
    try {
      await setAgentState(teamId, agentId, {
        agentId,
        currentState: "idle",
        lastStateChange: new Date().toISOString(),
        isProcessing: false,
        idleTimer: createNewIdleTimer(),
      });
      console.log(`🛠️ 에이전트 ${agentId} 강제 초기화 완료`);
    } catch (forceError) {
      console.error(`💥 에이전트 ${agentId} 강제 초기화도 실패:`, forceError);
    }
  }
}

// 에이전트가 실제로 활성 피드백 세션에 참여 중인지 확인
async function verifyActiveFeedbackSession(teamId: string, agentId: string): Promise<boolean> {
  try {
    const { redis } = await import("@/lib/redis");
    
    // 활성 피드백 세션 목록 가져오기
    const activeSessionIds = await redis.smembers(`team:${teamId}:active_feedback_sessions`);
    
    for (const sessionId of activeSessionIds) {
      const sessionData = await redis.get(`feedback_session:${sessionId}`);
      if (sessionData) {
        const session = typeof sessionData === "string" ? JSON.parse(sessionData) : sessionData;
        
        // 에이전트가 이 세션에 참여 중이고 세션이 활성 상태인지 확인
        if (
          session.status === "active" &&
          session.participants.some((p: any) => p.id === agentId)
        ) {
          return true;
        }
      }
    }
    
    return false; // 활성 세션에 참여하지 않음
  } catch (error) {
    console.error(`❌ 피드백 세션 확인 실패 (${agentId}):`, error);
    return false; // 확인 실패 시 안전하게 해제 허용
  }
}

// 락 획득 실패 처리
async function handleLockFailure(
  teamId: string,
  agentId: string,
  _agentName: string
) {
  setTimeout(async () => {
    await transitionToIdleState(teamId, agentId, "락 획득 실패 후");
  }, 1000);
}

// 세션 생성 실패 처리
async function handleSessionCreationFailure(
  teamId: string,
  agentId: string,
  _agentName: string
) {
  setTimeout(async () => {
    await transitionToIdleState(teamId, agentId, "피드백 세션 생성 실패 후");
  }, 1000);
}

// idle 상태로 전환
async function transitionToIdleState(
  teamId: string,
  agentId: string,
  reason: string
) {
  try {
    const finalState = await getAgentState(teamId, agentId);
    if (finalState && isFeedbackSessionActive(finalState)) {
      console.log(
        `🔒 에이전트 ${agentId}는 여전히 피드백 세션 중이므로 ${reason} idle 전환 스킵`
      );
      return;
    }

    console.log(`😴 에이전트 ${agentId} → ${reason} Idle 상태 전환 시도 중...`);
    const baseUrl = process.env.NEXTAUTH_URL || `http://localhost:3000`;
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
        }),
      }
    );

    if (response.ok) {
      console.log(`😴 에이전트 ${agentId} → ${reason} Idle 상태 전환 완료`);
    } else {
      const errorText = await response.text();
      console.error(
        `❌ 에이전트 ${agentId} ${reason} Idle 전환 실패:`,
        response.status,
        errorText
      );
    }
  } catch (e) {
    console.error(`❌ 에이전트 ${agentId} ${reason} Idle 전환 실패:`, e);
  }
}

// 요청 만들기 액션 실행
async function executeMakeRequestAction(
  teamId: string,
  agentId: string,
  team: any,
  agentProfile: any,
  _plannedAction: any
) {
  try {
    console.log(`🎯 ${agentProfile.name} 자율적 요청 실행 시작`);

    // 상태를 action으로 설정
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "action",
      lastStateChange: new Date().toISOString(),
      isProcessing: true,
      currentTask: {
        type: "make_request",
        description: `자율적 요청`,
        startTime: new Date().toISOString(),
        estimatedDuration: 300,
        trigger: "autonomous",
      },
    });

    // 팀원 정보 준비 (에이전트 이름을 실제 이름으로 가져오기, 자기 자신 제외)
    const allTeamMembers = await Promise.all(team.members.map(async (member: any) => {
      if (member.isUser) {
        return {
          name: member.userProfile?.name || "Me",
          roles: member.roles.map((role: any) => role.toString()),
          isUser: true,
          agentId: undefined,
        };
      } else {
        // AI 에이전트인 경우 실제 이름 가져오기
        try {
          const agentData = await getAgentById(member.agentId);
          return {
            name: agentData?.name || member.agentId || "Unknown",
            roles: member.roles.map((role: any) => role.toString()),
            isUser: false,
            agentId: member.agentId || undefined,
          };
        } catch (error) {
          console.warn(`⚠️ 에이전트 ${member.agentId} 정보 로딩 실패:`, error);
          return {
            name: member.agentId || "Unknown",
            roles: member.roles.map((role: any) => role.toString()),
            isUser: false,
            agentId: member.agentId || undefined,
          };
        }
      }
    }));

    // 자기 자신을 제외한 팀원들만 요청 대상으로 선택
    const teamMembers = allTeamMembers.filter(member => {
      // 사용자는 제외하지 않음 (AI가 사용자에게 요청할 수 있음)
      if (member.isUser) return true;
      // AI 에이전트인 경우 자기 자신은 제외
      return member.agentId !== agentId;
    });

    // 요청할 수 있는 팀원이 없는 경우 중단
    if (teamMembers.length === 0) {
      console.log(`⚠️ ${agentProfile.name} 요청할 수 있는 팀원이 없음 (자기 자신 제외)`);
      
      // 상태를 idle로 되돌리기
      await setAgentState(teamId, agentId, {
        agentId,
        currentState: "idle",
        lastStateChange: new Date().toISOString(),
        isProcessing: false,
      });
      
      return;
    }

    // 현재 아이디어 정보 가져오기
    const ideas = await getIdeas(teamId);
    
    // Helper function to get author name
    const getAuthorName = async (authorId: string) => {
      if (authorId === "Me") return "Me";
      
      const member = team?.members.find((m: any) => m.agentId === authorId);
      if (member && !member.isUser) {
        // Find agent profile
        const agent = await getAgentById(authorId);
        return agent?.name || `에이전트 ${authorId}`;
      }
      
      return authorId;
    };

    const currentIdeas = await Promise.all(ideas.map(async (idea: any, index: number) => ({
      ideaNumber: index + 1,
      authorName: await getAuthorName(idea.author),
      object: idea.content.object,
      function: idea.content.function,
      behavior: idea.content.behavior,
      structure: idea.content.structure,
    })));

    // 에이전트 메모리 가져오기
    const agentMemory = await getAgentMemory(agentId);

    // 자율적 요청 실행
    const triggerContext =
      "팀 상황을 분석한 결과 다른 팀원에게 작업을 요청하기로 결정했습니다.";

    const requestResult = await makeRequestAction(
      triggerContext,
      teamMembers,
      currentIdeas,
      agentProfile,
      agentMemory || undefined,
      undefined,
      team.sharedMentalModel,
      team // 관계 검증을 위한 팀 정보 전달
    );

    // 요청 결과 검증 및 디버깅
    console.log(`🔍 ${agentProfile.name} 요청 결과 구조:`, JSON.stringify(requestResult, null, 2));
    
    if (!requestResult) {
      throw new Error("No request result returned");
    }

    // 요청 실패한 경우 처리
    if (requestResult.success === false) {
      console.log(`⚠️ ${agentProfile.name} 요청 실패:`, requestResult.error);
      
      // 에이전트를 idle 상태로 전환
      await setAgentState(teamId, agentId, {
        agentId,
        currentState: "idle",
        lastStateChange: new Date().toISOString(),
        isProcessing: false,
        idleTimer: createNewIdleTimer(),
      });
      
      return;
    }

    // 성공한 경우 필수 필드 검증
    if (!requestResult.analysis || !requestResult.message) {
      console.log(`❌ ${agentProfile.name} 요청 결과 필드 누락:`);
      console.log(`- analysis exists: ${!!requestResult.analysis}`);
      console.log(`- message exists: ${!!requestResult.message}`);
      console.log(`- requestResult keys:`, Object.keys(requestResult));
      
      throw new Error("Invalid request result: missing required fields");
    }

    const messageContent = requestResult.message?.message || 
                          requestResult.message?.content || 
                          (typeof requestResult.message === 'string' ? requestResult.message : 
                           JSON.stringify(requestResult.message));

    if (!messageContent) {
      throw new Error("Request message content is empty or invalid");
    }

    console.log(`📝 요청 결과:`, {
      analysis: requestResult.analysis,
      messageType: typeof requestResult.message,
      messageContent: messageContent
    });

    // 채팅 메시지로 추가
    await addChatMessage(teamId, {
      sender: agentId,
      type: "make_request",
      payload: {
        type: "make_request",
        content: messageContent,
        mention: requestResult.analysis.targetMember,
        target: requestResult.analysis.targetMember,
        requestType: requestResult.analysis.requestType,
      },
    });

    console.log(`✅ ${agentProfile.name} 자율적 요청 완료:`, {
      target: requestResult.analysis.targetMember,
      type: requestResult.analysis.requestType,
      message: messageContent,
    });

    // v2 메모리 업데이트
    try {
      // 대상이 사용자인지 에이전트인지 확인하여 적절한 ID 설정
      const targetMember = teamMembers.find(m => m.name === requestResult.analysis.targetMember);
      const relatedAgentId = targetMember?.isUser ? "Me" : targetMember?.agentId;
      
      await triggerMemoryUpdate(
        agentId,
        "request",
        `I made a ${requestResult.analysis.requestType} request to ${requestResult.analysis.targetMember}: "${messageContent}"`,
        relatedAgentId,
        teamId
      );
      console.log(
        `✅ 자율적 요청 후 v2 메모리 업데이트 성공: ${agentId} -> ${requestResult.analysis.targetMember}`
      );
    } catch (memoryError) {
      console.error("❌ 자율적 요청 후 v2 메모리 업데이트 실패:", memoryError);
    }

    // 요청 처리는 채팅 API에서 자동으로 처리됨 (중복 메시지 방지를 위해 직접 호출 제거)
    console.log(
      `📨 자율적 요청이 채팅 메시지로 생성되었습니다. 채팅 API에서 요청을 자동 처리할 예정입니다.`
    );

    // 작업 완료 후 idle 상태로 전환
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    
    console.log(`🔄 에이전트 ${agentId} idle 상태로 전환 완료`);
  } catch (error) {
    console.error(`❌ ${agentProfile.name} 자율적 요청 실패:`, error);
    
    // 오류 발생 시에도 idle 상태로 전환
    await setAgentState(teamId, agentId, {
      agentId,
      currentState: "idle",
      lastStateChange: new Date().toISOString(),
      isProcessing: false,
      idleTimer: createNewIdleTimer(),
    });
    
    console.log(`🔄 에이전트 ${agentId} 오류 후 idle 상태로 전환 완료`);
    throw error;
  }
}

// 피드백 세션 시작을 위한 초기 피드백 메시지 생성
async function generateInitialFeedbackMessage(
  agentId: string,
  agentProfile: any,
  team: any,
  ideas: any[]
): Promise<string> {
  try {
    // 큐에서 대기 중인 피드백 요청 확인
    const teamId = team.id;
    const queueKey = `agent_queue:${teamId}:${agentId}`;
    const queuedRequest = await redis.lindex(queueKey, -1);
    
    let targetMember: any = null;
    
    if (queuedRequest) {
      try {
        const requestData = typeof queuedRequest === "string" ? JSON.parse(queuedRequest) : queuedRequest;
        if (requestData?.type === "give_feedback" && requestData?.payload?.targetAgentId) {
          // 요청에서 지정된 타겟으로 피드백
          const specifiedTarget = team?.members?.find((m: any) => m.agentId === requestData.payload.targetAgentId);
          if (specifiedTarget) {
            targetMember = specifiedTarget;
            console.log(`📋 ${agentProfile.name} 큐에서 피드백 요청 발견: ${requestData.payload.targetAgentId}에게 피드백`);
            
            // 사용된 요청은 큐에서 제거
            await redis.rpop(queueKey);
          }
        }
      } catch (error) {
        console.error("❌ 큐 요청 파싱 실패:", error);
      }
    }
    
    // 요청 기반이 아닌 경우 기존 랜덤 선택 로직 사용
    if (!targetMember) {
      const otherMembers = team?.members?.filter(
        (member: any) => member.isUser || member.agentId !== agentId
      ) || [];
      
      if (otherMembers.length === 0) {
        return `${agentProfile.name}이 팀 협업에 대한 피드백을 제공하고 싶어합니다.`;
      }

      // 랜덤하게 타겟 멤버 선택
      targetMember = otherMembers[Math.floor(Math.random() * otherMembers.length)];
    }
    
    let targetMemberName: string;
    if (targetMember.isUser) {
      // 사용자의 실제 이름 사용, 없으면 "Me"로 폴백
      targetMemberName = targetMember.userProfile?.name || "Me";
    } else {
      const targetAgent = await getAgentById(targetMember.agentId);
      targetMemberName = targetAgent?.name || targetMember.name;
    }
    
    // 해당 멤버가 낸 아이디어들 찾기
    const targetMemberIdeas = targetMember.isUser 
      ? ideas.filter(idea => idea.author === "Me")
      : ideas.filter(idea => idea.author === targetMember.agentId);
    
    // allIdeas 변수 정의 (전체 아이디어 리스트)
    const allIdeas = ideas;

    // agent 메모리 가져오기
    const agentMemory = await getNewAgentMemory(agentId);
    
    // 근본 해결: AI 판단 우회하고 실제 아이디어 개수로 직접 분기
    const hasActualIdeas = targetMemberIdeas.length > 0;
    console.log(`📊 직접 판단: ${targetMemberName}의 아이디어 ${targetMemberIdeas.length}개 → hasIdeas: ${hasActualIdeas}`);
    
    if (hasActualIdeas) {
      // 아이디어가 있는 경우: AI 기반 실제 피드백 생성
      const { giveFeedback } = await import("@/lib/openai");
      
      try {
        const feedbackResponse = await giveFeedback(
          targetMemberName,
          targetMemberIdeas,
          agentProfile,
          { topic: team.topic, teamMembers: team.members, relationships: team.relationships },
          agentMemory as any || undefined,
          targetMember.roles,
          allIdeas, // 전체 아이디어 리스트 전달
          { hasIdeas: true, feedbackFocus: "specific ideas", feedbackApproach: "constructive", keyPoints: "detailed feedback on ideas" }
        );
        
        return feedbackResponse.feedback || `안녕하세요, ${targetMemberName}님! 아이디어에 대한 피드백을 드리고 싶습니다.`;
      } catch (error) {
        console.error("AI 피드백 생성 실패:", error);
        const ideaList = targetMemberIdeas.map((idea, idx) => 
          `${idx + 1}. "${idea.content?.object || '제목 없음'}"`
        ).join(', ');
        return `안녕하세요, ${targetMemberName}님! ${agentProfile.name}입니다. 제출해주신 아이디어들(${ideaList})을 보고 몇 가지 피드백을 드리고 싶어서 연락드렸습니다.`;
      }
    } else {
      // 아이디어가 없는 경우: 역할과 협업 중심 피드백 (아이디어 부족 언급 금지)
      const roleText = targetMember.roles?.length > 0 
        ? `${targetMember.roles.join(', ')} 역할에서` 
        : '팀 활동에서';
      
      return `안녕하세요, ${targetMemberName}님! ${agentProfile.name}입니다. ${roleText}의 협업과 기여에 대해 이야기해보고 싶어서 연락드렸습니다.`;
    }
  } catch (error) {
    console.error("초기 피드백 메시지 생성 실패:", error);
    return `${agentProfile.name}이 피드백을 제공하고 싶어합니다.`;
  }
}
