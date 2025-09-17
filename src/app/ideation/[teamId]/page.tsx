"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTeamAction } from "@/actions/team.actions";
import { getUserAgentsAction } from "@/actions/agent.actions";
import {
  Team,
  AIAgent,
  Idea,
  ChatMessage,
  AgentMemory,
  AgentRole,
} from "@/lib/types";
import IdeaDetailModal from "@/components/IdeaDetailModal";
import ViewFeedbackSessionModal from "@/components/ViewFeedbackSessionModal";

// 분리된 컴포넌트와 유틸리티 import
import { useAgentStates } from "./hooks/useAgentStates";
import { getKoreanParticle } from "./utils/koreanUtils";
import Header from "./components/Header";
import TeamMembersList from "./components/TeamMembersList";
import ChatArea from "./components/ChatArea";
import IdeaList from "./components/IdeaList";
import AddIdeaModal from "./components/AddIdeaModal";
import MemoryModal from "./components/MemoryModal";

interface FeedbackTab {
  id: string;
  name: string;
  participantId: string;
  participantName: string;
  type: "user_to_ai" | "ai_to_user";
  sessionData?: any;
  isActive: boolean;
}

export default function IdeationPage() {
  const params = useParams();
  const { data: session } = useSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [agents, setAgents] = useState<AIAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [showIdeaDetailModal, setShowIdeaDetailModal] = useState(false);
  const [ideaDetailModalData, setIdeaDetailModalData] = useState<Idea | null>(
    null
  );
  const [currentIdeaIndex, setCurrentIdeaIndex] = useState(0);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [authorFilter, setAuthorFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<"latest" | "rating">("latest");
  const [isGeneratingIdea, setIsGeneratingIdea] = useState(false);
  const [showAddIdeaModal, setShowAddIdeaModal] = useState(false);
  const [addIdeaFormData, setAddIdeaFormData] = useState({
    object: "",
    function: "",
    behavior: "",
    structure: "",
  });
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  const [topic, setTopic] = useState("");
  const [generationProgress, setGenerationProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [generatingAgents, setGeneratingAgents] = useState<Set<string>>(
    new Set()
  );
  const [generatingViaRequestAgents, setGeneratingViaRequestAgents] = useState<
    Set<string>
  >(new Set());
  const [sseConnected, setSseConnected] = useState(false);
  const [isCreatingFeedbackSession, setIsCreatingFeedbackSession] = useState(false);

  // 채팅 기능 상태
  const [chatMode, setChatMode] = useState<"give_feedback" | "make_request">(
    "give_feedback"
  );
  const [mentionedAgent, setMentionedAgent] = useState<AIAgent | null>(null);
  const [requestType, setRequestType] = useState<
    "generate" | "evaluate" | "give_feedback" | null
  >(null);
  const [showMentionDropdown, setShowMentionDropdown] = useState(false);
  const [isSubmittingEvaluation, setIsSubmittingEvaluation] = useState(false);
  const [evaluatingViaRequestAgents, setEvaluatingViaRequestAgents] = useState<
    Set<string>
  >(new Set());
  const [evaluatingAutonomouslyAgents, setEvaluatingAutonomouslyAgents] =
    useState<Set<string>>(new Set());

  // 탭 시스템 상태
  const [activeTab, setActiveTab] = useState<"main" | string>("main");
  const [feedbackTabs, setFeedbackTabs] = useState<FeedbackTab[]>([]);

  // 피드백 세션 모달 상태
  const [showViewSessionModal, setShowViewSessionModal] = useState(false);
  const [viewingSessionId, setViewingSessionId] = useState<string | null>(null);
  const [useOriginalLayout, setUseOriginalLayout] = useState(false);

  // 활성 피드백 세션 상태
  const [activeFeedbackSessions, setActiveFeedbackSessions] = useState<
    string[]
  >([]);
  const [userInFeedbackSession, setUserInFeedbackSession] = useState(false);
  const [aiFeedbackSessions, setAiFeedbackSessions] = useState<
    Array<{
      id: string;
      participants: string[];
      startTime: string;
    }>
  >([]);
  const [checkedSessionIds, setCheckedSessionIds] = useState<Set<string>>(
    new Set()
  );
  const [notifiedSessionIds, setNotifiedSessionIds] = useState<Set<string>>(
    new Set()
  );

  // 에이전트 메모리 관련 상태
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [agentMemory, setAgentMemory] = useState<AgentMemory | null>(null);
  const [agentMemoryV2, setAgentMemoryV2] = useState<any | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [showMemoryModal, setShowMemoryModal] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const ideaListRef = useRef<HTMLDivElement | null>(null);

  const teamId = params.teamId as string;
  const { agentStates, userState, timers, isConnected } =
    useAgentStates(teamId);

  // 현재 팀에 속한 AI 에이전트만 필터링
  const teamAgents = agents.filter((agent) =>
    team?.members.some(
      (member) => !member.isUser && member.agentId === agent.id
    )
  );

  // 사용자 권한 확인
  const userMember = team?.members.find((member) => member.isUser);
  const userRoles = userMember?.roles || [];
  const userCanGenerateIdeas = userRoles.includes("Idea Generation");

  // 작성자 이름 가져오기 함수
  const getAuthorName = (authorId: string) => {
    if (authorId === "Me") {
      const userMember = team?.members.find((m) => m.isUser);
      return userMember?.userProfile?.name || "Me";
    }
    const member = team?.members.find((m) => m.agentId === authorId);
    if (member && !member.isUser) {
      const agent = agents.find((a) => a.id === authorId);
      return agent?.name || `Agent ${authorId}`;
    }
    return authorId;
  };

  // 에이전트가 특정 역할을 수행할 수 있는지 확인하는 함수
  const canAgentPerformRole = (
    agent: AIAgent,
    requestType: string
  ): boolean => {
    const roleMap = {
      generate: "Idea Generation" as AgentRole,
      evaluate: "Idea Evaluation" as AgentRole,
      give_feedback: "Feedback" as AgentRole,
    };
    const requiredRole = roleMap[requestType as keyof typeof roleMap];
    if (!requiredRole || !team) return false;
    const teamMember = team.members.find(
      (member) => member.agentId === agent.id
    );
    return teamMember ? teamMember.roles.includes(requiredRole) : false;
  };

  // 에이전트가 피드백 세션 중인지 확인하는 함수 (인간 포함)
  const isAgentInFeedbackSession = (agentId: string): boolean => {
    if (agentId === "Me") {
      // 인간 사용자의 경우
      return userState?.currentState === "feedback_session";
    } else {
      // AI 에이전트의 경우
      const agentState = agentStates.get(agentId);
      return agentState?.currentState === "feedback_session";
    }
  };

  // 아이디어 필터링 (생성 순서용)
  const ideasSortedByCreation = [...ideas].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Debug: Check for duplicate IDs
  console.log('🔍 All idea IDs:', ideas.map(idea => ({ id: idea.id, type: typeof idea.id })));
  const idCounts = ideas.reduce((acc, idea) => {
    acc[idea.id] = (acc[idea.id] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const duplicateIds = Object.entries(idCounts).filter(([id, count]) => count > 1);
  if (duplicateIds.length > 0) {
    console.error('❌ Duplicate idea IDs found:', duplicateIds);
  }

  // 평가 평균 점수 계산 함수
  const calculateAverageRating = (idea: Idea): number | null => {
    if (!idea.evaluations || idea.evaluations.length === 0) {
      return null;
    }
    
    const totalScores = idea.evaluations.reduce((sum, evaluation) => {
      return sum + evaluation.scores.novelty + evaluation.scores.completeness + evaluation.scores.quality;
    }, 0);
    
    const totalEvaluations = idea.evaluations.length * 3; // 3가지 평가 항목
    return totalScores / totalEvaluations;
  };

  // 정렬된 아이디어 목록
  const getSortedIdeas = () => {
    const filtered = ideas.filter((idea) => {
      if (authorFilter === "All") return true;
      const authorName = getAuthorName(idea.author);
      return authorName === authorFilter;
    });

    if (sortBy === "rating") {
      return filtered.sort((a, b) => {
        const avgA = calculateAverageRating(a);
        const avgB = calculateAverageRating(b);
        
        // 평가가 없는 아이디어는 가장 아래로
        if (avgA === null && avgB === null) return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(); // 최신순으로
        if (avgA === null) return 1;
        if (avgB === null) return -1;
        
        return avgB - avgA; // 높은 점수순
      });
    } else {
      return filtered.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()); // 최신순
    }
  };

  const sortedAndFilteredIdeas = getSortedIdeas();

  // 고유한 작성자 목록
  const uniqueAuthors = [
    "All",
    ...Array.from(new Set(ideas.map((idea) => getAuthorName(idea.author)))),
  ];

  // 선택된 요청 타입에 따라 필터링된 에이전트 목록
  const getFilteredAgentsForRequest = () => {
    if (chatMode !== "make_request" && chatMode !== "give_feedback") {
      return teamAgents;
    }
    return teamAgents.filter((agent) => {
      if (chatMode === "make_request" && requestType) {
        if (!canAgentPerformRole(agent, requestType)) {
          return false;
        }
      }
      const agentState = agentStates.get(agent.id);
      if (agentState?.currentState === "feedback_session") {
        return false;
      }
      
      // Check if user has a non-NULL relationship with this agent
      if (team && team.relationships) {
        const relationship = team.relationships.find(rel => 
          (rel.from === "Me" && (rel.to === agent.id || rel.to === agent.name || rel.to === `${agent.name}봇`)) ||
          (rel.to === "Me" && (rel.from === agent.id || rel.from === agent.name || rel.from === `${agent.name}봇`))
        );
        
        // If no relationship exists or relationship is NULL, prevent direct interaction
        if (!relationship || relationship.type === "NULL") {
          return false;
        }
      }
      
      return true;
    });
  };

  // 선택된 에이전트가 수행할 수 있는 요청 타입 목록
  const getAvailableRequestTypes = () => {
    if (!mentionedAgent) {
      return [
        { value: "generate", label: "Idea Generation" },
        { value: "evaluate", label: "Idea Evaluation" },
        { value: "give_feedback", label: "Feedback" },
      ];
    }
    const availableTypes = [];
    if (canAgentPerformRole(mentionedAgent, "generate")) {
      availableTypes.push({ value: "generate", label: "Idea Generation" });
    }
    if (canAgentPerformRole(mentionedAgent, "evaluate")) {
      availableTypes.push({ value: "evaluate", label: "Idea Evaluation" });
    }
    if (canAgentPerformRole(mentionedAgent, "give_feedback")) {
      availableTypes.push({ value: "give_feedback", label: "Feedback" });
    }
    return availableTypes;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 데이터 로드 함수들
  const loadIdeas = useCallback(async (teamId: string) => {
    try {
      const response = await fetch(
        `/api/teams/${teamId}/ideas?t=${new Date().getTime()}`
      );
      if (response.ok) {
        const data = await response.json();
        setIdeas(data.ideas || []);
        return (data.ideas || []).length;
      }
      return 0;
    } catch (error) {
      console.error("💡 아이디어 로드 실패:", error);
      return 0;
    }
  }, []);

  const loadMessages = useCallback(async (teamId: string) => {
    try {
      const response = await fetch(
        `/api/teams/${teamId}/chat?t=${new Date().getTime()}`
      );
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages || []);
      }
    } catch (error) {
      console.error("💬 채팅 메시지 로드 실패:", error);
    }
  }, []);

  // 탭 관리 함수들
  const createFeedbackTab = async (
    participantId: string,
    participantName: string,
    type: "user_to_ai" | "ai_to_user",
    sessionData?: any
  ) => {
    try {
      // 이미 생성 중인 경우 중복 요청 방지
      if (isCreatingFeedbackSession) {
        console.log("⚠️ 피드백 세션 생성 중 - 중복 요청 무시");
        return;
      }

      // 중복 탭 체크
      const existingTab = feedbackTabs.find(
        (tab) => tab.participantId === participantId && tab.type === type
      );
      if (existingTab) {
        setActiveTab(existingTab.id);
        return existingTab.id;
      }

      setIsCreatingFeedbackSession(true);

      const response = await fetch(`/api/teams/${team?.id}/feedback-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          initiatorId: "Me",
          targetAgentId: participantId,
          message: sessionData?.message,
          feedbackContext: {
            type: "general_feedback",
            initiatedBy: "user",
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 409 && errorData.busy) {
          let alertMessage = "";
          if (errorData.reason === "initiator_busy") {
            alertMessage =
              "Currently participating in another feedback session. Please end the existing session and try again.";
          } else if (errorData.reason === "target_busy") {
            alertMessage = `${participantName} is currently participating in another feedback session. Please try again later.`;
          } else {
            alertMessage = `${participantName} is currently participating in another feedback session. Please try again later.`;
          }
          alert(alertMessage);
          return null;
        }
        throw new Error(`Failed to create feedback session: ${response.status}`);
      }

      const result = await response.json();
      const tabId = result.sessionId;
      const newTab = {
        id: tabId,
        name: `${participantName}와의 피드백`,
        participantId,
        participantName,
        type,
        sessionData: {
          ...sessionData,
          realSessionId: result.sessionId,
        },
        isActive: true,
      };

      setFeedbackTabs((prev) => [...prev, newTab]);
      setActiveTab(tabId);
      return tabId;
    } catch (error) {
      console.error("❌ 피드백 세션 생성 실패:", error);
      alert("Failed to create feedback session. Please try again.");
      return null;
    } finally {
      setIsCreatingFeedbackSession(false);
    }
  };

  const closeFeedbackTab = async (tabId: string) => {
    try {
      const response = await fetch(`/api/teams/${team?.id}/feedback-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "end",
          sessionId: tabId,
          endedBy: "user",
        }),
      });
      if (response.ok) {
      }
    } catch (error) {
      console.error(`❌ 피드백 세션 ${tabId} 백엔드 종료 오류:`, error);
    }

    setFeedbackTabs((prev) => prev.filter((tab) => tab.id !== tabId));
    if (activeTab === tabId) {
      setActiveTab("main");
      setTimeout(() => scrollToBottom(), 100);
    }
    handleTabClose(tabId);
  };

  // 메시지 전송 핸들러
  const handleSendMessage = async () => {
    if (!newMessage.trim() || !team || !mentionedAgent) return;

    // 🔒 사용자가 피드백 세션 중인지 확인
    if (isAgentInFeedbackSession("Me")) {
      alert(
        "Currently participating in a feedback session. Please end the feedback session and try again."
      );
      return;
    }

    if (isAgentInFeedbackSession(mentionedAgent.id)) {
      alert(
        `${mentionedAgent.name} is currently participating in another feedback session. Please try again later.`
      );
      return;
    }

    if (chatMode === "give_feedback") {
      const tabId = await createFeedbackTab(
        mentionedAgent.id,
        mentionedAgent.name,
        "user_to_ai",
        { mentionedAgent, message: newMessage.trim() }
      );
      if (tabId) {
        setNewMessage("");
        setMentionedAgent(null);
        setChatMode("give_feedback");
        setRequestType(null);
      }
      return;
    }

    // 요청 추적
    if (chatMode === "make_request" && requestType === "generate") {
      setGeneratingViaRequestAgents((prev) =>
        new Set(prev).add(mentionedAgent.id)
      );
    }
    if (chatMode === "make_request" && requestType === "evaluate") {
      setEvaluatingViaRequestAgents((prev) =>
        new Set(prev).add(mentionedAgent.id)
      );
    }

    // 낙관적 업데이트
    const tempMessage = {
      id: `temp-${Date.now()}`,
      sender: "Me",
      timestamp: new Date().toISOString(),
      type: chatMode,
      payload: {
        type: chatMode,
        content: newMessage.trim(),
        mention: mentionedAgent.id,
        requestType: chatMode === "make_request" ? requestType : undefined,
      },
    };

    setMessages((prevMessages) => [...prevMessages, tempMessage]);
    setNewMessage("");
    setMentionedAgent(null);
    setChatMode("give_feedback");
    setRequestType(null);

    try {
      const response = await fetch(`/api/teams/${team.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: "Me",
          payload: tempMessage.payload,
        }),
      });
      if (!response.ok) throw new Error("Server transmission failed");
    } catch (error) {
      console.error("❌ 메시지 전송 실패:", error);
      setMessages((prevMessages) =>
        prevMessages.filter((m) => m.id !== tempMessage.id)
      );
    }
  };

  // 아이디어 생성 핸들러
  const handleGenerateIdea = async () => {
    if (!team || isGeneratingIdea) return;
    try {
      setIsGeneratingIdea(true);
      const response = await fetch(`/api/teams/${team.id}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          author: "Me",
        }),
      });
      if (response.ok) {
        // 성공적으로 요청됨
      }
    } catch (error) {
      console.error("아이디어 생성 실패:", error);
    } finally {
      setIsGeneratingIdea(false);
    }
  };

  // 아이디어 추가 핸들러
  const handleAddIdea = async () => {
    if (!team || !addIdeaFormData.object.trim()) return;
    try {
      console.log("🚀 아이디어 추가 요청:", {
        action: "add",
        author: "Me",
        content: addIdeaFormData,
      });

      const response = await fetch(`/api/teams/${team.id}/ideas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add",
          author: "Me",
          content: addIdeaFormData,
        }),
      });
      if (response.ok) {
        await loadIdeas(team.id);
        setShowAddIdeaModal(false);
        setAddIdeaFormData({
          object: "",
          function: "",
          behavior: "",
          structure: "",
        });
      }
    } catch (error) {
      console.error("아이디어 추가 실패:", error);
    }
  };

  // 에이전트 상태 초기화 핸들러
  const handleResetAgentStates = async () => {
    if (confirm("Are you sure you want to reset all agent states?")) {
      try {
        const response = await fetch(`/api/teams/${team?.id}/agent-states`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "reset_all_agents" }),
        });
        if (response.ok) {
          const result = await response.json();
          alert(
            `에이전트 상태 초기화 완료!\n성공: ${
              result.results.filter((r: any) => r.status === "success").length
            }개\n실패: ${
              result.results.filter((r: any) => r.status === "error").length
            }개`
          );
        } else {
          const error = await response.json();
          alert(`초기화 실패: ${error.error}`);
        }
      } catch (error) {
        console.error("에이전트 상태 초기화 실패:", error);
        alert("An error occurred during reset.");
      }
    }
  };

  // 에이전트 클릭 핸들러
  const handleAgentClick = async (agentId: string) => {
    if (!team) return;
    setSelectedAgentId(agentId);
    setShowMemoryModal(true);
    try {
      const response = await fetch(
        `/api/teams/${team.id}/agents/${agentId}/memory`
      );
      if (response.ok) {
        const memoryData = await response.json();
        setAgentMemory(memoryData.memoryV1 || memoryData); // 하위 호환성
        setAgentMemoryV2(memoryData.memoryV2 || null);
      } else {
        setAgentMemory(null);
        setAgentMemoryV2(null);
      }
    } catch (error) {
      console.error("Failed to fetch agent memory:", error);
      setAgentMemory(null);
      setAgentMemoryV2(null);
    }
  };

  // 아이디어 평가 제출 핸들러
  const handleSubmitEvaluationNew = async (evaluationData: {
    novelty: number;
    completeness: number;
    quality: number;
    comment: string;
  }) => {
    if (!team || !ideaDetailModalData) return;
    try {
      setIsSubmittingEvaluation(true);
      const response = await fetch(
        `/api/teams/${team.id}/ideas/${ideaDetailModalData.id}/evaluate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evaluator: "Me",
            scores: {
              novelty: evaluationData.novelty,
              completeness: evaluationData.completeness,
              quality: evaluationData.quality,
            },
            comment: evaluationData.comment || "",
          }),
        }
      );
      if (response.ok) {
        await loadIdeas(team.id);
        const updatedIdeas = await fetch(
          `/api/teams/${team.id}/ideas?t=${new Date().getTime()}`
        );
        if (updatedIdeas.ok) {
          const data = await updatedIdeas.json();
          const updatedIdea = data.ideas.find(
            (i: any) => i.id === ideaDetailModalData.id
          );
          if (updatedIdea) {
            setIdeaDetailModalData(updatedIdea);
          }
        }
        // 명시적으로 성공 상태 반환
        return { success: true };
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to submit evaluation.");
      }
    } catch (error) {
      console.error("아이디어 평가 실패:", error);
      throw error;
    } finally {
      setIsSubmittingEvaluation(false);
    }
  };

  // 실시간 피드백 세션 감지를 위한 ref
  const feedbackTabsRef = useRef<FeedbackTab[]>([]);

  // feedbackTabs 상태가 변경될 때마다 ref 업데이트
  useEffect(() => {
    feedbackTabsRef.current = feedbackTabs;
  }, [feedbackTabs]);

  // 데이터 로드
  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const teamId = params.teamId as string;
        const [teamData, agentsData] = await Promise.all([
          getTeamAction(teamId),
          getUserAgentsAction(),
        ]);
        
        setTeam(teamData);
        setAgents(agentsData);
        await Promise.all([loadIdeas(teamId), loadMessages(teamId)]);
        if (teamData.topic) {
          setTopic(teamData.topic);
        } else {
          setError(
            "This team has no ideation topic set. Please create the team again."
          );
          return;
        }
      } catch (error) {
        setError("Unable to load team information.");
      } finally {
        setLoading(false);
      }
    }
    if (session) {
      loadData();
    }
  }, [params.teamId, session, loadIdeas, loadMessages]);

  // 아이디에이션 시작 시 아이디어 생성하기 역할 에이전트들의 자동 아이디어 생성
  useEffect(() => {
    if (!team || !agents.length || loading || ideas.length > 0) return;

    const triggerInitialIdeaGeneration = async () => {
      // '아이디어 생성하기' 역할을 가진 AI 에이전트들 찾기
      const ideaGenerators = team.members.filter(
        (member) => !member.isUser && member.roles.includes("Idea Generation")
      );

      if (ideaGenerators.length === 0) {
        return;
      }

      // 각 아이디어 생성 에이전트에게 아이디어 생성 요청
      for (const member of ideaGenerators) {
        if (!member.agentId) continue;

        const agent = agents.find((a) => a.id === member.agentId);
        if (!agent) continue;

        try {
          const response = await fetch(
            `/api/teams/${team.id}/agents/${agent.id}/generate-idea`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                trigger: "initial_startup",
                topic: team.topic,
                teamContext: {
                  teamName: team.teamName,
                  memberCount: team.members.length,
                  agentRole: member.roles,
                },
              }),
            }
          );

          if (!response.ok) {
            console.warn(
              `❌ ${agent.name}의 초기 아이디어 생성 요청 실패:`,
              response.status
            );
          }
        } catch (error) {
          console.error(
            `❌ ${agent.name}의 초기 아이디어 생성 중 오류:`,
            error
          );
        }
      }
    };

    // 약간의 지연 후 실행 (다른 초기화가 완료될 시간 확보)
    const timer = setTimeout(triggerInitialIdeaGeneration, 1000);

    return () => clearTimeout(timer);
  }, [team, agents, loading, ideas.length]);

  // 사용자에게 요청한 피드백 세션 자동 감지 및 탭 생성
  useEffect(() => {
    if (!team?.id) return;

    const checkUserFeedbackSessions = async () => {
      try {
        const response = await fetch(
          `/api/teams/${team.id}/feedback-sessions?action=check_user_sessions`
        );

        if (response.ok) {
          const data = await response.json();
          const userSessions = data.userSessions || [];

          for (const session of userSessions) {
            // 이미 확인한 세션이거나 이미 탭이 열려있는 세션은 스킵
            if (
              checkedSessionIds.has(session.id) ||
              feedbackTabs.some((tab) => tab.id === session.id)
            ) {
              continue;
            }

            // 사용자가 참여자인지 확인
            const userParticipant = session.participants.find(
              (p: any) => p.id === "Me"
            );
            if (!userParticipant) continue;

            // 다른 참여자 찾기 (AI 에이전트)
            const otherParticipant = session.participants.find(
              (p: any) => p.id !== "나"
            );
            if (!otherParticipant) continue;


            // 피드백 탭 자동 생성 (세션이 이미 생성되어 있으므로 바로 탭만 열기)
            const newTab = {
              id: session.id,
              name: `${otherParticipant.name}와의 피드백`,
              participantId: otherParticipant.id,
              participantName: otherParticipant.name,
              type: "ai_to_user" as const,
              sessionData: {
                realSessionId: session.id,
                mentionedAgent: {
                  id: otherParticipant.id,
                  name: otherParticipant.name,
                },
              },
              isActive: true,
            };

            setFeedbackTabs((prev) => [...prev, newTab]);
            setActiveTab(session.id);
            setCheckedSessionIds((prev) => new Set(prev).add(session.id));

            // 알림 표시 - 한 세션당 한 번만 (notifiedSessionIds로 중복 방지)
            if (!notifiedSessionIds.has(session.id)) {
              try {
                await fetch(`/api/teams/${team.id}/chat`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    sender: "system",
                    type: "give_feedback",
                    payload: {
                      content: `${otherParticipant.name} requested feedback. The feedback tab opened automatically.`,
                    },
                  }),
                });
                setNotifiedSessionIds((prev) => new Set(prev).add(session.id));
              } catch (error) {
                console.error("❌ 시스템 메시지 전송 실패:", error);
              }
            }
          }
        }
      } catch (error) {
        console.error("❌ 사용자 피드백 세션 체크 실패:", error);
      }
    };

    // 초기 체크
    checkUserFeedbackSessions();

    // 3초마다 체크
    const interval = setInterval(checkUserFeedbackSessions, 3000);

    return () => clearInterval(interval);
  }, [team?.id, feedbackTabs, checkedSessionIds, notifiedSessionIds]);

  // 탭이 닫힐 때 체크된 세션 목록에서 제거
  const handleTabClose = (tabId: string) => {
    setCheckedSessionIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(tabId);
      return newSet;
    });
    setNotifiedSessionIds((prev) => {
      const newSet = new Set(prev);
      newSet.delete(tabId);
      return newSet;
    });
  };

  // SSE 연결
  useEffect(() => {
    if (!team?.id) return;
    const eventSource = new EventSource(`/api/teams/${team.id}/events`);

    eventSource.onopen = () => {
      setSseConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        switch (data.type) {
          case "initial":
            if (data.messages) setMessages(data.messages);
            if (data.ideas) setIdeas(data.ideas);
            break;
          case "update":
            if (data.messages) setMessages(data.messages);
            if (data.ideas) setIdeas(data.ideas);
            break;
          case "heartbeat":
            break;
        }
      } catch (error) {
        console.error("❌ SSE 데이터 파싱 실패:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("❌ SSE 연결 오류:", error);
      setSseConnected(false);
    };

    return () => {
      eventSource.close();
      setSseConnected(false);
    };
  }, [team?.id]);

  // 아이디어 생성 완료 상태 확인 함수
  const isInitialIdeaGenerationComplete = (): boolean => {
    if (!team) return false;

    // 아이디어 생성 역할을 가진 팀원들 (에이전트만)
    const ideaGenerators = team.members.filter(
      (member) => !member.isUser && member.roles.includes("Idea Generation")
    );

    if (ideaGenerators.length === 0) return true; // 아이디어 생성자가 없으면 제한 없음

    // 각 아이디어 생성자가 최소 1개의 아이디어를 생성했는지 확인
    const hasAllGeneratorsCreatedIdeas = ideaGenerators.every((generator) => {
      const hasIdea = ideas.some((idea) => idea.author === generator.agentId);
      return hasIdea;
    });

    return hasAllGeneratorsCreatedIdeas;
  };

  // 채팅 비활성화 여부 확인 함수
  const isChatDisabled = (): boolean => {
    // 초기 아이디어 생성이 완료되지 않았으면 채팅 비활성화
    return !isInitialIdeaGenerationComplete();
  };

  // 채팅 비활성화 메시지 생성 함수
  const getChatDisabledMessage = (): string => {
    if (!isInitialIdeaGenerationComplete()) {
      const incompleteGenerators =
        team?.members
          .filter(
            (member) =>
              !member.isUser &&
              member.roles.includes("Idea Generation") &&
              !ideas.some((idea) => idea.author === member.agentId)
          )
          .map((member) => {
            const agent = agents.find((a) => a.id === member.agentId);
            return agent?.name || member.agentId;
          }) || [];

      if (incompleteGenerators.length > 0) {
        return `Idea generation in progress. Chat is restricted until ${incompleteGenerators.join(
          ", "
        )} complete${incompleteGenerators.length > 1 ? "" : "s"} generating ideas.`;
      }
    }
    return "Enter your message...";
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading team information...</p>
        </div>
      </div>
    );
  }

  if (error || !team) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-lg p-8 text-center">
          <p className="text-red-600 mb-4">
            {error || "팀을 찾을 수 없습니다."}
          </p>
          <Link href="/" className="text-blue-600 hover:underline">
            홈으로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <Header
        team={team}
        topic={topic}
        sseConnected={sseConnected}
        feedbackTabsCount={feedbackTabs.length}
        onResetAgentStates={handleResetAgentStates}
      />

      {/* 메인 컨텐츠 */}
      {topic && (
        <div className="flex h-[calc(100vh-80px)]">
          {/* 왼쪽: 팀원 목록 */}
          <TeamMembersList
            team={team}
            agents={agents}
            agentStates={agentStates}
            timers={timers}
            onAgentClick={handleAgentClick}
            isConnected={isConnected}
            useOriginalLayout={useOriginalLayout}
            onToggleLayout={setUseOriginalLayout}
          />

          {/* 가운데: 채팅 영역 */}
          <ChatArea
            activeTab={activeTab}
            feedbackTabs={feedbackTabs}
            onSwitchTab={setActiveTab}
            onCloseFeedbackTab={closeFeedbackTab}
            messages={messages}
            team={team}
            agents={agents}
            ideas={ideas}
            getAuthorName={getAuthorName}
            teamAgents={teamAgents}
            newMessage={newMessage}
            onNewMessageChange={setNewMessage}
            mentionedAgent={mentionedAgent}
            showMentionDropdown={showMentionDropdown}
            onShowMentionDropdown={setShowMentionDropdown}
            onMentionedAgentChange={setMentionedAgent}
            chatMode={chatMode}
            onChatModeChange={setChatMode}
            requestType={requestType}
            onRequestTypeChange={setRequestType}
            getAvailableRequestTypes={getAvailableRequestTypes}
            isAgentInFeedbackSession={isAgentInFeedbackSession}
            canAgentPerformRole={canAgentPerformRole}
            onSendMessage={handleSendMessage}
            isAutoGenerating={isAutoGenerating}
            isGeneratingIdea={isGeneratingIdea}
            isCreatingFeedbackSession={isCreatingFeedbackSession}
            scrollToBottom={scrollToBottom}
            isChatDisabled={isChatDisabled}
            getChatDisabledMessage={getChatDisabledMessage}
            onIdeaClick={(idea, index) => {
              setIdeaDetailModalData(idea);
              setCurrentIdeaIndex(index);
              setShowIdeaDetailModal(true);
            }}
          />

          {/* 오른쪽: 아이디어 목록 */}
          <IdeaList
            topic={topic}
            userCanGenerateIdeas={userCanGenerateIdeas}
            isAutoGenerating={isAutoGenerating}
            isGeneratingIdea={isGeneratingIdea}
            onShowAddIdeaModal={() => setShowAddIdeaModal(true)}
            filteredIdeas={sortedAndFilteredIdeas}
            ideasSortedByCreation={ideasSortedByCreation}
            authorFilter={authorFilter}
            uniqueAuthors={uniqueAuthors}
            onAuthorFilterChange={setAuthorFilter}
            sortBy={sortBy}
            onSortChange={setSortBy}
            calculateAverageRating={calculateAverageRating}
            onIdeaClick={(idea, index) => {
              setIdeaDetailModalData(idea);
              setCurrentIdeaIndex(index);
              setShowIdeaDetailModal(true);
            }}
            getAuthorName={getAuthorName}
            generationProgress={generationProgress}
            ideas={ideas}
          />
        </div>
      )}

      {/* 모달들 */}
      {showIdeaDetailModal && ideaDetailModalData && (
        <IdeaDetailModal
          isOpen={showIdeaDetailModal}
          onClose={() => {
            setShowIdeaDetailModal(false);
          }}
          idea={ideaDetailModalData}
          ideas={ideas}
          currentIndex={currentIdeaIndex}
          onIndexChange={setCurrentIdeaIndex}
          team={team}
          agents={agents}
          onSubmitEvaluation={handleSubmitEvaluationNew}
          isSubmittingEvaluation={isSubmittingEvaluation}
          onIdeaUpdate={async () => {
            if (team) {
              await loadIdeas(team.id);
            }
          }}
        />
      )}

      <AddIdeaModal
        isOpen={showAddIdeaModal}
        onClose={() => {
          setShowAddIdeaModal(false);
          setAddIdeaFormData({
            object: "",
            function: "",
            behavior: "",
            structure: "",
          });
        }}
        formData={addIdeaFormData}
        onFormDataChange={setAddIdeaFormData}
        onSubmit={handleAddIdea}
        isAutoGenerating={isAutoGenerating}
        isGeneratingIdea={isGeneratingIdea}
      />

      <MemoryModal
        isOpen={showMemoryModal}
        onClose={() => {
          setShowMemoryModal(false);
          setSelectedAgentId(null);
          setAgentMemory(null);
          setAgentMemoryV2(null);
        }}
        agentName={selectedAgentId ? getAuthorName(selectedAgentId) : ""}
        agentMemory={agentMemory}
        agentMemoryV2={agentMemoryV2}
      />

      <ViewFeedbackSessionModal
        isOpen={showViewSessionModal}
        onClose={() => setShowViewSessionModal(false)}
        sessionId={viewingSessionId}
      />
    </div>
  );
}
