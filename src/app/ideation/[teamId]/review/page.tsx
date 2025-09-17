"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MessageSquare, Lightbulb, Clock, Users, Network, User, X, Star } from "lucide-react";
import { Team, Idea, ChatMessage, AgentRole } from "@/lib/types";
import { getAgentByIdAction } from "@/actions/agent.actions";

interface ActionLog {
  timestamp: string;
  agentName: string;
  action: string;
  target?: string;
  description: string;
}

export default function ReviewPage() {
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;
  
  const [team, setTeam] = useState<Team | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [actionLogs, setActionLogs] = useState<ActionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<{ [key: string]: string }>({});
  const [agentProfiles, setAgentProfiles] = useState<{ [key: string]: any }>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [showFeedbackMode, setShowFeedbackMode] = useState(false);
  const [showRequestMode, setShowRequestMode] = useState(false);
  const [useOriginalLayout, setUseOriginalLayout] = useState(false);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [showIdeaDetail, setShowIdeaDetail] = useState(false);
  const [ideaFilter, setIdeaFilter] = useState<string>("All");
  const [ideaSortBy, setIdeaSortBy] = useState<"latest" | "rating">("latest");
  const [activityFilter, setActivityFilter] = useState<string>("All");
  const [selectedActivity, setSelectedActivity] = useState<ActionLog | null>(null);
  const [showActivityDetail, setShowActivityDetail] = useState(false);

  useEffect(() => {
    const loadReviewData = async () => {
      try {
        // Load team information
        const teamResponse = await fetch(`/api/teams/${teamId}`);
        if (teamResponse.ok) {
          const teamData = await teamResponse.json();
          setTeam(teamData.team);
          
          // 에이전트 이름 및 프로필 로드
          const nameMap: { [key: string]: string } = {};
          const profileMap: { [key: string]: any } = {};
          for (const member of teamData.team.members) {
            if (!member.isUser && member.agentId) {
              try {
                const agent = await getAgentByIdAction(member.agentId);
                if (agent) {
                  nameMap[member.agentId] = agent.name;
                  profileMap[member.agentId] = agent;
                } else {
                  nameMap[member.agentId] = `에이전트 ${member.agentId.slice(0, 8)}`;
                }
              } catch (err) {
                console.error(`에이전트 ${member.agentId} 정보 로드 실패:`, err);
                nameMap[member.agentId] = `에이전트 ${member.agentId.slice(0, 8)}`;
              }
            }
          }
          setAgentNames(nameMap);
          setAgentProfiles(profileMap);
        }

        // 아이디어 목록 로드
        const ideasResponse = await fetch(`/api/teams/${teamId}/ideas`);
        if (ideasResponse.ok) {
          const ideasData = await ideasResponse.json();
          setIdeas(ideasData.ideas || []);
        }

        // 채팅 메시지 저장 (나중에 에이전트 이름과 함께 처리)
        const chatResponse = await fetch(`/api/teams/${teamId}/chat`);
        if (chatResponse.ok) {
          const chatData = await chatResponse.json();
          setChatMessages(chatData.messages || []);
        }
      } catch (err) {
        console.error("리뷰 데이터 로딩 실패:", err);
        setError("리뷰 데이터를 불러오는데 실패했습니다.");
      } finally {
        setLoading(false);
      }
    };

    if (teamId) {
      loadReviewData();
    }
  }, [teamId]);

  // 에이전트 이름이 로드된 후 액션 로그 추출
  useEffect(() => {
    if (chatMessages.length > 0 && Object.keys(agentNames).length > 0) {
      const logs = extractActionLogs(chatMessages);
      setActionLogs(logs);
    }
  }, [chatMessages, agentNames]);

  const extractActionLogs = (messages: ChatMessage[]): ActionLog[] => {
    const logs: ActionLog[] = [];
    
    messages.forEach((message) => {
      if (message.type === "system" && message.payload && typeof message.payload === "object") {
        const content = (message.payload as any).content;
        if (typeof content === "string") {
          let actionType = "";
          let description = content;
          
          if (content.includes("아이디어를 생성") || content.includes("generated an idea") || content.includes("Idea Generation")) {
            actionType = "Idea Generation";
          } else if (content.includes("아이디어를 평가") || content.includes("evaluated an idea") || content.includes("Idea Evaluation")) {
            actionType = "Idea Evaluation";
          } else if (content.includes("피드백") || content.includes("feedback") || content.includes("Feedback")) {
            actionType = "Feedback Provision";
          } else if (content.includes("요청") || content.includes("request") || content.includes("Request")) {
            actionType = "Make Request";
          } else {
            actionType = "Other Activity";
          }

          logs.push({
            timestamp: message.timestamp,
            agentName: getAgentName(message.sender),
            action: actionType,
            description: description,
          });
        }
      } else if (message.type === "make_request") {
        // 요청 메시지 처리
        const requester = getAgentName(message.sender);
        const target = (message.payload as any)?.mention ? getAgentName((message.payload as any).mention) : "team member";
        const requestType = (message.payload as any)?.requestType;
        
        let requestDescription = `${requester} `;
        if (requestType === "generate") {
          requestDescription += "requested idea generation.";
        } else if (requestType === "evaluate") {
          requestDescription += "requested idea evaluation.";
        } else if (requestType === "give_feedback") {
          requestDescription += "requested feedback.";
        } else {
          requestDescription += "made a request.";
        }
        
        // 실제 요청 내용은 상세 페이지에서만 표시하고 타임라인에서는 숨김

        logs.push({
          timestamp: message.timestamp,
          agentName: requester,
          action: "Make Request",
          description: requestDescription,
        });
      } else if (message.type === "feedback_session_summary") {
        // 피드백 세션 참여자 정보 추출
        let feedbackGiver = "";
        let feedbackReceiver = "";
        let messageCount = 0;
        
        if (message.payload && typeof message.payload === "object") {
          const payload = message.payload as any;
          
          
          // 메시지 수 추출
          if (payload.messageCount) {
            messageCount = payload.messageCount;
          } else if (payload.turnCount) {
            messageCount = payload.turnCount;
          }
          
          // 먼저 sessionMessages에서 실제 참여자 추출 시도
          if (payload.sessionMessages && Array.isArray(payload.sessionMessages)) {
            const actualParticipants = new Set<string>();
            payload.sessionMessages.forEach((sessionMsg: any) => {
              if (sessionMsg.sender && sessionMsg.type !== "system") {
                actualParticipants.add(sessionMsg.sender);
              }
            });
            
            const participantsList = Array.from(actualParticipants);
            
            if (participantsList.length >= 2) {
              feedbackGiver = getAgentName(participantsList[0]);
              feedbackReceiver = getAgentName(participantsList[1]);
            } else if (participantsList.length === 1) {
              feedbackGiver = getAgentName(participantsList[0]);
            }
          }
          
          // sessionMessages가 없으면 기존 방식 사용
          if (!feedbackGiver) {
            if (payload.from && payload.to) {
              feedbackGiver = getAgentName(payload.from);
              feedbackReceiver = getAgentName(payload.to);
            } else if (payload.sender && payload.receiver) {
              feedbackGiver = getAgentName(payload.sender);
              feedbackReceiver = getAgentName(payload.receiver);
            } else if (payload.participants && Array.isArray(payload.participants)) {
              // participants에서 첫 번째를 제공자로 간주
              if (payload.participants.length >= 2) {
                feedbackGiver = getAgentName(payload.participants[0]);
                feedbackReceiver = getAgentName(payload.participants[1]);
              }
            }
          }
          
        }
        
        // 로그 항목 생성
        let actionDescription = "";
        let displayName = "";
        
        if (feedbackGiver && feedbackReceiver) {
          displayName = `${feedbackGiver} → ${feedbackReceiver}`;
          if (messageCount > 0) {
            displayName += ` (${messageCount} times)`;
          }
          actionDescription = `${feedbackGiver} and ${feedbackReceiver} conducted feedback.`;
          if (messageCount > 0) {
            actionDescription += ` (${messageCount} messages)`;
          }
          
        } else {
          displayName = "피드백 세션";
          actionDescription = "AI feedback session completed.";
        }
        
        logs.push({
          timestamp: message.timestamp,
          agentName: displayName,
          action: "Feedback Session Completed",
          description: actionDescription,
        });
      }
    });

    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  // 사용자의 실제 이름을 가져오는 헬퍼 함수
  const getUserDisplayName = (): string => {
    if (team) {
      const userMember = team.members.find((m) => m.isUser);
      if (userMember?.userProfile?.name) {
        return userMember.userProfile.name;
      }
    }
    return "Me";
  };

  const getAgentName = (senderId: string): string => {
    if (senderId === "Me") {
      return getUserDisplayName();
    }
    
    // 먼저 agentNames에서 찾기
    if (agentNames[senderId]) {
      return agentNames[senderId];
    }
    
    // agentProfiles에서 직접 찾기
    if (agentProfiles[senderId]?.name) {
      return agentProfiles[senderId].name;
    }
    
    // 팀 멤버에서 찾기 - agentId로 매칭
    if (team) {
      const member = team.members.find((m) => m.agentId === senderId);
      if (member && !member.isUser) {
        // agentNames가 로드되지 않은 경우 agentId를 사용해서 이름 찾기
        if (member.agentId && agentNames[member.agentId]) {
          return agentNames[member.agentId];
        }
        return `에이전트 ${senderId.slice(0, 8)}`;
      }
    }
    
    // senderId가 이미 display name일 수 있으므로 역매핑 시도
    if (team) {
      // agentNames의 값들 중에서 senderId와 일치하는 것이 있는지 확인
      for (const [, agentName] of Object.entries(agentNames)) {
        if (agentName === senderId) {
          return agentName; // 이미 display name이므로 그대로 반환
        }
      }
      
      // agentProfiles에서도 확인
      for (const [, profile] of Object.entries(agentProfiles)) {
        if (profile?.name === senderId) {
          return profile.name;
        }
      }
    }
    
    // senderId가 user display name인지 확인
    const userDisplayName = getUserDisplayName();
    if (senderId === userDisplayName) {
      return userDisplayName;
    }
    
    return senderId;
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const calculateAverageRating = (idea: Idea): number | null => {
    if (!idea.evaluations || idea.evaluations.length === 0) {
      return null;
    }
    
    const totalScores = idea.evaluations.reduce((sum, evaluation) => {
      return sum + evaluation.scores.novelty + evaluation.scores.completeness + evaluation.scores.quality;
    }, 0);
    
    const totalEvaluations = idea.evaluations.length * 3;
    return Math.round((totalScores / totalEvaluations) * 10) / 10;
  };

  const getRelationshipToMember = (fromMemberId: string, toMemberId: string): string => {
    if (!team) return "";
    
    const fromMember = team.members.find((m) => 
      (m.isUser && fromMemberId === "Me") || (!m.isUser && m.agentId === fromMemberId)
    );
    
    if (!(fromMember as any)?.relationships) return "";
    
    const relationship = (fromMember as any).relationships.find((rel: any) => 
      (rel.targetIsUser && toMemberId === "Me") || (!rel.targetIsUser && rel.targetAgentId === toMemberId)
    );
    
    if (!relationship || relationship.type === "NULL") return "";
    
    switch (relationship.type) {
      case "PEER":
        return "동료";
      case "SUPERIOR_SUBORDINATE":
        return "상사";
      default:
        return "";
    }
  };

  const getRelationshipFromMember = (fromMemberId: string, toMemberId: string): string => {
    if (!team) return "";
    
    const toMember = team.members.find((m) => 
      (m.isUser && toMemberId === "Me") || (!m.isUser && m.agentId === toMemberId)
    );
    
    if (!(toMember as any)?.relationships) return "";
    
    const relationship = (toMember as any).relationships.find((rel: any) => 
      (rel.targetIsUser && fromMemberId === "Me") || (!rel.targetIsUser && rel.targetAgentId === fromMemberId)
    );
    
    if (!relationship || relationship.type === "NULL") return "";
    
    switch (relationship.type) {
      case "PEER":
        return "동료";
      case "SUPERIOR_SUBORDINATE":
        return "부하";
      default:
        return "";
    }
  };

  const getMemberRelationships = (member: any): string[] => {
    if (!team) return [];
    
    const memberId = member.isUser ? "Me" : member.agentId;
    const relationships: string[] = [];
    
    team.members.forEach((otherMember) => {
      if (otherMember === member) return;
      
      const otherMemberId = otherMember.isUser ? "Me" : otherMember.agentId;
      const otherMemberName = otherMember.isUser ? "Me" : getAgentName(otherMember.agentId || "");
      
      const relationToOther = getRelationshipToMember(memberId, otherMemberId!);
      const relationFromOther = getRelationshipFromMember(memberId, otherMemberId!);
      
      if (relationToOther) {
        relationships.push(`${otherMemberName}의 ${relationToOther}`);
      } else if (relationFromOther) {
        relationships.push(`${otherMemberName}의 ${relationFromOther}`);
      }
    });
    
    return relationships;
  };

  const generateFeedbackData = () => {
    if (!chatMessages || chatMessages.length === 0) return {};
    
    const feedbackCounts: { [key: string]: number } = {};
    
    
    chatMessages.forEach((message, index) => {
      // 피드백 세션 완료 메시지 - 활동 타임라인과 동일한 로직 사용
      if (message.type === "feedback_session_summary") {
        
        let feedbackGiver = "";
        let feedbackReceiver = "";
        let messageCount = 0;
        
        if (message.payload && typeof message.payload === "object") {
          const payload = message.payload as any;
          
          // 메시지 수 추출
          if (payload.messageCount) {
            messageCount = payload.messageCount;
          } else if (payload.turnCount) {
            messageCount = payload.turnCount;
          }
          
          // sessionMessages에서 실제 참여자 추출 시도
          if (payload.sessionMessages && Array.isArray(payload.sessionMessages)) {
            const actualParticipants = new Set<string>();
            payload.sessionMessages.forEach((sessionMsg: any) => {
              if (sessionMsg.sender && sessionMsg.type !== "system") {
                actualParticipants.add(sessionMsg.sender);
              }
            });
            
            const participantsList = Array.from(actualParticipants);
            if (participantsList.length >= 2) {
              feedbackGiver = participantsList[0];
              feedbackReceiver = participantsList[1];
            } else if (participantsList.length === 1) {
              feedbackGiver = participantsList[0];
            }
          }
          
          // sessionMessages가 없으면 기존 방식 사용
          if (!feedbackGiver) {
            if (payload.from && payload.to) {
              feedbackGiver = payload.from;
              feedbackReceiver = payload.to;
            } else if (payload.sender && payload.receiver) {
              feedbackGiver = payload.sender;
              feedbackReceiver = payload.receiver;
            } else if (payload.participants && Array.isArray(payload.participants)) {
              // participants에서 첫 번째를 제공자로 간주
              if (payload.participants.length >= 2) {
                feedbackGiver = payload.participants[0];
                feedbackReceiver = payload.participants[1];
              }
            }
          }
          
          // 피드백 관계 추가
          if (feedbackGiver && feedbackReceiver && feedbackGiver !== feedbackReceiver) {
            const key = `${feedbackGiver}->${feedbackReceiver}`;
            // 메시지 수를 가중치로 사용, 최소 1
            const weight = Math.max(messageCount || 1, 1);
            feedbackCounts[key] = (feedbackCounts[key] || 0) + weight;
            
          }
        }
      }
      
      // 직접 피드백 메시지들도 확인
      if (message.type === "give_feedback" || 
          (message.type as any) === "feedback") {
        const sender = message.sender;
        const mention = (message.payload as any)?.mention || (message.payload as any)?.target || (message.payload as any)?.to;
        
        if (sender && mention && sender !== mention) {
          const key = `${sender}->${mention}`;
          feedbackCounts[key] = (feedbackCounts[key] || 0) + 1;
        }
      }
      
      // 시스템 메시지에서 피드백 관련 활동 추출 (backup)
      if (message.type === "system" && message.payload && typeof message.payload === "object") {
        const content = (message.payload as any).content;
        if (typeof content === "string" && content.includes("피드백")) {
          const sender = message.sender;
          
          // 피드백을 제공한 사람 (sender)과 받은 사람을 찾기
          team?.members.forEach((targetMember) => {
            const targetName = targetMember.isUser ? "Me" : getAgentName(targetMember.agentId || "");
            const targetId = targetMember.isUser ? "Me" : targetMember.agentId;
            
            // 메시지 내용에 타겟 멤버 이름이 포함되어 있고, 보낸 사람과 다른 경우
            if (content.includes(targetName) && 
                targetName !== getAgentName(sender) && 
                targetId && sender) {
              
              const key = `${sender}->${targetId}`;
              feedbackCounts[key] = (feedbackCounts[key] || 0) + 1;
            }
          });
        }
      }
    });
    
    // If no actual data exists, generate feedback data based on activity logs
    if (Object.keys(feedbackCounts).length === 0) {
      
      // Find feedback activities from already extracted action logs
      const logs = extractActionLogs(chatMessages);
      logs.forEach(log => {
        if (log.action === "Feedback Provision" && log.agentName && log.agentName !== "시스템") {
          // 모든 다른 팀 멤버에게 피드백을 제공했다고 가정
          team?.members.forEach(member => {
            const memberId = member.isUser ? "Me" : member.agentId;
            const memberName = member.isUser ? getUserDisplayName() : getAgentName(member.agentId || "");
            
            // For members other than feedback provider
            if (memberId && log.agentName !== memberName) {
              // Find actual ID of feedback provider
              let providerId = "";
              if (log.agentName === "Me") {
                providerId = "Me";
              } else {
                const providerMember = team.members.find(m => 
                  !m.isUser && getAgentName(m.agentId || "") === log.agentName
                );
                if (providerMember?.agentId) {
                  providerId = providerMember.agentId;
                }
              }
              
              if (providerId) {
                const key = `${providerId}->${memberId}`;
                feedbackCounts[key] = (feedbackCounts[key] || 0) + 1;
              }
            }
          });
        }
      });
    }
    
    return feedbackCounts;
  };

  const generateRequestData = () => {
    if (!chatMessages || chatMessages.length === 0) return {};
    
    const requestCounts: { [key: string]: number } = {};
    
    chatMessages.forEach((message) => {
      if (message.type === "make_request") {
        const sender = message.sender;
        const mention = (message.payload as any)?.mention;
        
        if (sender && mention && sender !== mention) {
          // sender가 mention에게 요청을 보낸 것
          const key = `${sender}->${mention}`;
          requestCounts[key] = (requestCounts[key] || 0) + 1;
        }
      }
    });
    
    return requestCounts;
  };

  const generateNetworkData = () => {
    if (!team) return { nodes: [], edges: [] };
    
    const nodes = team.members.map((member) => ({
      id: member.isUser ? "Me" : member.agentId!,
      name: member.isUser ? getUserDisplayName() : getAgentName(member.agentId || ""),
      isUser: member.isUser,
      x: 0,
      y: 0,
    }));

    const edges: any[] = [];
    
    if (showFeedbackMode || showRequestMode) {
      // 피드백 모드
      if (showFeedbackMode) {
        const feedbackCounts = generateFeedbackData();
        
        
        Object.entries(feedbackCounts).forEach(([key, count]) => {
          const [fromId, toId] = key.split('->');
          
          // ID 정리: "(숫자)" 패턴 제거하고 실제 에이전트 ID로 변환
          let cleanFromId = fromId;
          let cleanToId = toId;
          
          // "(숫자)" 패턴 제거 (예: "지피티 (4)" -> "지피티")
          cleanToId = cleanToId.replace(/\s*\(\d+\)$/, '');
          cleanFromId = cleanFromId.replace(/\s*\(\d+\)$/, '');
          
          // 실제 팀 멤버 ID로 변환 - 개선된 매칭 로직
          const fromMember = team?.members.find(m => {
            const memberName = m.isUser ? "Me" : getAgentName(m.agentId || "");
            
            if (m.isUser && (cleanFromId === "Me" || fromId === "Me")) {
              return true;
            }
            if (!m.isUser && m.agentId === cleanFromId) {
              return true;
            }
            if (!m.isUser && memberName === cleanFromId) {
              return true;
            }
            // 부분 매칭: "지피티"가 "지피티 (4)"에 포함되는 경우
            if (!m.isUser && memberName.includes(cleanFromId) && cleanFromId.length > 2) {
              return true;
            }
            // 역방향 부분 매칭: "지피티 (4)"에서 "지피티" 추출해서 비교
            if (!m.isUser && memberName.replace(/\s*\(\d+\)$/, '') === cleanFromId) {
              return true;
            }
            return false;
          });
          
          const toMember = team?.members.find(m => {
            const memberName = m.isUser ? "Me" : getAgentName(m.agentId || "");
            
            if (m.isUser && (cleanToId === "Me" || toId === "Me")) {
              return true;
            }
            if (!m.isUser && m.agentId === cleanToId) {
              return true;
            }
            if (!m.isUser && memberName === cleanToId) {
              return true;
            }
            // 부분 매칭: "지피티"가 "지피티 (4)"에 포함되는 경우
            if (!m.isUser && memberName.includes(cleanToId) && cleanToId.length > 2) {
              return true;
            }
            // 역방향 부분 매칭: "지피티 (4)"에서 "지피티" 추출해서 비교
            if (!m.isUser && memberName.replace(/\s*\(\d+\)$/, '') === cleanToId) {
              return true;
            }
            return false;
          });
          
          const finalFromId = fromMember?.isUser ? "Me" : fromMember?.agentId;
          const finalToId = toMember?.isUser ? "Me" : toMember?.agentId;
          
          
          // 특별 처리: toMember가 없으면 유사한 이름의 모든 멤버에게 화살표 생성
          if (finalFromId && !finalToId && cleanToId.length > 2) {
            team?.members.forEach(m => {
              if (!m.isUser) {
                const memberName = getAgentName(m.agentId || "");
                const cleanMemberName = memberName.replace(/\s*\(\d+\)$/, '');
                
                if (cleanMemberName === cleanToId || memberName.includes(cleanToId)) {
                  let strokeWidth;
                  if (count <= 2) {
                    strokeWidth = 1;
                  } else if (count <= 5) {
                    strokeWidth = 2;
                  } else if (count <= 10) {
                    strokeWidth = 3;
                  } else if (count <= 20) {
                    strokeWidth = 4;
                  } else if (count <= 35) {
                    strokeWidth = 5;
                  } else if (count <= 50) {
                    strokeWidth = 6;
                  } else {
                    strokeWidth = Math.min(8, Math.floor(count / 10));
                  }
                  
                  edges.push({
                    from: finalFromId,
                    to: m.agentId,
                    type: "FEEDBACK",
                    isHierarchical: true,
                    strokeWidth: strokeWidth,
                    feedbackCount: count,
                    color: "#7C3AED"
                  });
                }
              }
            });
          }
          
          // 유효한 ID가 있는 경우에만 엣지 생성
          else if (finalFromId && finalToId && finalFromId !== finalToId) {
            // 피드백 횟수에 따른 선 굵기 계산
            let strokeWidth;
            if (count <= 2) {
              strokeWidth = 1;
            } else if (count <= 5) {
              strokeWidth = 2;
            } else if (count <= 10) {
              strokeWidth = 3;
            } else if (count <= 20) {
              strokeWidth = 4;
            } else if (count <= 35) {
              strokeWidth = 5;
            } else if (count <= 50) {
              strokeWidth = 6;
            } else {
              strokeWidth = Math.min(8, Math.floor(count / 10));
            }
            
            edges.push({
              from: finalFromId,
              to: finalToId,
              type: "FEEDBACK",
              isHierarchical: true, // 피드백은 방향성이 있음
              strokeWidth: strokeWidth,
              feedbackCount: count,
              color: "#7C3AED" // 보라색 (피드백)
            });
            
          } else {
          }
        });
        
      }

      // 요청 모드
      if (showRequestMode) {
        const requestCounts = generateRequestData();
        
        Object.entries(requestCounts).forEach(([key, count]) => {
          const [fromId, toId] = key.split('->');
          
          // ID 정리 (괄호 제거)
          const cleanFromId = fromId.replace(/\s*\(\d+\)$/, '');
          const cleanToId = toId.replace(/\s*\(\d+\)$/, '');
          
          
          // 팀 멤버와 매칭하여 실제 ID 찾기
          const fromMember = team?.members.find(m => {
            const memberName = m.isUser ? "Me" : getAgentName(m.agentId || "");
            
            // '나'에 대한 매칭 개선
            if (m.isUser && (cleanFromId === "Me" || fromId === "Me")) {
              return true;
            }
            if (!m.isUser && m.agentId === cleanFromId) {
              return true;
            }
            if (!m.isUser && memberName === cleanFromId) {
              return true;
            }
            // 부분 매칭: "지피티"가 "지피티 (2)"에 포함되는 경우
            if (!m.isUser && memberName.includes(cleanFromId) && cleanFromId.length > 2) {
              return true;
            }
            // 역방향 부분 매칭: "지피티 (2)"에서 "지피티" 추출해서 비교
            if (!m.isUser && memberName.replace(/\s*\(\d+\)$/, '') === cleanFromId) {
              return true;
            }
            return false;
          });
          
          const toMember = team?.members.find(m => {
            const memberName = m.isUser ? "Me" : getAgentName(m.agentId || "");
            
            // '나'에 대한 매칭 개선
            if (m.isUser && (cleanToId === "Me" || toId === "Me")) {
              return true;
            }
            if (!m.isUser && m.agentId === cleanToId) {
              return true;
            }
            if (!m.isUser && memberName === cleanToId) {
              return true;
            }
            // 부분 매칭: "지피티"가 "지피티 (2)"에 포함되는 경우
            if (!m.isUser && memberName.includes(cleanToId) && cleanToId.length > 2) {
              return true;
            }
            // 역방향 부분 매칭: "지피티 (2)"에서 "지피티" 추출해서 비교
            if (!m.isUser && memberName.replace(/\s*\(\d+\)$/, '') === cleanToId) {
              return true;
            }
            return false;
          });
          
          const finalFromId = fromMember?.isUser ? "Me" : fromMember?.agentId;
          const finalToId = toMember?.isUser ? "Me" : toMember?.agentId;
          
          
          // 유효한 ID가 있는 경우에만 엣지 생성
          if (finalFromId && finalToId && finalFromId !== finalToId) {
            // 요청 횟수에 따른 선 굵기 계산 (1-8 범위)
            let strokeWidth;
            if (count <= 2) {
              strokeWidth = 1;
            } else if (count <= 5) {
              strokeWidth = 2;
            } else if (count <= 10) {
              strokeWidth = 3;
            } else if (count <= 20) {
              strokeWidth = 4;
            } else if (count <= 35) {
              strokeWidth = 5;
            } else if (count <= 50) {
              strokeWidth = 6;
            } else {
              strokeWidth = Math.min(8, Math.floor(count / 10));
            }
            
            edges.push({
              from: finalFromId,
              to: finalToId,
              type: "REQUEST",
              isHierarchical: true, // 요청은 방향성이 있음
              strokeWidth: strokeWidth,
              requestCount: count,
              color: "#EA580C" // 주황색 (요청)
            });
          }
        });
      }
      
    } else {
      // 관계 모드: 기존 팀 관계 표시
      
      if (team.relationships && team.relationships.length > 0) {
        team.relationships.forEach((relationship) => {
          // 관계가 없는 경우 스킵
          if (!relationship.type) {
            return;
          }
          
          // from과 to를 실제 멤버 ID로 변환 (팀빌딩 변경 형식에 맞게)
          let fromId = relationship.from;
          let toId = relationship.to;
          
          
          // "Me"는 그대로 두고, 에이전트는 ID로 변환
          if (fromId !== "Me") {
            // 먼저 agentId로 직접 매칭 시도
            const directMatch = team.members.find(m => !m.isUser && m.agentId === fromId);
            if (directMatch) {
              fromId = directMatch.agentId!;
            } else {
              // A, B, C, D 같은 임시 ID인 경우 팀 멤버 순서로 매핑
              const memberIndex = fromId.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
              const nonUserMembers = team.members.filter(m => !m.isUser);
              if (memberIndex >= 0 && memberIndex < nonUserMembers.length) {
                fromId = nonUserMembers[memberIndex].agentId!;
              } else {
                // 에이전트 이름으로 매핑 시도 (백업)
                const nameMatch = team.members.find(m => 
                  !m.isUser && getAgentName(m.agentId || "") === fromId
                );
                if (nameMatch) {
                  fromId = nameMatch.agentId!;
                }
              }
            }
          }
          
          if (toId !== "Me") {
            // 먼저 agentId로 직접 매칭 시도
            const directMatch = team.members.find(m => !m.isUser && m.agentId === toId);
            if (directMatch) {
              toId = directMatch.agentId!;
            } else {
              // A, B, C, D 같은 임시 ID인 경우 팀 멤버 순서로 매핑
              const memberIndex = toId.charCodeAt(0) - 65; // A=0, B=1, C=2, D=3
              const nonUserMembers = team.members.filter(m => !m.isUser);
              if (memberIndex >= 0 && memberIndex < nonUserMembers.length) {
                toId = nonUserMembers[memberIndex].agentId!;
              } else {
                // 에이전트 이름으로 매핑 시도 (백업)
                const nameMatch = team.members.find(m => 
                  !m.isUser && getAgentName(m.agentId || "") === toId
                );
                if (nameMatch) {
                  toId = nameMatch.agentId!;
                }
              }
            }
          }
          
          // 관계 타입에 따른 엣지 생성
          let isHierarchical;
          if (relationship.type === "PEER") {
            isHierarchical = false;
          } else if (relationship.type === "SUPERVISOR" || (relationship.type as any) === "SUPERIOR_SUBORDINATE") {
            isHierarchical = true;
          } else {
            return;
          }
          
          edges.push({
            from: fromId,
            to: toId,
            type: relationship.type,
            isHierarchical: isHierarchical
          });
        });
      }
    }

    // 관계가 없다면 모든 팀원을 동료 관계로 연결 (피드백/요청 모드가 아닐 때만)
    if (!showFeedbackMode && !showRequestMode && edges.length === 0 && nodes.length > 1) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          edges.push({
            from: nodes[i].id,
            to: nodes[j].id,
            type: "PEER",
            isHierarchical: false
          });
        }
      }
    }

    // Position nodes using saved positions or circle layout as fallback
    const centerX = 200;
    const centerY = 200;
    const radius = 120;
    
    
    // 첫 번째 패스: 원본 위치 수집
    const originalPositions: any[] = [];
    
    nodes.forEach((node, index) => {
      let positionFound = false;
      let originalX, originalY;
      
      if (team.nodePositions && team.nodePositions[node.id]) {
        originalX = team.nodePositions[node.id].x;
        originalY = team.nodePositions[node.id].y;
        positionFound = true;
      } else if (team.nodePositions) {
        // agentId가 아닌 A, B, C, D 형태로 저장된 경우 확인
        const nonUserMembers = team.members.filter(m => !m.isUser);
        const memberIndex = nonUserMembers.findIndex(m => m.agentId === node.id);
        
        if (memberIndex >= 0) {
          const tempKey = String.fromCharCode(65 + memberIndex);
          if (team.nodePositions[tempKey]) {
            originalX = team.nodePositions[tempKey].x;
            originalY = team.nodePositions[tempKey].y;
            positionFound = true;
          }
        }
      }
      
      if (positionFound && !useOriginalLayout) {
        originalPositions.push({ node, x: originalX, y: originalY });
      } else {
        // 기본 원형 배치 (원형 배치 모드이거나 저장된 위치가 없는 경우)
        const angle = (index * 2 * Math.PI) / nodes.length;
        originalPositions.push({ 
          node, 
          x: centerX + radius * Math.cos(angle), 
          y: centerY + radius * Math.sin(angle) 
        });
      }
    });
    
    // 경계 계산
    const minX = Math.min(...originalPositions.map(p => p.x));
    const maxX = Math.max(...originalPositions.map(p => p.x));
    const minY = Math.min(...originalPositions.map(p => p.y));
    const maxY = Math.max(...originalPositions.map(p => p.y));
    
    const originalWidth = maxX - minX;
    const originalHeight = maxY - minY;
    
    // 목표 영역 (여백 30px)
    const targetWidth = 340; // 400 - 60
    const targetHeight = 340; // 400 - 60
    
    // 스케일 계산 (가로세로 비율 유지)
    const scaleX = originalWidth > 0 ? targetWidth / originalWidth : 1;
    const scaleY = originalHeight > 0 ? targetHeight / originalHeight : 1;
    const scale = Math.min(scaleX, scaleY, 1); // 최대 1배까지만 스케일링
    
    
    // 두 번째 패스: 정규화된 위치 적용
    originalPositions.forEach(({node, x, y}) => {
      // 중앙 정렬 및 스케일링
      const scaledX = (x - minX) * scale;
      const scaledY = (y - minY) * scale;
      
      // 중앙 배치
      node.x = scaledX + (400 - originalWidth * scale) / 2;
      node.y = scaledY + (400 - originalHeight * scale) / 2;
      
      // 최종 경계 체크
      node.x = Math.max(30, Math.min(370, node.x));
      node.y = Math.max(30, Math.min(370, node.y));
    });

    return { nodes, edges };
  };

  const openIdeaDetail = (idea: Idea) => {
    setSelectedIdea(idea);
    setShowIdeaDetail(true);
  };

  const closeIdeaDetail = () => {
    setSelectedIdea(null);
    setShowIdeaDetail(false);
  };

  const openActivityDetail = (activity: ActionLog) => {
    setSelectedActivity(activity);
    setShowActivityDetail(true);
  };

  const closeActivityDetail = () => {
    setSelectedActivity(null);
    setShowActivityDetail(false);
  };

  // 필터링된 및 정렬된 아이디어 목록 계산
  const getFilteredAndSortedIdeas = () => {
    let filteredIdeas = [...ideas];

    // 필터링
    if (ideaFilter !== "All") {
      filteredIdeas = filteredIdeas.filter(idea => {
        const authorName = getAgentName(idea.author);
        return authorName === ideaFilter;
      });
    }

    // 정렬
    if (ideaSortBy === "latest") {
      // 최신순 (timestamp 기준 오름차순 - 오래된 것부터 최신 것 순서)
      filteredIdeas.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    } else if (ideaSortBy === "rating") {
      // 평점 높은 순
      filteredIdeas.sort((a, b) => {
        const ratingA = calculateAverageRating(a) || 0;
        const ratingB = calculateAverageRating(b) || 0;
        return ratingB - ratingA;
      });
    }

    return filteredIdeas;
  };

  // 필터 옵션 생성 (모든 아이디어 작성자 목록)
  const getFilterOptions = () => {
    const authors = new Set<string>();
    ideas.forEach(idea => {
      const authorName = getAgentName(idea.author);
      authors.add(authorName);
    });
    return ["All", ...Array.from(authors).sort()];
  };

  // Filter and sort activity logs
  const getFilteredAndSortedActivityLogs = () => {
    let filteredLogs = [...actionLogs];

    // 참가자 필터링
    if (activityFilter !== "All") {
      filteredLogs = filteredLogs.filter(log => {
        // For feedback sessions, check both sides of "A → B (number times)" format
        if (log.agentName.includes(" → ")) {
          const [from, to] = log.agentName.split(" → ");
          // Remove parentheses and number times to compare pure names only
          const cleanFrom = from.trim().replace(/\s*\(\d+ times\)$/, '');
          const cleanTo = to.trim().replace(/\s*\(\d+ times\)$/, '');
          return cleanFrom === activityFilter || cleanTo === activityFilter;
        }
        // For general activities, also remove parentheses and number times
        const cleanAgentName = log.agentName.replace(/\s*\(\d+ times\)$/, '');
        return cleanAgentName === activityFilter;
      });
    }

    // 최신순 정렬 (최신 것부터 오래된 것 순서)
    filteredLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return filteredLogs;
  };

  // Generate activity log filter options (all activity participants)
  const getActivityFilterOptions = () => {
    const participants = new Set<string>();
    actionLogs.forEach(log => {
      // For feedback sessions, add both sides of "A → B (number times)" format
      if (log.agentName.includes(" → ")) {
        const [from, to] = log.agentName.split(" → ");
        // Remove parentheses and number times to add pure names only
        const cleanFrom = from.trim().replace(/\s*\(\d+times\)$/, '');
        const cleanTo = to.trim().replace(/\s*\(\d+times\)$/, '');
        if (cleanFrom) participants.add(cleanFrom);
        if (cleanTo) participants.add(cleanTo);
      } else {
        // For general activities, also remove parentheses and number times
        const cleanAgentName = log.agentName.replace(/\s*\(\d+ times\)$/, '');
        if (cleanAgentName) participants.add(cleanAgentName);
      }
    });
    return ["All", ...Array.from(participants).sort()];
  };

  const ActivityDetailModal = () => {
    if (!showActivityDetail || !selectedActivity) return null;
    
    const [relatedContent, setRelatedContent] = useState<any>(null);
    const [loadingContent, setLoadingContent] = useState(false);

    const activity = selectedActivity;

    // 관련 아이디어나 메시지 찾기
    const getRelatedContent = async () => {
      // For idea generation activities
      if (activity.action === "Idea Generation") {
        const relatedIdea = ideas.find(idea => {
          const ideaTime = new Date(idea.timestamp).getTime();
          const activityTime = new Date(activity.timestamp).getTime();
          // If activity time and idea creation time are similar (within 5 minutes)
          return Math.abs(ideaTime - activityTime) < 5 * 60 * 1000 &&
                 getAgentName(idea.author) === activity.agentName;
        });
        return relatedIdea;
      }

      // 아이디어 평가 활동인 경우
      if (activity.action === "아이디어 평가" || activity.action === "Idea Evaluation") {
        const activityTime = new Date(activity.timestamp).getTime();
        
        // 가장 가까운 시간의 평가를 찾기
        let closestEvaluation = null;
        let closestTimeDiff = Infinity;
        
        ideas.forEach(idea => {
          idea.evaluations?.forEach(evaluation => {
            if (getAgentName(evaluation.evaluator) === activity.agentName) {
              const evaluationTime = new Date(evaluation.timestamp || activity.timestamp).getTime();
              const timeDiff = Math.abs(evaluationTime - activityTime);
              
              // 5분 이내이면서 가장 가까운 평가를 찾기
              if (timeDiff < 5 * 60 * 1000 && timeDiff < closestTimeDiff) {
                closestTimeDiff = timeDiff;
                closestEvaluation = {
                  ...evaluation,
                  ideaTitle: idea.content.object || `아이디어 #${idea.id}`
                };
              }
            }
          });
        });
        
        return closestEvaluation ? [closestEvaluation] : [];
      }

      // 피드백 세션인 경우
      if (activity.action === "피드백 세션 완료" || activity.action === "Feedback Session Completed") {
        const activityTime = new Date(activity.timestamp).getTime();
        
        // 먼저 feedback_session_summary 메시지에서 sessionId를 찾아 실제 대화 내용 가져오기
        // 참여자 정보 추출 (activity.agentName에서 "A → B (N회)" 형태 파싱)
        let activityGiver = "";
        let activityReceiver = "";
        if (activity.agentName.includes(" → ")) {
          const parts = activity.agentName.split(" → ");
          activityGiver = parts[0].trim();
          activityReceiver = parts[1].replace(/\s*\(\d+times\)$/, '').trim();
        }
        
        const summaryMessage = chatMessages.find(message => {
          const messageTime = new Date(message.timestamp).getTime();
          const isInTimeWindow = Math.abs(messageTime - activityTime) < 10 * 60 * 1000;
          const isCorrectType = message.type === "feedback_session_summary";
          
          if (!isInTimeWindow || !isCorrectType) return false;
          
          // 참여자 매칭 검증
          if (message.payload && typeof message.payload === "object") {
            const payload = message.payload as any;
            
            // sessionMessages에서 실제 참여자 추출
            if (payload.sessionMessages && Array.isArray(payload.sessionMessages)) {
              const actualParticipants = new Set<string>();
              payload.sessionMessages.forEach((sessionMsg: any) => {
                if (sessionMsg.sender && sessionMsg.type !== "system") {
                  actualParticipants.add(sessionMsg.sender);
                }
              });
              
              const participantNames = Array.from(actualParticipants).map(id => getAgentName(id));
              
              // Check if activity log participants match actual session participants
              const hasActivityGiver = participantNames.includes(activityGiver);
              const hasActivityReceiver = participantNames.includes(activityReceiver);
              
              
              return hasActivityGiver && hasActivityReceiver;
            }
          }
          
          return true; // fallback: 시간 기반 매칭만 사용
        });
        
        if (summaryMessage && summaryMessage.payload && typeof summaryMessage.payload === "object") {
          const payload = summaryMessage.payload as any;
          
          // sessionMessages가 payload에 포함되어 있다면 바로 사용
          if (payload.sessionMessages && Array.isArray(payload.sessionMessages)) {
            return payload.sessionMessages.sort((a: any, b: any) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          }
          
          // sessionId가 있다면 API에서 실제 대화 내용 가져오기
          if (payload.sessionId) {
            // 비동기 함수로 변경하여 API 호출
            const fetchSessionMessages = async () => {
              try {
                const response = await fetch(`/api/teams/${teamId}/feedback-sessions/${payload.sessionId}/messages`);
                if (response.ok) {
                  const data = await response.json();
                  return data.messages || [];
                }
              } catch (error) {
                console.error("피드백 세션 메시지 로딩 실패:", error);
              }
              return [];
            };
            
            // Promise를 반환하여 비동기 처리 가능하게 함
            return fetchSessionMessages();
          }
        }
        
        // 활동 이름에서 참여자 정보 추출 (예: "지피티 → 이동건봇 (6회)")
        let feedbackGiver = "";
        let feedbackReceiver = "";
        
        if (activity.agentName.includes(" → ")) {
          const [from, to] = activity.agentName.split(" → ");
          feedbackGiver = from.trim().replace(/\s*\(\d+times\)$/, '');
          feedbackReceiver = to.trim().replace(/\s*\(\d+times\)$/, '');
        }
        
        // 해당 피드백 세션의 실제 대화 메시지 찾기 (더 포괄적으로)
        const relatedMessages = chatMessages.filter(message => {
          const messageTime = new Date(message.timestamp).getTime();
          const isInTimeWindow = Math.abs(messageTime - activityTime) < 30 * 60 * 1000; // 30분 이내로 확장
          
          if (!isInTimeWindow) return false;
          
          // 참여자가 일치하는지 확인
          const messageSender = getAgentName(message.sender);
          
          // 피드백 세션 참여자 중 하나가 보낸 메시지인지 확인
          const isFromParticipant = messageSender === feedbackGiver || messageSender === feedbackReceiver;
          
          if (!isFromParticipant) return false;
          
          // 다양한 메시지 타입 포함 (요약 메시지는 제외)
          const isValidMessageType = message.type === "give_feedback" || 
                                    (message.type as any) === "feedback" ||
                                    (message.type as any) === "message" ||
                                    (message.type as any) === "chat" ||
                                    ((message as any).content && (message as any).content.trim() !== "");
          
          // feedback_session_summary는 제외
          if (message.type === "feedback_session_summary") return false;
          
          return isValidMessageType;
        });
        
        // Sort by time
        const sortedMessages = relatedMessages.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // 메시지가 없으면 훨씬 더 넓은 범위에서 찾기 (폴백)
        if (sortedMessages.length === 0) {
          
          const fallbackMessages = chatMessages.filter(message => {
            const messageTime = new Date(message.timestamp).getTime();
            const isInTimeWindow = Math.abs(messageTime - activityTime) < 60 * 60 * 1000; // 1시간으로 확장
            
            if (!isInTimeWindow) return false;
            
            const messageSender = getAgentName(message.sender);
            
            // 참여자 중 하나가 보낸 메시지인지 확인 (모든 메시지 타입 포함)
            const isFromParticipant = messageSender === feedbackGiver || messageSender === feedbackReceiver;
            
            // feedback_session_summary는 여전히 제외
            const notSummary = message.type !== "feedback_session_summary";
            
            // 메시지에 실제 내용이 있는지 확인
            const hasContent = (message as any).content || (message.payload as any)?.content || (message.payload as any)?.message;
            
            return isFromParticipant && notSummary && hasContent;
          });
          
          
          return fallbackMessages.sort((a, b) => 
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
          );
        }
        
        return sortedMessages;
      }

      // 요청 활동인 경우
      if (activity.action === "Make Request") {
        const activityTime = new Date(activity.timestamp).getTime();
        const relatedMessages = chatMessages.filter(message => {
          const messageTime = new Date(message.timestamp).getTime();
          return Math.abs(messageTime - activityTime) < 2 * 60 * 1000 && // 2분 이내로 좁혀서 정확도 향상
                 message.type === "make_request" &&
                 getAgentName(message.sender) === activity.agentName;
        });
        return relatedMessages;
      }

      return null;
    };

    // 활동이 변경될 때마다 관련 콘텐츠 로드
    useEffect(() => {
      const loadContent = async () => {
        setLoadingContent(true);
        try {
          const content = await getRelatedContent();
          setRelatedContent(content);
        } catch (error) {
          console.error("관련 콘텐츠 로딩 실패:", error);
          setRelatedContent(null);
        } finally {
          setLoadingContent(false);
        }
      };

      if (selectedActivity) {
        loadContent();
      }
    }, [selectedActivity]);

    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0, 0, 0, 0.08)' }} onClick={closeActivityDetail}></div>
        <div className="relative z-10 flex items-center justify-center h-full p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[95vh] overflow-y-auto border border-gray-200">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <Clock className="h-6 w-6 text-blue-500" />
                <h2 className="text-xl font-semibold text-gray-900">Activity Details</h2>
              </div>
              <button
                onClick={closeActivityDetail}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Basic Information */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">{activity.action}</h3>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>Participant: {activity.agentName}</span>
                    <span>Time: {formatTimestamp(activity.timestamp)}</span>
                  </div>
                </div>

              </div>

              {/* Related Content */}
              {loadingContent && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900">Related Content</h4>
                  <div className="flex justify-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  </div>
                </div>
              )}
              
              {!loadingContent && relatedContent && (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-900">Related Content</h4>
                  
                  {/* For idea generation */}
                  {activity.action === "Idea Generation" && relatedContent && typeof relatedContent === 'object' && 'content' in relatedContent && (
                    <div className="border border-gray-200 rounded-lg p-4">
                      <h5 className="font-medium text-gray-900 mb-3">Generated Idea</h5>
                      <div className="space-y-3">
                        {Object.entries((relatedContent as Idea).content)
                          .filter(([, value]) => value && value.toString().trim() !== '')
                          .map(([key, value]) => (
                            <div key={key}>
                              <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                                {key === 'object' ? 'Object' :
                                 key === 'function' ? 'Function' :
                                 key === 'behavior' ? 'Behavior' :
                                 key === 'structure' ? 'Structure' : key}
                              </div>
                              <div className="bg-gray-50 rounded p-2 text-sm text-gray-800">
                                {(() => {
                                  // 문자열인 경우 JSON 파싱 시도
                                  if (typeof value === 'string') {
                                    try {
                                      const parsed = JSON.parse(value);
                                      if (typeof parsed === 'object' && parsed !== null) {
                                        // 배열인 경우 key-value 객체들을 처리
                                        if (Array.isArray(parsed)) {
                                          return (
                                            <div className="space-y-2">
                                              {parsed.map((item, index) => {
                                                if (typeof item === 'object' && item !== null && 'key' in item && 'value' in item) {
                                                  return (
                                                    <div key={index}>
                                                      <div className="font-medium text-gray-800 mb-1">{item.key}</div>
                                                      <div className="text-gray-600 text-sm">{item.value}</div>
                                                    </div>
                                                  );
                                                }
                                                return (
                                                  <div key={index}>
                                                    <div className="text-gray-600 text-sm">{String(item)}</div>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          );
                                        }
                                        // 객체인 경우 기존 로직 유지
                                        return (
                                          <div className="space-y-2">
                                            {Object.entries(parsed).map(([subKey, subValue]) => (
                                              <div key={subKey}>
                                                <div className="font-medium text-gray-800 mb-1">{subKey}</div>
                                                <div className="text-gray-600 text-sm">
                                                  {(() => {
                                                    if (typeof subValue === 'object' && subValue !== null) {
                                                      // key-value 형태의 객체인 경우
                                                      if ('key' in subValue && 'value' in subValue) {
                                                        return `${subValue.key}: ${subValue.value}`;
                                                      }
                                                      // 그 외의 객체
                                                      return Object.entries(subValue)
                                                        .map(([k, v]) => `${k}: ${v}`)
                                                        .join(', ');
                                                    }
                                                    return String(subValue);
                                                  })()}
                                                </div>
                                              </div>
                                            ))}
                                          </div>
                                        );
                                      }
                                      return <p className="text-sm text-gray-800 whitespace-pre-wrap">{value}</p>;
                                    } catch {
                                      return <p className="text-sm text-gray-800 whitespace-pre-wrap">{value}</p>;
                                    }
                                  } else if (typeof value === 'object' && value !== null) {
                                    // 배열인 경우 key-value 객체들을 처리
                                    if (Array.isArray(value)) {
                                      return (
                                        <div className="space-y-2">
                                          {(value as any[]).map((item, index) => {
                                            if (typeof item === 'object' && item !== null && 'key' in item && 'value' in item) {
                                              return (
                                                <div key={index}>
                                                  <div className="font-medium text-gray-800 mb-1">{item.key}</div>
                                                  <div className="text-gray-600 text-sm">{item.value}</div>
                                                </div>
                                              );
                                            }
                                            return (
                                              <div key={index}>
                                                <div className="text-gray-600 text-sm">{String(item)}</div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      );
                                    }
                                    // 객체인 경우 기존 로직 유지
                                    return (
                                      <div className="space-y-2">
                                        {Object.entries(value).map(([subKey, subValue]) => (
                                          <div key={subKey}>
                                            <div className="font-medium text-gray-800 mb-1">{subKey}</div>
                                            <div className="text-gray-600 text-sm">
                                              {(() => {
                                                if (typeof subValue === 'object' && subValue !== null) {
                                                  // key-value 형태의 객체인 경우
                                                  if ('key' in subValue && 'value' in subValue) {
                                                    return `${subValue.key}: ${subValue.value}`;
                                                  }
                                                  // 그 외의 객체
                                                  return Object.entries(subValue)
                                                    .map(([k, v]) => `${k}: ${v}`)
                                                    .join(', ');
                                                }
                                                return String(subValue);
                                              })()}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    );
                                  } else {
                                    return <p className="text-sm text-gray-800 whitespace-pre-wrap">{String(value)}</p>;
                                  }
                                })()}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* 아이디어 평가인 경우 */}
                  {(activity.action === "아이디어 평가" || activity.action === "Idea Evaluation") && Array.isArray(relatedContent) && relatedContent.length > 0 && (
                    <div className="space-y-4">
                      {relatedContent.map((evaluation: any, index: number) => (
                        <div key={index} className="border border-gray-200 rounded-lg p-4">
                          <div className="flex items-center justify-between mb-3">
                            <h5 className="font-medium text-gray-900">Evaluated Idea</h5>
                            <span className="text-sm text-gray-600">{evaluation.ideaTitle}</span>
                          </div>
                          
                          <div className="grid grid-cols-3 gap-4 mb-4">
                            <div className="text-center bg-blue-50 rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Novelty</div>
                              <div className="text-2xl font-bold text-blue-600">{evaluation.scores.novelty}/7</div>
                            </div>
                            <div className="text-center bg-green-50 rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Completeness</div>
                              <div className="text-2xl font-bold text-green-600">{evaluation.scores.completeness}/7</div>
                            </div>
                            <div className="text-center bg-purple-50 rounded-lg p-3">
                              <div className="text-xs text-gray-600 mb-1">Quality</div>
                              <div className="text-2xl font-bold text-purple-600">{evaluation.scores.quality}/7</div>
                            </div>
                          </div>
                          
                          <div className="bg-yellow-50 rounded-lg p-3">
                            <div className="text-xs font-medium text-gray-600 mb-2">Average Score</div>
                            <div className="text-xl font-bold text-gray-900">
                              {((evaluation.scores.novelty + evaluation.scores.completeness + evaluation.scores.quality) / 3).toFixed(1)}/7
                            </div>
                          </div>

                          {evaluation.comment && (
                            <div className="mt-4">
                              <div className="text-sm font-medium text-gray-700 mb-2">Evaluation Comment</div>
                              <div className="bg-gray-50 border-l-4 border-blue-500 p-3 rounded">
                                <p className="text-sm text-gray-800 italic">"{evaluation.comment}"</p>
                              </div>
                            </div>
                          )}
                          
                          {evaluation.timestamp && (
                            <div className="mt-3 text-xs text-gray-500">
                              Evaluation Time: {formatTimestamp(evaluation.timestamp)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* For feedback sessions */}
                  {(activity.action === "피드백 세션 완료" || activity.action === "Feedback Session Completed") && Array.isArray(relatedContent) && relatedContent.length > 0 && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-blue-500" />
                        <h4 className="font-semibold text-gray-900">Feedback Conversation</h4>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto">
                        <div className="space-y-3">
                          {relatedContent
                            .filter((message: any) => message.type !== "system") // 시스템 메시지 제외
                            .map((message: any, index: number) => {
                            const isMyMessage = message.sender === "Me";
                            
                            // Identify feedback provider (extracted from activity name)
                            let feedbackGiver = "";
                            if (activity.agentName.includes(" → ")) {
                              const [from] = activity.agentName.split(" → ");
                              feedbackGiver = from.trim().replace(/\s*\(\d+times\)$/, '');
                            }
                            
                            // Right-align if feedback provider or "Me"
                            const isFeedbackGiver = getAgentName(message.sender) === feedbackGiver;
                            const shouldAlignRight = isMyMessage || isFeedbackGiver;
                            
                            const displayContent = message.content || 
                                                  message.payload?.content || 
                                                  message.payload?.message || 
                                                  (typeof message.payload === 'string' ? message.payload : 
                                                   JSON.stringify(message.payload));
                            
                            return (
                              <div key={index} className={`flex ${shouldAlignRight ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] ${shouldAlignRight ? 'order-2' : 'order-1'}`}>
                                  {!shouldAlignRight && (
                                    <div className="text-xs text-gray-500 mb-1 px-3">
                                      {getAgentName(message.sender)}
                                    </div>
                                  )}
                                  {shouldAlignRight && !isMyMessage && (
                                    <div className="text-xs text-gray-500 mb-1 px-3 text-right">
                                      {getAgentName(message.sender)}
                                    </div>
                                  )}
                                  <div className={`rounded-2xl px-4 py-3 ${
                                    shouldAlignRight 
                                      ? (isMyMessage ? 'bg-blue-500 text-white' : 'bg-green-500 text-white')
                                      : 'bg-white text-gray-900 border border-gray-200'
                                  }`}>
                                    <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                      {displayContent}
                                    </p>
                                  </div>
                                  <div className={`text-xs text-gray-500 mt-1 px-3 ${
                                    shouldAlignRight ? 'text-right' : 'text-left'
                                  }`}>
                                    {formatTimestamp(message.timestamp)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* 피드백 세션인데 관련 메시지가 없는 경우 */}
                  {(activity.action === "피드백 세션 완료" || activity.action === "Feedback Session Completed") && (!relatedContent || !Array.isArray(relatedContent) || relatedContent.length === 0) && (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-gray-400" />
                        <h4 className="font-semibold text-gray-900">Feedback Conversation</h4>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-6 text-center">
                        <MessageSquare className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-gray-600 text-sm">
                          Unable to load feedback conversation content.
                        </p>
                        <p className="text-gray-500 text-xs mt-1">
                          세션이 종료되었거나 메시지가 삭제되었을 수 있습니다.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* For request activities */}
                  {(activity.action.includes("요청") || activity.action.includes("Request")) && Array.isArray(relatedContent) && relatedContent.length > 0 && (
                    <div className="space-y-4">
                      <h4 className="font-semibold text-gray-900">Request Content</h4>
                      <div className="space-y-3">
                        {relatedContent.map((message: any, index: number) => (
                          <div key={index} className="border border-gray-200 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900">
                                  {getAgentName(message.sender)}
                                </span>
                                <span className="text-sm text-gray-600">→</span>
                                <span className="font-medium text-blue-600">
                                  {message.payload?.mention ? getAgentName(message.payload.mention) : "Team Member"}
                                </span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {formatTimestamp(message.timestamp)}
                              </span>
                            </div>
                            
                            {message.payload?.requestType && (
                              <div className="mb-2">
                                <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                                  {message.payload.requestType === 'generate' ? 'Idea Generation Request' :
                                   message.payload.requestType === 'evaluate' ? '아이디어 평가 요청' :
                                   message.payload.requestType === 'give_feedback' ? '피드백 요청' :
                                   message.payload.requestType}
                                </span>
                              </div>
                            )}
                            
                            <div className="bg-orange-50 border-l-4 border-orange-500 p-3 rounded">
                              <p className="text-sm text-gray-800">
                                {typeof message.content === 'string' ? message.content : 
                                 typeof message.payload === 'string' ? message.payload :
                                 message.payload?.content || message.payload?.message || 
                                 JSON.stringify(message.payload)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 피드백 세션이나 요청에서 관련 메시지가 없는 경우 기본 정보 표시 */}
              {(activity.action === "Feedback Session Completed" || activity.action.includes("요청") || activity.action.includes("Request")) && 
               (!relatedContent || !Array.isArray(relatedContent) || relatedContent.length === 0) && (
                <div className="bg-gray-50 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-2">
                    {activity.action === "Feedback Session Completed" ? "Feedback Session Information" : "Request Information"}
                  </h4>
                  <div className="text-sm text-gray-700">
                    <p>{activity.description}</p>
                    {activity.agentName.includes("(") && (
                      <p className="mt-1">
                        {activity.action === "Feedback Session Completed" ? "Message exchange count" : "Activity count"}: {activity.agentName.match(/\((\d+)times\)/)?.[1] || "No information"}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const IdeaDetailModal = () => {
    if (!showIdeaDetail || !selectedIdea) return null;

    const averageRating = calculateAverageRating(selectedIdea);

    return (
      <div className="fixed inset-0 z-50">
        <div className="absolute inset-0" style={{ backgroundColor: 'rgba(0, 0, 0, 0.08)' }} onClick={closeIdeaDetail}></div>
        <div className="relative z-10 flex items-center justify-center h-full p-4">
          <div className="bg-white rounded-lg max-w-2xl w-full max-h-[95vh] overflow-y-auto border border-gray-200">
          {/* Modal Header */}
          <div className="flex items-center justify-between p-6 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <Lightbulb className="h-6 w-6 text-yellow-500" />
              <h2 className="text-xl font-semibold text-gray-900">Idea Details</h2>
            </div>
            <button
              onClick={closeIdeaDetail}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <X className="h-5 w-5 text-gray-500" />
            </button>
          </div>

          {/* Modal Content */}
          <div className="p-6 space-y-6">
            {/* 기본 정보 */}
            <div className="flex items-center gap-4 text-sm text-gray-600 mb-6">
              <span>Author: {getAgentName(selectedIdea.author)}</span>
              <span>Created: {formatTimestamp(selectedIdea.timestamp)}</span>
              {averageRating && (
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 text-yellow-500 fill-current" />
                  <span>Average {averageRating} points</span>
                </div>
              )}
            </div>

            {/* 아이디어 상세 내용 */}
            <div className="space-y-3">
              {(() => {
                // content가 문자열인 경우 JSON 파싱 시도
                let contentObj = selectedIdea.content;
                if (typeof selectedIdea.content === 'string') {
                  try {
                    contentObj = JSON.parse(selectedIdea.content);
                  } catch (e) {
                    contentObj = selectedIdea.content;
                  }
                }

                // 아이디에이션 세션과 동일한 스타일로 렌더링
                return Object.entries(contentObj)
                  .filter(([, value]) => value && value.toString().trim() !== '')
                  .map(([key, value]) => {
                    return (
                      <div key={key} className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          {key === 'object' ? 'Object' :
                           key === 'function' ? 'Function' :
                           key === 'behavior' ? 'Behavior' :
                           key === 'structure' ? 'Structure' : key}
                        </h4>
                        <div className="bg-gray-50 rounded-lg p-3">
                          {(() => {
                            // 문자열인 경우 JSON 파싱 시도
                            if (typeof value === 'string') {
                              try {
                                const parsed = JSON.parse(value);
                                if (typeof parsed === 'object' && parsed !== null) {
                                  // 배열인 경우 key-value 객체들을 처리
                                  if (Array.isArray(parsed)) {
                                    return (
                                      <div className="space-y-4">
                                        {parsed.map((item, index) => {
                                          if (typeof item === 'object' && item !== null && 'key' in item && 'value' in item) {
                                            return (
                                              <div key={index}>
                                                <div className="font-medium text-gray-800 mb-1">{item.key}</div>
                                                <div className="text-gray-600 text-sm">{item.value}</div>
                                              </div>
                                            );
                                          }
                                          return (
                                            <div key={index}>
                                              <div className="text-gray-600 text-sm">{String(item)}</div>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    );
                                  }
                                  // 객체인 경우 기존 로직 유지
                                  return (
                                    <div className="space-y-4">
                                      {Object.entries(parsed).map(([subKey, subValue]) => (
                                        <div key={subKey}>
                                          <div className="font-medium text-gray-800 mb-1">{subKey}</div>
                                          <div className="text-gray-600 text-sm">
                                            {(() => {
                                              if (typeof subValue === 'object' && subValue !== null) {
                                                // key-value 형태의 객체인 경우
                                                if ('key' in subValue && 'value' in subValue) {
                                                  return `${subValue.key}: ${subValue.value}`;
                                                }
                                                // 그 외의 객체
                                                return Object.entries(subValue)
                                                  .map(([k, v]) => `${k}: ${v}`)
                                                  .join(', ');
                                              }
                                              return String(subValue);
                                            })()}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }
                                return <p className="text-sm text-gray-800 whitespace-pre-wrap">{value}</p>;
                              } catch {
                                return <p className="text-sm text-gray-800 whitespace-pre-wrap">{value}</p>;
                              }
                            } else if (typeof value === 'object' && value !== null) {
                              // 배열인 경우 key-value 객체들을 처리
                              if (Array.isArray(value)) {
                                return (
                                  <div className="space-y-4">
                                    {(value as any[]).map((item, index) => {
                                      if (typeof item === 'object' && item !== null && 'key' in item && 'value' in item) {
                                        return (
                                          <div key={index}>
                                            <div className="font-medium text-gray-800 mb-1">{item.key}</div>
                                            <div className="text-gray-600 text-sm">{item.value}</div>
                                          </div>
                                        );
                                      }
                                      return (
                                        <div key={index}>
                                          <div className="text-gray-600 text-sm">{String(item)}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                );
                              }
                              // 객체인 경우 기존 로직 유지
                              return (
                                <div className="space-y-4">
                                  {Object.entries(value).map(([subKey, subValue]) => (
                                    <div key={subKey}>
                                      <div className="font-medium text-gray-800 mb-1">{subKey}</div>
                                      <div className="text-gray-600 text-sm">
                                        {(() => {
                                          if (typeof subValue === 'object' && subValue !== null) {
                                            // key-value 형태의 객체인 경우
                                            if ('key' in subValue && 'value' in subValue) {
                                              return `${subValue.key}: ${subValue.value}`;
                                            }
                                            // 그 외의 객체
                                            return Object.entries(subValue)
                                              .map(([k, v]) => `${k}: ${v}`)
                                              .join(', ');
                                          }
                                          return String(subValue);
                                        })()}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            } else {
                              return <p className="text-sm text-gray-800 whitespace-pre-wrap">{String(value)}</p>;
                            }
                          })()}
                        </div>
                      </div>
                    );
                  });
              })()}
            </div>

            {/* 평가 내역 */}
            {selectedIdea.evaluations && selectedIdea.evaluations.length > 0 && (
              <div>
                <h4 className="font-semibold text-gray-900 mb-3">Evaluation History</h4>
                <div className="space-y-3">
                  {selectedIdea.evaluations.map((evaluation, index) => (
                    <div key={index} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-gray-900">
                          {getAgentName(evaluation.evaluator)}
                        </span>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                          <span>Novelty: {evaluation.scores.novelty}</span>
                          <span>Completeness: {evaluation.scores.completeness}</span>
                          <span>Quality: {evaluation.scores.quality}</span>
                        </div>
                      </div>
                      {evaluation.comment && (
                        <p className="text-sm text-gray-700 bg-gray-50 p-2 rounded">
                          {evaluation.comment}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
          </div>
        </div>
      </div>
    );
  };

  const NetworkGraph = () => {
    const { nodes, edges } = generateNetworkData();
    
    if (nodes.length === 0) {
      return (
        <div className="flex items-center justify-center h-64 text-gray-500">
          Loading team data...
        </div>
      );
    }

    return (
      <div className="relative w-full">
        <svg width="100%" height="400" viewBox="0 0 400 400" className="border border-gray-200 rounded bg-gray-50">
          {/* SVG Definitions for arrow markers */}
          <defs>
            {/* Black arrow for relationships - 소두 버전 */}
            <marker
              id="arrowhead-black"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill="#000000"
                stroke="#000000"
                strokeWidth="1"
              />
            </marker>
            {/* Purple arrow for feedback - 소두 버전 */}
            <marker
              id="arrowhead-purple"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill="#7C3AED"
                stroke="#7C3AED"
                strokeWidth="1"
              />
            </marker>
            {/* Orange arrow for requests - 소두 버전 */}
            <marker
              id="arrowhead-orange"
              markerWidth="8"
              markerHeight="6"
              refX="7"
              refY="3"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <polygon
                points="0 0, 8 3, 0 6"
                fill="#EA580C"
                stroke="#EA580C"
                strokeWidth="1"
              />
            </marker>
          </defs>
          
          {/* Edges */}
          {edges.map((edge, index) => {
            const fromNode = nodes.find(n => n.id === edge.from);
            const toNode = nodes.find(n => n.id === edge.to);
            
            if (!fromNode || !toNode) return null;
            
            // Calculate arrow positioning for hierarchical relationships
            const dx = toNode.x - fromNode.x;
            const dy = toNode.y - fromNode.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const unitX = dx / length;
            const unitY = dy / length;
            
            // Adjust line endpoints to not overlap with circles
            const fromNodeRadius = 16;
            const toNodeRadius = 16;
            const startX = fromNode.x + unitX * (fromNodeRadius + 3);
            const startY = fromNode.y + unitY * (fromNodeRadius + 3);
            const endX = toNode.x - unitX * (toNodeRadius + 8);
            const endY = toNode.y - unitY * (toNodeRadius + 8);
            
            // Determine color and marker based on edge type
            let strokeColor = "#000000";
            let markerId = "arrowhead-black";
            
            if (edge.color) {
              strokeColor = edge.color;
              if (edge.type === "FEEDBACK") {
                markerId = "arrowhead-purple";
              } else if (edge.type === "REQUEST") {
                markerId = "arrowhead-orange";
              }
            }
            
            return (
              <g key={index}>
                <line
                  x1={startX}
                  y1={startY}
                  x2={endX}
                  y2={endY}
                  stroke={strokeColor}
                  strokeWidth={edge.strokeWidth || "1"}
                  markerEnd={edge.isHierarchical ? `url(#${markerId})` : "none"}
                />
              </g>
            );
          })}
          
          {/* Nodes */}
          {nodes.map((node) => {
            // 역할 기반 테두리 색상 결정
            let strokeColor = "white";
            let strokeWidth = "2";
            
            if (showFeedbackMode || showRequestMode) {
              const member = team?.members.find(m => 
                (m.isUser && node.id === "Me") || (!m.isUser && m.agentId === node.id)
              );
              
              if (member) {
                // 정확한 역할 이름으로 확인
                const hasFeedbackRole = member.roles.includes("Feedback");
                const hasRequestRole = member.roles.includes("Request");
                
                if (showFeedbackMode && hasFeedbackRole) {
                  strokeColor = "#7C3AED"; // 보라색 (피드백)
                  strokeWidth = "3";
                } else if (showRequestMode && hasRequestRole) {
                  strokeColor = "#EA580C"; // 주황색 (요청)
                  strokeWidth = "3";
                }
              }
            }
            
            return (
              <g key={node.id}>
                {/* 배경 원 */}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="18"
                  fill={node.isUser ? "#00C850" : "#2B7FFF"}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                />
                
                {/* User 아이콘 */}
                <foreignObject
                  x={node.x - 8}
                  y={node.y - 8}
                  width="16"
                  height="16"
                >
                  <User className="h-4 w-4 text-white" />
                </foreignObject>
                
                <text
                  x={node.x}
                  y={node.y + 30}
                  fontSize="11"
                  fill="#374151"
                  textAnchor="middle"
                  className="font-medium"
                >
                  {node.name.length > 8 ? node.name.slice(0, 6) + "..." : node.name}
                </text>
              </g>
            );
          })}
        </svg>
        
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading review data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Button onClick={() => router.push("/dashboard/teams")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Team Selection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => router.push(`/ideation/${teamId}`)}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              To Ideation
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => router.push("/")}
            >
              To Main Screen
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {team?.teamName} - Session Review
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <div className="flex items-center gap-1">
              <Users className="h-4 w-4" />
              {team?.members.length} members
            </div>
            <div className="flex items-center gap-1">
              <Lightbulb className="h-4 w-4" />
              {ideas.length} ideas
            </div>
            <div className="flex items-center gap-1">
              <MessageSquare className="h-4 w-4" />
              {actionLogs.length} activities
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* 요약 통계 */}
        <div className="mb-8 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Session Summary</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-600">{team?.members.length || 0}</div>
              <div className="text-sm text-gray-600">Team Members</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{ideas.length}</div>
              <div className="text-sm text-gray-600">Total Ideas</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-emerald-600">
                {ideas.reduce((sum, idea) => sum + (idea.evaluations?.length || 0), 0)}
              </div>
              <div className="text-sm text-gray-600">Total Evaluations</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-violet-600">
                {actionLogs.filter(log => log.action.includes("Feedback") || log.action.includes("피드백")).length}
              </div>
              <div className="text-sm text-gray-600">Feedback Activities</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {(() => {
                  // Calculate request count from chat messages
                  let requestCount = 0;
                  chatMessages.forEach(message => {
                    if (message.type === "make_request") {
                      requestCount++;
                    }
                  });
                  return requestCount;
                })()}
              </div>
              <div className="text-sm text-gray-600">Request Activities</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left: Team Information */}
          <div className="space-y-6">
            {/* 팀 기본 정보 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-6">
                <Users className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Team Information</h2>
              </div>
              
              {team && (
                <div className="space-y-4">
                  <div>
                    <h3 className="font-medium text-gray-900 mb-1">{team.teamName}</h3>
                    <p className="text-sm text-gray-600">
                      Created: {new Date(team.createdAt).toLocaleDateString('en-US')}
                    </p>
                    {team.topic && (
                      <p className="text-sm text-gray-600 mt-2">
                        <span className="font-medium">Topic:</span> {team.topic}
                      </p>
                    )}
                    {team.sharedMentalModel && (
                      <p className="text-sm text-gray-600 mt-2">
                        <span className="font-medium">Shared Mental Model:</span> {team.sharedMentalModel}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 팀원 정보 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-6">
                <Users className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">Team Composition</h2>
              </div>
              
              <div className="space-y-4">
                {team?.members.map((member, index) => {
                  const agentProfile = member.agentId ? agentProfiles[member.agentId] : null;
                  const relationships = getMemberRelationships(member);
                  
                  return (
                    <div key={index} className="p-4 rounded-lg border border-gray-200">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900">
                            {member.isUser ? getUserDisplayName() : getAgentName(member.agentId || "")}
                          </h3>
                        </div>
                      </div>
                      
                      {/* Demographics */}
                      {!member.isUser && agentProfile && (
                        <div className="mb-3 p-2 bg-gray-50 rounded text-sm text-gray-600">
                          <div className="grid grid-cols-2 gap-2 mb-2">
                            <span><strong>Age:</strong> {agentProfile.age} years old</span>
                            <span><strong>Gender:</strong> {agentProfile.gender}</span>
                            <span><strong>Profession:</strong> {agentProfile.professional}</span>
                            <span><strong>Education:</strong> {agentProfile.education || "TBD"}</span>
                          </div>
                          
                          {agentProfile.skills && (
                            <div className="mb-2">
                              <strong>Skills:</strong> {agentProfile.skills}
                            </div>
                          )}
                          
                          {agentProfile.personality && (
                            <div className="mb-2">
                              <strong>Personality:</strong> {agentProfile.personality}
                            </div>
                          )}
                          
                          {agentProfile.value && (
                            <div className="mb-2">
                              <strong>Values:</strong> {agentProfile.value}
                            </div>
                          )}
                          
                          {agentProfile.workStyle && (
                            <div className="mb-2">
                              <strong>Work Style:</strong> {agentProfile.workStyle}
                            </div>
                          )}
                          
                          {agentProfile.preferences && (
                            <div className="mb-2">
                              <strong>Preferences:</strong> {agentProfile.preferences}
                            </div>
                          )}
                          
                          {agentProfile.dislikes && (
                            <div className="mb-2">
                              <strong>Dislikes:</strong> {agentProfile.dislikes}
                            </div>
                          )}
                          
                        </div>
                      )}
                      
                      {/* Relationships */}
                      {relationships.length > 0 && (
                        <div className="mb-3">
                          <p className="text-sm font-medium text-gray-700 mb-1">Relationships:</p>
                          <div className="flex flex-wrap gap-1">
                            {relationships.map((relationship, relIndex) => (
                              <span
                                key={relIndex}
                                className="text-sm bg-blue-50 text-blue-700 px-2 py-1 rounded"
                              >
                                {relationship}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* Role-based activity statistics */}
                      <div className="mt-3 p-3 bg-blue-50 rounded text-sm">
                        <div className="font-medium text-gray-700 mb-2">Activity Status by Role</div>
                        <div className="grid grid-cols-2 gap-3">
                          {(() => {
                            const memberId = member.isUser ? "Me" : member.agentId;
                            const memberName = member.isUser ? getUserDisplayName() : getAgentName(member.agentId || "");
                            
                            // Calculate activity statistics
                            const ideaCount = ideas.filter(idea => idea.author === memberId).length;
                            let evaluationCount = 0;
                            ideas.forEach(idea => {
                              if (idea.evaluations) {
                                evaluationCount += idea.evaluations.filter(evaluation => evaluation.evaluator === memberId).length;
                              }
                            });
                            // Calculate feedback count - collect accurate count through multiple methods
                            let feedbackCount = 0;
                            
                            
                            // 1. Count feedback activities from action logs
                            const actionLogFeedbacks = actionLogs.filter(log =>
                              (log.action.includes("Feedback") || log.action.includes("피드백")) && log.agentName === memberName
                            );
                            feedbackCount += actionLogFeedbacks.length;
                            
                            // 2. Count direct feedback activities from chat messages
                            const directFeedbacks = chatMessages.filter(message => 
                              message.type === "give_feedback" && 
                              message.sender === memberId
                            );
                            feedbackCount += directFeedbacks.length;
                            
                            // 3. Feedback session participation count (from session summary)
                            let sessionFeedbacks = 0;
                            chatMessages.forEach(message => {
                              if (message.type === "feedback_session_summary" && message.payload) {
                                const payload = message.payload as any;
                                
                                // participants 배열에서 현재 멤버 확인
                                if (payload.participants && Array.isArray(payload.participants)) {
                                  // 각 참여자의 ID 확인
                                  payload.participants.forEach((participant: any) => {
                                    // 참여자가 현재 멤버와 일치하는지 확인
                                    const participantId = typeof participant === 'string' ? participant : participant.id;
                                    const participantName = typeof participant === 'string' ? participant : participant.name;
                                    
                                    if (participantId === memberId || participantName === memberName || 
                                        participantId === memberName || participantName === memberId) {
                                      sessionFeedbacks += 0.5; // Count 0.5 per session (giving and receiving feedback)
                                    }
                                  });
                                }
                                
                                // Keep existing method (in case there's other forms of data)
                                if (payload.from === memberId || payload.sender === memberId ||
                                    (payload.participants && Array.isArray(payload.participants) && 
                                     payload.participants[0] === memberId)) {
                                  sessionFeedbacks += 0.5;
                                }
                              }
                            });
                            feedbackCount += Math.round(sessionFeedbacks);
                            
                            const requestCount = chatMessages.filter(message => 
                              message.type === "make_request" && message.sender === memberId
                            ).length;
                            
                            // Role-based mapping - using exact wording set during team building
                            const roleActivityMap = {
                              "Idea Generation": { count: ideaCount, color: "text-blue-600" },
                              "Idea Evaluation": { count: evaluationCount, color: "text-emerald-600" },
                              "Feedback": { count: feedbackCount, color: "text-violet-600" },
                              "Request": { count: requestCount, color: "text-orange-600" }
                            };
                            
                            return Object.entries(roleActivityMap).map(([roleKey, activity]) => {
                              const hasRole = member.roles.includes(roleKey as AgentRole);
                              
                              
                              const displayName = roleKey;
                              
                              return (
                                <div key={roleKey} className={`flex justify-between items-center p-2 rounded ${
                                  hasRole ? "bg-white border border-blue-200" : "bg-gray-100"
                                }`}>
                                  <span className={hasRole ? "font-medium text-gray-800" : "text-gray-500"}>
                                    {displayName}:
                                  </span>
                                  <span className={`font-medium ${hasRole ? activity.color : "text-gray-400"}`}>
                                    {activity.count}
                                  </span>
                                </div>
                              );
                            });
                          })()}
                        </div>
                      </div>
                      
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Network graph and activity logs */}
          <div className="space-y-6">
            {/* Team Relationship Network */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Network className="h-5 w-5 text-purple-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Team Relationship Network</h2>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={useOriginalLayout ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseOriginalLayout(!useOriginalLayout)}
                  >
                    {useOriginalLayout ? "Custom Layout" : "Circular Layout"}
                  </Button>
                  <div className="w-px h-6 bg-gray-300"></div>
                  <Button
                    variant={showFeedbackMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setShowFeedbackMode(!showFeedbackMode);
                      if (!showFeedbackMode) setShowRequestMode(false);
                    }}
                  >
                    Feedback
                  </Button>
                  <Button
                    variant={showRequestMode ? "default" : "outline"}
                    size="sm"
                    onClick={() => {
                      setShowRequestMode(!showRequestMode);
                      if (!showRequestMode) setShowFeedbackMode(false);
                    }}
                  >
                    Request
                  </Button>
                </div>
              </div>
              
              <NetworkGraph />
            </div>
            {/* Activity Logs */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-blue-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Activity Timeline</h2>
                </div>
                
                {/* 참가자 필터 */}
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Participants:</span>
                  <select
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value)}
                    className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    {getActivityFilterOptions().map(option => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {(() => {
                  const filteredAndSortedLogs = getFilteredAndSortedActivityLogs();
                  
                  if (actionLogs.length === 0) {
                    return <p className="text-gray-500 text-center py-8">No activity records found.</p>;
                  }
                  
                  if (filteredAndSortedLogs.length === 0) {
                    return <p className="text-gray-500 text-center py-8">No activities match the filter criteria.</p>;
                  }
                  
                  return filteredAndSortedLogs.map((log, index) => (
                    <div 
                      key={index} 
                      className="flex gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 hover:shadow-md transition-all cursor-pointer"
                      onClick={() => openActivityDetail(log)}
                    >
                      <div className="flex-shrink-0 w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-gray-900">{log.agentName}</span>
                          <span className="text-xs text-gray-500">{formatTimestamp(log.timestamp)}</span>
                        </div>
                        <p className="text-sm text-gray-700 mb-1 hover:text-blue-600 transition-colors">{log.action}</p>
                        <p className="text-xs text-gray-600">{log.description}</p>
                      </div>
                    </div>
                  ));
                })()}
              </div>
              
              {/* 필터링 결과 요약 */}
              {activityFilter !== "All" && (
                <div className="mt-4 text-sm text-gray-600 text-center">
                  Showing {getFilteredAndSortedActivityLogs().length} activities (out of {actionLogs.length} total)
                </div>
              )}
            </div>

            {/* 아이디어 목록 */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-5 w-5 text-green-600" />
                  <h2 className="text-lg font-semibold text-gray-900">Generated Ideas</h2>
                </div>
                
                {/* 필터링 및 정렬 컨트롤 */}
                <div className="flex items-center gap-3">
                  {/* 작성자 필터 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Author:</span>
                    <select
                      value={ideaFilter}
                      onChange={(e) => setIdeaFilter(e.target.value)}
                      className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      {getFilterOptions().map(option => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="w-px h-4 bg-gray-300"></div>
                  
                  {/* 정렬 옵션 */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">Sort:</span>
                    <select
                      value={ideaSortBy}
                      onChange={(e) => setIdeaSortBy(e.target.value as "latest" | "rating")}
                      className="text-sm border border-gray-300 rounded-md px-2 py-1 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="latest">Latest</option>
                      <option value="rating">Rating</option>
                    </select>
                  </div>
                </div>
              </div>
              
              <div className="space-y-4 max-h-[600px] overflow-y-auto">
                {(() => {
                  const filteredAndSortedIdeas = getFilteredAndSortedIdeas();
                  
                  if (ideas.length === 0) {
                    return <p className="text-gray-500 text-center py-8">No ideas have been generated.</p>;
                  }
                  
                  if (filteredAndSortedIdeas.length === 0) {
                    return <p className="text-gray-500 text-center py-8">No ideas match the filter criteria.</p>;
                  }
                  
                  return filteredAndSortedIdeas.map((idea) => {
                    const averageRating = calculateAverageRating(idea);
                    // Calculate original order in the full idea list
                    const originalIndex = ideas.findIndex(i => i.id === idea.id);
                    
                    return (
                      <div 
                        key={idea.id} 
                        className="p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                        onClick={() => openIdeaDetail(idea)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h3 className="font-medium text-gray-900 hover:text-blue-600 transition-colors">
                            #{originalIndex + 1} {idea.content.object}
                          </h3>
                          {averageRating && (
                            <div className="flex items-center gap-1 text-sm">
                              <span className="text-yellow-500">★</span>
                              <span className="text-gray-600">{averageRating}</span>
                            </div>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 mb-2">
                          {idea.content.function}
                        </p>
                        <div className="flex items-center gap-4 text-xs text-gray-500">
                          <span>Author: {getAgentName(idea.author)}</span>
                          <span>Evaluations: {idea.evaluations?.length || 0}</span>
                          <span>{formatTimestamp(idea.timestamp)}</span>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
              
              {/* 필터링 결과 요약 */}
              {ideaFilter !== "All" && (
                <div className="mt-4 text-sm text-gray-600 text-center">
                  Showing {getFilteredAndSortedIdeas().length} ideas (out of {ideas.length} total)
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 아이디어 상세 모달 */}
      <IdeaDetailModal />
      
      {/* Activity Detail Modal */}
      <ActivityDetailModal />
    </div>
  );
}