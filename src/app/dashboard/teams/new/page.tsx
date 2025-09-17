"use client";

import { useState, useEffect } from "react";
import { createTeamAction, getUserTeamsAction } from "@/actions/team.actions";
import {
  getUserAgentsAction,
  createAgentAction,
} from "@/actions/agent.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AIAgent,
  AgentRole,
  TeamMemberSlot,
  Relationship,
  RelationshipType,
  Team,
} from "@/lib/types";
import { createMemberIdMapping } from "@/lib/member-utils";
import { RelationshipGraph } from "@/components/RelationshipGraph";
import {
  User,
  Users,
  Plus,
  ArrowRight,
  CheckCircle,
  X,
} from "lucide-react";

const AVAILABLE_ROLES: AgentRole[] = [
  "Idea Generation",
  "Idea Evaluation",
  "Feedback",
  "Request",
];

const PROFESSION_OPTIONS = [
  "Product Manager",
  "UX/UI Designer",
  "Software Engineer",
  "Data Analyst",
  "Marketing Specialist",
  "Business Analyst",
  "Graphic Designer",
  "Content Strategist",
  "Project Manager",
  "Researcher"
];

const SKILL_OPTIONS = [
  "Creative Planning",
  "Brainstorming",
  "Problem-solving Analysis",
  "Design Thinking Methodology",
  "Planning and Strategy",
  "Concept Development",
  "Content Storytelling",
  "Visualization and Infographics",
  "Project Management",
  "Data Analysis",
  "UI/UX Design",
  "User Research",
  "Prototyping",
  "Communication",
  "Presentation",
  "Team Leadership"
];

const MAJOR_OPTIONS = [
  "Computer Science",
  "Industrial Design",
  "Business Administration",
  "Psychology",
  "Marketing",
  "Visual Design",
  "Information Systems",
  "Statistics",
  "Media & Communication",
  "UI/UX Design",
  "Graphic Design",
  "Product Design"
];

export default function NewTeamPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0); // 0: Team creation method, 1: Team info, 2: Relationships, 3: Role design, 4: Member creation, 5: Shared mental model
  const [existingAgents, setExistingAgents] = useState<AIAgent[]>([]);
  const [existingTeams, setExistingTeams] = useState<Team[]>([]);
  const [useTemplate, setUseTemplate] = useState(false); // 기존 팀 템플릿 사용 여부
  const [activeTab, setActiveTab] = useState<"create" | "import">("create");
  const [currentMemberIndex, setCurrentMemberIndex] = useState(0); // 현재 설정 중인 팀원 인덱스

  // 1단계: 팀 기본 정보
  const [teamName, setTeamName] = useState("");
  const [teamSize, setTeamSize] = useState(4); // 나 + AI 3명 = 총 4명 기본값
  const [topic, setTopic] = useState(""); // 아이디에이션 주제 추가

  // 2-4단계: 팀원 슬롯
  const [memberSlots, setMemberSlots] = useState<TeamMemberSlot[]>([]);

  // 2단계: 관계 설정
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [nodePositions, setNodePositions] = useState<{
    [key: string]: { x: number; y: number };
  }>({});

  // Step 5: Shared Mental Model
  const [sharedMentalModel, setSharedMentalModel] = useState("");

  // 기존 에이전트 및 팀 로드
  useEffect(() => {
    async function loadData() {
      try {
        const [userAgents, userTeams] = await Promise.all([
          getUserAgentsAction(),
          getUserTeamsAction(),
        ]);
        setExistingAgents(userAgents);
        setExistingTeams(userTeams);
      } catch (error) {
        setError("Failed to load existing data.");
      }
    }
    loadData();
  }, []);

  // 팀 사이즈가 변경될 때 멤버 슬롯 업데이트
  useEffect(() => {
    setMemberSlots((prevSlots) => {
      const newSlots: TeamMemberSlot[] = [];
      const letters = ["A", "B", "C", "D", "E"];

      // 1. 사용자 슬롯은 항상 존재하며 정보 유지
      const userSlot = prevSlots.find((s) => s.isUser) || {
        id: "Me",
        roles: [],
        isUser: true,
      };
      newSlots.push(userSlot);

      // 2. AI 팀원 슬롯 조절
      for (let i = 1; i < teamSize; i++) {
        const id = letters[i - 1];
        const existingSlot = prevSlots.find((s) => s.id === id);
        if (existingSlot) {
          // 기존 정보 유지
          newSlots.push(existingSlot);
        } else {
          // 새 슬롯 추가
          newSlots.push({
            id,
            roles: [],
                isUser: false,
          });
        }
      }


      return newSlots;
    });
  }, [teamSize]);

  const updateMemberRole = (memberId: string, role: AgentRole) => {
    setMemberSlots((prev) =>
      prev.map((member) => {
        if (member.id === memberId) {
          const hasRole = member.roles.includes(role);
          return {
            ...member,
            roles: hasRole
              ? member.roles.filter((r) => r !== role)
              : [...member.roles, role],
          };
        }
        return member;
      })
    );
  };


  const updateMemberAgent = (
    memberId: string,
    agentData: TeamMemberSlot["agent"],
    agentId?: string | null
  ) => {
    setMemberSlots((prev) =>
      prev.map((member) =>
        member.id === memberId
          ? { ...member, agent: agentData, agentId: agentId || null }
          : member
      )
    );
  };

  // 템플릿 적용 함수
  const applyTemplate = async (template: Team) => {
    try {
      setTeamName(`${template.teamName} (복사본)`);
      setTopic(template.topic || "");
      setTeamSize(template.members.length);
      setSharedMentalModel(template.sharedMentalModel || "");

      // 팀원 슬롯 복사 및 ID 매핑 생성
      const templateSlots: TeamMemberSlot[] = [];
      const memberIdMapping: { [oldId: string]: string } = {}; // 원본 ID -> 새 ID 매핑
      
      for (const member of template.members) {
        if (member.isUser) {
          templateSlots.push({
            id: "Me",
            roles: member.roles,
            isUser: true,
            agent: member.userProfile ? { ...member.userProfile } : undefined, // 사용자 프로필 정보 복사
          });
          // 사용자의 경우 원본에서도 "Me"였을 가능성이 높지만 안전하게 매핑
          memberIdMapping[member.agentId || "Me"] = "Me";
        } else {
          // AI 멤버의 경우 해당 에이전트 정보 찾기
          const agent = existingAgents.find(a => a.id === member.agentId);
          const letters = ["A", "B", "C", "D", "E"];
          const aiMemberIndex = templateSlots.filter(s => !s.isUser).length;
          const newId = letters[aiMemberIndex];
          
          templateSlots.push({
            id: newId,
            roles: member.roles,
            isUser: false,
            agent: agent ? { ...agent } : undefined,
            agentId: agent?.id || null,
          });
          
          // ID 매핑 저장 (agentId와 기존 관계에서 사용된 식별자들을 모두 매핑)
          if (member.agentId) {
            memberIdMapping[member.agentId] = newId;
          }
          // 기존 관계에서 사용된 다른 식별자들도 매핑 (예: 에이전트 이름 등)
          if (agent) {
            memberIdMapping[agent.name] = newId;
            memberIdMapping[`${agent.name}봇`] = newId;
          }
        }
      }
      
      // 관계 데이터 매핑 업데이트
      const mappedRelationships = (template.relationships || []).map(rel => ({
        ...rel,
        from: memberIdMapping[rel.from] || rel.from,
        to: memberIdMapping[rel.to] || rel.to,
      }));
      
      // 노드 위치 매핑 업데이트
      const mappedNodePositions: { [key: string]: { x: number; y: number } } = {};
      if (template.nodePositions) {
        Object.entries(template.nodePositions).forEach(([oldId, position]) => {
          const newId = memberIdMapping[oldId] || oldId;
          mappedNodePositions[newId] = position;
        });
      }
      
      setMemberSlots(templateSlots);
      setRelationships(mappedRelationships);
      setNodePositions(mappedNodePositions);
      setStep(1); // 팀 정보 단계로 이동
    } catch (error) {
      setError("Failed to apply template.");
    }
  };

  // 단계별 진행 가능 여부 체크
  const canProceedToStep2 =
    teamName.trim().length > 0 &&
    topic.trim().length > 0 &&
    teamSize >= 3 &&
    teamSize <= 6;

  // All members must have at least 1 role, and at least 1 member must have 'Idea Generation' role
  const hasAllRoles = memberSlots.every((member) => member.roles.length > 0);
  const hasIdeaGenerator = memberSlots.some((member) =>
    member.roles.includes("Idea Generation")
  );
  const canProceedToStep3 = hasAllRoles && hasIdeaGenerator;

  const canProceedToStep4 = memberSlots
    .filter((member) => !member.isUser)
    .every((member) => member.agent);


  const canSubmit = sharedMentalModel.trim().length > 0; // Shared mental model is required

  // AI 팀원들만 필터링
  const aiMembers = memberSlots.filter((member) => !member.isUser);
  const currentMember = aiMembers[currentMemberIndex];
  const isLastMember = currentMemberIndex === aiMembers.length - 1;
  const isFirstMember = currentMemberIndex === 0;

  const goToNextMember = () => {
    if (!isLastMember) {
      setCurrentMemberIndex((prev) => prev + 1);
    }
  };

  const goToPrevMember = () => {
    if (!isFirstMember) {
      setCurrentMemberIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // 1. 새로 생성해야 할 AI 에이전트들을 먼저 생성
      const newAgentPromises = memberSlots
        .filter((member) => !member.isUser && !member.agentId && member.agent)
        .map((member) => {
          const formData = new FormData();
          // member.agent의 모든 속성을 formData에 추가
          Object.entries(member.agent!).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== "") {
              formData.append(key, String(value));
            }
          });
          return createAgentAction(formData).then((newAgent) => ({
            slotId: member.id,
            agentId: newAgent.id,
          }));
        });

      const newlyCreatedAgents = await Promise.all(newAgentPromises);

      // 2. 생성된 ID를 memberSlots에 다시 매핑
      const finalMemberSlots = memberSlots.map((slot) => {
        const newlyCreated = newlyCreatedAgents.find(
          (a) => a.slotId === slot.id
        );
        if (newlyCreated) {
          return { ...slot, agentId: newlyCreated.agentId };
        }
        return slot;
      });

      // 3. 최종 팀 멤버 데이터 구성 - 모든 슬롯 포함 (중복 허용)
      const teamMembers = finalMemberSlots.map((member) => ({
        agentId: member.isUser ? null : member.agentId,
        roles: member.roles,
        isUser: member.isUser,
        userProfile: member.isUser ? member.agent : undefined, // 사용자 프로필 정보 포함
      }));

      // 3.5. 관계 데이터를 실제 agentId로 매핑 (중앙화된 유틸리티 사용)
      const finalIdMapping = createMemberIdMapping(finalMemberSlots);

      const finalRelationships = relationships.map(rel => ({
        ...rel,
        from: finalIdMapping[rel.from] || rel.from,
        to: finalIdMapping[rel.to] || rel.to,
      }));

      // 4. Call team creation action

      const teamFormData = new FormData();
      teamFormData.append("teamName", teamName.trim());
      teamFormData.append("topic", topic.trim());
      teamFormData.append("members", JSON.stringify(teamMembers));
      teamFormData.append("relationships", JSON.stringify(finalRelationships));
      teamFormData.append("nodePositions", JSON.stringify(nodePositions));
      teamFormData.append("sharedMentalModel", sharedMentalModel.trim());

      const result = await createTeamAction(teamFormData);

      // 성공 응답 확인 및 리디렉션
      if (result.success && result.teamId) {
        window.location.href = "/";
      } else {
        throw new Error(result.error || "Failed to create team.");
      }
    } catch (error) {
      // 실제 에러인 경우에만 에러 상태를 설정합니다.
      setError(
        error instanceof Error ? error.message : "Failed to create team."
      );
      setIsLoading(false);
    }
  };

  // 관계 관리 함수들
  const addRelationship = (
    from: string,
    to: string,
    type: RelationshipType
  ) => {
    // member.id를 agentId 또는 "Me"로 변환 (일관성 유지)
    const fromMember = memberSlots.find((m) => m.id === from);
    const toMember = memberSlots.find((m) => m.id === to);

    const fromId = fromMember?.isUser
      ? "Me"
      : fromMember?.agentId || from; // agentId가 있으면 사용, 없으면 원래 ID(A,B,C,D)
    const toId = toMember?.isUser ? "Me" : toMember?.agentId || to;

    setRelationships((prev) => {
      // 같은 방향의 관계가 이미 있으면 타입만 업데이트
      const existingIndex = prev.findIndex(
        (rel) => rel.from === fromId && rel.to === toId
      );
      if (existingIndex >= 0) {
        const newRels = [...prev];
        newRels[existingIndex] = { from: fromId, to: toId, type };
        return newRels;
      }
      // 새 관계 추가
      return [...prev, { from: fromId, to: toId, type }];
    });
  };

  const removeRelationship = (from: string, to: string) => {
    // 관계 데이터에서 직접 전달받은 ID를 사용 (템플릿에서 온 관계는 이미 올바른 형태)
    setRelationships((prev) =>
      prev.filter((rel) => !(rel.from === from && rel.to === to))
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Team</h1>
        <p className="text-gray-600">
          {step === 0 
            ? "Create a new team or use an existing team as a template."
            : "Design your team systematically and create each team member."
          }
        </p>
      </div>

      {/* 단계 표시기 */}
      {step > 0 && (
        <div className="flex items-center justify-center mb-8">
          <div className="flex items-center space-x-2">
          {[
            { num: 1, label: "Team Info" },
            { num: 2, label: "Relationships" },
            { num: 3, label: "Role Assignment" },
            { num: 4, label: "Create Members" },
            { num: 5, label: "Shared Mental Model" },
          ].map((stepInfo, index) => (
            <div key={stepInfo.num} className="flex items-center">
              <div className="flex flex-col items-center">
                <div
                  className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-semibold ${
                    step >= stepInfo.num
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {step > stepInfo.num ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    stepInfo.num
                  )}
                </div>
                <span className="text-xs text-gray-600 mt-1">
                  {stepInfo.label}
                </span>
              </div>
              {index < 4 && (
                <ArrowRight
                  className={`h-4 w-4 mx-2 ${
                    step > stepInfo.num ? "text-blue-600" : "text-gray-300"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        </div>
      )}

      {/* 0단계: 팀 생성 방식 선택 */}
      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Choose Team Creation Method
            </CardTitle>
            <CardDescription>
              You can create a new team or use an existing team as a template.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 새 팀 만들기 */}
              <button
                onClick={() => {
                  setUseTemplate(false);
                  setStep(1);
                }}
                className="p-6 border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all text-left"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
                    <Plus className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Create New Team</h3>
                    <p className="text-sm text-gray-600">Build a new team from scratch</p>
                  </div>
                </div>
                <p className="text-sm text-gray-700">
                  Set up team name, members, and roles to create a new team.
                </p>
              </button>

              {/* 기존 팀 템플릿 사용 */}
              <button
                onClick={() => {
                  setUseTemplate(true);
                }}
                disabled={existingTeams.length === 0}
                className={`p-6 border-2 rounded-xl transition-all text-left ${
                  existingTeams.length === 0
                    ? "border-gray-200 bg-gray-50 cursor-not-allowed opacity-50"
                    : "border-gray-200 hover:border-blue-300 hover:shadow-md"
                }`}
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                    <Users className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Use Existing Team Template</h3>
                    <p className="text-sm text-gray-600">
                      Use template ({existingTeams.length} available)
                    </p>
                  </div>
                </div>
                <p className="text-sm text-gray-700">
                  Copy an existing team structure to create a new team quickly.
                </p>
              </button>
            </div>

            {/* 기존 팀 목록 (템플릿 사용 선택 시) */}
            {useTemplate && existingTeams.length > 0 && (
              <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h4 className="font-semibold text-gray-900 mb-4">Select Team to Use as Template</h4>
                <div className="grid grid-cols-1 gap-3">
                  {existingTeams.map((team) => (
                    <button
                      key={team.id}
                      onClick={() => applyTemplate(team)}
                      className="p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all text-left"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h5 className="font-semibold text-gray-900">{team.teamName}</h5>
                          <p className="text-sm text-gray-600 mt-1">{team.topic}</p>
                          <p className="text-xs text-gray-500 mt-1">
                            {team.members.length} members • {team.members.reduce((acc, m) => acc + m.roles.length, 0)} roles
                          </p>
                        </div>
                        <ArrowRight className="h-5 w-5 text-gray-400" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => window.history.back()}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1단계: 팀 기본 정보 */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Step 1: Basic Team Information
            </CardTitle>
            <CardDescription>
              Set the team name and number of AI team members.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="teamName">Team Name *</Label>
              <Input
                id="teamName"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                placeholder="e.g., Creative Design Team"
                className="text-lg"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="topic">Ideation Topic *</Label>
              <Input
                id="topic"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g., Carbon Emission Reduction, Future Education System"
                className="text-lg"
              />
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="teamSize">Total Team Composition *</Label>
                <p className="text-sm text-gray-600 mb-3">
                  Composed of me + AI team members
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { total: 3, ai: 2 },
                  { total: 4, ai: 3 },
                  { total: 5, ai: 4 },
                  { total: 6, ai: 5 },
                ].map((config) => (
                  <button
                    key={config.total}
                    type="button"
                    onClick={() => setTeamSize(config.total)}
                    className={`p-4 rounded-xl border-2 transition-all text-left ${
                      teamSize === config.total
                        ? "border-blue-500 bg-blue-50 shadow-md"
                        : "border-gray-200 hover:border-gray-300 hover:shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-lg font-bold text-gray-900">
                        A total of {config.total} members
                      </span>
                      <div
                        className={`w-4 h-4 rounded-full border-2 ${
                          teamSize === config.total
                            ? "border-blue-500 bg-blue-500"
                            : "border-gray-300"
                        }`}
                      >
                        {teamSize === config.total && (
                          <div className="w-2 h-2 bg-white rounded-full m-0.5"></div>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-gray-600">
                      Me + {config.ai} AI members
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* 팀 구조 미리보기 */}
            {teamSize > 0 && (
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
                <h4 className="font-semibold text-gray-900 mb-3">
                  Team Structure Preview
                </h4>
                <div className="flex gap-3 items-center">
                  {/* 사용자 본인 */}
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg">
                      <User className="h-7 w-7 text-white" />
                    </div>
                    <span className="text-sm font-medium text-gray-900 mt-2">
                      Me
                    </span>
                  </div>

                  {/* 플러스 아이콘 */}
                  <Plus className="h-5 w-5 text-gray-400 mx-2" />

                  {/* AI 팀원들 */}
                  {Array.from({ length: teamSize - 1 }, (_, i) => (
                    <div key={i} className="flex flex-col items-center">
                      <div className="w-14 h-14 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center shadow-lg">
                        <span className="font-bold text-white text-lg">
                          {String.fromCharCode(65 + i)}
                        </span>
                      </div>
                      <span className="text-sm font-medium text-gray-900 mt-2">
                        Member {String.fromCharCode(65 + i)}
                      </span>
                      <span className="text-xs text-gray-600">(AI)</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(0)}>
                Previous
              </Button>
              <Button onClick={() => setStep(2)} disabled={!canProceedToStep2}>
                Next: Relationship Setup
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3단계: 역할 할당 */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Step 3: Role Assignment
            </CardTitle>
            <CardDescription>
              Assign roles to team members based on their capabilities and responsibilities.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* 팀 관계 네트워크 미리보기 */}
            {relationships.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-2">
                <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-2 px-2">
                  <Users className="h-5 w-5 text-blue-600" />
                  설정된 팀 관계
                </h3>
                <div className="scale-90 origin-top">
                  <RelationshipGraph
                    members={memberSlots}
                    relationships={relationships}
                    onAddRelationship={() => {}} // 읽기 전용
                    agents={existingAgents}
                    onRemoveRelationship={() => {}} // 읽기 전용
                    readOnly={true}
                    initialNodePositions={nodePositions}
                  />
                </div>
              </div>
            )}


            {/* 역할 할당 섹션 */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Role Assignment
              </h3>

              {/* 역할 요구사항 안내 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">💡 Note:</span> At least one member must have the Idea Generation role.
                </p>
              </div>

              <div className="space-y-6">
                {memberSlots.map((member) => (
                  <div
                    key={member.id}
                    className="border border-gray-200 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          member.isUser ? "bg-green-500" : "bg-blue-500"
                        }`}
                      >
                        {member.isUser ? (
                          <User className="h-5 w-5 text-white" />
                        ) : (
                          <span className="font-bold text-white">
                            {member.id}
                          </span>
                        )}
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          {member.isUser ? "Me" : `Member ${member.id}`}
                        </h4>
                        <p className="text-sm text-gray-600">
                          {member.roles.length} roles selected
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {AVAILABLE_ROLES.map((role) => {
                        const isSelected = member.roles.includes(role);
                        return (
                          <button
                            key={role}
                            type="button"
                            onClick={() => updateMemberRole(member.id, role)}
                            className={`p-3 text-sm rounded-lg border-2 transition-all ${
                              isSelected
                                ? "border-blue-500 bg-blue-50 text-blue-700"
                                : "border-gray-200 hover:border-gray-300"
                            }`}
                          >
                            {role}
                          </button>
                        );
                      })}
                    </div>

                    {member.roles.length === 0 && (
                      <p className="text-sm text-red-600 mt-2">
                        Please select at least 1 role
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-between pt-4">
              <Button variant="outline" onClick={() => setStep(2)}>
                Previous: Relationships
              </Button>
              <div className="text-right">
                {!hasIdeaGenerator && (
                  <p className="text-sm text-red-600 mb-2">
                    At least one member must have the Idea Generation role
                  </p>
                )}
                <Button
                  onClick={() => setStep(4)}
                  disabled={!canProceedToStep3}
                >
                  Next: Member Creation
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4단계: AI 팀원 생성 */}
      {step === 4 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                Step 4: AI Team Member Creation
              </CardTitle>
              <CardDescription>
                Create new AI team members or bring existing members to compose your team.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* 팀 관계 네트워크 미리보기 */}
              {relationships.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-2 mb-6">
                  <h3 className="flex items-center gap-2 text-lg font-semibold text-gray-900 mb-2 px-2">
                    <Users className="h-5 w-5 text-blue-600" />
                    Configured Team Relationships
                  </h3>
                  <div className="scale-90 origin-top">
                    <RelationshipGraph
                      members={memberSlots}
                      relationships={relationships}
                      onAddRelationship={() => {}} // 읽기 전용
                      agents={existingAgents}
                      onRemoveRelationship={() => {}} // 읽기 전용
                      readOnly={true}
                      initialNodePositions={nodePositions}
                    />
                  </div>
                </div>
              )}

              {/* 사용자 본인 정보 입력 */}
              {memberSlots
                .filter((member) => member.isUser)
                .map((member) => (
                  <div
                    key={member.id}
                    className="border-2 border-green-200 bg-green-50 rounded-xl p-4 mb-6"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center bg-green-500">
                        <User className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">
                          Me
                        </h3>
                        <p className="text-sm text-gray-600">
                          Roles: {member.roles.join(", ")}
                        </p>
                      </div>
                    </div>

                    {/* 사용자 정보 입력 폼 */}
                    <UserInfoForm
                      initialData={member.agent}
                      onSubmit={(agentData) =>
                        updateMemberAgent(member.id, agentData, null)
                      }
                    />
                  </div>
                ))}

              {/* 진행 상황 표시 */}
              <div className="bg-gray-50 rounded-xl p-4 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-gray-900">
                    AI Team Member Setup Progress
                  </h3>
                  <span className="text-sm text-gray-600">
                    {currentMemberIndex + 1} / {aiMembers.length}
                  </span>
                </div>

                {/* 완료된 팀원 요약 */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {aiMembers.map((member, index) => {
                    const isCompleted = !!member.agent;
                    const isCurrent = index === currentMemberIndex;

                    return (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => setCurrentMemberIndex(index)}
                        className={`p-2 rounded-lg border-2 transition-all text-left ${
                          isCurrent
                            ? "border-blue-500 bg-blue-50"
                            : isCompleted
                            ? "border-green-200 bg-green-50"
                            : "border-gray-200 bg-white hover:border-gray-300"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              isCurrent
                                ? "bg-blue-500 text-white"
                                : isCompleted
                                ? "bg-green-500 text-white"
                                : "bg-gray-300 text-gray-600"
                            }`}
                          >
                            {member.id}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-gray-900">
                              Member {member.id}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {isCompleted ? member.agent?.name : "Not set"}
                            </div>
                          </div>
                          {isCompleted && (
                            <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 현재 팀원 설정 */}
              {currentMember && (
                <Card className="border-2 border-blue-200 bg-blue-50">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-full flex items-center justify-center bg-blue-500"
                      >
                        <span className="font-bold text-white text-lg">
                          {currentMember.id}
                        </span>
                      </div>
                      <div>
                        <h4 className="text-xl font-bold text-gray-900">
                          Member {currentMember.id}
                        </h4>
                        <p className="text-gray-600">
                          Roles: {currentMember.roles.join(", ")}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="bg-white rounded-lg">
                    {/* 탭 네비게이션 */}
                    <div className="flex border-b border-gray-200 mb-6">
                      <button
                        type="button"
                        onClick={() => setActiveTab("create")}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          activeTab === "create"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        Create New
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab("import")}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                          activeTab === "import"
                            ? "border-blue-500 text-blue-600"
                            : "border-transparent text-gray-500 hover:text-gray-700"
                        }`}
                      >
                        Select Existing Member ({existingAgents.length})
                      </button>
                    </div>

                    {/* 새 팀원 생성 탭 */}
                    {activeTab === "create" && (
                      <div>
                        <AgentCreateForm
                          roles={currentMember.roles}
                          onSubmit={(agentData) =>
                            updateMemberAgent(currentMember.id, agentData, null)
                          }
                          initialData={currentMember.agent}
                          memberKey={currentMember.id}
                        />
                      </div>
                    )}

                    {/* 기존 팀원 가져오기 탭 */}
                    {activeTab === "import" && (
                      <div>
                        {existingAgents.length === 0 ? (
                          <div className="text-center py-8">
                            <User className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                            <h3 className="text-lg font-semibold text-gray-900 mb-2">
                              아직 생성된 팀원이 없습니다
                            </h3>
                            <p className="text-gray-600 mb-4">
                              Create New하거나 다른 팀원을 먼저 만들어주세요.
                            </p>
                            <Button
                              onClick={() => setActiveTab("create")}
                              variant="outline"
                            >
                              Create New하기
                            </Button>
                          </div>
                        ) : (
                          <div>
                            <p className="text-sm text-gray-600 mb-4">
                              기존에 생성한 팀원을 선택하여 이 자리에
                              배치하세요.
                            </p>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {existingAgents.map((agent) => {
                                const isSelected =
                                  currentMember.agent &&
                                  currentMember.agent.name === agent.name &&
                                  currentMember.agent.age === agent.age &&
                                  currentMember.agent.professional ===
                                    agent.professional;

                                // Check if this agent is already used by another member
                                const usedByMember = memberSlots.find(
                                  (member) =>
                                    member.id !== currentMember.id &&
                                    member.agentId === agent.id
                                );
                                const isUsedByOtherMember = !!usedByMember;

                                return (
                                  <button
                                    key={agent.id}
                                    type="button"
                                    onClick={() =>
                                      !isUsedByOtherMember &&
                                      updateMemberAgent(
                                        currentMember.id,
                                        { ...agent },
                                        agent.id
                                      )
                                    }
                                    disabled={isUsedByOtherMember}
                                    className={`p-4 border-2 rounded-lg text-left transition-all ${
                                      isUsedByOtherMember
                                        ? "border-gray-200 bg-gray-100 opacity-50 cursor-not-allowed"
                                        : isSelected
                                        ? "border-blue-500 bg-blue-50"
                                        : "border-gray-200 hover:border-gray-300"
                                    }`}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                                        <User className="h-5 w-5 text-white" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <h5 className="font-semibold text-gray-900">
                                          {agent.name}
                                        </h5>
                                        <p className="text-sm text-gray-600">
                                          {agent.professional}
                                        </p>
                                        <p className="text-xs text-gray-500">
                                          {agent.age}세, {agent.gender}
                                        </p>
                                        {isUsedByOtherMember && (
                                          <p className="text-xs text-red-500 mt-1">
                                            Already in use by {usedByMember?.isUser ? "Me" : usedByMember?.id}
                                          </p>
                                        )}
                                      </div>
                                      {isSelected && !isUsedByOtherMember && (
                                        <CheckCircle className="h-6 w-6 text-blue-500 flex-shrink-0" />
                                      )}
                                      {isUsedByOtherMember && (
                                        <X className="h-6 w-6 text-red-400 flex-shrink-0" />
                                      )}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* 팀원 간 이동 버튼 */}
              <div className="flex justify-between items-center py-4">
                <Button
                  variant="outline"
                  onClick={goToPrevMember}
                  disabled={isFirstMember}
                  className="flex items-center gap-2"
                >
                  <ArrowRight className="h-4 w-4 rotate-180" />
                  Previous Member
                </Button>

                <div className="text-sm text-gray-600">
                  Member {currentMember?.id} ({currentMemberIndex + 1}/
                  {aiMembers.length})
                </div>

                <Button
                  variant="outline"
                  onClick={goToNextMember}
                  disabled={isLastMember}
                  className="flex items-center gap-2"
                >
                  Next Member
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg mt-6">
                  <div className="whitespace-pre-line">{error}</div>
                </div>
              )}

              <div className="flex justify-between pt-6 border-t border-gray-200">
                <Button
                  variant="outline"
                  onClick={() => setStep(3)}
                  disabled={isLoading}
                >
                  Previous: Role Assignment
                </Button>
                <Button
                  onClick={() => setStep(5)}
                  disabled={isLoading || !canProceedToStep4}
                >
                  {canProceedToStep4
                    ? "Next: Shared Mental Model"
                    : "Please complete member creation"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 2단계: 관계 설정 */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Step 2: Set Team Relationships
            </CardTitle>
            <CardDescription>
              Set the relationships among team members to create a more realistic team dynamic.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
              <p className="font-semibold mb-2">💡 How to use</p>
              <ul className="list-disc list-inside text-xs text-blue-700 mt-1 leading-normal">
                <li>Click the "Connect Relationship" button to start setting relationships.</li>
                <li>Click on nodes to create relationships and select the relationship type.</li>
                <li>Click on an existing connection to delete it.</li>
                <li>Drag nodes to freely rearrange their positions.</li>
              </ul>
            </div>
            <RelationshipGraph
              members={memberSlots}
              relationships={relationships}
              onAddRelationship={addRelationship}
              onRemoveRelationship={removeRelationship}
              initialNodePositions={nodePositions}
              onNodePositionChange={setNodePositions}
              agents={existingAgents}
            />

            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => setStep(1)}
                disabled={isLoading}
              >
                Previous: Team Info
              </Button>
              <Button
                onClick={() => setStep(3)}
                disabled={isLoading}
              >
                Next: Role Assignment
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 5단계: 공유 멘탈 모델 */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Step 5: Shared Mental Model
            </CardTitle>
            <CardDescription>
              Set up the team's shared mental model. This will be reflected in the team members' AI agents.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="p-4 bg-blue-50 rounded-lg text-sm text-blue-800">
              <p className="font-semibold mb-2">💡 What is a Shared Mental Model?</p>
              <p>
                A Shared Mental Model is a concept where team members share similar knowledge, beliefs, and assumptions about specific tasks or situations to enhance team efficiency.
                <br />
                <br />
                Please describe the work-related knowledge (procedures and strategies for task execution, team goals for the work) and team-related knowledge (attitudes and beliefs the team should have, knowledge about team colleagues) that the team should share.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sharedMentalModel">Shared Mental Model *</Label>
              <Textarea
                id="sharedMentalModel"
                value={sharedMentalModel}
                onChange={(e) => setSharedMentalModel(e.target.value)}
                placeholder="e.g., Our team pursues user-centered innovative ideas. All members share creative thinking through open communication and strive for a culture that challenges without fear of failure..."
                className="min-h-[200px]"
              />
              <p className="text-sm text-gray-600">
                Please freely describe the team's goals, values, work methods, team culture, etc.
              </p>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 p-4 rounded-lg">
                <div className="whitespace-pre-line">{error}</div>
              </div>
            )}

            <div className="flex justify-between pt-6 border-t border-gray-200">
              <Button
                variant="outline"
                onClick={() => setStep(4)}
                disabled={isLoading}
              >
                Previous: Member Creation
              </Button>
              <Button onClick={handleSubmit} disabled={isLoading || !canSubmit}>
                {isLoading ? "Creating team..." : "Team creation complete"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// 사용자 정보 입력 폼 컴포넌트 (자율성 제외)
function UserInfoForm({
  onSubmit,
  initialData,
}: {
  onSubmit: (data: TeamMemberSlot["agent"]) => void;
  initialData?: TeamMemberSlot["agent"];
}) {
  const [formData, setFormData] = useState({
    name: initialData?.name || "",
    age: initialData?.age?.toString() || "",
    gender: initialData?.gender || "",
    nationality: initialData?.nationality || "",
    major: initialData?.major || "",
    education: initialData?.education || "",
    professional: initialData?.professional || "",
    skills: initialData?.skills || "",
    personality: initialData?.personality || "",
    workStyle: initialData?.workStyle || "",
    preferences: initialData?.preferences || "",
    dislikes: initialData?.dislikes || "",
  });

  const [isCustomProfessional, setIsCustomProfessional] = useState(
    initialData?.professional ? !PROFESSION_OPTIONS.includes(initialData.professional) : false
  );
  const [isCustomMajor, setIsCustomMajor] = useState(
    initialData?.major ? !MAJOR_OPTIONS.includes(initialData.major) : false
  );
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [isCompleted, setIsCompleted] = useState(!!initialData);

  // initialData가 변경될 때 폼 데이터 업데이트
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        age: initialData.age?.toString() || "",
        gender: initialData.gender || "",
        nationality: initialData.nationality || "",
        major: initialData.major || "",
        education: initialData.education || "",
        professional: initialData.professional || "",
        skills: initialData.skills || "",
        personality: initialData.personality || "",
        workStyle: initialData.workStyle || "",
        preferences: initialData.preferences || "",
        dislikes: initialData.dislikes || "",
      });
      
      // 기존 스킬 파싱
      if (initialData.skills) {
        const skillsArray = initialData.skills.split(",").map(s => s.trim()).filter(s => s);
        const predefinedSkills = skillsArray.filter(skill => SKILL_OPTIONS.includes(skill));
        const customSkillsArray = skillsArray.filter(skill => !SKILL_OPTIONS.includes(skill));
        
        setSelectedSkills(predefinedSkills);
        setCustomSkills(customSkillsArray);
      }
      
      setIsCompleted(true);
    }
  }, [initialData]);

  // 스킬 배열을 문자열로 변환하여 formData 업데이트
  useEffect(() => {
    const allSkills = [...selectedSkills, ...customSkills];
    setFormData(prev => ({ ...prev, skills: allSkills.join(", ") }));
  }, [selectedSkills, customSkills]);

  const toggleSkill = (skill: string) => {
    setSelectedSkills(prev => 
      prev.includes(skill) 
        ? prev.filter(s => s !== skill)
        : [...prev, skill]
    );
  };

  const addCustomSkill = () => {
    if (newSkillInput.trim() && !customSkills.includes(newSkillInput.trim()) && !SKILL_OPTIONS.includes(newSkillInput.trim())) {
      setCustomSkills(prev => [...prev, newSkillInput.trim()]);
      setNewSkillInput("");
    }
  };

  const removeCustomSkill = (skill: string) => {
    setCustomSkills(prev => prev.filter(s => s !== skill));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      return;
    }

    const validGenders = [
      "Female",
      "Male",
      "Prefer not to say",
      "Unknown",
    ] as const;
    const genderValue =
      formData.gender && validGenders.includes(formData.gender as any)
        ? (formData.gender as (typeof validGenders)[number])
        : undefined;

    const agentData = {
      name: formData.name,
      age: formData.age ? parseInt(formData.age) : undefined,
      gender: genderValue,
      nationality: formData.nationality || undefined,
      major: formData.major || undefined,
      education: formData.education as
        | "High School Graduate"
        | "University Graduate"
        | "Master's Degree"
        | "Doctorate"
        | "Other"
        | undefined,
      professional: formData.professional,
      skills: formData.skills,
      personality: formData.personality || "",
      workStyle: formData.workStyle || "",
      preferences: formData.preferences || "",
      dislikes: formData.dislikes || "",
    };

    onSubmit(agentData);
    setIsCompleted(true);
  };

  if (isCompleted) {
    return (
      <div className="bg-white border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-green-800">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">My Information Complete</span>
        </div>
        <div className="mt-2 text-sm text-green-700">
          {formData.name} ({formData.professional})
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCompleted(false)}
          className="mt-2"
        >
          Edit
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="user-name">Name *</Label>
          <Input
            id="user-name"
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g., John Smith"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-age">Age</Label>
          <Input
            id="user-age"
            type="number"
            min="1"
            max="100"
            value={formData.age}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, age: e.target.value }))
            }
            placeholder="28"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="user-gender">Gender</Label>
          <Select
            id="user-gender"
            value={formData.gender}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, gender: e.target.value }))
            }
          >
            <option value="">Please select</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Prefer not to say">Prefer not to say</option>
            <option value="Unknown">Unknown</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="user-education">Education Level</Label>
          <Select
            id="user-education"
            value={formData.education}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, education: e.target.value }))
            }
          >
            <option value="">Please select</option>
            <option value="High School">High School</option>
            <option value="Bachelor's">Bachelor's</option>
            <option value="Master's">Master's</option>
            <option value="PhD">PhD</option>
            <option value="Other">Other</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-professional">Profession/Expertise</Label>
        <div className="space-y-2">
          <Select
            id="user-professional"
            value={isCustomProfessional ? "Custom" : formData.professional}
            onChange={(e) => {
              if (e.target.value === "Custom") {
                setIsCustomProfessional(true);
                setFormData((prev) => ({ ...prev, professional: "" }));
              } else {
                setIsCustomProfessional(false);
                setFormData((prev) => ({ ...prev, professional: e.target.value }));
              }
            }}
          >
            <option value="">Please select</option>
            {PROFESSION_OPTIONS.map((profession) => (
              <option key={profession} value={profession}>
                {profession}
              </option>
            ))}
            <option value="Custom">Custom</option>
          </Select>
          {isCustomProfessional && (
            <Input
              id="user-professional-custom"
              value={formData.professional}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, professional: e.target.value }))
              }
              placeholder="Please enter your profession/expertise"
              autoFocus
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-skills">Skills</Label>
        <div className="space-y-4">
          {/* Predefined skill options */}
          <div>
            <p className="text-sm text-gray-600 mb-3">Select from the skills below (click to select/deselect)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SKILL_OPTIONS.map((skill) => {
                const isSelected = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleSkill(skill);
                    }}
                    className={`p-2 text-sm rounded-lg border-2 transition-all text-center relative ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {skill}
                    {isSelected && (
                      <span className="absolute top-1 right-1 text-blue-500 text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom skill addition */}
          <div>
            <p className="text-sm text-gray-600 mb-2">Or add custom skills</p>
            <div className="flex gap-2">
              <Input
                value={newSkillInput}
                onChange={(e) => setNewSkillInput(e.target.value)}
                placeholder="Enter new skill"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomSkill();
                  }
                }}
              />
              <Button
                type="button"
                onClick={addCustomSkill}
                variant="outline"
                size="sm"
              >
                Add
              </Button>
            </div>
          </div>

          {/* Display selected skills */}
          {(selectedSkills.length > 0 || customSkills.length > 0) && (
            <div>
              <p className="text-sm text-gray-600 mb-2">Selected skills:</p>
              <div className="flex flex-wrap gap-2">
                {selectedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {customSkills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeCustomSkill(skill)}
                      className="text-green-600 hover:text-green-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-personality">Personality</Label>
        <Textarea
          id="user-personality"
          value={formData.personality}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, personality: e.target.value }))
          }
          placeholder="e.g., Systematic and analytical personality who enjoys problem-solving"
        />
      </div>


      <div className="space-y-2">
        <Label htmlFor="user-workStyle">Work Style</Label>
        <Textarea
          id="user-workStyle"
          value={formData.workStyle}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, workStyle: e.target.value }))
          }
          placeholder="e.g., Prefers systematic and planned work approach"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-preferences">Likes</Label>
        <Textarea
          id="user-preferences"
          value={formData.preferences}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, preferences: e.target.value }))
          }
          placeholder="e.g., Minimal yet sophisticated design, collaborative environment"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="user-dislikes">Dislikes</Label>
        <Textarea
          id="user-dislikes"
          value={formData.dislikes}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, dislikes: e.target.value }))
          }
          placeholder="e.g., Overly complex interfaces, inefficient processes"
        />
      </div>

      <Button type="submit" className="w-full">
        <CheckCircle className="h-4 w-4 mr-2" />Save My Information
      </Button>
    </form>
  );
}

// 팀원별 생성 폼 컴포넌트
function AgentCreateForm({
  roles,
  onSubmit,
  initialData,
  memberKey, // 폼 초기화 문제 해결을 위한 키
}: {
  roles: AgentRole[];
  onSubmit: (data: TeamMemberSlot["agent"], agentId: string | null) => void;
  initialData?: TeamMemberSlot["agent"];
  memberKey?: string; // 멤버 식별을 위한 키
}) {
  const [formData, setFormData] = useState({
    name: "",
    age: "",
    gender: "",
    nationality: "",
    major: "",
    education: "",
    professional: "",
    skills: "",
    personality: "",
    workStyle: "",
    preferences: "",
    dislikes: "",
  });

  const [isCustomProfessional, setIsCustomProfessional] = useState(false);
  const [isCustomMajor, setIsCustomMajor] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<string[]>([]);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [isCompleted, setIsCompleted] = useState(false);

  // memberKey나 initialData가 변경될 때만 폼 데이터 업데이트
  useEffect(() => {
    if (initialData) {
      setFormData({
        name: initialData.name || "",
        age: initialData.age?.toString() || "",
        gender: initialData.gender || "",
        nationality: initialData.nationality || "",
        major: initialData.major || "",
        education: initialData.education || "",
        professional: initialData.professional || "",
        skills: initialData.skills || "",
        personality: initialData.personality || "",
        workStyle: initialData.workStyle || "",
        preferences: initialData.preferences || "",
        dislikes: initialData.dislikes || "",
      });
      setIsCustomProfessional(initialData.professional ? !PROFESSION_OPTIONS.includes(initialData.professional) : false);
      setIsCustomMajor(initialData.major ? !MAJOR_OPTIONS.includes(initialData.major) : false);
      
      // 기존 스킬 파싱
      if (initialData.skills) {
        const skillsArray = initialData.skills.split(",").map(s => s.trim()).filter(s => s);
        const predefinedSkills = skillsArray.filter(skill => SKILL_OPTIONS.includes(skill));
        const customSkillsArray = skillsArray.filter(skill => !SKILL_OPTIONS.includes(skill));
        
        setSelectedSkills(predefinedSkills);
        setCustomSkills(customSkillsArray);
      }
      
      setIsCompleted(true);
    } else {
      // 새로운 멤버로 변경될 때 폼 초기화
      setFormData({
        name: "",
        age: "",
        gender: "",
        nationality: "",
        major: "",
        education: "",
        professional: "",
        skills: "",
        personality: "",
        workStyle: "",
        preferences: "",
        dislikes: "",
      });
      setIsCustomProfessional(false);
      setIsCustomMajor(false);
      setSelectedSkills([]);
      setCustomSkills([]);
      setNewSkillInput("");
      setIsCompleted(false);
    }
  }, [memberKey, initialData]);

  // 스킬 배열을 문자열로 변환하여 formData 업데이트
  useEffect(() => {
    const allSkills = [...selectedSkills, ...customSkills];
    setFormData(prev => ({ ...prev, skills: allSkills.join(", ") }));
  }, [selectedSkills, customSkills]);

  const toggleSkill = (skill: string) => {
    setSelectedSkills(prev => 
      prev.includes(skill) 
        ? prev.filter(s => s !== skill)
        : [...prev, skill]
    );
  };

  const addCustomSkill = () => {
    if (newSkillInput.trim() && !customSkills.includes(newSkillInput.trim()) && !SKILL_OPTIONS.includes(newSkillInput.trim())) {
      setCustomSkills(prev => [...prev, newSkillInput.trim()]);
      setNewSkillInput("");
    }
  };

  const removeCustomSkill = (skill: string) => {
    setCustomSkills(prev => prev.filter(s => s !== skill));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) {
      return;
    }

    const validGenders = [
      "Female",
      "Male",
      "Prefer not to say",
      "Unknown",
    ] as const;
    const genderValue =
      formData.gender && validGenders.includes(formData.gender as any)
        ? (formData.gender as (typeof validGenders)[number])
        : undefined;

    const agentData = {
      name: formData.name,
      age: formData.age ? parseInt(formData.age) : undefined,
      gender: genderValue,
      nationality: formData.nationality || undefined,
      major: formData.major || undefined,
      education: formData.education as
        | "High School Graduate"
        | "University Graduate"
        | "Master's Degree"
        | "Doctorate"
        | "Other"
        | undefined,
      professional: formData.professional,
      skills: formData.skills,
      personality: formData.personality || "",
      workStyle: formData.workStyle || "",
      preferences: formData.preferences || "",
      dislikes: formData.dislikes || "",
    };

    onSubmit(agentData, null);
    setIsCompleted(true);
  };

  if (isCompleted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-green-800">
          <CheckCircle className="h-5 w-5" />
          <span className="font-medium">Team Member Information Complete</span>
        </div>
        <div className="mt-2 text-sm text-green-700">
          {formData.name} ({formData.professional})
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setIsCompleted(false)}
          className="mt-2"
        >
          Edit
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`name-${memberKey}`}>Name *</Label>
          <Input
            id={`name-${memberKey}`}
            value={formData.name}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, name: e.target.value }))
            }
            placeholder="e.g., John Smith"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`age-${memberKey}`}>Age</Label>
          <Input
            id={`age-${memberKey}`}
            type="number"
            min="1"
            max="100"
            value={formData.age}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, age: e.target.value }))
            }
            placeholder="28"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`gender-${memberKey}`}>Gender</Label>
          <Select
            id={`gender-${memberKey}`}
            value={formData.gender}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, gender: e.target.value }))
            }
          >
            <option value="">Please select</option>
            <option value="Female">Female</option>
            <option value="Male">Male</option>
            <option value="Prefer not to say">Prefer not to say</option>
            <option value="Unknown">Unknown</option>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`education-${memberKey}`}>Education Level</Label>
          <Select
            id={`education-${memberKey}`}
            value={formData.education}
            onChange={(e) =>
              setFormData((prev) => ({ ...prev, education: e.target.value }))
            }
          >
            <option value="">Please select</option>
            <option value="High School Graduate">High School Graduate</option>
            <option value="University Graduate">University Graduate</option>
            <option value="Master's Degree">Master's Degree</option>
            <option value="Doctorate">Doctorate</option>
            <option value="Other">Other</option>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`professional-${memberKey}`}>Profession/Expertise</Label>
        <div className="space-y-2">
          <Select
            id={`professional-${memberKey}`}
            value={isCustomProfessional ? "직접입력" : formData.professional}
            onChange={(e) => {
              if (e.target.value === "직접입력") {
                setIsCustomProfessional(true);
                setFormData((prev) => ({ ...prev, professional: "" }));
              } else {
                setIsCustomProfessional(false);
                setFormData((prev) => ({ ...prev, professional: e.target.value }));
              }
            }}
          >
            <option value="">Please select</option>
            {PROFESSION_OPTIONS.map((profession) => (
              <option key={profession} value={profession}>
                {profession}
              </option>
            ))}
            <option value="직접입력">Custom Input</option>
          </Select>
          {isCustomProfessional && (
            <Input
              id={`professional-custom-${memberKey}`}
              value={formData.professional}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, professional: e.target.value }))
              }
              placeholder="Enter your profession/expertise"
              autoFocus
            />
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`skills-${memberKey}`}>Skills</Label>
        <div className="space-y-4">
          {/* Predefined skill options */}
          <div>
            <p className="text-sm text-gray-600 mb-3">Select from the skills below (click to select/deselect)</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {SKILL_OPTIONS.map((skill) => {
                const isSelected = selectedSkills.includes(skill);
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      toggleSkill(skill);
                    }}
                    className={`p-2 text-sm rounded-lg border-2 transition-all text-center relative ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {skill}
                    {isSelected && (
                      <span className="absolute top-1 right-1 text-blue-500 text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom skill addition */}
          <div>
            <p className="text-sm text-gray-600 mb-2">Or add custom skills</p>
            <div className="flex gap-2">
              <Input
                value={newSkillInput}
                onChange={(e) => setNewSkillInput(e.target.value)}
                placeholder="Enter new skill"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addCustomSkill();
                  }
                }}
              />
              <Button
                type="button"
                onClick={addCustomSkill}
                variant="outline"
                size="sm"
              >
                Add
              </Button>
            </div>
          </div>

          {/* Display selected skills */}
          {(selectedSkills.length > 0 || customSkills.length > 0) && (
            <div>
              <p className="text-sm text-gray-600 mb-2">Selected skills:</p>
              <div className="flex flex-wrap gap-2">
                {selectedSkills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => toggleSkill(skill)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {customSkills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm"
                  >
                    {skill}
                    <button
                      type="button"
                      onClick={() => removeCustomSkill(skill)}
                      className="text-green-600 hover:text-green-800"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`personality-${memberKey}`}>Personality</Label>
        <Textarea
          id={`personality-${memberKey}`}
          value={formData.personality}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, personality: e.target.value }))
          }
          placeholder="e.g., Enthusiastic and adventurous personality, open to new ideas"
        />
      </div>


      <div className="space-y-2">
        <Label htmlFor={`workStyle-${memberKey}`}>Work Style</Label>
        <Textarea
          id={`workStyle-${memberKey}`}
          value={formData.workStyle}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, workStyle: e.target.value }))
          }
          placeholder="e.g., Prefers systematic and planned work approach"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`preferences-${memberKey}`}>Likes</Label>
        <Textarea
          id={`preferences-${memberKey}`}
          value={formData.preferences}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, preferences: e.target.value }))
          }
          placeholder="e.g., Minimal yet sophisticated design, collaborative environment"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`dislikes-${memberKey}`}>Dislikes</Label>
        <Textarea
          id={`dislikes-${memberKey}`}
          value={formData.dislikes}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, dislikes: e.target.value }))
          }
          placeholder="e.g., Overly complex interfaces, inefficient processes"
        />
      </div>

      <Button type="submit" className="w-full">
        <CheckCircle className="h-4 w-4 mr-2" />
        Save Member Information
      </Button>
    </form>
  );
}
